import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  CRM_LEAD_STAGES,
  acceptLeadExplanation,
  canTransitionCrmLead,
  compareTextList,
  deterministicQualificationText,
  discoveryCandidates,
  evaluateEligibility,
  normalizeDomain,
  normalizeEmail,
  scoreIcp,
  type CrmLeadStage,
  type Fit,
} from '@salesos/shared';
import { emailHmac, encryptField } from './crypto';
import { withTenant } from './with-tenant';

type Actor = { tenantId: string; userId: string; key: Buffer; runId?: string; pause?: 'after-row' | 'before-write' };
type StopReason = 'cancelled' | 'suspended' | 'forbidden';
const LEASE_SECONDS = 30;

export async function lockAssignableOwner(tx: Prisma.TransactionClient, tenantId: string, userId: string | null): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
  if (!userId) return true;
  const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.lock_member_for_assignment(${tenantId}::uuid, ${userId}::uuid) AS ok`;
  return rows[0]?.ok === true;
}

async function workGate(tx: Prisma.TransactionClient, actor: Actor, permission: string): Promise<'ok' | StopReason> {
  const active = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`;
  if (active[0]?.ok !== true) return 'suspended';
  if (!(await memberIsAssignable(tx, actor.tenantId, actor.userId))) return 'forbidden';
  const membership = await tx.membership.findUnique({
    where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  const names = membership?.roles.flatMap((link) => link.role.permissions.map((item) => item.permission)) ?? [];
  return names.includes(permission) ? 'ok' : 'forbidden';
}

async function claimLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string): Promise<'claimed' | 'held' | 'closed'> {
  const token = randomUUID();
  const rows = await tx.$queryRaw<Array<{ lease_version: number }>>`
    INSERT INTO public.crm_work_leases (tenant_id, kind, record_id, lease_token, lease_until, lease_version, status)
    VALUES (${tenantId}::uuid, ${kind}, ${recordId}::uuid, ${token}, pg_catalog.now() + make_interval(secs => ${LEASE_SECONDS}::double precision), 1, 'RUNNING')
    ON CONFLICT (tenant_id, kind, record_id) DO UPDATE
      SET lease_token = EXCLUDED.lease_token,
          lease_until = EXCLUDED.lease_until,
          lease_version = crm_work_leases.lease_version + 1,
          status = 'RUNNING'
      WHERE crm_work_leases.status NOT IN ('COMPLETED', 'CANCELLED')
        AND (crm_work_leases.lease_until IS NULL OR crm_work_leases.lease_until < pg_catalog.now())
    RETURNING lease_version
  `;
  if (rows.length) return 'claimed';
  const current = await tx.crmWorkLease.findUnique({ where: { tenantId_kind_recordId: { tenantId, kind, recordId } } });
  if (!current || current.status === 'COMPLETED' || current.status === 'CANCELLED') return 'closed';
  return 'held';
}

