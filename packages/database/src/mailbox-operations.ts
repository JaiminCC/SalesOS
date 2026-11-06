import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { classifyMailboxError } from '@salesos/shared';
import { withTenant } from './with-tenant';

type Actor = { tenantId: string; userId: string; key: Buffer };

export type EvidenceClass = 'STUB_TESTED' | 'CONFIGURED_UNVERIFIED' | 'REAL_READ_VERIFIED' | 'NOT_CONFIGURED';

export function classifyProviderEvidence(input: {
  provider: string;
  fetchImpl?: typeof fetch;
  scopes?: string[];
  identityMatched?: boolean;
  authenticated?: boolean;
  pageCommitted?: boolean;
  fenceOk?: boolean;
  credentialsConfigured?: boolean;
  declaredOrigin?: unknown;
}): EvidenceClass {
  if (input.declaredOrigin !== undefined) return input.fetchImpl && input.fetchImpl !== fetch ? 'STUB_TESTED' : input.credentialsConfigured ? 'CONFIGURED_UNVERIFIED' : 'NOT_CONFIGURED';
  if (input.provider === 'capture') return 'NOT_CONFIGURED';
  if (!input.fetchImpl || input.fetchImpl !== fetch) return 'STUB_TESTED';
  if (!input.credentialsConfigured) return 'NOT_CONFIGURED';
  const scopes = input.scopes ?? [];
  const readOnly = input.provider === 'google'
    ? scopes.some((item) => /gmail\.readonly/i.test(item)) && !scopes.some((item) => /gmail\.send/i.test(item))
    : input.provider === 'microsoft'
      ? scopes.some((item) => /mail\.read/i.test(item)) && !scopes.some((item) => /mail\.send/i.test(item))
      : false;
  const serverRuntime = process.env.NODE_ENV !== 'test' && process.env.CI !== 'true';
  if (serverRuntime && readOnly && input.identityMatched === true && input.authenticated === true && input.pageCommitted === true && input.fenceOk === true) return 'REAL_READ_VERIFIED';
  return 'CONFIGURED_UNVERIFIED';
}

export function credentialsConfigured(provider: string): boolean {
  if (provider === 'google') return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (provider === 'microsoft') return Boolean(process.env.MICROSOFT_OAUTH_CLIENT_ID && process.env.MICROSOFT_OAUTH_CLIENT_SECRET);
  return false;
}

