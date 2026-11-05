import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { withTenant } from '@salesos/database';
import { ApiException } from '../common/api.exception';
import { AgentsService } from '../agents/agents.service';
import { IdentityDatabase } from '../identity/identity-database.service';
import type { SessionContext } from '../identity/identity.service';
import { ProductsService } from '../products/products.service';
import type { CreateNavigationDto } from './navigation.dto';

const TTL_MS = 15 * 60 * 1000;
const MAX_LIFE_MS = 2 * 60 * 60 * 1000;
const MAX_CONTEXTS = 20;

const READ_PERMISSION: Record<string, string | null> = {
  member: null,
  organization: null,
  product: 'products.read',
  product_version: 'products.read',
  icp: 'products.read',
  knowledge_document: 'products.read',
  invitation: 'users.invite',
  session: null,
  role: null,
  product_defaults: 'products.read',
  agent: 'agents.read',
  agent_run: 'agents.read',
  automation_policy: 'agents.read',
  model_configuration: 'agents.read',
  agent_approval: 'agents.read',
};

@Injectable()
export class NavigationService {
  constructor(
    @Inject(IdentityDatabase) private readonly identity: IdentityDatabase,
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(AgentsService) private readonly agents: AgentsService,
  ) {}

  async create(actor: SessionContext, input: CreateNavigationDto) {
    const tenantId = this.tenant(actor);
    await this.assertResource(actor, input);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    await withTenant(this.identity.prisma, tenantId, async (tx) => {
      await tx.navigationContext.deleteMany({
        where: { tenantId, sessionId: actor.sessionId, OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }] },
      });
      const active = await tx.navigationContext.findMany({
        where: { tenantId, sessionId: actor.sessionId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const extra = active.slice(0, Math.max(0, active.length - (MAX_CONTEXTS - 1)));
      if (extra.length) {
        await tx.navigationContext.updateMany({
          where: { tenantId, id: { in: extra.map((row) => row.id) } },
          data: { revokedAt: new Date() },
        });
      }
      await tx.navigationContext.create({
        data: {
          tenantId,
          sessionId: actor.sessionId,
          userId: actor.userId,
          tokenHash: hashToken(token),
          resourceType: input.resourceType,
          action: input.action,
          resourceId: input.resourceId,
          parentId: input.parentId,
          resourceKey: input.resourceKey ?? '',
          expiresAt,
        },
      });
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async resolve(actor: SessionContext, token: string) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.identity.prisma, tenantId, (tx) =>
      tx.navigationContext.findFirst({
        where: {
          tenantId,
          tokenHash: hashToken(token),
          sessionId: actor.sessionId,
          userId: actor.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    );
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Navigation context is no longer available');
    await this.assertResource(actor, {
      resourceType: row.resourceType as CreateNavigationDto['resourceType'],
      action: row.action as CreateNavigationDto['action'],
      resourceId: row.resourceId ?? undefined,
      parentId: row.parentId ?? undefined,
      resourceKey: row.resourceKey,
      organizationContext: 'active',
    });
    const expiresAt = new Date(Math.min(Date.now() + TTL_MS, row.createdAt.getTime() + MAX_LIFE_MS));
    await withTenant(this.identity.prisma, tenantId, (tx) =>
      tx.navigationContext.updateMany({
        where: { tenantId, id: row.id, revokedAt: null },
        data: { expiresAt },
      }),
    );
    return {
      resourceType: row.resourceType,
      action: row.action,
      resourceId: row.resourceId,
      parentId: row.parentId,
      resourceKey: row.resourceKey,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async assertResource(actor: SessionContext, input: CreateNavigationDto): Promise<void> {
    if (input.resourceType === 'role' && input.action !== 'view') {
      throw new ApiException(403, 'FORBIDDEN', 'Built-in roles cannot be edited');
    }
    if (input.resourceType === 'session' && input.action === 'add') {
      throw new ApiException(403, 'FORBIDDEN', 'Sessions are revoked rather than created here');
    }
    const permission = input.action === 'view' ? READ_PERMISSION[input.resourceType] : writePermission(input.resourceType, input.action);
    if (permission && !actor.permissions.includes(permission) && !alternate(actor, input, permission)) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    if (input.action === 'add') {
      if (input.resourceType === 'knowledge_document' || input.resourceType === 'icp' || input.resourceType === 'product_version') {
        if (!input.parentId) throw new ApiException(400, 'VALIDATION_ERROR', 'A parent record is required');
        await this.products.get(actor, input.parentId);
      }
      return;
    }
    if (!input.resourceId && input.resourceType !== 'product_defaults' && input.resourceType !== 'role') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'A record is required');
    }
    if (input.resourceType === 'product') await this.products.get(actor, input.resourceId!);
    if (input.resourceType === 'product_version') {
      if (!input.parentId) throw new ApiException(400, 'VALIDATION_ERROR', 'A parent record is required');
      const version = await this.products.getVersion(actor, input.parentId, input.resourceId!);
      if (input.action === 'edit' && version.status !== 'DRAFT') {
        throw new ApiException(409, 'CONFLICT', 'Only a draft version can be edited');
      }
    }
    if (input.resourceType === 'icp') {
      if (!input.parentId) throw new ApiException(400, 'VALIDATION_ERROR', 'A parent record is required');
      await this.products.getIcp(actor, input.parentId, input.resourceId!);
    }
    if (input.resourceType === 'knowledge_document') {
      if (!input.parentId) throw new ApiException(400, 'VALIDATION_ERROR', 'A parent record is required');
      await this.products.document(actor, input.parentId, input.resourceId!);
    }
    if (input.resourceType === 'member') await this.visibleMember(actor, input.resourceId!);
    if (input.resourceType === 'organization' && input.resourceId !== actor.tenantId) {
      throw new ApiException(404, 'NOT_FOUND', 'Organization was not found');
    }
    if (input.resourceType === 'invitation') await this.visibleInvitation(actor, input.resourceId!);
    if (input.resourceType === 'session') await this.visibleSession(actor, input.resourceId!);
    if (input.resourceType === 'role') await this.visibleRole(actor, input.resourceKey ?? '');
    if (input.resourceType === 'product_defaults') await this.products.defaults(actor);
    if (input.resourceType === 'agent') await this.agents.agentRecord(actor, input.resourceId!);
    if (input.resourceType === 'agent_run') await this.agents.runRecord(actor, input.resourceId!);
    if (input.resourceType === 'automation_policy') await this.visiblePolicy(actor, input.resourceId!);
    if (input.resourceType === 'model_configuration') await this.agents.modelRecord(actor, input.resourceId!);
    if (input.resourceType === 'agent_approval') await this.agents.approvalRecord(actor, input.resourceId!);
  }

  private async visibleMember(actor: SessionContext, userId: string): Promise<void> {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.identity.prisma, tenantId, (tx) =>
      tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } }),
    );
    if (!row || row.status === 'REMOVED') throw new ApiException(404, 'NOT_FOUND', 'Member was not found');
  }

  private async visibleInvitation(actor: SessionContext, invitationId: string): Promise<void> {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.identity.prisma, tenantId, (tx) =>
      tx.invitation.findFirst({ where: { tenantId, id: invitationId } }),
    );
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Invitation was not found');
  }

