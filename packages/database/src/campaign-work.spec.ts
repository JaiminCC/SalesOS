import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';
import {
  advanceCampaignRun,
  assignAudience,
  assignSequence,
  campaignAnalytics,
  campaignRecord,
  createCampaign,
  createSegment,
  createSequence,
  decideApproval,
  freezeSequence,
  materializeSegment,
  previewSegment,
  requestApproval,
  startSimulation,
  transitionCampaign,
  updateCampaign,
} from './campaign-work';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;

describe.skipIf(!adminUrl || !appUrl)('campaign preparation', () => {
  const admin = createPrismaClient(adminUrl as string);
  const app = createPrismaClient(appUrl as string);
  const stamp = randomUUID().slice(0, 8);
  let tenantId = '';
  let otherId = '';
  let userId = '';
  let reviewerId = '';

  afterAll(async () => {
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (otherId) await admin.tenant.delete({ where: { id: otherId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (reviewerId) await admin.user.delete({ where: { id: reviewerId } }).catch(() => undefined);
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('prepares a pinned campaign, blocks ineligible people, and does not send', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Campaign ${stamp}`, slug: `campaign-${stamp}` } });
    const other = await admin.tenant.create({ data: { name: `Other ${stamp}`, slug: `other-campaign-${stamp}` } });
    tenantId = tenant.id;
    otherId = other.id;
    const user = await admin.user.create({ data: { emailHmac: `campaign-${stamp}`, emailCiphertext: Buffer.from('a'), displayName: 'Owner', status: 'ACTIVE' } });
    const reviewer = await admin.user.create({ data: { emailHmac: `review-${stamp}`, emailCiphertext: Buffer.from('b'), displayName: 'Reviewer', status: 'ACTIVE' } });
    userId = user.id;
    reviewerId = reviewer.id;
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId: reviewerId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    for (const permission of ['campaigns.simulate', 'campaigns.review']) await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission } });
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
    await admin.membershipRole.create({ data: { tenantId, userId: reviewerId, roleId: role.id } });
    await admin.crmContactPolicy.create({ data: { tenantId, timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440, holidays: [], minimumIntervalHours: 0, maxAttempts: 100 } });
    const product = await admin.product.create({ data: { tenantId, name: 'Field Kit', productType: 'PHYSICAL', createdBy: userId, updatedBy: userId } });
    const version = await admin.productVersion.create({ data: { tenantId, productId: product.id, versionNumber: 1, status: 'PUBLISHED', snapshot: { name: 'Field Kit', icps: [{ id: 'icp-1', name: 'Operators' }] }, publishedAt: new Date(), createdBy: userId, updatedBy: userId } });
    const ready = await lead('Ready', 'KNOWN', 'VERIFIED', false, false);
    await lead('Suppressed', 'KNOWN', 'VERIFIED', true, false);
    await lead('Owned', 'KNOWN', 'VERIFIED', false, true);
    await lead('Unknown', 'UNKNOWN', 'VERIFIED', false, false);
    const actor = { tenantId, userId };
    const campaign = await createCampaign(app, actor, { name: 'Spring introduction', goal: 'Prepare a draft', productVersionId: version.id, icpRef: 'Operators', timeZone: 'UTC' });
    expect(campaign.sendingStatus).toBe('NOT_AUTHORIZED');
    expect(campaign.liveDelivery).toBe(false);
    await expect(transitionCampaign(app, actor, campaign.id, campaign.revision, 'SIMULATING')).rejects.toThrow(/not available/);
    await expect(previewSegment(app, actor, { op: 'and', items: [{ field: 'stage; delete', operator: 'eq', value: 'QUALIFIED' }] }, false)).rejects.toThrow(/not valid/);
    const preview = await previewSegment(app, actor, { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'QUALIFIED' }] }, true);
    expect(preview.eligibleForPreparation).toBe(1);
    expect(preview.suppressed).toBe(1);
    expect(preview.humanOwned).toBe(1);
    expect(preview.unknown).toBe(1);
    const segment = await createSegment(app, actor, { name: 'Qualified', kind: 'SNAPSHOT', filter: { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'QUALIFIED' }] } });
    const first = await materializeSegment(app, actor, segment.id);
    const second = await materializeSegment(app, actor, segment.id);
    expect(second.frozen).toBe(true);
    expect(second.inserted).toBe(0);
    expect(await admin.audienceMember.count({ where: { tenantId, segmentVersionId: first.versionId } })).toBe(4);
    const assigned = await assignAudience(app, actor, campaign.id, campaign.revision, segment.id);
    const sequence = await createSequence(app, actor, { name: 'Three steps', timeZone: 'UTC', steps: [{ position: 1, stepType: 'EMAIL_DRAFT', config: { next: 2 } }, { position: 2, stepType: 'END_SEQUENCE', config: {} }] });
    await freezeSequence(app, actor, sequence.id);
    const sequenced = await assignSequence(app, actor, campaign.id, assigned.revision, sequence.id);
    const configuring = await transitionCampaign(app, actor, campaign.id, sequenced.revision, 'CONFIGURING');
    const audienceReady = await transitionCampaign(app, actor, campaign.id, configuring.revision, 'AUDIENCE_READY');
    const sequenceReady = await transitionCampaign(app, actor, campaign.id, audienceReady.revision, 'SEQUENCE_READY');
    const pending = await transitionCampaign(app, actor, campaign.id, sequenceReady.revision, 'PENDING_REVIEW');
    const approval = await requestApproval(app, actor, { kind: 'CONFIGURATION', subjectId: campaign.id, versionRef: '1', digest: campaignDigest(campaign.id) });
    await expect(transitionCampaign(app, actor, campaign.id, pending.revision, 'APPROVED')).rejects.toThrow(/Another member/);
    const decided = await decideApproval(app, { tenantId, userId: reviewerId }, { id: approval.id, decision: 'APPROVED', digest: approval.digest });
    expect(decided.state).toBe('APPROVED');
    const approved = await transitionCampaign(app, { tenantId, userId: reviewerId }, campaign.id, pending.revision, 'APPROVED');
    expect(approved.state).toBe('APPROVED');
    await expect(updateCampaign(app, actor, { ...campaign, id: campaign.id, revision: approved.revision, name: 'Changed' })).rejects.toThrow(/frozen/);
    await transitionCampaign(app, actor, campaign.id, approved.revision, 'SCHEDULED');
    const started = await startSimulation(app, actor, campaign.id);
    expect(started.enrolled).toBe(1);
    expect(started.sendAttempts).toBe(0);
    await advanceCampaignRun(app, actor, campaign.id);
    expect(await admin.campaignDraft.count({ where: { tenantId, campaignId: campaign.id } })).toBe(1);
    await advanceCampaignRun(app, actor, campaign.id);
    const finished = await campaignRecord(app, tenantId, campaign.id);
    expect(finished.state).toBe('COMPLETED_SIMULATION');
    expect(finished.sent).toBe('NOT_AVAILABLE');
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    const metrics = await campaignAnalytics(app, tenantId, campaign.id);
    expect(metrics.external.sent).toBe('NOT_AVAILABLE');
    expect(metrics.eligibleForPreparation).toBe(1);
    await expect(campaignRecord(app, otherId, campaign.id)).rejects.toThrow(/not found/);
    const waited = await createCampaign(app, actor, { name: 'Wait then stop', goal: 'Check a later suppression', productVersionId: version.id, icpRef: 'Operators', timeZone: 'UTC' });
    const waitSequence = await createSequence(app, actor, { name: 'Wait', timeZone: 'UTC', steps: [{ position: 1, stepType: 'WAIT_DURATION', config: { hours: 2, next: 2 } }, { position: 2, stepType: 'END_SEQUENCE', config: {} }] });
    await freezeSequence(app, actor, waitSequence.id);
    const waitAssigned = await assignAudience(app, actor, waited.id, waited.revision, segment.id);
    const waitSequenced = await assignSequence(app, actor, waited.id, waitAssigned.revision, waitSequence.id);
    const waitConfiguring = await transitionCampaign(app, actor, waited.id, waitSequenced.revision, 'CONFIGURING');
    const waitAudience = await transitionCampaign(app, actor, waited.id, waitConfiguring.revision, 'AUDIENCE_READY');
    const waitReady = await transitionCampaign(app, actor, waited.id, waitAudience.revision, 'SEQUENCE_READY');
    const waitPending = await transitionCampaign(app, actor, waited.id, waitReady.revision, 'PENDING_REVIEW');
    const waitApproval = await requestApproval(app, actor, { kind: 'CONFIGURATION', subjectId: waited.id, versionRef: '1', digest: waited.id });
    await decideApproval(app, { tenantId, userId: reviewerId }, { id: waitApproval.id, decision: 'APPROVED', digest: waitApproval.digest });
    const waitApproved = await transitionCampaign(app, { tenantId, userId: reviewerId }, waited.id, waitPending.revision, 'APPROVED');
    await transitionCampaign(app, actor, waited.id, waitApproved.revision, 'SCHEDULED');
    const waitStarted = await startSimulation(app, actor, waited.id);
    expect(waitStarted.enrolled).toBe(1);
    await advanceCampaignRun(app, actor, waited.id);
    const waiting = await admin.campaignEnrollment.findFirstOrThrow({ where: { tenantId, campaignId: waited.id } });
    expect(waiting.status).toBe('WAITING');
    const past = new Date(Date.now() - 60_000);
    await admin.campaignSchedule.updateMany({ where: { tenantId, campaignId: waited.id }, data: { runAt: past } });
    await admin.campaignStepExecution.updateMany({ where: { tenantId, enrollmentId: waiting.id }, data: { scheduledFor: past } });
    await advanceCampaignRun(app, actor, waited.id);
    const resumed = await admin.campaignEnrollment.findFirstOrThrow({ where: { tenantId, campaignId: waited.id } });
    expect(resumed.currentStep).toBe(1);
    expect(await admin.campaignSchedule.count({ where: { tenantId, campaignId: waited.id, status: 'COMPLETED' } })).toBe(1);
    await admin.crmSuppression.create({ data: { tenantId, scope: 'contact', contactId: ready.contactId!, reason: 'withdrawn after enrollment', createdBy: userId } });
    await advanceCampaignRun(app, actor, waited.id);
    const stopped = await admin.campaignEnrollment.findFirstOrThrow({ where: { tenantId, campaignId: waited.id } });
    expect(stopped.status).toBe('STOPPED');
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    expect(ready.id).toBeTruthy();
  });

  it('refuses an audience above 500 active leads instead of truncating it', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Limit ${stamp}`, slug: `limit-${stamp}` } });
    const user = await admin.user.create({ data: { emailHmac: `limit-${stamp}`, emailCiphertext: Buffer.from('e'), displayName: 'Limit', status: 'ACTIVE' } });
    try {
      await admin.membership.create({ data: { tenantId: tenant.id, userId: user.id, status: 'ACTIVE' } });
      const account = await admin.crmAccount.create({ data: { tenantId: tenant.id, legalName: 'Limit Co', displayName: 'Limit Co', createdBy: user.id } });
      await admin.$executeRaw`INSERT INTO crm_leads (tenant_id, account_id, source_type, created_by) SELECT ${tenant.id}::uuid, ${account.id}::uuid, 'manual', ${user.id}::uuid FROM generate_series(1, 501)`;
      await expect(previewSegment(app, { tenantId: tenant.id, userId: user.id }, { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'NEW' }] }, false)).rejects.toMatchObject({ code: 'AUDIENCE_LIMIT' });
      expect(await admin.audienceMember.count({ where: { tenantId: tenant.id } })).toBe(0);
    } finally {
      await admin.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
      await admin.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  async function lead(name: string, consent: string, verification: string, suppressed: boolean, owned: boolean) {
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: name, displayName: name, industry: 'Logistics', country: 'US', createdBy: userId } });
    const contact = await admin.crmContact.create({ data: { tenantId, accountId: account.id, name, emailHmac: `${name}-${stamp}`, verificationStatus: verification, consentState: consent, createdBy: userId } });
    const row = await admin.crmLead.create({ data: { tenantId, accountId: account.id, contactId: contact.id, sourceType: 'manual', stage: 'QUALIFIED', score: 90, grade: 'A', createdBy: userId } });
    if (suppressed) await admin.crmSuppression.create({ data: { tenantId, scope: 'contact', contactId: contact.id, reason: 'requested', createdBy: userId } });
    if (owned) await admin.crmTakeover.create({ data: { tenantId, subjectType: 'lead', subjectId: row.id, reason: 'human', actorId: userId } });
    return row;
  }
});

function campaignDigest(value: string): string {
  return value;
}
