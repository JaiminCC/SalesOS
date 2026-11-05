import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createPrismaClient, decodeEncryptionKey, encryptField, reconcileSend, sendDraft, withTenant } from '@salesos/database';
import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_URL_WORKER;
const encryptionKey = process.env.DATA_ENCRYPTION_KEY;

describe.skipIf(!adminUrl || !workerUrl || !encryptionKey)('outbound process kill recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const stamp = randomUUID().slice(0, 8);
  let tenantId = '';
  let userId = '';
  let connectionId = '';
  let server: Server;
  let port = 0;
  let invocations = 0;
  let hold = false;

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await admin.$disconnect();
    await worker.$disconnect();
  });

  it('does not send twice when the worker is killed around the provider call', async () => {
    await listen();
    const base = await seed();
    await killChild(base.draftId, 'before-claim');
    expect(invocations).toBe(0);
    const recovered = await sendDraft(worker, actor(), base.draftId, true, deliver);
    expect(recovered.state).toBe('PROVIDER_ACCEPTED');
    expect(recovered.sent).toBe(false);
    expect(invocations).toBe(1);

    const claimed = await seed('claimed');
    await killChild(claimed.draftId, 'after-claim');
    const afterClaim = await sendDraft(worker, actor(), claimed.draftId, true, deliver);
    expect(afterClaim.reasons).toContain('DUPLICATE_SEND');
    expect(invocations).toBe(1);
    const duplicateWorker = spawnChild(claimed.draftId, 'after-claim');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        duplicateWorker.kill('SIGKILL');
        reject(new Error('duplicate worker invoked the provider'));
      }, 8000);
      duplicateWorker.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(invocations).toBe(1);

    hold = true;
    const during = await seed('during');
    const duringChild = spawnChild(during.draftId, 'during-request');
    await waitForInvocations(2);
    duringChild.kill('SIGKILL');
    await once(duringChild, 'close');
    hold = false;
    const afterDuring = await sendDraft(worker, actor(), during.draftId, true, deliver);
    expect(afterDuring.reasons).toContain('DUPLICATE_SEND');
    expect(invocations).toBe(2);

    const accepted = await seed('accepted');
    await killChild(accepted.draftId, 'after-accept');
    const row = await withTenant(worker, tenantId, (tx) => tx.mailboxSendAttempt.findFirst({ where: { tenantId, draftVersionId: accepted.versionId } }));
    expect(row?.state).toBe('IN_FLIGHT');
    expect(row?.sent).toBe(false);
    const afterAccept = await sendDraft(worker, actor(), accepted.draftId, true, deliver);
    expect(afterAccept.reasons).toContain('DUPLICATE_SEND');
    expect(invocations).toBe(3);

    const attemptId = row?.id;
    if (!attemptId) throw new Error('missing attempt');
    await admin.mailboxSendAttempt.update({ where: { tenantId_id: { tenantId, id: attemptId } }, data: { providerMessageId: 'local-1' } });
    await admin.mailboxConnection.update({ where: { tenantId_id: { tenantId, id: connectionId } }, data: { accessTokenCiphertext: new Uint8Array(encryptField('local-token', decodeEncryptionKey(encryptionKey as string))) } });
    await killChild(accepted.draftId, 'reconcile', attemptId);
    const reconciled = await reconcileSend(worker, actor(), attemptId);
    expect(reconciled.sent).toBe(false);
    expect(invocations).toBe(3);
    const again = await reconcileSend(worker, actor(), attemptId);
    expect(again.sent).toBe(false);
    expect(invocations).toBe(3);
  }, 60_000);

  async function listen(): Promise<void> {
    server = createServer((request, response) => {
      if (request.url !== '/send') {
        response.writeHead(404).end();
        return;
      }
      invocations += 1;
      if (hold) return;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    port = address.port;
  }

  async function seed(label = 'base'): Promise<{ draftId: string; versionId: string }> {
    if (!tenantId) {
      const tenant = await admin.tenant.create({ data: { name: `Kill ${stamp}`, slug: `kill-${stamp}` } });
      tenantId = tenant.id;
      const user = await admin.user.create({ data: { emailHmac: `kill-${stamp}`, emailCiphertext: Buffer.from('cipher'), displayName: 'Sender', status: 'ACTIVE' } });
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
      const connection = await admin.mailboxConnection.create({ data: { tenantId, provider: 'test', providerMailboxId: `kill-${stamp}`, address: `from-${stamp}@example.com`, connectedBy: userId, scopes: [], status: 'CONFIGURED_UNVERIFIED', sendingEnabled: true, sendCapability: 'SEND_AUTHORIZED', live: false } });
      connectionId = connection.id;
      const thread = await admin.mailboxThread.create({ data: { tenantId, connectionId, providerThreadId: `thread-${stamp}`, subject: 'Hello' } });
      await admin.mailboxThreadLink.create({ data: { tenantId, threadId: thread.id, subjectType: 'lead', subjectId: lead.id, createdBy: userId } });
      await admin.emailSendPolicy.create({ data: { tenantId, enabled: true, killSwitch: false, hourlyCap: 20, dailyCap: 100, tenantDailyCap: 100, userHourlyCap: 10, maxRecipients: 5 } });
    }
    const draft = await admin.mailboxDraft.create({ data: { tenantId, connectionId, subject: label, body: 'Reviewed text', recipients: [`${label}@example.com`], status: 'APPROVED', createdBy: userId } });
    const version = await admin.mailboxDraftVersion.create({ data: { tenantId, draftId: draft.id, version: 1, subject: label, body: 'Reviewed text', recipients: [`${label}@example.com`], bodySha256: `digest-${label}`, createdBy: userId } });
    await admin.mailboxApproval.create({ data: { tenantId, draftVersionId: version.id, decision: 'APPROVED', payloadSha256: `digest-${label}`, expiresAt: new Date(Date.now() + 60_000) } });
    const thread = await admin.mailboxThread.findFirst({ where: { tenantId, connectionId } });
    if (thread) await admin.mailboxDraft.update({ where: { tenantId_id: { tenantId, id: draft.id } }, data: { threadId: thread.id } });
    return { draftId: draft.id, versionId: version.id };
  }

  function actor() {
    return { tenantId, userId, key: Buffer.alloc(32, 7) };
  }

  async function deliver() {
    const response = await fetch(`http://127.0.0.1:${port}/send`, { method: 'POST', body: '{}' });
    return { acceptance: 'ACCEPTED' as const, providerMessageId: 'recovered', threadId: null, httpStatus: response.status, correlationId: 'recovered', retryable: false };
  }

  function spawnChild(draftId: string, mode: string, attemptId = ''): ReturnType<typeof spawn> {
    return spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/send-crash.ts'), tenantId, userId, draftId, mode, String(port), attemptId], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function killChild(draftId: string, mode: string, attemptId = ''): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawnChild(draftId, mode, attemptId);
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        fail(new Error(output || 'checkpoint timed out'));
      }, 20000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('CHECKPOINT_READY')) {
          clearTimeout(timer);
          child.kill('SIGKILL');
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('error', (error) => fail(error));
      child.on('close', (code, signal) => {
        if (output.includes('CHECKPOINT_READY')) done();
        else fail(new Error(`code=${code} signal=${signal} out=${JSON.stringify(output)}`));
      });
    });
  }

  async function waitForInvocations(target: number): Promise<void> {
    const started = Date.now();
    while (invocations < target) {
      if (Date.now() - started > 10000) throw new Error(`expected ${target} provider calls, saw ${invocations}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
});

function once(child: ReturnType<typeof spawn>, event: 'close'): Promise<void> {
  return new Promise((resolve) => child.on(event, () => resolve()));
}
