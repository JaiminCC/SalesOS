import { createHash, randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  classifyIntent,
  draftDigest,
  evaluateEligibility,
  evaluateQuietHours,
  evaluateSendGate,
  headerSafe,
  normalizeOutboundRecipients,
  sendScopeGranted,
  plainText,
  resolveThreadKey,
  sanitizeEmailHtml,
  attachmentAllowed,
  type SendGateInput,
} from '@salesos/shared';
import { readProviderPage, refreshOAuthToken, type NormalizedMail, type ProviderCursor } from '@salesos/integrations';
import { decryptField, encryptField } from './crypto';
import { memberIsAssignable } from './crm-work';
import { classifyProviderEvidence, credentialsConfigured, observeMailboxSync } from './mailbox-operations';
import { withTenant } from './with-tenant';

type Actor = { tenantId: string; userId: string; key: Buffer; pause?: 'after-row' | 'before-write' | 'after-claim' | 'after-response' | 'during-commit' | 'after-commit' | 'during-recovery'; runId?: string };
type StopReason = 'cancelled' | 'suspended' | 'forbidden' | 'revoked';
const LEASE_SECONDS = 30;

export type InboundMessage = {
  providerMessageId: string;
  providerThreadId?: string | null;
  internetMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  direction?: 'INBOUND' | 'OUTBOUND';
  folder?: string;
  sender: string;
  recipients?: string[];
  subject?: string;
  text?: string;
  html?: string;
  receivedAt?: string;
  provenance: string;
  attachments?: Array<{ fileName: string; contentType: string; sizeBytes: number }>;
};

export async function queueMailboxImport(prisma: PrismaClient, actor: Actor, connectionId: string, messages: InboundMessage[]): Promise<{ queued: number; held?: boolean; stopped?: StopReason }> {
  const opened = await withTenant(prisma, actor.tenantId, async (tx) => {
    const gate = await mailboxGate(tx, actor, connectionId, 'mailbox.connect');
    if (gate !== 'ok') return { stopped: gate };
    const current = await tx.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } } });
    const parsed = parseCursor(current?.cursor);
    parsed.pending.push(...messages.slice(0, 100));
    await tx.mailboxSyncCursor.upsert({
      where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } },
      create: { tenantId: actor.tenantId, connectionId, cursor: JSON.stringify(parsed) },
      update: { cursor: JSON.stringify(parsed) },
    });
    return { queued: parsed.pending.length };
  });
  if ('stopped' in opened && opened.stopped) return { queued: 0, stopped: opened.stopped };
  const queued = 'queued' in opened ? opened.queued : 0;
  const synced = await syncMailbox(prisma, actor, connectionId);
  return { queued, held: synced.held, stopped: synced.stopped };
}

export async function syncMailbox(prisma: PrismaClient, actor: Actor, connectionId: string): Promise<{ imported: number; held?: boolean; stopped?: StopReason; status?: string }> {
  const claim = await withTenant(prisma, actor.tenantId, async (tx) => {
    const gate = await mailboxGate(tx, actor, connectionId, 'mailbox.connect');
    if (gate !== 'ok') return { stopped: gate };
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!connection) return { stopped: 'forbidden' as const };
    const lease = await claimLease(tx, actor.tenantId, 'mailbox.sync', connectionId);
    if (lease.status === 'held') return { held: true as const };
    if (lease.status === 'closed') return { status: 'CLOSED' as const };
    return { lease };
  });
  if ('stopped' in claim && claim.stopped) return { imported: 0, stopped: claim.stopped };
  if ('held' in claim) return { imported: 0, held: true };
  if (!('lease' in claim)) return { imported: 0, status: claim.status };
  let imported = 0;
  for (;;) {
    const step = await withTenant(prisma, actor.tenantId, async (tx) => {
      await renewLease(tx, actor.tenantId, 'mailbox.sync', connectionId);
      const gate = await mailboxGate(tx, actor, connectionId, 'mailbox.connect');
      if (gate !== 'ok') return { stopped: gate };
      const cursor = await tx.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } } });
      const parsed = parseCursor(cursor?.cursor);
      const next = parsed.pending.shift();
      if (!next) {
        const current = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
        await tx.mailboxSyncCursor.update({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } }, data: { cursor: JSON.stringify(parsed) } });
        await finishLease(tx, actor.tenantId, 'mailbox.sync', connectionId, 'COMPLETED', claim.lease);
        await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } }, data: { lastSyncAt: new Date(), lastError: current?.provider === 'capture' ? null : 'LIVE_PROVIDER_NOT_CONFIGURED', status: current?.provider === 'capture' ? 'CAPTURE' : 'NOT_CONFIGURED' } });
        await tx.mailboxSyncEvent.create({ data: { tenantId: actor.tenantId, connectionId, status: 'COMPLETED', detail: `imported ${imported}` } });
        return { done: true as const };
      }
      await tx.mailboxSyncCursor.update({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } }, data: { cursor: JSON.stringify(parsed) } });
      const stored = await ingestOne(tx, actor.tenantId, connectionId, next);
      return { stored, pause: actor.pause === 'after-row' && imported === 0 };
    });
    if ('stopped' in step && step.stopped) {
      await withTenant(prisma, actor.tenantId, (tx) => releaseLease(tx, actor.tenantId, 'mailbox.sync', connectionId, claim.lease));
      return { imported, stopped: step.stopped };
    }
    if ('done' in step) return { imported, status: 'COMPLETED' };
    if (step.stored) imported += 1;
    if (step.pause) {
      writeSync(1, 'checkpoint\n');
      await new Promise(() => undefined);
    }
  }
}

export async function saveDraft(prisma: PrismaClient, actor: Actor, input: { id?: string; connectionId: string; threadId?: string; subject: string; body: string; recipients: string[]; cc?: string[]; bcc?: string[]; aiGenerated?: boolean; runId?: string; productVersionId?: string | null; citations?: unknown }): Promise<{ id: string; version: number; status: string; digest: string }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    if (!(await canAccess(tx, actor, input.connectionId, 'DRAFT'))) throw new Error('FORBIDDEN');
    const digest = draftDigest({ sender: '', recipients: input.recipients, cc: input.cc ?? [], bcc: input.bcc ?? [], subject: input.subject, body: input.body, attachments: [] });
    const existing = input.id ? await tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.id } } }) : null;
    const draft = existing ?? await tx.mailboxDraft.create({
      data: {
        tenantId: actor.tenantId,
        connectionId: input.connectionId,
        threadId: input.threadId,
        subject: input.subject,
        body: input.body,
        recipients: input.recipients,
        aiGenerated: input.aiGenerated === true,
        createdBy: actor.userId,
      },
    });
    const version = existing ? existing.currentVersion + 1 : 1;
    await tx.mailboxDraftVersion.create({
      data: {
        tenantId: actor.tenantId,
        draftId: draft.id,
        version,
        subject: input.subject,
        body: input.body,
        recipients: input.recipients,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        bodySha256: digest,
        aiGenerated: input.aiGenerated === true,
        runId: input.runId,
        productVersionId: input.productVersionId,
        citations: (input.citations ?? []) as Prisma.InputJsonValue,
        createdBy: actor.userId,
      },
    });
    await tx.mailboxDraft.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: draft.id } },
      data: { subject: input.subject, body: input.body, recipients: input.recipients, currentVersion: version, status: 'DRAFT', threadId: input.threadId ?? draft.threadId },
    });
    if (existing) {
      const versions = await tx.mailboxDraftVersion.findMany({ where: { tenantId: actor.tenantId, draftId: draft.id }, select: { id: true } });
      await tx.mailboxApproval.updateMany({ where: { tenantId: actor.tenantId, draftVersionId: { in: versions.map((item) => item.id) }, decision: 'APPROVED' }, data: { decision: 'REVOKED' } });
    }
    return { id: draft.id, version, status: 'DRAFT', digest };
  });
}

export async function submitDraft(prisma: PrismaClient, actor: Actor, draftId: string): Promise<{ status: string; digest: string }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const draft = await tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: draftId } } });
    if (!draft) throw new Error('NOT_FOUND');
    if (!(await canAccess(tx, actor, draft.connectionId, 'DRAFT'))) throw new Error('FORBIDDEN');
    const version = await tx.mailboxDraftVersion.findFirst({ where: { tenantId: actor.tenantId, draftId, version: draft.currentVersion } });
    if (!version) throw new Error('NOT_FOUND');
    const existing = await tx.mailboxApproval.findFirst({ where: { tenantId: actor.tenantId, draftVersionId: version.id, decision: { in: ['PENDING_REVIEW', 'APPROVED'] } } });
    if (!existing) {
      await tx.mailboxApproval.create({
        data: { tenantId: actor.tenantId, draftVersionId: version.id, decision: 'PENDING_REVIEW', payloadSha256: version.bodySha256, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
    }
    await tx.mailboxDraft.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: draftId } }, data: { status: 'PENDING_REVIEW' } });
    return { status: 'PENDING_REVIEW', digest: version.bodySha256 };
  });
}

