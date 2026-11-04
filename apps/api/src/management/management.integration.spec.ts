import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac, encryptField } from '@salesos/database';
import { MEMBER_EMAIL_SEARCH_LIMIT } from '../identity/identity.service';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_IDENTITY || !process.env.DATA_ENCRYPTION_KEY)(
  'management and navigation',
  () => {
    let app: INestApplication;
    const admin = createPrismaClient(process.env.DATABASE_URL as string);
    const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    let ownerCookie = '';
    let otherCookie = '';
    let productId = '';
    let secondProductId = '';

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      await admin.authAttempt.deleteMany();
      ownerCookie = await login(`manage-${stamp}@example.com`, 'Manage Org');
      otherCookie = await login(`manage-other-${stamp}@example.com`, 'Other Manage Org');
    });

    afterAll(async () => {
      await app?.close();
      await admin.$disconnect();
    });

    it('paginates, rejects injected sort fields, and archives only the requested batch', async () => {
      const created = await post('/api/v1/management/products/create').set('Cookie', ownerCookie).send({ name: 'Batch One', productType: 'SOFTWARE' });
      expect(created.status).toBe(201);
      productId = created.body.data.id;
      const second = await post('/api/v1/management/products/create').set('Cookie', ownerCookie).send({ name: 'Batch Two', productType: 'SOFTWARE' });
      secondProductId = second.body.data.id;
      const injected = await post('/api/v1/management/products/list').set('Cookie', ownerCookie).send({ sortBy: 'name; drop table products', sortDirection: 'desc' });
      expect(injected.status).toBe(400);
      const listed = await post('/api/v1/management/products/list').set('Cookie', ownerCookie).send({ q: 'Batch', sortBy: 'name', sortDirection: 'asc', page: 1, pageSize: 10 });
      expect(listed.status).toBe(200);
      expect(listed.body.data.items.map((item: { name: string }) => item.name)).toEqual(['Batch One', 'Batch Two']);
      const foreign = await post('/api/v1/management/products/get').set('Cookie', otherCookie).send({ id: productId });
      expect(foreign.status).toBe(404);
      const duplicate = await post('/api/v1/management/products/bulk-archive').set('Cookie', ownerCookie).send({ ids: [productId, productId] });
      expect(duplicate.status).toBe(400);
      const missing = randomUUID();
      const bulk = await post('/api/v1/management/products/bulk-archive').set('Cookie', ownerCookie).send({ ids: [productId, missing] });
      expect(bulk.status).toBe(200);
      expect(bulk.body.data.results).toEqual([
        { id: productId, ok: true },
        expect.objectContaining({ id: missing, ok: false, code: 'NOT_FOUND' }),
      ]);
      const stale = await post('/api/v1/management/products/update').set('Cookie', ownerCookie).send({ id: secondProductId, name: 'Batch Two', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
      expect(stale.status).toBe(409);
    });

    it('binds navigation contexts to the session and keeps tabs independent', async () => {
      const first = await post('/api/v1/navigation/contexts').set('Cookie', ownerCookie).send({ resourceType: 'product', action: 'edit', resourceId: secondProductId, organizationContext: 'active' });
      expect(first.status).toBe(201);
      expect(first.body.data.token).not.toBe(secondProductId);
      const second = await post('/api/v1/navigation/contexts').set('Cookie', ownerCookie).send({ resourceType: 'product', action: 'view', resourceId: productId, organizationContext: 'active' });
      const resolvedFirst = await post('/api/v1/navigation/contexts/resolve').set('Cookie', ownerCookie).send({ token: first.body.data.token });
      const resolvedSecond = await post('/api/v1/navigation/contexts/resolve').set('Cookie', ownerCookie).send({ token: second.body.data.token });
      expect(resolvedFirst.body.data.resourceId).toBe(secondProductId);
      expect(resolvedSecond.body.data.resourceId).toBe(productId);
      const guessed = await post('/api/v1/navigation/contexts/resolve').set('Cookie', ownerCookie).send({ token: 'a'.repeat(32) });
      expect(guessed.status).toBe(404);
      const version = await post('/api/v1/management/versions/list').set('Cookie', ownerCookie).send({ productId: secondProductId });
      const draftId = version.body.data.items.find((item: { status: string }) => item.status === 'DRAFT').id;
      await post('/api/v1/management/versions/submit').set('Cookie', ownerCookie).send({ productId: secondProductId, id: draftId });
      await post('/api/v1/management/versions/approve').set('Cookie', ownerCookie).send({ productId: secondProductId, id: draftId });
      await post('/api/v1/management/versions/publish').set('Cookie', ownerCookie).send({ productId: secondProductId, id: draftId });
      const immutable = await post('/api/v1/navigation/contexts').set('Cookie', ownerCookie).send({ resourceType: 'product_version', action: 'edit', resourceId: draftId, parentId: secondProductId, organizationContext: 'active' });
      expect(immutable.status).toBe(409);
      const home = await get('/api/v1/auth/me').set('Cookie', ownerCookie);
      const switched = await post('/api/v1/organizations').set('Cookie', ownerCookie).send({ name: `Switch ${stamp}` });
      expect(switched.status).toBe(201);
      expect((await post(`/api/v1/organizations/${switched.body.data.id}/switch`).set('Cookie', ownerCookie)).status).toBe(204);
      const revoked = await post('/api/v1/navigation/contexts/resolve').set('Cookie', ownerCookie).send({ token: first.body.data.token });
      expect(revoked.status).toBe(404);
      expect((await post(`/api/v1/organizations/${home.body.data.organizationId}/switch`).set('Cookie', ownerCookie)).status).toBe(204);
    });

    it('protects the last owner and keeps audit append-only', async () => {
      const members = await post('/api/v1/management/members/list').set('Cookie', ownerCookie).send({ sortBy: 'displayName', sortDirection: 'asc' });
      expect(members.status).toBe(200);
      const owner = members.body.data.items.find((item: { roles: string[] }) => item.roles.includes('OWNER'));
      const removed = await post('/api/v1/management/members/bulk-remove').set('Cookie', ownerCookie).send({ ids: [owner.userId] });
      expect(removed.body.data.results[0]).toEqual(expect.objectContaining({ ok: false, code: 'CONFLICT' }));
      const audit = await post('/api/v1/management/audit/list').set('Cookie', ownerCookie).send({ q: 'product.create', sortBy: 'createdAt', sortDirection: 'desc', page: 1, pageSize: 20 });
      expect(audit.status).toBe(200);
      expect(audit.body.data.items.length).toBeGreaterThan(0);
      const missing = await post('/api/v1/management/audit/update').set('Cookie', ownerCookie).send({ id: audit.body.data.items[0].id });
      expect(missing.status).toBe(404);
    });

    it('returns to the last authorized organization and skips a suspended one', async () => {
      const email = `home-${stamp}@example.com`;
      const cookie = await login(email, 'Home Org');
      const homeId = (await get('/api/v1/auth/me').set('Cookie', cookie)).body.data.organizationId as string;
      const second = await post('/api/v1/organizations').set('Cookie', cookie).send({ name: `Second ${stamp}` });
      expect(second.status).toBe(201);
      const secondId = second.body.data.id as string;
      await post('/api/v1/auth/logout').set('Cookie', cookie);
      const returned = await post('/api/v1/auth/login').send({ email, password });
      expect(returned.status).toBe(200);
      expect(returned.body.data.organizationId).toBe(secondId);
      const again = pair(sessionCookie(returned));
      const third = await post('/api/v1/organizations').set('Cookie', again).send({ name: `Third ${stamp}` });
      const thirdId = third.body.data.id as string;
      expect((await post('/api/v1/management/organizations/update').set('Cookie', again).send({ id: thirdId, status: 'SUSPENDED' })).status).toBe(200);
      await post('/api/v1/auth/logout').set('Cookie', again);
      const skipped = await post('/api/v1/auth/login').send({ email, password });
      expect(skipped.body.data.organizationId).toBe([homeId, secondId].sort()[0]);
      expect(skipped.body.data.organizationId).not.toBe(thirdId);
    });

    it('searches member email without decrypting the whole organization', async () => {
      const email = `directory-${stamp}@example.com`;
      const cookie = await login(email, 'Directory Org');
      const tenantId = (await get('/api/v1/auth/me').set('Cookie', cookie)).body.data.organizationId as string;
      const hiddenId = `ffffffff-ffff-4fff-8fff-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const hiddenEmail = `hidden-${stamp}@example.com`;
      const batch = randomUUID().replaceAll('-', '').slice(0, 7);
      const fillers = Array.from({ length: MEMBER_EMAIL_SEARCH_LIMIT }, (_, index) => {
        const address = `scan-${stamp}-${index}@example.com`;
        return {
          id: `0${batch}-0000-4000-8000-${String(index).padStart(12, '0')}`,
          emailHmac: emailHmac(address, key),
          emailCiphertext: Uint8Array.from(encryptField(address, key)),
          displayName: `Scan ${index}`,
          status: 'ACTIVE',
        };
      });
      await admin.user.createMany({ data: fillers });
      await admin.user.create({
        data: { id: hiddenId, emailHmac: emailHmac(hiddenEmail, key), emailCiphertext: Uint8Array.from(encryptField(hiddenEmail, key)), displayName: 'Zulu Hidden', status: 'ACTIVE' },
      });
      await admin.membership.createMany({
        data: [...fillers.map((item) => item.id), hiddenId].map((userId) => ({ tenantId, userId, status: 'ACTIVE' })),
      });
      const otherCookie = await login(`other-org-${stamp}@example.com`, 'Other Org');
      const otherEmail = `secret-other-${stamp}@example.com`;
      const otherUser = await admin.user.create({
        data: { emailHmac: emailHmac(otherEmail, key), emailCiphertext: Uint8Array.from(encryptField(otherEmail, key)), displayName: 'Other Secret', status: 'ACTIVE' },
      });
      const otherOrg = (await get('/api/v1/auth/me').set('Cookie', otherCookie)).body.data.organizationId as string;
      await admin.membership.create({ data: { tenantId: otherOrg, userId: otherUser.id, status: 'ACTIVE' } });

      const plain = await post('/api/v1/management/members/list').set('Cookie', cookie).send({ page: 1, pageSize: 20, sortBy: 'displayName', sortDirection: 'asc' });
      expect(plain.status).toBe(200);
      expect(plain.body.data.emailSearch).toEqual({ mode: 'none', scanned: plain.body.data.items.length, limit: MEMBER_EMAIL_SEARCH_LIMIT, truncated: false });
      expect(plain.body.data.total).toBeGreaterThan(MEMBER_EMAIL_SEARCH_LIMIT);

      const exact = await post('/api/v1/management/members/list').set('Cookie', cookie).send({ q: hiddenEmail });
      expect(exact.body.data.items.map((item: { email: string }) => item.email)).toContain(hiddenEmail);
      expect(exact.body.data.emailSearch.mode).toBe('exact');
      expect(exact.body.data.emailSearch.truncated).toBe(false);

      const partial = await post('/api/v1/management/members/list').set('Cookie', cookie).send({ q: `hidden-${stamp}` });
      expect(partial.body.data.items.map((item: { email: string }) => item.email)).not.toContain(hiddenEmail);
      expect(partial.body.data.emailSearch.mode).toBe('bounded');
      expect(partial.body.data.emailSearch.scanned).toBeLessThanOrEqual(MEMBER_EMAIL_SEARCH_LIMIT);
      expect(partial.body.data.emailSearch.truncated).toBe(true);

      const named = await post('/api/v1/management/members/list').set('Cookie', cookie).send({ q: 'Zulu Hidden' });
      expect(named.body.data.items.map((item: { displayName: string }) => item.displayName)).toContain('Zulu Hidden');

      const foreign = await post('/api/v1/management/members/list').set('Cookie', cookie).send({ q: otherEmail });
      expect(foreign.body.data.items).toEqual([]);
    });

    it('rejects navigation tokens after expiry, logout, and a later login', async () => {
      const email = `replay-${stamp}@example.com`;
      const cookie = await login(email, 'Replay Org');
      const me = await get('/api/v1/auth/me').set('Cookie', cookie);
      const org = me.body.data.organizationId as string;
      const userId = me.body.data.user.id as string;
      const opened = await post('/api/v1/navigation/contexts').set('Cookie', cookie).send({ resourceType: 'organization', action: 'view', resourceId: org, organizationContext: 'active' });
      expect(opened.status).toBe(201);
      await admin.navigationContext.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await post('/api/v1/navigation/contexts/resolve').set('Cookie', cookie).send({ token: opened.body.data.token })).status).toBe(404);
      const live = await post('/api/v1/navigation/contexts').set('Cookie', cookie).send({ resourceType: 'organization', action: 'view', resourceId: org, organizationContext: 'active' });
      await admin.session.updateMany({ where: { userId, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await post('/api/v1/navigation/contexts/resolve').set('Cookie', cookie).send({ token: live.body.data.token })).status).toBe(401);

      const freshEmail = `logout-${stamp}@example.com`;
      const fresh = await login(freshEmail, 'Logout Org');
      const freshMe = await get('/api/v1/auth/me').set('Cookie', fresh);
      const freshOrg = freshMe.body.data.organizationId as string;
      const token = (await post('/api/v1/navigation/contexts').set('Cookie', fresh).send({ resourceType: 'organization', action: 'view', resourceId: freshOrg, organizationContext: 'active' })).body.data.token as string;
      expect((await post('/api/v1/auth/logout').set('Cookie', fresh)).status).toBe(204);
      expect((await post('/api/v1/navigation/contexts/resolve').set('Cookie', fresh).send({ token })).status).toBe(401);
      const next = await post('/api/v1/auth/login').send({ email: freshEmail, password });
      expect((await post('/api/v1/navigation/contexts/resolve').set('Cookie', pair(sessionCookie(next))).send({ token })).status).toBe(404);
    });

    it('revokes navigation when a member role changes', async () => {
      const ownerEmail = `role-owner-${stamp}@example.com`;
      const memberEmail = `role-member-${stamp}@example.com`;
      const owner = await login(ownerEmail, 'Role Org');
      const org = (await get('/api/v1/auth/me').set('Cookie', owner)).body.data.organizationId as string;
      expect((await post('/api/v1/management/members/invite').set('Cookie', owner).send({ email: memberEmail, role: 'SALES_AGENT' })).status).toBe(202);
      const member = await login(memberEmail, 'Member Org');
      const invitation = await captured('invitation', memberEmail);
      expect((await post('/api/v1/invitations/accept').set('Cookie', member).send({ token: invitation })).status).toBe(200);
      expect((await post(`/api/v1/organizations/${org}/switch`).set('Cookie', member)).status).toBe(204);
      const sessions = await get('/api/v1/auth/sessions').set('Cookie', member);
      const current = sessions.body.data.find((row: { current: boolean; id: string }) => row.current) as { id: string };
      const opened = await post('/api/v1/navigation/contexts').set('Cookie', member).send({ resourceType: 'session', action: 'view', resourceId: current.id, organizationContext: 'active' });
      expect(opened.status).toBe(201);
      const memberId = (await get('/api/v1/auth/me').set('Cookie', member)).body.data.user.id as string;
      expect((await post('/api/v1/management/members/update').set('Cookie', owner).send({ userId: memberId, role: 'VIEWER' })).status).toBe(204);
      expect((await post('/api/v1/navigation/contexts/resolve').set('Cookie', member).send({ token: opened.body.data.token })).status).toBe(401);
    });

    async function login(email: string, organizationName: string): Promise<string> {
      expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Manager', organizationName })).status).toBe(202);
      const token = await captured('email_verification', email);
      expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
      const logged = await post('/api/v1/auth/login').send({ email, password });
      expect(logged.status).toBe(200);
      return pair(sessionCookie(logged));
    }

    async function captured(kind: string, email: string): Promise<string> {
      const row = await admin.capturedMessage.findFirst({ where: { kind, recipientHmac: emailHmac(email, key) }, orderBy: { createdAt: 'desc' } });
      if (!row?.token) throw new Error(`missing ${kind}`);
      return row.token;
    }

    function post(url: string) {
      return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
    }
    function get(url: string) {
      return request(app.getHttpServer()).get(url);
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
