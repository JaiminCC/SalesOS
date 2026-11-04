import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withTenant } from '@salesos/database';
import { writePrivateObject, type KnowledgeJobData } from '@salesos/shared';
import { processKnowledgeJob } from './knowledge';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!process.env.DATABASE_URL_WORKER)('knowledge worker', () => {
  const prisma = createPrismaClient(process.env.DATABASE_URL_WORKER as string);
  const storage = mkdtempSync(join(tmpdir(), 'salesos-knowledge-'));
  const productId = randomUUID();
  const missingId = randomUUID();
  const documentId = randomUUID();

  afterAll(async () => {
    await withTenant(prisma, tenantId, (tx) => tx.product.deleteMany({ where: { tenantId, id: productId } })).catch(() => undefined);
    await prisma.$disconnect();
    rmSync(storage, { recursive: true, force: true });
  });

  it('records a document failure without throwing', async () => {
    process.env.SALESOS_STORAGE_ROOT = storage;
    process.env.SALESOS_EMBEDDING_PROVIDER = 'test';
    await withTenant(prisma, tenantId, async (tx) => {
      await tx.product.create({
        data: {
          tenantId,
          id: productId,
          name: 'Worker product',
          productType: 'OTHER',
          createdBy: tenantId,
          updatedBy: tenantId,
        },
      });
      await tx.knowledgeDocument.create({
        data: {
          tenantId,
          id: missingId,
          productId,
          fileName: 'missing.txt',
          contentType: 'text/plain',
          byteSize: 4,
          sha256: `missing-${missingId}`,
          storageKey: `tenant/${tenantId}/knowledge/${missingId}`,
          status: 'PROCESSING',
          createdBy: tenantId,
        },
      });
    });
    const failed = await processKnowledgeJob(job(missingId), prisma);
    expect(failed.status).toBe('FAILED');
    await writePrivateObject(storage, `tenant/${tenantId}/knowledge/${documentId}`, Buffer.from('Approved installation steps for the field kit.'));
    await withTenant(prisma, tenantId, (tx) =>
      tx.knowledgeDocument.create({
        data: {
          tenantId,
          id: documentId,
          productId,
          fileName: 'notes.txt',
          contentType: 'text/plain',
          byteSize: 48,
          sha256: `notes-${documentId}`,
          storageKey: `tenant/${tenantId}/knowledge/${documentId}`,
          status: 'PROCESSING',
          createdBy: tenantId,
        },
      }),
    );
    const processed = await processKnowledgeJob(job(documentId), prisma);
    expect(processed.status).toBe('PENDING_APPROVAL');
  });

  it('resumes a document left in EXTRACTED after the worker stops', async () => {
    process.env.SALESOS_STORAGE_ROOT = storage;
    process.env.SALESOS_EMBEDDING_PROVIDER = 'test';
    const resumedId = randomUUID();
    const text = 'Recovered field note after the worker stopped.';
    await writePrivateObject(storage, `tenant/${tenantId}/knowledge/${resumedId}`, Buffer.from(text));
    await withTenant(prisma, tenantId, async (tx) => {
      await tx.knowledgeDocument.create({
        data: {
          tenantId,
          id: resumedId,
          productId,
          fileName: 'recovered.txt',
          contentType: 'text/plain',
          byteSize: text.length,
          sha256: `recovered-${resumedId}`,
          storageKey: `tenant/${tenantId}/knowledge/${resumedId}`,
          status: 'EXTRACTED',
          createdBy: tenantId,
        },
      });
      await tx.knowledgeChunk.create({
        data: { tenantId, documentId: resumedId, productId, chunkIndex: 0, content: text, page: null, section: null },
      });
    });
    const resumed = await processKnowledgeJob(job(resumedId), prisma);
    expect(resumed.status).toBe('PENDING_APPROVAL');
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.knowledgeDocument.findUnique({ where: { tenantId_id: { tenantId, id: resumedId } } }),
    );
    expect(row?.semanticStatus).toBe('INDEXED');
  });
});

function job(documentId: string): Job<KnowledgeJobData> {
  return { name: 'knowledge.process', data: { tenantId, documentId, outboxId: randomUUID() } } as Job<KnowledgeJobData>;
}
