import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { webhookSignature } from '@salesos/integrations';
import { createPrismaClient } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP)('mailbox infrastructure', () => {
  const webhookSecret = `mailbox-test-secret-${randomUUID()}`;
  process.env.SALESOS_CAPTURE_WEBHOOK_ENABLED = 'true';
  process.env.SALESOS_CAPTURE_WEBHOOK_SECRET = webhookSecret;
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let ownerCookie = '';
  let otherCookie = '';
  let reviewerCookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.SALESOS_CAPTURE_WEBHOOK_ENABLED;
    delete process.env.SALESOS_CAPTURE_WEBHOOK_SECRET;
    await admin.$disconnect();
  });

  it('imports capture mail, keeps providers unconfigured, and does not send', async () => {
    ownerCookie = await login(`box-owner-${stamp}@example.com`, `Mailbox ${stamp}`);
    otherCookie = await login(`box-other-${stamp}@example.com`, `Other ${stamp}`);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', ownerCookie);
    const tenantId = me.body.data.organizationId as string;
    const ownerId = me.body.data.user.id as string;
    reviewerCookie = await login(`box-review-${stamp}@example.com`, `Reviewer home ${stamp}`);
    const reviewer = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', reviewerCookie);
    await admin.membership.create({ data: { tenantId, userId: reviewer.body.data.user.id, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: `Reviewer ${stamp}`, isSystem: false } });
    for (const permission of ['mailbox.read', 'mailbox.review', 'mailbox.send']) {
      await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission } });
    }
    await admin.membershipRole.create({ data: { tenantId, userId: reviewer.body.data.user.id, roleId: role.id } });
    reviewerCookie = pair((await request(app.getHttpServer()).post(`/api/v1/organizations/${tenantId}/switch`).set('Cookie', reviewerCookie).set('x-salesos-csrf', '1').send({})).headers['set-cookie'] as unknown as string[] | undefined, reviewerCookie);

    const providers = await post('/api/v1/management/mailboxes/providers', ownerCookie, {});
    expect(providers.body.data.providers.find((item: { id: string }) => item.id === 'google').status).toBe('NOT_CONFIGURED');
    expect(providers.body.data.liveSend).toBe('NOT CONFIGURED');
    expect(providers.body.data.readiness.google).toBe('NOT_CONFIGURED');
    const overview = await post('/api/v1/management/operations/overview', ownerCookie, { origin: 'REAL_READ_VERIFIED', verified: true });
    expect(overview.status).toBe(200);
    expect(overview.body.data.google).toBe('LIVE GMAIL — NOT CONFIGURED');
    expect(overview.body.data.microsoft).toBe('LIVE MICROSOFT — NOT CONFIGURED');
    expect(overview.body.data.realSync).toBe('REAL READ-ONLY SYNC — NOT TESTED');
    expect(overview.body.data.sending).toBe('SEND DISABLED');
    expect(overview.body.data.liveReadVerified).toBe(0);
    expect((await post('/api/v1/management/operations/overview', reviewerCookie, {})).status).toBe(403);
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!.trim().replace(/\/$/, '');
    const sending = await post('/api/v1/management/email-sending/status', ownerCookie, {});
    expect(sending.body.data.deployment).toBe('SEND DISABLED');
    expect(sending.body.data.sendNow).toBe(false);
    expect(sending.body.data.attachments).toBe('NOT SUPPORTED');
    const sendAuth = await post('/api/v1/management/mailboxes/oauth/send-start', ownerCookie, { provider: 'google', redirectUri: `${origin}/workspace/inbox` });
    expect(sendAuth.body.data.status).toBe('NOT_CONFIGURED');
    expect(sendAuth.body.data.send).toBe(true);
    expect(sendAuth.body.data.sendingEnabled).toBe(false);
    const started = await post('/api/v1/management/mailboxes/oauth/start', ownerCookie, { provider: 'google', redirectUri: `${origin}/workspace/inbox` });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data.status).toBe('NOT_CONFIGURED');
    expect((await post('/api/v1/management/mailboxes/oauth/start', ownerCookie, { provider: 'google', redirectUri: 'https://example.com/workspace/inbox' })).status).toBe(400);

    const mailbox = await post('/api/v1/management/mailboxes/capture', ownerCookie, { address: `inbox-${stamp}@example.com` });
    expect(mailbox.status).toBe(200);
    expect(mailbox.body.data.live).toBe(false);
    expect(mailbox.body.data.label).toBe('MOCK / CAPTURE MODE');
    await admin.mailboxAccess.create({ data: { tenantId, connectionId: mailbox.body.data.id, userId: reviewer.body.data.user.id, accessRole: 'READ' } });
    expect((await post('/api/v1/management/mailboxes/get', otherCookie, { id: mailbox.body.data.id })).status).toBe(404);

    const imported = await post('/api/v1/management/mailbox-sync/import', ownerCookie, {
      connectionId: mailbox.body.data.id,
      messages: [
        { providerMessageId: 'm-1', internetMessageId: '<m-1@example>', sender: 'buyer@example.com', subject: 'Question', html: '<p>Hello</p><script>alert(1)</script>', provenance: 'USER PROVIDED MAIL' },
        { providerMessageId: 'm-1', internetMessageId: '<m-1@example>', sender: 'buyer@example.com', subject: 'Question', text: 'Hello', provenance: 'USER PROVIDED MAIL' },
        { providerMessageId: 'm-2', internetMessageId: '<m-2@example>', inReplyTo: '<m-1@example>', sender: 'buyer@example.com', subject: 'Different subject', text: 'Thanks', provenance: 'USER PROVIDED MAIL' },
        { providerMessageId: 'm-3', internetMessageId: '<m-3@example>', sender: 'other@example.com', subject: 'Other topic', text: 'Unrelated', provenance: 'USER PROVIDED MAIL' },
      ],
    });
    expect(imported.status).toBe(200);
    const threads = await post('/api/v1/management/threads/list', ownerCookie, { page: 1, pageSize: 20 });
    expect(threads.body.data.total).toBe(2);
    const thread = await post('/api/v1/management/threads/get', ownerCookie, { id: threads.body.data.items.find((item: { subject: string }) => item.subject === 'Question').id });
    expect(thread.body.data.messages).toHaveLength(2);
    expect(JSON.stringify(thread.body.data.messages)).not.toContain('<script');
    expect((await post('/api/v1/management/threads/get', otherCookie, { id: thread.body.data.id })).status).toBe(404);

    const draft = await post('/api/v1/management/drafts/save', ownerCookie, { connectionId: mailbox.body.data.id, threadId: thread.body.data.id, subject: 'Reply', body: 'Published details are in the product record.', recipients: ['buyer@example.com'] });
    expect(draft.status).toBe(200);
    expect((await post('/api/v1/management/drafts/submit', ownerCookie, { id: draft.body.data.id })).status).toBe(200);
    expect((await post('/api/v1/management/email-approvals/decide', ownerCookie, { id: draft.body.data.id, decision: 'APPROVED' })).status).toBe(403);
    const approved = await post('/api/v1/management/email-approvals/decide', reviewerCookie, { id: draft.body.data.id, decision: 'APPROVED' });
    expect(approved.status).toBe(200);
    const edited = await post('/api/v1/management/drafts/save', ownerCookie, { id: draft.body.data.id, connectionId: mailbox.body.data.id, subject: 'Reply', body: 'Changed after approval', recipients: ['buyer@example.com'] });
    expect(edited.body.data.status).toBe('DRAFT');
    await post('/api/v1/management/drafts/submit', ownerCookie, { id: draft.body.data.id });
    await post('/api/v1/management/email-approvals/decide', reviewerCookie, { id: draft.body.data.id, decision: 'APPROVED' });
    const sent = await post('/api/v1/management/email-send/run', ownerCookie, { id: draft.body.data.id });
    expect(sent.body.data.sent).toBe(false);
    expect(sent.body.data.state).not.toBe('DELIVERED');
    const forged = await request(app.getHttpServer()).post('/api/v1/mailbox/webhooks/google').send({ eventId: 'x' });
    expect(forged.body.status).toBe('NOT_CONFIGURED');
    const body = JSON.stringify({ tenantId: '22222222-2222-4222-8222-222222222222', connectionId: mailbox.body.data.id, eventId: 'evt-1', status: 'DELIVERED' });
    const signed = await request(app.getHttpServer()).post('/api/v1/mailbox/webhooks/capture').set('x-salesos-signature', webhookSignature(webhookSecret, body)).set('content-type', 'application/json').send(body);
    expect(signed.body.accepted).toBe(true);
    expect(signed.body.status).toBe('RECORDED');
    expect(signed.body.sent).toBe(false);
    const replay = await request(app.getHttpServer()).post('/api/v1/mailbox/webhooks/capture').set('x-salesos-signature', webhookSignature(webhookSecret, body)).set('content-type', 'application/json').send(body);
    expect(replay.body.status).toBe('REPLAY');
    const bad = JSON.stringify({ connectionId: mailbox.body.data.id, eventId: 'evt-2' });
    const forgedSignature = await request(app.getHttpServer()).post('/api/v1/mailbox/webhooks/capture').set('x-salesos-signature', 'forged').set('content-type', 'application/json').send(bad);
    expect(forgedSignature.body.status).toBe('REJECTED');
    expect(ownerId).toBeTruthy();
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password, displayName: email.split('@')[0], organizationName })).status).toBe(202);
    const row = await admin.capturedMessage.findFirst({ where: { kind: 'email_verification' }, orderBy: { createdAt: 'desc' } });
    expect((await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token: row?.token })).status).toBe(204);
    const logged = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
    return pair(logged.headers['set-cookie'] as unknown as string[] | undefined, '');
  }

  function post(path: string, cookie: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-salesos-csrf', '1').send(body);
  }

  function pair(cookies: string[] | undefined, previous: string): string {
    const next = new Map(previous.split('; ').filter(Boolean).map((item) => item.split('=') as [string, string]));
    for (const cookie of cookies ?? []) {
      const [name, value] = cookie.split(';')[0]!.split('=');
      if (name && value) next.set(name, value);
    }
    return [...next.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
});