export function fingerprintCursor(value: string | null | undefined): string {
  if (!value) return 'none';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function healthFor(provider: string, status: string, error: string | null): string {
  if (provider === 'capture') return 'CAPTURE';
  if (status === 'DISCONNECTED') return 'DISCONNECTED';
  if (status === 'PAUSED') return 'DEGRADED';
  if (error === 'RATE_LIMIT' || status === 'RATE_LIMIT') return 'RATE_LIMITED';
  if (error === 'TOKEN_REFRESH_FAILED' || error === 'REFRESH_MISSING' || error === 'TOKEN_MISSING') return 'REAUTH_REQUIRED';
  if (error === 'IDENTITY_MISMATCH') return 'IDENTITY_MISMATCH';
  if (error === 'CURSOR_RECOVERED' || status === 'CURSOR_RECOVERED') return 'CURSOR_EXPIRED';
  if (status === 'SYNC_PARTIAL') return 'SYNC_DELAYED';
  if (status === 'STUB_SYNCED') return 'LOCAL_TEST_HEALTHY';
  if (status === 'SYNCED') return 'HEALTHY';
  if (status === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  return 'DEGRADED';
}

function operationLabel(provider: string, health: string): string {
  if (provider === 'capture') return 'MOCK / CAPTURE MODE';
  if (health === 'LOCAL_TEST_HEALTHY') return 'LOCAL TEST — NOT LIVE';
  if (health === 'SYNC_DELAYED') return 'PARTIAL — NOT COMPLETE';
  if (health === 'CURSOR_EXPIRED') return 'CURSOR RECOVERED — NOT CURRENT';
  if (health === 'RATE_LIMITED') return 'RATE LIMITED';
  if (health === 'HEALTHY') return 'LIVE READ HEALTHY';
  return health;
}

function metric(name: string, provider: string, code: string): void {
  console.info(JSON.stringify({ metric: name, provider, code }));
}

export async function observeMailboxSync(prisma: PrismaClient, actor: Actor, input: {
  connectionId: string;
  provider: string;
  status: string;
  error?: string | null;
  imported: number;
  duplicates: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  rateLimited?: boolean;
  leaseVersion?: number;
  fetchImpl?: typeof fetch;
  startedAt: number;
  readScope?: string;
  identityMatched?: boolean;
  scopes?: string[];
  authenticated?: boolean;
  pageCommitted?: boolean;
  fenceOk?: boolean;
}): Promise<void> {
  const traceId = randomUUID();
  const classified = input.error || input.status === 'SYNC_ERROR' || input.status === 'RATE_LIMIT' ? classifyMailboxError({ message: input.error ?? input.status }) : null;
  const nextHealth = healthFor(input.provider, input.status, input.error ?? null);
  const origin = classifyProviderEvidence({
    provider: input.provider,
    fetchImpl: input.fetchImpl,
    scopes: input.scopes,
    identityMatched: input.identityMatched,
    authenticated: input.authenticated,
    pageCommitted: input.pageCommitted,
    fenceOk: input.fenceOk,
    credentialsConfigured: credentialsConfigured(input.provider),
  });
  const storedPage = input.status === 'SYNCED' || input.status === 'STUB_SYNCED' || input.status === 'SYNC_PARTIAL';
  const outcome = storedPage ? origin : 'FAILED';
  await withTenant(prisma, actor.tenantId, async (tx) => {
    const connection = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.connectionId } } });
    if (!connection) return;
    const previous = connection.healthState;
    if (previous !== nextHealth) {
      await tx.mailboxHealthEvent.create({
        data: { tenantId: actor.tenantId, connectionId: input.connectionId, provider: input.provider, previousState: previous, nextState: nextHealth, reason: classified?.code ?? input.status, traceId, evidence: { status: input.status, imported: input.imported } },
      });
    }
    await tx.mailboxConnection.updateMany({
      where: { tenantId: actor.tenantId, id: input.connectionId, status: { not: 'DISCONNECTED' } },
      data: { healthState: nextHealth },
    });
    const before = fingerprintCursor(input.cursorBefore);
    const after = fingerprintCursor(input.cursorAfter);
    await tx.mailboxSyncRun.create({
      data: {
        tenantId: actor.tenantId,
        connectionId: input.connectionId,
        provider: input.provider,
        jobType: 'mailbox.incremental_sync',
        triggerSource: 'worker',
        startedAt: new Date(input.startedAt),
        finishedAt: new Date(),
        workerId: String(process.pid),
        leaseVersion: input.leaseVersion ?? 0,
        pagesFetched: 1,
        insertedCount: input.imported,
        updatedCount: 0,
        duplicatesSkipped: input.duplicates,
        cursorBefore: before,
        cursorAfter: after,
        retryCount: 0,
        rateLimited: input.rateLimited === true,
        errorCode: classified?.code ?? null,
        state: input.status === 'SYNC_PARTIAL' ? 'PAGE_STORED' : storedPage ? 'COMPLETED' : input.status === 'CURSOR_RECOVERED' ? 'CURSOR_RECOVERED' : input.status === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'FAILED',
        traceId,
      },
    });
    if (classified) {
      await tx.mailboxProviderError.create({
        data: { tenantId: actor.tenantId, connectionId: input.connectionId, provider: input.provider, code: classified.code, httpStatus: null, retryable: classified.retryable, severity: classified.severity, action: classified.action, traceId },
      });
      const dedupeKey = `${input.connectionId}:${classified.code}`;
      const open = await tx.mailboxOperationalAlert.findFirst({ where: { tenantId: actor.tenantId, dedupeKey, state: 'OPEN' } });
      if (!open) {
        await tx.mailboxOperationalAlert.create({
          data: { tenantId: actor.tenantId, connectionId: input.connectionId, code: classified.code, severity: classified.severity, dedupeKey, traceId },
        }).catch(() => undefined);
      }
    }
    await tx.mailboxProviderVerification.create({
      data: {
        tenantId: actor.tenantId,
        connectionId: input.connectionId,
        provider: input.provider,
        origin,
        outcome,
        readScope: input.readScope ?? 'unknown',
        identityMatched: input.identityMatched === true,
        pageCount: 1,
        insertedCount: input.imported,
        duplicateCount: input.duplicates,
        cursorChanged: before !== after,
        durationMs: Date.now() - input.startedAt,
        traceId,
        failureReason: classified?.code ?? null,
      },
    });
  });
  metric(storedPage ? 'mailbox_sync_completed' : 'mailbox_sync_failed', input.provider, classified?.code ?? input.status);
  if (input.rateLimited) metric('mailbox_provider_rate_limited', input.provider, 'RATE_LIMIT');
  if (input.status === 'CURSOR_RECOVERED') metric('mailbox_cursor_recovered', input.provider, 'CURSOR_EXPIRED');
}

