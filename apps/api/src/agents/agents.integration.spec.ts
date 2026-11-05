import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

const password = 'correct-horse-battery';
process.env.SALESOS_PROCESS_AGENTS = 'inline';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_IDENTITY || !process.env.DATA_ENCRYPTION_KEY)(
  'agent management',
  () => {
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
      await admin.authAttempt.deleteMany();
      ownerCookie = await login(`agent-owner-${stamp}@example.com`, 'Agent Org');
      otherCookie = await login(`agent-other-${stamp}@example.com`, 'Other Agent Org');
    });

    afterAll(async () => {
      await app?.close();
      await admin.$disconnect();
    });

    it('runs a published product without sending and hides the run from another organization', async () => {
      const injected = await post('/api/v1/management/agents/list').set('Cookie', ownerCookie).send({ sortBy: 'name; drop table agent_runs' });
      expect(injected.status).toBe(400);
      const model = await post('/api/v1/management/models/create').set('Cookie', ownerCookie).send({ name: 'Mock', provider: 'fake', model: 'fake-1', apiKey: 'sk-test-secret' });
      expect(model.status).toBe(201);
      expect(model.body.data.configured).toBe(true);
      expect(JSON.stringify(model.body)).not.toContain('sk-test-secret');
      const hiddenModel = await post('/api/v1/management/models/get').set('Cookie', otherCookie).send({ id: model.body.data.id });
      expect(hiddenModel.status).toBe(404);
      const productId = await publishProduct('Field Kit');
      const draft = await post('/api/v1/products').set('Cookie', ownerCookie).send({ name: 'Draft Kit', productType: 'PHYSICAL' });
      const rejected = await post('/api/v1/management/runs/create').set('Cookie', ownerCookie).send({ triggerType: 'TEST', goal: 'Research the product', productId: draft.body.data.id, productVersionId: draft.body.data.draftVersionId, modelConfigurationId: model.body.data.id });
      expect(rejected.status).toBe(409);
      const created = await post('/api/v1/management/runs/create').set('Cookie', ownerCookie).send({ triggerType: 'TEST', goal: 'Research the product and draft a message', productId, modelConfigurationId: model.body.data.id });
      expect(created.status).toBe(201);
      expect(created.body.data.state).toBe('WAITING_APPROVAL');
      expect(created.body.data.contextSha256).toBeTruthy();
      expect(created.body.data.actions[0].outcome.sent).toBe(false);
      expect(created.body.data.actions[0].state).toBe('NEEDS_APPROVAL');
      expect(created.body.data.steps.length).toBeGreaterThan(0);
      const hidden = await post('/api/v1/management/runs/get').set('Cookie', otherCookie).send({ id: created.body.data.id });
      expect(hidden.status).toBe(404);
      const approval = await post('/api/v1/management/approvals/list').set('Cookie', ownerCookie).send({ status: 'PENDING' });
      expect(approval.status).toBe(200);
      const item = approval.body.data.items[0];
      const replay = await post('/api/v1/management/approvals/decide').set('Cookie', ownerCookie).send({ id: item.id, decision: 'APPROVED', payloadSha256: 'f'.repeat(64) });
      expect(replay.status).toBe(409);
      const decided = await post('/api/v1/management/approvals/decide').set('Cookie', ownerCookie).send({ id: item.id, decision: 'APPROVED', payloadSha256: item.payloadSha256 });
      expect(decided.status).toBe(200);
      const second = await post('/api/v1/management/approvals/decide').set('Cookie', ownerCookie).send({ id: item.id, decision: 'REJECTED', payloadSha256: item.payloadSha256 });
      expect(second.status).toBe(409);
      const action = await admin.agentAction.findFirst({ where: { id: item.actionId } });
      expect(action?.state).toBe('APPROVED_NOT_EXECUTABLE');
      expect(action?.outcome).toEqual({ sent: false, executable: false });
      const removed = await post('/api/v1/management/runs/delete').set('Cookie', ownerCookie).send({ id: created.body.data.id });
      expect(removed.status).toBe(404);
      const archived = await post('/api/v1/management/runs/archive').set('Cookie', ownerCookie).send({ id: created.body.data.id });
      expect(archived.status).toBe(200);
      const stored = await admin.agentRun.findFirst({ where: { id: created.body.data.id } });
      expect(stored?.archivedAt).toBeTruthy();
      expect(stored?.state).not.toBe('FAILED_FINAL');
    });

    it('keeps the policy version that was stored on an action', async () => {
      const policy = await post('/api/v1/management/policies/create').set('Cookie', ownerCookie).send({ name: `Outbound ${stamp}`, autonomyLevel: 'A4' });
      expect(policy.status).toBe(201);
      const model = await post('/api/v1/management/models/list').set('Cookie', ownerCookie).send({});
      const productId = await publishProduct(`Policy Kit ${stamp}`);
      const run = await post('/api/v1/management/runs/create').set('Cookie', ownerCookie).send({ triggerType: 'TEST', goal: 'Research the product and draft a message', productId, modelConfigurationId: model.body.data.items[0].id });
      const version = run.body.data.actions[0].policyVersion;
      const updated = await post('/api/v1/management/policies/update').set('Cookie', ownerCookie).send({ id: policy.body.data.id, name: `Outbound ${stamp}`, autonomyLevel: 'A0' });
      expect(updated.body.data.version).toBe(2);
      const again = await post('/api/v1/management/runs/get').set('Cookie', ownerCookie).send({ id: run.body.data.id });
      expect(again.body.data.actions[0].policyVersion).toBe(version);
    });

    async function login(email: string, organizationName: string): Promise<string> {
      expect((await post('/api/v1/auth/register').send({ email, password, displayName: 'Agent Owner', organizationName })).status).toBe(202);
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

    async function publishProduct(name: string): Promise<string> {
      const created = await post('/api/v1/products').set('Cookie', ownerCookie).send({ name, productType: 'PHYSICAL' });
      expect(created.status).toBe(201);
      const productId = created.body.data.id as string;
      const draftId = created.body.data.draftVersionId as string;
      expect((await patch(`/api/v1/products/${productId}/versions/${draftId}`).set('Cookie', ownerCookie).send({ revision: 1, positioning: { valuePropositions: ['Works in the field'], capabilities: ['Offline notes'], tone: 'direct' } })).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/icps`).set('Cookie', ownerCookie).send({ name: 'Regional operators', priority: 1, industries: ['Logistics'], countries: ['US'], languages: ['en'] })).status).toBe(201);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/submit`).set('Cookie', ownerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/approve`).set('Cookie', ownerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/publish`).set('Cookie', ownerCookie)).status).toBe(200);
      return productId;
    }

    function post(url: string) {
      return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
    }

    function patch(url: string) {
      return request(app.getHttpServer()).patch(url).set('x-salesos-csrf', '1');
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