export async function reviewDraft(prisma: PrismaClient, actor: Actor, draftId: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'): Promise<{ decision: string; digest: string }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const draft = await tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: draftId } } });
    if (!draft) throw new Error('NOT_FOUND');
    if (!(await canAccess(tx, actor, draft.connectionId, 'READ'))) throw new Error('FORBIDDEN');
    if (!(await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.review'))) throw new Error('FORBIDDEN');
    if (draft.createdBy === actor.userId) throw new Error('SEPARATION_OF_DUTIES');
    const version = await tx.mailboxDraftVersion.findFirst({ where: { tenantId: actor.tenantId, draftId, version: draft.currentVersion } });
    if (!version) throw new Error('NOT_FOUND');
    const open = await tx.mailboxApproval.findFirst({ where: { tenantId: actor.tenantId, draftVersionId: version.id, decision: 'PENDING_REVIEW' } });
    if (!open && decision === 'APPROVED') throw new Error('NOT_SUBMITTED');
    const row = open ?? await tx.mailboxApproval.create({
      data: { tenantId: actor.tenantId, draftVersionId: version.id, decision: 'PENDING_REVIEW', payloadSha256: version.bodySha256, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    if (row.decision !== 'PENDING_REVIEW') throw new Error('ALREADY_DECIDED');
    await tx.mailboxApproval.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { decision, decidedBy: actor.userId } });
    await tx.mailboxDraft.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: draftId } }, data: { status: decision } });
    return { decision, digest: version.bodySha256 };
  });
}

export type OutboundDelivery = {
  acceptance: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  providerMessageId: string | null;
  threadId: string | null;
  httpStatus: number | null;
  correlationId: string;
  retryable: boolean;
};

export async function sendDraft(prisma: PrismaClient, actor: Actor, draftId: string, liveSendEnabled: boolean, deliver?: (input: { provider: string; token: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; threadRef: string }) => Promise<OutboundDelivery>, beforeDispatch?: () => Promise<void>): Promise<{ state: string; sent: false; reasons: string[] }> {
  const prepared = await withTenant(prisma, actor.tenantId, async (tx) => {
    const draft = await tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: draftId } } });
    if (!draft) throw new Error('NOT_FOUND');
    const version = await tx.mailboxDraftVersion.findFirst({ where: { tenantId: actor.tenantId, draftId, version: draft.currentVersion } });
    const approval = version ? await tx.mailboxApproval.findFirst({ where: { tenantId: actor.tenantId, draftVersionId: version.id, decision: 'APPROVED' }, orderBy: { createdAt: 'desc' } }) : null;
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: draft.connectionId } } });
    const policy = await tx.emailSendPolicy.findUnique({ where: { tenantId: actor.tenantId } });
    const facts = await sendFacts(tx, actor, draft.threadId, draft.connectionId);
    const prior = version ? await tx.mailboxSendAttempt.findFirst({ where: { tenantId: actor.tenantId, draftVersionId: version.id, state: { in: ['CAPTURED', 'IN_FLIGHT', 'PROVIDER_ACCEPTED', 'DELIVERY_UNKNOWN', 'ACCEPTED_BY_PROVIDER', 'SENT_ITEM_CONFIRMED'] } } }) : null;
    const normalized = normalizeOutboundRecipients([
      Array.isArray(version?.recipients) ? version.recipients.map(String) : [],
      Array.isArray(version?.cc) ? version.cc.map(String) : [],
      Array.isArray(version?.bcc) ? version.bcc.map(String) : [],
    ]);
    const recipients = normalized.recipients;
    const injected = !headerSafe(version?.subject ?? '') || !headerSafe(connection?.address ?? '') || normalized.invalid;
    const scopes = Array.isArray(connection?.scopes) ? connection.scopes.map(String) : [];
    const contactPolicy = await tx.crmContactPolicy.findUnique({ where: { tenantId: actor.tenantId } });
    const contactKey = recipients[0] ?? '';
    const intervalHours = contactPolicy?.minimumIntervalHours ?? 24;
    const recentContact = contactKey && intervalHours > 0
      ? await tx.emailSendReservation.count({ where: { tenantId: actor.tenantId, contactKey, state: { in: HOLDING_QUOTA }, createdAt: { gt: new Date(Date.now() - intervalHours * 60 * 60 * 1000) } } })
      : 0;
    const todayCount = contactKey ? await tx.emailSendReservation.count({ where: { tenantId: actor.tenantId, contactKey, dayStart: utcWindows().dayStart, state: { in: HOLDING_QUOTA } } }) : 0;
    const gate = evaluateSendGate({
      ...facts,
      connectionReadable: Boolean(connection) && connection?.status !== 'DISCONNECTED',
      frequencyBlocked: facts.frequencyBlocked || recentContact > 0 || ((contactPolicy?.maxAttempts ?? 3) > 0 && todayCount >= (contactPolicy?.maxAttempts ?? 3)),
      contentBlocked: facts.contentBlocked || injected,
      approvalMatches: Boolean(approval && version && approval.payloadSha256 === version.bodySha256),
      approvalExpired: Boolean(approval && approval.expiresAt.getTime() < Date.now()),
      duplicateAccepted: Boolean(prior) || Boolean(version && await tx.emailSendReservation.findUnique({ where: { tenantId_draftVersionId: { tenantId: actor.tenantId, draftVersionId: version.id } } })),
      rateLimited: await quotaLimited(tx, actor.tenantId, draft.connectionId, actor.userId, policy),
      recipientLimitExceeded: Boolean(policy && recipients.length > policy.maxRecipients),
      liveSendEnabled,
      tenantSendingEnabled: policy?.enabled === true && policy.killSwitch !== true,
      mailboxSendingEnabled: connection?.sendingEnabled === true && connection.sendCapability === 'SEND_AUTHORIZED',
      killSwitch: policy?.killSwitch === true,
      providerReady: connection?.provider === 'google' || connection?.provider === 'microsoft' || connection?.provider === 'test',
      humanAction: true,
      captureMailbox: connection?.provider === 'capture' || connection?.provider === 'manual',
      sendScope: connection ? sendScopeGranted(connection.provider, scopes) || connection.provider === 'test' : false,
      senderAllowed: await canAccess(tx, actor, draft.connectionId, 'SEND') && await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.send') && await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.send.execute'),
    });
    return { draft, version, approval, connection, gate, recipients, contactKey };
  });
  if (!prepared.version || !prepared.connection) return { state: 'FAILED_FINAL', sent: false, reasons: ['NOT_FOUND'] };
  if (prepared.gate.decision === 'BLOCK') {
    await recordAttempt(prisma, actor, prepared, 'FAILED_FINAL', prepared.gate.reasons.join(','));
    return { state: 'FAILED_FINAL', sent: false, reasons: prepared.gate.reasons };
  }
  if (prepared.gate.decision === 'CAPTURE') {
    const attempt = await recordAttempt(prisma, actor, prepared, 'CAPTURED', 'CAPTURE_MODE');
    return { state: attempt.state, sent: false, reasons: ['CAPTURE_MODE'] };
  }
  if (!deliver) {
    await recordAttempt(prisma, actor, prepared, 'READY', 'SEND_NOT_DISPATCHED');
    return { state: 'READY', sent: false, reasons: ['SEND_NOT_DISPATCHED'] };
  }
  const claimed = await claimDispatch(prisma, actor, prepared);
  if (!claimed.created) return { state: claimed.state, sent: false, reasons: claimed.reasons };
  if (beforeDispatch) await beforeDispatch();
  const fence = await assertDispatchFence(prisma, actor, prepared);
  if (!fence.ok) {
    await settleAttempt(prisma, actor, prepared, 'FAILED_FINAL', 'RELEASED', { acceptance: 'REJECTED', providerMessageId: null, threadId: null, httpStatus: null, correlationId: 'revoked-before-dispatch', retryable: false }, fence.reason);
    return { state: 'FAILED_FINAL', sent: false, reasons: [fence.reason] };
  }
  let outcome: OutboundDelivery;
  try {
    const token = prepared.connection.accessTokenCiphertext ? decryptField(Buffer.from(prepared.connection.accessTokenCiphertext), actor.key) : '';
    outcome = await deliver({
      provider: prepared.connection.provider,
      token,
      from: prepared.connection.address,
      to: prepared.recipients,
      cc: Array.isArray(prepared.version.cc) ? prepared.version.cc.map(String) : [],
      bcc: Array.isArray(prepared.version.bcc) ? prepared.version.bcc.map(String) : [],
      subject: prepared.version.subject,
      body: prepared.version.body,
      threadRef: prepared.draft.threadId ?? '',
    });
  } catch {
    outcome = { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: null, correlationId: 'interrupted', retryable: false };
  }
  const state = outcome.acceptance === 'ACCEPTED' ? 'PROVIDER_ACCEPTED' : outcome.acceptance === 'REJECTED' ? 'FAILED_FINAL' : 'DELIVERY_UNKNOWN';
  const reservation = outcome.acceptance === 'ACCEPTED' ? 'ACCEPTED' : outcome.acceptance === 'REJECTED' ? 'RELEASED' : 'UNCERTAIN';
  await settleAttempt(prisma, actor, prepared, state, reservation, outcome, outcome.acceptance);
  return { state, sent: false, reasons: [outcome.acceptance] };
}