async function accessibleIds(tx: { mailboxAccess: { findMany: (args: { where: { tenantId: string; userId: string } }) => Promise<Array<{ connectionId: string }>> } }, tenantId: string, userId: string): Promise<string[]> {
  const access = await tx.mailboxAccess.findMany({ where: { tenantId, userId } });
  return access.map((item) => item.connectionId);
}

export async function operationsOverview(prisma: PrismaClient, actor: Actor): Promise<Record<string, number | string | boolean>> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const connections = ids.length ? await tx.mailboxConnection.findMany({ where: { tenantId: actor.tenantId, id: { in: ids } } }) : [];
    const day = new Date();
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const runs = ids.length ? await tx.mailboxSyncRun.findMany({ where: { tenantId: actor.tenantId, connectionId: { in: ids }, createdAt: { gte: dayStart } } }) : [];
    const verified = ids.length ? await tx.mailboxProviderVerification.count({ where: { tenantId: actor.tenantId, connectionId: { in: ids }, origin: 'REAL_READ_VERIFIED' } }) : 0;
    const uncertain = ids.length ? await tx.emailSendReservation.count({ where: { tenantId: actor.tenantId, connectionId: { in: ids }, state: 'UNCERTAIN' } }) : 0;
    const live = connections.filter((item) => item.provider !== 'capture');
    return {
      mailboxes: connections.length,
      capture: connections.filter((item) => item.provider === 'capture').length,
      healthy: live.filter((item) => item.healthState === 'HEALTHY').length,
      degraded: live.filter((item) => item.healthState === 'DEGRADED' || item.healthState === 'SYNC_DELAYED').length,
      reauth: live.filter((item) => item.healthState === 'REAUTH_REQUIRED').length,
      neverSynced: live.filter((item) => !item.lastSyncAt).length,
      syncsCompletedToday: runs.filter((item) => item.state === 'COMPLETED' || item.state === 'PAGE_STORED').length,
      failedSyncs: runs.filter((item) => item.state === 'FAILED').length,
      retriedSyncs: runs.filter((item) => item.retryCount > 0).length,
      cursorRecoveries: runs.filter((item) => item.state === 'CURSOR_RECOVERED').length,
      messagesImported: runs.reduce((sum, item) => sum + item.insertedCount, 0),
      duplicatesSkipped: runs.reduce((sum, item) => sum + item.duplicatesSkipped, 0),
      throttled: runs.filter((item) => item.rateLimited).length,
      uncertainDeliveries: uncertain,
      liveReadVerified: verified,
      sendingEnabled: false,
    };
  });
}

