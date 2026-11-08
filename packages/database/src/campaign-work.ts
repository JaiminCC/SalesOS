import { writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SENDING_CAPABILITY,
  acceptPersonalization,
  campaignDigest,
  canTransitionCampaign,
  emptyAnalytics,
  SEGMENT_LIMITS,
  isValidTimeZone,
  matchFilter,
  preparationDecision,
  renderTemplate,
  stopReason,
  validateFilter,
  validateSequence,
  validateTemplate,
  waitUntil,
  type AudienceCandidate,
  type CampaignAnalytics,
  type CampaignJobName,
  type CampaignState,
  type SegmentFilter,
  type SequenceStepDraft,
} from '@salesos/shared';
import { withTenant } from './with-tenant';

export class CampaignError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Actor = { tenantId: string; userId: string };
type Tx = Prisma.TransactionClient;
export type CampaignPause = 'during-audience' | 'after-segment' | 'during-draft' | 'after-draft' | 'during-advance' | 'after-step';
type PageQuery = { q?: string; page?: number; pageSize?: number; sortBy?: string; sortDirection?: 'asc' | 'desc'; state?: string };

const LOCKED = new Set<CampaignState>(['PENDING_REVIEW', 'APPROVED', 'SCHEDULED', 'SIMULATING', 'PAUSED', 'COMPLETED_SIMULATION', 'CANCELLED', 'ARCHIVED']);

export async function createCampaign(prisma: PrismaClient, actor: Actor, input: CampaignInput) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const pin = await pinProduct(tx, actor.tenantId, input.productVersionId, input.icpRef);
    const row = await tx.campaign.create({
      data: {
        tenantId: actor.tenantId,
        name: clean(input.name, 160),
        description: clean(input.description ?? '', 2000),
        goal: clean(input.goal ?? '', 500),
        campaignType: input.campaignType || 'OUTREACH',
        channel: 'EMAIL',
        timeZone: zone(input.timeZone),
        ownerUserId: input.ownerUserId ?? actor.userId,
        productId: pin?.productId,
        productVersionId: pin?.versionId,
        icpRef: pin?.icpRef,
        state: 'DRAFT',
        sendingStatus: SENDING_CAPABILITY,
        liveDelivery: false,
        createdBy: actor.userId,
      },
    });
    if (pin) await tx.campaignProduct.create({ data: { tenantId: actor.tenantId, campaignId: row.id, productId: pin.productId, productVersionId: pin.versionId } });
    await activity(tx, actor, row.id, 'campaign.create', null, 'DRAFT');
    return present(row);
  });
}

export async function updateCampaign(prisma: PrismaClient, actor: Actor, input: CampaignInput & { id: string; revision: number }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const current = await requiredCampaign(tx, actor.tenantId, input.id);
    if (current.revision !== input.revision) throw new CampaignError(409, 'VERSION_CONFLICT', 'Reload the campaign before saving');
    if (LOCKED.has(current.state as CampaignState) && current.state !== 'CONFIGURING') throw new CampaignError(409, 'CAMPAIGN_LOCKED', 'This campaign version is frozen');
    const pin = input.productVersionId ? await pinProduct(tx, actor.tenantId, input.productVersionId, input.icpRef) : null;
    if (pin && current.productVersionId && pin.versionId !== current.productVersionId && current.state !== 'DRAFT' && current.state !== 'CONFIGURING') {
      throw new CampaignError(409, 'PRODUCT_PINNED', 'The published product version stays pinned');
    }
    const row = await tx.campaign.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: input.id } },
      data: {
        name: clean(input.name, 160),
        description: clean(input.description ?? '', 2000),
        goal: clean(input.goal ?? '', 500),
        timeZone: zone(input.timeZone || current.timeZone),
        ownerUserId: input.ownerUserId ?? current.ownerUserId,
        ...(pin ? { productId: pin.productId, productVersionId: pin.versionId, icpRef: pin.icpRef } : {}),
        revision: { increment: 1 },
      },
    });
    if (pin) await tx.campaignProduct.create({ data: { tenantId: actor.tenantId, campaignId: row.id, productId: pin.productId, productVersionId: pin.versionId } }).catch(() => undefined);
    await activity(tx, actor, row.id, 'campaign.update', current.state, row.state);
    return present(row);
  });
}

export async function transitionCampaign(prisma: PrismaClient, actor: Actor, id: string, revision: number, to: CampaignState) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const current = await requiredCampaign(tx, actor.tenantId, id);
    if (current.revision !== revision) throw new CampaignError(409, 'VERSION_CONFLICT', 'Reload the campaign before changing it');
    if (!canTransitionCampaign(current.state as CampaignState, to)) throw new CampaignError(409, 'INVALID_TRANSITION', 'That campaign transition is not available');
    if (to === 'AUDIENCE_READY' && !current.segmentVersionId) throw new CampaignError(422, 'AUDIENCE_REQUIRED', 'Assign a segment version first');
    if (to === 'SEQUENCE_READY' && !current.sequenceVersionId) throw new CampaignError(422, 'SEQUENCE_REQUIRED', 'Assign a sequence version first');
    if (to === 'PENDING_REVIEW' || to === 'APPROVED') await assertSeparateReview(tx, actor, current.id, to);
    const row = await tx.campaign.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id } },
      data: { state: to, archivedAt: to === 'ARCHIVED' ? new Date() : to === 'DRAFT' ? null : current.archivedAt, revision: { increment: 1 }, sendingStatus: SENDING_CAPABILITY, liveDelivery: false },
    });
    if (to === 'CANCELLED' || to === 'PAUSED') await tx.campaignEnrollment.updateMany({ where: { tenantId: actor.tenantId, campaignId: id, status: { notIn: ['COMPLETED_SIMULATION', 'STOPPED', 'CANCELLED'] } }, data: { status: to === 'CANCELLED' ? 'CANCELLED' : 'PAUSED' } });
    if (to === 'CONFIGURING') await tx.campaignApproval.updateMany({ where: { tenantId: actor.tenantId, subjectId: id, state: 'APPROVED' }, data: { state: 'REVOKED' } });
    await activity(tx, actor, id, `campaign.${to.toLowerCase()}`, current.state, to);
    return present(row);
  });
}

export async function cloneCampaign(prisma: PrismaClient, actor: Actor, id: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const current = await requiredCampaign(tx, actor.tenantId, id);
    const row = await tx.campaign.create({
      data: {
        tenantId: actor.tenantId,
        name: `${current.name} copy`.slice(0, 160),
        description: current.description,
        goal: current.goal,
        campaignType: current.campaignType,
        channel: 'EMAIL',
        timeZone: current.timeZone,
        ownerUserId: actor.userId,
        productId: current.productId,
        productVersionId: current.productVersionId,
        icpRef: current.icpRef,
        state: 'DRAFT',
        sendingStatus: SENDING_CAPABILITY,
        liveDelivery: false,
        createdBy: actor.userId,
      },
    });
    await activity(tx, actor, row.id, 'campaign.clone', null, 'DRAFT', { sourceId: id });
    return present(row);
  });
}

