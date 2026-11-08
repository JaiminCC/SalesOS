import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

process.env.SALESOS_PROCESS_AGENTS = 'inline';
const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP || !process.env.DATA_ENCRYPTION_KEY)('campaign management', () => {
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let ownerCookie = '';
  let otherCookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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

  it('keeps a prepared campaign inside the organization and does not send', async () => {
    ownerCookie = await login(`campaign-api-${stamp}@example.com`, 'Campaign API Org');
    otherCookie = await login(`campaign-api-other-${stamp}@example.com`, 'Campaign API Other');
    const created = await post('/api/v1/management/campaigns/create').set('Cookie', ownerCookie).send({ name: `Introduction ${stamp}`, goal: 'Prepare a draft', timeZone: 'UTC' });
    expect(created.status).toBe(200);
    expect(created.body.data.sendingStatus).toBe('NOT_AUTHORIZED');
    expect(created.body.data.liveDelivery).toBe(false);
    expect(created.body.data.state).toBe('DRAFT');
    const hidden = await post('/api/v1/management/campaigns/get').set('Cookie', otherCookie).send({ id: created.body.data.id });
    expect(hidden.status).toBe(404);
    const foreignList = await post('/api/v1/management/campaigns/list').set('Cookie', otherCookie).send({ q: stamp });
    expect(foreignList.body.data.total).toBe(0);
    const ownList = await post('/api/v1/management/campaigns/list').set('Cookie', ownerCookie).send({ q: stamp });
    expect(ownList.body.data.total).toBe(1);
    const metrics = await post('/api/v1/management/campaign-analytics/summary').set('Cookie', ownerCookie).send({});
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.external.sent).toBe('NOT_AVAILABLE');
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', ownerCookie);
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId: me.body.data.organizationId } })).toBe(0);
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: email.split('@')[0], organizationName })).status).toBe(202);
    const token = await captured(email);
    expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    const logged = await post('/api/v1/auth/login').send({ email, password });
    expect(logged.status).toBe(200);
    return pair(sessionCookie(logged));
  }

  async function captured(email: string): Promise<string> {
    const row = await admin.capturedMessage.findFirst({ where: { kind: 'email_verification', recipientHmac: emailHmac(email, key) }, orderBy: { createdAt: 'desc' } });
    if (!row?.token) throw new Error('missing verification');
    return row.token;
  }

  function post(url: string) {
    return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
  }
});

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('session cookie missing');
  return value;
}

function pair(cookie: string): string {
  return cookie.split(';')[0] ?? cookie;
}