  private async visibleSession(actor: SessionContext, sessionId: string): Promise<void> {
    const row = await this.identity.prisma.session.findFirst({ where: { id: sessionId, userId: actor.userId } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Session was not found');
  }

  private async visiblePolicy(actor: SessionContext, id: string): Promise<void> {
    await this.agents.policyRecord(actor, id);
  }

  private async visibleRole(actor: SessionContext, name: string): Promise<void> {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.identity.prisma, tenantId, (tx) => tx.role.findFirst({ where: { tenantId, name } }));
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Role was not found');
  }

  private tenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }
}

function writePermission(resourceType: string, action: string): string | null {
  if (resourceType === 'member' && action === 'add') return 'users.invite';
  if (resourceType === 'member') return 'roles.manage';
  if (resourceType === 'organization' && action === 'add') return null;
  if (resourceType === 'organization') return 'organizations.manage';
  if (resourceType === 'invitation') return 'users.manage';
  if (resourceType === 'session') return null;
  if (resourceType === 'product' || resourceType === 'product_version' || resourceType === 'icp' || resourceType === 'knowledge_document' || resourceType === 'product_defaults') {
    return 'products.write';
  }
  if (resourceType === 'agent' || resourceType === 'agent_run' || resourceType === 'automation_policy' || resourceType === 'model_configuration') return 'agents.manage';
  if (resourceType === 'agent_approval') return 'approvals.manage';
  return 'settings.manage';
}

function alternate(actor: SessionContext, input: CreateNavigationDto, permission: string): boolean {
  if (input.resourceType === 'member' && permission === 'roles.manage') return actor.permissions.includes('users.manage');
  if (input.resourceType === 'invitation' && permission === 'users.invite') return actor.permissions.includes('users.manage');
  if (input.resourceType === 'invitation' && permission === 'users.manage') return actor.permissions.includes('users.invite');
  if (input.resourceType === 'organization' && permission === 'organizations.manage') return actor.roles.includes('OWNER');
  return false;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