export async function listCampaigns(prisma: PrismaClient, tenantId: string, query: PageQuery) {
  return withTenant(prisma, tenantId, async (tx) => {
    const paging = page(query);
    const sort = ['name', 'updatedAt', 'state', 'createdAt'].includes(query.sortBy ?? '') ? query.sortBy! : 'updatedAt';
    const where: Prisma.CampaignWhereInput = {
      tenantId,
      ...(query.state ? { state: query.state } : {}),
      ...(query.q ? { name: { contains: query.q.slice(0, 80), mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([
      tx.campaign.count({ where }),
      tx.campaign.findMany({ where, orderBy: { [sort]: query.sortDirection === 'asc' ? 'asc' : 'desc' }, skip: paging.skip, take: paging.take }),
    ]);
    return { items: rows.map(present), total, page: paging.page, pageSize: paging.pageSize };
  });
}

export async function campaignRecord(prisma: PrismaClient, tenantId: string, id: string) {
  return withTenant(prisma, tenantId, async (tx) => {
    const row = await requiredCampaign(tx, tenantId, id);
    const [history, runs, approvals] = await Promise.all([
      tx.campaignActivity.findMany({ where: { tenantId, campaignId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      tx.campaignRun.findMany({ where: { tenantId, campaignId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      tx.campaignApproval.findMany({ where: { tenantId, subjectId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return { ...present(row), history, runs, approvals, externalDelivery: 'NOT_AUTHORIZED' as const };
  });
}

export async function createSegment(prisma: PrismaClient, actor: Actor, input: { name: string; description?: string; kind: 'DYNAMIC' | 'SNAPSHOT'; filter: unknown }) {
  const error = validateFilter(input.filter);
  if (error) throw new CampaignError(422, error, 'The segment filter is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const segment = await tx.audienceSegment.create({ data: { tenantId: actor.tenantId, name: clean(input.name, 160), description: clean(input.description ?? '', 1000), kind: input.kind, ownerUserId: actor.userId, createdBy: actor.userId } });
    const version = await tx.audienceSegmentVersion.create({ data: { tenantId: actor.tenantId, segmentId: segment.id, versionNumber: 1, filter: input.filter as Prisma.InputJsonValue, createdBy: actor.userId } });
    const row = await tx.audienceSegment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: segment.id } }, data: { currentVersionId: version.id } });
    return { ...row, version };
  });
}

export async function updateSegment(prisma: PrismaClient, actor: Actor, input: { id: string; revision: number; name: string; description?: string; filter: unknown }) {
  const error = validateFilter(input.filter);
  if (error) throw new CampaignError(422, error, 'The segment filter is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const current = await tx.audienceSegment.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.id } } });
    if (!current) throw new CampaignError(404, 'NOT_FOUND', 'Segment was not found');
    if (current.revision !== input.revision) throw new CampaignError(409, 'VERSION_CONFLICT', 'Reload the segment before saving');
    const latest = await tx.audienceSegmentVersion.findFirst({ where: { tenantId: actor.tenantId, segmentId: input.id }, orderBy: { versionNumber: 'desc' } });
    const version = await tx.audienceSegmentVersion.create({ data: { tenantId: actor.tenantId, segmentId: input.id, versionNumber: (latest?.versionNumber ?? 0) + 1, filter: input.filter as Prisma.InputJsonValue, createdBy: actor.userId } });
    return tx.audienceSegment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.id } }, data: { name: clean(input.name, 160), description: clean(input.description ?? '', 1000), currentVersionId: version.id, revision: { increment: 1 } } });
  });
}

export async function listSegments(prisma: PrismaClient, tenantId: string, query: PageQuery) {
  return withTenant(prisma, tenantId, async (tx) => {
    const paging = page(query);
    const where = { tenantId, ...(query.q ? { name: { contains: query.q.slice(0, 80), mode: 'insensitive' as const } } : {}) };
    const [total, items] = await Promise.all([tx.audienceSegment.count({ where }), tx.audienceSegment.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: paging.skip, take: paging.take })]);
    return { items, total, page: paging.page, pageSize: paging.pageSize };
  });
}

export async function segmentRecord(prisma: PrismaClient, tenantId: string, id: string) {
  return withTenant(prisma, tenantId, async (tx) => {
    const row = await tx.audienceSegment.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row) throw new CampaignError(404, 'NOT_FOUND', 'Segment was not found');
    const versions = await tx.audienceSegmentVersion.findMany({ where: { tenantId, segmentId: id }, orderBy: { versionNumber: 'desc' } });
    return { ...row, versions };
  });
}

export async function previewSegment(prisma: PrismaClient, actor: Actor, filter: unknown, includeLabels: boolean) {
  const error = validateFilter(filter);
  if (error) throw new CampaignError(422, error, 'The segment filter is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => summarize(await decideAll(tx, actor.tenantId, filter as SegmentFilter), includeLabels));
}

export async function materializeSegment(prisma: PrismaClient, actor: Actor, segmentId: string, pause?: CampaignPause) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const segment = await tx.audienceSegment.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: segmentId } } });
    if (!segment?.currentVersionId) throw new CampaignError(404, 'NOT_FOUND', 'Segment was not found');
    const version = await tx.audienceSegmentVersion.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: segment.currentVersionId } } });
    if (!version) throw new CampaignError(404, 'NOT_FOUND', 'Segment version was not found');
    if (version.frozen) return { versionId: version.id, frozen: true, inserted: 0 };
    await checkpoint(pause, 'during-audience');
    const decisions = await decideAll(tx, actor.tenantId, version.filter as SegmentFilter);
    for (const item of decisions) {
      await tx.audienceMember.create({ data: { tenantId: actor.tenantId, segmentVersionId: version.id, leadId: item.candidate.leadId, contactId: item.candidate.contactId, identityKey: item.candidate.identityKey, decision: item.decision, reasons: item.reasons } }).catch(() => undefined);
    }
    if (segment.kind === 'SNAPSHOT') await tx.audienceSegmentVersion.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: version.id } }, data: { frozen: true } });
    return { versionId: version.id, frozen: segment.kind === 'SNAPSHOT', inserted: decisions.length };
  }).then(async (result) => {
    await checkpoint(pause, 'after-segment');
    return result;
  });
}

export async function assignAudience(prisma: PrismaClient, actor: Actor, campaignId: string, revision: number, segmentId: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const campaign = await requiredCampaign(tx, actor.tenantId, campaignId);
    if (campaign.revision !== revision) throw new CampaignError(409, 'VERSION_CONFLICT', 'Reload the campaign before assigning an audience');
    if (LOCKED.has(campaign.state as CampaignState)) throw new CampaignError(409, 'CAMPAIGN_LOCKED', 'The reviewed audience cannot change');
    const segment = await tx.audienceSegment.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: segmentId } } });
    if (!segment?.currentVersionId) throw new CampaignError(404, 'NOT_FOUND', 'Segment was not found');
    await tx.campaignAudience.create({ data: { tenantId: actor.tenantId, campaignId, segmentId, segmentVersionId: segment.currentVersionId, createdBy: actor.userId } });
    const row = await tx.campaign.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: campaignId } }, data: { segmentId, segmentVersionId: segment.currentVersionId, revision: { increment: 1 } } });
    await activity(tx, actor, campaignId, 'campaign.audience.assign', campaign.state, row.state);
    return present(row);
  });
}

