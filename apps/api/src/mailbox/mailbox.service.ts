import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, canAccess, decodeEncryptionKey, decryptField, encryptToken, hashState, investigateDelivery, queueMailboxImport, reconcileSend, reviewDraft, revokeMailboxConnection, saveDraft, sendDraft, sendQuotaSummary, submitDraft, syncConnection, withTenant } from '@salesos/database';
import { sendWithGmail, sendWithGraph } from '@salesos/integrations';
import { allowedRedirect, liveEmailSendEnabled, mailboxProviders, oauthAuthorizeUrl, pkcePair, sendScopeGranted } from '@salesos/shared';
import { webhookAuthentic, exchangeOAuthCode } from '@salesos/integrations';
import { captureWebhookStatus } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import { AgentsService } from '../agents/agents.service';
import type { AnalyzeDto, CaptureMailboxDto, DraftBodyDto, DraftDecisionDto, ImportMessagesDto, MailboxListDto, OauthStartDto, ThreadAssignDto, ThreadLinkDto, ThreadUnlinkDto } from './mailbox.dto';

@Injectable()
export class MailboxConnectionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AppConfig) private readonly config: AppConfig) {}

  providers() {
    return {
      providers: mailboxProviders(this.config.env).map((item) => ({ ...item, availability: item.status === 'CAPTURE' ? 'MOCK / CAPTURE MODE' : item.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : item.status })),
      liveSend: 'NOT CONFIGURED' as const,
    };
  }

  async createCapture(actor: SessionContext, body: CaptureMailboxDto, requestId: string) {
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.mailboxConnection.create({
        data: { tenantId, provider: 'capture', providerMailboxId: `capture-${randomBytes(8).toString('hex')}`, address: body.address, connectedBy: actor.userId, status: 'CAPTURE', live: false, sendingEnabled: false, scopes: ['READ', 'DRAFT'] },
      });
      await tx.mailboxAccess.create({ data: { tenantId, connectionId: row.id, userId: actor.userId, accessRole: 'SEND' } });
      await tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId: actor.userId, action: 'mailbox.capture.create', entityType: 'mailbox_connection', entityId: row.id, payload: { requestId, live: false } } });
      return this.publicConnection(row);
    });
  }

  async listConnections(actor: SessionContext, query: MailboxListDto) {
    return this.page(actor, 'mailboxConnection', query, ['address']);
  }

  async connection(actor: SessionContext, id: string) {
    const row = await this.one(actor, id);
    return this.publicConnection(row);
  }

  async disconnect(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    const allowed = await withTenant(this.database.prisma, tenantId, (tx) => canAccess(tx, { tenantId, userId: actor.userId }, id, 'READ'));
    if (!allowed) throw new ApiException(404, 'NOT_FOUND', 'Mailbox was not found');
    await revokeMailboxConnection(this.database.prisma, tenantId, id);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id } } });
      await tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId: actor.userId, action: 'mailbox.disconnect', entityType: 'mailbox_connection', entityId: id, payload: { requestId } } });
      return this.publicConnection(row!);
    });
  }

  async startOauth(actor: SessionContext, body: OauthStartDto, send = false) {
    const origins = this.config.env.WEB_ORIGIN.split(',').map((item) => item.trim());
    if (!allowedRedirect(body.redirectUri, origins)) throw new ApiException(400, 'VALIDATION_ERROR', 'Redirect target is not allowed');
    const clientId = body.provider === 'google' ? this.config.env.GOOGLE_OAUTH_CLIENT_ID : this.config.env.MICROSOFT_OAUTH_CLIENT_ID;
    const pair = pkcePair();
    const state = randomBytes(24).toString('base64url');
    const url = oauthAuthorizeUrl(body.provider, { clientId, redirectUri: body.redirectUri, state, challenge: pair.challenge, send });
    if (!url) return { status: 'NOT_CONFIGURED' as const, authorizeUrl: null, live: false as const, send };
    const tenantId = this.tenant(actor);
    const key = decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY);
    await withTenant(this.database.prisma, tenantId, (tx) => tx.mailboxOauthState.create({
      data: { tenantId, stateHash: hashState(state), provider: body.provider, verifierCiphertext: new Uint8Array(encryptToken(pair.verifier, key)), redirectUri: body.redirectUri, createdBy: actor.userId, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    }));
    return { status: 'CONFIGURED_UNVERIFIED' as const, authorizeUrl: url, live: false as const, send };
  }

  async startSendOauth(actor: SessionContext, body: OauthStartDto & { connectionId?: string }) {
    const started = await this.startOauth(actor, body, true);
    const tenantId = this.tenant(actor);
    if (body.connectionId && started.authorizeUrl) {
      await withTenant(this.database.prisma, tenantId, async (tx) => {
        const row = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: body.connectionId! } } });
        if (!row || row.status === 'DISCONNECTED') return;
        await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: row.id } }, data: { sendCapability: 'SEND_REQUESTED', sendingEnabled: false } });
      });
    }
    return { ...started, capability: started.authorizeUrl ? 'SEND_REQUESTED' : 'READ_ONLY', sendingEnabled: false };
  }

  async completeOauth(state: string, code: string | undefined): Promise<{ location: string }> {
    const rows = await this.database.prisma.$queryRaw<Array<{ tenant_id: string; id: string; consumed_at: Date | null; expires_at: Date; redirect_uri: string }>>`
      SELECT tenant_id, id, consumed_at, expires_at, redirect_uri FROM public.lookup_mailbox_oauth_state(${hashState(state || '')})`;
    const row = rows[0];
    const rejected = row?.redirect_uri ? new URL(row.redirect_uri) : null;
    if (!row || row.consumed_at || row.expires_at.getTime() < Date.now() || !rejected) {
      return { location: '/workspace/inbox?mailbox=rejected' };
    }
    rejected.searchParams.set('mailbox', 'not-configured');
    const key = decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY);
    const prepared = await withTenant(this.database.prisma, row.tenant_id, async (tx) => {
      const stored = await tx.mailboxOauthState.findUnique({ where: { tenantId_id: { tenantId: row.tenant_id, id: row.id } } });
      if (!stored || stored.consumedAt) return null;
      await tx.mailboxOauthState.update({ where: { tenantId_id: { tenantId: row.tenant_id, id: row.id } }, data: { consumedAt: new Date() } });
      return { provider: stored.provider, verifier: decryptField(Buffer.from(stored.verifierCiphertext), key), redirectUri: stored.redirectUri, createdBy: stored.createdBy };
    });
    if (!prepared || !code) return { location: rejected.toString() };
    const clientId = prepared.provider === 'microsoft' ? this.config.env.MICROSOFT_OAUTH_CLIENT_ID : this.config.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = prepared.provider === 'microsoft' ? this.config.env.MICROSOFT_OAUTH_CLIENT_SECRET : this.config.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { location: rejected.toString() };
    try {
      const exchanged = await exchangeOAuthCode(prepared.provider === 'microsoft' ? 'microsoft' : 'google', {
        clientId, clientSecret, code, redirectUri: prepared.redirectUri, verifier: prepared.verifier,
      });
      if (!exchanged.email) {
        rejected.searchParams.set('mailbox', 'exchange-failed');
        return { location: rejected.toString() };
      }
      await withTenant(this.database.prisma, row.tenant_id, async (tx) => {
        const created = await tx.mailboxConnection.create({
          data: {
            tenantId: row.tenant_id,
            provider: prepared.provider,
            providerMailboxId: exchanged.mailboxId || exchanged.email!,
            address: exchanged.email!,
            connectedBy: prepared.createdBy,
            scopes: exchanged.scopes.length ? exchanged.scopes : ['READ'],
            accessTokenCiphertext: new Uint8Array(encryptToken(exchanged.accessToken, key)),
            refreshTokenCiphertext: exchanged.refreshToken ? new Uint8Array(encryptToken(exchanged.refreshToken, key)) : null,
            tokenExpiresAt: exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null,
            status: 'CONFIGURED_UNVERIFIED',
            live: false,
            sendingEnabled: false,
            sendCapability: sendScopeGranted(prepared.provider, exchanged.scopes) ? 'SEND_AUTHORIZED' : 'READ_ONLY',
          },
        });
        await tx.mailboxAccess.create({ data: { tenantId: row.tenant_id, connectionId: created.id, userId: prepared.createdBy, accessRole: 'READ' } });
      });
      rejected.searchParams.set('mailbox', 'connected');
    } catch {
      rejected.searchParams.set('mailbox', 'exchange-failed');
    }
    return { location: rejected.toString() };
  }

  health() {
    return { google: mailboxProviders(this.config.env).find((item) => item.id === 'google')?.status, microsoft: mailboxProviders(this.config.env).find((item) => item.id === 'microsoft')?.status, liveSend: liveEmailSendEnabled(this.config.env) ? 'ENABLED' : 'NOT CONFIGURED' };
  }

  private async one(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      if (!(await canAccess(tx, { tenantId, userId: actor.userId }, id, 'READ'))) return null;
      return tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id } } });
    });
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Mailbox was not found');
    return row;
  }

  private publicConnection(row: { id: string; provider: string; address: string; status: string; live: boolean; lastSyncAt: Date | null; lastError: string | null; sendingEnabled: boolean; sendCapability?: string }) {
    const capability = row.sendCapability ?? 'READ_ONLY';
    return { id: row.id, provider: row.provider, address: row.address, status: row.status, live: row.live, lastSyncAt: row.lastSyncAt, lastError: row.lastError, sendingEnabled: row.sendingEnabled, sendCapability: capability, label: row.status === 'CAPTURE' ? 'MOCK / CAPTURE MODE' : row.status === 'DISCONNECTED' ? 'DISCONNECTED' : row.status === 'SYNCED' ? 'SYNCED' : row.status === 'CONFIGURED_UNVERIFIED' ? 'CONFIGURED UNVERIFIED' : row.live ? 'LIVE CONNECTED' : 'NOT CONFIGURED' };
  }

  private tenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    return actor.tenantId;
  }

  private async page(actor: SessionContext, model: 'mailboxConnection' | 'mailboxThread' | 'mailboxDraft' | 'mailboxSendAttempt', query: MailboxListDto, search: string[]) {
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy === 'address' ? 'address' : 'createdAt';
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const access = await tx.mailboxAccess.findMany({ where: { tenantId, userId: actor.userId } });
      const connectionIds = access.map((item) => item.connectionId);
      const where = {
        tenantId,
        ...(model === 'mailboxConnection' ? { id: { in: connectionIds } } : { connectionId: { in: connectionIds } }),
        ...(query.q ? { OR: search.map((field) => ({ [field]: { contains: query.q, mode: 'insensitive' as const } })) } : {}),
      };
      const delegate = tx[model] as { findMany: (input: unknown) => Promise<unknown[]>; count: (input: unknown) => Promise<number> };
      const [items, total] = await Promise.all([
        delegate.findMany({ where, orderBy: { [sortBy]: query.sortDirection ?? 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        delegate.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }
}

@Injectable()
export class MailboxSyncService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AppConfig) private readonly config: AppConfig) {}

  async importMessages(actor: SessionContext, body: ImportMessagesDto) {
    const outcome = await queueMailboxImport(this.database.prisma, this.actor(actor), body.connectionId, body.messages.map((item) => ({ ...item, provenance: item.provenance || 'USER PROVIDED MAIL' })));
    if (outcome.stopped) throw new ApiException(403, 'FORBIDDEN', 'Mailbox sync is not allowed');
    if (outcome.held) throw new ApiException(409, 'LEASE_HELD', 'Mailbox sync is already running');
    return { ...outcome, live: false };
  }

  sync(actor: SessionContext, id: string) {
    return syncConnection(this.database.prisma, this.actor(actor), id);
  }

  private actor(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    return { tenantId: actor.tenantId, userId: actor.userId, key: decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY) };
  }
}

