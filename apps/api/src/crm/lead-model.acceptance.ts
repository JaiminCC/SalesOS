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

describe('real Ollama lead qualification', () => {
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);

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

  it('explains the official 65/100 score with the saved local model and does not change it', async () => {
    const saved = await admin.modelConfiguration.findFirst({ where: { provider: 'ollama', enabled: true }, orderBy: { createdAt: 'desc' } });
    expect(saved?.model).toBeTruthy();
    expect(saved?.baseUrl).toBeTruthy();
    const stamp = randomUUID().slice(0, 8);
    const email = `ollama-lead-${stamp}@example.com`;
    const cookie = await login(email, `Ollama Lead ${stamp}`);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    const tenantId = me.body.data.organizationId as string;
    const userId = me.body.data.user.id as string;
    const inserted = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO products (tenant_id, name, product_type, created_by, updated_by)
      VALUES (${tenantId}::uuid, 'Field Kit', 'PHYSICAL', ${userId}::uuid, ${userId}::uuid)
      RETURNING id`;
    await admin.productVersion.create({
      data: {
        tenantId,
        productId: inserted[0]!.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        snapshot: { icps: [{ id: randomUUID(), name: 'Field operators', priority: 1, industries: ['Logistics'], countries: ['US'], companySizes: ['51-200'] }] },
        publishedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const account = await post('/api/v1/management/accounts/create').set('Cookie', cookie).send({
      legalName: 'Northwind Logistics', website: 'https://northwind.example', industry: 'Logistics', country: 'US', sizeRange: '51-200', description: 'Needs offline barcode capture',
    });
    const lead = await post('/api/v1/management/leads/create').set('Cookie', cookie).send({ accountId: account.body.data.id, productId: inserted[0]!.id, sourceType: 'manual' });
    const model = await post('/api/v1/management/models/create').set('Cookie', cookie).send({
      name: saved!.name,
      provider: 'ollama',
      model: saved!.model,
      baseUrl: saved!.baseUrl,
      allowPrivateHttp: true,
    });
    expect(model.status).toBe(201);
    const explained = await post('/api/v1/management/qualification/run').set('Cookie', cookie).send({ id: lead.body.data.id, modelConfigurationId: model.body.data.id });
    expect(explained.status, JSON.stringify(explained.body)).toBe(200);
    expect(explained.body.data.score).toBe(65);
    expect(explained.body.data.grade).toBe('B');
    expect(explained.body.data.externalSend).toBe(false);
    expect(['model', 'deterministic']).toContain(explained.body.data.explanationSource);
    const inspected = await post('/api/v1/management/runs/get').set('Cookie', cookie).send({ id: explained.body.data.runId });
    expect(inspected.body.data.modelProvider).toBe('ollama');
    expect(inspected.body.data.modelName).toBe(saved!.model);
    expect(inspected.body.data.report.officialScore).toBe(65);
    expect(inspected.body.data.usage.length).toBeGreaterThan(0);
    expect(inspected.body.data.usage.every((row: { provider: string; model: string }) => row.provider === 'ollama' && row.model === saved!.model)).toBe(true);
    expect(inspected.body.data.actions).toEqual([]);
    expect(inspected.body.data.tools).toHaveLength(9);
    const stored = await admin.crmQualification.findFirst({ where: { tenantId, leadId: lead.body.data.id }, orderBy: { createdAt: 'desc' } });
    const dimensions = stored?.dimensions as Array<{ name: string; fit: string }>;
    expect(stored?.score).toBe(65);
    expect(stored?.grade).toBe('B');
    expect(stored?.explanation).toContain('buyer');
    if (stored?.modelProvider) {
      expect(explained.body.data.explanationSource).toBe('model');
      expect(stored.modelProvider).toBe('ollama');
      expect(stored.modelName).toBe(saved!.model);
      expect(stored.explanation).toMatch(/\?/);
    } else {
      expect(explained.body.data.explanationSource).toBe('deterministic');
      expect(stored?.explanation).toContain('INSUFFICIENT_EXPLANATION');
    }
    expect(dimensions.find((item) => item.name === 'buyer')?.fit).toBe('UNKNOWN');
    expect(dimensions.find((item) => item.name === 'trigger')?.fit).toBe('UNKNOWN');
    expect(dimensions.find((item) => item.name === 'technology')?.fit).toBe('UNKNOWN');
    const company = await admin.crmAccount.findFirst({ where: { tenantId, id: account.body.data.id } });
    expect(company?.employeeStatus).toBe('UNKNOWN');
    expect(company?.revenueStatus).toBe('UNKNOWN');
    console.log(JSON.stringify({ provider: stored?.modelProvider, model: stored?.modelName, score: stored?.score, grade: stored?.grade, explanation: stored?.explanation }));
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Ollama Lead', organizationName })).status).toBe(202);
    const row = await admin.capturedMessage.findFirst({ where: { kind: 'email_verification', recipientHmac: emailHmac(email, key) }, orderBy: { createdAt: 'desc' } });
    expect((await post('/api/v1/auth/verify-email').send({ token: row?.token })).status).toBe(204);
    const logged = await post('/api/v1/auth/login').send({ email, password });
    const header = logged.headers['set-cookie'];
    const value = Array.isArray(header) ? header[0] : header;
    return value?.split(';')[0] ?? '';
  }

  function post(url: string) {
    return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
  }
});