export async function createSequence(prisma: PrismaClient, actor: Actor, input: { name: string; steps: SequenceStepDraft[]; timeZone?: string }) {
  const error = validateSequence(input.steps);
  if (error) throw new CampaignError(422, error, 'The sequence is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => saveSequence(tx, actor, input, null));
}

export async function replaceSteps(prisma: PrismaClient, actor: Actor, sequenceId: string, steps: SequenceStepDraft[]) {
  const error = validateSequence(steps);
  if (error) throw new CampaignError(422, error, 'The sequence is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const sequence = await tx.campaignSequence.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequenceId } } });
    if (!sequence) throw new CampaignError(404, 'NOT_FOUND', 'Sequence was not found');
    const current = sequence.currentVersionId ? await tx.campaignSequenceVersion.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequence.currentVersionId } } }) : null;
    if (current?.frozen) return saveSequence(tx, actor, { name: sequence.name, steps, timeZone: current.timeZone }, sequence.id);
    if (!current) return saveSequence(tx, actor, { name: sequence.name, steps }, sequence.id);
    await tx.campaignSequenceStep.deleteMany({ where: { tenantId: actor.tenantId, sequenceVersionId: current.id } });
    await writeSteps(tx, actor.tenantId, current.id, steps);
    return { id: sequence.id, versionId: current.id, frozen: false };
  });
}

export async function freezeSequence(prisma: PrismaClient, actor: Actor, sequenceId: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const sequence = await tx.campaignSequence.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequenceId } } });
    if (!sequence?.currentVersionId) throw new CampaignError(404, 'NOT_FOUND', 'Sequence was not found');
    await tx.campaignSequenceVersion.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequence.currentVersionId } }, data: { frozen: true } });
    return { id: sequence.id, versionId: sequence.currentVersionId, frozen: true };
  });
}

export async function listSequences(prisma: PrismaClient, tenantId: string, query: PageQuery) {
  return withTenant(prisma, tenantId, async (tx) => {
    const paging = page(query);
    const where = { tenantId, ...(query.q ? { name: { contains: query.q.slice(0, 80), mode: 'insensitive' as const } } : {}) };
    const [total, items] = await Promise.all([tx.campaignSequence.count({ where }), tx.campaignSequence.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: paging.skip, take: paging.take })]);
    return { items, total, page: paging.page, pageSize: paging.pageSize };
  });
}

export async function sequenceRecord(prisma: PrismaClient, tenantId: string, id: string) {
  return withTenant(prisma, tenantId, async (tx) => {
    const row = await tx.campaignSequence.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row) throw new CampaignError(404, 'NOT_FOUND', 'Sequence was not found');
    const versions = await tx.campaignSequenceVersion.findMany({ where: { tenantId, sequenceId: id }, orderBy: { versionNumber: 'desc' } });
    const steps = row.currentVersionId ? await tx.campaignSequenceStep.findMany({ where: { tenantId, sequenceVersionId: row.currentVersionId }, orderBy: { position: 'asc' } }) : [];
    return { ...row, versions, steps };
  });
}

export async function assignSequence(prisma: PrismaClient, actor: Actor, campaignId: string, revision: number, sequenceId: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const campaign = await requiredCampaign(tx, actor.tenantId, campaignId);
    if (campaign.revision !== revision) throw new CampaignError(409, 'VERSION_CONFLICT', 'Reload the campaign before assigning a sequence');
    if (LOCKED.has(campaign.state as CampaignState)) throw new CampaignError(409, 'CAMPAIGN_LOCKED', 'The sequence version is pinned');
    const sequence = await tx.campaignSequence.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequenceId } } });
    if (!sequence?.currentVersionId) throw new CampaignError(404, 'NOT_FOUND', 'Sequence was not found');
    const row = await tx.campaign.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: campaignId } }, data: { sequenceId, sequenceVersionId: sequence.currentVersionId, revision: { increment: 1 } } });
    await activity(tx, actor, campaignId, 'campaign.sequence.assign', campaign.state, row.state);
    return present(row);
  });
}

export async function createTemplate(prisma: PrismaClient, actor: Actor, input: { name: string; subject: string; bodyText: string; bodyHtml?: string; locale?: string; productId?: string }) {
  const error = validateTemplate(`${input.subject}\n${input.bodyText}\n${input.bodyHtml ?? ''}`);
  if (error) throw new CampaignError(422, error, 'The template is not valid');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const template = await tx.campaignTemplate.create({ data: { tenantId: actor.tenantId, name: clean(input.name, 160), locale: input.locale || 'en', productId: input.productId, createdBy: actor.userId } });
    const version = await tx.campaignTemplateVersion.create({ data: { tenantId: actor.tenantId, templateId: template.id, versionNumber: 1, subject: clean(input.subject, 200), bodyText: input.bodyText, bodyHtml: input.bodyHtml ? renderTemplate(input.bodyHtml, {}, true).text : null, createdBy: actor.userId } });
    return tx.campaignTemplate.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: template.id } }, data: { currentVersionId: version.id } });
  });
}

export async function listTemplates(prisma: PrismaClient, tenantId: string, query: PageQuery) {
  return withTenant(prisma, tenantId, async (tx) => {
    const paging = page(query);
    const where = { tenantId, ...(query.q ? { name: { contains: query.q.slice(0, 80), mode: 'insensitive' as const } } : {}) };
    const [total, items] = await Promise.all([tx.campaignTemplate.count({ where }), tx.campaignTemplate.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: paging.skip, take: paging.take })]);
    return { items, total, page: paging.page, pageSize: paging.pageSize };
  });
}

export async function templateRecord(prisma: PrismaClient, tenantId: string, id: string) {
  return withTenant(prisma, tenantId, async (tx) => {
    const row = await tx.campaignTemplate.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!row) throw new CampaignError(404, 'NOT_FOUND', 'Template was not found');
    const versions = await tx.campaignTemplateVersion.findMany({ where: { tenantId, templateId: id }, orderBy: { versionNumber: 'desc' } });
    return { ...row, versions };
  });
}

