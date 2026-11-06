import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { acknowledgeOperationalAlert, createPrismaClient, encryptToken, revokeMailboxConnection, syncConnection, withTenant } from '@salesos/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_URL_WORKER;
const encryptionKey = process.env.DATA_ENCRYPTION_KEY;

describe.skipIf(!adminUrl || !workerUrl || !encryptionKey)('mailbox sync kill recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const tenantId = randomUUID();
  const userId = randomUUID();
  let server: Server;
  let port = 0;
  let holds = 0;

  beforeAll(async () => {
    await admin.tenant.create({ data: { id: tenantId, name: `Kill ${tenantId.slice(0, 8)}`, slug: `kill-${tenantId.slice(0, 8)}` } });
    await admin.user.create({ data: { id: userId, emailHmac: randomUUID(), emailCiphertext: Buffer.from([1]), displayName: 'Kill', status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.connect' } });
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
    server = createServer((request, response) => {
      if (request.url === '/hold') {
        holds += 1;
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
    await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await worker.$disconnect();
    await admin.$disconnect();
  });

  it('keeps stub pages, partial pages, and rate limits out of a live synced state', async () => {
    const limited = await google();
    const limitedResult = await syncConnection(worker, actor(), limited.id, (async () => new Response('', { status: 429, headers: { 'retry-after': '1' } })) as typeof fetch);
    expect(limitedResult.status).toBe('RATE_LIMIT');
    const limitedRow = await connection(limited.id);
    expect(limitedRow?.status).toBe('RATE_LIMIT');
    expect(limitedRow?.healthState).toBe('RATE_LIMITED');
    expect(limitedRow?.status).not.toBe('SYNCED');
    const alert = await admin.mailboxOperationalAlert.findFirst({ where: { tenantId, connectionId: limited.id, code: 'RATE_LIMIT' } });
    expect(alert?.state).toBe('OPEN');
    expect((await acknowledgeOperationalAlert(worker, actor(), alert!.id)).state).toBe('ACKNOWLEDGED');

    const partial = await google();
    const partialResult = await syncConnection(worker, actor(), partial.id, gmailFixture(true));
    expect(partialResult.status).toBe('SYNC_PARTIAL');
    const partialRow = await connection(partial.id);
    expect(partialRow?.healthState).toBe('SYNC_DELAYED');
    expect(partialRow?.status).not.toBe('SYNCED');
    const run = await admin.mailboxSyncRun.findFirst({ where: { tenantId, connectionId: partial.id }, orderBy: { createdAt: 'desc' } });
    expect(run?.cursorAfter).not.toContain('page-2');
    expect(run?.state).toBe('PAGE_STORED');

    const recovered = await google();
    await admin.mailboxSyncCursor.create({ data: { tenantId, connectionId: recovered.id, cursor: JSON.stringify({ token: null, pending: [], historyId: 'old', mode: 'history' }) } });
    const recovery = await syncConnection(worker, actor(), recovered.id, (async () => new Response('missing', { status: 404 })) as typeof fetch);
    expect(recovery.status).toBe('CURSOR_RECOVERED');
    const recoveredRow = await connection(recovered.id);
    expect(recoveredRow?.status).toBe('CURSOR_RECOVERED');
    expect(recoveredRow?.healthState).toBe('CURSOR_EXPIRED');
    expect(recoveredRow?.live).toBe(false);
  });

  it('kills the worker around the provider read and keeps one committed page', async () => {
    const duringHttp = await google();
    const httpChild = spawnChild(duringHttp.id, 'during-http');
    const httpHolds = holds;
    await waitFor(() => holds > httpHolds);
    httpChild.kill('SIGKILL');
    await once(httpChild, 'close');
    expect(await messages(duringHttp.id)).toBe(0);
    await expire(duringHttp.id);
    expect((await syncConnection(worker, actor(), duringHttp.id, gmailFixture(false))).imported).toBe(1);
    expect(await messages(duringHttp.id)).toBe(1);

    const beforeWrite = await google();
    await killChild(beforeWrite.id, 'after-response');
    expect(await messages(beforeWrite.id)).toBe(0);
    expect((await connection(beforeWrite.id))?.status).not.toBe('SYNCED');

    const duringCommit = await google();
    await killChild(duringCommit.id, 'during-commit');
    expect(await messages(duringCommit.id)).toBe(0);
    expect(await admin.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId, connectionId: duringCommit.id } } })).toBeNull();
    await expire(duringCommit.id);
    expect((await syncConnection(worker, actor(), duringCommit.id, gmailFixture(false))).imported).toBe(1);

    const afterCommit = await google();
    await killChild(afterCommit.id, 'after-commit');
    expect(await messages(afterCommit.id)).toBe(1);
    expect(await admin.mailboxProviderVerification.count({ where: { tenantId, connectionId: afterCommit.id } })).toBe(0);
    expect((await syncConnection(worker, actor(), afterCommit.id, gmailFixture(false))).imported).toBe(0);
    expect(await messages(afterCommit.id)).toBe(1);
    expect((await admin.mailboxProviderVerification.findFirst({ where: { tenantId, connectionId: afterCommit.id } }))?.origin).toBe('STUB_TESTED');

    const replaced = await google();
    await killChild(replaced.id, 'provider');
    await expire(replaced.id);
    expect((await syncConnection(worker, actor(), replaced.id, gmailFixture(false))).imported).toBe(1);
    expect((await syncConnection(worker, actor(), replaced.id, gmailFixture(false))).imported).toBe(0);

    const leader = await google();
    const first = spawnChild(leader.id, 'during-http');
    const leaderHolds = holds;
    await waitFor(() => holds > leaderHolds);
    const second = spawnChild(leader.id, 'after-response');
    await once(second, 'close');
    expect(await messages(leader.id)).toBe(0);
    first.kill('SIGKILL');
    await once(first, 'close');
    await expire(leader.id);
    expect((await syncConnection(worker, actor(), leader.id, gmailFixture(false))).imported).toBe(1);

    const disconnected = await google();
    const disconnecting = spawnChild(disconnected.id, 'during-http');
    const disconnectHolds = holds;
    await waitFor(() => holds > disconnectHolds);
    await revokeMailboxConnection(admin, tenantId, disconnected.id);
    disconnecting.kill('SIGKILL');
    await once(disconnecting, 'close');
    expect(await messages(disconnected.id)).toBe(0);
    expect((await connection(disconnected.id))?.status).toBe('DISCONNECTED');

    const suspended = await google();
    await killChild(suspended.id, 'after-response');
    await expire(suspended.id);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect((await syncConnection(worker, actor(), suspended.id, gmailFixture(false))).stopped).toBe('suspended');
    expect(await messages(suspended.id)).toBe(0);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const forbidden = await google();
    await killChild(forbidden.id, 'after-response');
    await expire(forbidden.id);
    await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'mailbox.connect' } });
    expect((await syncConnection(worker, actor(), forbidden.id, gmailFixture(false))).stopped).toBe('forbidden');
    expect(await messages(forbidden.id)).toBe(0);
    const role = await admin.role.findFirstOrThrow({ where: { tenantId, name: 'OWNER' } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.connect' } });

    const refreshing = await google({ tokenExpiresAt: new Date(0), refreshTokenCiphertext: Uint8Array.from(encryptToken('refresh', Buffer.from(encryptionKey as string, 'base64'))) });
    const refreshChild = spawnChild(refreshing.id, 'during-refresh');
    const refreshHolds = holds;
    await waitFor(() => holds > refreshHolds);
    await revokeMailboxConnection(admin, tenantId, refreshing.id);
    refreshChild.kill('SIGKILL');
    await once(refreshChild, 'close');
    const cleared = await connection(refreshing.id);
    expect(cleared?.accessTokenCiphertext).toBeNull();
    expect(await messages(refreshing.id)).toBe(0);

    const gmailCursor = await google();
    await admin.mailboxSyncCursor.create({ data: { tenantId, connectionId: gmailCursor.id, cursor: JSON.stringify({ token: null, pending: [], historyId: 'stale', mode: 'history' }) } });
    await killChild(gmailCursor.id, 'during-recovery');
    expect((await admin.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId, connectionId: gmailCursor.id } } }))?.cursor).toContain('stale');
    await expire(gmailCursor.id);
    expect((await syncConnection(worker, actor(), gmailCursor.id, (async () => new Response('missing', { status: 404 })) as typeof fetch)).status).toBe('CURSOR_RECOVERED');
    expect(await messages(gmailCursor.id)).toBe(0);

    const graphCursor = await google({ provider: 'microsoft' });
    await admin.mailboxSyncCursor.create({ data: { tenantId, connectionId: graphCursor.id, cursor: JSON.stringify({ token: 'https://evil.example/delta', pending: [], historyId: null, mode: 'delta' }) } });
    await killChild(graphCursor.id, 'graph-recovery');
    expect((await admin.mailboxSyncCursor.findUnique({ where: { tenantId_connectionId: { tenantId, connectionId: graphCursor.id } } }))?.cursor).toContain('evil.example');
    await expire(graphCursor.id);
    expect((await syncConnection(worker, actor(), graphCursor.id, (async () => new Response('missing', { status: 410 })) as typeof fetch)).status).toBe('CURSOR_RECOVERED');
    expect((await connection(graphCursor.id))?.status).not.toBe('SYNCED');
    expect(await admin.mailboxSendAttempt.count({ where: { tenantId } })).toBe(0);
  }, 90_000);

  function actor() {
    return { tenantId, userId, key: Buffer.from(encryptionKey as string, 'base64') };
  }

  async function google(extra: { tokenExpiresAt?: Date; refreshTokenCiphertext?: Uint8Array<ArrayBuffer>; provider?: string } = {}) {
    const row = await admin.mailboxConnection.create({
      data: {
        tenantId,
        provider: extra.provider ?? 'google',
        providerMailboxId: randomUUID(),
        address: `${randomUUID()}@example.com`,
        connectedBy: userId,
        status: 'CONFIGURED_UNVERIFIED',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        live: false,
        sendingEnabled: false,
        accessTokenCiphertext: Uint8Array.from(encryptToken('token', Buffer.from(encryptionKey as string, 'base64'))),
        tokenExpiresAt: extra.tokenExpiresAt,
        refreshTokenCiphertext: extra.refreshTokenCiphertext,
      },
    });
    await admin.mailboxAccess.create({ data: { tenantId, connectionId: row.id, userId, accessRole: 'READ' } });
    return row;
  }

  function connection(id: string) {
    return admin.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id } } });
  }

  function messages(connectionId: string) {
    return withTenant(admin, tenantId, (tx) => tx.mailboxMessage.count({ where: { tenantId, connectionId } }));
  }

  function expire(connectionId: string) {
    return admin.$executeRaw`UPDATE public.crm_work_leases SET lease_until = pg_catalog.now() - interval '1 second' WHERE tenant_id = ${tenantId}::uuid AND record_id = ${connectionId}::uuid`;
  }

  function spawnChild(connectionId: string, kind: string): ChildProcess {
    return spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/mailbox-crash.ts'), tenantId, connectionId, kind], {
      cwd: process.cwd(),
      env: { ...process.env, SALESOS_MAILBOX_USER: userId, SALESOS_MAILBOX_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function killChild(connectionId: string, kind: string): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawnChild(connectionId, kind);
      let output = '';
      let seen = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        fail(new Error(output || 'checkpoint timed out'));
      }, 20000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (!seen && output.includes('checkpoint')) {
          seen = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('close', () => {
        if (seen) done();
        else fail(new Error(output || 'worker exited before the checkpoint'));
      });
    });
  }
});

function gmailFixture(partial: boolean): typeof fetch {
  return (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/users/me/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'page-1', threadId: 'thread-1' }], ...(partial ? { nextPageToken: 'page-2' } : {}) }), { status: 200 });
    if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '9' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'page-1', threadId: 'thread-1', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Message-ID', value: '<page-1@example>' }], body: { data: Buffer.from('Hello').toString('base64url') } } }), { status: 200 });
  }) as typeof fetch;
}

function once(child: ChildProcess, event: 'close'): Promise<void> {
  return new Promise((resolve) => child.once(event, () => resolve()));
}

async function waitFor(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 15000) throw new Error('timed out waiting for the provider fixture');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
