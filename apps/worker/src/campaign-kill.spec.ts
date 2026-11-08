import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { advanceCampaignRun, assignAudience, assignSequence, createCampaign, createSegment, createSequence, createPrismaClient, freezeSequence, materializeSegment, processCampaignJob, requestApproval, startSimulation, transitionCampaign } from '@salesos/database';
import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;
const workerUrl = process.env.DATABASE_URL_WORKER;

describe.skipIf(!adminUrl || !appUrl || !workerUrl)('campaign worker kill recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const app = createPrismaClient(appUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const stamp = randomUUID().slice(0, 8);
  let tenantId = '';
  let userId = '';
  let reviewerId = '';
  let campaignId = '';
  let runId = '';
  let leadId = '';

  afterAll(async () => {
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (reviewerId) await admin.user.delete({ where: { id: reviewerId } }).catch(() => undefined);
    await admin.$disconnect();
    await app.$disconnect();
    await worker.$disconnect();
  });

  it('recovers a killed simulation without a duplicate draft or a send', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Kill campaign ${stamp}`, slug: `kill-campaign-${stamp}` } });
    tenantId = tenant.id;
    const user = await admin.user.create({ data: { emailHmac: `kill-campaign-${stamp}`, emailCiphertext: Buffer.from('c'), displayName: 'Owner', status: 'ACTIVE' } });
    const reviewer = await admin.user.create({ data: { emailHmac: `kill-review-${stamp}`, emailCiphertext: Buffer.from('d'), displayName: 'Reviewer', status: 'ACTIVE' } });
    userId = user.id;
    reviewerId = reviewer.id;
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId: reviewerId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'campaigns.simulate' } });
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
    await admin.membershipRole.create({ data: { tenantId, userId: reviewerId, roleId: role.id } });
    await admin.crmContactPolicy.create({ data: { tenantId, timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440, holidays: [], minimumIntervalHours: 0, maxAttempts: 10 } });
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: 'Ready', displayName: 'Ready', createdBy: userId } });
    const contact = await admin.crmContact.create({ data: { tenantId, accountId: account.id, name: 'Ready', emailHmac: `ready-${stamp}`, verificationStatus: 'VERIFIED', consentState: 'KNOWN', createdBy: userId } });
    const lead = await admin.crmLead.create({ data: { tenantId, accountId: account.id, contactId: contact.id, sourceType: 'manual', stage: 'QUALIFIED', createdBy: userId } });
    leadId = lead.id;
    const actor = { tenantId, userId };
    const campaign = await createCampaign(app, actor, { name: 'Kill path', timeZone: 'UTC' });
    campaignId = campaign.id;
    const segment = await createSegment(app, actor, { name: 'Ready', kind: 'SNAPSHOT', filter: { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'QUALIFIED' }] } });
    await materializeSegment(app, actor, segment.id);
    const assigned = await assignAudience(app, actor, campaign.id, campaign.revision, segment.id);
    const sequence = await createSequence(app, actor, { name: 'Kill sequence', steps: [{ position: 1, stepType: 'EMAIL_DRAFT', config: { next: 2 } }, { position: 2, stepType: 'END_SEQUENCE', config: {} }] });
    await freezeSequence(app, actor, sequence.id);
    const sequenced = await assignSequence(app, actor, campaign.id, assigned.revision, sequence.id);
    const configuring = await transitionCampaign(app, actor, campaign.id, sequenced.revision, 'CONFIGURING');
    const audienceReady = await transitionCampaign(app, actor, campaign.id, configuring.revision, 'AUDIENCE_READY');
    const sequenceReady = await transitionCampaign(app, actor, campaign.id, audienceReady.revision, 'SEQUENCE_READY');
    const pending = await transitionCampaign(app, actor, campaign.id, sequenceReady.revision, 'PENDING_REVIEW');
    await requestApproval(app, actor, { kind: 'CONFIGURATION', subjectId: campaign.id, versionRef: '1', digest: 'kill' });
    const approved = await transitionCampaign(app, { tenantId, userId: reviewerId }, campaign.id, pending.revision, 'APPROVED');
    const scheduled = await transitionCampaign(app, actor, campaign.id, approved.revision, 'SCHEDULED');
    const started = await startSimulation(app, actor, campaign.id);
    runId = started.runId;
    expect(scheduled.state).toBe('SCHEDULED');
    await killChild('during-advance', 'campaign.simulation.run');
    expect(await drafts()).toBe(0);
    await killChild('during-draft', 'campaign.draft.personalize');
    expect(await drafts()).toBe(0);
    const prepared = await processCampaignJob(worker, { tenantId, runId, userId, kind: 'campaign.draft.personalize' });
    expect(prepared.sendAttempts).toBe(0);
    expect(await drafts()).toBe(1);
    await killChild('after-draft', 'campaign.draft.personalize');
    const repeated = await processCampaignJob(worker, { tenantId, runId, userId, kind: 'campaign.draft.personalize' });
    expect(repeated.sendAttempts).toBe(0);
    expect(await drafts()).toBe(1);
    await advanceCampaignRun(worker, actor, campaign.id);
    await advanceCampaignRun(worker, actor, campaign.id);
    expect(await drafts()).toBe(2);
    await admin.campaign.update({ where: { tenantId_id: { tenantId, id: campaignId } }, data: { state: 'CANCELLED' } });
    await processCampaignJob(worker, { tenantId, runId, userId, kind: 'campaign.simulation.run' });
    expect(await drafts()).toBe(2);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    const suspended = await processCampaignJob(worker, { tenantId, runId, userId, kind: 'campaign.simulation.run' });
    expect(suspended.stopped).toBe('TENANT_SUSPENDED');
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'campaigns.simulate' } });
    const revoked = await processCampaignJob(worker, { tenantId, runId, userId, kind: 'campaign.simulation.run' });
    expect(revoked.stopped).toBe('AUTH_REVOKED');
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
    expect(leadId).toBeTruthy();
  });

  function killChild(pause: string, kind: string): Promise<void> {
    return new Promise((done, fail) => {
      const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/campaign-crash.ts'), tenantId, runId, pause], {
        cwd: process.cwd(),
        env: { ...process.env, SALESOS_CAMPAIGN_USER: userId, SALESOS_CAMPAIGN_KIND: kind },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let seen = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(output || 'checkpoint timed out')); }, 20000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (!output.includes('checkpoint') || seen) return;
        seen = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
      });
      child.on('close', () => { if (seen) done(); else fail(new Error(output || 'exited before checkpoint')); });
      child.on('error', fail);
    });
  }

  function drafts() {
    return admin.campaignDraft.count({ where: { tenantId, campaignId } });
  }
});