export async function requestApproval(prisma: PrismaClient, actor: Actor, input: { kind: string; subjectId: string; versionRef: string; digest: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const existing = await tx.campaignApproval.findFirst({ where: { tenantId: actor.tenantId, kind: input.kind, subjectId: input.subjectId, versionRef: input.versionRef, state: 'PENDING' } });
    if (existing) return existing;
    return tx.campaignApproval.create({ data: { tenantId: actor.tenantId, kind: input.kind, subjectId: input.subjectId, versionRef: input.versionRef, digest: input.digest, state: 'PENDING', requestedBy: actor.userId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  });
}

export async function decideApproval(prisma: PrismaClient, actor: Actor, input: { id: string; decision: 'APPROVED' | 'REJECTED'; digest: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const row = await tx.campaignApproval.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.id } } });
    if (!row || row.state !== 'PENDING') throw new CampaignError(409, 'APPROVAL_CLOSED', 'This approval is no longer pending');
    if (row.requestedBy === actor.userId) throw new CampaignError(403, 'SEPARATION_OF_DUTIES', 'The author cannot decide this approval');
    if (row.digest !== input.digest) throw new CampaignError(409, 'DIGEST_MISMATCH', 'The approval does not match the current version');
    if (row.expiresAt.getTime() < Date.now()) {
      await tx.campaignApproval.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { state: 'EXPIRED' } });
      throw new CampaignError(409, 'APPROVAL_EXPIRED', 'The approval expired');
    }
    return tx.campaignApproval.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { state: input.decision, decidedBy: actor.userId, decidedAt: new Date() } });
  });
}

export async function startSimulation(prisma: PrismaClient, actor: Actor, campaignId: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const campaign = await requiredCampaign(tx, actor.tenantId, campaignId);
    if (!canTransitionCampaign(campaign.state as CampaignState, 'SIMULATING') && campaign.state !== 'SIMULATING') throw new CampaignError(409, 'INVALID_TRANSITION', 'Simulation cannot start from this state');
    if (!campaign.segmentVersionId || !campaign.sequenceVersionId) throw new CampaignError(422, 'SIMULATION_INCOMPLETE', 'A segment version and sequence version are required');
    const members = await tx.audienceMember.findMany({ where: { tenantId: actor.tenantId, segmentVersionId: campaign.segmentVersionId } });
    let enrolled = 0;
    for (const member of members) {
      if (member.decision !== 'ELIGIBLE_FOR_PREPARATION' || !member.identityKey) {
        await tx.campaignExclusion.create({ data: { tenantId: actor.tenantId, campaignId, identityKey: member.identityKey, leadId: member.leadId, reason: member.decision, createdBy: actor.userId } });
        continue;
      }
      try {
        await tx.campaignEnrollment.create({
          data: {
            tenantId: actor.tenantId, campaignId, sequenceVersionId: campaign.sequenceVersionId, segmentVersionId: campaign.segmentVersionId,
            productVersionId: campaign.productVersionId, icpRef: campaign.icpRef, leadId: member.leadId, contactId: member.contactId,
            identityKey: member.identityKey, channel: campaign.channel, status: 'PREPARING', decision: member.decision, reasons: member.reasons as Prisma.InputJsonValue,
          },
        });
        enrolled += 1;
      } catch (error) {
        if (!duplicate(error)) throw error;
      }
    }
    const row = await tx.campaign.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: campaignId } }, data: { state: 'SIMULATING', revision: { increment: 1 }, sendingStatus: SENDING_CAPABILITY, liveDelivery: false } });
    const run = await tx.campaignRun.create({ data: { tenantId: actor.tenantId, campaignId, sequenceVersionId: campaign.sequenceVersionId, segmentVersionId: campaign.segmentVersionId, state: 'SIMULATING', traceId: randomUUID(), createdBy: actor.userId, startedAt: new Date() } });
    await tx.outboxEvent.create({ data: { tenantId: actor.tenantId, eventType: 'campaign.simulation.run.v1', aggregateId: run.id, payload: { userId: actor.userId, kind: 'campaign.simulation.run' } } });
    await activity(tx, actor, campaignId, 'campaign.simulate', campaign.state, 'SIMULATING', { enrolled, sendAttempts: 0 });
    return { campaign: present(row), runId: run.id, enrolled, sendAttempts: 0 as const };
  });
}

export async function processCampaignJob(prisma: PrismaClient, input: { tenantId: string; runId: string; userId: string; kind: CampaignJobName; pause?: CampaignPause }) {
  const gate = await withTenant(prisma, input.tenantId, async (tx) => ({ active: await tenantActive(tx, input.tenantId), allowed: await memberHas(tx, input.tenantId, input.userId, 'campaigns.simulate') }));
  if (!gate.active || !gate.allowed) return { done: true as const, sendAttempts: 0 as const, stopped: gate.active ? 'AUTH_REVOKED' : 'TENANT_SUSPENDED' };
  if (input.kind === 'campaign.analytics.aggregate') {
    const metrics = await campaignAnalytics(prisma, input.tenantId, null);
    await withTenant(prisma, input.tenantId, (tx) => tx.campaignAnalyticsSnapshot.create({ data: { tenantId: input.tenantId, windowStart: new Date(Date.now() - 86_400_000), windowEnd: new Date(), metrics } }));
    return { done: true as const, sendAttempts: 0 as const };
  }
  const run = await withTenant(prisma, input.tenantId, (tx) => tx.campaignRun.findUnique({ where: { tenantId_id: { tenantId: input.tenantId, id: input.runId } } }));
  if (!run) return { done: true as const, sendAttempts: 0 as const };
  if ((input.kind === 'campaign.segment.materialize' || input.kind === 'campaign.audience.evaluate') && run.segmentVersionId) {
    const version = await withTenant(prisma, input.tenantId, (tx) => tx.audienceSegmentVersion.findUnique({ where: { tenantId_id: { tenantId: input.tenantId, id: run.segmentVersionId! } } }));
    if (version) await materializeSegment(prisma, { tenantId: input.tenantId, userId: input.userId }, version.segmentId, input.pause);
    return { done: true as const, sendAttempts: 0 as const };
  }
  if (input.kind === 'campaign.draft.personalize') {
    const enrollment = await withTenant(prisma, input.tenantId, (tx) => tx.campaignEnrollment.findFirst({ where: { tenantId: input.tenantId, campaignId: run.campaignId } }));
    if (enrollment) await personalizeDraft(prisma, { tenantId: input.tenantId, userId: input.userId }, { campaignId: run.campaignId, leadId: enrollment.leadId }, input.pause);
    return { done: true as const, sendAttempts: 0 as const };
  }
  if (input.kind === 'campaign.approval.request') {
    await requestApproval(prisma, { tenantId: input.tenantId, userId: input.userId }, { kind: 'CONFIGURATION', subjectId: run.campaignId, versionRef: '1', digest: campaignDigest({ campaignId: run.campaignId }) });
    return { done: true as const, sendAttempts: 0 as const };
  }
  for (let step = 0; step < 12; step += 1) {
    const moved = await advanceCampaignRun(prisma, { tenantId: input.tenantId, userId: input.userId }, run.campaignId, input.pause);
    if (moved.advanced === 0) break;
  }
  return { done: true as const, sendAttempts: 0 as const };
}

