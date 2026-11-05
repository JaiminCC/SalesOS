import { Inject, Injectable } from '@nestjs/common';
import {
  CRM_IMPORT_EVENT,
  CRM_DISCOVERY_EVENT,
  CRM_QUALIFY_EVENT,
  CSV_LIMITS,
  DISCOVERY_PROVIDERS,
  IMPORT_FIELDS,
  POLICY_VERSION,
  canTransitionCrmLead,
  evaluateEligibility,
  evaluateQuietHours,
  externalDiscoveryAdapter,
  externalDiscoveryStatus,
  mapImportRow,
  neutralizeCsvFormula,
  normalizeDomain,
  normalizeEmail,
  parseCsv,
  type CrmLeadStage,
} from '@salesos/shared';
import {
  Prisma,
  decodeEncryptionKey,
  decryptField,
  emailHmac,
  encryptField,
  importCrmBatch,
  lockAssignableOwner,
  runCrmDiscovery,
  storeQualification,
  withTenant,
} from '@salesos/database';
import { AgentsService } from '../agents/agents.service';
import { ApiException } from '../common/api.exception';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import type {
  AccountBodyDto,
  AccountChangeDto,
  AccountListDto,
  AssignDto,
  BulkAssignDto,
  BulkIdsDto,
  ContactBodyDto,
  ContactChangeDto,
  ContactListDto,
  DiscoveryCreateDto,
  ImportExecuteDto,
  ImportPreviewDto,
  LeadBodyDto,
  LeadBulkStageDto,
  LeadChangeDto,
  LeadListDto,
  LeadStageDto,
  OverrideDto,
  PolicyBodyDto,
  QualifyDto,
  SummaryDto,
  SuppressionBodyDto,
  TakeoverDto,
} from './crm.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CrmService {
  private readonly key: Buffer;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) config: AppConfig,
    @Inject(AgentsService) private readonly agents: AgentsService,
  ) {
    this.key = decodeEncryptionKey(config.env.DATA_ENCRYPTION_KEY);
  }

  listAccounts(actor: SessionContext, query: AccountListDto) {
    return this.page(actor, 'crmAccount', query, ['displayName', 'industry', 'country', 'createdAt', 'lifecycleStatus'], (q) => ({
      archivedAt: query.includeArchived ? undefined : null,
      ...(q ? { OR: [contains('displayName', q), contains('legalName', q), contains('domain', q)] } : {}),
      ...(query.industry ? { industry: query.industry } : {}),
      ...(query.country ? { country: query.country } : {}),
    }), (row) => this.account(row));
  }

  accountRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id } } }), 'Account was not found', (row) => this.account(row));
  }

  createAccount(actor: SessionContext, body: AccountBodyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.crmAccount.create({ data: { tenantId, ...this.accountData(body), createdBy: actor.userId } });
      await this.audit(tx, tenantId, actor.userId, 'crm.account.create', 'crm_account', row.id, requestId);
      return this.account(row);
    }).catch((error) => this.rethrow(error));
  }

  updateAccount(actor: SessionContext, body: AccountChangeDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
      if (!current || current.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Account was not found');
      if (current.revision !== body.revision) throw new ApiException(409, 'STALE_RECORD', 'This account changed. Reload it and try again.');
      const row = await tx.crmAccount.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ...this.accountData(body), revision: { increment: 1 } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.account.update', 'crm_account', row.id, requestId);
      return this.account(row);
    }).catch((error) => this.rethrow(error));
  }

  archiveAccounts(actor: SessionContext, body: BulkIdsDto, requestId: string) {
    this.uniqueIds(body.ids);
    return this.bulk(actor, body.ids, async (tx, tenantId, id) => {
      const current = await tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!current || current.archivedAt) return 'skipped';
      await tx.crmAccount.update({ where: { tenantId_id: { tenantId, id } }, data: { archivedAt: new Date(), lifecycleStatus: 'ARCHIVED', revision: { increment: 1 } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.account.archive', 'crm_account', id, requestId);
      return 'updated';
    });
  }

  listContacts(actor: SessionContext, query: ContactListDto) {
    return this.page(actor, 'crmContact', query, ['name', 'jobTitle', 'country', 'createdAt'], (q) => ({
      archivedAt: query.includeArchived ? undefined : null,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(q ? { OR: [contains('name', q), contains('jobTitle', q)] } : {}),
    }), (row) => this.contact(actor, row));
  }

  contactRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmContact.findUnique({ where: { tenantId_id: { tenantId, id } } }), 'Contact was not found', (row) => this.contact(actor, row));
  }

  createContact(actor: SessionContext, body: ContactBodyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (body.accountId) await this.requireAccount(tx, tenantId, body.accountId);
      const row = await tx.crmContact.create({ data: { tenantId, ...this.contactData(body), createdBy: actor.userId } });
      await this.audit(tx, tenantId, actor.userId, 'crm.contact.create', 'crm_contact', row.id, requestId);
      return this.contact(actor, row);
    }).catch((error) => this.rethrow(error));
  }

  updateContact(actor: SessionContext, body: ContactChangeDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.crmContact.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
      if (!current || current.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Contact was not found');
      if (current.revision !== body.revision) throw new ApiException(409, 'STALE_RECORD', 'This contact changed. Reload it and try again.');
      const row = await tx.crmContact.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ...this.contactData(body), revision: { increment: 1 } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.contact.update', 'crm_contact', row.id, requestId);
      return this.contact(actor, row);
    }).catch((error) => this.rethrow(error));
  }

  listLeads(actor: SessionContext, query: LeadListDto) {
    return this.page(actor, 'crmLead', query, ['createdAt', 'stage', 'score', 'grade', 'eligibilityState'], (q) => ({
      archivedAt: query.includeArchived ? undefined : null,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.grade ? { grade: query.grade } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.icpName ? { icpName: query.icpName } : {}),
      ...(q ? { OR: [{ sourceRef: { contains: q, mode: 'insensitive' as const } }, { icpName: { contains: q, mode: 'insensitive' as const } }, { account: { displayName: { contains: q, mode: 'insensitive' as const } } }] } : {}),
    }), (row) => this.lead(row), { account: true });
  }

  async leadRecord(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { account: true, contact: true } });
      if (!row) throw new ApiException(404, 'NOT_FOUND', 'Lead was not found');
      const [history, qualifications, evidence, eligibility, assignments, audits] = await Promise.all([
        tx.crmStageHistory.findMany({ where: { tenantId, leadId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
        tx.crmQualification.findMany({ where: { tenantId, leadId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
        tx.crmEvidence.findMany({ where: { tenantId, leadId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
        tx.crmEligibility.findFirst({ where: { tenantId, leadId: id }, orderBy: { createdAt: 'desc' } }),
        tx.crmAssignment.findMany({ where: { tenantId, subjectType: 'lead', subjectId: id }, orderBy: { startedAt: 'desc' }, take: 20 }),
        tx.auditEvent.findMany({ where: { tenantId, entityId: id }, orderBy: { createdAt: 'desc' }, take: 8, select: { action: true, createdAt: true } }),
      ]);
      return {
        ...this.lead(row),
        contact: row.contact ? this.contact(actor, row.contact) : null,
        history,
        qualifications: qualifications.map((item) => ({ ...item, confidence: Number(item.confidence) })),
        evidence,
        eligibility,
        assignments: assignments.map((item) => ({ reason: item.reason, startedAt: item.startedAt, endedAt: item.endedAt, current: item.endedAt === null })),
        audits,
      };
    });
  }

  createLead(actor: SessionContext, body: LeadBodyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.requireAccount(tx, tenantId, body.accountId);
      if (body.contactId) await this.requireContact(tx, tenantId, body.contactId);
      if (body.productId) await this.requireProduct(tx, tenantId, body.productId);
      const published = body.productId && !body.productVersionId
        ? await tx.productVersion.findFirst({ where: { tenantId, productId: body.productId, status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' } })
        : null;
      const snapshot = published?.snapshot as { icps?: Array<{ name?: string }> } | undefined;
      const row = await tx.crmLead.create({
        data: {
          tenantId,
          accountId: body.accountId,
          contactId: body.contactId,
          productId: body.productId,
          productVersionId: body.productVersionId ?? published?.id,
          icpName: body.icpName || snapshot?.icps?.[0]?.name,
          sourceType: body.sourceType,
          sourceRef: body.sourceRef,
          eligibilityState: 'CONSENT_UNKNOWN',
          createdBy: actor.userId,
        },
        include: { account: true },
      });
      await tx.crmStageHistory.create({ data: { tenantId, leadId: row.id, toStage: 'NEW', reason: 'Lead created', actorId: actor.userId } });
      await this.audit(tx, tenantId, actor.userId, 'crm.lead.create', 'crm_lead', row.id, requestId);
      return this.lead(row);
    }).catch((error) => this.rethrow(error));
  }

  updateLead(actor: SessionContext, body: LeadChangeDto, requestId: string) {
    return this.reviseLead(actor, body.id, body.revision, requestId, 'crm.lead.update', { contactId: body.contactId, icpName: body.icpName, sourceRef: body.sourceRef });
  }

  transitionLead(actor: SessionContext, body: LeadStageDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await this.freshLead(tx, tenantId, body.id, body.revision);
      if (!canTransitionCrmLead(current.stage as CrmLeadStage, body.stage as CrmLeadStage)) {
        throw new ApiException(409, 'INVALID_TRANSITION', `A lead cannot move from ${current.stage} to ${body.stage}`);
      }
      await tx.crmStageHistory.create({ data: { tenantId, leadId: body.id, fromStage: current.stage, toStage: body.stage, reason: body.reason, actorId: actor.userId } });
      const row = await tx.crmLead.update({
        where: { tenantId_id: { tenantId, id: body.id } },
        data: { stage: body.stage, archivedAt: body.stage === 'ARCHIVED' ? new Date() : current.archivedAt, revision: { increment: 1 } },
        include: { account: true },
      });
      await this.audit(tx, tenantId, actor.userId, 'crm.lead.stage', 'crm_lead', body.id, requestId, { from: current.stage, to: body.stage });
      return this.lead(row);
    });
  }

  bulkTransition(actor: SessionContext, body: LeadBulkStageDto, requestId: string) {
    this.uniqueIds(body.ids);
    return this.bulk(actor, body.ids, async (tx, tenantId, id) => {
      const current = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!current || !canTransitionCrmLead(current.stage as CrmLeadStage, body.stage as CrmLeadStage)) return 'failed';
      await tx.crmStageHistory.create({ data: { tenantId, leadId: id, fromStage: current.stage, toStage: body.stage, reason: body.reason, actorId: actor.userId } });
      await tx.crmLead.update({ where: { tenantId_id: { tenantId, id } }, data: { stage: body.stage, revision: { increment: 1 } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.lead.stage', 'crm_lead', id, requestId, { to: body.stage });
      return 'updated';
    });
  }

  assignLead(actor: SessionContext, body: AssignDto, requestId: string) {
    return this.assignRecord(actor, body, requestId, 'lead');
  }

  assignAccount(actor: SessionContext, body: AssignDto, requestId: string) {
    return this.assignRecord(actor, body, requestId, 'account');
  }

  assignContact(actor: SessionContext, body: AssignDto, requestId: string) {
    return this.assignRecord(actor, body, requestId, 'contact');
  }

  async bulkAssignLeads(actor: SessionContext, body: BulkAssignDto, requestId: string) {
    this.uniqueIds(body.ids);
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (!(await lockAssignableOwner(tx, tenantId, body.ownerUserId))) throw new ApiException(404, 'NOT_ASSIGNABLE', 'That member cannot own this record');
      const results: Array<{ id: string; result: string }> = [];
      for (const id of body.ids) {
        const current = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id } } });
        if (!current || current.archivedAt || current.stage === 'ARCHIVED') {
          results.push({ id, result: 'failed' });
          continue;
        }
        await this.writeAssignment(tx, tenantId, actor.userId, 'lead', id, body.ownerUserId, body.reason);
        await tx.crmLead.update({ where: { tenantId_id: { tenantId, id } }, data: { ownerUserId: body.ownerUserId, revision: { increment: 1 } } });
        await this.audit(tx, tenantId, actor.userId, 'crm.lead.assign', 'crm_lead', id, requestId, { ownerUserId: body.ownerUserId });
        results.push({ id, result: 'updated' });
      }
      if (!(await lockAssignableOwner(tx, tenantId, body.ownerUserId))) throw new ApiException(404, 'NOT_ASSIGNABLE', 'That member cannot own this record');
      return { results, updated: results.filter((item) => item.result === 'updated').length, failed: results.filter((item) => item.result === 'failed').length };
    });
  }

  takeover(actor: SessionContext, body: TakeoverDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (!body.active) {
        await tx.crmTakeover.updateMany({ where: { tenantId, subjectType: body.subjectType, subjectId: body.id, active: true }, data: { active: false, endedAt: new Date() } });
      } else {
        await tx.crmTakeover.create({ data: { tenantId, subjectType: body.subjectType, subjectId: body.id, reason: body.reason, actorId: actor.userId } });
      }
      await this.audit(tx, tenantId, actor.userId, 'crm.takeover', body.subjectType, body.id, requestId, { active: body.active });
      return { id: body.id, active: body.active };
    });
  }

  previewImport(body: ImportPreviewDto) {
    const parsed = this.parseImport(body);
    return {
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      sample: parsed.mapped.slice(0, 5),
      errors: parsed.errors.slice(0, 20),
    };
  }

  importTemplate() {
    return { csv: `${IMPORT_FIELDS.join(',')}\nNorthwind Logistics,https://northwind.example,Logistics,US,Ada North,Operations,ada@northwind.example,+1-555-0100,csv\n` };
  }

  async executeImport(actor: SessionContext, body: ImportExecuteDto, requestId: string) {
    const tenantId = this.tenant(actor);
    const parsed = this.parseImport(body);
    const existing = await withTenant(this.database.prisma, tenantId, (tx) => tx.crmImportBatch.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: body.idempotencyKey } } }));
    if (existing) return this.importRecord(actor, existing.id);
    const created = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const batch = await tx.crmImportBatch.create({
        data: {
          tenantId,
          status: 'QUEUED',
          fileName: body.fileName,
          mapping: this.mappingRecord(body),
          policy: body.policy,
          rowCount: parsed.rows.length,
          idempotencyKey: body.idempotencyKey,
          createdBy: actor.userId,
          rows: { create: parsed.mapped.map((payload, index) => ({ rowNumber: index + 1, status: payload.companyName ? 'PENDING' : 'FAILED', payload, error: payload.companyName ? null : 'Company name is required' })) },
        },
      });
      const outbox = await tx.outboxEvent.create({ data: { tenantId, eventType: CRM_IMPORT_EVENT, aggregateId: batch.id, payload: { batchId: batch.id } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.import.create', 'crm_import', batch.id, requestId, { rows: parsed.rows.length });
      return { id: batch.id, outboxId: outbox.id };
    });
    const outcome = await importCrmBatch(this.database.prisma, { tenantId, userId: actor.userId, key: this.key }, created.id);
    if (outcome.held) throw new ApiException(409, 'LEASE_HELD', 'This import is already running');
    if (outcome.stopped) throw new ApiException(403, 'FORBIDDEN', 'This import cannot continue');
    await this.finishOutbox(tenantId, created.outboxId);
    return this.importRecord(actor, created.id);
  }

  listImports(actor: SessionContext, query: AccountListDto) {
    return this.page(actor, 'crmImportBatch', query, ['createdAt', 'fileName', 'status'], (q) => ({
      ...(q ? { OR: [contains('fileName', q), contains('status', q)] } : {}),
    }), (row: { id: string; fileName: string; status: string; rowCount: number; errorCount: number; createdAt: Date }) => ({
      id: row.id, fileName: row.fileName, status: row.status, rowCount: row.rowCount, errorCount: row.errorCount, createdAt: row.createdAt,
    }));
  }

  importRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmImportBatch.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { rows: { orderBy: { rowNumber: 'asc' }, take: 100 } } }), 'Import was not found', (row) => ({
      id: row.id,
      status: row.status,
      fileName: row.fileName,
      policy: row.policy,
      rowCount: row.rowCount,
      errorCount: row.errorCount,
      rows: row.rows.map((item: { rowNumber: number; status: string; error: string | null; accountId: string | null }) => ({ rowNumber: item.rowNumber, status: item.status, error: item.error, accountId: item.accountId })),
    }));
  }

  async importErrors(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    const rows = await withTenant(this.database.prisma, tenantId, (tx) => tx.crmImportRow.findMany({ where: { tenantId, batchId: id, status: 'FAILED' }, orderBy: { rowNumber: 'asc' } }));
    const lines = ['row,error', ...rows.map((row) => `${row.rowNumber},"${neutralizeCsvFormula(row.error ?? '').replace(/"/g, '""')}"`)];
    return { csv: lines.join('\n') };
  }

  async retryImport(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      await tx.crmImportRow.updateMany({ where: { tenantId, batchId: id, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
      await tx.crmImportBatch.updateMany({ where: { tenantId, id }, data: { status: 'QUEUED' } });
      await this.audit(tx, tenantId, actor.userId, 'crm.import.retry', 'crm_import', id, requestId);
    });
    await importCrmBatch(this.database.prisma, { tenantId, userId: actor.userId, key: this.key }, id);
    return this.importRecord(actor, id);
  }

  discoveryProviders() {
    return { providers: DISCOVERY_PROVIDERS.map((provider) => ({ ...provider, availability: provider.live ? 'LIVE' : 'LOCAL_ONLY' })), external: externalDiscoveryStatus(), adapter: externalDiscoveryAdapter() };
  }

  async createDiscovery(actor: SessionContext, body: DiscoveryCreateDto, requestId: string) {
    const tenantId = this.tenant(actor);
    if (body.productId) {
      await withTenant(this.database.prisma, tenantId, (tx) => this.requireProduct(tx, tenantId, body.productId!));
    }
    const created = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const job = await tx.crmDiscoveryJob.create({
        data: {
          tenantId,
          productId: body.productId,
          icpName: body.icpName,
          providerId: body.providerId,
          status: 'QUEUED',
          criteria: { companies: body.companies ?? [] } as unknown as Prisma.InputJsonValue,
          maxCandidates: body.maxCandidates ?? 25,
          createdBy: actor.userId,
        },
      });
      const outbox = await tx.outboxEvent.create({ data: { tenantId, eventType: CRM_DISCOVERY_EVENT, aggregateId: job.id, payload: { jobId: job.id } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.discovery.create', 'crm_discovery', job.id, requestId, { providerId: body.providerId, live: false });
      return { id: job.id, outboxId: outbox.id };
    });
    const outcome = await runCrmDiscovery(this.database.prisma, { tenantId, userId: actor.userId, key: this.key }, created.id);
    if (outcome.held) throw new ApiException(409, 'LEASE_HELD', 'This discovery job is already running');
    if (outcome.stopped) throw new ApiException(403, 'FORBIDDEN', 'This discovery job cannot continue');
    await this.finishOutbox(tenantId, created.outboxId);
    return this.discoveryRecord(actor, created.id);
  }

  listDiscovery(actor: SessionContext, query: AccountListDto) {
    return this.page(actor, 'crmDiscoveryJob', query, ['createdAt', 'status', 'providerId'], (q) => ({
      ...(q ? { OR: [contains('providerId', q), contains('status', q), contains('icpName', q)] } : {}),
    }), (row: { id: string; providerId: string; status: string; icpName: string | null; createdAt: Date }) => ({
      id: row.id, providerId: row.providerId, status: row.status, icpName: row.icpName, createdAt: row.createdAt, live: false,
    }));
  }

  discoveryRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmDiscoveryJob.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { candidates: true } }), 'Discovery job was not found', (row) => ({
      id: row.id,
      status: row.status,
      providerId: row.providerId,
      live: false,
      providerMode: row.providerId === 'test' ? 'test' : 'manual',
      productId: row.productId,
      icpName: row.icpName,
      candidates: row.candidates.map((item: { id: string; name: string; domain: string | null; industry: string | null; country: string | null; status: string; live: boolean; providerMode: string; evidence: unknown; accountId: string | null }) => ({
        id: item.id, name: item.name, domain: item.domain, industry: item.industry, country: item.country, status: item.status, live: item.live, providerMode: item.providerMode, evidence: item.evidence, accountId: item.accountId,
      })),
    }));
  }

  async cancelDiscovery(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    const updated = await withTenant(this.database.prisma, tenantId, (tx) => tx.crmDiscoveryJob.updateMany({ where: { tenantId, id, status: { in: ['DRAFT', 'QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED' } }));
    if (!updated.count) throw new ApiException(409, 'INVALID_TRANSITION', 'This discovery job can no longer be cancelled');
    await withTenant(this.database.prisma, tenantId, (tx) => this.audit(tx, tenantId, actor.userId, 'crm.discovery.cancel', 'crm_discovery', id, requestId));
    return this.discoveryRecord(actor, id);
  }

  async promoteCandidate(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const candidate = await tx.crmDiscoveryCandidate.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!candidate) throw new ApiException(404, 'NOT_FOUND', 'Candidate was not found');
      if (candidate.accountId) return { accountId: candidate.accountId, status: candidate.status };
      const account = await tx.crmAccount.create({
        data: {
          tenantId,
          legalName: candidate.name,
          displayName: candidate.name,
          domain: candidate.domain,
          website: candidate.domain ? `https://${candidate.domain}` : null,
          industry: candidate.industry,
          country: candidate.country,
          source: candidate.providerId,
          verificationStatus: 'SOURCE_REPORTED',
          createdBy: actor.userId,
        },
      });
      await tx.crmDiscoveryCandidate.update({ where: { tenantId_id: { tenantId, id } }, data: { accountId: account.id, status: 'PROMOTED' } });
      await this.audit(tx, tenantId, actor.userId, 'crm.discovery.promote', 'crm_account', account.id, requestId, { candidateId: id, live: false });
      return { accountId: account.id, status: 'PROMOTED' };
    }).catch((error) => this.rethrow(error));
  }

  async qualify(actor: SessionContext, body: QualifyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    if (body.modelConfigurationId) {
      const lead = await withTenant(this.database.prisma, tenantId, (tx) => tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } }));
      if (!lead?.productId) throw new ApiException(422, 'MODEL_REQUIRED', 'Lead qualification needs a published product');
      const run = await this.agents.createRun(actor, {
        triggerType: 'SCAN',
        planKind: 'LEAD_RESEARCH_AND_QUALIFY',
        productId: lead.productId,
        productVersionId: lead.productVersionId ?? undefined,
        modelConfigurationId: body.modelConfigurationId,
        leadId: lead.id,
        goal: 'Explain the official lead qualification. Do not send a message.',
      }, requestId);
      if (run.state !== 'SUCCEEDED') throw new ApiException(502, 'PROVIDER', 'The qualification explanation did not finish');
      const fresh = await this.leadRecord(actor, lead.id);
      const accepted = Boolean(fresh.qualifications[0]?.modelProvider);
      return { score: fresh.score, grade: fresh.grade, state: fresh.stage, explanationSource: accepted ? 'model' : 'deterministic', externalSend: false, runId: run.id };
    }
    const outboxId = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const outbox = await tx.outboxEvent.create({ data: { tenantId, eventType: CRM_QUALIFY_EVENT, aggregateId: body.id, payload: { leadId: body.id } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.lead.qualify', 'crm_lead', body.id, requestId, { model: false });
      return outbox.id;
    });
    const scored = await storeQualification(this.database.prisma, { tenantId, userId: actor.userId, key: this.key }, body.id, null, null);
    await this.finishOutbox(tenantId, outboxId);
    return { ...scored, explanationSource: 'deterministic', externalSend: false };
  }

  overrideScore(actor: SessionContext, body: OverrideDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await this.freshLead(tx, tenantId, body.id, body.revision);
      await tx.crmQualification.create({
        data: {
          tenantId,
          leadId: body.id,
          productVersionId: current.productVersionId,
          icpName: current.icpName,
          scoringVersion: 'human-override-1',
          score: body.score,
          grade: body.grade,
          confidence: current.confidence,
          dimensions: [],
          weights: {},
          explanation: body.reason,
          overridden: true,
          overrideReason: body.reason,
          createdBy: actor.userId,
        },
      });
      const row = await tx.crmLead.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { score: body.score, grade: body.grade, revision: { increment: 1 } }, include: { account: true } });
      await this.audit(tx, tenantId, actor.userId, 'crm.lead.override', 'crm_lead', body.id, requestId, { score: body.score });
      return this.lead(row);
    });
  }

  async evaluateEligibility(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id } }, include: { contact: true } });
      if (!lead) throw new ApiException(404, 'NOT_FOUND', 'Lead was not found');
      let lookupFailed = false;
      let suppressed = false;
      let takeover = false;
      try {
        suppressed = Boolean(await tx.crmSuppression.findFirst({
          where: { tenantId, active: true, OR: [{ accountId: lead.accountId }, ...(lead.contactId ? [{ contactId: lead.contactId }] : []), ...(lead.contact?.emailHmac ? [{ subjectHmac: lead.contact.emailHmac }] : [])] },
        }));
        takeover = Boolean(await tx.crmTakeover.findFirst({ where: { tenantId, active: true, subjectType: 'lead', subjectId: lead.id } }));
      } catch {
        lookupFailed = true;
      }
      const result = evaluateEligibility({
        lookupFailed,
        suppressed,
        humanTakeover: takeover,
        consentKnown: lead.contact?.consentState === 'KNOWN',
        contactVerified: lead.contact?.verificationStatus === 'VERIFIED',
      });
      const policyRow = await tx.crmContactPolicy.findUnique({ where: { tenantId } });
      const quiet = evaluateQuietHours({
        timezone: lead.contact?.timezone || policyRow?.timezone || null,
        weekdays: (policyRow?.weekdays as number[]) ?? [1, 2, 3, 4, 5],
        startMinute: policyRow?.startMinute ?? 540,
        endMinute: policyRow?.endMinute ?? 1020,
        holidays: (policyRow?.holidays as string[]) ?? [],
        minimumIntervalHours: policyRow?.minimumIntervalHours ?? 24,
        maxAttemptsPerPeriod: policyRow?.maxAttempts ?? 3,
      }, new Date());
      const saved = await tx.crmEligibility.create({
        data: { tenantId, leadId: id, contactId: lead.contactId, state: result.state, reasons: result.reasons, facts: { suppressed, takeover, quiet }, policyVersion: POLICY_VERSION },
      });
      await tx.crmLead.update({
        where: { tenantId_id: { tenantId, id } },
        data: { eligibilityState: result.state, suppressionState: suppressed ? 'SUPPRESSED' : 'CLEAR', revision: { increment: 1 } },
      });
      await this.audit(tx, tenantId, actor.userId, 'crm.eligibility.evaluate', 'crm_lead', id, requestId, { state: result.state, quiet: quiet.decision });
      return { id: saved.id, state: result.state, reasons: result.reasons, quietHours: quiet, externalSend: false };
    });
  }

  listSuppressions(actor: SessionContext, query: AccountListDto) {
    return this.page(actor, 'crmSuppression', query, ['createdAt', 'scope', 'reason'], (q) => ({
      ...(q ? { OR: [contains('reason', q), contains('subjectHint', q), contains('scope', q)] } : {}),
    }), (row: { id: string; scope: string; subjectHint: string | null; accountId: string | null; contactId: string | null; channel: string | null; purpose: string | null; reason: string; active: boolean; createdAt: Date }) => ({ id: row.id, scope: row.scope, subjectHint: row.subjectHint, accountId: row.accountId, contactId: row.contactId, channel: row.channel, purpose: row.purpose, reason: row.reason, active: row.active, createdAt: row.createdAt }));
  }

  createSuppression(actor: SessionContext, body: SuppressionBodyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    const subject = body.subject?.trim().toLowerCase();
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.crmSuppression.create({
        data: {
          tenantId,
          scope: body.scope,
          reason: body.reason,
          subjectHmac: subject ? emailHmac(subject, this.key) : null,
          subjectHint: subject ? subject.slice(-4) : null,
          accountId: body.accountId,
          contactId: body.contactId,
          channel: body.channel,
          purpose: body.purpose,
          createdBy: actor.userId,
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'crm.suppression.create', 'crm_suppression', row.id, requestId, { scope: body.scope, reason: body.reason });
      return { id: row.id, scope: row.scope, subjectHint: row.subjectHint, reason: row.reason, active: true };
    });
  }

  suppressionRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmSuppression.findUnique({ where: { tenantId_id: { tenantId, id } } }), 'Suppression was not found', (row) => ({
      id: row.id, scope: row.scope, reason: row.reason, subjectHint: row.subjectHint, active: row.active, channel: row.channel, purpose: row.purpose, createdAt: row.createdAt,
    }));
  }

  removeSuppression(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const updated = await tx.crmSuppression.updateMany({ where: { tenantId, id, active: true }, data: { active: false, removedAt: new Date(), removedBy: actor.userId } });
      if (!updated.count) throw new ApiException(404, 'NOT_FOUND', 'Suppression was not found');
      await this.audit(tx, tenantId, actor.userId, 'crm.suppression.remove', 'crm_suppression', id, requestId);
      return { id, active: false };
    });
  }

  listDuplicates(actor: SessionContext, query: AccountListDto) {
    return this.page(actor, 'crmDuplicateCandidate', query, ['createdAt', 'confidence', 'status'], () => ({ status: 'OPEN' }), (row: { id: string; leftAccountId: string; rightAccountId: string; confidence: Prisma.Decimal | number; reason: string; status: string }) => ({
      id: row.id, leftAccountId: row.leftAccountId, rightAccountId: row.rightAccountId, confidence: Number(row.confidence), reason: row.reason, status: row.status,
    }));
  }

  duplicateRecord(actor: SessionContext, id: string) {
    return this.one(actor, (tx, tenantId) => tx.crmDuplicateCandidate.findUnique({ where: { tenantId_id: { tenantId, id } } }), 'Duplicate candidate was not found', (row) => ({
      id: row.id, reason: row.reason, status: row.status, confidence: Number(row.confidence), createdAt: row.createdAt,
    }));
  }

  mergeDuplicate(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const candidate = await tx.crmDuplicateCandidate.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!candidate || candidate.status !== 'OPEN') throw new ApiException(404, 'NOT_FOUND', 'Duplicate candidate was not found');
      await tx.crmEvidence.updateMany({ where: { tenantId, accountId: candidate.rightAccountId }, data: { accountId: candidate.leftAccountId } });
      await tx.crmSuppression.updateMany({ where: { tenantId, accountId: candidate.rightAccountId, active: true }, data: { accountId: candidate.leftAccountId } });
      await tx.crmAccount.update({ where: { tenantId_id: { tenantId, id: candidate.rightAccountId } }, data: { archivedAt: new Date(), lifecycleStatus: 'MERGED', revision: { increment: 1 } } });
      await tx.crmDuplicateCandidate.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'MERGED' } });
      await this.audit(tx, tenantId, actor.userId, 'crm.account.merge', 'crm_account', candidate.leftAccountId, requestId, { mergedAccountId: candidate.rightAccountId });
      return { id, status: 'MERGED', keptAccountId: candidate.leftAccountId };
    });
  }

  async policy(actor: SessionContext) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => tx.crmContactPolicy.findUnique({ where: { tenantId } }));
    return this.policyView(row);
  }

  savePolicy(actor: SessionContext, body: PolicyBodyDto, requestId: string) {
    const tenantId = this.tenant(actor);
    this.assertZone(body.timezone);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.crmContactPolicy.upsert({
        where: { tenantId },
        create: { tenantId, ...this.policyData(body) },
        update: this.policyData(body),
      });
      await this.audit(tx, tenantId, actor.userId, 'crm.policy.update', 'crm_contact_policy', tenantId, requestId);
      return this.policyView(row);
    });
  }

  async summary(actor: SessionContext, query: SummaryDto) {
    const tenantId = this.tenant(actor);
    const createdAt = query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const leadWhere = { tenantId, archivedAt: null, ...(query.productId ? { productId: query.productId } : {}), ...(createdAt ? { createdAt } : {}) };
      const [accounts, contacts, leads, suppressed, humanOwned, imports, jobs] = await Promise.all([
        tx.crmAccount.count({ where: { tenantId, archivedAt: null } }),
        tx.crmContact.count({ where: { tenantId, archivedAt: null } }),
        tx.crmLead.count({ where: leadWhere }),
        tx.crmSuppression.count({ where: { tenantId, active: true } }),
        tx.crmTakeover.count({ where: { tenantId, active: true, subjectType: 'lead' } }),
        tx.crmImportBatch.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
        tx.crmDiscoveryJob.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      ]);
      const stages = await tx.crmLead.groupBy({ by: ['stage'], where: leadWhere, _count: true });
      const grades = await tx.crmLead.groupBy({ by: ['grade'], where: leadWhere, _count: true });
      return {
        accounts,
        contacts,
        leads,
        suppressed,
        humanOwned,
        byStage: Object.fromEntries(stages.map((row) => [row.stage, row._count])),
        byGrade: Object.fromEntries(grades.map((row) => [row.grade, row._count])),
        imports: Object.fromEntries(imports.map((row) => [row.status, row._count])),
        discovery: Object.fromEntries(jobs.map((row) => [row.status, row._count])),
        externalSend: false,
      };
    });
  }

  private async assignRecord(actor: SessionContext, body: AssignDto, requestId: string, subject: 'account' | 'contact' | 'lead') {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (!(await lockAssignableOwner(tx, tenantId, body.ownerUserId ?? null))) {
        throw new ApiException(404, 'NOT_ASSIGNABLE', 'That member cannot own this record');
      }
      if (subject === 'lead') {
        const current = await this.freshLead(tx, tenantId, body.id, body.revision);
        if (current.archivedAt || current.stage === 'ARCHIVED') throw new ApiException(409, 'NOT_ASSIGNABLE', 'This lead cannot be assigned');
        await this.writeAssignment(tx, tenantId, actor.userId, 'lead', body.id, body.ownerUserId ?? null, body.reason);
        const row = await tx.crmLead.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ownerUserId: body.ownerUserId ?? null, revision: { increment: 1 } }, include: { account: true } });
        if (!(await lockAssignableOwner(tx, tenantId, body.ownerUserId ?? null))) throw new ApiException(404, 'NOT_ASSIGNABLE', 'That member cannot own this record');
        await this.audit(tx, tenantId, actor.userId, 'crm.lead.assign', 'crm_lead', body.id, requestId, { ownerUserId: body.ownerUserId ?? null });
        return this.lead(row);
      }
      if (subject === 'account') {
        const current = await tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
        if (!current || current.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Account was not found');
        if (current.revision !== body.revision) throw new ApiException(409, 'STALE_RECORD', 'This account changed. Reload it and try again.');
        await this.writeAssignment(tx, tenantId, actor.userId, 'account', body.id, body.ownerUserId ?? null, body.reason);
        const row = await tx.crmAccount.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ownerUserId: body.ownerUserId ?? null, revision: { increment: 1 } } });
        await this.audit(tx, tenantId, actor.userId, 'crm.account.assign', 'crm_account', body.id, requestId, { ownerUserId: body.ownerUserId ?? null });
        return this.account(row);
      }
      const current = await tx.crmContact.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
      if (!current || current.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Contact was not found');
      if (current.revision !== body.revision) throw new ApiException(409, 'STALE_RECORD', 'This contact changed. Reload it and try again.');
      await this.writeAssignment(tx, tenantId, actor.userId, 'contact', body.id, body.ownerUserId ?? null, body.reason);
      const row = await tx.crmContact.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ownerUserId: body.ownerUserId ?? null, revision: { increment: 1 } } });
      await this.audit(tx, tenantId, actor.userId, 'crm.contact.assign', 'crm_contact', body.id, requestId, { ownerUserId: body.ownerUserId ?? null });
      return this.contact(actor, row);
    });
  }

  private async writeAssignment(tx: Tx, tenantId: string, actorId: string, subjectType: 'account' | 'contact' | 'lead', subjectId: string, ownerUserId: string | null, reason: string) {
    await tx.crmAssignment.updateMany({ where: { tenantId, subjectType, subjectId, endedAt: null }, data: { endedAt: new Date() } });
    await tx.crmAssignment.create({ data: { tenantId, subjectType, subjectId, ownerUserId, reason, actorId } });
  }

  private accountData(body: AccountBodyDto) {
    const domain = normalizeDomain(body.website);
    return {
      legalName: body.legalName,
      displayName: body.displayName || body.legalName,
      website: body.website || null,
      domain,
      industry: body.industry || null,
      subindustry: body.subindustry || null,
      businessModel: body.businessModel || null,
      description: body.description || null,
      sizeRange: body.sizeRange || null,
      employeeEstimate: body.employeeEstimate,
      employeeStatus: body.employeeEstimate === undefined ? 'UNKNOWN' : body.employeeStatus || 'UNKNOWN',
      revenueRange: body.revenueRange || null,
      revenueStatus: body.revenueRange ? body.revenueStatus || 'UNKNOWN' : 'UNKNOWN',
      country: body.country || null,
      region: body.region || null,
      source: body.source || 'manual',
      verificationStatus: body.verificationStatus || 'UNKNOWN',
    };
  }

  private contactData(body: ContactBodyDto) {
    const email = body.email ? normalizeEmail(body.email) : null;
    if (body.email && !email) throw new ApiException(400, 'INVALID_EMAIL', 'Enter a business email address or leave it blank');
    return {
      accountId: body.accountId || null,
      name: body.name,
      jobTitle: body.jobTitle || null,
      department: body.department || null,
      seniority: body.seniority || null,
      emailCiphertext: email ? new Uint8Array(encryptField(email, this.key)) : null,
      emailHmac: email ? emailHmac(email, this.key) : null,
      emailHint: email ? email.slice(-4) : null,
      phoneCiphertext: body.phone ? new Uint8Array(encryptField(body.phone, this.key)) : null,
      phoneHmac: body.phone ? emailHmac(body.phone, this.key) : null,
      phoneHint: body.phone ? body.phone.slice(-4) : null,
      profileUrl: body.profileUrl || null,
      country: body.country || null,
      timezone: body.timezone || null,
      contactRole: body.contactRole || null,
      decisionClass: body.decisionClass || 'UNKNOWN',
      verificationStatus: body.verificationStatus || 'UNKNOWN',
      consentState: body.consentState || 'UNKNOWN',
      source: body.source || 'manual',
    };
  }

  private account(input: unknown) {
    const row = input as { id: string; legalName: string; displayName: string; website: string | null; domain: string | null; industry: string | null; subindustry: string | null; businessModel: string | null; description: string | null; sizeRange: string | null; employeeEstimate: number | null; employeeStatus: string; revenueRange: string | null; revenueStatus: string; country: string | null; region: string | null; source: string; verificationStatus: string; ownerUserId: string | null; lifecycleStatus: string; revision: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date };
    return this.accountView(row);
  }

  private accountView(row: { id: string; legalName: string; displayName: string; website: string | null; domain: string | null; industry: string | null; subindustry: string | null; businessModel: string | null; description: string | null; sizeRange: string | null; employeeEstimate: number | null; employeeStatus: string; revenueRange: string | null; revenueStatus: string; country: string | null; region: string | null; source: string; verificationStatus: string; ownerUserId: string | null; lifecycleStatus: string; revision: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: row.id, legalName: row.legalName, displayName: row.displayName, website: row.website, domain: row.domain, industry: row.industry,
      subindustry: row.subindustry, businessModel: row.businessModel, description: row.description, sizeRange: row.sizeRange,
      employeeEstimate: row.employeeEstimate, employeeStatus: row.employeeStatus, revenueRange: row.revenueRange, revenueStatus: row.revenueStatus,
      country: row.country, region: row.region, source: row.source, verificationStatus: row.verificationStatus, ownerUserId: row.ownerUserId,
      lifecycleStatus: row.lifecycleStatus, revision: row.revision, archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private contact(actor: SessionContext, input: unknown) {
    const row = input as { id: string; accountId: string | null; name: string; jobTitle: string | null; department: string | null; seniority: string | null; emailCiphertext: Uint8Array | Buffer | null; emailHint: string | null; phoneCiphertext: Uint8Array | Buffer | null; phoneHint: string | null; profileUrl: string | null; country: string | null; timezone: string | null; contactRole: string | null; decisionClass: string; verificationStatus: string; consentState: string; source: string; revision: number; archivedAt: Date | null };
    const reveal = actor.permissions.includes('crm.contacts.read');
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      jobTitle: row.jobTitle,
      department: row.department,
      seniority: row.seniority,
      email: reveal && row.emailCiphertext ? decryptField(Buffer.from(row.emailCiphertext), this.key) : null,
      emailHint: row.emailHint,
      phone: reveal && row.phoneCiphertext ? decryptField(Buffer.from(row.phoneCiphertext), this.key) : null,
      phoneHint: row.phoneHint,
      profileUrl: row.profileUrl,
      country: row.country,
      timezone: row.timezone,
      contactRole: row.contactRole,
      decisionClass: row.decisionClass,
      verificationStatus: row.verificationStatus,
      consentState: row.consentState,
      source: row.source,
      revision: row.revision,
      archivedAt: row.archivedAt,
    };
  }

  private lead(input: unknown) {
    const row = input as { id: string; accountId: string; contactId: string | null; productId: string | null; productVersionId: string | null; icpName: string | null; sourceType: string; sourceRef: string | null; score: number | null; grade: string; confidence: Prisma.Decimal | number; stage: string; ownerUserId: string | null; eligibilityState: string; suppressionState: string; revision: number; archivedAt: Date | null; createdAt: Date; account?: { displayName: string; industry: string | null; country: string | null; sizeRange: string | null } };
    return {
      id: row.id,
      accountId: row.accountId,
      account: row.account ? { displayName: row.account.displayName, industry: row.account.industry, country: row.account.country, sizeRange: row.account.sizeRange } : undefined,
      contactId: row.contactId,
      productId: row.productId,
      productVersionId: row.productVersionId,
      icpName: row.icpName,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      score: row.score,
      grade: row.grade,
      confidence: Number(row.confidence),
      stage: row.stage,
      ownerUserId: row.ownerUserId,
      eligibilityState: row.eligibilityState,
      suppressionState: row.suppressionState,
      revision: row.revision,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
    };
  }

  private parseImport(body: ImportPreviewDto) {
    if (Buffer.byteLength(body.csv) > CSV_LIMITS.maxBytes) throw new ApiException(413, 'FILE_TOO_LARGE', 'The CSV exceeds the size limit');
    let parsed: { headers: string[]; rows: string[][] };
    try {
      parsed = parseCsv(body.csv);
    } catch (error) {
      throw new ApiException(400, 'INVALID_CSV', error instanceof Error ? error.message : 'The CSV could not be read');
    }
    const mapping = this.mappingRecord(body);
    const mapped = parsed.rows.map((cells) => mapImportRow(parsed.headers, cells, mapping));
    const errors = mapped.flatMap((row, index) => (row.companyName ? [] : [{ row: index + 1, message: 'Company name is required' }]));
    return { ...parsed, mapped, errors };
  }

  private mappingRecord(body: ImportPreviewDto): Record<string, string> {
    return Object.fromEntries((body.mapping ?? []).map((item) => [item.field, item.header]));
  }

  private policyData(body: PolicyBodyDto) {
    return {
      timezone: body.timezone || null,
      weekdays: body.weekdays,
      startMinute: body.startMinute,
      endMinute: body.endMinute,
      holidays: body.holidays,
      minimumIntervalHours: body.minimumIntervalHours,
      maxAttempts: body.maxAttempts,
    };
  }

  private policyView(row: { timezone: string | null; weekdays: Prisma.JsonValue; startMinute: number; endMinute: number; holidays: Prisma.JsonValue; minimumIntervalHours: number; maxAttempts: number } | null) {
    return {
      timezone: row?.timezone ?? null,
      weekdays: (row?.weekdays as number[]) ?? [1, 2, 3, 4, 5],
      startMinute: row?.startMinute ?? 540,
      endMinute: row?.endMinute ?? 1020,
      holidays: (row?.holidays as string[]) ?? [],
      minimumIntervalHours: row?.minimumIntervalHours ?? 24,
      maxAttempts: row?.maxAttempts ?? 3,
      externalSend: false,
    };
  }

  private assertZone(timezone?: string) {
    if (!timezone) return;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      throw new ApiException(400, 'INVALID_TIMEZONE', 'Use an IANA time zone such as America/New_York');
    }
  }

  private async page<T>(
    actor: SessionContext,
    model: 'crmAccount' | 'crmContact' | 'crmLead' | 'crmSuppression' | 'crmDuplicateCandidate' | 'crmImportBatch' | 'crmDiscoveryJob',
    query: { page?: number; pageSize?: number; q?: string; sortBy?: string; sortDirection?: 'asc' | 'desc' },
    allowed: string[],
    whereFor: (q?: string) => Record<string, unknown>,
    map: (row: T) => unknown,
    include?: Record<string, boolean>,
  ) {
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = allowed.includes(query.sortBy ?? '') ? query.sortBy! : allowed[0]!;
    const where = { tenantId, ...whereFor(query.q?.trim()) };
    const [total, rows] = await withTenant(this.database.prisma, tenantId, (tx) => {
      const delegate = tx[model] as unknown as { count: (input: unknown) => Promise<number>; findMany: (input: unknown) => Promise<T[]> };
      return Promise.all([
        delegate.count({ where }),
        delegate.findMany({ where, orderBy: { [sortBy]: query.sortDirection ?? 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include }),
      ]);
    });
    return { items: rows.map(map), total, page, pageSize };
  }

  private async one<T>(actor: SessionContext, load: (tx: Tx, tenantId: string) => Promise<T | null>, missing: string, map: (row: T) => unknown) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => load(tx, tenantId));
    if (!row) throw new ApiException(404, 'NOT_FOUND', missing);
    return map(row);
  }

  private async bulk(actor: SessionContext, ids: string[], apply: (tx: Tx, tenantId: string, id: string) => Promise<'updated' | 'skipped' | 'failed'>) {
    const tenantId = this.tenant(actor);
    const results = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const output: Array<{ id: string; result: string }> = [];
      for (const id of ids) output.push({ id, result: await apply(tx, tenantId, id) });
      return output;
    });
    return { results, updated: results.filter((item) => item.result === 'updated').length, failed: results.filter((item) => item.result === 'failed').length };
  }

  private async reviseLead(actor: SessionContext, id: string, revision: number, requestId: string, action: string, data: Record<string, unknown>) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await this.freshLead(tx, tenantId, id, revision);
      const row = await tx.crmLead.update({ where: { tenantId_id: { tenantId, id } }, data: { ...data, revision: { increment: 1 } }, include: { account: true } });
      await this.audit(tx, tenantId, actor.userId, action, 'crm_lead', id, requestId);
      return this.lead(row);
    });
  }

  private async freshLead(tx: Tx, tenantId: string, id: string, revision: number) {
    const current = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!current) throw new ApiException(404, 'NOT_FOUND', 'Lead was not found');
    if (current.revision !== revision) throw new ApiException(409, 'STALE_RECORD', 'This lead changed. Reload it and try again.');
    return current;
  }

  private async requireAccount(tx: Tx, tenantId: string, id: string) {
    const row = await tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row || row.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Account was not found');
  }

  private async requireContact(tx: Tx, tenantId: string, id: string) {
    const row = await tx.crmContact.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row || row.archivedAt) throw new ApiException(404, 'NOT_FOUND', 'Contact was not found');
  }

  private async requireProduct(tx: Tx, tenantId: string, id: string) {
    const row = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Product was not found');
  }

  private finishOutbox(tenantId: string, id: string) {
    return withTenant(this.database.prisma, tenantId, (tx) => tx.outboxEvent.updateMany({ where: { tenantId, id, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } }));
  }

  private uniqueIds(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new ApiException(400, 'DUPLICATE_IDS', 'A record was repeated in this request');
  }

  private tenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }

  private audit(tx: Tx, tenantId: string, actorId: string, action: string, entityType: string, entityId: string, requestId: string, payload: Record<string, unknown> = {}) {
    return tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId, action, entityType, entityId, payload: { ...payload, requestId } } });
  }

  private rethrow(error: unknown): never {
    if (error instanceof ApiException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiException(409, 'DUPLICATE', 'A matching record already exists in this organization');
    }
    throw error;
  }
}

function contains(field: string, q: string) {
  return { [field]: { contains: q, mode: 'insensitive' as const } };
}
