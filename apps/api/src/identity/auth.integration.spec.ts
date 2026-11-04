import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac, withTenant } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { DatabaseService } from '../database/database.service';
import { hashPassword, verifyPassword } from './passwords';

const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_IDENTITY || !process.env.DATA_ENCRYPTION_KEY)(
  'authentication and tenancy',
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

    it('registers, verifies, and rejects a wrong password', async () => {
      const email = `owner-${stamp}@example.com`;
      const created = await post('/api/v1/auth/register').send({
        email,
        password,
        displayName: 'Owner',
        organizationName: 'Owner Org',
      });
      expect(created.status).toBe(202);
      const user = await admin.user.findUnique({ where: { emailHmac: emailHmac(email, key) } });
      expect(user?.status).toBe('PENDING_VERIFICATION');
      expect(user?.passwordHash?.startsWith('$argon2id$')).toBe(true);
      expect(user?.passwordHash).not.toContain(password);
      expect(await verifyPassword(user!.passwordHash!, password)).toBe(true);

      const unverified = await post('/api/v1/auth/login').send({ email, password });
      expect(unverified.status).toBe(401);
      expect(unverified.body.error.code).toBe('INVALID_CREDENTIALS');

      const token = await captured('email_verification', email);
      const verified = await post('/api/v1/auth/verify-email').send({ token });
      expect(verified.status).toBe(204);
      const reused = await post('/api/v1/auth/verify-email').send({ token });
      expect(reused.body.error.code).toBe('TOKEN_USED');

      const wrong = await post('/api/v1/auth/login').send({ email, password: 'not-the-password' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      const unknown = await post('/api/v1/auth/login').send({ email: `missing-${stamp}@example.com`, password });
      expect(unknown.status).toBe(401);
      expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('expires and refuses reuse of a password reset token', async () => {
      const email = `reset-${stamp}@example.com`;
      await verifiedUser(email);
      await post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
      await post('/api/v1/auth/forgot-password').send({ email });
      const expired = await captured('password_reset', email);
      await admin.passwordResetToken.update({ where: { tokenHash: hash(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expiredResponse = await post('/api/v1/auth/reset-password').send({ token: expired, password: 'replacement-pass' });
      expect(expiredResponse.body.error.code).toBe('TOKEN_EXPIRED');

      await post('/api/v1/auth/forgot-password').send({ email });
      const token = await captured('password_reset', email);
      const first = await post('/api/v1/auth/reset-password').send({ token, password: 'replacement-pass' });
      expect(first.status).toBe(204);
      const second = await post('/api/v1/auth/reset-password').send({ token, password: 'replacement-pass' });
      expect(second.body.error.code).toBe('TOKEN_USED');
      const login = await post('/api/v1/auth/login').send({ email, password: 'replacement-pass' });
      expect(login.status).toBe(200);
    });

    it('rotates the session, revokes it, and requires the cookie', async () => {
      const email = `session-${stamp}@example.com`;
      await verifiedUser(email);
      const denied = await get('/api/v1/auth/me');
      expect(denied.status).toBe(401);

      const first = await post('/api/v1/auth/login').send({ email, password, remember: true });
      const firstCookie = sessionCookie(first);
      expect(firstCookie).toMatch(/HttpOnly/i);
      expect(firstCookie).toMatch(/SameSite=Lax/i);
      const rotated = await post('/api/v1/auth/login').set('Cookie', pair(firstCookie)).send({ email, password, remember: false });
      const rotatedCookie = sessionCookie(rotated);
      const oldSession = await get('/api/v1/auth/me').set('Cookie', pair(firstCookie));
      expect(oldSession.status).toBe(401);
      const current = await get('/api/v1/auth/me').set('Cookie', pair(rotatedCookie));
      expect(current.status).toBe(200);
      expect(current.body.data.user.email).toBe(email);

      const sessions = await get('/api/v1/auth/sessions').set('Cookie', pair(rotatedCookie));
      const currentId = sessions.body.data.find((row: { current: boolean }) => row.current).id as string;
      const missingCsrf = await request(app.getHttpServer()).delete(`/api/v1/auth/sessions/${currentId}`).set('Cookie', pair(rotatedCookie));
      expect(missingCsrf.status).toBe(403);
      expect(missingCsrf.body.error.code).toBe('CSRF_REJECTED');
      const revoked = await del(`/api/v1/auth/sessions/${currentId}`).set('Cookie', pair(rotatedCookie));
      expect(revoked.status).toBe(204);
      const after = await get('/api/v1/auth/me').set('Cookie', pair(rotatedCookie));
      expect(after.status).toBe(401);

      const stored = await admin.session.findFirst({ where: { user: { emailHmac: emailHmac(email, key) } }, orderBy: { createdAt: 'desc' } });
      expect(stored?.tokenHash).not.toContain(pair(rotatedCookie).split('=')[1] ?? 'token');
      const event = await admin.securityEvent.findFirst({ where: { actorId: stored?.userId, action: 'auth.login', result: 'accepted' } });
      expect(event?.requestId).toBeTruthy();
      expect(JSON.stringify(event?.metadata)).not.toContain(password);
    });

    it('isolates two organizations, blocks escalation, and drops removed members', async () => {
      const ownerEmail = `tenant-owner-${stamp}@example.com`;
      const otherEmail = `tenant-other-${stamp}@example.com`;
      const adminEmail = `tenant-admin-${stamp}@example.com`;
      const viewerEmail = `tenant-viewer-${stamp}@example.com`;
      await verifiedUser(ownerEmail);
      await verifiedUser(otherEmail);
      const ownerLogin = await post('/api/v1/auth/login').send({ email: ownerEmail, password });
      const otherLogin = await post('/api/v1/auth/login').send({ email: otherEmail, password });
      const ownerCookie = pair(sessionCookie(ownerLogin));
      const otherCookie = pair(sessionCookie(otherLogin));
      const ownerOrg = ownerLogin.body.data.organizationId as string;
      const otherOrg = otherLogin.body.data.organizationId as string;

      const own = await get(`/api/v1/organizations/${otherOrg}`).set('Cookie', otherCookie);
      expect(own.status).toBe(200);
      const cross = await get(`/api/v1/organizations/${otherOrg}`).set('Cookie', ownerCookie);
      expect(cross.status).toBe(403);
      const crossSwitch = await post(`/api/v1/organizations/${otherOrg}/switch`).set('Cookie', ownerCookie);
      expect(crossSwitch.status).toBe(403);

      const created = await post('/api/v1/organizations').set('Cookie', ownerCookie).send({ name: 'Second Org' });
      expect(created.status).toBe(201);
      const listed = await get('/api/v1/organizations').set('Cookie', ownerCookie);
      expect(listed.body.data).toHaveLength(2);
      await post(`/api/v1/organizations/${ownerOrg}/switch`).set('Cookie', ownerCookie);
      const switched = await get('/api/v1/auth/me').set('Cookie', ownerCookie);
      expect(switched.body.data.organizationId).toBe(ownerOrg);

      await verifiedUser(adminEmail);
      await post(`/api/v1/organizations/${ownerOrg}/invitations`).set('Cookie', ownerCookie).send({ email: adminEmail, role: 'ADMIN' });
      const adminCookie = await acceptInvitation(adminEmail, ownerOrg);
      const escalation = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${ownerOrg}/members/${ownerLogin.body.data.user.id}`)
        .set('Cookie', adminCookie)
        .set('x-salesos-csrf', '1')
        .send({ role: 'OWNER' });
      expect(escalation.status).toBe(403);

      await verifiedUser(viewerEmail);
      await post(`/api/v1/organizations/${ownerOrg}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
      const expiredToken = await captured('invitation', viewerEmail);
      await admin.$executeRaw`UPDATE public.invitations SET expires_at = now() - interval '1 minute' WHERE token_hash = ${hash(expiredToken)}`;
      const viewerLogin = await post('/api/v1/auth/login').send({ email: viewerEmail, password });
      const expired = await post('/api/v1/invitations/accept').set('Cookie', pair(sessionCookie(viewerLogin))).send({ token: expiredToken });
      expect(expired.body.error.code).toBe('TOKEN_EXPIRED');

      await post(`/api/v1/organizations/${ownerOrg}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
      const viewerCookie = await acceptInvitation(viewerEmail, ownerOrg);
      const viewer = await get('/api/v1/auth/me').set('Cookie', viewerCookie);
      const removed = await del(`/api/v1/organizations/${ownerOrg}/members/${viewer.body.data.user.id}`).set('Cookie', ownerCookie);
      expect(removed.status).toBe(204);
      const fresh = await post('/api/v1/auth/login').send({ email: viewerEmail, password });
      const deniedOrg = await get(`/api/v1/organizations/${ownerOrg}`).set('Cookie', pair(sessionCookie(fresh)));
      expect(deniedOrg.status).toBe(403);
    });

    it('throttles repeated failures and records an audit row', async () => {
      const email = `throttle-${stamp}@example.com`;
      await verifiedUser(email);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await post('/api/v1/auth/login').send({ email, password: 'wrong-password-1' });
        expect(failed.status).toBe(401);
      }
      const throttled = await post('/api/v1/auth/login').send({ email, password });
      expect(throttled.status).toBe(429);
      expect(throttled.body.error.code).toBe('AUTH_THROTTLED');
    });

    it('returns no tenant rows without context and does not keep context on the pool', async () => {
      const database = app.get(DatabaseService).prisma;
      expect(await database.membership.findMany()).toEqual([]);
      const tenant = '11111111-1111-4111-8111-111111111111';
      const visible = await withTenant(database, tenant, (tx) => tx.membership.findMany());
      expect(visible.every((row) => row.tenantId === tenant)).toBe(true);
      expect(await database.membership.findMany()).toEqual([]);
    });

    async function verifiedUser(email: string): Promise<void> {
      const created = await post('/api/v1/auth/register').send({
        email,
        password,
        displayName: email.split('@')[0],
        organizationName: `${email.split('@')[0]} org`,
      });
      expect(created.status).toBe(202);
      const token = await captured('email_verification', email);
      expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    }

    async function acceptInvitation(email: string, organizationId: string): Promise<string> {
      const token = await captured('invitation', email);
      const login = await post('/api/v1/auth/login').send({ email, password });
      const cookie = pair(sessionCookie(login));
      const accepted = await post('/api/v1/invitations/accept').set('Cookie', cookie).send({ token });
      expect(accepted.status).toBe(200);
      const switched = await post(`/api/v1/organizations/${organizationId}/switch`).set('Cookie', cookie);
      expect(switched.status).toBe(204);
      return cookie;
    }

    async function captured(kind: string, email: string): Promise<string> {
      const row = await admin.capturedMessage.findFirst({
        where: { kind, recipientHmac: emailHmac(email, key) },
        orderBy: { createdAt: 'desc' },
      });
      expect(row?.token).toBeTruthy();
      return row!.token;
    }

    function post(url: string) {
      return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
    }

    function get(url: string) {
      return request(app.getHttpServer()).get(url).set('x-salesos-csrf', '1');
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

describe('password hashing', () => {
  it('uses argon2id and rejects a different password', async () => {
    const stored = await hashPassword('a-long-password');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'a-long-password')).toBe(true);
    expect(await verifyPassword(stored, 'another-password')).toBe(false);
  });
});
