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

describe('real Ollama campaign personalization', () => {
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

  it('drafts from the local model and recorded facts without sending', async () => {
    const saved = await admin.modelConfiguration.findFirst({ where: { provider: 'ollama', model: 'gemma4:e4b', enabled: true }, orderBy: { createdAt: 'desc' } });
    expect(saved?.model).toBe('gemma4:e4b');
    expect(saved?.baseUrl).toBeTruthy();
    const stamp = randomUUID().slice(0, 8);
    const email = `ollama-campaign-${stamp}@example.com`;
    const cookie = await login(email, `Ollama Campaign ${stamp}`);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    const tenantId = me.body.data.organizationId as string;
    const userId = me.body.data.user.id as string;
    const inserted = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO products (tenant_id, name, product_type, created_by, updated_by)
      VALUES (${tenantId}::uuid, 'Field Kit', 'PHYSICAL', ${userId}::uuid, ${userId}::uuid)
      RETURNING id`;
    const icpId = randomUUID();
    const version = await admin.productVersion.create({
      data: {
        tenantId,
        productId: inserted[0]!.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        snapshot: { icps: [{ id: icpId, name: 'Operators', priority: 1, industries: ['Logistics'], countries: ['US'], companySizes: ['51-200'] }] },
        publishedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const account = await post('/api/v1/management/accounts/create').set('Cookie', cookie).send({ legalName: 'Northwind Logistics', industry: 'Logistics', country: 'US', description: 'Needs offline barcode capture' });
    expect(account.status).toBe(200);
    const contact = await post('/api/v1/management/contacts/create').set('Cookie', cookie).send({ accountId: account.body.data.id, name: 'Ada North' });
    expect(contact.status).toBe(200);
    const lead = await post('/api/v1/management/leads/create').set('Cookie', cookie).send({ accountId: account.body.data.id, contactId: contact.body.data.id, productId: inserted[0]!.id, sourceType: 'manual' });
    expect(lead.status).toBe(200);
    const campaign = await post('/api/v1/management/campaigns/create').set('Cookie', cookie).send({ name: 'Field introduction', goal: 'Prepare a grounded draft', productVersionId: version.id, icpRef: icpId, timeZone: 'UTC' });
    expect(campaign.status, JSON.stringify(campaign.body)).toBe(200);
    expect(campaign.body.data.sendingStatus).toBe('NOT_AUTHORIZED');
    const model = await post('/api/v1/management/models/create').set('Cookie', cookie).send({ name: saved!.name, provider: 'ollama', model: saved!.model, baseUrl: saved!.baseUrl, allowPrivateHttp: true });
    expect(model.status).toBe(201);
    const run = await post('/api/v1/management/runs/create').set('Cookie', cookie).send({
      triggerType: 'TEST',
      planKind: 'CAMPAIGN_PREPARE_AND_PERSONALIZE',
      goal: 'Prepare a grounded introduction',
      productId: inserted[0]!.id,
      campaignId: campaign.body.data.id,
      leadId: lead.body.data.id,
      modelConfigurationId: model.body.data.id,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.data.modelProvider).toBe('ollama');
    expect(run.body.data.modelName).toBe('gemma4:e4b');
    expect(run.body.data.actions).toEqual([]);
    const tools = run.body.data.tools as Array<{ toolName: string; output?: { draft?: string } }>;
    expect(tools.map((item) => item.toolName)).toContain('campaign.message.personalize');
    expect(tools.map((item) => item.toolName)).not.toContain('campaign.email.send');
    expect(run.body.data.usage.length).toBeGreaterThan(0);
    expect(run.body.data.usage.every((row: { provider: string; model: string }) => row.provider === 'ollama' && row.model === 'gemma4:e4b')).toBe(true);
    const draftText = tools.find((item) => item.toolName === 'campaign.message.personalize')?.output?.draft ?? '';
    const prepared = await post('/api/v1/management/campaign-simulation/personalize').set('Cookie', cookie).send({
      campaignId: campaign.body.data.id,
      leadId: lead.body.data.id,
      modelText: draftText,
      modelProvider: 'ollama',
      modelName: 'gemma4:e4b',
    });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    expect(prepared.body.data.externalSend).toBe(false);
    expect(prepared.body.data.sendAttempts).toBe(0);
    const stored = await admin.campaignDraftVersion.findFirst({ where: { tenantId, draftId: prepared.body.data.draftId } });
    expect(stored?.bodyText).not.toMatch(/\brevenue\b/i);
    expect(stored?.bodyText.toLowerCase()).toContain('northwind');
    if (prepared.body.data.acceptedModel) {
      expect(stored?.modelProvider).toBe('ollama');
      expect(stored?.modelName).toBe('gemma4:e4b');
    } else {
      expect(prepared.body.data.status).toBe('REVIEW_REQUIRED');
      expect(stored?.modelProvider).toBeNull();
    }
    expect(await admin.campaignApproval.count({ where: { tenantId, kind: 'DRAFT', state: 'APPROVED' } })).toBe(0);
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    console.log(JSON.stringify({ provider: 'ollama', model: 'gemma4:e4b', acceptedModel: prepared.body.data.acceptedModel, status: prepared.body.data.status }));
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Ollama Campaign', organizationName })).status).toBe(202);
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