async function renewLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE public.crm_work_leases
       SET lease_until = pg_catalog.now() + make_interval(secs => ${LEASE_SECONDS}::double precision)
     WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind} AND record_id = ${recordId}::uuid AND status = 'RUNNING'
  `;
}

async function releaseLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string): Promise<void> {
  await tx.crmWorkLease.updateMany({ where: { tenantId, kind, recordId, status: 'RUNNING' }, data: { status: 'OPEN', leaseUntil: new Date(0), leaseToken: null } });
}

async function finishLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string, status: 'COMPLETED' | 'CANCELLED'): Promise<void> {
  await tx.crmWorkLease.updateMany({ where: { tenantId, kind, recordId }, data: { status, leaseToken: null, leaseUntil: null } });
}

export async function importCrmBatch(prisma: PrismaClient, actor: Actor, batchId: string): Promise<{ created: number; skipped: number; failed: number; held?: boolean; stopped?: StopReason }> {
  const opened = await withTenant(prisma, actor.tenantId, async (tx) => {
    const batch = await tx.crmImportBatch.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: batchId } } });
    if (!batch) throw new Error('Import batch was not found');
    if (batch.status === 'CANCELLED') return { stopped: 'cancelled' as const };
    const pending = await tx.crmImportRow.count({ where: { tenantId: actor.tenantId, batchId, status: 'PENDING' } });
    if (pending === 0 && batch.status !== 'QUEUED') return { finished: true, skipped: batch.rowCount, failed: batch.errorCount };
    const gate = await workGate(tx, actor, 'crm.leads.import');
    if (gate !== 'ok') return { stopped: gate };
    const claim = await claimLease(tx, actor.tenantId, 'import', batchId);
    if (claim === 'held') return { held: true as const };
    if (claim === 'closed') return { stopped: 'cancelled' as const };
    if (batch.status === 'QUEUED') await tx.crmImportBatch.updateMany({ where: { tenantId: actor.tenantId, id: batchId, status: 'QUEUED' }, data: { status: 'IMPORTING' } });
    return { ready: true as const };
  });
  if ('held' in opened) return { created: 0, skipped: 0, failed: 0, held: true };
  if ('stopped' in opened) return { created: 0, skipped: 0, failed: 0, stopped: opened.stopped };
  if ('finished' in opened) return { created: 0, skipped: opened.skipped ?? 0, failed: opened.failed ?? 0 };
  let processed = 0;
  for (;;) {
    const next = await withTenant(prisma, actor.tenantId, async (tx) => {
      const batch = await tx.crmImportBatch.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: batchId } } });
      if (!batch || batch.status === 'CANCELLED') return { stop: 'cancelled' as const };
      const gate = await workGate(tx, actor, 'crm.leads.import');
      if (gate !== 'ok') return { stop: gate };
      await renewLease(tx, actor.tenantId, 'import', batchId);
      const row = await tx.crmImportRow.findFirst({ where: { tenantId: actor.tenantId, batchId, status: 'PENDING' }, orderBy: { rowNumber: 'asc' } });
      if (!row) return { done: true as const };
      await applyImportRow(tx, actor, batch, row);
      return { wrote: true as const };
    });
    if ('stop' in next) {
      await withTenant(prisma, actor.tenantId, (tx) => releaseLease(tx, actor.tenantId, 'import', batchId));
      return { created: 0, skipped: 0, failed: 0, stopped: next.stop };
    }
    if ('done' in next) break;
    processed += 1;
    if (actor.pause === 'after-row' && processed === 1) {
      writeSync(1, 'checkpoint\n');
      await new Promise(() => undefined);
    }
  }
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const failed = await tx.crmImportRow.count({ where: { tenantId: actor.tenantId, batchId, status: 'FAILED' } });
    const created = await tx.crmImportRow.count({ where: { tenantId: actor.tenantId, batchId, status: 'CREATED' } });
    const skipped = await tx.crmImportRow.count({ where: { tenantId: actor.tenantId, batchId, status: 'SKIPPED' } });
    await tx.crmImportBatch.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: batchId } },
      data: { status: failed && !created ? 'FAILED' : failed ? 'PARTIAL' : 'COMPLETED', errorCount: failed },
    });
    await finishLease(tx, actor.tenantId, 'import', batchId, 'COMPLETED');
    return { created, skipped, failed };
  });
}

async function applyImportRow(tx: Prisma.TransactionClient, actor: Actor, batch: { policy: string }, row: { id: string; payload: Prisma.JsonValue }): Promise<void> {
  const payload = row.payload as Record<string, string>;
  const name = payload.companyName?.trim();
  if (!name) {
    await tx.crmImportRow.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { status: 'FAILED', error: 'Company name is required' } });
    return;
  }
  const domain = normalizeDomain(payload.website);
  const existing = domain ? await tx.crmAccount.findFirst({ where: { tenantId: actor.tenantId, domain, archivedAt: null } }) : null;
  if (existing && batch.policy === 'skip') {
    await tx.crmImportRow.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { status: 'SKIPPED', accountId: existing.id } });
    await flagNameDuplicate(tx, actor.tenantId, existing.id, name, payload.country);
    return;
  }
  const account = existing ?? await tx.crmAccount.create({
    data: {
      tenantId: actor.tenantId,
      legalName: name,
      displayName: name,
      website: payload.website || null,
      domain,
      industry: payload.industry || null,
      country: payload.country || null,
      source: payload.source || 'csv',
      verificationStatus: 'SOURCE_REPORTED',
      employeeStatus: 'UNKNOWN',
      revenueStatus: 'UNKNOWN',
      createdBy: actor.userId,
    },
  });
  if (payload.contactName?.trim()) {
    const email = normalizeEmail(payload.email);
    const hmac = email ? emailHmac(email, actor.key) : null;
    const duplicateContact = hmac ? await tx.crmContact.findFirst({ where: { tenantId: actor.tenantId, emailHmac: hmac, archivedAt: null } }) : null;
    if (!duplicateContact) {
      await tx.crmContact.create({
        data: {
          tenantId: actor.tenantId,
          accountId: account.id,
          name: payload.contactName.trim(),
          jobTitle: payload.jobTitle || null,
          emailCiphertext: email ? new Uint8Array(encryptField(email, actor.key)) : null,
          emailHmac: hmac,
          emailHint: email ? email.slice(-4) : null,
          phoneHint: payload.phone ? payload.phone.slice(-4) : null,
          phoneCiphertext: payload.phone ? new Uint8Array(encryptField(payload.phone, actor.key)) : null,
          source: 'csv',
          verificationStatus: 'UNKNOWN',
          consentState: 'UNKNOWN',
          provenance: { imported: true, lawfulUse: 'not-established' },
          createdBy: actor.userId,
        },
      });
    }
  }
  await tx.crmImportRow.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { status: existing ? 'SKIPPED' : 'CREATED', accountId: account.id } });
  await flagNameDuplicate(tx, actor.tenantId, account.id, name, payload.country);
}

async function flagNameDuplicate(tx: Prisma.TransactionClient, tenantId: string, accountId: string, name: string, country?: string): Promise<void> {
  if (!country) return;
  const others = await tx.crmAccount.findMany({ where: { tenantId, archivedAt: null, country, NOT: { id: accountId } }, take: 20 });
  const match = others.find((item) => item.legalName.trim().toLowerCase() === name.trim().toLowerCase());
  if (!match) return;
  const open = await tx.crmDuplicateCandidate.findFirst({ where: { tenantId, status: 'OPEN', leftAccountId: match.id, rightAccountId: accountId } });
  if (open) return;
  await tx.crmDuplicateCandidate.create({
    data: { tenantId, leftAccountId: match.id, rightAccountId: accountId, confidence: '0.70', reason: 'Normalized legal name and country' },
  });
}

export async function runCrmDiscovery(prisma: PrismaClient, actor: Actor, jobId: string): Promise<{ candidates: number; held?: boolean; stopped?: StopReason }> {
  const opened = await withTenant(prisma, actor.tenantId, async (tx) => {
    const job = await tx.crmDiscoveryJob.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: jobId } } });
    if (!job) throw new Error('Discovery job was not found');
    if (job.status === 'CANCELLED') return { stopped: 'cancelled' as const };
    if (job.status === 'COMPLETED') return { finished: true as const };
    const gate = await workGate(tx, actor, 'crm.leads.discover');
    if (gate !== 'ok') return { stopped: gate };
    const claim = await claimLease(tx, actor.tenantId, 'discovery', jobId);
    if (claim === 'held') return { held: true as const };
    if (claim === 'closed') return { stopped: 'cancelled' as const };
    if (job.status === 'QUEUED') await tx.crmDiscoveryJob.updateMany({ where: { tenantId: actor.tenantId, id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING' } });
    return { ready: true as const };
  });
  if ('held' in opened) return { candidates: 0, held: true };
  if ('stopped' in opened) return { candidates: 0, stopped: opened.stopped };
  if ('finished' in opened) return { candidates: 0 };
  let processed = 0;
  for (;;) {
    const next = await withTenant(prisma, actor.tenantId, async (tx) => {
      const job = await tx.crmDiscoveryJob.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: jobId } } });
      if (!job || job.status === 'CANCELLED') return { stop: 'cancelled' as const };
      const gate = await workGate(tx, actor, 'crm.leads.discover');
      if (gate !== 'ok') return { stop: gate };
      await renewLease(tx, actor.tenantId, 'discovery', jobId);
      const criteria = job.criteria as { companies?: Array<{ name: string; website?: string; industry?: string; country?: string }> };
      const found = discoveryCandidates(job.providerId, criteria.companies ?? []).slice(0, job.maxCandidates);
      const existing = await tx.crmDiscoveryCandidate.findMany({ where: { tenantId: actor.tenantId, jobId }, select: { name: true } });
      const names = new Set(existing.map((item) => item.name));
      const item = found.find((candidate) => !names.has(candidate.name));
      if (!item) return { done: true as const };
      const duplicate = item.domain ? await tx.crmAccount.findFirst({ where: { tenantId: actor.tenantId, domain: item.domain, archivedAt: null } }) : null;
      await tx.crmDiscoveryCandidate.create({
        data: {
          tenantId: actor.tenantId,
          jobId,
          name: item.name,
          domain: item.domain,
          industry: item.industry ?? null,
          country: item.country ?? null,
          providerId: item.providerId,
          providerMode: item.providerMode,
          live: false,
          status: duplicate ? 'DUPLICATE' : 'CANDIDATE',
          accountId: duplicate?.id,
          evidence: { providerMode: item.providerMode, live: false, domain: item.domain, provenance: item.providerMode === 'test' ? 'LOCAL TEST DATA' : 'USER PROVIDED DATA' },
        },
      });
      return { wrote: true as const };
    });
    if ('stop' in next) {
      await withTenant(prisma, actor.tenantId, (tx) => releaseLease(tx, actor.tenantId, 'discovery', jobId));
      return { candidates: 0, stopped: next.stop };
    }
    if ('done' in next) break;
    processed += 1;
    if (actor.pause === 'after-row' && processed === 1) {
      writeSync(1, 'checkpoint\n');
      await new Promise(() => undefined);
    }
  }
  const candidates = await withTenant(prisma, actor.tenantId, async (tx) => {
    await tx.crmDiscoveryJob.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: jobId } }, data: { status: 'COMPLETED' } });
    await finishLease(tx, actor.tenantId, 'discovery', jobId, 'COMPLETED');
    return tx.crmDiscoveryCandidate.count({ where: { tenantId: actor.tenantId, jobId } });
  });
  return { candidates };
}

export async function qualifyCrmLead(prisma: PrismaClient, actor: Actor, leadId: string): Promise<{ score: number | null; grade?: string; state?: string; held?: boolean; stopped?: StopReason }> {
  const opened = await withTenant(prisma, actor.tenantId, async (tx) => {
    const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: leadId } } });
    if (!lead) throw new Error('Lead was not found');
    const lease = await tx.crmWorkLease.findUnique({ where: { tenantId_kind_recordId: { tenantId: actor.tenantId, kind: 'qualify', recordId: leadId } } });
    if (lead.archivedAt || lead.stage === 'ARCHIVED' || lease?.status === 'CANCELLED') return { stopped: 'cancelled' as const };
    const gate = await workGate(tx, actor, 'crm.leads.qualify');
    if (gate !== 'ok') return { stopped: gate };
    if (lead.score !== null) {
      await finishLease(tx, actor.tenantId, 'qualify', leadId, 'COMPLETED');
      return { done: true as const, score: lead.score, grade: lead.grade, state: lead.stage };
    }
    const claim = await claimLease(tx, actor.tenantId, 'qualify', leadId);
    if (claim === 'held') return { held: true as const };
    if (claim === 'closed') return { stopped: 'cancelled' as const };
    return { ready: true as const };
  });
  if ('held' in opened) return { score: null, held: true };
  if ('stopped' in opened) return { score: null, stopped: opened.stopped };
  if ('done' in opened) return { score: opened.score ?? null, grade: opened.grade, state: opened.state };
  if (actor.pause === 'before-write') {
    writeSync(1, 'checkpoint\n');
    await new Promise(() => undefined);
  }
  const stored = await storeQualification(prisma, actor, leadId, null, null);
  await withTenant(prisma, actor.tenantId, (tx) => finishLease(tx, actor.tenantId, 'qualify', leadId, 'COMPLETED'));
  return stored;
}

export async function storeQualification(
  prisma: PrismaClient,
  actor: Actor,
  leadId: string,
  explanation: string | null,
  model: { provider: string; name: string } | null,
  criteria: { industries: string[]; countries: string[]; sizes: string[] } = { industries: [], countries: [], sizes: [] },
): Promise<{ score: number; grade: string; state: string }> {
  return withTenant(prisma, actor.tenantId, (tx) => persistQualification(tx, actor, leadId, explanation, model, criteria));
}

export async function memberIsAssignable(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.member_is_assignable(${tenantId}::uuid, ${userId}::uuid) AS ok`;
  return rows[0]?.ok === true;
}

