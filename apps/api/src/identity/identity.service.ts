import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  decodeEncryptionKey,
  decryptField,
  emailHmac,
  encryptField,
  withTenant,
} from '@salesos/database';
import { OWNER_ROLE_NAMES, PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type SystemRole } from '@salesos/shared';
import { AppConfig } from '../config/app-config';
import { ApiException } from '../common/api.exception';
import { IdentityDatabase } from './identity-database.service';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords';

const ORGANIZATION_ROLES = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'VIEWER'] as const;
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

type MembershipRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  membership_status: string;
  role_name: string | null;
};

export type SessionContext = {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
  tenantId: string | null;
  permissions: string[];
  roles: string[];
};

@Injectable()
export class IdentityService {
  private readonly key: Buffer;

  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {
    this.key = decodeEncryptionKey(config.env.DATA_ENCRYPTION_KEY);
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    organizationName: string;
    requestId: string;
  }): Promise<void> {
    const email = normalizeEmail(input.email);
    const hmac = emailHmac(email, this.key);
    const existing = await this.database.prisma.user.findUnique({ where: { emailHmac: hmac } });
    if (existing) {
      await this.security(existing.id, null, 'auth.register', 'ignored', input.requestId, {});
      return;
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.database.prisma.user.create({
      data: {
        emailHmac: hmac,
        emailCiphertext: new Uint8Array(encryptField(email, this.key)),
        displayName: input.displayName.trim(),
        passwordHash,
        passwordChangedAt: new Date(),
        status: 'PENDING_VERIFICATION',
      },
    });
    const tenantId = await this.createOrganization(user.id, input.organizationName);
    await this.issueEmailToken(user.id, hmac);
    await this.security(user.id, tenantId, 'auth.register', 'accepted', input.requestId, {});
    await this.audit(tenantId, user.id, 'auth.register', 'user', user.id, input.requestId);
  }

  async verifyEmail(token: string, requestId: string): Promise<void> {
    const row = await this.consumeToken('email', token);
    await this.database.prisma.user.update({ where: { id: row.userId }, data: { status: 'ACTIVE' } });
    await this.security(row.userId, null, 'auth.verify_email', 'accepted', requestId, {});
  }

  async login(input: {
    email: string;
    password: string;
    remember: boolean;
    requestId: string;
    ip: string;
    userAgent: string | undefined;
    presentedToken: string | undefined;
  }): Promise<{ token: string; session: SessionContext }> {
    const email = normalizeEmail(input.email);
    const hmac = emailHmac(email, this.key);
    const ipHash = emailHmac(input.ip || 'unknown', this.key);
    const user = await this.database.prisma.user.findUnique({ where: { emailHmac: hmac } });
    const hash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(hash, input.password);
    const active = Boolean(user && user.status === 'ACTIVE' && user.passwordHash && passwordOk);
    await this.recordAttempt(hmac, ipHash, active);
    if (!active || !user) {
      await this.security(user?.id ?? null, null, 'auth.login', 'rejected', input.requestId, {});
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    if (input.presentedToken) await this.revokeToken(input.presentedToken);
    const memberships = await this.memberships(user.id);
    const activeTenant = memberships.find((row) => row.membership_status === 'ACTIVE' && row.tenant_status === 'ACTIVE');
    const token = newToken();
    const now = new Date();
    const absolute = new Date(now.getTime() + (input.remember ? REMEMBER_MS : ABSOLUTE_MS));
    const session = await this.database.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + IDLE_MS),
        absoluteExpiresAt: absolute,
        remember: input.remember,
        activeTenantId: activeTenant?.tenant_id ?? null,
        userAgent: input.userAgent?.slice(0, 200),
        ipHash,
      },
    });
    await this.security(user.id, activeTenant?.tenant_id ?? null, 'auth.login', 'accepted', input.requestId, {
      remember: input.remember,
    });
    if (activeTenant) await this.audit(activeTenant.tenant_id, user.id, 'auth.login', 'session', session.id, input.requestId);
    return { token, session: await this.contextFor(session.id) };
  }

  async logout(token: string | undefined, requestId: string): Promise<void> {
    if (!token) return;
    const session = await this.findLiveSession(token);
    await this.revokeToken(token);
    if (session) {
      await this.security(session.userId, session.activeTenantId, 'auth.logout', 'accepted', requestId, {});
      if (session.activeTenantId) {
        await this.audit(session.activeTenantId, session.userId, 'auth.logout', 'session', session.id, requestId);
      }
    }
  }

  async forgotPassword(email: string, requestId: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const hmac = emailHmac(normalized, this.key);
    const user = await this.database.prisma.user.findUnique({ where: { emailHmac: hmac } });
    if (user?.status === 'ACTIVE') {
      const token = newToken();
      await this.database.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MS) },
      });
      await this.capture('password_reset', hmac, token);
      await this.security(user.id, null, 'auth.password_reset_request', 'accepted', requestId, {});
    } else {
      await this.security(user?.id ?? null, null, 'auth.password_reset_request', 'ignored', requestId, {});
    }
  }

  async resetPassword(token: string, password: string, requestId: string): Promise<void> {
    const row = await this.consumeToken('reset', token);
    await this.database.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), status: 'ACTIVE' },
    });
    await this.database.prisma.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.security(row.userId, null, 'auth.password_change', 'accepted', requestId, {});
  }

  async context(token: string | undefined): Promise<SessionContext> {
    if (!token) throw new ApiException(401, 'UNAUTHORIZED', 'Sign in is required');
    const session = await this.findLiveSession(token);
    if (!session) throw new ApiException(401, 'UNAUTHORIZED', 'Sign in is required');
    const nextExpiry = new Date(Date.now() + IDLE_MS);
    if (nextExpiry < session.absoluteExpiresAt && nextExpiry.getTime() - session.expiresAt.getTime() > 60_000) {
      await this.database.prisma.session.update({ where: { id: session.id }, data: { expiresAt: nextExpiry } });
    }
    return this.contextFor(session.id);
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.database.prisma.session.findMany({
      where: { userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      remember: row.remember,
      userAgent: row.userAgent,
      current: row.id === currentSessionId,
    }));
  }

  async revokeSession(actorId: string, sessionId: string, requestId: string, tenantId: string | null): Promise<void> {
    const row = await this.database.prisma.session.findFirst({ where: { id: sessionId, userId: actorId } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Session was not found');
    await this.database.prisma.session.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await this.security(actorId, tenantId, 'auth.session_revoke', 'accepted', requestId, { sessionId });
    if (tenantId) await this.audit(tenantId, actorId, 'auth.session_revoke', 'session', sessionId, requestId);
  }

  async organizations(userId: string) {
    const rows = await this.memberships(userId);
    const byTenant = new Map<string, { id: string; name: string; slug: string; status: string; membershipStatus: string; roles: string[] }>();
    for (const row of rows) {
      const current = byTenant.get(row.tenant_id) ?? {
        id: row.tenant_id,
        name: row.tenant_name,
        slug: row.tenant_slug,
        status: row.tenant_status,
        membershipStatus: row.membership_status,
        roles: [],
      };
      if (row.role_name) current.roles.push(row.role_name);
      byTenant.set(row.tenant_id, current);
    }
    return [...byTenant.values()];
  }

  async createAdditionalOrganization(actor: SessionContext, name: string, requestId: string) {
    const tenantId = await this.createOrganization(actor.userId, name);
    await this.database.prisma.session.update({ where: { id: actor.sessionId }, data: { activeTenantId: tenantId } });
    await this.audit(tenantId, actor.userId, 'organization.create', 'organization', tenantId, requestId);
    return this.organization(actor.userId, tenantId);
  }

  async organization(userId: string, tenantId: string) {
    await this.requireActiveMembership(userId, tenantId);
    const tenant = await this.database.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new ApiException(404, 'NOT_FOUND', 'Organization was not found');
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, timezone: tenant.timezone };
  }

  async updateOrganization(actor: SessionContext, tenantId: string, input: { name?: string; status?: 'ACTIVE' | 'SUSPENDED' }, requestId: string) {
    await this.requireActiveMembership(actor.userId, tenantId);
    if (input.status && !actor.roles.some((role) => isOwner(role))) {
      throw new ApiException(403, 'FORBIDDEN', 'Only an owner can change organization status');
    }
    if (!actor.permissions.includes('organizations.manage') && !actor.roles.some((role) => isOwner(role))) {
      throw new ApiException(403, 'FORBIDDEN', 'Organization management is not allowed');
    }
    const tenant = await this.database.prisma.tenant.update({
      where: { id: tenantId },
      data: { name: input.name, status: input.status },
    });
    await this.audit(tenantId, actor.userId, 'organization.update', 'organization', tenantId, requestId);
    await this.security(actor.userId, tenantId, 'organization.update', 'accepted', requestId, { status: input.status ?? null });
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, timezone: tenant.timezone };
  }

  async switchOrganization(actor: SessionContext, tenantId: string, requestId: string): Promise<void> {
    await this.requireActiveMembership(actor.userId, tenantId);
    await this.database.prisma.session.update({ where: { id: actor.sessionId }, data: { activeTenantId: tenantId } });
    await this.audit(tenantId, actor.userId, 'organization.switch', 'organization', tenantId, requestId);
  }

  async invite(actor: SessionContext, tenantId: string, email: string, role: string, requestId: string): Promise<void> {
    this.requireTenant(actor, tenantId);
    if (!actor.permissions.includes('users.invite') && !actor.permissions.includes('users.manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'Invitations are not allowed');
    }
    this.assertGrantable(actor, role);
    const token = newToken();
    const hmac = emailHmac(normalizeEmail(email), this.key);
    await withTenant(this.database.prisma, tenantId, (tx) =>
      tx.invitation.create({
        data: {
          tenantId,
          emailHmac: hmac,
          roleName: role,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_MS),
          invitedBy: actor.userId,
        },
      }),
    );
    await this.capture('invitation', hmac, token);
    await this.audit(tenantId, actor.userId, 'organization.invite', 'invitation', hmac, requestId);
  }

  async acceptInvitation(actor: SessionContext, token: string, requestId: string) {
    const hash = hashToken(token);
    const invitation = await this.database.prisma.$queryRaw<Array<{ tenant_id: string; id: string; email_hmac: string; role_name: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>>(
      Prisma.sql`SELECT * FROM public.lookup_invitation(${hash})`,
    );
    const row = invitation[0];
    if (!row || row.revoked_at) throw new ApiException(400, 'TOKEN_INVALID', 'Invitation is not valid');
    if (row.accepted_at) throw new ApiException(400, 'TOKEN_USED', 'Invitation was already used');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ApiException(400, 'TOKEN_EXPIRED', 'Invitation has expired');
    const user = await this.database.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user || user.emailHmac !== row.email_hmac) throw new ApiException(403, 'FORBIDDEN', 'Invitation does not match this account');
    const role = await withTenant(this.database.prisma, row.tenant_id, async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { tenantId: row.tenant_id, id: row.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ApiException(400, 'TOKEN_USED', 'Invitation was already used');
      const match = await tx.role.findFirst({ where: { tenantId: row.tenant_id, name: row.role_name } });
      if (!match) throw new ApiException(409, 'CONFLICT', 'Invitation role is no longer available');
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: row.tenant_id, userId: actor.userId } },
        update: { status: 'ACTIVE' },
        create: { tenantId: row.tenant_id, userId: actor.userId, status: 'ACTIVE' },
      });
      await tx.membershipRole.upsert({
        where: { tenantId_userId_roleId: { tenantId: row.tenant_id, userId: actor.userId, roleId: match.id } },
        update: {},
        create: { tenantId: row.tenant_id, userId: actor.userId, roleId: match.id },
      });
      return match;
    });
    await this.audit(row.tenant_id, actor.userId, 'organization.invite_accept', 'membership', actor.userId, requestId);
    return { organizationId: row.tenant_id, role: role.name };
  }

  async members(actor: SessionContext, tenantId: string) {
    this.requireTenant(actor, tenantId);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { tenantId, status: { not: 'REMOVED' } },
        include: { user: true, roles: { include: { role: true } } },
      });
      return memberships.map((membership) => ({
        userId: membership.userId,
        displayName: membership.user.displayName,
        email: decryptField(Buffer.from(membership.user.emailCiphertext), this.key),
        status: membership.status,
        roles: membership.roles.map((link) => link.role.name),
      }));
    });
  }

  async updateMember(actor: SessionContext, tenantId: string, userId: string, role: SystemRole, requestId: string): Promise<void> {
    this.requireTenant(actor, tenantId);
    if (!actor.permissions.includes('roles.manage') && !actor.permissions.includes('users.manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'Role changes are not allowed');
    }
    this.assertGrantable(actor, role);
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (!membership || membership.status === 'REMOVED') throw new ApiException(404, 'NOT_FOUND', 'Member was not found');
      const next = await tx.role.findFirst({ where: { tenantId, name: role } });
      if (!next) throw new ApiException(404, 'NOT_FOUND', 'Role was not found');
      await tx.membershipRole.deleteMany({ where: { tenantId, userId } });
      await tx.membershipRole.create({ data: { tenantId, userId, roleId: next.id } });
    });
    await this.database.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(tenantId, actor.userId, 'membership.role_change', 'membership', userId, requestId);
  }

  async transferOwner(actor: SessionContext, tenantId: string, userId: string, password: string, requestId: string): Promise<void> {
    this.requireTenant(actor, tenantId);
    if (!actor.roles.some((role) => isOwner(role))) throw new ApiException(403, 'FORBIDDEN', 'Only an owner can transfer ownership');
    const user = await this.database.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Password confirmation failed');
    }
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
      const stillOwner = await tx.membershipRole.findFirst({
        where: { tenantId, userId: actor.userId, role: { name: { in: [...OWNER_ROLE_NAMES] } }, membership: { status: 'ACTIVE' } },
      });
      if (!stillOwner) throw new ApiException(409, 'CONFLICT', 'Ownership changed before this transfer completed');
      const target = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (!target || target.status !== 'ACTIVE') throw new ApiException(404, 'NOT_FOUND', 'Member was not found');
      const ownerRole = await tx.role.findFirst({ where: { tenantId, name: 'OWNER' } });
      const adminRole = await tx.role.findFirst({ where: { tenantId, name: 'ADMIN' } });
      if (!ownerRole || !adminRole) throw new ApiException(409, 'CONFLICT', 'System roles are missing');
      await tx.membershipRole.deleteMany({ where: { tenantId, userId: actor.userId } });
      await tx.membershipRole.deleteMany({ where: { tenantId, userId } });
      await tx.membershipRole.create({ data: { tenantId, userId: actor.userId, roleId: adminRole.id } });
      await tx.membershipRole.create({ data: { tenantId, userId, roleId: ownerRole.id } });
    });
    await this.database.prisma.session.updateMany({
      where: { userId: { in: [actor.userId, userId] }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(tenantId, actor.userId, 'organization.owner_transfer', 'membership', userId, requestId);
  }

  async removeMember(actor: SessionContext, tenantId: string, userId: string, requestId: string): Promise<void> {
    this.requireTenant(actor, tenantId);
    if (!actor.permissions.includes('users.manage')) throw new ApiException(403, 'FORBIDDEN', 'Member removal is not allowed');
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
      const owners = await tx.membershipRole.findMany({
        where: { tenantId, role: { name: { in: [...OWNER_ROLE_NAMES] } } },
        include: { membership: true },
      });
      const activeOwners = owners.filter((row) => row.membership.status === 'ACTIVE');
      if (activeOwners.length === 1 && activeOwners[0]?.userId === userId) {
        throw new ApiException(409, 'CONFLICT', 'The last owner cannot be removed');
      }
      await tx.membershipRole.deleteMany({ where: { tenantId, userId } });
      await tx.membership.update({ where: { tenantId_userId: { tenantId, userId } }, data: { status: 'REMOVED' } });
    });
    await this.database.prisma.session.updateMany({
      where: { userId, activeTenantId: tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(tenantId, actor.userId, 'membership.remove', 'membership', userId, requestId);
  }

  permissionCatalog(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'CONFLICT', 'Choose an organization first');
    return [...PERMISSIONS];
  }

  async roles(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'CONFLICT', 'Choose an organization first');
    return withTenant(this.database.prisma, actor.tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId: actor.tenantId ?? undefined },
        include: { permissions: true },
        orderBy: { name: 'asc' },
      });
      return roles.map((role) => ({ name: role.name, system: role.isSystem, permissions: role.permissions.map((row) => row.permission) }));
    });
  }

  async auditLog(actor: SessionContext, tenantId: string) {
    this.requireTenant(actor, tenantId);
    if (!actor.permissions.includes('audit.read')) throw new ApiException(403, 'FORBIDDEN', 'Audit access is not allowed');
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const rows = await tx.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
      return rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt.toISOString(),
        requestId: (row.payload as { requestId?: string }).requestId ?? null,
      }));
    });
  }

  private async createOrganization(ownerId: string, name: string): Promise<string> {
    const tenant = await this.database.prisma.tenant.create({
      data: { name: name.trim(), slug: slugify(name), status: 'ACTIVE', settings: { permittedChannels: ['EMAIL'] } },
    });
    await withTenant(this.database.prisma, tenant.id, async (tx) => {
      await tx.membership.create({ data: { tenantId: tenant.id, userId: ownerId, status: 'ACTIVE' } });
      for (const roleName of ORGANIZATION_ROLES) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, name: roleName, isSystem: true } });
        await tx.rolePermission.createMany({
          data: SYSTEM_ROLE_PERMISSIONS[roleName].map((permission) => ({ tenantId: tenant.id, roleId: role.id, permission })),
        });
        if (roleName === 'OWNER') {
          await tx.membershipRole.create({ data: { tenantId: tenant.id, userId: ownerId, roleId: role.id } });
        }
      }
    });
    return tenant.id;
  }

  private async memberships(userId: string): Promise<MembershipRow[]> {
    return this.database.prisma.$queryRaw<MembershipRow[]>(
      Prisma.sql`SELECT * FROM public.list_user_memberships(${userId}::uuid)`,
    );
  }

  private async requireActiveMembership(userId: string, tenantId: string): Promise<void> {
    const rows = await this.memberships(userId);
    const allowed = rows.some((row) => row.tenant_id === tenantId && row.membership_status === 'ACTIVE' && row.tenant_status === 'ACTIVE');
    if (!allowed) throw new ApiException(403, 'FORBIDDEN', 'Organization access is not allowed');
  }

  private requireTenant(actor: SessionContext, tenantId: string): void {
    if (actor.tenantId !== tenantId) throw new ApiException(403, 'FORBIDDEN', 'Switch to this organization before changing it');
  }

  private assertGrantable(actor: SessionContext, role: string): void {
    if (!(role in SYSTEM_ROLE_PERMISSIONS)) throw new ApiException(400, 'VALIDATION_ERROR', 'Role is not assignable');
    if (actor.roles.some((name) => isOwner(name))) return;
    const required = SYSTEM_ROLE_PERMISSIONS[role as SystemRole];
    if (required.some((permission) => !actor.permissions.includes(permission))) {
      throw new ApiException(403, 'FORBIDDEN', 'That role would exceed your permissions');
    }
  }

  private async contextFor(sessionId: string): Promise<SessionContext> {
    const session = await this.database.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) throw new ApiException(401, 'UNAUTHORIZED', 'Sign in is required');
    const rows = session.activeTenantId ? (await this.memberships(session.userId)).filter((row) => row.tenant_id === session.activeTenantId) : [];
    const active = rows.filter((row) => row.membership_status === 'ACTIVE' && row.tenant_status === 'ACTIVE');
    const tenantId = active.length ? session.activeTenantId : null;
    const roles = [...new Set(active.map((row) => row.role_name).filter((role): role is string => Boolean(role)))];
    const permissions = tenantId
      ? await withTenant(this.database.prisma, tenantId, async (tx) => {
          const links = await tx.membershipRole.findMany({
            where: { tenantId, userId: session.userId },
            include: { role: { include: { permissions: true } } },
          });
          return [...new Set(links.flatMap((link) => link.role.permissions.map((permission) => permission.permission)))];
        })
      : [];
    return {
      userId: session.userId,
      sessionId: session.id,
      email: decryptField(Buffer.from(session.user.emailCiphertext), this.key),
      displayName: session.user.displayName,
      tenantId,
      permissions,
      roles,
    };
  }

  private async findLiveSession(token: string) {
    const session = await this.database.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now() || session.absoluteExpiresAt.getTime() <= Date.now()) return null;
    return session;
  }

  private async revokeToken(token: string): Promise<void> {
    await this.database.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async recordAttempt(email: string, ipHash: string, succeeded: boolean): Promise<void> {
    const since = new Date(Date.now() - WINDOW_MS);
    await this.database.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
      const [byEmail, byIp] = await Promise.all([
        tx.authAttempt.count({ where: { emailHmac: email, succeeded: false, createdAt: { gte: since } } }),
        tx.authAttempt.count({ where: { ipHash, succeeded: false, createdAt: { gte: since } } }),
      ]);
      if (byEmail >= 5 || byIp >= 100) throw new ApiException(429, 'AUTH_THROTTLED', 'Try again later');
      await tx.authAttempt.create({ data: { emailHmac: email, ipHash, succeeded } });
    });
  }

  private async issueEmailToken(userId: string, hmac: string): Promise<void> {
    const token = newToken();
    await this.database.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_MS) },
    });
    await this.capture('email_verification', hmac, token);
  }

  private async consumeToken(kind: 'email' | 'reset', token: string): Promise<{ userId: string }> {
    const tokenHash = hashToken(token);
    const now = new Date();
    if (kind === 'email') {
      const consumed = await this.database.prisma.emailVerificationToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      const row = await this.database.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (consumed.count === 1 && row) return { userId: row.userId };
      if (!row) throw new ApiException(400, 'TOKEN_INVALID', 'Verification token is not valid');
      if (row.expiresAt.getTime() <= now.getTime()) throw new ApiException(400, 'TOKEN_EXPIRED', 'Verification token has expired');
      throw new ApiException(400, 'TOKEN_USED', 'Verification token is not valid');
    }
    const consumed = await this.database.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const row = await this.database.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (consumed.count === 1 && row) return { userId: row.userId };
    if (!row) throw new ApiException(400, 'TOKEN_INVALID', 'Reset token is not valid');
    if (row.expiresAt.getTime() <= now.getTime()) throw new ApiException(400, 'TOKEN_EXPIRED', 'Reset token has expired');
    throw new ApiException(400, 'TOKEN_USED', 'Reset token is not valid');
  }

  private async capture(kind: string, recipientHmac: string, token: string): Promise<void> {
    if (this.config.env.MAIL_MODE !== 'capture') return;
    await this.database.prisma.capturedMessage.create({ data: { kind, recipientHmac, token } });
  }

  private async security(actorId: string | null, tenantId: string | null, action: string, result: string, requestId: string, metadata: Record<string, string | boolean | null>): Promise<void> {
    await this.database.prisma.securityEvent.create({
      data: { actorId, action, result, requestId, metadata: { ...metadata, tenantId } },
    });
  }

  private async audit(tenantId: string, actorId: string, action: string, entityType: string, entityId: string, requestId: string): Promise<void> {
    await withTenant(this.database.prisma, tenantId, (tx) =>
      tx.auditEvent.create({
        data: {
          tenantId,
          actorType: 'user',
          actorId,
          action,
          entityType,
          entityId,
          payload: { requestId },
        },
      }),
    );
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

function isOwner(role: string): boolean {
  return (OWNER_ROLE_NAMES as readonly string[]).includes(role);
}
