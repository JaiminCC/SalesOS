import { Prisma, type PrismaClient } from '@prisma/client';
import {
  EMBEDDING_DIMENSIONS,
  KnowledgeFileError,
  chunkSections,
  extractDocument,
  type EmbeddingVector,
} from '@salesos/shared';
import { withTenant } from './with-tenant';

type IngestResult = { status: string; failureReason: string | null; semanticStatus: string };

export async function ingestKnowledgeDocument(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    documentId: string;
    bytes: Buffer;
    maxBytes: number;
    embed: (text: string) => Promise<EmbeddingVector | null>;
    outboxId?: string;
  },
): Promise<IngestResult> {
  try {
    const extracted = await withTenant(prisma, input.tenantId, async (tx) => {
      const document = await tx.knowledgeDocument.findUnique({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.documentId } },
      });
      if (!document) return { kind: 'missing' as const };
      if (document.status === 'INDEXED') return { kind: 'indexed' as const };
      if (document.status === 'EXTRACTED') {
        const stored = await tx.knowledgeChunk.findMany({
          where: { tenantId: input.tenantId, documentId: input.documentId },
          orderBy: { chunkIndex: 'asc' },
        });
        return { kind: 'ready' as const, chunks: stored.map((chunk) => ({ content: chunk.content })) };
      }
      if (document.status !== 'PROCESSING') return { kind: 'settled' as const, document };
      const parsed = extractDocument(document.fileName, input.bytes, input.maxBytes);
      const chunks = chunkSections(parsed.sections);
      const claimed = await tx.knowledgeDocument.updateMany({
        where: { tenantId: input.tenantId, id: input.documentId, status: 'PROCESSING' },
        data: { status: 'EXTRACTED', failureReason: null, pageCount: parsed.pageCount },
      });
      if (claimed.count !== 1) return { kind: 'settled' as const, document };
      await tx.knowledgeChunk.deleteMany({ where: { tenantId: input.tenantId, documentId: input.documentId } });
      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          tenantId: input.tenantId,
          documentId: input.documentId,
          productId: document.productId,
          chunkIndex: chunk.index,
          content: chunk.content,
          page: chunk.page,
          section: chunk.section,
        })),
      });
      return { kind: 'ready' as const, chunks };
    });

    if (extracted.kind === 'missing') {
      await settleOutbox(prisma, input.tenantId, input.outboxId, 'FAILED');
      return { status: 'FAILED', failureReason: 'Document was not found', semanticStatus: 'UNAVAILABLE' };
    }
    if (extracted.kind === 'indexed') {
      await withTenant(prisma, input.tenantId, (tx) =>
        tx.knowledgeDocument.updateMany({
          where: { tenantId: input.tenantId, id: input.documentId, status: 'INDEXED' },
          data: { status: 'PENDING_APPROVAL' },
        }),
      );
      await settleOutbox(prisma, input.tenantId, input.outboxId, 'PROCESSED');
      return { status: 'PENDING_APPROVAL', failureReason: null, semanticStatus: 'INDEXED' };
    }
    if (extracted.kind === 'settled') {
      await settleOutbox(prisma, input.tenantId, input.outboxId, 'PROCESSED');
      return {
        status: extracted.document.status,
        failureReason: extracted.document.failureReason,
        semanticStatus: extracted.document.semanticStatus,
      };
    }

    const vectors = await embedChunks(extracted.chunks.map((chunk) => chunk.content), input.embed);
    await withTenant(prisma, input.tenantId, async (tx) => {
      const current = await tx.knowledgeDocument.findUnique({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.documentId } },
      });
      if (!current || current.status !== 'EXTRACTED') return;
      if (!vectors) {
        await tx.knowledgeDocument.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: input.documentId } },
          data: { status: 'PENDING_APPROVAL', semanticStatus: 'UNAVAILABLE', embeddingModel: null },
        });
        return;
      }
      const model = vectors[0]?.model;
      if (!model || vectors.some((vector) => vector.model !== model || vector.dimensions !== EMBEDDING_DIMENSIONS)) {
        throw new KnowledgeFileError('Embedding dimensions are incompatible with the index');
      }
      await tx.$executeRaw`
        INSERT INTO embedding_indexes (tenant_id, model, dimensions, status)
        VALUES (${input.tenantId}::uuid, ${model}, ${EMBEDDING_DIMENSIONS}, 'ACTIVE')
        ON CONFLICT (tenant_id) DO NOTHING
      `;
      const index = await tx.embeddingIndex.findUnique({ where: { tenantId: input.tenantId } });
      if (!index || index.model !== model || index.dimensions !== EMBEDDING_DIMENSIONS) {
        throw new KnowledgeFileError('Embedding model does not match the tenant index');
      }
      const stored = await tx.knowledgeChunk.findMany({
        where: { tenantId: input.tenantId, documentId: input.documentId },
        orderBy: { chunkIndex: 'asc' },
      });
      if (stored.length !== vectors.length) throw new KnowledgeFileError('Document processing failed');
      for (let indexOfChunk = 0; indexOfChunk < stored.length; indexOfChunk += 1) {
        const chunk = stored[indexOfChunk];
        const vector = vectors[indexOfChunk];
        if (!chunk || !vector) throw new KnowledgeFileError('Document processing failed');
        const literal = vectorLiteral(vector.vector);
        await tx.$executeRaw`
          INSERT INTO knowledge_embeddings (tenant_id, chunk_id, model, dimensions, embedding)
          VALUES (${input.tenantId}::uuid, ${chunk.id}::uuid, ${vector.model}, ${vector.dimensions}, ${literal}::vector)
          ON CONFLICT (tenant_id, chunk_id) DO NOTHING
        `;
      }
      await tx.knowledgeDocument.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.documentId } },
        data: { status: 'INDEXED', semanticStatus: 'INDEXED', embeddingModel: model },
      });
      await tx.knowledgeDocument.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.documentId } },
        data: { status: 'PENDING_APPROVAL' },
      });
    });
    await settleOutbox(prisma, input.tenantId, input.outboxId, 'PROCESSED');
    return { status: 'PENDING_APPROVAL', failureReason: null, semanticStatus: vectors ? 'INDEXED' : 'UNAVAILABLE' };
  } catch (error) {
    const failureReason = error instanceof KnowledgeFileError ? error.message : 'Document processing failed';
    await withTenant(prisma, input.tenantId, (tx) =>
      tx.knowledgeDocument.updateMany({
        where: { tenantId: input.tenantId, id: input.documentId, status: { in: ['PROCESSING', 'EXTRACTED', 'INDEXED'] } },
        data: { status: 'FAILED', failureReason, semanticStatus: 'UNAVAILABLE' },
      }),
    ).catch(() => undefined);
    await settleOutbox(prisma, input.tenantId, input.outboxId, 'FAILED');
    return { status: 'FAILED', failureReason, semanticStatus: 'UNAVAILABLE' };
  }
}

