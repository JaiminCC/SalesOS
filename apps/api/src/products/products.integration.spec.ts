import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac, ingestKnowledgeDocument, withTenant } from '@salesos/database';
import { EMBEDDING_DIMENSIONS } from '@salesos/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

const password = 'correct-horse-battery';
const storage = mkdtempSync(join(tmpdir(), 'salesos-products-'));
process.env.SALESOS_STORAGE_ROOT = storage;
process.env.SALESOS_PROCESS_KNOWLEDGE = 'inline';
process.env.SALESOS_EMBEDDING_PROVIDER = 'test';
process.env.SALESOS_KNOWLEDGE_MAX_BYTES = '128';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_IDENTITY || !process.env.DATA_ENCRYPTION_KEY)(
  'product configuration',
  () => {
    let app: INestApplication;
    const admin = createPrismaClient(process.env.DATABASE_URL as string);
    const appRole = createPrismaClient(process.env.DATABASE_URL_APP as string);
    const worker = createPrismaClient(process.env.DATABASE_URL_WORKER as string);
    const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    let ownerCookie = '';
    let otherCookie = '';
    let managerCookie = '';
    let viewerCookie = '';
    let ownerOrg = '';
    let productId = '';
    let draftId = '';
    let documentId = '';

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
      await appRole.$disconnect();
      await worker.$disconnect();
      rmSync(storage, { recursive: true, force: true });
    });

    it('creates, filters, duplicates, and isolates products', async () => {
      ownerCookie = await login(`owner-${stamp}@example.com`, 'Owner Org');
      otherCookie = await login(`other-${stamp}@example.com`, 'Other Org');
      ownerOrg = (await get('/api/v1/auth/me').set('Cookie', ownerCookie)).body.data.organizationId;
      const created = await post('/api/v1/products').set('Cookie', ownerCookie).send({
        name: 'Field Kit',
        productType: 'PHYSICAL',
        category: 'Equipment',
        shortDescription: 'Portable field kit',
        currency: 'USD',
      });
      expect(created.status).toBe(201);
      productId = created.body.data.id;
      draftId = created.body.data.draftVersionId;
      expect(created.body.data.organizationId).toBe(ownerOrg);
      const extra = await post('/api/v1/products').set('Cookie', ownerCookie).send({ name: 'Signal', productType: 'SOFTWARE', organizationId: ownerOrg });
      expect(extra.status).toBe(400);
      const signal = await post('/api/v1/products').set('Cookie', ownerCookie).send({ name: 'Signal', productType: 'SOFTWARE' });
      const archivedDraft = await post(`/api/v1/products/${signal.body.data.id}/versions/${signal.body.data.draftVersionId}/archive`).set('Cookie', ownerCookie);
      expect(archivedDraft.status).toBe(200);
      expect(archivedDraft.body.data.status).toBe('ARCHIVED');
      const filtered = await get('/api/v1/products?q=Field&productType=PHYSICAL&status=ACTIVE').set('Cookie', ownerCookie);
      expect(filtered.body.data.items.map((item: { name: string }) => item.name)).toEqual(['Field Kit']);
      const sorted = await get('/api/v1/products?status=ACTIVE&page=1&pageSize=20&sortBy=updatedAt&sortDirection=desc').set('Cookie', ownerCookie);
      expect(sorted.status).toBe(200);
      expect(sorted.body.data.items.some((item: { name: string }) => item.name === 'Field Kit')).toBe(true);
      const hidden = await get(`/api/v1/products/${productId}`).set('Cookie', otherCookie);
      expect(hidden.status).toBe(404);
      const copy = await post(`/api/v1/products/${productId}/duplicate`).set('Cookie', ownerCookie);
      expect(copy.status).toBe(201);
      expect(copy.body.data.name).toContain('copy');
      const archived = await post(`/api/v1/products/${copy.body.data.id}/archive`).set('Cookie', ownerCookie);
      expect(archived.body.data.status).toBe('ARCHIVED');
      const restored = await post(`/api/v1/products/${copy.body.data.id}/restore`).set('Cookie', ownerCookie);
      expect(restored.body.data.status).toBe('ACTIVE');
      const activity = await get(`/api/v1/products/${productId}/activity`).set('Cookie', ownerCookie);
      expect(activity.body.data.some((event: { action: string }) => event.action === 'product.create')).toBe(true);
    });

    it('enforces draft edits, approval, and publish permissions', async () => {
      const viewerEmail = `viewer-${stamp}@example.com`;
      const managerEmail = `manager-${stamp}@example.com`;
      await login(viewerEmail, 'Viewer Org');
      await login(managerEmail, 'Manager Org');
      await post(`/api/v1/organizations/${ownerOrg}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
      viewerCookie = await acceptInvitation(viewerEmail, ownerOrg);
      await post(`/api/v1/organizations/${ownerOrg}/invitations`).set('Cookie', ownerCookie).send({ email: managerEmail, role: 'SALES_MANAGER' });
      managerCookie = await acceptInvitation(managerEmail, ownerOrg);
      expect((await post('/api/v1/products').set('Cookie', viewerCookie).send({ name: 'Blocked', productType: 'OTHER' })).status).toBe(403);

      const first = await patch(`/api/v1/products/${productId}/versions/${draftId}`).set('Cookie', managerCookie).send({
        revision: 1,
        positioning: { valuePropositions: ['Works in the field'], capabilities: ['Offline notes'], tone: 'direct' },
        pricing: { model: 'CUSTOM_QUOTE', visible: false, currency: 'USD', summary: '', tiers: [] },
      });
      expect(first.status).toBe(200);
      const conflict = await patch(`/api/v1/products/${productId}/versions/${draftId}`).set('Cookie', ownerCookie).send({ revision: 1, positioning: { tone: 'late' } });
      expect(conflict.status).toBe(409);
      const icp = await post(`/api/v1/products/${productId}/icps`).set('Cookie', managerCookie).send({ name: 'Regional operators', priority: 1, industries: ['Logistics'], countries: ['US'], languages: ['en'] });
      expect(icp.status).toBe(201);
      expect((await post(`/api/v1/products/${productId}/icps`).set('Cookie', managerCookie).send({ name: '', priority: 1 })).status).toBe(400);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/submit`).set('Cookie', managerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/approve`).set('Cookie', managerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/versions/${draftId}/publish`).set('Cookie', managerCookie)).status).toBe(403);
      const published = await post(`/api/v1/products/${productId}/versions/${draftId}/publish`).set('Cookie', ownerCookie);
      expect(published.status).toBe(200);
      expect(published.body.data.status).toBe('PUBLISHED');
      const mutated = await patch(`/api/v1/products/${productId}/versions/${draftId}`).set('Cookie', ownerCookie).send({ revision: 2, positioning: { tone: 'changed' } });
      expect(mutated.status).toBe(409);
      await expect(
        admin.productVersion.update({
          where: { tenantId_id: { tenantId: ownerOrg, id: draftId } },
          data: { snapshot: { icps: [], positioning: {}, pricing: {}, knowledgeDocumentIds: [] } },
        }),
      ).rejects.toThrow(/draft/i);
    });

    it('ingests approved knowledge and keeps rejected or foreign content out of agent context', async () => {
      const note = Buffer.from('Approved field kit note for regional operators.').toString('base64');
      const uploaded = await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({ fileName: 'field-kit.md', contentBase64: note });
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.data.status).toBe('PENDING_APPROVAL');
      expect(JSON.stringify(uploaded.body)).not.toContain('storageKey');
      expect(JSON.stringify(uploaded.body)).not.toContain(storage);
      documentId = uploaded.body.data.id;
      expect((await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({ fileName: 'field-kit.md', contentBase64: note })).status).toBe(409);
      expect((await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({ fileName: 'notes.exe', contentBase64: Buffer.from('hello').toString('base64') })).status).toBe(415);
      expect((await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({ fileName: '../secret.txt', contentBase64: Buffer.from('hello').toString('base64') })).status).toBe(400);
      const oversized = Buffer.from('x'.repeat(200)).toString('base64');
      expect((await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({ fileName: 'big.txt', contentBase64: oversized })).status).toBe(413);

      const approved = await post(`/api/v1/products/${productId}/knowledge/${documentId}/approve`).set('Cookie', ownerCookie);
      expect(approved.status).toBe(200);
      const download = await get(`/api/v1/products/${productId}/knowledge/${documentId}/download`).set('Cookie', ownerCookie);
      expect(download.status).toBe(200);
      expect(download.headers['content-disposition']).toContain('field-kit.md');
      expect((await get(`/api/v1/products/${productId}/knowledge/${documentId}/download`).set('Cookie', otherCookie)).status).toBe(404);

      const rejected = await post(`/api/v1/products/${productId}/knowledge`).set('Cookie', ownerCookie).send({
        fileName: 'rejected.md',
        contentBase64: Buffer.from('Rejected secret phrase that must stay hidden.').toString('base64'),
      });
      expect((await post(`/api/v1/products/${productId}/knowledge/${rejected.body.data.id}/reject`).set('Cookie', ownerCookie).send({ reason: 'Out of date' })).status).toBe(200);

      const keyword = await post(`/api/v1/products/${productId}/knowledge/search`).set('Cookie', ownerCookie).send({ query: 'regional operators', mode: 'keyword' });
      expect(keyword.body.data.mode).toBe('keyword');
      expect(keyword.body.data.results.some((row: { content: string }) => row.content.includes('Approved field kit note'))).toBe(true);
      expect(JSON.stringify(keyword.body)).not.toContain('Rejected secret phrase');
      const semantic = await post(`/api/v1/products/${productId}/knowledge/search`).set('Cookie', ownerCookie).send({ query: 'regional operators', mode: 'semantic' });
      expect(semantic.body.data.mode).toBe('semantic');
      expect(semantic.body.data.results[0].chunkId).toBeTruthy();
      expect(semantic.body.data.results[0].documentId).toBe(documentId);

      process.env.SALESOS_EMBEDDING_PROVIDER = 'disabled';
      const fallback = await post(`/api/v1/products/${productId}/knowledge/search`).set('Cookie', ownerCookie).send({ query: 'regional operators', mode: 'semantic' });
      expect(fallback.body.data.mode).toBe('keyword');
      expect(fallback.body.data.semanticAvailable).toBe(false);
      process.env.SALESOS_EMBEDDING_PROVIDER = 'test';

      const republished = await republish();
      const preview = await post(`/api/v1/products/${productId}/context/preview`).set('Cookie', ownerCookie).send({ query: 'regional operators' });
      expect(preview.body.data.liveAgentContext).toBe(true);
      expect(preview.body.data.version.id).toBe(republished);
      expect(preview.body.data.citations.some((row: { documentId: string }) => row.documentId === documentId)).toBe(true);
      expect(JSON.stringify(preview.body)).not.toContain('Rejected secret phrase');
      expect(preview.body.data.pricing.visibleToAgents ?? preview.body.data.pricing.visible).toBe(false);
      const draft = await post(`/api/v1/products/${productId}/versions/${republished}/restore`).set('Cookie', ownerCookie);
      const draftPreview = await post(`/api/v1/products/${productId}/context/preview`).set('Cookie', ownerCookie).send({ query: 'regional operators', versionId: draft.body.data.id });
      expect(draftPreview.body.data.liveAgentContext).toBe(false);
      expect((await post(`/api/v1/products/${productId}/context/preview`).set('Cookie', viewerCookie).send({ query: 'regional operators', versionId: draft.body.data.id })).status).toBe(403);

      const foreign = await withTenant(appRole, ownerOrg, (tx) => tx.knowledgeChunk.findMany({ where: { tenantId: ownerOrg, documentId } }));
      const leaked = await withTenant(appRole, (await get('/api/v1/auth/me').set('Cookie', otherCookie)).body.data.organizationId, (tx) => tx.knowledgeChunk.findMany());
      expect(foreign.length).toBeGreaterThan(0);
      expect(leaked.some((row) => row.content.includes('Approved field kit note'))).toBe(false);
      expect(await worker.product.findMany()).toEqual([]);

      const badId = randomUUID();
      await withTenant(appRole, ownerOrg, (tx) =>
        tx.knowledgeDocument.create({
          data: {
            tenantId: ownerOrg,
            id: badId,
            productId,
            fileName: 'bad.txt',
            contentType: 'text/plain',
            byteSize: 4,
            sha256: `bad-${badId}`,
            storageKey: `tenant/${ownerOrg}/knowledge/${badId}`,
            status: 'PROCESSING',
            createdBy: ownerOrg,
          },
        }),
      );
      const failed = await ingestKnowledgeDocument(appRole, {
        tenantId: ownerOrg,
        documentId: badId,
        bytes: Buffer.from('short note'),
        maxBytes: 128,
        embed: async () => ({ model: 'other-model', dimensions: 8, vector: [1, 2, 3, 4, 5, 6, 7, 8] }),
      });
      expect(failed.status).toBe('FAILED');
      const embeddings = await admin.$queryRaw<Array<{ dimensions: number }>>`SELECT dimensions FROM knowledge_embeddings WHERE tenant_id = ${ownerOrg}::uuid`;
      expect(embeddings.every((row) => row.dimensions === EMBEDDING_DIMENSIONS)).toBe(true);
    });

    it('lets one publication win a concurrent race', async () => {
      const created = await post('/api/v1/products').set('Cookie', ownerCookie).send({ name: 'Race Kit', productType: 'CUSTOM' });
      const version = created.body.data.draftVersionId as string;
      const id = created.body.data.id as string;
      expect((await post(`/api/v1/products/${id}/versions/${version}/submit`).set('Cookie', ownerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${id}/versions/${version}/approve`).set('Cookie', ownerCookie)).status).toBe(200);
      const [first, second] = await Promise.all([
        post(`/api/v1/products/${id}/versions/${version}/publish`).set('Cookie', ownerCookie),
        post(`/api/v1/products/${id}/versions/${version}/publish`).set('Cookie', ownerCookie),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const versions = await get(`/api/v1/products/${id}/versions`).set('Cookie', ownerCookie);
      expect(versions.body.data.filter((row: { status: string }) => row.status === 'PUBLISHED')).toHaveLength(1);
    });

    async function republish(): Promise<string> {
      const opened = await post(`/api/v1/products/${productId}/versions`).set('Cookie', ownerCookie);
      const version = opened.body.data.id as string;
      expect((await post(`/api/v1/products/${productId}/versions/${version}/submit`).set('Cookie', ownerCookie)).status).toBe(200);
      expect((await post(`/api/v1/products/${productId}/versions/${version}/approve`).set('Cookie', ownerCookie)).status).toBe(200);
      const published = await post(`/api/v1/products/${productId}/versions/${version}/publish`).set('Cookie', ownerCookie);
      expect(published.status).toBe(200);
      return version;
    }

    async function login(email: string, organizationName: string): Promise<string> {
      expect((await post('/api/v1/auth/register').send({ email, password, displayName: email.split('@')[0], organizationName })).status).toBe(202);
      const token = await captured('email_verification', email);
      expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
      const logged = await post('/api/v1/auth/login').send({ email, password });
      expect(logged.status).toBe(200);
      return pair(sessionCookie(logged));
    }

    async function acceptInvitation(email: string, organizationId: string): Promise<string> {
      const token = await captured('invitation', email);
      const logged = await post('/api/v1/auth/login').send({ email, password });
      const cookie = pair(sessionCookie(logged));
      expect((await post('/api/v1/invitations/accept').set('Cookie', cookie).send({ token })).status).toBe(200);
      expect((await post(`/api/v1/organizations/${organizationId}/switch`).set('Cookie', cookie)).status).toBe(204);
      return cookie;
    }

    async function captured(kind: string, email: string): Promise<string> {
      const row = await admin.capturedMessage.findFirst({ where: { kind, recipientHmac: emailHmac(email, key) }, orderBy: { createdAt: 'desc' } });
      if (!row?.token) throw new Error(`missing ${kind}`);
      return row.token;
    }

    function post(url: string) {
      return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
    }
    function patch(url: string) {
      return request(app.getHttpServer()).patch(url).set('x-salesos-csrf', '1');
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
