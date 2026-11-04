import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, ingestKnowledgeDocument, purgeKnowledgeContent, withTenant } from '@salesos/database';
import {
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_PROCESS_EVENT,
  KNOWLEDGE_PROCESS_JOB,
  KnowledgeFileError,
  agentPricing,
  assertKnowledgeBytes,
  canTransitionVersion,
  changedSnapshotKeys,
  deletePrivateObject,
  embedText,
  embeddingProviderFromEnv,
  emptySnapshot,
  foundationJobId,
  icpSchema,
  knowledgeObjectKey,
  mergeProductContext,
  parseSnapshot,
  positioningSchema,
  pricingSchema,
  readPrivateObject,
  sha256,
  snapshotSchema,
  storageRootFromEnv,
  writePrivateObject,
  type EmbeddingVector,
  type IcpDefinition,
  type Positioning,
  type Pricing,
  type ProductSnapshot,
  type ProductVersionStatus,
} from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { runBatch } from '../common/batch';
import { AppConfig } from '../config/app-config';
import type { SessionContext } from '../identity/identity.service';
import { IdentityDatabase } from '../identity/identity-database.service';
import { FoundationQueue } from '../jobs/queue.provider';
import { DatabaseService } from '../database/database.service';
import type {
  ContextPreviewDto,
  CreateProductDto,
  IcpBody,
  ListProductsQuery,
  ProductBody,
  ProductDefaultsDto,
  SearchKnowledgeDto,
  UpdateVersionDto,
  UploadDocumentDto,
} from './products.dto';