export async function leadPromptFacts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  leadId: string,
  prior: Array<{ toolName: string; outputRedacted: Prisma.JsonValue | null }> = [],
  evidenceIds: string[] = [],
): Promise<string> {
  const packet = await loadLeadPacket(tx, tenantId, leadId);
  if (!packet) return 'LEAD: UNKNOWN';
  const evaluated = prior.find((call) => call.toolName === 'lead.icp.evaluate')?.outputRedacted;
  const official = evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated) ? evaluated as { score?: unknown; grade?: unknown } : {};
  const score = typeof official.score === 'number' ? String(official.score) : 'PENDING';
  const grade = typeof official.grade === 'string' ? official.grade : 'PENDING';
  const dimensions = evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated) && Array.isArray((evaluated as { dimensions?: unknown }).dimensions)
    ? (evaluated as { dimensions: Array<{ name?: unknown; fit?: unknown }> }).dimensions
      .filter((item) => typeof item.name === 'string' && typeof item.fit === 'string')
      .map((item) => `${item.name}=${item.fit}`)
      .join(';')
    : '';
  const account = packet.lead.account;
  return [
    `OFFICIAL_SCORE: ${score}`,
    `OFFICIAL_GRADE: ${grade}`,
    dimensions ? `DIMENSIONS: ${dimensions}` : '',
    `EVIDENCE_IDS: ${evidenceIds.join(',')}`,
    'The official score is fixed. Do not replace it.',
    `COMPANY: ${account.displayName}`,
    `INDUSTRY: ${account.industry ?? 'UNKNOWN'}`,
    `COUNTRY: ${account.country ?? 'UNKNOWN'}`,
    `SIZE: ${account.sizeRange ?? 'UNKNOWN'}`,
    `EMPLOYEES: ${account.employeeStatus === 'VERIFIED' ? String(account.employeeEstimate ?? 'UNKNOWN') : 'UNKNOWN'}`,
    `REVENUE: ${account.revenueStatus === 'VERIFIED' ? account.revenueRange ?? 'UNKNOWN' : 'UNKNOWN'}`,
    `BUYER: ${packet.lead.contact?.decisionClass === 'DECISION_MAKER' ? 'DECISION_MAKER' : 'UNKNOWN'}`,
    `GAPS: ${packet.gaps.join(', ')}`,
    `EVIDENCE_COUNT: ${packet.evidence.length}`,
    `UNTRUSTED_DESCRIPTION: ${(account.description ?? '').slice(0, 400)}`,
  ].join('\n');
}

