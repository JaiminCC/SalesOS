import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createPrismaClient, encryptToken, revokeMailboxConnection, syncConnection, syncMailbox, withTenant } from '@salesos/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_URL_WORKER;
const encryptionKey = process.env.DATA_ENCRYPTION_KEY;

describe.skipIf(!adminUrl || !workerUrl || !encryptionKey)('mailbox process recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const tenantId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    await admin.tenant.create({ data: { id: tenantId, name: `Mail ${tenantId.slice(0, 8)}`, slug: `mail-${tenantId.slice(0, 8)}` } });
    await admin.user.create({ data: { id: userId, emailHmac: randomUUID(), emailCiphertext: Buffer.from([1]), displayName: 'Mail', status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.connect' } });
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
  });

  afterAll(async () => {
    await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await worker.$disconnect();
    await admin.$disconnect();
  });

  it('recovers a killed mailbox sync without duplicating messages', async () => {
    const connectionId = await queue(['m-a', 'm-b']);
    await killAfterCheckpoint(tenantId, userId, connectionId);
    expect(await messageCount(connectionId)).toBe(1);
    await expire(connectionId);
    const finished = await syncMailbox(worker, actor(), connectionId);
    expect(finished.stopped).toBeUndefined();
    expect(await messageCount(connectionId)).toBe(2);
    await syncMailbox(worker, actor(), connectionId);
    expect(await messageCount(connectionId)).toBe(2);
  });

  it('stops a suspended or unauthorized mailbox sync', async () => {
    const suspended = await queue(['s-a', 's-b']);
    await killAfterCheckpoint(tenantId, userId, suspended);
    await expire(suspended);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect((await syncMailbox(worker, actor(), suspended)).stopped).toBe('suspended');
    expect(await messageCount(suspended)).toBe(1);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const revoked = await queue(['r-a', 'r-b']);
    await killAfterCheckpoint(tenantId, userId, revoked);
    await expire(revoked);
    await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'mailbox.connect' } });
    expect((await syncMailbox(worker, actor(), revoked)).stopped).toBe('forbidden');
    expect(await messageCount(revoked)).toBe(1);
    const role = await admin.role.findFirstOrThrow({ where: { tenantId, name: 'OWNER' } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.connect' } });
  });

  it('resumes a killed provider read without calling the provider twice for stored mail', async () => {
    const connection = await admin.mailboxConnection.create({
      data: {
        tenantId,
        provider: 'google',
        providerMailboxId: randomUUID(),
        address: `${randomUUID()}@example.com`,
        connectedBy: userId,
        status: 'CONFIGURED_UNVERIFIED',
        scopes: ['READ'],
        live: false,
        sendingEnabled: false,
        accessTokenCiphertext: Uint8Array.from(encryptToken('token', Buffer.from(encryptionKey as string, 'base64'))),
      },
    });
    await admin.mailboxAccess.create({ data: { tenantId, connectionId: connection.id, userId, accessRole: 'SEND' } });
    await killAfterCheckpoint(tenantId, userId, connection.id, 'provider');
    expect(await messageCount(connection.id)).toBe(0);
    const held = await syncConnection(worker, { tenantId, userId, key: Buffer.from(encryptionKey as string, 'base64') }, connection.id, (async () => new Response('{}', { status: 200 })) as typeof fetch);
    expect(held.held).toBe(true);
    await expire(connection.id);
    const fetchImpl = (async (input: URL | string) => {
      const url = String(input);
      if (url.includes('/users/me/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }), { status: 200 });
      if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '9' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Message-ID', value: '<m1@example>' }], body: { data: Buffer.from('Hello').toString('base64url') } } }), { status: 200 });
    }) as typeof fetch;
    const finished = await syncConnection(worker, { tenantId, userId, key: Buffer.from(encryptionKey as string, 'base64') }, connection.id, fetchImpl);
    expect(finished.imported).toBe(1);
    const evidence = await admin.mailboxProviderVerification.findFirst({ where: { tenantId, connectionId: connection.id } });
    expect(evidence?.origin).toBe('STUB_TESTED');
    expect(evidence?.origin).not.toBe('REAL_READ_VERIFIED');
    const stored = await admin.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: connection.id } } });
    expect(stored?.healthState).toBe('LOCAL_TEST_HEALTHY');
    expect(stored?.status).toBe('STUB_SYNCED');
    expect(stored?.live).toBe(false);
    expect(stored?.sendingEnabled).toBe(false);
    const again = await syncConnection(worker, { tenantId, userId, key: Buffer.from(encryptionKey as string, 'base64') }, connection.id, fetchImpl);
    expect(again.imported).toBe(0);
    expect(await messageCount(connection.id)).toBe(1);
  });

  it('drops a provider page when authorization changes during the read', async () => {
    const disconnected = await googleConnection();
    const disconnectGate = hold();
    const disconnecting = syncConnection(worker, providerActor(), disconnected.id, pausingRead(disconnectGate));
    await disconnectGate.started;
    await revokeMailboxConnection(admin, tenantId, disconnected.id);
    disconnectGate.release();
    expect((await disconnecting).stopped).toBe('revoked');
    expect(await messageCount(disconnected.id)).toBe(0);
    expect((await admin.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: disconnected.id } } }))?.status).toBe('DISCONNECTED');

    const suspended = await googleConnection();
    const suspendGate = hold();
    const suspending = syncConnection(worker, providerActor(), suspended.id, pausingRead(suspendGate));
    await suspendGate.started;
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    suspendGate.release();
    expect((await suspending).stopped).toBe('suspended');
    expect(await messageCount(suspended.id)).toBe(0);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const revoked = await googleConnection();
    const revokeGate = hold();
    const revoking = syncConnection(worker, providerActor(), revoked.id, pausingRead(revokeGate));
    await revokeGate.started;
    await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'mailbox.connect' } });
    revokeGate.release();
    expect((await revoking).stopped).toBe('forbidden');
    expect(await messageCount(revoked.id)).toBe(0);
    const role = await admin.role.findFirstOrThrow({ where: { tenantId, name: 'OWNER' } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'mailbox.connect' } });

    const replaced = await googleConnection();
    const replaceGate = hold();
    const first = syncConnection(worker, providerActor(), replaced.id, pausingRead(replaceGate));
    await replaceGate.started;
    await expire(replaced.id);
    const second = await syncConnection(worker, providerActor(), replaced.id, gmailPage('replacement'));
    replaceGate.release();
    expect((await first).stopped).toBe('revoked');
    expect(second.imported).toBe(1);
    expect(await messageCount(replaced.id)).toBe(1);

    const refreshing = await googleConnection({ tokenExpiresAt: new Date(0), refreshTokenCiphertext: Uint8Array.from(encryptToken('refresh', Buffer.from(encryptionKey as string, 'base64'))) });
    const refreshGate = hold();
    const refresh = syncConnection(worker, providerActor(), refreshing.id, pausingRefresh(refreshGate));
    await refreshGate.started;
    await revokeMailboxConnection(admin, tenantId, refreshing.id);
    refreshGate.release();
    expect((await refresh).stopped).toBe('revoked');
    expect(await messageCount(refreshing.id)).toBe(0);
    const cleared = await admin.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: refreshing.id } } });
    expect(cleared?.accessTokenCiphertext).toBeNull();
    expect(cleared?.refreshTokenCiphertext).toBeNull();

    const duplicate = await googleConnection();
    const duplicateGate = hold();
    const leader = syncConnection(worker, providerActor(), duplicate.id, pausingRead(duplicateGate));
    await duplicateGate.started;
    expect((await syncConnection(worker, providerActor(), duplicate.id, gmailPage('duplicate'))).held).toBe(true);
    duplicateGate.release();
    expect((await leader).imported).toBe(1);
    expect(await messageCount(duplicate.id)).toBe(1);

    const mismatch = await googleConnection();
    const mismatched = await syncConnection(worker, providerActor(), mismatch.id, gmailPage('other', 'someone-else@example.com'));
    expect(mismatched.imported).toBe(0);
    expect(mismatched.status).toBe('IDENTITY_MISMATCH');
    expect(await messageCount(mismatch.id)).toBe(0);
  });

  function providerActor() {
    return { tenantId, userId, key: Buffer.from(encryptionKey as string, 'base64') };
  }

  async function googleConnection(extra: { tokenExpiresAt?: Date; refreshTokenCiphertext?: Uint8Array<ArrayBuffer> } = {}) {
    const connection = await admin.mailboxConnection.create({
      data: {
        tenantId,
        provider: 'google',
        providerMailboxId: randomUUID(),
        address: `${randomUUID()}@example.com`,
        connectedBy: userId,
        status: 'CONFIGURED_UNVERIFIED',
        scopes: ['READ'],
        live: false,
        sendingEnabled: false,
        accessTokenCiphertext: Uint8Array.from(encryptToken('token', Buffer.from(encryptionKey as string, 'base64'))),
        ...extra,
      },
    });
    await admin.mailboxAccess.create({ data: { tenantId, connectionId: connection.id, userId, accessRole: 'READ' } });
    return connection;
  }

  function actor() {
    return { tenantId, userId, key: Buffer.alloc(32) };
  }

  async function queue(ids: string[]) {
    const connection = await admin.mailboxConnection.create({
      data: { tenantId, provider: 'capture', providerMailboxId: randomUUID(), address: `${randomUUID()}@example.com`, connectedBy: userId, status: 'CAPTURE', scopes: ['READ'] },
    });
    await admin.mailboxAccess.create({ data: { tenantId, connectionId: connection.id, userId, accessRole: 'SEND' } });
    await admin.mailboxSyncCursor.create({
      data: {
        tenantId,
        connectionId: connection.id,
        cursor: JSON.stringify({ token: null, pending: ids.map((id) => ({ providerMessageId: id, internetMessageId: `<${id}@example>`, sender: 'buyer@example.com', subject: id, text: id, provenance: 'USER PROVIDED MAIL' })) }),
      },
    });
    return connection.id;
  }

  async function messageCount(connectionId: string) {
    return withTenant(admin, tenantId, (tx) => tx.mailboxMessage.count({ where: { tenantId, connectionId } }));
  }

  async function expire(connectionId: string) {
    await admin.$executeRaw`UPDATE public.crm_work_leases SET lease_until = pg_catalog.now() - interval '1 second' WHERE tenant_id = ${tenantId}::uuid AND record_id = ${connectionId}::uuid`;
  }
});