type ProductRecord = {
  tenantId: string;
  id: string;
  name: string;
  productType: string;
  category: string;
  shortDescription: string;
  detailedDescription: string;
  website: string;
  status: string;
  tags: string[];
  targetMarkets: string[];
  languages: string[];
  currency: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

type VersionRecord = {
  id: string;
  productId: string;
  versionNumber: number;
  status: string;
  revision: number;
  snapshot: Prisma.JsonValue;
  publishedAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentRecord = {
  id: string;
  productId: string;
  versionId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  status: string;
  failureReason: string | null;
  semanticStatus: string;
  embeddingModel: string | null;
  pageCount: number | null;
  replacesDocumentId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  retainUntil: Date | null;
};

type Citation = {
  chunkId: string;
  documentId: string;
  fileName: string;
  page: number | null;
  section: string | null;
  content: string;
  score: number | null;
};

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdentityDatabase) private readonly identity: IdentityDatabase,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(FoundationQueue) private readonly queues: FoundationQueue,
  ) {}

  async list(actor: SessionContext, query: ListProductsQuery) {
    const tenantId = this.tenant(actor);
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const where = {
        tenantId,
        status: query.status ?? 'ACTIVE',
        ...(query.productType ? { productType: query.productType } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' as const } },
                { category: { contains: query.q, mode: 'insensitive' as const } },
                { shortDescription: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const sortField = query.sortBy ?? 'updatedAt';
      const sortDirection = query.sortDirection ?? 'desc';
      const total = await tx.product.count({ where });
      const rows = await tx.product.findMany({
        where,
        orderBy: [{ [sortField]: sortDirection }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: rows.map(publicProduct), page, pageSize, total };
    });
  }

  async create(actor: SessionContext, input: CreateProductDto, requestId: string) {
    const tenantId = this.tenant(actor);
    const currency = await this.currencyFor(tenantId, input.currency);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          ...productData(input, currency),
          name: input.name.trim(),
          productType: input.productType,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });
      const version = await tx.productVersion.create({
        data: {
          tenantId,
          productId: product.id,
          versionNumber: 1,
          status: 'DRAFT',
          snapshot: emptySnapshot(product.currency.trim()) as Prisma.InputJsonValue,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'product.create', 'product', product.id, requestId, { versionId: version.id });
      return { ...publicProduct(product), draftVersionId: version.id };
    });
  }

  async get(actor: SessionContext, productId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const product = await this.product(tx, tenantId, productId);
      const published = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'PUBLISHED' } });
      const draft = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'DRAFT' } });
      return { ...publicProduct(product), publishedVersionId: published?.id ?? null, draftVersionId: draft?.id ?? null };
    });
  }

  async update(actor: SessionContext, productId: string, input: ProductBody, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await this.writableProduct(tx, tenantId, productId);
      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
        throw new ApiException(409, 'CONFLICT', 'This record changed since you opened it. Reload and try again.');
      }
      const currency = input.currency ? normalizeCurrency(input.currency) : current.currency.trim();
      const product = await tx.product.update({
        where: { tenantId_id: { tenantId, id: productId } },
        data: { ...productData(input, currency), updatedBy: actor.userId },
      });
      await this.audit(tx, tenantId, actor.userId, 'product.update', 'product', productId, requestId, {});
      return publicProduct(product);
    });
  }

  async duplicate(actor: SessionContext, productId: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await this.product(tx, tenantId, productId);
      const source = await this.preferredSnapshot(tx, tenantId, productId);
      const product = await tx.product.create({
        data: {
          tenantId,
          name: `${current.name} copy`.slice(0, 160),
          productType: current.productType,
          category: current.category,
          shortDescription: current.shortDescription,
          detailedDescription: current.detailedDescription,
          website: current.website,
          tags: current.tags,
          targetMarkets: current.targetMarkets,
          languages: current.languages,
          currency: current.currency,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });
      const snapshot = parseSnapshot(source);
      snapshot.knowledgeDocumentIds = [];
      const version = await tx.productVersion.create({
        data: {
          tenantId,
          productId: product.id,
          versionNumber: 1,
          status: 'DRAFT',
          snapshot: snapshot as Prisma.InputJsonValue,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'product.duplicate', 'product', product.id, requestId, { sourceProductId: productId });
      return { ...publicProduct(product), draftVersionId: version.id };
    });
  }

  async archive(actor: SessionContext, productId: string, requestId: string) {
    return this.setProductStatus(actor, productId, 'ARCHIVED', requestId);
  }

  async restore(actor: SessionContext, productId: string, requestId: string) {
    return this.setProductStatus(actor, productId, 'ACTIVE', requestId);
  }

  async activity(actor: SessionContext, productId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const versions = await tx.productVersion.findMany({ where: { tenantId, productId }, select: { id: true } });
      const documents = await tx.knowledgeDocument.findMany({ where: { tenantId, productId }, select: { id: true } });
      const entityIds = [productId, ...versions.map((row) => row.id), ...documents.map((row) => row.id)];
      const events = await tx.auditEvent.findMany({
        where: { tenantId, entityId: { in: entityIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100,
      });
      return events.map((event) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
        createdAt: event.createdAt,
      }));
    });
  }

  async listVersions(actor: SessionContext, productId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const versions = await tx.productVersion.findMany({
        where: { tenantId, productId },
        orderBy: { versionNumber: 'desc' },
      });
      return versions.map((version) => publicVersion(version, this.canReadSnapshot(actor, version.status)));
    });
  }

  async createVersion(actor: SessionContext, productId: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      return publicVersion(await this.openDraft(tx, tenantId, productId, actor.userId, requestId, null), true);
    });
  }

  async getVersion(actor: SessionContext, productId: string, versionId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const version = await this.version(tx, tenantId, productId, versionId);
      return publicVersion(version, this.canReadSnapshot(actor, version.status));
    });
  }

  async updateVersion(actor: SessionContext, productId: string, versionId: string, input: UpdateVersionDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const version = await this.version(tx, tenantId, productId, versionId);
      if (version.status !== 'DRAFT') throw new ApiException(409, 'CONFLICT', 'Only a draft version can be edited');
      const current = parseSnapshot(version.snapshot);
      const next = snapshotSchema.parse({
        ...current,
        icps: input.icps ? input.icps.map((icp) => icpSchema.parse(icp)) : current.icps,
        positioning: input.positioning ? positioningSchema.parse({ ...current.positioning, ...input.positioning }) : current.positioning,
        pricing: input.pricing ? pricingSchema.parse({ ...current.pricing, ...input.pricing }) : current.pricing,
        knowledgeDocumentIds: current.knowledgeDocumentIds,
      });
      const saved = await tx.productVersion.updateMany({
        where: { tenantId, id: versionId, productId, status: 'DRAFT', revision: input.revision },
        data: { snapshot: next as Prisma.InputJsonValue, revision: { increment: 1 }, updatedBy: actor.userId },
      });
      if (saved.count !== 1) throw new ApiException(409, 'CONFLICT', 'The draft was updated by someone else');
      await this.audit(tx, tenantId, actor.userId, 'product_version.update', 'product_version', versionId, requestId, { productId });
      const fresh = await this.version(tx, tenantId, productId, versionId);
      return publicVersion(fresh, true);
    });
  }

  async compare(actor: SessionContext, productId: string, versionId: string, against: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const left = await this.version(tx, tenantId, productId, versionId);
      const right = await this.version(tx, tenantId, productId, against);
      if (!this.canReadSnapshot(actor, left.status) || !this.canReadSnapshot(actor, right.status)) {
        throw new ApiException(403, 'FORBIDDEN', 'Draft versions are visible to editors');
      }
      const leftSnapshot = parseSnapshot(left.snapshot);
      const rightSnapshot = parseSnapshot(right.snapshot);
      return {
        left: { id: left.id, versionNumber: left.versionNumber, status: left.status },
        right: { id: right.id, versionNumber: right.versionNumber, status: right.status },
        changed: changedSnapshotKeys(leftSnapshot, rightSnapshot),
      };
    });
  }

  async transition(actor: SessionContext, productId: string, versionId: string, to: ProductVersionStatus, requestId: string, reason?: string) {
    const tenantId = this.tenant(actor);
    this.assertTransitionPermission(actor, to);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (to === 'PUBLISHED') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${productId}))`;
      }
      const version = await this.version(tx, tenantId, productId, versionId);
      if (!canTransitionVersion(version.status as ProductVersionStatus, to)) {
        throw new ApiException(409, 'CONFLICT', `A ${version.status} version cannot move to ${to}`);
      }
      if (to === 'PUBLISHED') {
        const approved = await tx.knowledgeDocument.findMany({
          where: { tenantId, productId, status: 'APPROVED' },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        const snapshot = parseSnapshot(version.snapshot);
        snapshot.knowledgeDocumentIds = approved.map((document) => document.id);
        await tx.productVersion.updateMany({
          where: { tenantId, productId, status: 'PUBLISHED' },
          data: { status: 'SUPERSEDED', updatedBy: actor.userId },
        });
        const published = await tx.productVersion.updateMany({
          where: { tenantId, id: versionId, status: 'APPROVED' },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            snapshot: snapshot as Prisma.InputJsonValue,
            updatedBy: actor.userId,
          },
        });
        if (published.count !== 1) throw new ApiException(409, 'CONFLICT', 'The version was already published');
      } else {
        const moved = await tx.productVersion.updateMany({
          where: { tenantId, id: versionId, status: version.status },
          data: { status: to, updatedBy: actor.userId },
        });
        if (moved.count !== 1) throw new ApiException(409, 'CONFLICT', 'The version status changed concurrently');
      }
      await this.audit(tx, tenantId, actor.userId, `product_version.${to.toLowerCase()}`, 'product_version', versionId, requestId, {
        productId,
        from: version.status,
        reason: reason ?? null,
      });
      return publicVersion(await this.version(tx, tenantId, productId, versionId), this.canReadSnapshot(actor, to));
    });
  }

  async restoreVersion(actor: SessionContext, productId: string, versionId: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const source = await this.version(tx, tenantId, productId, versionId);
      const draft = await this.openDraft(tx, tenantId, productId, actor.userId, requestId, parseSnapshot(source.snapshot));
      await this.audit(tx, tenantId, actor.userId, 'product_version.restore', 'product_version', draft.id, requestId, {
        productId,
        sourceVersionId: versionId,
      });
      return publicVersion(draft, true);
    });
  }

  async listIcps(actor: SessionContext, productId: string, versionId?: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const version = versionId
        ? await this.version(tx, tenantId, productId, versionId)
        : await this.readerVersion(tx, tenantId, productId, actor);
      if (!this.canReadSnapshot(actor, version.status)) throw new ApiException(403, 'FORBIDDEN', 'Draft versions are visible to editors');
      return parseSnapshot(version.snapshot).icps.sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
    });
  }

  async addIcp(actor: SessionContext, productId: string, input: IcpBody, requestId: string) {
    const icp = this.parseIcp({ ...input, id: randomUUID(), archived: false, priority: input.priority ?? 1, name: input.name });
    return this.mutateDraft(actor, productId, requestId, 'icp.create', (snapshot) => {
      snapshot.icps.push(icp);
      return snapshot;
    });
  }

  async updateIcp(actor: SessionContext, productId: string, icpId: string, input: IcpBody, requestId: string) {
    return this.mutateDraft(actor, productId, requestId, 'icp.update', (snapshot) => {
      const index = snapshot.icps.findIndex((icp) => icp.id === icpId);
      const current = snapshot.icps[index];
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'ICP was not found');
      snapshot.icps[index] = this.parseIcp({ ...current, ...input, id: icpId });
      return snapshot;
    });
  }

  async duplicateIcp(actor: SessionContext, productId: string, icpId: string, requestId: string) {
    return this.mutateDraft(actor, productId, requestId, 'icp.duplicate', (snapshot) => {
      const current = snapshot.icps.find((icp) => icp.id === icpId);
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'ICP was not found');
      snapshot.icps.push(this.parseIcp({ ...current, id: randomUUID(), name: `${current.name} copy`.slice(0, 160), archived: false }));
      return snapshot;
    });
  }

  async archiveIcp(actor: SessionContext, productId: string, icpId: string, requestId: string) {
    return this.mutateDraft(actor, productId, requestId, 'icp.archive', (snapshot) => {
      const current = snapshot.icps.find((icp) => icp.id === icpId);
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'ICP was not found');
      current.archived = true;
      return snapshot;
    });
  }

  async defaults(actor: SessionContext) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.organizationProductDefault.findUnique({ where: { tenantId } });
      return publicDefaults(row);
    });
  }

  async updateDefaults(actor: SessionContext, input: ProductDefaultsDto, requestId: string) {
    const tenantId = this.tenant(actor);
    const positioning = input.positioning ? positioningSchema.partial().parse(input.positioning) : undefined;
    const pricing = input.pricing ? pricingSchema.partial().parse(input.pricing) : undefined;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.organizationProductDefault.findUnique({ where: { tenantId } });
      if (input.expectedUpdatedAt && (!current || new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime())) {
        throw new ApiException(409, 'CONFLICT', 'This record changed since you opened it. Reload and try again.');
      }
      const row = await tx.organizationProductDefault.upsert({
        where: { tenantId },
        create: {
          tenantId,
          positioning: (positioning ?? {}) as Prisma.InputJsonValue,
          pricing: (pricing ?? {}) as Prisma.InputJsonValue,
          knowledgeRetentionDays: input.knowledgeRetentionDays ?? 0,
          updatedBy: actor.userId,
        },
        update: {
          positioning: (positioning ?? current?.positioning ?? {}) as Prisma.InputJsonValue,
          pricing: (pricing ?? current?.pricing ?? {}) as Prisma.InputJsonValue,
          knowledgeRetentionDays: input.knowledgeRetentionDays ?? current?.knowledgeRetentionDays ?? 0,
          updatedBy: actor.userId,
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'product_defaults.update', 'organization_product_defaults', tenantId, requestId, {});
      return publicDefaults(row);
    });
  }

  async upload(actor: SessionContext, productId: string, input: UploadDocumentDto, requestId: string) {
    const tenantId = this.tenant(actor);
    const bytes = Buffer.from(input.contentBase64, 'base64');
    let checked: { contentType: string };
    try {
      checked = assertKnowledgeBytes(input.fileName, bytes, this.config.env.SALESOS_KNOWLEDGE_MAX_BYTES);
    } catch (error) {
      throw fileError(error);
    }
    const digest = sha256(bytes);
    const created = await withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const duplicate = await tx.knowledgeDocument.findUnique({ where: { tenantId_sha256: { tenantId, sha256: digest } } });
      if (duplicate && duplicate.status !== 'DELETED') {
        throw new ApiException(409, 'CONFLICT', 'This file has already been uploaded for the organization');
      }
      if (input.replacesDocumentId) {
        const replaced = await tx.knowledgeDocument.findFirst({ where: { tenantId, id: input.replacesDocumentId, productId } });
        if (!replaced) throw new ApiException(404, 'NOT_FOUND', 'The document being replaced was not found');
      }
      const draft = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'DRAFT' }, select: { id: true } });
      const document = await tx.knowledgeDocument.create({
        data: {
          tenantId,
          productId,
          versionId: draft?.id,
          fileName: input.fileName.trim(),
          contentType: checked.contentType,
          byteSize: bytes.length,
          sha256: digest,
          storageKey: 'pending',
          status: 'VALIDATING',
          replacesDocumentId: input.replacesDocumentId,
          createdBy: actor.userId,
        },
      });
      const storageKey = knowledgeObjectKey(tenantId, document.id);
      const ready = await tx.knowledgeDocument.update({
        where: { tenantId_id: { tenantId, id: document.id } },
        data: { storageKey, status: 'PROCESSING' },
      });
      const outbox = await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: KNOWLEDGE_PROCESS_EVENT,
          aggregateId: document.id,
          payload: { documentId: document.id, productId },
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'knowledge.upload', 'knowledge_document', document.id, requestId, {
        productId,
        byteSize: bytes.length,
        sha256: digest,
        replacesDocumentId: input.replacesDocumentId ?? null,
      });
      return { document: ready, outboxId: outbox.id };
    });
    try {
      await writePrivateObject(this.storageRoot(), created.document.storageKey, bytes);
    } catch {
      await this.markFailed(tenantId, created.document.id, 'Document storage failed');
      throw new ApiException(500, 'STORAGE_FAILED', 'Document storage failed');
    }
    if (this.config.env.SALESOS_PROCESS_KNOWLEDGE === 'inline') {
      await ingestKnowledgeDocument(this.database.prisma, {
        tenantId,
        documentId: created.document.id,
        bytes,
        maxBytes: this.config.env.SALESOS_KNOWLEDGE_MAX_BYTES,
        embed: (text) => this.embed(text),
        outboxId: created.outboxId,
      });
    } else {
      await this.queues.queue
        .add(
          KNOWLEDGE_PROCESS_JOB,
          { tenantId, documentId: created.document.id, outboxId: created.outboxId },
          { jobId: foundationJobId(tenantId, created.outboxId), attempts: 3, removeOnComplete: 1000, removeOnFail: 1000 },
        )
        .catch(() => undefined);
    }
    return this.document(actor, productId, created.document.id);
  }

  async documents(actor: SessionContext, productId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const rows = await tx.knowledgeDocument.findMany({
        where: { tenantId, productId, status: { not: 'DELETED' } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(publicDocument);
    });
  }

  async document(actor: SessionContext, productId: string, documentId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await this.visibleDocument(tx, tenantId, productId, documentId);
      const chunks = await tx.knowledgeChunk.findMany({
        where: { tenantId, documentId },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, chunkIndex: true, content: true, page: true, section: true },
      });
      return { ...publicDocument(row), chunks };
    });
  }

  async download(actor: SessionContext, productId: string, documentId: string) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => this.visibleDocument(tx, tenantId, productId, documentId));
    if (row.byteSize === 0) throw new ApiException(404, 'NOT_FOUND', 'Document content has been deleted');
    try {
      const bytes = await readPrivateObject(this.storageRoot(), row.storageKey);
      return { fileName: row.fileName.replace(/[^A-Za-z0-9._-]/g, '_'), contentType: row.contentType, bytes };
    } catch {
      throw new ApiException(404, 'NOT_FOUND', 'Document content is unavailable');
    }
  }

  async reviewDocument(actor: SessionContext, productId: string, documentId: string, decision: 'APPROVED' | 'REJECTED', requestId: string, reason?: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await this.visibleDocument(tx, tenantId, productId, documentId);
      if (row.status !== 'PENDING_APPROVAL') throw new ApiException(409, 'CONFLICT', 'Only a document awaiting approval can be reviewed');
      await tx.knowledgeDocument.update({
        where: { tenantId_id: { tenantId, id: documentId } },
        data: decision === 'APPROVED'
          ? { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date(), rejectedReason: null }
          : { status: 'REJECTED', rejectedReason: reason ?? 'Rejected', approvedBy: null, approvedAt: null },
      });
      await this.audit(tx, tenantId, actor.userId, decision === 'APPROVED' ? 'knowledge.approve' : 'knowledge.reject', 'knowledge_document', documentId, requestId, {
        productId,
        reason: reason ?? null,
      });
      return publicDocument(await this.visibleDocument(tx, tenantId, productId, documentId));
    });
  }

  async reprocess(actor: SessionContext, productId: string, documentId: string, requestId: string, retry: boolean) {
    const tenantId = this.tenant(actor);
    const queued = await withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const row = await this.visibleDocument(tx, tenantId, productId, documentId);
      const allowed = retry ? ['FAILED'] : ['FAILED', 'EXTRACTED', 'INDEXED', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'];
      if (!allowed.includes(row.status)) throw new ApiException(409, 'CONFLICT', 'This document cannot be processed again');
      await tx.knowledgeChunk.deleteMany({ where: { tenantId, documentId } });
      await tx.knowledgeDocument.update({
        where: { tenantId_id: { tenantId, id: documentId } },
        data: { status: 'PROCESSING', failureReason: null, semanticStatus: 'UNAVAILABLE', embeddingModel: null, approvedBy: null, approvedAt: null, rejectedReason: null },
      });
      const outbox = await tx.outboxEvent.create({
        data: { tenantId, eventType: KNOWLEDGE_PROCESS_EVENT, aggregateId: documentId, payload: { documentId, productId } },
      });
      await this.audit(tx, tenantId, actor.userId, retry ? 'knowledge.retry' : 'knowledge.reprocess', 'knowledge_document', documentId, requestId, { productId });
      return { storageKey: row.storageKey, outboxId: outbox.id };
    });
    const bytes = await readPrivateObject(this.storageRoot(), queued.storageKey).catch(() => null);
    if (!bytes) {
      await this.markFailed(tenantId, documentId, 'Document content is unavailable');
      return this.document(actor, productId, documentId);
    }
    if (this.config.env.SALESOS_PROCESS_KNOWLEDGE === 'inline') {
      await ingestKnowledgeDocument(this.database.prisma, {
        tenantId,
        documentId,
        bytes,
        maxBytes: this.config.env.SALESOS_KNOWLEDGE_MAX_BYTES,
        embed: (text) => this.embed(text),
        outboxId: queued.outboxId,
      });
    }
    return this.document(actor, productId, documentId);
  }

  async removeDocument(actor: SessionContext, productId: string, documentId: string, requestId: string) {
    const tenantId = this.tenant(actor);
    const decision = await withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const row = await this.visibleDocument(tx, tenantId, productId, documentId);
      const defaults = await tx.organizationProductDefault.findUnique({ where: { tenantId } });
      const days = defaults?.knowledgeRetentionDays ?? 0;
      await this.audit(tx, tenantId, actor.userId, 'knowledge.delete', 'knowledge_document', documentId, requestId, { productId, retentionDays: days });
      if (days > 0) {
        const retainUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        await tx.knowledgeDocument.update({
          where: { tenantId_id: { tenantId, id: documentId } },
          data: { status: 'DELETED', deletedAt: new Date(), retainUntil, sha256: `deleted:${documentId}` },
        });
        return { immediate: false, storageKey: row.storageKey };
      }
      return { immediate: true, storageKey: row.storageKey };
    });
    if (decision.immediate) {
      await purgeKnowledgeContent(this.database.prisma, tenantId, documentId, (key) => deletePrivateObject(this.storageRoot(), key));
    }
  }

  async search(actor: SessionContext, productId: string, input: SearchKnowledgeDto) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const approved = await tx.knowledgeDocument.findMany({
        where: { tenantId, productId, status: 'APPROVED' },
        select: { id: true },
      });
      const allowed = intersect(approved.map((row) => row.id), input.documentIds);
      return this.retrieve(tx, tenantId, productId, input.query, input.mode ?? 'keyword', allowed, input.limit ?? 5);
    });
  }

  async preview(actor: SessionContext, productId: string, input: ContextPreviewDto) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const product = await this.product(tx, tenantId, productId);
      const version = input.versionId
        ? await this.version(tx, tenantId, productId, input.versionId)
        : await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'PUBLISHED' } });
      if (!version) throw new ApiException(404, 'NOT_FOUND', 'No published version is available');
      if (!this.canReadSnapshot(actor, version.status)) throw new ApiException(403, 'FORBIDDEN', 'Draft versions are visible to editors');
      const snapshot = parseSnapshot(version.snapshot);
      const defaults = await tx.organizationProductDefault.findUnique({ where: { tenantId } });
      const merged = mergeProductContext(snapshot, {
        positioning: (defaults?.positioning ?? {}) as Partial<Positioning>,
        pricing: (defaults?.pricing ?? {}) as Partial<Pricing>,
      });
      const live = version.status === 'PUBLISHED';
      const approved = await tx.knowledgeDocument.findMany({
        where: { tenantId, productId, status: 'APPROVED' },
        select: { id: true },
      });
      const allowed = live ? intersect(snapshot.knowledgeDocumentIds, approved.map((row) => row.id)) : approved.map((row) => row.id);
      const retrieval = await this.retrieve(tx, tenantId, productId, input.query, input.mode ?? 'semantic', allowed, input.limit ?? 5);
      const pricing = agentPricing(merged.pricing);
      return {
        product: publicProduct(product),
        version: { id: version.id, versionNumber: version.versionNumber, status: version.status, publishedAt: version.publishedAt },
        liveAgentContext: live,
        positioning: merged.positioning,
        icps: snapshot.icps.filter((icp) => !icp.archived).sort((left, right) => left.priority - right.priority),
        capabilities: merged.positioning.capabilities,
        pricing,
        objections: merged.positioning.objections,
        restrictedClaims: merged.positioning.restrictedClaims,
        escalationConditions: merged.positioning.escalationConditions,
        approvalRequirements: merged.positioning.approvalRequirements,
        disallowedBuyers: merged.positioning.disallowedBuyers,
        chunks: retrieval.results,
        citations: retrieval.results.map((result) => ({
          chunkId: result.chunkId,
          documentId: result.documentId,
          fileName: result.fileName,
          page: result.page,
          section: result.section,
        })),
        provenance: {
          productId,
          versionId: version.id,
          versionNumber: version.versionNumber,
          documentIds: allowed,
          retrievalMode: retrieval.mode,
          embeddingModel: retrieval.embeddingModel,
          generatedAt: new Date().toISOString(),
        },
      };
    });
  }

  private async retrieve(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    query: string,
    requested: 'keyword' | 'semantic',
    allowed: string[],
    limit: number,
  ) {
    const bounded = Math.min(Math.max(limit, 1), 20);
    const provider = embeddingProviderFromEnv(process.env);
    const expectedModel = provider.kind === 'test' ? 'salesos-test-384' : provider.kind === 'http' ? provider.model : null;
    const index = await tx.embeddingIndex.findUnique({ where: { tenantId } });
    const semanticAvailable = Boolean(expectedModel && index && index.model === expectedModel && index.dimensions === EMBEDDING_DIMENSIONS);
    if (!allowed.length) {
      return { requestedMode: requested, mode: 'keyword' as const, semanticAvailable, embeddingModel: semanticAvailable ? index?.model ?? null : null, results: [] as Citation[] };
    }
    if (requested === 'semantic' && semanticAvailable && index) {
      const vector = await this.embed(query);
      if (vector && vector.model === index.model && vector.dimensions === EMBEDDING_DIMENSIONS) {
        const rows = await this.semanticRows(tx, tenantId, productId, allowed, vector, index.model, bounded);
        return { requestedMode: requested, mode: 'semantic' as const, semanticAvailable: true, embeddingModel: index.model, results: rows };
      }
    }
    const rows = await this.keywordRows(tx, tenantId, productId, allowed, query, bounded);
    return {
      requestedMode: requested,
      mode: 'keyword' as const,
      semanticAvailable: requested === 'semantic' ? false : semanticAvailable,
      embeddingModel: semanticAvailable ? index?.model ?? null : null,
      results: rows,
    };
  }

  private async semanticRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    allowed: string[],
    vector: EmbeddingVector,
    model: string,
    limit: number,
  ): Promise<Citation[]> {
    const literal = `[${vector.vector.map((value) => Number(value).toString()).join(',')}]`;
    const ids = Prisma.join(allowed.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<Array<{ id: string; document_id: string; file_name: string; page: number | null; section: string | null; content: string; score: number }>>`
      SELECT c.id, c.document_id, d.file_name, c.page, c.section, c.content,
             (1 - (e.embedding <=> ${literal}::vector))::float8 AS score
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      JOIN knowledge_embeddings e ON e.tenant_id = c.tenant_id AND e.chunk_id = c.id
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.product_id = ${productId}::uuid
        AND d.tenant_id = ${tenantId}::uuid
        AND d.status = 'APPROVED'
        AND d.id IN (${ids})
        AND e.model = ${model}
        AND e.dimensions = ${EMBEDDING_DIMENSIONS}
      ORDER BY e.embedding <=> ${literal}::vector, c.id
      LIMIT ${limit}
    `;
    return rows.map(citation);
  }

  private async keywordRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    allowed: string[],
    query: string,
    limit: number,
  ): Promise<Citation[]> {
    const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const ids = Prisma.join(allowed.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<Array<{ id: string; document_id: string; file_name: string; page: number | null; section: string | null; content: string }>>`
      SELECT c.id, c.document_id, d.file_name, c.page, c.section, c.content
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      WHERE c.tenant_id = ${tenantId}::uuid
        AND c.product_id = ${productId}::uuid
        AND d.tenant_id = ${tenantId}::uuid
        AND d.status = 'APPROVED'
        AND d.id IN (${ids})
        AND c.content ILIKE ${like} ESCAPE '\\'
      ORDER BY c.chunk_index, c.id
      LIMIT ${limit}
    `;
    return rows.map((row) => citation({ ...row, score: null }));
  }

  async getIcp(actor: SessionContext, productId: string, icpId: string) {
    const rows = await this.listIcps(actor, productId);
    const icp = rows.find((row) => row.id === icpId);
    if (!icp) throw new ApiException(404, 'NOT_FOUND', 'ICP was not found');
    return icp;
  }

  async documentPage(actor: SessionContext, productId: string, query: DocumentPageQuery) {
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sorts = { fileName: 'fileName', status: 'status', createdAt: 'createdAt', updatedAt: 'updatedAt' } as const;
    const sortField = sorts[query.sortBy ?? 'createdAt'];
    const sortDirection = query.sortDirection ?? 'desc';
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const status = query.status === 'DELETED' && !actor.permissions.includes('products.write')
        ? { not: 'DELETED' as const }
        : query.status ?? { not: 'DELETED' as const };
      const fileName = query.q || query.fileType
        ? { contains: query.q || undefined, endsWith: query.fileType ? `.${query.fileType}` : undefined, mode: 'insensitive' as const }
        : undefined;
      const where = {
        tenantId,
        productId,
        status,
        fileName,
        createdAt: query.createdAfter || query.createdBefore
          ? { gte: query.createdAfter ? new Date(query.createdAfter) : undefined, lte: query.createdBefore ? new Date(query.createdBefore) : undefined }
          : undefined,
      };
      const total = await tx.knowledgeDocument.count({ where });
      const rows = await tx.knowledgeDocument.findMany({
        where,
        orderBy: [{ [sortField]: sortDirection }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: rows.map(publicDocument), page, pageSize, total };
    });
  }

  async versionPage(actor: SessionContext, productId: string, query: { page?: number; pageSize?: number; status?: string; sortDirection?: 'asc' | 'desc' }) {
    const versions = await this.listVersions(actor, productId);
    const filtered = query.status ? versions.filter((version) => version.status === query.status) : versions;
    const direction = query.sortDirection === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((left, right) => direction * (left.versionNumber - right.versionNumber) || left.id.localeCompare(right.id));
    return pageOf(sorted, query.page, query.pageSize);
  }

  async icpPage(actor: SessionContext, productId: string, query: { page?: number; pageSize?: number; q?: string; archived?: boolean; sortBy?: 'name' | 'priority'; sortDirection?: 'asc' | 'desc' }) {
    const rows = await this.listIcps(actor, productId);
    const filtered = rows.filter((icp) => {
      if (query.archived === false && icp.archived) return false;
      if (query.archived === true && !icp.archived) return false;
      if (!query.q) return true;
      return icp.name.toLowerCase().includes(query.q.toLowerCase());
    });
    const direction = query.sortDirection === 'desc' ? -1 : 1;
    const sorted = [...filtered].sort((left, right) => {
      const primary = query.sortBy === 'name' ? left.name.localeCompare(right.name) : left.priority - right.priority;
      return direction * primary || left.id.localeCompare(right.id);
    });
    return pageOf(sorted, query.page, query.pageSize);
  }

  bulkArchive(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.archive(actor, id, requestId));
  }

  bulkRestore(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.restore(actor, id, requestId));
  }

  bulkArchiveIcps(actor: SessionContext, productId: string, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.archiveIcp(actor, productId, id, requestId));
  }

  bulkRemoveDocuments(actor: SessionContext, productId: string, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.removeDocument(actor, productId, id, requestId));
  }

  bulkApproveDocuments(actor: SessionContext, productId: string, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.reviewDocument(actor, productId, id, 'APPROVED', requestId));
  }

  private async setProductStatus(actor: SessionContext, productId: string, status: 'ACTIVE' | 'ARCHIVED', requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.product(tx, tenantId, productId);
      const product = await tx.product.update({
        where: { tenantId_id: { tenantId, id: productId } },
        data: { status, archivedAt: status === 'ARCHIVED' ? new Date() : null, updatedBy: actor.userId },
      });
      await this.audit(tx, tenantId, actor.userId, status === 'ARCHIVED' ? 'product.archive' : 'product.restore', 'product', productId, requestId, {});
      return publicProduct(product);
    });
  }

  private async mutateDraft(actor: SessionContext, productId: string, requestId: string, action: string, change: (snapshot: ProductSnapshot) => ProductSnapshot) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.writableProduct(tx, tenantId, productId);
      const draft = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'DRAFT' } });
      if (!draft) throw new ApiException(409, 'CONFLICT', 'Open a draft before editing an ICP');
      const next = snapshotSchema.parse(change(parseSnapshot(draft.snapshot)));
      const saved = await tx.productVersion.updateMany({
        where: { tenantId, id: draft.id, status: 'DRAFT', revision: draft.revision },
        data: { snapshot: next as Prisma.InputJsonValue, revision: { increment: 1 }, updatedBy: actor.userId },
      });
      if (saved.count !== 1) throw new ApiException(409, 'CONFLICT', 'The draft was updated by someone else');
      await this.audit(tx, tenantId, actor.userId, action, 'product_version', draft.id, requestId, { productId });
      return next.icps;
    });
  }

  private async openDraft(tx: Prisma.TransactionClient, tenantId: string, productId: string, userId: string, requestId: string, snapshot: ProductSnapshot | null) {
    const existing = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'DRAFT' } });
    if (existing) throw new ApiException(409, 'CONFLICT', 'A draft is already open');
    const latest = await tx.productVersion.findFirst({ where: { tenantId, productId }, orderBy: { versionNumber: 'desc' } });
    const source = snapshot ?? parseSnapshot((await this.preferredSnapshot(tx, tenantId, productId)));
    source.knowledgeDocumentIds = [];
    const draft = await tx.productVersion.create({
      data: {
        tenantId,
        productId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        status: 'DRAFT',
        snapshot: source as Prisma.InputJsonValue,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tx, tenantId, userId, 'product_version.create', 'product_version', draft.id, requestId, { productId });
    return draft;
  }

  private async preferredSnapshot(tx: Prisma.TransactionClient, tenantId: string, productId: string): Promise<Prisma.JsonValue> {
    const published = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'PUBLISHED' } });
    if (published) return published.snapshot;
    const latest = await tx.productVersion.findFirst({ where: { tenantId, productId }, orderBy: { versionNumber: 'desc' } });
    return latest?.snapshot ?? emptySnapshot();
  }

  private async readerVersion(tx: Prisma.TransactionClient, tenantId: string, productId: string, actor: SessionContext) {
    if (actor.permissions.includes('products.write')) {
      const draft = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'DRAFT' } });
      if (draft) return draft;
    }
    const published = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'PUBLISHED' } });
    if (!published) throw new ApiException(404, 'NOT_FOUND', 'No published version is available');
    return published;
  }

  private async product(tx: Prisma.TransactionClient, tenantId: string, productId: string): Promise<ProductRecord> {
    const product = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id: productId } } });
    if (!product) throw new ApiException(404, 'NOT_FOUND', 'Product was not found');
    return product;
  }

  private async writableProduct(tx: Prisma.TransactionClient, tenantId: string, productId: string) {
    const product = await this.product(tx, tenantId, productId);
    if (product.status === 'ARCHIVED') throw new ApiException(409, 'CONFLICT', 'Restore the product before editing it');
    return product;
  }

  private async version(tx: Prisma.TransactionClient, tenantId: string, productId: string, versionId: string): Promise<VersionRecord> {
    const version = await tx.productVersion.findFirst({ where: { tenantId, id: versionId, productId } });
    if (!version) throw new ApiException(404, 'NOT_FOUND', 'Product version was not found');
    return version;
  }

  private async visibleDocument(tx: Prisma.TransactionClient, tenantId: string, productId: string, documentId: string): Promise<DocumentRecord> {
    const document = await tx.knowledgeDocument.findFirst({ where: { tenantId, id: documentId, productId } });
    if (!document || document.status === 'DELETED') throw new ApiException(404, 'NOT_FOUND', 'Document was not found');
    return document;
  }

  private async currencyFor(tenantId: string, requested?: string): Promise<string> {
    if (requested) return normalizeCurrency(requested);
    const tenant = await this.identity.prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true, status: true } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an active organization first');
    return tenant.currency.trim();
  }

  private async markFailed(tenantId: string, documentId: string, failureReason: string) {
    await withTenant(this.database.prisma, tenantId, (tx) =>
      tx.knowledgeDocument.updateMany({
        where: { tenantId, id: documentId },
        data: { status: 'FAILED', failureReason },
      }),
    );
  }

  private embed(text: string): Promise<EmbeddingVector | null> {
    return embedText(embeddingProviderFromEnv(process.env), text);
  }

  private storageRoot(): string {
    return storageRootFromEnv(process.env);
  }

  private tenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }

  private canReadSnapshot(actor: SessionContext, status: string): boolean {
    return status === 'PUBLISHED' || status === 'SUPERSEDED' || actor.permissions.includes('products.write');
  }

  private assertTransitionPermission(actor: SessionContext, to: ProductVersionStatus): void {
    if (to === 'PUBLISHED' && !actor.permissions.includes('products.publish')) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    if ((to === 'APPROVED' || to === 'REJECTED') && !actor.permissions.includes('approvals.manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    if ((to === 'IN_REVIEW' || to === 'ARCHIVED') && !actor.permissions.includes('products.write')) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
  }

  private parseIcp(value: unknown): IcpDefinition {
    const parsed = icpSchema.safeParse(value);
    if (!parsed.success) throw new ApiException(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || 'ICP is not valid');
    return parsed.data;
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    requestId: string,
    payload: Prisma.InputJsonObject,
  ) {
    return tx.auditEvent.create({
      data: { tenantId, actorType: 'user', actorId, action, entityType, entityId, payload: { ...payload, requestId } },
    });
  }
}

function productData(input: ProductBody | CreateProductDto, currency: string) {
  return {
    name: input.name?.trim(),
    productType: input.productType,
    category: input.category?.trim(),
    shortDescription: input.shortDescription?.trim(),
    detailedDescription: input.detailedDescription?.trim(),
    website: input.website === undefined ? undefined : assertWebsite(input.website),
    tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
    targetMarkets: input.targetMarkets?.map((market) => market.trim()).filter(Boolean),
    languages: input.languages?.map((language) => language.trim()).filter(Boolean),
    currency,
  };
}

function assertWebsite(value: string): string {
  const website = value.trim();
  if (!website) return '';
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Product website must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Product website must be an http(s) URL');
  }
  return website;
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiException(400, 'VALIDATION_ERROR', 'Currency must be a three-letter code');
  return currency;
}

function publicProduct(row: ProductRecord) {
  return {
    id: row.id,
    organizationId: row.tenantId,
    name: row.name,
    productType: row.productType,
    category: row.category,
    shortDescription: row.shortDescription,
    detailedDescription: row.detailedDescription,
    website: row.website,
    status: row.status,
    tags: row.tags,
    targetMarkets: row.targetMarkets,
    languages: row.languages,
    currency: row.currency.trim(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

function publicVersion(row: VersionRecord, includeSnapshot: boolean) {
  return {
    id: row.id,
    productId: row.productId,
    versionNumber: row.versionNumber,
    status: row.status,
    revision: row.revision,
    publishedAt: row.publishedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    snapshot: includeSnapshot ? parseSnapshot(row.snapshot) : null,
  };
}

function publicDocument(row: DocumentRecord) {
  return {
    id: row.id,
    productId: row.productId,
    versionId: row.versionId,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    status: row.status,
    failureReason: row.failureReason,
    semanticStatus: row.semanticStatus,
    embeddingModel: row.embeddingModel,
    pageCount: row.pageCount,
    replacesDocumentId: row.replacesDocumentId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    retainUntil: row.retainUntil,
  };
}

function publicDefaults(row: { positioning: Prisma.JsonValue; pricing: Prisma.JsonValue; knowledgeRetentionDays: number; updatedAt?: Date } | null) {
  return {
    positioning: row?.positioning ?? {},
    pricing: row?.pricing ?? {},
    knowledgeRetentionDays: row?.knowledgeRetentionDays ?? 0,
    updatedAt: row?.updatedAt ?? null,
    inheritance: 'Product values replace organization defaults when the product field is non-empty. Untouched product pricing uses the organization pricing default. ICP definitions belong to the product version.',
  };
}

function citation(row: { id: string; document_id: string; file_name: string; page: number | null; section: string | null; content: string; score: number | null }): Citation {
  return {
    chunkId: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    page: row.page,
    section: row.section,
    content: row.content,
    score: row.score,
  };
}

type DocumentPageQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  fileType?: string;
  sortBy?: 'fileName' | 'status' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  createdAfter?: string;
  createdBefore?: string;
};

function pageOf<T>(rows: T[], page = 1, pageSize = 20) {
  const size = Math.min(Math.max(pageSize, 1), 100);
  const current = Math.max(page, 1);
  const start = (current - 1) * size;
  return { items: rows.slice(start, start + size), page: current, pageSize: size, total: rows.length };
}

function intersect(left: string[], right: string[] | undefined): string[] {
  if (!right) return left;
  const allowed = new Set(right);
  return left.filter((id) => allowed.has(id));
}

function fileError(error: unknown): ApiException {
  if (error instanceof KnowledgeFileError) {
    const status = error.message.includes('size') ? 413 : error.message.includes('type') || error.message.includes('signature') || error.message.includes('Archive') || error.message.includes('Macro') ? 415 : 400;
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA' : 'VALIDATION_ERROR';
    return new ApiException(status, code, error.message);
  }
  return new ApiException(400, 'VALIDATION_ERROR', 'File is not valid');
}