export async function reconcileSend(prisma: PrismaClient, actor: Actor, attemptId: string, lookup?: (input: { provider: string; token: string; providerMessageId: string }) => Promise<'SENT_ITEM_CONFIRMED' | 'DELIVERY_UNKNOWN'>): Promise<{ state: string; sent: false }> {
  const loaded = await withTenant(prisma, actor.tenantId, async (tx) => {
    const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: attemptId } } });
    if (!attempt) throw new Error('NOT_FOUND');
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: attempt.connectionId } } });
    return { attempt, connection };
  });
  let kind = 'RECONCILE_UNRESOLVED';
  if (lookup && loaded.connection?.status !== 'DISCONNECTED' && loaded.attempt.providerMessageId && loaded.connection?.accessTokenCiphertext && loaded.attempt.state !== 'FAILED_FINAL') {
    const token = decryptField(Buffer.from(loaded.connection.accessTokenCiphertext), actor.key);
    const found = await lookup({ provider: loaded.attempt.provider, token, providerMessageId: loaded.attempt.providerMessageId }).catch(() => 'DELIVERY_UNKNOWN' as const);
    kind = found === 'SENT_ITEM_CONFIRMED' ? 'SENT_ITEM_CONFIRMED' : 'RECONCILE_UNRESOLVED';
  }
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await tx.mailboxDeliveryEvent.create({ data: { tenantId: actor.tenantId, attemptId, kind, detail: { retry: false, delivered: false, recipientDelivery: false } } });
    if (kind === 'SENT_ITEM_CONFIRMED') {
      await tx.mailboxSendAttempt.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: attemptId } }, data: { reconciliation: 'SENT_ITEM_CONFIRMED', sent: false } });
    }
    return { state: kind === 'SENT_ITEM_CONFIRMED' ? 'SENT_ITEM_CONFIRMED' : loaded.attempt.state, sent: false as const };
  });
}

export async function executeInboxTool(tx: Prisma.TransactionClient, tenantId: string, actor: { userId: string; runId: string; threadId: string; modelProvider: string | null; modelName: string | null }, tool: string, prior: Array<{ toolName: string; outputRedacted: Prisma.JsonValue }>): Promise<Record<string, unknown>> {
  const thread = actor.threadId ? await tx.mailboxThread.findUnique({ where: { tenantId_id: { tenantId, id: actor.threadId } } }) : null;
  if (!thread) return { found: false, externalSend: false };
  if (tool === 'inbox.thread.read' || tool === 'inbox.message.read') {
    const messages = await tx.mailboxMessage.findMany({ where: { tenantId, threadId: thread.id }, orderBy: { receivedAt: 'asc' }, take: 20 });
    return { untrusted: true, subject: thread.subject, messages: messages.map((item) => ({ sender: item.sender, text: item.textBody, receivedAt: item.receivedAt })) };
  }
  if (tool === 'inbox.intent.classify') {
    const latest = await tx.mailboxMessage.findFirst({ where: { tenantId, threadId: thread.id }, orderBy: { receivedAt: 'desc' } });
    const classified = classifyIntent(latest?.textBody ?? '');
    return { ...classified, authority: false };
  }
  if (tool === 'inbox.crm.context.read') {
    const links = await tx.mailboxThreadLink.findMany({ where: { tenantId, threadId: thread.id } });
    return { links: links.map((item) => ({ subjectType: item.subjectType, subjectId: item.subjectId })), createdLead: false, consentFromEmail: false };
  }
  if (tool === 'inbox.product.context.read') return { pinned: true, externalSend: false };
  if (tool === 'inbox.draft.create') {
    const proposed = prior.find((call) => call.toolName === 'inbox.reply.propose')?.outputRedacted as { draft?: string; summary?: string; intent?: string; questions?: string[]; objections?: string[]; citations?: string[]; confidence?: string; uncertainty?: string; followUp?: string; opportunity?: string } | null;
    const body = typeof proposed?.draft === 'string' ? proposed.draft : typeof proposed?.summary === 'string' ? proposed.summary : '';
    if (!body) return { created: false, reason: 'NO_PROPOSAL' };
    const existing = await tx.mailboxDraft.findFirst({ where: { tenantId, threadId: thread.id, aiGenerated: true } });
    if (existing) return { created: false, draftId: existing.id, reason: 'ALREADY_STORED' };
    const recipients = await tx.mailboxMessage.findFirst({ where: { tenantId, threadId: thread.id, direction: 'INBOUND' }, orderBy: { receivedAt: 'desc' } });
    const saved = await tx.mailboxDraft.create({
      data: { tenantId, connectionId: thread.connectionId, threadId: thread.id, subject: `Re: ${thread.subject}`, body, recipients: recipients ? [recipients.sender] : [], aiGenerated: true, createdBy: actor.userId, status: 'DRAFT' },
    });
    const digest = draftDigest({ sender: '', recipients: recipients ? [recipients.sender] : [], subject: saved.subject, body, attachments: [] });
    await tx.mailboxDraftVersion.create({
      data: { tenantId, draftId: saved.id, version: 1, subject: saved.subject, body, recipients: saved.recipients as Prisma.InputJsonValue, bodySha256: digest, aiGenerated: true, runId: actor.runId, createdBy: actor.userId },
    });
    const model = actor.modelProvider === 'fake' ? null : actor.modelProvider;
    await tx.mailboxAiAnalysis.create({
      data: {
        tenantId,
        threadId: thread.id,
        runId: actor.runId,
        summary: (proposed?.summary ?? body).slice(0, 500),
        intent: proposed?.intent ?? 'DRAFT',
        signals: { questions: proposed?.questions ?? [], objections: proposed?.objections ?? [], citations: proposed?.citations ?? [], confidence: proposed?.confidence ?? 'UNKNOWN', uncertainty: proposed?.uncertainty ?? '', followUp: proposed?.followUp ?? '', opportunity: proposed?.opportunity ?? '', externalSend: false },
        modelProvider: model,
        modelName: model ? actor.modelName : null,
      },
    });
    return { created: true, draftId: saved.id, externalSend: false, modelLabeled: Boolean(model) };
  }
  if (tool === 'inbox.eligibility.evaluate') {
    const facts = await sendFacts(tx, { tenantId, userId: actor.userId }, thread.id, thread.connectionId);
    return { ...facts, externalSend: false, unknownAuthorizesSending: false };
  }
  return { ignored: true, externalSend: false };
}