export async function listOperationalConnections(prisma: PrismaClient, actor: Actor, query: { q?: string; page?: number; pageSize?: number; sortBy?: string; sortDirection?: 'asc' | 'desc' }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const direction = query.sortDirection === 'asc' ? 'asc' : 'desc';
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const where = { tenantId: actor.tenantId, id: { in: ids }, ...(query.q ? { address: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [rows, total] = await Promise.all([
      tx.mailboxConnection.findMany({ where, orderBy: query.sortBy === 'address' ? { address: direction } : { updatedAt: direction }, skip: (page - 1) * pageSize, take: pageSize }),
      tx.mailboxConnection.count({ where }),
    ]);
    const verified = await tx.mailboxProviderVerification.findMany({ where: { tenantId: actor.tenantId, connectionId: { in: rows.map((item) => item.id) } }, orderBy: { createdAt: 'desc' } });
    return {
      items: rows.map((item) => {
        const evidence = verified.find((row) => row.connectionId === item.id);
        const health = item.provider === 'capture' ? 'CAPTURE' : item.healthState;
        return { id: item.id, connectionId: item.id, address: item.address, provider: item.provider, status: item.status, health, live: false, paused: item.syncPaused, verification: evidence?.origin ?? 'NONE', label: operationLabel(item.provider, health) };
      }),
      total,
      page,
      pageSize,
    };
  });
}

export async function operationalConnection(prisma: PrismaClient, actor: Actor, connectionId: string): Promise<Record<string, unknown> | null> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    if (!ids.includes(connectionId)) return null;
    const item = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!item) return null;
    const runs = await tx.mailboxSyncRun.findMany({ where: { tenantId: actor.tenantId, connectionId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const health = await tx.mailboxHealthEvent.findMany({ where: { tenantId: actor.tenantId, connectionId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const errors = await tx.mailboxProviderError.findMany({ where: { tenantId: actor.tenantId, connectionId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const verification = await tx.mailboxProviderVerification.findFirst({ where: { tenantId: actor.tenantId, connectionId }, orderBy: { createdAt: 'desc' } });
    return {
      id: item.id,
      address: item.address,
      provider: item.provider,
      status: item.status,
      health: item.provider === 'capture' ? 'CAPTURE' : item.healthState,
      label: operationLabel(item.provider, item.provider === 'capture' ? 'CAPTURE' : item.healthState),
      live: false,
      paused: item.syncPaused,
      sendingEnabled: false,
      verification: verification ? { origin: verification.origin, outcome: verification.outcome, readScope: verification.readScope, identityMatched: verification.identityMatched, insertedCount: verification.insertedCount, duplicateCount: verification.duplicateCount, cursorChanged: verification.cursorChanged } : null,
      runs: runs.map((run) => ({ id: run.id, state: run.state, provider: run.provider, inserted: run.insertedCount, duplicates: run.duplicatesSkipped, cursorBefore: run.cursorBefore, cursorAfter: run.cursorAfter, error: run.errorCode, createdAt: run.createdAt })),
      healthEvents: health.map((event) => ({ previous: event.previousState, next: event.nextState, reason: event.reason, createdAt: event.createdAt })),
      errors: errors.map((error) => ({ code: error.code, action: error.action, severity: error.severity, retryable: error.retryable, createdAt: error.createdAt })),
    };
  });
}

export async function listSyncRuns(prisma: PrismaClient, actor: Actor, query: { q?: string; page?: number; pageSize?: number; sortDirection?: 'asc' | 'desc' }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const direction = query.sortDirection === 'asc' ? 'asc' : 'desc';
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const where = { tenantId: actor.tenantId, connectionId: { in: ids }, ...(query.q ? { OR: [{ state: { contains: query.q, mode: 'insensitive' as const } }, { provider: { contains: query.q, mode: 'insensitive' as const } }, { errorCode: { contains: query.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await Promise.all([
      tx.mailboxSyncRun.findMany({ where, orderBy: { createdAt: direction }, skip: (page - 1) * pageSize, take: pageSize }),
      tx.mailboxSyncRun.count({ where }),
    ]);
    return { items: items.map((item) => ({ id: item.id, connectionId: item.connectionId, state: item.state, provider: item.provider, inserted: item.insertedCount, duplicates: item.duplicatesSkipped, error: item.errorCode, label: item.state, createdAt: item.createdAt })), total, page, pageSize };
  });
}

export async function listProviderErrors(prisma: PrismaClient, actor: Actor, query: { q?: string; page?: number; pageSize?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const where = { tenantId: actor.tenantId, connectionId: { in: ids }, ...(query.q ? { code: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([
      tx.mailboxProviderError.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      tx.mailboxProviderError.count({ where }),
    ]);
    return { items: items.map((item) => ({ id: item.id, connectionId: item.connectionId, state: item.code, provider: item.provider, label: item.action, severity: item.severity, createdAt: item.createdAt })), total, page, pageSize };
  });
}

export async function listOperationalAlerts(prisma: PrismaClient, actor: Actor, query: { q?: string; page?: number; pageSize?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const where = { tenantId: actor.tenantId, connectionId: { in: ids }, ...(query.q ? { code: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([
      tx.mailboxOperationalAlert.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      tx.mailboxOperationalAlert.count({ where }),
    ]);
    return { items: items.map((item) => ({ id: item.id, connectionId: item.connectionId, state: item.state, code: item.code, severity: item.severity, label: `${item.code} ${item.state}`, createdAt: item.createdAt })), total, page, pageSize };
  });
}

export async function acknowledgeOperationalAlert(prisma: PrismaClient, actor: Actor, alertId: string): Promise<{ state: string }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    const alert = await tx.mailboxOperationalAlert.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: alertId } } });
    if (!alert || !ids.includes(alert.connectionId)) throw new Error('NOT_FOUND');
    await tx.mailboxOperationalAlert.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: alertId } }, data: { state: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: actor.userId } });
    await tx.mailboxHealthEvent.create({ data: { tenantId: actor.tenantId, connectionId: alert.connectionId, provider: 'operations', previousState: 'OPEN', nextState: 'ACKNOWLEDGED', reason: 'ALERT_ACKNOWLEDGED', traceId: alert.traceId, evidence: { code: alert.code } } });
    return { state: 'ACKNOWLEDGED' };
  });
}

export async function setMailboxSyncPaused(prisma: PrismaClient, actor: Actor, connectionId: string, paused: boolean): Promise<{ paused: boolean; sendingEnabled: false }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    if (!ids.includes(connectionId)) throw new Error('NOT_FOUND');
    const current = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!current || current.status === 'DISCONNECTED') throw new Error('NOT_FOUND');
    await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } }, data: { syncPaused: paused, healthState: paused ? 'DEGRADED' : current.healthState, sendingEnabled: false } });
    await tx.mailboxHealthEvent.create({ data: { tenantId: actor.tenantId, connectionId, provider: current.provider, previousState: current.healthState, nextState: paused ? 'DEGRADED' : current.healthState, reason: paused ? 'SYNC_PAUSED' : 'SYNC_RESUMED', traceId: randomUUID(), evidence: { paused } } });
    return { paused, sendingEnabled: false as const };
  });
}

