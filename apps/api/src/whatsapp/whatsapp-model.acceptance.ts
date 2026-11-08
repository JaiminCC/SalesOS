import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

process.env.SALESOS_PROCESS_AGENTS = 'inline';
process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED = 'false';
const password = 'correct-horse-battery';
const knowledge = 'Offline barcode capture is supported.';
const question = 'Can the product capture barcode scans when the warehouse has no internet?';

describe('real Ollama WhatsApp analysis', () => {
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

  it('reads a fixture conversation with the local model and does not send', async () => {
    const discovered = await discoverModel();
    const stamp = randomUUID().slice(0, 8);
    const email = `ollama-whatsapp-${stamp}@example.com`;
    const cookie = await login(email, `Ollama WhatsApp ${stamp}`);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    const tenantId = me.body.data.organizationId as string;
    const userId = me.body.data.user.id as string;
    const inserted = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO products (tenant_id, name, product_type, created_by, updated_by)
      VALUES (${tenantId}::uuid, 'Warehouse Kit', 'PHYSICAL', ${userId}::uuid, ${userId}::uuid)
      RETURNING id`;
    const productId = inserted[0]!.id;
    const documentId = randomUUID();
    await admin.knowledgeDocument.create({
      data: {
        id: documentId,
        tenantId,
        productId,
        fileName: 'warehouse-knowledge.txt',
        contentType: 'text/plain',
        byteSize: knowledge.length,
        sha256: createHash('sha256').update(`${stamp}:${knowledge}`).digest('hex'),
        storageKey: `acceptance/${stamp}.txt`,
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
        createdBy: userId,
      },
    });
    const chunk = await admin.knowledgeChunk.create({
      data: { tenantId, documentId, productId, chunkIndex: 0, section: 'Capture', content: knowledge },
    });
    await admin.productVersion.create({
      data: {
        tenantId,
        productId,
        versionNumber: 1,
        status: 'PUBLISHED',
        snapshot: { positioning: { capabilities: [knowledge] }, knowledgeDocumentIds: [documentId] },
        publishedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const connection = await admin.whatsappConnection.create({
      data: { tenantId, displayName: 'Fixture line', mode: 'MANUAL', wabaId: `9${stamp}`, readiness: 'CONFIGURED_UNVERIFIED', createdBy: userId },
    });
    const phone = await admin.whatsappPhoneNumber.create({
      data: { tenantId, connectionId: connection.id, wabaId: connection.wabaId, providerPhoneId: `1666${stamp}`, displayNumber: '+15550002222', verificationState: 'UNVERIFIED' },
    });
    const conversation = await admin.whatsappConversation.create({
      data: { tenantId, phoneId: phone.id, customerE164: '+15551230000', state: 'OPEN', windowState: 'WINDOW_OPEN', lastInboundAt: new Date(), intent: 'PRODUCT_INQUIRY' },
    });
    await admin.whatsappMessage.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        providerMessageId: `wamid.OLLAMA.${stamp}`,
        direction: 'INBOUND',
        messageType: 'text',
        body: question,
        providerTimestamp: new Date(),
        origin: 'STUB_TESTED',
        processingStatus: 'STORED',
      },
    });
    const model = await post('/api/v1/management/models/create').set('Cookie', cookie).send({
      name: discovered.name,
      provider: 'ollama',
      model: discovered.model,
      baseUrl: discovered.baseUrl,
      allowPrivateHttp: true,
    });
    expect(model.status, JSON.stringify(model.body)).toBe(201);
    const run = await post('/api/v1/management/runs/create').set('Cookie', cookie).send({
      triggerType: 'TEST',
      planKind: 'WHATSAPP_ANALYZE_AND_DRAFT',
      goal: 'Review the inbound product question and propose a reply for a person',
      productId,
      conversationId: conversation.id,
      modelConfigurationId: model.body.data.id,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.data.modelProvider).toBe('ollama');
    expect(run.body.data.modelName).toBe('gemma4:e4b');
    expect(run.body.data.state).toBe('SUCCEEDED');
    expect(run.body.data.actions).toEqual([]);
    const names = (run.body.data.tools as Array<{ toolName: string }>).map((item) => item.toolName);
    expect(names).toContain('whatsapp.reply.propose');
    expect(names).not.toEqual(expect.arrayContaining(['whatsapp.message.send', 'whatsapp.template.dispatch', 'whatsapp.external.send', 'whatsapp.campaign.send']));
    expect(run.body.data.usage.length).toBeGreaterThan(0);
    expect(run.body.data.usage.every((row: { provider: string; model: string }) => row.provider === 'ollama' && row.model === 'gemma4:e4b')).toBe(true);
    const version = await admin.whatsappDraftVersion.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const draft = version ? await admin.whatsappDraft.findFirst({ where: { tenantId, id: version.draftId } }) : null;
    expect(draft?.status).toBe('AWAITING_REVIEW');
    expect(version?.body).toBeTruthy();
    expect(version?.body).not.toMatch(/\$\d/);
    const acceptedModel = version?.source === 'MODEL';
    if (acceptedModel) {
      expect(version?.body.toLowerCase()).toMatch(/barcode|offline/);
      expect(version?.body).not.toMatch(/This suggestion was not generated by a model/);
    } else {
      expect(version?.source).toBe('DETERMINISTIC');
      expect(version?.body).toMatch(/not generated by a model/);
    }
    expect(await admin.whatsappMessage.count({ where: { tenantId, direction: 'INBOUND' } })).toBe(1);
    expect(await admin.whatsappApproval.count({ where: { tenantId } })).toBe(0);
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    console.log(JSON.stringify({ provider: 'ollama', model: 'gemma4:e4b', acceptedModel, source: version?.source, citation: chunk.id, origin: 'STUB_TESTED' }));
  });

  async function discoverModel(): Promise<{ name: string; model: string; baseUrl: string }> {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    expect(response.ok).toBe(true);
    const body = await response.json() as { models?: Array<{ name: string }> };
    expect(body.models?.some((item) => item.name === 'gemma4:e4b')).toBe(true);
    const saved = await admin.modelConfiguration.findFirst({ where: { provider: 'ollama', model: 'gemma4:e4b', enabled: true }, orderBy: { createdAt: 'desc' } });
    return { name: saved?.name || 'Local WhatsApp model', model: 'gemma4:e4b', baseUrl: saved?.baseUrl || 'http://127.0.0.1:11434' };
  }

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Ollama WhatsApp', organizationName })).status).toBe(202);
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