export async function advanceCampaignRun(prisma: PrismaClient, actor: Actor, campaignId: string, pause?: CampaignPause) {
  const campaign = await withTenant(prisma, actor.tenantId, (tx) => requiredCampaign(tx, actor.tenantId, campaignId));
  if (['PAUSED', 'CANCELLED', 'ARCHIVED'].includes(campaign.state)) return { advanced: 0, sendAttempts: 0 as const };
  const enrollments = await withTenant(prisma, actor.tenantId, (tx) => tx.campaignEnrollment.findMany({ where: { tenantId: actor.tenantId, campaignId, status: { in: ['PREPARING', 'WAITING', 'WAITING_APPROVAL', 'READY_FOR_REVIEW'] } } }));
  let advanced = 0;
  for (const enrollment of enrollments) {
    const moved = await advanceEnrollment(prisma, actor, enrollment.id, pause);
    if (moved) advanced += 1;
  }
  const remaining = await withTenant(prisma, actor.tenantId, (tx) => tx.campaignEnrollment.count({ where: { tenantId: actor.tenantId, campaignId, status: { in: ['PREPARING', 'WAITING', 'WAITING_APPROVAL', 'READY_FOR_REVIEW', 'PAUSED'] } } }));
  if (remaining === 0 && campaign.state === 'SIMULATING') await transitionCampaign(prisma, actor, campaignId, campaign.revision, 'COMPLETED_SIMULATION').catch(() => undefined);
  return { advanced, sendAttempts: 0 as const };
}

export async function campaignAnalytics(prisma: PrismaClient, tenantId: string, campaignId: string | null, filter?: { ownerUserId?: string; from?: string; to?: string }): Promise<CampaignAnalytics> {
  return withTenant(prisma, tenantId, async (tx) => {
    const metrics = emptyAnalytics();
    const from = filter?.from ? new Date(filter.from) : null;
    const to = filter?.to ? new Date(filter.to) : null;
    const campaigns = await tx.campaign.findMany({
      where: {
        tenantId,
        ...(campaignId ? { id: campaignId } : {}),
        ...(filter?.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
        ...((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime())) ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
      },
    });
    metrics.totalCampaigns = campaigns.length;
    metrics.draftCampaigns = campaigns.filter((row) => row.state === 'DRAFT' || row.state === 'CONFIGURING').length;
    metrics.approvedCampaigns = campaigns.filter((row) => ['APPROVED', 'SCHEDULED', 'SIMULATING', 'PAUSED', 'COMPLETED_SIMULATION'].includes(row.state)).length;
    metrics.scheduledSimulations = campaigns.filter((row) => row.state === 'SCHEDULED').length;
    metrics.pausedCampaigns = campaigns.filter((row) => row.state === 'PAUSED').length;
    metrics.completedSimulations = campaigns.filter((row) => row.state === 'COMPLETED_SIMULATION').length;
    const versionIds = campaigns.map((row) => row.segmentVersionId).filter((value): value is string => Boolean(value));
    const members = versionIds.length ? await tx.audienceMember.findMany({ where: { tenantId, segmentVersionId: { in: versionIds } } }) : [];
    metrics.audienceSize = members.length;
    metrics.eligibleForPreparation = members.filter((row) => row.decision === 'ELIGIBLE_FOR_PREPARATION').length;
    metrics.suppressed = members.filter((row) => JSON.stringify(row.reasons).includes('SUPPRESSED')).length;
    metrics.humanOwned = members.filter((row) => JSON.stringify(row.reasons).includes('HUMAN_OWNED')).length;
    metrics.unknownEligibility = members.filter((row) => row.decision === 'UNKNOWN').length;
    const leadIds = members.map((row) => row.leadId);
    metrics.qualifiedLeads = leadIds.length ? await tx.crmLead.count({ where: { tenantId, id: { in: leadIds }, stage: 'QUALIFIED' } }) : 0;
    const drafts = await tx.campaignDraft.findMany({ where: { tenantId, ...(campaignId ? { campaignId } : {}) } });
    metrics.draftsGenerated = drafts.length;
    metrics.draftsAwaitingApproval = drafts.filter((row) => row.state === 'READY_FOR_REVIEW' || row.state === 'REVIEW_REQUIRED').length;
    const approvals = await tx.campaignApproval.count({ where: { tenantId, kind: 'DRAFT', state: 'APPROVED' } });
    metrics.draftsApproved = approvals;
    metrics.simulationStepsCompleted = await tx.campaignStepExecution.count({ where: { tenantId, outcome: { in: ['SIMULATED_STEP', 'DRAFT_PREPARED', 'SIMULATION_COMPLETE'] } } });
    metrics.failedInternalTasks = await tx.campaignStepExecution.count({ where: { tenantId, status: 'FAILED' } });
    metrics.stoppedEnrollments = await tx.campaignEnrollment.count({ where: { tenantId, ...(campaignId ? { campaignId } : {}), status: { in: ['STOPPED', 'BLOCKED', 'CANCELLED'] } } });
    const finished = await tx.campaignStepExecution.findMany({ where: { tenantId, startedAt: { not: null }, finishedAt: { not: null } }, take: 100 });
    const durations = finished.map((row) => (row.finishedAt!.getTime() - row.startedAt!.getTime())).filter((value) => value >= 0);
    metrics.averagePreparationMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
    return metrics;
  });
}

export async function campaignPromptFacts(tx: Tx, tenantId: string, campaignId: string, leadId: string | null): Promise<string> {
  const campaign = await tx.campaign.findUnique({ where: { tenantId_id: { tenantId, id: campaignId } } });
  const lead = leadId ? await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: leadId } }, include: { account: true, contact: true } }) : null;
  return [
    campaign ? `campaign: ${campaign.name}` : '',
    campaign?.goal ? `goal: ${campaign.goal}` : '',
    `company_name: ${lead?.account.displayName || 'unknown'}`,
    `industry: ${lead?.account.industry || 'unknown'}`,
    `contact_first_name: ${lead?.contact?.name.split(' ')[0] || 'unknown'}`,
    'revenue: unknown',
    'employees: unknown',
  ].filter(Boolean).join('\n');
}

export async function executeCampaignTool(tx: Tx, tenantId: string, actor: { userId: string; campaignId?: string }, toolName: string, prior: Array<{ toolName: string; outputRedacted: unknown }>) {
  const campaign = actor.campaignId ? await tx.campaign.findUnique({ where: { tenantId_id: { tenantId, id: actor.campaignId } } }) : null;
  if (toolName === 'campaign.message.validate') {
    const model = prior.find((call) => call.toolName === 'campaign.message.personalize')?.outputRedacted as { text?: string } | undefined;
    const decision = acceptPersonalization('Hello {{company_name}}', [campaign?.name ?? ''], model?.text);
    return { ...decision, externalSend: false, sendAttempts: 0 };
  }
  if (toolName === 'campaign.approval.propose') return { state: 'PENDING', externalSend: false, sendAttempts: 0 };
  return { campaign: campaign ? present(campaign) : null, externalSend: false, sendAttempts: 0, replyDetection: 'UNAVAILABLE' as const };
}