function hold(): { started: Promise<void>; release: () => void; mark: () => void } {
  let mark: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { mark = resolve; });
  const gate: { started: Promise<void>; release: () => void; mark: () => void } = {
    started,
    release: () => undefined,
    mark: () => mark(),
  };
  return gate;
}

function pausingRead(gate: { started: Promise<void>; release: () => void; mark?: () => void }): typeof fetch {
  return (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/users/me/messages?')) {
      gate.mark?.();
      await new Promise<void>((resolve) => { gate.release = resolve; });
      return new Response(JSON.stringify({ messages: [{ id: 'held-1', threadId: 'held-thread' }] }), { status: 200 });
    }
    if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '4' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'held-1', threadId: 'held-thread', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Message-ID', value: '<held-1@example>' }], body: { data: Buffer.from('Held').toString('base64url') } } }), { status: 200 });
  }) as typeof fetch;
}

function pausingRefresh(gate: { started: Promise<void>; release: () => void; mark?: () => void }): typeof fetch {
  return (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) {
      gate.mark?.();
      await new Promise<void>((resolve) => { gate.release = resolve; });
      return new Response(JSON.stringify({ access_token: 'rotated', refresh_token: 'rotated', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  }) as typeof fetch;
}

function gmailPage(id: string, emailAddress?: string): typeof fetch {
  return (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/users/me/messages?')) return new Response(JSON.stringify({ messages: [{ id, threadId: `${id}-thread` }] }), { status: 200 });
    if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '8', ...(emailAddress ? { emailAddress } : {}) }), { status: 200 });
    return new Response(JSON.stringify({ id, threadId: `${id}-thread`, payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Message-ID', value: `<${id}@example>` }], body: { data: Buffer.from('Hello').toString('base64url') } } }), { status: 200 });
  }) as typeof fetch;
}

function killAfterCheckpoint(tenantId: string, userId: string, connectionId: string, kind = ''): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/mailbox-crash.ts'), tenantId, connectionId, kind], {
      cwd: process.cwd(),
      env: { ...process.env, SALESOS_MAILBOX_USER: userId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