export async function executeLeadTool(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actor: { userId: string; runId: string; modelProvider: string | null; modelName: string | null },
  leadId: string | null,
  tool: string,
  prior: Array<{ toolName: string; outputRedacted: Prisma.JsonValue | null }>,
  citationIds: string[],
): Promise<Record<string, unknown>> {
  if (!leadId) throw new Error('Lead was not found');
  const packet = await loadLeadPacket(tx, tenantId, leadId);
  if (!packet) throw new Error('Lead was not found');
  const account = packet.lead.account;
  if (tool === 'lead.account.read') {
    return {
      displayName: account.displayName,
      industry: account.industry ?? 'UNKNOWN',
      country: account.country ?? 'UNKNOWN',
      sizeRange: account.sizeRange ?? 'UNKNOWN',
      employees: account.employeeStatus === 'VERIFIED' ? account.employeeEstimate : 'UNKNOWN',
      employeeStatus: account.employeeStatus,
      revenue: account.revenueStatus === 'VERIFIED' ? account.revenueRange ?? 'UNKNOWN' : 'UNKNOWN',
      revenueStatus: account.revenueStatus,
      verificationStatus: account.verificationStatus,
    };
  }
  if (tool === 'lead.contact.read') {
    return {
      contacts: packet.contacts.map((contact) => ({
        name: contact.name,
        jobTitle: contact.jobTitle,
        decisionClass: contact.decisionClass,
        verificationStatus: contact.verificationStatus,
        consentState: contact.consentState,
      })),
    };
  }
  if (tool === 'lead.research.evidence.read') {
    return {
      evidence: packet.evidence.map((item) => ({ claim: item.claim, provenance: item.provenance, sourceRef: item.sourceRef })),
      citations: citationIds,
    };
  }
  if (tool === 'lead.research.find_gaps') return { gaps: packet.gaps, unknown: packet.gaps };
  if (tool === 'lead.icp.evaluate') {
    const scored = await scoreStoredLead(tx, tenantId, packet.lead);
    return { official: true, mutable: false, score: scored.score, grade: scored.grade, confidence: scored.confidence, dimensions: scored.dimensions };
  }
  if (tool === 'lead.qualification.propose') {
    const scored = await scoreStoredLead(tx, tenantId, packet.lead);
    const official = {
      score: scored.score,
      grade: scored.grade,
      dimensions: scored.dimensions.map((item) => ({ name: item.name, fit: item.fit })),
      evidence: citationIds,
    };
    const explained = prior.find((call) => call.toolName === 'lead.qualification.explain')?.outputRedacted;
    const decision = acceptLeadExplanation(explained, official);
    const text = (decision?.quality === 'MODEL' ? decision.text : deterministicQualificationText(official)).slice(0, 4000);
    const model = decision?.quality === 'MODEL' && actor.modelProvider && actor.modelName ? { provider: actor.modelProvider, name: actor.modelName } : null;
    const stored = await persistQualification(
      tx,
      { tenantId, userId: actor.userId, key: Buffer.alloc(0), runId: actor.runId },
      leadId,
      text,
      model,
    );
    return { official: true, score: stored.score, grade: stored.grade, state: stored.state, explanationQuality: decision?.quality === 'MODEL' ? 'MODEL' : 'INSUFFICIENT_EXPLANATION' };
  }
  if (tool === 'lead.eligibility.read') {
    const audience = await audienceForLead(tx, tenantId, leadId);
    return { ...audience, externalSend: false, unknownAuthorizesSending: false };
  }
  throw new Error('Lead tool is not executable');
}