async function ingestOne(tx: Prisma.TransactionClient, tenantId: string, connectionId: string, message: InboundMessage): Promise<boolean> {
  const duplicate = await tx.mailboxMessage.findFirst({ where: { tenantId, connectionId, providerMessageId: message.providerMessageId } });
  if (duplicate) return false;
  const threads = await tx.mailboxThread.findMany({ where: { tenantId, connectionId } });
  const messages = await tx.mailboxMessage.findMany({ where: { tenantId, connectionId }, select: { internetMessageId: true, threadId: true } });
  const providerByThread = new Map(threads.map((row) => [row.id, row.providerThreadId]));
  const known = messages.flatMap((row) => row.internetMessageId ? [{ providerThreadId: providerByThread.get(row.threadId) ?? row.threadId, internetMessageId: row.internetMessageId }] : []);
  const resolved = resolveThreadKey(message, known);
  const receivedAt = message.receivedAt ? new Date(message.receivedAt) : new Date();
  const thread = await tx.mailboxThread.upsert({
    where: { tenantId_connectionId_providerThreadId: { tenantId, connectionId, providerThreadId: resolved.providerThreadId } },
    create: { tenantId, connectionId, providerThreadId: resolved.providerThreadId, subject: message.subject ?? '', participants: [message.sender], lastActivityAt: receivedAt, unreadCount: 1 },
    update: { lastActivityAt: receivedAt, unreadCount: { increment: 1 } },
  });
  const html = sanitizeEmailHtml(message.html ?? '');
  const created = await tx.mailboxMessage.create({
    data: {
      tenantId,
      connectionId,
      threadId: thread.id,
      providerMessageId: message.providerMessageId,
      internetMessageId: message.internetMessageId,
      inReplyTo: message.inReplyTo,
      referencesHeader: (message.references ?? []).join(' '),
      direction: message.direction ?? 'INBOUND',
      folder: message.folder ?? 'INBOX',
      sender: message.sender,
      recipients: message.recipients ?? [],
      subject: message.subject ?? '',
      textBody: plainText(message.text ?? message.html ?? ''),
      htmlSafe: html,
      receivedAt,
      provenance: message.provenance,
      sizeBytes: (message.text ?? message.html ?? '').length,
    },
  });
  for (const attachment of (message.attachments ?? []).slice(0, 20)) {
    const name = attachment.fileName.replace(/[/\\]/g, '').slice(0, 180) || 'attachment';
    await tx.mailboxAttachment.create({
      data: {
        tenantId,
        messageId: created.id,
        fileName: name,
        contentType: attachment.contentType.slice(0, 120) || 'application/octet-stream',
        sizeBytes: Math.max(0, Math.trunc(attachment.sizeBytes)),
        sha256: createHash('sha256').update(`${name}:${attachment.contentType}:${attachment.sizeBytes}`).digest('hex'),
        blocked: !attachmentAllowed(attachment.contentType, attachment.sizeBytes, name),
      },
    });
  }
  if (classifyIntent(message.text ?? message.html ?? '').intent === 'OPT_OUT') {
    await tx.mailboxThread.update({ where: { tenantId_id: { tenantId, id: thread.id } }, data: { classification: 'OPT_OUT' } });
  }
  return true;
}

const HOLDING_QUOTA = ['RESERVED', 'ACCEPTED', 'UNCERTAIN'];

function utcWindows(now = new Date()): { hourStart: Date; dayStart: Date } {
  return {
    hourStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())),
    dayStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  };
}

async function quotaLimited(tx: Prisma.TransactionClient, tenantId: string, connectionId: string, userId: string, policy: { hourlyCap: number; dailyCap: number; tenantDailyCap: number; userHourlyCap: number } | null): Promise<boolean> {
  if (!policy) return false;
  const windows = utcWindows();
  const state = { in: HOLDING_QUOTA };
  const [hour, day, tenantDay, userHour] = await Promise.all([
    tx.emailSendReservation.count({ where: { tenantId, connectionId, hourStart: windows.hourStart, state } }),
    tx.emailSendReservation.count({ where: { tenantId, connectionId, dayStart: windows.dayStart, state } }),
    tx.emailSendReservation.count({ where: { tenantId, dayStart: windows.dayStart, state } }),
    tx.emailSendReservation.count({ where: { tenantId, userId, hourStart: windows.hourStart, state } }),
  ]);
  return hour >= policy.hourlyCap || day >= policy.dailyCap || tenantDay >= policy.tenantDailyCap || userHour >= policy.userHourlyCap;
}

async function claimDispatch(prisma: PrismaClient, actor: Actor, prepared: { draft: { connectionId: string }; version: { id: string; bodySha256: string } | null; approval: { id: string } | null; connection: { provider: string; revocationVersion: number } | null; recipients: string[]; contactKey: string }): Promise<{ created: boolean; state: string; reasons: string[] }> {
  if (!prepared.version || !prepared.connection) return { created: false, state: 'FAILED_FINAL', reasons: ['NOT_FOUND'] };
  try {
    return await withTenant(prisma, actor.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT tenant_id FROM public.email_send_policies WHERE tenant_id = ${actor.tenantId}::uuid FOR UPDATE`;
      const reserved = await tx.emailSendReservation.findUnique({ where: { tenantId_draftVersionId: { tenantId: actor.tenantId, draftVersionId: prepared.version!.id } } });
      if (reserved) {
        const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: reserved.attemptId } } });
        return { created: false, state: attempt?.state ?? 'DELIVERY_UNKNOWN', reasons: ['DUPLICATE_SEND'] };
      }
      const policy = await tx.emailSendPolicy.findUnique({ where: { tenantId: actor.tenantId } });
      const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: prepared.draft.connectionId } } });
      if (!connection || connection.status === 'DISCONNECTED' || connection.revocationVersion !== prepared.connection!.revocationVersion) {
        return { created: false, state: 'FAILED_FINAL', reasons: ['REVOKED_BEFORE_DISPATCH'] };
      }
      if (await quotaLimited(tx, actor.tenantId, prepared.draft.connectionId, actor.userId, policy)) {
        return { created: false, state: 'FAILED_FINAL', reasons: ['RATE_LIMIT'] };
      }
      const windows = utcWindows();
      const key = createHash('sha256').update(`${prepared.version!.id}:dispatch`).digest('hex');
      const attempt = await tx.mailboxSendAttempt.create({
        data: {
          tenantId: actor.tenantId,
          draftVersionId: prepared.version!.id,
          approvalId: prepared.approval?.id,
          connectionId: prepared.draft.connectionId,
          state: 'IN_FLIGHT',
          provider: connection.provider,
          reconciliation: 'DISPATCH_STARTED',
          revocationVersion: connection.revocationVersion,
          policyRevision: policy?.policyRevision ?? 0,
          payloadDigest: prepared.version!.bodySha256,
          sent: false,
          idempotencyKey: key,
        },
      });
      await tx.emailSendReservation.create({
        data: {
          tenantId: actor.tenantId,
          attemptId: attempt.id,
          connectionId: prepared.draft.connectionId,
          userId: actor.userId,
          draftVersionId: prepared.version!.id,
          state: 'RESERVED',
          recipientCount: prepared.recipients.length,
          contactKey: prepared.contactKey,
          hourStart: windows.hourStart,
          dayStart: windows.dayStart,
        },
      });
      await tx.mailboxDeliveryEvent.create({ data: { tenantId: actor.tenantId, attemptId: attempt.id, kind: 'IN_FLIGHT', detail: { sent: false, delivered: false } } });
      return { created: true, state: 'IN_FLIGHT', reasons: ['DISPATCH_STARTED'] };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { created: false, state: 'DELIVERY_UNKNOWN', reasons: ['DUPLICATE_SEND'] };
    }
    throw error;
  }
}

async function assertDispatchFence(prisma: PrismaClient, actor: Actor, prepared: { draft: { connectionId: string; threadId: string | null }; version: { id: string; bodySha256: string } | null; connection: { revocationVersion: number; provider: string } | null }): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!prepared.version || !prepared.connection) return { ok: false, reason: 'NOT_FOUND' };
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const key = createHash('sha256').update(`${prepared.version!.id}:dispatch`).digest('hex');
    const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: key } } });
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: prepared.draft.connectionId } } });
    const policy = await tx.emailSendPolicy.findUnique({ where: { tenantId: actor.tenantId } });
    const approval = await tx.mailboxApproval.findFirst({ where: { tenantId: actor.tenantId, draftVersionId: prepared.version!.id, decision: 'APPROVED' } });
    const active = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`;
    const allowed = await canAccess(tx, actor, prepared.draft.connectionId, 'SEND') && await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.send') && await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.send.execute');
    const facts = await sendFacts(tx, actor, prepared.draft.threadId, prepared.draft.connectionId);
    const scopes = Array.isArray(connection?.scopes) ? connection.scopes.map(String) : [];
    if (!attempt || attempt.state !== 'IN_FLIGHT') return { ok: false, reason: 'DUPLICATE_SEND' };
    if (!connection || connection.status === 'DISCONNECTED' || connection.revocationVersion !== attempt.revocationVersion) return { ok: false, reason: 'REVOKED_BEFORE_DISPATCH' };
    if (!connection.sendingEnabled || connection.sendCapability !== 'SEND_AUTHORIZED') return { ok: false, reason: 'REVOKED_BEFORE_DISPATCH' };
    if (!policy?.enabled || policy.killSwitch || policy.policyRevision !== attempt.policyRevision) return { ok: false, reason: 'REVOKED_BEFORE_DISPATCH' };
    if (!(connection.provider === 'test' || sendScopeGranted(connection.provider, scopes))) return { ok: false, reason: 'REVOKED_BEFORE_DISPATCH' };
    if (active[0]?.ok !== true) return { ok: false, reason: 'ORGANIZATION_INACTIVE' };
    if (!allowed) return { ok: false, reason: 'SENDER_NOT_ALLOWED' };
    if (!approval || approval.payloadSha256 !== prepared.version!.bodySha256 || approval.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'APPROVAL_MISMATCH' };
    if (facts.suppressed) return { ok: false, reason: 'SUPPRESSED' };
    if (facts.humanTakeover) return { ok: false, reason: 'HUMAN_TAKEOVER' };
    if (!facts.consentKnown) return { ok: false, reason: 'CONSENT_UNKNOWN' };
    if (!facts.recipientVerified) return { ok: false, reason: 'RECIPIENT_UNVERIFIED' };
    if (facts.quietHours !== 'ALLOW') return { ok: false, reason: facts.quietHours === 'BLOCK' ? 'QUIET_HOURS' : 'QUIET_HOURS_UNKNOWN' };
    return { ok: true };
  });
}