export async function recoverMailboxCursor(prisma: PrismaClient, actor: Actor, connectionId: string): Promise<{ status: string; sent: false }> {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const ids = await accessibleIds(tx, actor.tenantId, actor.userId);
    if (!ids.includes(connectionId)) throw new Error('NOT_FOUND');
    const current = await tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } } });
    if (!current || current.provider === 'capture' || current.status === 'DISCONNECTED') throw new Error('NOT_FOUND');
    if (current.healthState !== 'CURSOR_EXPIRED' && current.lastError !== 'CURSOR_RECOVERED') throw new Error('NOT_RECOVERABLE');
    const cursor = JSON.stringify({ token: null, pending: [], historyId: null, mode: current.provider === 'google' ? 'list' : 'delta', backfillRemaining: 2 });
    await tx.mailboxSyncCursor.upsert({
      where: { tenantId_connectionId: { tenantId: actor.tenantId, connectionId } },
      create: { tenantId: actor.tenantId, connectionId, cursor },
      update: { cursor },
    });
    await tx.mailboxConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connectionId } }, data: { healthState: 'CURSOR_EXPIRED', lastError: 'CURSOR_RECOVERED', status: 'CURSOR_RECOVERED', sendingEnabled: false, live: false } });
    await tx.mailboxSyncRun.create({
      data: { tenantId: actor.tenantId, connectionId, provider: current.provider, jobType: 'mailbox.cursor_recovery', triggerSource: 'operator', startedAt: new Date(), finishedAt: new Date(), workerId: String(process.pid), state: 'CURSOR_RECOVERED', traceId: randomUUID(), cursorBefore: 'redacted', cursorAfter: fingerprintCursor(cursor) },
    });
    await tx.mailboxHealthEvent.create({ data: { tenantId: actor.tenantId, connectionId, provider: current.provider, previousState: current.healthState, nextState: 'CURSOR_EXPIRED', reason: 'CURSOR_RECOVERY', traceId: randomUUID(), evidence: { sent: false } } });
    return { status: 'CURSOR_RECOVERED', sent: false as const };
  });
}
