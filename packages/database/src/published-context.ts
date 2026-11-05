import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { parseSnapshot } from '@salesos/shared';

export type PinnedCitation = {
  chunkId: string;
  documentId: string;
  fileName: string;
  section: string | null;
  excerpt: string;
};

export type PinnedContext = {
  productId: string;
  productName: string;
  versionId: string;
  versionNumber: number;
  icps: Array<{ id: string; name: string; priority: number }>;
  positioning: { valuePropositions: string[]; capabilities: string[]; restrictedClaims: string[] };
  citations: PinnedCitation[];
  retrievedAt: string;
};

export class ContextError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function loadPublishedContext(tx: Prisma.TransactionClient, tenantId: string, productId: string, versionId?: string): Promise<{ context: PinnedContext; sha256: string }> {
  const product = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id: productId } } });
  if (!product || product.status === 'ARCHIVED') throw new ContextError(404, 'Product was not found');
  const version = versionId
    ? await tx.productVersion.findUnique({ where: { tenantId_id: { tenantId, id: versionId } } })
    : await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' } });
  if (!version || version.productId !== productId) throw new ContextError(404, 'Published version was not found');
  if (version.status !== 'PUBLISHED') throw new ContextError(409, 'Live runs require a published version');
  const snapshot = parseSnapshot(version.snapshot);
  const approved = await tx.knowledgeDocument.findMany({
    where: { tenantId, productId, status: 'APPROVED', deletedAt: null, id: { in: snapshot.knowledgeDocumentIds } },
    select: { id: true, fileName: true },
  });
  const allowed = new Set(approved.map((row) => row.id));
  const chunks = allowed.size
    ? await tx.knowledgeChunk.findMany({
      where: { tenantId, productId, documentId: { in: [...allowed] } },
      orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
      take: 5,
    })
    : [];
  const names = new Map(approved.map((row) => [row.id, row.fileName]));
  const context: PinnedContext = {
    productId,
    productName: product.name,
    versionId: version.id,
    versionNumber: version.versionNumber,
    icps: snapshot.icps.filter((icp) => !icp.archived).sort((left, right) => left.priority - right.priority).slice(0, 20).map((icp) => ({ id: icp.id, name: icp.name, priority: icp.priority })),
    positioning: {
      valuePropositions: snapshot.positioning.valuePropositions.slice(0, 12),
      capabilities: snapshot.positioning.capabilities.slice(0, 12),
      restrictedClaims: snapshot.positioning.restrictedClaims.slice(0, 12),
    },
    citations: chunks.map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      fileName: names.get(chunk.documentId) || 'document',
      section: chunk.section,
      excerpt: chunk.content.slice(0, 400),
    })),
    retrievedAt: new Date().toISOString(),
  };
  return { context, sha256: createHash('sha256').update(JSON.stringify(context)).digest('hex') };
}
