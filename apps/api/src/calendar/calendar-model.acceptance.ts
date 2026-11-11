import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac } from '@salesos/database';
import { acceptMeetingProposal } from '@salesos/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

process.env.SALESOS_PROCESS_AGENTS = 'inline';
process.env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED = 'false';
process.env.SALESOS_LIVE_EMAIL_SEND_ENABLED = 'false';
process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED = 'false';

const knowledge = 'The demonstration covers warehouse published workflow and does not include pricing.';

describe('real Ollama meeting proposal', () => {
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
  const password = 'correct-horse-battery';

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

  it('asks the local model for a meeting agenda and does not book externally', async () => {
    const discovered = await discoverModel();
    const stamp = randomUUID().slice(0, 8);
    const email = `ollama-calendar-${stamp}@example.com`;
    const cookie = await login(email, `Ollama Calendar ${stamp}`);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    const tenantId = me.body.data.organizationId as string;
    const userId = me.body.data.user.id as string;
    const inserted = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO products (tenant_id, name, product_type, created_by, updated_by)
      VALUES (${tenantId}::uuid, 'Northwind Fixture', 'PHYSICAL', ${userId}::uuid, ${userId}::uuid)
      RETURNING id`;
    const productId = inserted[0]!.id;
    const documentId = randomUUID();
    await admin.knowledgeDocument.create({
      data: { id: documentId, tenantId, productId, fileName: 'demo-knowledge.txt', contentType: 'text/plain', byteSize: knowledge.length, sha256: createHash('sha256').update(`${stamp}:${knowledge}`).digest('hex'), storageKey: `acceptance/${stamp}.txt`, status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), createdBy: userId },
    });
    await admin.knowledgeChunk.create({ data: { tenantId, documentId, productId, chunkIndex: 0, section: 'Demo', content: knowledge } });
    await admin.productVersion.create({
      data: { tenantId, productId, versionNumber: 1, status: 'PUBLISHED', snapshot: { positioning: { capabilities: [knowledge], valuePropositions: [], restrictedClaims: [] }, knowledgeDocumentIds: [documentId] }, publishedAt: new Date(), createdBy: userId, updatedBy: userId },
    });
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: 'Fixture Mills', displayName: 'Fixture Mills', createdBy: userId } });
    const lead = await admin.crmLead.create({ data: { tenantId, accountId: account.id, sourceType: 'manual', stage: 'QUALIFIED', createdBy: userId } });
    await admin.calendarRule.create({ data: { tenantId, organizerId: userId, timeZone: 'Asia/Kolkata', workingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })), bufferBeforeMinutes: 0, bufferAfterMinutes: 0, noticeMinutes: 0, horizonDays: 30, createdBy: userId } });
    await admin.calendarMeetingType.create({ data: { tenantId, name: 'Product demonstration', durationMinutes: 30, locationType: 'VIRTUAL_PENDING', timeZone: 'Asia/Kolkata', approvalRequired: true, createdBy: userId } });
    const model = await post('/api/v1/management/models/create').set('Cookie', cookie).send({ name: discovered.name, provider: 'ollama', model: discovered.model, baseUrl: discovered.baseUrl, allowPrivateHttp: true });
    expect(model.status, JSON.stringify(model.body)).toBe(201);
    const run = await post('/api/v1/management/runs/create').set('Cookie', cookie).send({
      triggerType: 'TEST',
      planKind: 'MEETING_PREPARE_AND_SCHEDULE',
      goal: 'Fixture Mills asked for a product demonstration. Copy one STORED SLOTS value exactly. Set availability to LOCAL_ONLY. The agenda must include the words demonstration covers warehouse. Do not create a meeting URL or a price.',
      productId,
      modelConfigurationId: model.body.data.id,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.data.modelProvider).toBe('ollama');
    expect(run.body.data.modelName).toBe('gemma4:e4b');
    const names = (run.body.data.tools as Array<{ toolName: string; output?: unknown }>).map((item) => item.toolName);
    expect(names).toContain('calendar.agenda.propose');
    expect(names).not.toEqual(expect.arrayContaining(['calendar.event.create_external', 'calendar.invitation.send', 'calendar.meet.create', 'calendar.teams.create']));
    const agenda = (run.body.data.tools as Array<{ toolName: string; output?: { persisted?: boolean; review?: string; slot?: string; availability?: string; agenda?: string; summary?: string } }>).find((item) => item.toolName === 'calendar.agenda.propose');
    const stored = agenda?.output;
    const decision = acceptMeetingProposal(stored, { slots: stored?.slot ? [stored.slot] : [], agendaPhrase: 'demonstration covers warehouse', accountName: 'Fixture Mills' });
    const proposal = await admin.calendarMeeting.findFirst({ where: { tenantId, sourceKind: 'AI_PROPOSAL' } });
    expect(run.body.data.state).toBe('SUCCEEDED');
    expect(run.body.data.usage.length).toBeGreaterThan(0);
    expect(run.body.data.usage.every((row: { provider: string; model: string }) => row.provider === 'ollama' && row.model === 'gemma4:e4b')).toBe(true);
    expect(stored?.persisted).toBe(true);
    expect(stored?.review).toBe('REVIEW_REQUIRED');
    expect(decision.accepted).toBe(true);
    expect(proposal?.state).toBe('DRAFT');
    expect(proposal?.availabilityMode).toBe('LOCAL_ONLY');
    expect(proposal?.agenda.toLowerCase()).toContain('demonstration covers warehouse');
    expect(proposal?.agenda.toLowerCase()).not.toMatch(/meet\.google\.com|teams\.microsoft\.com/);
    expect(await admin.calendarExternalLink.count({ where: { tenantId } })).toBe(0);
    expect(await admin.calendarMeeting.count({ where: { tenantId, state: 'BOOKED_INTERNAL' } })).toBe(0);
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    expect((await admin.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: lead.id } } }))?.stage).toBe('QUALIFIED');
    console.log(JSON.stringify({ provider: 'ollama', model: run.body.data.modelName, state: run.body.data.state, proposal: proposal ? 'REVIEW_REQUIRED' : 'REJECTED', review: stored?.review ?? 'REVIEW_REQUIRED', externalWrites: 0 }));
  });

  async function discoverModel(): Promise<{ name: string; model: string; baseUrl: string }> {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    expect(response.ok).toBe(true);
    const body = await response.json() as { models?: Array<{ name: string }> };
    expect(body.models?.some((item) => item.name === 'gemma4:e4b')).toBe(true);
    return { name: 'Local meeting model', model: 'gemma4:e4b', baseUrl: 'http://127.0.0.1:11434' };
  }

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Ollama Calendar', organizationName })).status).toBe(202);
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