export async function audienceForLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string | null): Promise<{
  audienceKnown: boolean;
  suppressed: boolean;
  humanOwned: boolean;
  eligibility?: 'ELIGIBLE' | 'SUPPRESSED' | 'HUMAN_OWNED' | 'CONSENT_UNKNOWN' | 'CONTACT_DETAILS_UNVERIFIED' | 'REVIEW_REQUIRED';
}> {
  if (!leadId) return { audienceKnown: false, suppressed: false, humanOwned: false };
  const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: leadId } }, include: { contact: true } });
  if (!lead) return { audienceKnown: false, suppressed: false, humanOwned: false };
  const suppression = await tx.crmSuppression.findFirst({
    where: {
      tenantId,
      active: true,
      OR: [
        { accountId: lead.accountId },
        ...(lead.contactId ? [{ contactId: lead.contactId }] : []),
        ...(lead.contact?.emailHmac ? [{ subjectHmac: lead.contact.emailHmac }] : []),
      ],
    },
  });
  const takeover = await tx.crmTakeover.findFirst({ where: { tenantId, active: true, subjectType: 'lead', subjectId: lead.id } });
  const eligibility = evaluateEligibility({
    suppressed: Boolean(suppression),
    humanTakeover: Boolean(takeover),
    consentKnown: lead.contact?.consentState === 'KNOWN',
    contactVerified: lead.contact?.verificationStatus === 'VERIFIED',
  });
  return { audienceKnown: true, suppressed: Boolean(suppression), humanOwned: Boolean(takeover), eligibility: eligibility.state === 'NOT_ELIGIBLE' ? 'REVIEW_REQUIRED' : eligibility.state };
}