async function settleAttempt(prisma: PrismaClient, actor: Actor, prepared: { draft: { connectionId: string }; version: { id: string } | null }, state: string, reservation: 'ACCEPTED' | 'RELEASED' | 'UNCERTAIN', outcome: OutboundDelivery, reason: string): Promise<void> {
  if (!prepared.version) return;
  const key = createHash('sha256').update(`${prepared.version.id}:dispatch`).digest('hex');
  await withTenant(prisma, actor.tenantId, async (tx) => {
    const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: key } } });
    if (!attempt || attempt.state !== 'IN_FLIGHT') return;
    await tx.mailboxSendAttempt.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: attempt.id } },
      data: {
        state,
        providerMessageId: outcome.providerMessageId,
        providerRequestId: outcome.correlationId,
        failureReason: state === 'FAILED_FINAL' ? reason : null,
        reconciliation: state === 'PROVIDER_ACCEPTED' ? 'PROVIDER_ACCEPTED_NOT_DELIVERED' : state,
        acceptanceState: outcome.acceptance,
        correlationId: outcome.correlationId,
        httpStatus: outcome.httpStatus,
        acceptedAt: state === 'PROVIDER_ACCEPTED' ? new Date() : null,
        sent: false,
      },
    });
    await tx.emailSendReservation.updateMany({ where: { tenantId: actor.tenantId, attemptId: attempt.id }, data: { state: reservation } });
    if (state === 'PROVIDER_ACCEPTED') {
      const dayStart = utcWindows().dayStart;
      await tx.emailSendQuota.upsert({
        where: { tenantId_connectionId_periodStart: { tenantId: actor.tenantId, connectionId: prepared.draft.connectionId, periodStart: dayStart } },
        create: { tenantId: actor.tenantId, connectionId: prepared.draft.connectionId, periodStart: dayStart, acceptedCount: 1 },
        update: { acceptedCount: { increment: 1 } },
      });
    }
    await tx.mailboxDeliveryEvent.create({ data: { tenantId: actor.tenantId, attemptId: attempt.id, kind: state, detail: { sent: false, reason, delivered: false, reservation } } });
  });
}

export async function sendQuotaSummary(prisma: PrismaClient, tenantId: string): Promise<{ hourlyCap: number; dailyCap: number; tenantDailyCap: number; userHourlyCap: number; maxRecipients: number; reserved: number; accepted: number; uncertain: number; released: number }> {
  return withTenant(prisma, tenantId, async (tx) => {
    const policy = await tx.emailSendPolicy.findUnique({ where: { tenantId } });
    const dayStart = utcWindows().dayStart;
    const count = (state: string) => tx.emailSendReservation.count({ where: { tenantId, dayStart, state } });
    return {
      hourlyCap: policy?.hourlyCap ?? 20,
      dailyCap: policy?.dailyCap ?? 100,
      tenantDailyCap: policy?.tenantDailyCap ?? 100,
      userHourlyCap: policy?.userHourlyCap ?? 10,
      maxRecipients: policy?.maxRecipients ?? 5,
      reserved: await count('RESERVED'),
      accepted: await count('ACCEPTED'),
      uncertain: await count('UNCERTAIN'),
      released: await count('RELEASED'),
    };
  });
}

export async function investigateDelivery(prisma: PrismaClient, actor: Actor, attemptId: string, note: string): Promise<{ state: string; sent: false }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: attemptId } } });
    if (!attempt) throw new Error('NOT_FOUND');
    if (!(await canAccess(tx, actor, attempt.connectionId, 'READ'))) throw new Error('FORBIDDEN');
    await tx.mailboxDeliveryEvent.create({ data: { tenantId: actor.tenantId, attemptId, kind: 'HUMAN_INVESTIGATION', detail: { note: note.slice(0, 500), delivered: false, providerStateUnchanged: true } } });
    return { state: attempt.state, sent: false as const };
  });
}

