import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac, withTenant } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { AppConfig } from '../config/app-config';

const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_IDENTITY || !process.env.DATA_ENCRYPTION_KEY)(
  'authorization and session regression',
  () => {
    let app: INestApplication;
    const admin = createPrismaClient(process.env.DATABASE_URL as string);
    const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
    const stamp = `${Date.now()}`;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      await admin.authAttempt.deleteMany();
    });

    afterAll(async () => {
      await app?.close();
      await admin.$disconnect();
    });

    it('blocks a removed member, a downgraded role, a suspended organization, and the last owner', async () => {
      const ownerEmail = `guard-owner-${stamp}@example.com`;
      const adminEmail = `guard-admin-${stamp}@example.com`;
      const viewerEmail = `guard-viewer-${stamp}@example.com`;
      const strangerEmail = `guard-stranger-${stamp}@example.com`;
      await verifiedUser(ownerEmail);
      await verifiedUser(strangerEmail);
      const ownerLogin = await post('/api/v1/auth/login').send({ email: ownerEmail, password });
      const strangerLogin = await post('/api/v1/auth/login').send({ email: strangerEmail, password });
      const ownerCookie = pair(sessionCookie(ownerLogin));
      const strangerCookie = pair(sessionCookie(strangerLogin));
      const org = ownerLogin.body.data.organizationId as string;
      const strangerOrg = strangerLogin.body.data.organizationId as string;

      await verifiedUser(adminEmail);
      await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email: adminEmail, role: 'ADMIN' });
      const adminCookie = await acceptInvitation(adminEmail, org);
      const escalation = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${org}/members/${ownerLogin.body.data.user.id}`)
        .set('Cookie', adminCookie)
        .set('x-salesos-csrf', '1')
        .send({ role: 'OWNER' });
      expect(escalation.status).toBe(403);

      const downgraded = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${org}/members/${(await get('/api/v1/auth/me').set('Cookie', adminCookie)).body.data.user.id}`)
        .set('Cookie', ownerCookie)
        .set('x-salesos-csrf', '1')
        .send({ role: 'VIEWER' });
      expect(downgraded.status).toBe(204);
      expect((await get('/api/v1/auth/me').set('Cookie', adminCookie)).status).toBe(401);
      const adminAgain = await post('/api/v1/auth/login').send({ email: adminEmail, password });
      expect(adminAgain.body.data.permissions).not.toContain('users.manage');
      expect(adminAgain.body.data.permissions).not.toContain('roles.manage');

      await verifiedUser(viewerEmail);
      await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
      const viewerCookie = await acceptInvitation(viewerEmail, org);
      const viewer = await get('/api/v1/auth/me').set('Cookie', viewerCookie);
      const removed = await del(`/api/v1/organizations/${org}/members/${viewer.body.data.user.id}`).set('Cookie', ownerCookie);
      expect(removed.status).toBe(204);
      expect((await get(`/api/v1/organizations/${org}`).set('Cookie', viewerCookie)).status).toBe(401);

      const lastOwner = await del(`/api/v1/organizations/${org}/members/${ownerLogin.body.data.user.id}`).set('Cookie', ownerCookie);
      expect(lastOwner.status).toBe(409);
      expect(lastOwner.body.error.code).toBe('CONFLICT');

      const wrongInvite = await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email: `intended-${stamp}@example.com`, role: 'VIEWER' });
      expect(wrongInvite.status).toBe(202);
      const wrongToken = await captured('invitation', `intended-${stamp}@example.com`);
      const wrongAccept = await post('/api/v1/invitations/accept').set('Cookie', strangerCookie).send({ token: wrongToken });
      expect(wrongAccept.status).toBe(403);
      const stillOpen = await admin.invitation.findFirst({ where: { tokenHash: hash(wrongToken) } });
      expect(stillOpen?.acceptedAt).toBeNull();

      const hiddenAudit = await get(`/api/v1/organizations/${org}/audit`).set('Cookie', strangerCookie);
      expect(hiddenAudit.status).toBe(403);
      const ownAudit = await get(`/api/v1/organizations/${strangerOrg}/audit`).set('Cookie', strangerCookie);
      expect(ownAudit.status).toBe(200);
      const switchedAway = await post(`/api/v1/organizations/${org}/switch`).set('Cookie', strangerCookie);
      expect(switchedAway.status).toBe(403);

      const second = await post('/api/v1/organizations').set('Cookie', ownerCookie).send({ name: `Suspended ${stamp}` });
      const suspendedId = second.body.data.id as string;
      const suspended = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${suspendedId}`)
        .set('Cookie', ownerCookie)
        .set('x-salesos-csrf', '1')
        .send({ status: 'SUSPENDED' });
      expect(suspended.status).toBe(200);
      expect((await get(`/api/v1/organizations/${suspendedId}`).set('Cookie', ownerCookie)).status).toBe(403);
      expect((await post(`/api/v1/organizations/${suspendedId}/switch`).set('Cookie', ownerCookie)).status).toBe(403);
      const back = await post(`/api/v1/organizations/${org}/switch`).set('Cookie', ownerCookie);
      expect(back.status).toBe(204);
    });

    it('revokes one device without revoking the other and rejects expired sessions', async () => {
      const email = `devices-${stamp}@example.com`;
      await verifiedUser(email);
      const first = await post('/api/v1/auth/login').set('User-Agent', 'Device-One').send({ email, password });
      const second = await post('/api/v1/auth/login').set('User-Agent', 'Device-Two').send({ email, password });
      const firstCookie = pair(sessionCookie(first));
      const secondCookie = pair(sessionCookie(second));
      const sessions = await get('/api/v1/auth/sessions').set('Cookie', firstCookie);
      const other = sessions.body.data.find((row: { current: boolean; id: string }) => !row.current) as { id: string };
      const [once, twice] = await Promise.all([
        del(`/api/v1/auth/sessions/${other.id}`).set('Cookie', firstCookie),
        del(`/api/v1/auth/sessions/${other.id}`).set('Cookie', firstCookie),
      ]);
      expect([once.status, twice.status].every((status) => status === 204 || status === 404)).toBe(true);
      expect((await get('/api/v1/auth/me').set('Cookie', secondCookie)).status).toBe(401);
      expect((await get('/api/v1/auth/me').set('Cookie', firstCookie)).status).toBe(200);

      const live = await admin.session.findFirst({ where: { tokenHash: hash(firstCookie.split('=')[1] ?? '') } });
      await admin.session.update({ where: { id: live!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await get('/api/v1/auth/me').set('Cookie', firstCookie)).status).toBe(401);
      await admin.session.update({
        where: { id: live!.id },
        data: { expiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      expect((await get('/api/v1/auth/me').set('Cookie', firstCookie)).status).toBe(401);
    });

    it('accepts a same-origin mutation and rejects missing, invalid, foreign, and malformed origins', async () => {
      const email = `csrf-${stamp}@example.com`;
      await verifiedUser(email);
      const login = await post('/api/v1/auth/login').send({ email, password });
      const cookie = pair(sessionCookie(login));
      const org = login.body.data.organizationId as string;
      const allowed = app.get(AppConfig).env.WEB_ORIGIN.split(',')[0]?.trim() ?? '';
      const send = (origin?: string, csrf?: string) => {
        const call = request(app.getHttpServer()).post(`/api/v1/organizations/${org}/switch`).set('Cookie', cookie);
        if (csrf !== undefined) call.set('x-salesos-csrf', csrf);
        if (origin !== undefined) call.set('Origin', origin);
        return call;
      };
      expect((await send(undefined, '1')).status).toBe(204);
      expect((await send('not a url', '1')).status).toBe(403);
      expect((await send('null', '1')).status).toBe(403);
      expect((await send('http://evil.example', '1')).status).toBe(403);
      expect((await send(`${allowed}/extra`, '1')).status).toBe(403);
      expect((await send(allowed)).status).toBe(403);
      expect((await send(allowed, 'no')).status).toBe(403);
      expect((await send(allowed, '1')).status).toBe(204);
    });

    it('returns only the active organization role grants and blocks them after removal or suspension', async () => {
      const ownerEmail = `matrix-owner-${stamp}@example.com`;
      const otherEmail = `matrix-other-${stamp}@example.com`;
      const viewerEmail = `matrix-viewer-${stamp}@example.com`;
      await verifiedUser(ownerEmail);
      await verifiedUser(otherEmail);
      const ownerLogin = await post('/api/v1/auth/login').send({ email: ownerEmail, password });
      const otherLogin = await post('/api/v1/auth/login').send({ email: otherEmail, password });
      const ownerCookie = pair(sessionCookie(ownerLogin));
      const otherCookie = pair(sessionCookie(otherLogin));
      const org = ownerLogin.body.data.organizationId as string;
      const otherOrg = otherLogin.body.data.organizationId as string;
      await withTenant(admin, otherOrg, async (tx) => {
        const role = await tx.role.create({ data: { tenantId: otherOrg, name: 'Reviewer', isSystem: true } });
        await tx.rolePermission.create({ data: { tenantId: otherOrg, roleId: role.id, permission: 'leads.read' } });
      });

      const own = await get('/api/v1/roles').set('Cookie', ownerCookie);
      expect(own.status).toBe(200);
      const ownNames = own.body.data.map((role: { name: string }) => role.name);
      expect(ownNames).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'VIEWER']));
      expect(ownNames).not.toContain('Reviewer');
      expect(ownNames).not.toContain('Manager');
      const ownerRole = own.body.data.find((role: { name: string }) => role.name === 'OWNER') as { permissions: string[] };
      const viewerRole = own.body.data.find((role: { name: string }) => role.name === 'VIEWER') as { permissions: string[] };
      expect(ownerRole.permissions).toContain('tenant.export');
      expect(viewerRole.permissions).not.toContain('users.manage');
      expect(viewerRole.permissions).not.toContain('roles.manage');
      expect(viewerRole.permissions).not.toContain('tenant.export');

      const other = await get('/api/v1/roles').set('Cookie', otherCookie);
      expect(other.status).toBe(200);
      expect(other.body.data.map((role: { name: string }) => role.name)).toContain('Reviewer');
      const catalog = await get('/api/v1/permissions').set('Cookie', ownerCookie);
      expect(catalog.status).toBe(200);
      expect(catalog.body.data).toContain('tenant.export');
      expect(catalog.body.data).not.toContain('browser.granted');

      await verifiedUser(viewerEmail);
      await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
      const viewerCookie = await acceptInvitation(viewerEmail, org);
      const viewer = await get('/api/v1/auth/me').set('Cookie', viewerCookie);
      const escalate = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${org}/members/${ownerLogin.body.data.user.id}`)
        .set('Cookie', viewerCookie)
        .set('x-salesos-csrf', '1')
        .send({ role: 'OWNER' });
      expect(escalate.status).toBe(403);
      const visible = await get('/api/v1/roles').set('Cookie', viewerCookie);
      expect(visible.status).toBe(200);
      expect((visible.body.data.find((role: { name: string }) => role.name === 'VIEWER') as { permissions: string[] }).permissions).not.toContain('users.manage');

      expect((await del(`/api/v1/organizations/${org}/members/${viewer.body.data.user.id}`).set('Cookie', ownerCookie)).status).toBe(204);
      expect((await get('/api/v1/roles').set('Cookie', viewerCookie)).status).toBe(401);
      expect((await get('/api/v1/permissions').set('Cookie', viewerCookie)).status).toBe(401);

      const second = await post('/api/v1/organizations').set('Cookie', ownerCookie).send({ name: `Matrix suspended ${stamp}` });
      const suspendedId = second.body.data.id as string;
      const suspended = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${suspendedId}`)
        .set('Cookie', ownerCookie)
        .set('x-salesos-csrf', '1')
        .send({ status: 'SUSPENDED' });
      expect(suspended.status).toBe(200);
      expect((await get('/api/v1/roles').set('Cookie', ownerCookie)).status).toBe(409);
      expect((await get('/api/v1/permissions').set('Cookie', ownerCookie)).status).toBe(409);
    });

    it('serializes failed logins, invitation acceptance, owner transfer, and reset tokens', async () => {
      const email = `race-login-${stamp}@example.com`;
      await verifiedUser(email);
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () => post('/api/v1/auth/login').send({ email, password: 'wrong-password-1' })),
      );
      const rejected = attempts.filter((item) => item.status === 401);
      const throttled = attempts.filter((item) => item.status === 429);
      expect(rejected.length).toBeLessThanOrEqual(5);
      expect(throttled.length).toBeGreaterThan(0);
      const stored = await admin.authAttempt.count({ where: { emailHmac: emailHmac(email, key), succeeded: false } });
      expect(stored).toBeLessThanOrEqual(5);

      const ownerEmail = `race-owner-${stamp}@example.com`;
      const firstAdmin = `race-admin-a-${stamp}@example.com`;
      const secondAdmin = `race-admin-b-${stamp}@example.com`;
      await verifiedUser(ownerEmail);
      const ownerLogin = await post('/api/v1/auth/login').send({ email: ownerEmail, password });
      const ownerCookie = pair(sessionCookie(ownerLogin));
      const org = ownerLogin.body.data.organizationId as string;
      const firstId = await member(ownerCookie, org, firstAdmin);
      const secondId = await member(ownerCookie, org, secondAdmin);
      const invitee = `race-invite-${stamp}@example.com`;
      await verifiedUser(invitee);
      await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email: invitee, role: 'VIEWER' });
      const token = await captured('invitation', invitee);
      const inviteeLogin = await post('/api/v1/auth/login').send({ email: invitee, password });
      const inviteeCookie = pair(sessionCookie(inviteeLogin));
      const accepted = await Promise.all([
        post('/api/v1/invitations/accept').set('Cookie', inviteeCookie).send({ token }),
        post('/api/v1/invitations/accept').set('Cookie', inviteeCookie).send({ token }),
      ]);
      expect(accepted.filter((item) => item.status === 200)).toHaveLength(1);
      expect(accepted.filter((item) => item.body.error?.code === 'TOKEN_USED')).toHaveLength(1);

      const transfers = await Promise.all([
        post(`/api/v1/organizations/${org}/owner-transfer`).set('Cookie', ownerCookie).send({ userId: firstId, password }),
        post(`/api/v1/organizations/${org}/owner-transfer`).set('Cookie', ownerCookie).send({ userId: secondId, password }),
      ]);
      expect(transfers.filter((item) => item.status === 204)).toHaveLength(1);
      const owners = await withTenant(admin, org, (tx) =>
        tx.membershipRole.findMany({ where: { tenantId: org, role: { name: 'OWNER' } } }),
      );
      expect(owners).toHaveLength(1);

      const resetEmail = `race-reset-${stamp}@example.com`;
      await verifiedUser(resetEmail);
      await post('/api/v1/auth/forgot-password').send({ email: resetEmail });
      const resetToken = await captured('password_reset', resetEmail);
      const resets = await Promise.all([
        post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'replacement-pass' }),
        post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'replacement-pass' }),
      ]);
      expect(resets.filter((item) => item.status === 204)).toHaveLength(1);
      expect(resets.filter((item) => item.body.error?.code === 'TOKEN_USED')).toHaveLength(1);

      const [crossA, crossB, homeA, homeB] = await Promise.all([
        get(`/api/v1/organizations/${org}/audit`).set('Cookie', inviteeCookie),
        get(`/api/v1/organizations/${ownerLogin.body.data.organizationId}/members`).set('Cookie', pair(sessionCookie(await post('/api/v1/auth/login').send({ email: resetEmail, password: 'replacement-pass' })))),
        get(`/api/v1/organizations/${org}`).set('Cookie', ownerCookie),
        get('/api/v1/auth/me').set('Cookie', inviteeCookie),
      ]);
      expect(crossA.status).toBe(403);
      expect(crossB.status).toBe(403);
      expect(homeA.status).toBe(401);
      expect(homeB.status).toBe(200);
    });

    async function member(ownerCookie: string, org: string, email: string): Promise<string> {
      await verifiedUser(email);
      await post(`/api/v1/organizations/${org}/invitations`).set('Cookie', ownerCookie).send({ email, role: 'ADMIN' });
      const cookie = await acceptInvitation(email, org);
      const me = await get('/api/v1/auth/me').set('Cookie', cookie);
      return me.body.data.user.id as string;
    }

    async function verifiedUser(email: string): Promise<void> {
      expect((await post('/api/v1/auth/register').send({
        email,
        password,
        displayName: email.split('@')[0],
        organizationName: `${email.split('@')[0]} org`,
      })).status).toBe(202);
      const token = await captured('email_verification', email);
      expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    }

    async function acceptInvitation(email: string, organizationId: string): Promise<string> {
      const token = await captured('invitation', email);
      const login = await post('/api/v1/auth/login').send({ email, password });
      const cookie = pair(sessionCookie(login));
      expect((await post('/api/v1/invitations/accept').set('Cookie', cookie).send({ token })).status).toBe(200);
      expect((await post(`/api/v1/organizations/${organizationId}/switch`).set('Cookie', cookie)).status).toBe(204);
      return cookie;
    }

    async function captured(kind: string, email: string): Promise<string> {
      const row = await admin.capturedMessage.findFirst({
        where: { kind, recipientHmac: emailHmac(email, key) },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) throw new Error(`missing captured ${kind}`);
      return row.token;
    }

    function post(url: string) {
      return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
    }

    function get(url: string) {
      return request(app.getHttpServer()).get(url);
    }

    function del(url: string) {
      return request(app.getHttpServer()).delete(url).set('x-salesos-csrf', '1');
    }
  },
);

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('session cookie missing');
  return value;
}

function pair(cookie: string): string {
  return cookie.split(';')[0] ?? cookie;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
