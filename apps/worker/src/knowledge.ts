import type { Job } from 'bullmq';
import { ingestKnowledgeDocument, listDueKnowledgeDeletions, purgeKnowledgeContent, withTenant, type PrismaClient } from '@salesos/database';
import {
  deletePrivateObject,
  embedText,
  embeddingProviderFromEnv,
  knowledgeObjectKey,
  readPrivateObject,
  storageRootFromEnv,
  type KnowledgeJobData,
} from '@salesos/shared';

export async function processKnowledgeJob(
  job: Job<KnowledgeJobData>,
  prisma: PrismaClient,
): Promise<{ status: string }> {
  const { tenantId, documentId, outboxId } = job.data;
  try {
    const key = knowledgeObjectKey(tenantId, documentId);
    const bytes = await readPrivateObject(storageRootFromEnv(process.env), key).catch(() => null);
    if (!bytes) {
      await withTenant(prisma, tenantId, async (tx) => {
        await tx.knowledgeDocument.updateMany({
          where: { tenantId, id: documentId, status: { in: ['PROCESSING', 'EXTRACTED', 'INDEXED'] } },
          data: { status: 'FAILED', failureReason: 'Document content is unavailable', semanticStatus: 'UNAVAILABLE' },
        });
        await tx.outboxEvent.updateMany({
          where: { tenantId, id: outboxId, status: 'PENDING' },
          data: { status: 'FAILED', processedAt: new Date() },
        });
      });
      return { status: 'FAILED' };
    }
    const result = await ingestKnowledgeDocument(prisma, {
      tenantId,
      documentId,
      bytes,
      maxBytes: numberFromEnv(process.env.SALESOS_KNOWLEDGE_MAX_BYTES, 5_242_880),
      embed: (text) => embedText(embeddingProviderFromEnv(process.env), text),
      outboxId,
    });
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'knowledge processed', documentId, status: result.status })}\n`);
    return { status: result.status };
  } catch {
    process.stderr.write(`${JSON.stringify({ level: 'error', message: 'knowledge processing failed', documentId })}\n`);
    return { status: 'FAILED' };
  }
}

export async function purgeDueKnowledge(prisma: PrismaClient): Promise<number> {
  const due = await listDueKnowledgeDeletions(prisma);
  for (const row of due) {
    await purgeKnowledgeContent(prisma, row.tenant_id, row.id, (key) => deletePrivateObject(storageRootFromEnv(process.env), key));
  }
  return due.length;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