async function sendFacts(tx: Prisma.TransactionClient, actor: { tenantId: string; userId: string }, threadId: string | null, connectionId: string): Promise<Omit<SendGateInput, 'approvalMatches' | 'approvalExpired' | 'duplicateAccepted' | 'liveSendEnabled' | 'tenantSendingEnabled' | 'mailboxSendingEnabled' | 'killSwitch' | 'providerReady' | 'humanAction' | 'captureMailbox' | 'sendScope' | 'senderAllowed' | 'recipientLimitExceeded'>> {
  const link = threadId ? await tx.mailboxThreadLink.findFirst({ where: { tenantId: actor.tenantId, threadId, subjectType: 'lead' } }) : null;
  const lead = link ? await tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: link.subjectId } }, include: { contact: true } }) : null;
  const takeover = threadId ? await tx.crmTakeover.findFirst({ where: { tenantId: actor.tenantId, active: true, subjectType: 'lead', subjectId: link?.subjectId ?? threadId } }) : null;
  const suppressed = lead ? await tx.crmSuppression.findFirst({ where: { tenantId: actor.tenantId, active: true, OR: [{ accountId: lead.accountId }, ...(lead.contactId ? [{ contactId: lead.contactId }] : [])] } }) : null;
  const eligibility = evaluateEligibility({ suppressed: Boolean(suppressed), humanTakeover: Boolean(takeover), consentKnown: lead?.contact?.consentState === 'KNOWN', contactVerified: lead?.contact?.verificationStatus === 'VERIFIED' });
  const policy = await tx.crmContactPolicy.findUnique({ where: { tenantId: actor.tenantId } });
  const gate = await tx.$queryRaw<Array<{ automation_status: string }>>`SELECT automation_status FROM public.read_execution_gate(${actor.tenantId}::uuid)`;
  const quiet = evaluateQuietHours({
    timezone: policy?.timezone || '',
    weekdays: (policy?.weekdays as number[] | undefined) ?? [1, 2, 3, 4, 5],
    startMinute: policy?.startMinute ?? 540,
    endMinute: policy?.endMinute ?? 1020,
    holidays: (policy?.holidays as string[] | undefined) ?? [],
    minimumIntervalHours: policy?.minimumIntervalHours ?? 24,
    maxAttemptsPerPeriod: policy?.maxAttempts ?? 3,
  }, new Date());
  return {
    organizationActive: (await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`)[0]?.ok === true,
    connectionReadable: Boolean(connectionId),
    recipientKnown: Boolean(lead?.contact),
    suppressed: Boolean(suppressed),
    humanTakeover: Boolean(takeover),
    consentKnown: lead?.contact?.consentState === 'KNOWN',
    recipientVerified: lead?.contact?.verificationStatus === 'VERIFIED',
    eligibilityAllows: eligibility.state === 'ELIGIBLE',
    quietHours: quiet.decision === 'ALLOW' ? 'ALLOW' : quiet.decision === 'BLOCK' ? 'BLOCK' : 'UNKNOWN',
    organizationPaused: gate[0]?.automation_status === 'PAUSED',
    agentPaused: false,
    frequencyBlocked: quiet.reason === 'FREQUENCY_LIMIT' || quiet.reason === 'ATTEMPT_LIMIT',
    productRestricted: false,
    contentBlocked: false,
    attachmentBlocked: false,
    rateLimited: false,
  };
}

async function recordAttempt(prisma: PrismaClient, actor: Actor, prepared: { draft: { connectionId: string }; version: { id: string } | null; approval: { id: string } | null; connection: { provider: string } | null }, state: string, reason: string, outcome?: OutboundDelivery): Promise<{ state: string; sent: false; created: boolean }> {
  if (!prepared.version || !prepared.connection) return { state: 'FAILED_FINAL', sent: false, created: false };
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const key = createHash('sha256').update(`${prepared.version!.id}:${state}`).digest('hex');
    const existing = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: key } } });
    if (existing) return { state: existing.state, sent: false as const, created: false };
    const providerMessageId = state === 'CAPTURED' ? `capture-${randomUUID()}` : outcome?.providerMessageId ?? null;
    const created = await tx.mailboxSendAttempt.create({
      data: {
        tenantId: actor.tenantId,
        draftVersionId: prepared.version!.id,
        approvalId: prepared.approval?.id,
        connectionId: prepared.draft.connectionId,
        state,
        provider: prepared.connection!.provider,
        providerRequestId: outcome?.correlationId ?? (state === 'CAPTURED' ? `request-${randomUUID()}` : null),
        providerMessageId,
        failureReason: state === 'FAILED_FINAL' ? reason : null,
        reconciliation: state === 'CAPTURED' ? 'CAPTURED_NOT_SENT' : state === 'PROVIDER_ACCEPTED' ? 'PROVIDER_ACCEPTED_NOT_DELIVERED' : reason,
        acceptanceState: outcome?.acceptance ?? null,
        correlationId: outcome?.correlationId ?? null,
        httpStatus: outcome?.httpStatus ?? null,
        sent: false,
        idempotencyKey: key,
      },
    });
    if (state === 'PROVIDER_ACCEPTED') {
      const today = new Date();
      const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      await tx.emailSendQuota.upsert({
        where: { tenantId_connectionId_periodStart: { tenantId: actor.tenantId, connectionId: prepared.draft.connectionId, periodStart } },
        create: { tenantId: actor.tenantId, connectionId: prepared.draft.connectionId, periodStart, acceptedCount: 1 },
        update: { acceptedCount: { increment: 1 } },
      });
    }
    await tx.mailboxDeliveryEvent.create({ data: { tenantId: actor.tenantId, attemptId: created.id, kind: state, detail: { sent: false, reason, delivered: false } } });
    return { state, sent: false as const, created: true };
  });
}

async function mailboxGate(tx: Prisma.TransactionClient, actor: Actor, connectionId: string, permission: string): Promise<'ok' | StopReason> {
  const active = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`;
  if (active[0]?.ok !== true) return 'suspended';
  if (!(await memberIsAssignable(tx, actor.tenantId, actor.userId))) return 'forbidden';
  if (!(await hasPermission(tx, actor.tenantId, actor.userId, permission))) return 'forbidden';
  if (!(await canAccess(tx, actor, connectionId, 'READ'))) return 'forbidden';
  return 'ok';
}

async function hasPermission(tx: Prisma.TransactionClient, tenantId: string, userId: string, permission: string): Promise<boolean> {
  const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
  return membership?.roles.some((link) => link.role.permissions.some((item) => item.permission === permission)) === true;
}

export async function canAccess(tx: Prisma.TransactionClient, actor: { tenantId: string; userId: string }, connectionId: string, needed: 'READ' | 'DRAFT' | 'SEND'): Promise<boolean> {
  const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
  if (!connection) return false;
  const rank = { READ: 1, DRAFT: 2, SEND: 3 };
  const row = await tx.mailboxAccess.findUnique({ where: { tenantId_connectionId_userId: { tenantId: actor.tenantId, connectionId, userId: actor.userId } } });
  const role = row?.accessRole ?? (connection.connectedBy === actor.userId ? 'SEND' : '');
  return rank[role as 'READ'] >= rank[needed];
}

function parseCursor(value: string | null | undefined): { token: string | null; pending: InboundMessage[]; historyId: string | null; mode: 'list' | 'history' | 'delta'; backfillRemaining: number } {
  const empty = { token: null, pending: [] as InboundMessage[], historyId: null, mode: 'list' as const, backfillRemaining: 2 };
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as { token?: string | null; pending?: InboundMessage[]; historyId?: string | null; mode?: 'list' | 'history' | 'delta'; backfillRemaining?: number };
    return {
      token: parsed.token ?? null,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      historyId: parsed.historyId ?? null,
      mode: parsed.mode ?? 'list',
      backfillRemaining: parsed.backfillRemaining ?? 2,
    };
  } catch {
    return { ...empty, token: value };
  }
}

async function claimLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string): Promise<{ status: 'claimed'; token: string; version: number } | { status: 'held' } | { status: 'closed' }> {
  const token = randomUUID();
  const rows = await tx.$queryRaw<Array<{ lease_version: number; lease_token: string }>>`
    INSERT INTO public.crm_work_leases (tenant_id, kind, record_id, lease_token, lease_until, lease_version, status)
    VALUES (${tenantId}::uuid, ${kind}, ${recordId}::uuid, ${token}, pg_catalog.now() + make_interval(secs => ${LEASE_SECONDS}::double precision), 1, 'RUNNING')
    ON CONFLICT (tenant_id, kind, record_id) DO UPDATE
      SET lease_token = EXCLUDED.lease_token,
          lease_until = EXCLUDED.lease_until,
          lease_version = crm_work_leases.lease_version + 1,
          status = 'RUNNING'
      WHERE crm_work_leases.status <> 'CANCELLED'
        AND (
          crm_work_leases.status IN ('COMPLETED', 'OPEN')
          OR crm_work_leases.lease_until IS NULL
          OR crm_work_leases.lease_until < pg_catalog.now()
        )
    RETURNING lease_version, lease_token
  `;
  if (rows[0]) return { status: 'claimed', token: rows[0].lease_token, version: rows[0].lease_version };
  const current = await tx.crmWorkLease.findUnique({ where: { tenantId_kind_recordId: { tenantId, kind, recordId } } });
  if (!current || current.status === 'COMPLETED' || current.status === 'CANCELLED') return { status: 'closed' };
  return { status: 'held' };
}

async function renewLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string): Promise<void> {
  await tx.$executeRaw`UPDATE public.crm_work_leases SET lease_until = pg_catalog.now() + make_interval(secs => ${LEASE_SECONDS}::double precision) WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind} AND record_id = ${recordId}::uuid AND status = 'RUNNING'`;
}

async function releaseLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string, fence?: { token: string; version: number }): Promise<void> {
  await tx.crmWorkLease.updateMany({
    where: { tenantId, kind, recordId, status: 'RUNNING', ...(fence ? { leaseToken: fence.token, leaseVersion: fence.version } : {}) },
    data: { status: 'OPEN', leaseUntil: new Date(0), leaseToken: null },
  });
}

async function finishLease(tx: Prisma.TransactionClient, tenantId: string, kind: string, recordId: string, status: 'COMPLETED' | 'CANCELLED' | 'OPEN', fence?: { token: string; version: number }): Promise<void> {
  await tx.crmWorkLease.updateMany({
    where: { tenantId, kind, recordId, ...(fence ? { leaseToken: fence.token, leaseVersion: fence.version, status: 'RUNNING' } : {}) },
    data: { status: status === 'OPEN' ? 'OPEN' : status, leaseToken: null, leaseUntil: status === 'OPEN' ? new Date(0) : null },
  });
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function encryptToken(value: string, key: Buffer): Buffer {
  return encryptField(value, key);
}

export async function syncConnection(prisma: PrismaClient, actor: Actor, connectionId: string, fetchImpl: typeof fetch = fetch): Promise<{ imported: number; held?: boolean; stopped?: StopReason; status?: string; rateLimited?: boolean }> {
  const opened = await withTenant(prisma, actor.tenantId, async (tx) => {
    const gate = await mailboxGate(tx, actor, connectionId, 'mailbox.connect');
    if (gate !== 'ok') return { stopped: gate };
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!connection) return { stopped: 'forbidden' as const };
    return { provider: connection.provider, status: connection.status };
  });
  if ('stopped' in opened) return { imported: 0, stopped: opened.stopped };
  if (opened.provider === 'capture') return syncMailbox(prisma, actor, connectionId);
  if (opened.provider !== 'google' && opened.provider !== 'microsoft') return { imported: 0, status: 'NOT_CONFIGURED' };
  if (opened.status === 'DISCONNECTED') return { imported: 0, status: 'DISCONNECTED' };
  return syncProviderMailbox(prisma, actor, connectionId, opened.provider, fetchImpl);
}