export async function purgeKnowledgeContent(
  prisma: PrismaClient,
  tenantId: string,
  documentId: string,
  remove: (storageKey: string) => Promise<void>,
): Promise<void> {
  const document = await withTenant(prisma, tenantId, (tx) =>
    tx.knowledgeDocument.findUnique({ where: { tenantId_id: { tenantId, id: documentId } } }),
  );
  if (!document) return;
  await remove(document.storageKey).catch(() => undefined);
  await withTenant(prisma, tenantId, async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { tenantId, documentId } });
    await tx.knowledgeDocument.update({
      where: { tenantId_id: { tenantId, id: documentId } },
      data: {
        status: 'DELETED',
        byteSize: 0,
        sha256: `deleted:${documentId}`,
        deletedAt: document.deletedAt ?? new Date(),
        retainUntil: null,
        semanticStatus: 'UNAVAILABLE',
        embeddingModel: null,
        failureReason: null,
      },
    });
  });
}

async function embedChunks(contents: string[], embed: (text: string) => Promise<EmbeddingVector | null>): Promise<EmbeddingVector[] | null> {
  const vectors: EmbeddingVector[] = [];
  for (const content of contents) {
    const vector = await embed(content);
    if (!vector) return null;
    vectors.push(vector);
  }
  return vectors;
}

function vectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
    throw new KnowledgeFileError('Embedding dimensions are incompatible with the index');
  }
  return `[${vector.map((value) => Number(value).toString()).join(',')}]`;
}

async function settleOutbox(prisma: PrismaClient, tenantId: string, outboxId: string | undefined, status: 'PROCESSED' | 'FAILED'): Promise<void> {
  if (!outboxId) return;
  await withTenant(prisma, tenantId, (tx) =>
    tx.outboxEvent.updateMany({
      where: { tenantId, id: outboxId, status: 'PENDING' },
      data: { status, processedAt: new Date(), attempts: { increment: 1 } },
    }),
  );
}

export async function listDueKnowledgeDeletions(prisma: PrismaClient): Promise<Array<{ tenant_id: string; id: string }>> {
  return prisma.$queryRaw<Array<{ tenant_id: string; id: string }>>(Prisma.sql`SELECT * FROM public.list_due_knowledge_deletions(25)`);
}