async function persistQualification(
  tx: Prisma.TransactionClient,
  actor: Actor,
  leadId: string,
  explanation: string | null,
  model: { provider: string; name: string } | null,
  criteria: { industries: string[]; countries: string[]; sizes: string[] } = { industries: [], countries: [], sizes: [] },
): Promise<{ score: number; grade: string; state: string }> {
  const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: leadId } }, include: { account: true, contact: true } });
  if (!lead) throw new Error('Lead was not found');
  if (actor.runId) {
    const prior = await tx.crmQualification.findMany({ where: { tenantId: actor.tenantId, leadId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const existing = prior.find((row) => (row.weights as { runId?: string } | null)?.runId === actor.runId);
    if (existing) return { score: existing.score, grade: existing.grade, state: lead.stage };
  }
  const scored = await scoreStoredLead(tx, actor.tenantId, lead, criteria);
  const target: CrmLeadStage = scored.grade === 'UNRATED' ? 'REVIEW_REQUIRED' : scored.grade === 'D' || scored.excluded ? 'UNQUALIFIED' : 'QUALIFIED';
  if (!CRM_LEAD_STAGES.includes(target)) throw new Error('Stage is not valid');
  const stage = await reachStage(tx, actor.tenantId, leadId, lead.stage, target, actor.userId);
  await tx.crmQualification.create({
    data: {
      tenantId: actor.tenantId,
      leadId,
      productVersionId: lead.productVersionId,
      icpName: lead.icpName,
      scoringVersion: 'crm-score-1',
      score: scored.score,
      grade: scored.grade,
      confidence: scored.confidence.toFixed(2),
      dimensions: scored.dimensions,
      weights: { ...scored.weights, ...(actor.runId ? { runId: actor.runId } : {}) },
      explanation: explanation ?? `Deterministic score ${scored.score}/100, grade ${scored.grade}. No model explanation was stored with this assessment.`,
      modelProvider: model?.provider,
      modelName: model?.name,
      createdBy: actor.userId,
    },
  });
  await tx.crmLead.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: leadId } },
    data: { score: scored.score, grade: scored.grade, confidence: scored.confidence.toFixed(2), stage, lastResearchedAt: new Date(), revision: { increment: 1 } },
  });
  return { score: scored.score, grade: scored.grade, state: stage };
}