async function syncProviderMailbox(prisma: PrismaClient, actor: Actor, connectionId: string, provider: 'google' | 'microsoft', fetchImpl: typeof fetch): Promise<{ imported: number; held?: boolean; stopped?: StopReason; status?: string; rateLimited?: boolean }> {
  const claimed = await withTenant(prisma, actor.tenantId, async (tx) => {
    const gate = await mailboxGate(tx, actor, connectionId, 'mailbox.connect');
    if (gate !== 'ok') return { stopped: gate };
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!connection || connection.status === 'DISCONNECTED') return { stopped: 'forbidden' as const };
    const scopes = Array.isArray(connection.scopes) ? connection.scopes.map(String) : [];
    if (connection.syncPaused) return { status: 'PAUSED' as const };
    if (scopes.some((item) => /gmail\.send|mail\.send/i.test(item))) {
      await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } }, data: { status: 'NOT_CONFIGURED', lastError: 'SEND_SCOPE_PRESENT', sendingEnabled: false, live: false } });
      return { status: 'SEND_SCOPE_PRESENT' as const };
    }
    const lease = await claimLease(tx, actor.tenantId, 'mailbox.incremental_sync', connectionId);
    if (lease.status === 'held') return { held: true as const };
    if (lease.status !== 'claimed') return { stopped: 'revoked' as const };
    const cursorRow = await tx.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } } });
    const cursor = parseCursor(cursorRow?.cursor);
    return {
      claimed: true as const,
      access: connection.accessTokenCiphertext ? decryptField(Buffer.from(connection.accessTokenCiphertext), actor.key) : '',
      refresh: connection.refreshTokenCiphertext ? decryptField(Buffer.from(connection.refreshTokenCiphertext), actor.key) : '',
      expiresAt: connection.tokenExpiresAt,
      address: connection.address,
      cursor,
      fence: { token: lease.token, version: lease.version, revocationVersion: connection.revocationVersion },
      scopes,
    };
  });
  if ('stopped' in claimed && claimed.stopped) return { imported: 0, stopped: claimed.stopped };
  if ('held' in claimed) return { imported: 0, held: true };
  if ('status' in claimed) return { imported: 0, status: claimed.status };
  const fence = claimed.fence;
  const startedAt = Date.now();
  const cursorBefore = JSON.stringify(claimed.cursor);
  console.info(JSON.stringify({ metric: 'mailbox_sync_started', provider, code: 'STARTED' }));
  const record = (status: string, extra: { error?: string | null; imported?: number; duplicates?: number; cursorAfter?: string | null; rateLimited?: boolean; identityMatched?: boolean; authenticated?: boolean; pageCommitted?: boolean; fenceOk?: boolean } = {}) => observeMailboxSync(prisma, actor, {
    connectionId, provider, status, error: extra.error ?? null, imported: extra.imported ?? 0, duplicates: extra.duplicates ?? 0,
    cursorBefore, cursorAfter: extra.cursorAfter ?? cursorBefore, rateLimited: extra.rateLimited, leaseVersion: fence.version, fetchImpl, startedAt,
    readScope: claimed.scopes.find((item) => /readonly|mail\.read/i.test(item)) ?? 'unknown', identityMatched: extra.identityMatched,
    scopes: claimed.scopes, authenticated: extra.authenticated, pageCommitted: extra.pageCommitted, fenceOk: extra.fenceOk,
  });
  if (actor.pause === 'after-claim') {
    writeSync(1, 'checkpoint\n');
    await new Promise(() => undefined);
  }
  let access = claimed.access;
  if (!access) {
    await finishProvider(prisma, actor, connectionId, fence, 'NOT_CONFIGURED', 'TOKEN_MISSING');
    await record('NOT_CONFIGURED', { error: 'TOKEN_MISSING' });
    return { imported: 0, status: 'NOT_CONFIGURED' };
  }
  if (claimed.expiresAt && claimed.expiresAt.getTime() < Date.now() + 60_000) {
    if (!claimed.refresh) {
      await finishProvider(prisma, actor, connectionId, fence, 'NOT_CONFIGURED', 'REFRESH_MISSING');
      await record('NOT_CONFIGURED', { error: 'REFRESH_MISSING' });
      return { imported: 0, status: 'NOT_CONFIGURED' };
    }
    try {
      const client = provider === 'google'
        ? { id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '', secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '' }
        : { id: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? '', secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? '' };
      const refreshed = await refreshOAuthToken(provider, { clientId: client.id, clientSecret: client.secret, refreshToken: claimed.refresh }, fetchImpl);
      access = refreshed.accessToken;
      const saved = await withTenant(prisma, actor.tenantId, async (tx) => {
        if (await providerFence(tx, actor, connectionId, fence) !== 'ok') return false;
        const updated = await tx.mailboxConnection.updateMany({
          where: { tenantId: actor.tenantId, id: connectionId, revocationVersion: fence.revocationVersion, status: { not: 'DISCONNECTED' } },
          data: {
            accessTokenCiphertext: new Uint8Array(encryptToken(refreshed.accessToken, actor.key)),
            refreshTokenCiphertext: refreshed.refreshToken ? new Uint8Array(encryptToken(refreshed.refreshToken, actor.key)) : undefined,
            tokenExpiresAt: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null,
          },
        });
        return updated.count === 1;
      });
      if (!saved) return { imported: 0, stopped: 'revoked' };
    } catch {
      await finishProvider(prisma, actor, connectionId, fence, 'SYNC_ERROR', 'TOKEN_REFRESH_FAILED');
      await record('SYNC_ERROR', { error: 'TOKEN_REFRESH_FAILED' });
      return { imported: 0, status: 'SYNC_ERROR' };
    }
  }
  const cursor: ProviderCursor = { mode: claimed.cursor.mode, token: claimed.cursor.token, historyId: claimed.cursor.historyId };
  let page;
  try {
    page = await readProviderPage({ provider, accessToken: access, cursor }, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PROVIDER_READ_FAILED';
    await finishProvider(prisma, actor, connectionId, fence, 'SYNC_ERROR', message.includes('rate limited') ? 'RATE_LIMIT' : 'PROVIDER_READ_FAILED');
    await record(message.includes('rate limited') ? 'RATE_LIMIT' : 'SYNC_ERROR', { error: message.includes('rate limited') ? 'RATE_LIMIT' : message, rateLimited: message.includes('rate limited') });
    return { imported: 0, status: 'SYNC_ERROR', rateLimited: message.includes('rate limited') };
  }
  if (page.rateLimited) {
    await noteProvider(prisma, actor, connectionId, fence, 'RATE_LIMIT', 'RATE_LIMIT');
    await record('RATE_LIMIT', { error: 'RATE_LIMIT', rateLimited: true, authenticated: false, pageCommitted: false, fenceOk: true });
    return { imported: 0, status: 'RATE_LIMIT', rateLimited: true };
  }
  if (actor.pause === 'after-response') {
    writeSync(1, 'checkpoint\n');
    await new Promise(() => undefined);
  }
  if (page.mailboxAddress && page.mailboxAddress.toLowerCase() !== claimed.address.toLowerCase()) {
    await noteProvider(prisma, actor, connectionId, fence, 'IDENTITY_MISMATCH');
    await record('IDENTITY_MISMATCH', { error: 'IDENTITY_MISMATCH' });
    return { imported: 0, status: 'IDENTITY_MISMATCH' };
  }
  if (page.expiredCursor) {
    const recovered = await withTenant(prisma, actor.tenantId, async (tx) => {
      const decision = await providerFence(tx, actor, connectionId, fence);
      if (decision !== 'ok') return { stopped: decision };
      const current = parseCursor((await tx.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } } }))?.cursor);
      current.token = null;
      current.historyId = null;
      current.mode = provider === 'google' ? 'list' : 'delta';
      await tx.mailboxSyncCursor.upsert({
        where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } },
        create: { tenantId: actor.tenantId, connectionId, cursor: JSON.stringify(current) },
        update: { cursor: JSON.stringify(current) },
      });
      if (actor.pause === 'during-recovery') {
        writeSync(1, 'checkpoint\n');
        await new Promise(() => undefined);
      }
      await tx.mailboxConnection.updateMany({ where: { tenantId: actor.tenantId, id: connectionId, revocationVersion: fence.revocationVersion, status: { not: 'DISCONNECTED' } }, data: { lastError: 'CURSOR_RECOVERED', status: 'CURSOR_RECOVERED', live: false, sendingEnabled: false } });
      await finishLease(tx, actor.tenantId, 'mailbox.incremental_sync', connectionId, 'COMPLETED', fence);
      return { recovered: true as const, cursor: JSON.stringify(current) };
    });
    if ('stopped' in recovered) return { imported: 0, stopped: recovered.stopped };
    await record('CURSOR_RECOVERED', { error: 'CURSOR_RECOVERED', cursorAfter: recovered.cursor, authenticated: true, pageCommitted: false, fenceOk: true });
    return { imported: 0, status: 'CURSOR_RECOVERED' };
  }
  const stored = await withTenant(prisma, actor.tenantId, async (tx) => {
    const decision = await providerFence(tx, actor, connectionId, fence);
    if (decision !== 'ok') return { stopped: decision };
    let imported = 0;
    for (const message of page.messages) {
      if (await ingestOne(tx, actor.tenantId, connectionId, normalizeProviderMessage(message))) imported += 1;
    }
    if (actor.pause === 'during-commit') {
      writeSync(1, 'checkpoint\n');
      await new Promise(() => undefined);
    }
    const current = parseCursor((await tx.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } } }))?.cursor);
    current.pending = [];
    current.token = page.nextCursor;
    current.historyId = page.historyId;
    current.mode = page.nextCursor ? page.mode : page.mode;
    if (!page.nextCursor && page.historyId) current.mode = 'history';
    await tx.mailboxSyncCursor.upsert({
      where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } },
      create: { tenantId: actor.tenantId, connectionId, cursor: JSON.stringify(current) },
      update: { cursor: JSON.stringify(current) },
    });
    const evidence = classifyProviderEvidence({
      provider, fetchImpl, scopes: claimed.scopes, identityMatched: Boolean(page.mailboxAddress), authenticated: true, pageCommitted: !page.nextCursor, fenceOk: true, credentialsConfigured: credentialsConfigured(provider),
    });
    const status = page.nextCursor ? 'SYNC_PARTIAL' : evidence === 'REAL_READ_VERIFIED' ? 'SYNCED' : 'STUB_SYNCED';
    await tx.mailboxConnection.updateMany({ where: { tenantId: actor.tenantId, id: connectionId, revocationVersion: fence.revocationVersion, status: { not: 'DISCONNECTED' } }, data: { lastSyncAt: new Date(), lastError: null, status, live: false, sendingEnabled: false } });
    await tx.mailboxSyncEvent.create({ data: { tenantId: actor.tenantId, connectionId, status, detail: `imported ${imported}` } });
    await finishLease(tx, actor.tenantId, 'mailbox.incremental_sync', connectionId, 'COMPLETED', fence);
    return { imported, status, cursor: JSON.stringify(current), duplicates: page.messages.length - imported };
  });
  if ('stopped' in stored) return { imported: 0, stopped: stored.stopped };
  if (actor.pause === 'after-commit') {
    writeSync(1, 'checkpoint\n');
    await new Promise(() => undefined);
  }
  await record(stored.status, { imported: stored.imported, duplicates: stored.duplicates, cursorAfter: stored.cursor, identityMatched: Boolean(page.mailboxAddress), authenticated: true, pageCommitted: stored.status === 'SYNCED', fenceOk: true });
  return { imported: stored.imported, status: stored.status };
}