export async function personalizeDraft(prisma: PrismaClient, actor: Actor, input: { campaignId: string; leadId: string; templateVersionId?: string; modelText?: string; modelProvider?: string; modelName?: string }, pause?: CampaignPause) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await checkpoint(pause, 'during-draft');
    const campaign = await requiredCampaign(tx, actor.tenantId, input.campaignId);
    const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.leadId } }, include: { account: true, contact: true } });
    if (!lead) throw new CampaignError(404, 'NOT_FOUND', 'Lead was not found');
    const existing = await tx.campaignDraft.findFirst({ where: { tenantId: actor.tenantId, campaignId: input.campaignId, contactId: lead.contactId } });
    if (existing) return { draftId: existing.id, status: existing.state, acceptedModel: false, externalSend: false, sendAttempts: 0 as const };
    const template = input.templateVersionId ? await tx.campaignTemplateVersion.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.templateVersionId } } }) : null;
    const product = campaign.productVersionId ? await tx.productVersion.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: campaign.productVersionId } } }) : null;
    const values = {
      company_name: lead.account.displayName || null,
      contact_first_name: lead.contact?.name.split(' ')[0] || null,
      product_name: product ? ((product.snapshot as { name?: string }).name ?? null) : null,
      industry: lead.account.industry,
      verified_pain_point: lead.account.description || null,
    };
    const rendered = renderTemplate(template?.bodyText || 'Hello {{company_name}}', values, false);
    const facts = Object.values(values).filter((value): value is string => Boolean(value));
    const decision = acceptPersonalization(rendered.text, facts, input.modelText);
    const draft = await tx.campaignDraft.create({ data: { tenantId: actor.tenantId, campaignId: input.campaignId, contactId: lead.contactId, state: decision.status, createdBy: actor.userId } });
    const body = decision.text;
    await tx.campaignDraftVersion.create({
      data: {
        tenantId: actor.tenantId, draftId: draft.id, versionNumber: 1, subject: template?.subject || campaign.name, bodyText: body,
        facts, citations: [], modelProvider: decision.acceptedModel ? input.modelProvider ?? null : null, modelName: decision.acceptedModel ? input.modelName ?? null : null,
        templateVersionId: template?.id, digest: campaignDigest({ body, facts }), editedBy: actor.userId,
      },
    });
    return { draftId: draft.id, status: decision.status, acceptedModel: decision.acceptedModel, externalSend: false, sendAttempts: 0 as const };
  }).then(async (result) => {
    await checkpoint(pause, 'after-draft');
    return result;
  });
}

async function advanceEnrollment(prisma: PrismaClient, actor: Actor, enrollmentId: string, pause?: CampaignPause) {
  const moved = await withTenant(prisma, actor.tenantId, async (tx) => {
    await checkpoint(pause, 'during-advance');
    const enrollment = await tx.campaignEnrollment.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollmentId } } });
    if (!enrollment) return false;
    const campaign = await requiredCampaign(tx, actor.tenantId, enrollment.campaignId);
    if (['PAUSED', 'CANCELLED', 'ARCHIVED'].includes(campaign.state)) return false;
    const steps = await tx.campaignSequenceStep.findMany({ where: { tenantId: actor.tenantId, sequenceVersionId: enrollment.sequenceVersionId }, orderBy: { position: 'asc' } });
    const step = steps.find((item) => item.position > enrollment.currentStep);
    if (!step) {
      await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollmentId } }, data: { status: 'COMPLETED_SIMULATION' } });
      return true;
    }
    const key = `${enrollment.id}:${step.id}`;
    const existing = await tx.campaignStepExecution.findFirst({ where: { tenantId: actor.tenantId, idempotencyKey: key } });
    const lead = await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.leadId } }, include: { account: true, contact: true } });
    const suppressionMatch = [lead?.contactId ? { contactId: lead.contactId } : null, lead?.accountId ? { accountId: lead.accountId } : null].filter((item): item is { contactId: string } | { accountId: string } => Boolean(item));
    const suppressed = suppressionMatch.length ? await tx.crmSuppression.findFirst({ where: { tenantId: actor.tenantId, active: true, OR: suppressionMatch } }) : null;
    const takeoverIds = [enrollment.leadId, lead?.contactId].filter((value): value is string => Boolean(value));
    const takeover = takeoverIds.length ? await tx.crmTakeover.findFirst({ where: { tenantId: actor.tenantId, active: true, subjectId: { in: takeoverIds } } }) : null;
    const reason = stopReason({
      verifiedReply: false,
      replyDetection: 'UNAVAILABLE',
      humanTakeover: Boolean(takeover),
      suppressed: Boolean(suppressed),
      consentWithdrawn: lead?.contact?.consentState === 'WITHDRAWN',
      leadClosed: lead?.stage === 'DISQUALIFIED' || lead?.stage === 'ARCHIVED',
      contactInvalid: !lead?.contactId,
      tenantSuspended: false,
      campaignStopped: campaign.state === 'CANCELLED',
      manualStop: false,
      stepsExhausted: false,
      endDateReached: Boolean(campaign.endsAt && campaign.endsAt.getTime() <= Date.now()),
    });
    if (existing) {
      const due = existing.status === 'WAITING' && existing.scheduledFor && existing.scheduledFor.getTime() <= Date.now();
      if (!due) return false;
      if (reason) {
        await tx.campaignStepExecution.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: existing.id } }, data: { status: 'STOPPED', outcome: 'BLOCKED', finishedAt: new Date(), detail: { reason, replyDetection: 'UNAVAILABLE' } } });
        await tx.campaignSchedule.updateMany({ where: { tenantId: actor.tenantId, stepExecutionId: existing.id }, data: { status: 'STOPPED' } });
        await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: 'STOPPED', currentStep: step.position } });
        return true;
      }
      await tx.campaignStepExecution.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: existing.id } }, data: { status: 'PREPARING', outcome: 'SIMULATED_STEP', finishedAt: new Date() } });
      await tx.campaignSchedule.updateMany({ where: { tenantId: actor.tenantId, stepExecutionId: existing.id }, data: { status: 'COMPLETED' } });
      await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: 'PREPARING', currentStep: step.position } });
      return true;
    }
    if (reason) {
      await finishStep(tx, actor.tenantId, enrollment.id, step.id, step.position, 'STOPPED', 'BLOCKED', key, { reason, replyDetection: 'UNAVAILABLE' });
      await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: 'STOPPED', currentStep: step.position } });
      return true;
    }
    if (step.stepType === 'WAIT_DURATION' || step.stepType === 'WAIT_UNTIL') {
      const due = waitUntil(new Date(), step.config as Record<string, unknown>, campaign.timeZone);
      if (due && due.getTime() > Date.now()) {
        const execution = await finishStep(tx, actor.tenantId, enrollment.id, step.id, step.position, 'WAITING', 'WAITING', key, { replyDetection: 'UNAVAILABLE' }, due);
        await tx.campaignSchedule.create({ data: { tenantId: actor.tenantId, campaignId: campaign.id, enrollmentId: enrollment.id, stepExecutionId: execution.id, runAt: due, timeZone: campaign.timeZone, status: 'WAITING', kind: 'WAIT' } });
        await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: 'WAITING' } });
        return true;
      }
    }
    if (step.stepType === 'APPROVAL_GATE' || step.stepType === 'HUMAN_TASK') {
      await finishStep(tx, actor.tenantId, enrollment.id, step.id, step.position, 'WAITING_APPROVAL', 'REQUIRES_REVIEW', key, {});
      await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: 'WAITING_APPROVAL' } });
      return true;
    }
    const outcome = step.stepType === 'END_SEQUENCE' ? 'SIMULATION_COMPLETE' : step.stepType === 'EMAIL_DRAFT' ? 'DRAFT_PREPARED' : 'SIMULATED_STEP';
    await finishStep(tx, actor.tenantId, enrollment.id, step.id, step.position, outcome === 'SIMULATION_COMPLETE' ? 'COMPLETED_SIMULATION' : 'PREPARING', outcome, key, { replyDetection: 'UNAVAILABLE', externalSend: false });
    if (step.stepType === 'EMAIL_DRAFT') {
      const draft = await tx.campaignDraft.create({ data: { tenantId: actor.tenantId, campaignId: campaign.id, enrollmentId: enrollment.id, stepId: step.id, contactId: enrollment.contactId, state: 'DRAFT_PREPARED', createdBy: actor.userId } });
      await tx.campaignDraftVersion.create({ data: { tenantId: actor.tenantId, draftId: draft.id, versionNumber: 1, subject: campaign.name, bodyText: `Hello ${lead?.account.displayName ?? ''}`.trim(), facts: [lead?.account.displayName ?? ''].filter(Boolean), digest: campaignDigest({ enrollment: enrollment.id, step: step.id }), editedBy: actor.userId } });
    }
    await tx.campaignEnrollment.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: enrollment.id } }, data: { status: step.stepType === 'END_SEQUENCE' ? 'COMPLETED_SIMULATION' : 'PREPARING', currentStep: step.position } });
    return true;
  });
  if (moved) await checkpoint(pause, 'after-step');
  return moved;
}