async function scoreStoredLead(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lead: { productVersionId: string | null; icpName: string | null; account: { industry: string | null; sizeRange: string | null; country: string | null; description: string | null }; contact: { decisionClass: string } | null },
  criteria: { industries: string[]; countries: string[]; sizes: string[] } = { industries: [], countries: [], sizes: [] },
) {
  const resolved = await criteriaForLead(tx, tenantId, lead.productVersionId, lead.icpName, criteria);
  const fits = {
    industry: compareTextList(lead.account.industry, resolved.industries),
    size: compareTextList(lead.account.sizeRange, resolved.sizes),
    geography: compareTextList(lead.account.country, resolved.countries),
    buyer: (lead.contact?.decisionClass === 'DECISION_MAKER' ? 'MATCH' : 'UNKNOWN') as Fit,
    need: (lead.account.description ? 'MATCH' : 'UNKNOWN') as Fit,
    trigger: 'UNKNOWN' as Fit,
    technology: 'UNKNOWN' as Fit,
  };
  const excluded = resolved.sizes.length > 0 && fits.size === 'MISS';
  return { ...scoreIcp({ fits, excluded }), excluded };
}

async function loadLeadPacket(tx: Prisma.TransactionClient, tenantId: string, leadId: string) {
  const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: leadId } }, include: { account: true, contact: true } });
  if (!lead) return null;
  const contacts = lead.contact
    ? [lead.contact]
    : await tx.crmContact.findMany({ where: { tenantId, accountId: lead.accountId, archivedAt: null }, take: 10, orderBy: { createdAt: 'asc' } });
  const evidence = await tx.crmEvidence.findMany({
    where: { tenantId, OR: [{ leadId }, { accountId: lead.accountId }] },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const gaps = [
    lead.account.employeeStatus === 'VERIFIED' ? null : 'employees',
    lead.account.revenueStatus === 'VERIFIED' ? null : 'revenue',
    lead.contact?.decisionClass === 'DECISION_MAKER' ? null : 'buyer',
    'trigger',
    'technology',
  ].filter((item): item is string => Boolean(item));
  return { lead, contacts, evidence, gaps };
}

async function criteriaForLead(
  tx: Prisma.TransactionClient,
  tenantId: string,
  versionId: string | null,
  icpName: string | null,
  supplied: { industries: string[]; countries: string[]; sizes: string[] },
): Promise<{ industries: string[]; countries: string[]; sizes: string[] }> {
  if (supplied.industries.length || supplied.countries.length || supplied.sizes.length) return supplied;
  if (!versionId) return supplied;
  const version = await tx.productVersion.findUnique({ where: { tenantId_id: { tenantId, id: versionId } } });
  const snapshot = version?.snapshot as { icps?: Array<{ name?: string; industries?: string[]; countries?: string[]; companySizes?: string[] }> } | null;
  const icp = snapshot?.icps?.find((item) => item.name === icpName) ?? snapshot?.icps?.[0];
  return {
    industries: icp?.industries ?? [],
    countries: icp?.countries ?? [],
    sizes: icp?.companySizes ?? [],
  };
}

async function reachStage(tx: Prisma.TransactionClient, tenantId: string, leadId: string, from: string, to: CrmLeadStage, actorId: string): Promise<CrmLeadStage> {
  let current = from as CrmLeadStage;
  if (!CRM_LEAD_STAGES.includes(current)) return current;
  for (const step of ['RESEARCHING', 'RESEARCHED', 'REVIEW_REQUIRED', to] as CrmLeadStage[]) {
    if (current === to) break;
    if (current === step) continue;
    if (!canTransitionCrmLead(current, step)) continue;
    await tx.crmStageHistory.create({
      data: { tenantId, leadId, fromStage: current, toStage: step, reason: 'Deterministic ICP score', actorId },
    });
    current = step;
  }
  return current;
}
