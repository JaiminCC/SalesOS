import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { whatsAppSignature } from '@salesos/shared';
import { createPrismaClient } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

const password = 'correct-horse-battery';
const secret = 'local-whatsapp-api-secret';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP)('whatsapp webhook gate', () => {
  process.env.META_APP_SECRET = secret;
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-value';
  delete process.env.META_APP_ID;
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let cookie = '';

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
    await admin.$disconnect();
  });

  it('rejects a bad signature and reports sending as not authorized', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token-value', 'hub.challenge': 'nope' })).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-value', 'hub.challenge': 'challenge-1' })).text).toBe('challenge-1');
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const missing = await request(app.getHttpServer()).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').send(raw);
    expect(missing.status).toBe(401);
    const altered = await request(app.getHttpServer()).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', whatsAppSignature(secret, Buffer.from(raw))).send(`${raw} `);
    expect(altered.status).toBe(401);
    const exact = '{"object":"whatsapp_business_account","entry":[]}';
    const accepted = await request(app.getHttpServer()).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', whatsAppSignature(secret, Buffer.from(exact))).send(exact);
    expect(accepted.status).toBe(200);
    cookie = await login(`wa-${stamp}@example.com`, `WhatsApp ${stamp}`);
    const overview = await request(app.getHttpServer()).post('/api/v1/management/whatsapp/overview').set('Cookie', cookie).set('x-salesos-csrf', '1').send({});
    expect(overview.status).toBe(200);
    expect(overview.body.data.liveMeta).toBe('LIVE META — NOT CONFIGURED');
    expect(overview.body.data.realWebhook).toBe('REAL WEBHOOK — NOT TESTED');
    expect(overview.body.data.sending).toBe('LIVE WHATSAPP SEND — NOT AUTHORIZED');
    expect(overview.body.data.appReadiness).toBe('NOT_CONFIGURED');
    expect((await request(app.getHttpServer()).post('/api/v1/management/whatsapp/send').set('Cookie', cookie).set('x-salesos-csrf', '1').send({})).status).toBe(404);
    const withSession = await request(app.getHttpServer()).post('/api/v1/webhooks/whatsapp').set('Cookie', cookie).set('content-type', 'application/json').set('x-hub-signature-256', whatsAppSignature(secret, Buffer.from(exact))).send(exact);
    expect(withSession.status).toBe(200);
    expect(withSession.body.error?.code).not.toBe('CSRF_REJECTED');
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password, displayName: 'Owner', organizationName })).status).toBe(202);
    const row = await admin.capturedMessage.findFirst({ where: { kind: 'email_verification' }, orderBy: { createdAt: 'desc' } });
    expect((await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token: row?.token })).status).toBe(204);
    const logged = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
    return (logged.headers['set-cookie'] as unknown as string[] | undefined)?.map((cookie) => cookie.split(';')[0]).join('; ') ?? '';
  }
});