async function finishStep(tx: Tx, tenantId: string, enrollmentId: string, stepId: string, position: number, status: string, outcome: string, key: string, detail: Record<string, unknown>, scheduledFor?: Date) {
  return tx.campaignStepExecution.create({ data: { tenantId, enrollmentId, stepId, position, status, outcome, idempotencyKey: key, scheduledFor, startedAt: new Date(), finishedAt: scheduledFor ? null : new Date(), detail: detail as Prisma.InputJsonValue } });
}

async function decideAll(tx: Tx, tenantId: string, filter: SegmentFilter) {
  const activeLeads = await tx.crmLead.count({ where: { tenantId, archivedAt: null } });
  if (activeLeads > SEGMENT_LIMITS.maxCandidates) {
    throw new CampaignError(422, 'AUDIENCE_LIMIT', `Audience evaluation refused because this organization has ${activeLeads} active leads, above the limit of ${SEGMENT_LIMITS.maxCandidates}. No partial audience was saved.`);
  }
  const leads = await tx.crmLead.findMany({ where: { tenantId, archivedAt: null }, include: { account: true, contact: true }, orderBy: { createdAt: 'desc' } });
  const [suppressions, takeovers, policy, enrolled] = await Promise.all([
    tx.crmSuppression.findMany({ where: { tenantId, active: true } }),
    tx.crmTakeover.findMany({ where: { tenantId, active: true } }),
    tx.crmContactPolicy.findUnique({ where: { tenantId } }),
    tx.campaignEnrollment.findMany({ where: { tenantId }, select: { identityKey: true, campaignId: true, channel: true } }),
  ]);
  const quiet = {
    timezone: policy?.timezone ?? null,
    weekdays: Array.isArray(policy?.weekdays) ? policy.weekdays as number[] : [1, 2, 3, 4, 5],
    startMinute: policy?.startMinute ?? 0,
    endMinute: policy?.endMinute ?? 1440,
    holidays: Array.isArray(policy?.holidays) ? policy.holidays as string[] : [],
    minimumIntervalHours: policy?.minimumIntervalHours ?? 0,
    maxAttemptsPerPeriod: policy?.maxAttempts ?? 0,
  };
  const seen = new Set<string>();
  return leads.map((lead) => {
    const candidate = toCandidate(lead, suppressions.some((row) => row.contactId === lead.contactId || row.accountId === lead.accountId), takeovers.some((row) => row.subjectId === lead.id || row.subjectId === lead.contactId));
    if (!matchFilter(filter, candidate)) return null;
    const duplicateEnrollment = Boolean(candidate.identityKey && (enrolled.some((row) => row.identityKey === candidate.identityKey) || seen.has(candidate.identityKey)));
    if (candidate.identityKey) seen.add(candidate.identityKey);
    const decision = preparationDecision({ candidate, quiet, now: new Date(), duplicate: duplicateEnrollment, frequencyBlocked: false });
    return { candidate, ...decision };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function toCandidate(lead: { id: string; contactId: string | null; productId: string | null; icpName: string | null; score: number | null; grade: string; stage: string; sourceType: string; ownerUserId: string | null; lastResearchedAt: Date | null; archivedAt: Date | null; account: { industry: string | null; sizeRange: string | null; country: string | null; region: string | null; businessModel: string | null; source: string; lifecycleStatus: string; description: string | null }; contact: { emailHmac: string | null; verificationStatus: string; consentState: string; contactRole: string | null; jobTitle: string | null; seniority: string | null; name: string } | null }, suppressed: boolean, humanTakeover: boolean): AudienceCandidate {
  const filled = [lead.account.industry, lead.account.country, lead.contact?.name, lead.contact?.jobTitle].filter(Boolean).length;
  return {
    leadId: lead.id, contactId: lead.contactId, identityKey: lead.contact?.verificationStatus === 'VERIFIED' ? lead.contact.emailHmac : null,
    productId: lead.productId, icpName: lead.icpName, score: lead.score, grade: lead.grade, stage: lead.stage, industry: lead.account.industry,
    sizeRange: lead.account.sizeRange, country: lead.account.country, region: lead.account.region, businessModel: lead.account.businessModel,
    source: lead.sourceType, accountStatus: lead.account.lifecycleStatus, contactRole: lead.contact?.contactRole ?? null, jobTitle: lead.contact?.jobTitle ?? null,
    seniority: lead.contact?.seniority ?? null, verification: lead.contact?.verificationStatus ?? 'UNKNOWN', consent: lead.contact?.consentState ?? 'UNKNOWN',
    suppressed, humanTakeover, ownerUserId: lead.ownerUserId, lastActivityAt: null, lastResearchedAt: lead.lastResearchedAt?.toISOString() ?? null, completeness: filled * 25, archived: Boolean(lead.archivedAt),
  };
}

function summarize(rows: Array<{ candidate: AudienceCandidate; decision: string; reasons: string[] }>, includeLabels: boolean) {
  return {
    total: rows.length,
    eligibleForPreparation: rows.filter((row) => row.decision === 'ELIGIBLE_FOR_PREPARATION').length,
    reviewRequired: rows.filter((row) => row.decision === 'REVIEW_REQUIRED').length,
    suppressed: rows.filter((row) => row.reasons.includes('SUPPRESSED')).length,
    humanOwned: rows.filter((row) => row.reasons.includes('HUMAN_OWNED')).length,
    missingContact: rows.filter((row) => row.reasons.includes('MISSING_CONTACT')).length,
    missingPermission: rows.filter((row) => row.reasons.includes('CONSENT_UNKNOWN') || row.decision === 'UNKNOWN').length,
    duplicates: rows.filter((row) => row.reasons.includes('DUPLICATE_ENROLLMENT')).length,
    unknown: rows.filter((row) => row.decision === 'UNKNOWN').length,
    items: includeLabels ? rows.slice(0, 50).map((row) => ({ leadId: row.candidate.leadId, decision: row.decision, reasons: row.reasons, company: row.candidate.industry })) : [],
  };
}

async function saveSequence(tx: Tx, actor: Actor, input: { name: string; steps: SequenceStepDraft[]; timeZone?: string }, sequenceId: string | null) {
  const sequence = sequenceId ? await tx.campaignSequence.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequenceId } }, data: { revision: { increment: 1 } } }) : await tx.campaignSequence.create({ data: { tenantId: actor.tenantId, name: clean(input.name, 160), createdBy: actor.userId } });
  const latest = await tx.campaignSequenceVersion.findFirst({ where: { tenantId: actor.tenantId, sequenceId: sequence.id }, orderBy: { versionNumber: 'desc' } });
  const version = await tx.campaignSequenceVersion.create({ data: { tenantId: actor.tenantId, sequenceId: sequence.id, versionNumber: (latest?.versionNumber ?? 0) + 1, timeZone: zone(input.timeZone), createdBy: actor.userId } });
  await writeSteps(tx, actor.tenantId, version.id, input.steps);
  await tx.campaignSequence.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: sequence.id } }, data: { currentVersionId: version.id } });
  return { id: sequence.id, versionId: version.id, frozen: false };
}