function normalizeProviderMessage(message: NormalizedMail): InboundMessage {
  return { ...message, provenance: message.provenance };
}

async function finishProvider(prisma: PrismaClient, actor: Actor, connectionId: string, fence: SyncFence, status: string, error: string): Promise<void> {
  await withTenant(prisma, actor.tenantId, async (tx) => {
    if (await providerFence(tx, actor, connectionId, fence) !== 'ok') return;
    await tx.mailboxConnection.updateMany({ where: { tenantId: actor.tenantId, id: connectionId, revocationVersion: fence.revocationVersion, status: { not: 'DISCONNECTED' } }, data: { status, lastError: error, live: false, sendingEnabled: false } });
    await finishLease(tx, actor.tenantId, 'mailbox.incremental_sync', connectionId, 'COMPLETED', fence);
  });
}

async function noteProvider(prisma: PrismaClient, actor: Actor, connectionId: string, fence: SyncFence, error: string, status?: string): Promise<void> {
  await withTenant(prisma, actor.tenantId, async (tx) => {
    if (await providerFence(tx, actor, connectionId, fence) !== 'ok') return;
    await tx.mailboxConnection.updateMany({ where: { tenantId: actor.tenantId, id: connectionId, revocationVersion: fence.revocationVersion, status: { not: 'DISCONNECTED' } }, data: { lastError: error, ...(status ? { status } : {}), live: false, sendingEnabled: false } });
    await finishLease(tx, actor.tenantId, 'mailbox.incremental_sync', connectionId, 'COMPLETED', fence);
  });
}

type SyncFence = { token: string; version: number; revocationVersion: number };

async function providerFence(tx: Prisma.TransactionClient, actor: Actor, connectionId: string, fence: SyncFence): Promise<'ok' | StopReason> {
  const active = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`;
  if (active[0]?.ok !== true) return 'suspended';
  if (!(await memberIsAssignable(tx, actor.tenantId, actor.userId))) return 'forbidden';
  if (!(await hasPermission(tx, actor.tenantId, actor.userId, 'mailbox.connect'))) return 'forbidden';
  const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
  if (!connection || connection.status === 'DISCONNECTED' || connection.revocationVersion !== fence.revocationVersion) return 'revoked';
  const scopes = Array.isArray(connection.scopes) ? connection.scopes.map(String) : [];
  if (scopes.some((item) => /gmail\.send|mail\.send/i.test(item))) return 'revoked';
  const access = await tx.mailboxAccess.findUnique({ where: { tenantId_connectionId_userId: { tenantId: actor.tenantId, connectionId, userId: actor.userId } } });
  const rank = { READ: 1, DRAFT: 2, SEND: 3 } as Record<string, number>;
  if (!access || (rank[access.accessRole] ?? 0) < rank.READ) return 'revoked';
  const lease = await tx.crmWorkLease.findUnique({ where: { tenantId_kind_recordId: { tenantId: actor.tenantId, kind: 'mailbox.incremental_sync', recordId: connectionId } } });
  if (!lease || lease.status !== 'RUNNING' || lease.leaseToken !== fence.token || lease.leaseVersion !== fence.version) return 'revoked';
  if (lease.leaseUntil && lease.leaseUntil.getTime() <= Date.now()) return 'revoked';
  return 'ok';
}

export async function revokeMailboxConnection(prisma: PrismaClient, tenantId: string, connectionId: string): Promise<void> {
  await withTenant(prisma, tenantId, async (tx) => {
    await tx.mailboxConnection.update({
      where: { tenantId_id: { tenantId, id: connectionId } },
      data: { status: 'DISCONNECTED', accessTokenCiphertext: null, refreshTokenCiphertext: null, sendingEnabled: false, live: false, revocationVersion: { increment: 1 } },
    });
    await tx.crmWorkLease.updateMany({
      where: { tenantId, recordId: connectionId, kind: 'mailbox.incremental_sync', status: 'RUNNING' },
      data: { status: 'OPEN', leaseToken: null, leaseUntil: new Date(0), leaseVersion: { increment: 1 } },
    });
  });
}

export async function inboxPromptFacts(tx: Prisma.TransactionClient, tenantId: string, threadId: string, citations: Array<{ chunkId: string; excerpt: string }>): Promise<string> {
  const messages = await tx.mailboxMessage.findMany({ where: { tenantId, threadId }, orderBy: { receivedAt: 'asc' }, take: 20 });
  const email = messages.map((item) => `${item.sender}: ${item.textBody}`).join('\n');
  const knowledge = citations.map((item) => `SOURCE ${item.chunkId}\n${item.excerpt}`).join('\n');
  return `APPROVED KNOWLEDGE:\n${knowledge}\n\nUNTRUSTED EMAIL:\n${email}`;
}
