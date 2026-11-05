import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';
import { sendDraft } from './mailbox-work';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;

describe.skipIf(!adminUrl || !appUrl)('outbound send dispatch', () => {
  const admin = createPrismaClient(adminUrl as string);
  const app = createPrismaClient(appUrl as string);
  const stamp = randomUUID().slice(0, 8);
  let tenantId = '';
  let userId = '';
  let draftId = '';

  afterAll(async () => {
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('dispatches an approved test payload once and does not retry an uncertain result', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Send ${stamp}`, slug: `send-${stamp}` } });
    tenantId = tenant.id;
    const user = await admin.user.create({ data: { emailHmac: `hmac-${stamp}`, emailCiphertext: Buffer.from('cipher'), displayName: 'Sender', status: 'ACTIVE' } });
    userId = user.id;
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    for (const permission of ['mailbox.send', 'mailbox.send.execute']) {
      await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission } });
    }
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
    await admin.crmContactPolicy.create({ data: { tenantId, timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440, holidays: [], minimumIntervalHours: 0, maxAttempts: 100 } });
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: 'Buyer', displayName: 'Buyer', createdBy: userId } });
    const contact = await admin.crmContact.create({ data: { tenantId, accountId: account.id, name: 'Buyer', verificationStatus: 'VERIFIED', consentState: 'KNOWN', createdBy: userId } });
    const lead = await admin.crmLead.create({ data: { tenantId, accountId: account.id, contactId: contact.id, sourceType: 'manual', createdBy: userId } });
    const connection = await admin.mailboxConnection.create({
      data: { tenantId, provider: 'test', providerMailboxId: `box-${stamp}`, address: `from-${stamp}@example.com`, connectedBy: userId, scopes: [], status: 'CONFIGURED_UNVERIFIED', sendingEnabled: true, sendCapability: 'SEND_AUTHORIZED', live: false },
    });
    const thread = await admin.mailboxThread.create({ data: { tenantId, connectionId: connection.id, providerThreadId: `thread-${stamp}`, subject: 'Hello' } });
    await admin.mailboxThreadLink.create({ data: { tenantId, threadId: thread.id, subjectType: 'lead', subjectId: lead.id, createdBy: userId } });
    const draft = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Hello', body: 'Reviewed text', recipients: ['buyer@example.com'], status: 'APPROVED', createdBy: userId } });
    draftId = draft.id;
    const version = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId, version: 1, subject: 'Hello', body: 'Reviewed text', recipients: ['buyer@example.com'], bodySha256: 'digest', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: version.id, decision: 'APPROVED', payloadSha256: 'digest', decidedBy: userId, expiresAt: new Date(Date.now() + 60_000) } });
    await admin.emailSendPolicy.create({ data: { tenantId, enabled: true, killSwitch: false } });

    const actor = { tenantId, userId, key: Buffer.alloc(32, 7) };
    let calls = 0;
    const accepted = await sendDraft(app, actor, draftId, true, async () => {
      calls += 1;
      return { acceptance: 'ACCEPTED', providerMessageId: 'provider-1', threadId: 'thread-1', httpStatus: 200, correlationId: 'corr-1', retryable: false };
    });
    expect(accepted.state).toBe('PROVIDER_ACCEPTED');
    expect(accepted.sent).toBe(false);
    expect(calls).toBe(1);
    const duplicate = await sendDraft(app, actor, draftId, true, async () => {
      calls += 1;
      return { acceptance: 'ACCEPTED', providerMessageId: 'provider-2', threadId: null, httpStatus: 200, correlationId: 'corr-2', retryable: false };
    });
    expect(duplicate.state).toBe('FAILED_FINAL');
    expect(duplicate.reasons).toContain('DUPLICATE_SEND');
    expect(calls).toBe(1);

    const uncertainDraft = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Second', body: 'Reviewed text', recipients: ['buyer@example.com'], status: 'APPROVED', createdBy: userId } });
    const uncertainVersion = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: uncertainDraft.id, version: 1, subject: 'Second', body: 'Reviewed text', recipients: ['buyer@example.com'], bodySha256: 'digest-2', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: uncertainVersion.id, decision: 'APPROVED', payloadSha256: 'digest-2', expiresAt: new Date(Date.now() + 60_000) } });
    const unknown = await sendDraft(app, actor, uncertainDraft.id, true, async () => {
      throw new Error('socket');
    });
    expect(unknown.state).toBe('DELIVERY_UNKNOWN');
    expect(unknown.sent).toBe(false);
    const retry = await sendDraft(app, actor, uncertainDraft.id, true, async () => {
      calls += 1;
      return { acceptance: 'ACCEPTED', providerMessageId: 'should-not', threadId: null, httpStatus: 200, correlationId: 'no', retryable: false };
    });
    expect(retry.reasons).toContain('DUPLICATE_SEND');
    expect(calls).toBe(1);

    const crowded = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Many', body: 'Reviewed text', recipients: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com'], status: 'APPROVED', createdBy: userId } });
    const crowdedVersion = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: crowded.id, version: 1, subject: 'Many', body: 'Reviewed text', recipients: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com'], bodySha256: 'digest-many', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: crowdedVersion.id, decision: 'APPROVED', payloadSha256: 'digest-many', expiresAt: new Date(Date.now() + 60_000) } });
    const limited = await sendDraft(app, actor, crowded.id, true, async () => { calls += 1; return { acceptance: 'ACCEPTED', providerMessageId: 'no', threadId: null, httpStatus: 200, correlationId: 'no', retryable: false }; });
    expect(limited.reasons).toContain('RECIPIENT_LIMIT');
    expect(calls).toBe(1);

    const held = await admin.emailSendReservation.count({ where: { tenantId, state: { in: ['RESERVED', 'ACCEPTED', 'UNCERTAIN'] } } });
    await admin.emailSendPolicy.update({ where: { tenantId }, data: { dailyCap: held, tenantDailyCap: held } });
    const dailyDraft = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Daily', body: 'Reviewed text', recipients: ['daily@example.com'], status: 'APPROVED', createdBy: userId } });
    const dailyVersion = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: dailyDraft.id, version: 1, subject: 'Daily', body: 'Reviewed text', recipients: ['daily@example.com'], bodySha256: 'digest-daily', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: dailyVersion.id, decision: 'APPROVED', payloadSha256: 'digest-daily', expiresAt: new Date(Date.now() + 60_000) } });
    const daily = await sendDraft(app, actor, dailyDraft.id, true, async () => { calls += 1; return { acceptance: 'ACCEPTED', providerMessageId: 'no', threadId: null, httpStatus: 200, correlationId: 'no', retryable: false }; });
    expect(daily.reasons).toContain('RATE_LIMIT');
    expect(calls).toBe(1);
    await admin.emailSendPolicy.update({ where: { tenantId }, data: { dailyCap: 100, tenantDailyCap: 100, hourlyCap: 20, userHourlyCap: 10 } });

    const fenceDraft = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Fence', body: 'Reviewed text', recipients: ['fence@example.com'], status: 'APPROVED', createdBy: userId } });
    const fenceVersion = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: fenceDraft.id, version: 1, subject: 'Fence', body: 'Reviewed text', recipients: ['fence@example.com'], bodySha256: 'digest-fence', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: fenceVersion.id, decision: 'APPROVED', payloadSha256: 'digest-fence', expiresAt: new Date(Date.now() + 60_000) } });
    const revoked = await sendDraft(app, actor, fenceDraft.id, true, async () => {
      calls += 1;
      return { acceptance: 'ACCEPTED', providerMessageId: 'no', threadId: null, httpStatus: 200, correlationId: 'no', retryable: false };
    }, async () => {
      await admin.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: connection.id } }, data: { status: 'DISCONNECTED', revocationVersion: { increment: 1 }, sendingEnabled: false } });
    });
    expect(revoked.reasons).toContain('REVOKED_BEFORE_DISPATCH');
    expect(revoked.sent).toBe(false);
    expect(calls).toBe(1);

    await admin.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: connection.id } }, data: { status: 'CONFIGURED_UNVERIFIED', sendingEnabled: true, sendCapability: 'SEND_AUTHORIZED' } });
    const raceDraft = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: 'Race', body: 'Reviewed text', recipients: ['race@example.com'], status: 'APPROVED', createdBy: userId } });
    const raceVersion = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: raceDraft.id, version: 1, subject: 'Race', body: 'Reviewed text', recipients: ['race@example.com'], bodySha256: 'digest-race', createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: raceVersion.id, decision: 'APPROVED', payloadSha256: 'digest-race', expiresAt: new Date(Date.now() + 60_000) } });
    const raced = await Promise.all([
      sendDraft(app, actor, raceDraft.id, true, async () => { calls += 1; return { acceptance: 'ACCEPTED', providerMessageId: 'race-1', threadId: null, httpStatus: 200, correlationId: 'race', retryable: false }; }),
      sendDraft(app, actor, raceDraft.id, true, async () => { calls += 1; return { acceptance: 'ACCEPTED', providerMessageId: 'race-2', threadId: null, httpStatus: 200, correlationId: 'race-2', retryable: false }; }),
    ]);
    expect(raced.filter((item) => item.state === 'PROVIDER_ACCEPTED')).toHaveLength(1);
    expect(raced.some((item) => item.reasons.includes('DUPLICATE_SEND'))).toBe(true);
    expect(calls).toBe(2);
    await admin.mailboxSendAttempt.updateMany({ where: { tenantId, draftVersionId: raceVersion.id, state: 'PROVIDER_ACCEPTED' }, data: { idempotencyKey: `other-${stamp}` } });
    const otherKey = await sendDraft(app, actor, raceDraft.id, true, async () => { calls += 1; return { acceptance: 'ACCEPTED', providerMessageId: 'race-3', threadId: null, httpStatus: 200, correlationId: 'race-3', retryable: false }; });
    expect(otherKey.reasons).toContain('DUPLICATE_SEND');
    expect(calls).toBe(2);

    const acceptedPayload = { acceptance: 'ACCEPTED' as const, providerMessageId: 'provider-next', threadId: null, httpStatus: 200, correlationId: 'next', retryable: false };
    async function draftFor(label: string, recipients: string[], extra?: { cc?: string[]; bcc?: string[] }) {
      const row = await admin.mailboxDraft.create({ data: { tenantId, connectionId: connection.id, threadId: thread.id, subject: label, body: 'Reviewed text', recipients, status: 'APPROVED', createdBy: userId } });
      const saved = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: row.id, version: 1, subject: label, body: 'Reviewed text', recipients, cc: extra?.cc ?? [], bcc: extra?.bcc ?? [], bodySha256: `digest-${label}`, createdBy: userId } });
      await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: saved.id, decision: 'APPROVED', payloadSha256: `digest-${label}`, expiresAt: new Date(Date.now() + 60_000) } });
      return { id: row.id, versionId: saved.id };
    }
    async function fence(label: string, reason: string, mutate: () => Promise<void>, restore: () => Promise<void>) {
      const row = await draftFor(label, [`${label}@example.com`]);
      const before = calls;
      const result = await sendDraft(app, actor, row.id, true, async () => {
        calls += 1;
        return acceptedPayload;
      }, mutate);
      expect(result.sent).toBe(false);
      expect(result.reasons).toContain(reason);
      expect(calls).toBe(before);
      await restore();
    }

    const collapsed = await draftFor('collapsed', ['dup@example.com'], { cc: ['DUP@example.com'], bcc: ['second@example.com'] });
    const collapsedSend = await sendDraft(app, actor, collapsed.id, true, async () => { calls += 1; return acceptedPayload; });
    expect(collapsedSend.state).toBe('PROVIDER_ACCEPTED');
    expect(calls).toBe(3);
    const invalid = await draftFor('invalid', ['not-an-email']);
    const blocked = await sendDraft(app, actor, invalid.id, true, async () => { calls += 1; return acceptedPayload; });
    expect(blocked.reasons).toContain('CONTENT_BLOCKED');
    expect(calls).toBe(3);

    await fence('killed', 'REVOKED_BEFORE_DISPATCH', async () => {
      await admin.emailSendPolicy.update({ where: { tenantId }, data: { killSwitch: true } });
    }, async () => {
      await admin.emailSendPolicy.update({ where: { tenantId }, data: { killSwitch: false } });
    });
    await fence('suppressed', 'SUPPRESSED', async () => {
      await admin.crmSuppression.create({ data: { tenantId, scope: 'contact', accountId: account.id, contactId: contact.id, reason: 'opt out', createdBy: userId } });
    }, async () => {
      await admin.crmSuppression.updateMany({ where: { tenantId, contactId: contact.id }, data: { active: false } });
    });
    await fence('takeover', 'HUMAN_TAKEOVER', async () => {
      await admin.crmTakeover.create({ data: { tenantId, subjectType: 'lead', subjectId: lead.id, reason: 'human', actorId: userId } });
    }, async () => {
      await admin.crmTakeover.updateMany({ where: { tenantId, subjectId: lead.id }, data: { active: false } });
    });
    await fence('permission', 'SENDER_NOT_ALLOWED', async () => {
      await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'mailbox.send.execute' } });
    }, async () => {
      await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.send.execute' } });
    });
    const approvalRow = await draftFor('approval', ['approval@example.com']);
    const approvalResult = await sendDraft(app, actor, approvalRow.id, true, async () => { calls += 1; return acceptedPayload; }, async () => {
      await admin.mailboxApproval.updateMany({ where: { tenantId, draftVersionId: approvalRow.versionId }, data: { decision: 'REVOKED' } });
    });
    expect(approvalResult.reasons).toContain('APPROVAL_MISMATCH');
    expect(calls).toBe(3);
    await fence('scope', 'REVOKED_BEFORE_DISPATCH', async () => {
      await admin.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: connection.id } }, data: { provider: 'google', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] } });
    }, async () => {
      await admin.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: connection.id } }, data: { provider: 'test', scopes: [], sendingEnabled: true, sendCapability: 'SEND_AUTHORIZED' } });
    });
    await fence('suspended', 'ORGANIZATION_INACTIVE', async () => {
      await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    }, async () => {
      await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    });

    const holding = await admin.emailSendReservation.count({ where: { tenantId, state: { in: ['RESERVED', 'ACCEPTED', 'UNCERTAIN'] } } });
    await admin.emailSendPolicy.update({ where: { tenantId }, data: { hourlyCap: holding + 1, userHourlyCap: holding + 1, dailyCap: holding + 1, tenantDailyCap: holding + 1 } });
    const left = await draftFor('left', ['left@example.com']);
    const right = await draftFor('right', ['right@example.com']);
    const racedCaps = await Promise.all([
      sendDraft(app, actor, left.id, true, async () => { calls += 1; return acceptedPayload; }),
      sendDraft(app, actor, right.id, true, async () => { calls += 1; return acceptedPayload; }),
    ]);
    expect(racedCaps.filter((item) => item.state === 'PROVIDER_ACCEPTED')).toHaveLength(1);
    expect(calls).toBe(4);

    const heldNow = await admin.emailSendReservation.count({ where: { tenantId, state: { in: ['RESERVED', 'ACCEPTED', 'UNCERTAIN'] } } });
    await admin.emailSendPolicy.update({ where: { tenantId }, data: { hourlyCap: heldNow + 1, userHourlyCap: heldNow + 1, dailyCap: heldNow + 1, tenantDailyCap: heldNow + 1 } });
    const rejected = await draftFor('rejected', ['rejected@example.com']);
    const rejection = await sendDraft(app, actor, rejected.id, true, async () => { calls += 1; return { acceptance: 'REJECTED', providerMessageId: null, threadId: null, httpStatus: 400, correlationId: 'rejected', retryable: false }; });
    expect(rejection.state).toBe('FAILED_FINAL');
    const released = await admin.emailSendReservation.findFirst({ where: { tenantId, draftVersionId: rejected.versionId } });
    expect(released?.state).toBe('RELEASED');
    const afterRelease = await draftFor('after-release', ['after-release@example.com']);
    const releasedNext = await sendDraft(app, actor, afterRelease.id, true, async () => { calls += 1; return acceptedPayload; });
    expect(releasedNext.state).toBe('PROVIDER_ACCEPTED');

    await admin.crmContactPolicy.update({ where: { tenantId }, data: { minimumIntervalHours: 24 } });
    const repeat = await draftFor('repeat', ['after-release@example.com']);
    const frequent = await sendDraft(app, actor, repeat.id, true, async () => { calls += 1; return acceptedPayload; });
    expect(frequent.reasons).toContain('FREQUENCY_LIMIT');
  });
});