@Injectable()
export class MailboxMessageService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  listThreads(actor: SessionContext, query: MailboxListDto) {
    return this.list(actor, query);
  }

  async thread(actor: SessionContext, id: string) {
    const tenantId = this.requireTenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const thread = await tx.mailboxThread.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!thread || !(await canAccess(tx, { tenantId, userId: actor.userId }, thread.connectionId, 'READ'))) throw new ApiException(404, 'NOT_FOUND', 'Thread was not found');
      const messages = await tx.mailboxMessage.findMany({ where: { tenantId, threadId: id }, orderBy: { receivedAt: 'asc' } });
      const links = await tx.mailboxThreadLink.findMany({ where: { tenantId, threadId: id } });
      const analyses = await tx.mailboxAiAnalysis.findMany({ where: { tenantId, threadId: id }, orderBy: { createdAt: 'desc' }, take: 5 });
      return {
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        classification: thread.classification,
        unreadCount: thread.unreadCount,
        ownerUserId: thread.ownerUserId,
        messages: messages.map((item) => ({ id: item.id, sender: item.sender, subject: item.subject, text: item.textBody, html: item.htmlSafe, receivedAt: item.receivedAt, provenance: item.provenance, direction: item.direction })),
        links: links.map((item) => ({ id: item.id, subjectType: item.subjectType, subjectId: item.subjectId })),
        analyses: analyses.map((item) => ({ summary: item.summary, intent: item.intent, signals: item.signals, modelProvider: item.modelProvider, modelName: item.modelName })),
      };
    });
  }

  async link(actor: SessionContext, body: ThreadLinkDto, requestId: string) {
    const tenantId = this.requireTenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const thread = await tx.mailboxThread.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
      if (!thread || !(await canAccess(tx, { tenantId, userId: actor.userId }, thread.connectionId, 'DRAFT'))) throw new ApiException(404, 'NOT_FOUND', 'Thread was not found');
      await tx.mailboxThreadLink.create({ data: { tenantId, threadId: body.id, subjectType: body.subjectType, subjectId: body.subjectId, createdBy: actor.userId } });
      await tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId: actor.userId, action: 'mailbox.thread.link', entityType: 'mailbox_thread', entityId: body.id, payload: { requestId, subjectType: body.subjectType } } });
      return { linked: true };
    });
  }

  async unlink(actor: SessionContext, body: ThreadUnlinkDto, requestId: string) {
    const tenantId = this.requireTenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const link = await tx.mailboxThreadLink.findUnique({ where: { tenantId_id: { tenantId, id: body.linkId } } });
      const thread = link ? await tx.mailboxThread.findUnique({ where: { tenantId_id: { tenantId, id: link.threadId } } }) : null;
      if (!link || link.threadId !== body.id || !thread || !(await canAccess(tx, { tenantId, userId: actor.userId }, thread.connectionId, 'DRAFT'))) throw new ApiException(404, 'NOT_FOUND', 'Link was not found');
      await tx.mailboxThreadLink.delete({ where: { tenantId_id: { tenantId, id: body.linkId } } });
      await tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId: actor.userId, action: 'mailbox.thread.unlink', entityType: 'mailbox_thread', entityId: body.id, payload: { requestId, subjectType: link.subjectType } } });
      return { unlinked: true };
    });
  }

  async assign(actor: SessionContext, body: ThreadAssignDto) {
    const tenantId = this.requireTenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const thread = await tx.mailboxThread.findUnique({ where: { tenantId_id: { tenantId, id: body.id } } });
      if (!thread || !(await canAccess(tx, { tenantId, userId: actor.userId }, thread.connectionId, 'DRAFT'))) throw new ApiException(404, 'NOT_FOUND', 'Thread was not found');
      const member = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.member_is_assignable(${tenantId}::uuid, ${body.ownerUserId}::uuid) AS ok`;
      if (member[0]?.ok !== true) throw new ApiException(409, 'OWNER_NOT_ASSIGNABLE', 'That member cannot own a conversation');
      await tx.mailboxThread.update({ where: { tenantId_id: { tenantId, id: body.id } }, data: { ownerUserId: body.ownerUserId } });
      return { assigned: true };
    });
  }

  private async list(actor: SessionContext, query: MailboxListDto) {
    const tenantId = this.requireTenant(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const access = await tx.mailboxAccess.findMany({ where: { tenantId, userId: actor.userId } });
      const where = { tenantId, connectionId: { in: access.map((item) => item.connectionId) }, ...(query.q ? { subject: { contains: query.q, mode: 'insensitive' as const } } : {}) };
      const [items, total] = await Promise.all([
        tx.mailboxThread.findMany({ where, orderBy: { lastActivityAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        tx.mailboxThread.count({ where }),
      ]);
      return { items: items.map((item) => ({ id: item.id, subject: item.subject, status: item.status, classification: item.classification, unreadCount: item.unreadCount, lastActivityAt: item.lastActivityAt })), total, page, pageSize };
    });
  }

  private requireTenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    return actor.tenantId;
  }
}

@Injectable()
export class MailboxSendService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(AgentsService) private readonly agents: AgentsService,
  ) {}

  save(actor: SessionContext, body: DraftBodyDto) {
    return this.wrap(() => saveDraft(this.database.prisma, this.actor(actor), body));
  }

  submit(actor: SessionContext, id: string) {
    return this.wrap(() => submitDraft(this.database.prisma, this.actor(actor), id));
  }

  decide(actor: SessionContext, body: DraftDecisionDto) {
    return this.wrap(() => reviewDraft(this.database.prisma, this.actor(actor), body.id, body.decision));
  }

  async send(actor: SessionContext, id: string) {
    const live = liveEmailSendEnabled(this.config.env);
    const result = await this.wrap(() => sendDraft(this.database.prisma, this.actor(actor), id, live, live ? async (input) => {
      const message = { from: input.from, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.body, threadId: input.threadRef || undefined };
      const sent = input.provider === 'microsoft' ? await sendWithGraph(input.token, message) : await sendWithGmail(input.token, message);
      return sent;
    } : undefined));
    return { ...result, label: result.state === 'CAPTURED' ? 'MOCK / CAPTURE MODE' : result.state === 'PROVIDER_ACCEPTED' ? 'PROVIDER ACCEPTED' : result.state === 'DELIVERY_UNKNOWN' ? 'DELIVERY UNKNOWN' : 'SEND DISABLED' };
  }

  async status(actor: SessionContext) {
    const live = liveEmailSendEnabled(this.config.env);
    const tenantId = actor.tenantId;
    const policy = tenantId ? await withTenant(this.database.prisma, tenantId, (tx) => tx.emailSendPolicy.findUnique({ where: { tenantId } })) : null;
    const quota = tenantId ? await sendQuotaSummary(this.database.prisma, tenantId) : { hourlyCap: 20, dailyCap: 100, tenantDailyCap: 100, userHourlyCap: 10, maxRecipients: 5, reserved: 0, accepted: 0, uncertain: 0, released: 0 };
    return { deployment: live ? 'ENABLED' : 'SEND DISABLED', tenant: policy?.enabled === true ? 'ON' : 'OFF', killSwitch: policy?.killSwitch === true ? 'ON' : 'OFF', mailbox: 'READ ONLY', live: live ? 'CONFIGURED' : 'NOT CONFIGURED', attachments: 'NOT SUPPORTED', sendNow: false, ...quota };
  }

  async setPolicy(actor: SessionContext, body: { enabled: boolean; killSwitch: boolean }) {
    const tenantId = this.actor(actor).tenantId;
    await withTenant(this.database.prisma, tenantId, (tx) => tx.emailSendPolicy.upsert({
      where: { tenantId },
      create: { tenantId, enabled: body.enabled, killSwitch: body.killSwitch },
      update: { enabled: body.enabled, killSwitch: body.killSwitch, policyRevision: { increment: 1 } },
    }));
    return this.status(actor);
  }

  async setMailboxSending(actor: SessionContext, id: string, sendingEnabled: boolean) {
    const tenantId = this.actor(actor).tenantId;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const row = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!row || !(await canAccess(tx, { tenantId, userId: actor.userId }, id, 'SEND'))) throw new Error('NOT_FOUND');
      const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
      if (sendingEnabled && (row.sendCapability !== 'SEND_AUTHORIZED' || !sendScopeGranted(row.provider, scopes))) throw new Error('SEND_SCOPE_REQUIRED');
      const updated = await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId, id } }, data: { sendingEnabled } });
      return { id: updated.id, sendingEnabled: updated.sendingEnabled, sendCapability: updated.sendCapability, live: false };
    }).catch((error: Error) => {
      if (error.message === 'SEND_SCOPE_REQUIRED') throw new ApiException(409, 'SEND_SCOPE_REQUIRED', 'Mailbox send scope is not granted');
      if (error.message === 'NOT_FOUND') throw new ApiException(404, 'NOT_FOUND', 'Mailbox was not found');
      throw error;
    });
  }

  async delivery(actor: SessionContext, id: string) {
    const tenantId = this.actor(actor).tenantId;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const attempt = await tx.mailboxSendAttempt.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!attempt || !(await canAccess(tx, { tenantId, userId: actor.userId }, attempt.connectionId, 'READ'))) throw new Error('NOT_FOUND');
      const events = await tx.mailboxDeliveryEvent.findMany({ where: { tenantId, attemptId: id }, orderBy: { createdAt: 'asc' }, take: 50 });
      const reservation = await tx.emailSendReservation.findFirst({ where: { tenantId, attemptId: id } });
      return { id: attempt.id, state: attempt.state, sent: false, provider: attempt.provider, providerMessageId: attempt.providerMessageId, reconciliation: attempt.reconciliation, acceptanceState: attempt.acceptanceState, reservation: reservation?.state ?? null, events: events.map((item) => ({ kind: item.kind, createdAt: item.createdAt })) };
    }).catch((error: Error) => {
      if (error.message === 'NOT_FOUND') throw new ApiException(404, 'NOT_FOUND', 'Delivery attempt was not found');
      throw error;
    });
  }

  investigate(actor: SessionContext, id: string, note: string) {
    return this.wrap(() => investigateDelivery(this.database.prisma, this.actor(actor), id, note));
  }

  reconcile(actor: SessionContext, id: string) {
    return this.wrap(() => reconcileSend(this.database.prisma, this.actor(actor), id));
  }

  async analyze(actor: SessionContext, body: AnalyzeDto, requestId: string) {
    const run = await this.agents.createRun(actor, {
      triggerType: 'SCAN',
      planKind: 'INBOX_ANALYZE_AND_DRAFT',
      productId: body.productId,
      modelConfigurationId: body.modelConfigurationId,
      threadId: body.threadId,
      goal: 'Summarize this mailbox thread and draft a reply. Do not send.',
    }, requestId);
    return { runId: run.id, state: run.state, externalSend: false };
  }

  async draft(actor: SessionContext, id: string) {
    const tenantId = actor.tenantId;
    if (!tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const draft = await tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!draft || !(await canAccess(tx, { tenantId, userId: actor.userId }, draft.connectionId, 'READ'))) throw new ApiException(404, 'NOT_FOUND', 'Draft was not found');
      const versions = await tx.mailboxDraftVersion.findMany({ where: { tenantId, draftId: id }, orderBy: { version: 'desc' }, take: 10 });
      return {
        id: draft.id,
        connectionId: draft.connectionId,
        threadId: draft.threadId,
        subject: draft.subject,
        body: draft.body,
        recipients: draft.recipients,
        cc: versions[0]?.cc ?? [],
        bcc: versions[0]?.bcc ?? [],
        status: draft.status,
        aiGenerated: draft.aiGenerated,
        versions: versions.map((item) => ({ version: item.version, subject: item.subject, bodySha256: item.bodySha256, runId: item.runId, createdAt: item.createdAt })),
      };
    });
  }

  async drafts(actor: SessionContext, query: MailboxListDto) {
    const tenantId = actor.tenantId;
    if (!tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const access = await tx.mailboxAccess.findMany({ where: { tenantId, userId: actor.userId } });
      const where = { tenantId, connectionId: { in: access.map((item) => item.connectionId) } };
      const [items, total] = await Promise.all([
        tx.mailboxDraft.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        tx.mailboxDraft.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  async deliveries(actor: SessionContext, query: MailboxListDto) {
    const tenantId = actor.tenantId;
    if (!tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const access = await tx.mailboxAccess.findMany({ where: { tenantId, userId: actor.userId } });
      const where = {
        tenantId,
        connectionId: { in: access.map((item) => item.connectionId) },
        ...(query.q ? { OR: [
          { state: { contains: query.q, mode: 'insensitive' as const } },
          { reconciliation: { contains: query.q, mode: 'insensitive' as const } },
          { provider: { contains: query.q, mode: 'insensitive' as const } },
          { acceptanceState: { contains: query.q, mode: 'insensitive' as const } },
        ] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.mailboxSendAttempt.findMany({ where, orderBy: { createdAt: query.sortDirection === 'asc' ? 'asc' : 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        tx.mailboxSendAttempt.count({ where }),
      ]);
      return { items: items.map((item) => ({ id: item.id, state: item.state, sent: false, provider: item.provider, providerMessageId: item.providerMessageId, reconciliation: item.reconciliation, acceptanceState: item.acceptanceState })), total, page, pageSize };
    });
  }

  private actor(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization');
    return { tenantId: actor.tenantId, userId: actor.userId, key: decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY) };
  }

  private async wrap<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'NOT_FOUND' || message === 'FORBIDDEN') throw new ApiException(message === 'FORBIDDEN' ? 403 : 404, message, 'Mailbox action was refused');
      if (message === 'SEPARATION_OF_DUTIES') throw new ApiException(403, 'SEPARATION_OF_DUTIES', 'The draft author cannot approve it');
      if (message === 'NOT_SUBMITTED' || message === 'ALREADY_DECIDED') throw new ApiException(409, message, 'This approval can no longer be decided');
      throw error;
    }
  }
}

@Injectable()
export class MailboxWebhookService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AppConfig) private readonly config: AppConfig) {}

  async receive(provider: string, body: string, signature: string | undefined) {
    if (provider !== 'capture') return { accepted: false, status: 'NOT_CONFIGURED', sent: false };
    if (body.length > 8192) return { accepted: false, status: 'TOO_LARGE', sent: false };
    const gate = captureWebhookStatus(this.config.env);
    if (!gate.enabled) return { accepted: false, status: gate.reason, sent: false };
    if (!webhookAuthentic(gate.secret, body, signature ?? '')) return { accepted: false, status: 'REJECTED', sent: false };
    let parsed: { connectionId?: string; eventId?: string };
    try {
      parsed = JSON.parse(body) as { connectionId?: string; eventId?: string };
    } catch {
      return { accepted: false, status: 'REJECTED', sent: false };
    }
    if (!parsed.connectionId || !parsed.eventId) return { accepted: false, status: 'REJECTED', sent: false };
    const rows = await this.database.prisma.$queryRaw<Array<{ tenant_id: string; connection_id: string }>>`
      SELECT tenant_id, connection_id FROM public.lookup_capture_connection(${parsed.connectionId}::uuid)`.catch(() => []);
    const match = rows[0];
    if (!match) return { accepted: false, status: 'REJECTED', sent: false };
    const recent = await withTenant(this.database.prisma, match.tenant_id, (tx) => tx.mailboxWebhookReceipt.count({
      where: { tenantId: match.tenant_id, connectionId: match.connection_id, createdAt: { gt: new Date(Date.now() - 60_000) } },
    }));
    if (recent >= 20) return { accepted: false, status: 'RATE_LIMIT', sent: false };
    try {
      await withTenant(this.database.prisma, match.tenant_id, (tx) => tx.mailboxWebhookReceipt.create({
        data: { tenantId: match.tenant_id, connectionId: match.connection_id, provider, eventId: parsed.eventId!, payloadSha256: hashState(body) },
      }));
    } catch {
      return { accepted: false, status: 'REPLAY', sent: false };
    }
    return { accepted: true, status: 'RECORDED', sent: false };
  }
}

@Injectable()
export class MailboxHealthService {
  constructor(@Inject(MailboxConnectionService) private readonly connections: MailboxConnectionService) {}

  status() {
    return this.connections.health();
  }
}

export type MailboxAudit = Prisma.InputJsonValue;