async function writeSteps(tx: Tx, tenantId: string, versionId: string, steps: SequenceStepDraft[]) {
  for (const step of steps) {
    const row = await tx.campaignSequenceStep.create({ data: { tenantId, sequenceVersionId: versionId, position: step.position, stepType: step.stepType, config: step.config as Prisma.InputJsonValue } });
    if (step.stepType === 'CONDITION') await tx.campaignSequenceCondition.create({ data: { tenantId, stepId: row.id, field: String(step.config.field), operator: 'eq', expected: {} } });
  }
}

async function pinProduct(tx: Tx, tenantId: string, versionId?: string, icpRef?: string) {
  if (!versionId) return null;
  const version = await tx.productVersion.findUnique({ where: { tenantId_id: { tenantId, id: versionId } } });
  if (!version || version.status !== 'PUBLISHED') throw new CampaignError(422, 'PRODUCT_UNPUBLISHED', 'Choose a published product version');
  const icps = ((version.snapshot as { icps?: Array<{ id?: string; name?: string }> }).icps ?? []);
  if (icpRef && !icps.some((item) => item.id === icpRef || item.name === icpRef)) throw new CampaignError(422, 'ICP_UNAUTHORIZED', 'That ICP is not on the published version');
  return { productId: version.productId, versionId: version.id, icpRef: icpRef ?? null };
}

async function requiredCampaign(tx: Tx, tenantId: string, id: string) {
  const row = await tx.campaign.findUnique({ where: { tenantId_id: { tenantId, id } } });
  if (!row) throw new CampaignError(404, 'NOT_FOUND', 'Campaign was not found');
  return row;
}

async function assertSeparateReview(tx: Tx, actor: Actor, campaignId: string, to: CampaignState) {
  if (to !== 'APPROVED') return;
  const approval = await tx.campaignApproval.findFirst({ where: { tenantId: actor.tenantId, subjectId: campaignId, kind: 'CONFIGURATION', state: { in: ['PENDING', 'APPROVED'] } }, orderBy: { createdAt: 'desc' } });
  if (!approval) throw new CampaignError(422, 'REVIEW_REQUIRED', 'Submit the campaign for review first');
  if (approval.requestedBy === actor.userId) throw new CampaignError(403, 'SEPARATION_OF_DUTIES', 'Another member must approve the campaign');
}

async function activity(tx: Tx, actor: Actor, campaignId: string, action: string, from: string | null, to: string, detail: Record<string, unknown> = {}) {
  await tx.campaignActivity.create({ data: { tenantId: actor.tenantId, campaignId, action, actorId: actor.userId, fromState: from, toState: to, detail: detail as Prisma.InputJsonValue } });
  await tx.auditEvent.create({ data: { tenantId: actor.tenantId, actorType: 'user', actorId: actor.userId, action, entityType: 'campaign', entityId: campaignId, payload: { ...detail, from, to, sendAttempts: 0 } } });
}

async function memberHas(tx: Tx, tenantId: string, userId: string, permission: string) {
  const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
  return Boolean(membership && membership.status === 'ACTIVE' && membership.roles.some((link) => link.role.permissions.some((item) => item.permission === permission)));
}

async function tenantActive(tx: Tx, tenantId: string) {
  const rows = await tx.$queryRaw<Array<{ tenant_is_active: boolean }>>`SELECT tenant_is_active(${tenantId}::uuid) AS tenant_is_active`;
  return rows[0]?.tenant_is_active === true;
}

function present(row: { sendingStatus: string; liveDelivery: boolean; state: string; name: string; id: string; revision: number; channel: string; timeZone: string; productVersionId: string | null; segmentVersionId: string | null; sequenceVersionId: string | null; ownerUserId: string | null; goal: string; description: string; campaignType: string; icpRef: string | null; startsAt: Date | null; endsAt: Date | null; archivedAt: Date | null; updatedAt: Date; createdAt: Date }) {
  return { ...row, sendingStatus: SENDING_CAPABILITY, liveDelivery: false, externalDelivery: 'NOT_AUTHORIZED' as const, sent: 'NOT_AVAILABLE' as const };
}

function page(query: PageQuery) {
  const pageNumber = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  return { page: pageNumber, pageSize, skip: (pageNumber - 1) * pageSize, take: pageSize };
}

function clean(value: string, max: number) {
  let text = '';
  for (const char of value) text += char.charCodeAt(0) <= 31 ? ' ' : char;
  return text.trim().slice(0, max);
}

function zone(value?: string) {
  const chosen = value || 'UTC';
  if (!isValidTimeZone(chosen)) throw new CampaignError(422, 'TIME_ZONE', 'Use an IANA time zone');
  return chosen;
}

function duplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

async function checkpoint(pause: CampaignPause | undefined, point: CampaignPause) {
  if (pause !== point) return;
  writeSync(1, 'checkpoint\n');
  await new Promise(() => undefined);
}

type CampaignInput = { name: string; description?: string; goal?: string; campaignType?: string; timeZone?: string; ownerUserId?: string; productVersionId?: string; icpRef?: string };
