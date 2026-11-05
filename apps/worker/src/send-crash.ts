import { writeSync } from 'node:fs';
import { createPrismaClient, decodeEncryptionKey, reconcileSend, sendDraft } from '@salesos/database';

function report(message: string): void {
  writeSync(1, `${message}\n`);
}

async function main(): Promise<void> {
  const [tenantId, userId, draftId, mode, port, attemptId] = process.argv.slice(2);
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const encryptionKey = process.env.DATA_ENCRYPTION_KEY;
  if (!tenantId || !userId || !draftId || !mode || !workerUrl || !encryptionKey) {
    report(`CRASH_ERROR missing ${JSON.stringify({ tenantId: Boolean(tenantId), userId: Boolean(userId), draftId: Boolean(draftId), mode, workerUrl: Boolean(workerUrl), encryptionKey: Boolean(encryptionKey) })}`);
    process.exit(2);
  }
  const prisma = createPrismaClient(workerUrl);
  const actor = { tenantId, userId, key: decodeEncryptionKey(encryptionKey) };
  if (mode === 'before-claim') {
    report('CHECKPOINT_READY');
    await new Promise(() => undefined);
  }
  if (mode === 'reconcile' && attemptId) {
    await reconcileSend(prisma, actor, attemptId, async () => {
      report('CHECKPOINT_READY');
      await new Promise<'DELIVERY_UNKNOWN'>(() => undefined);
      return 'DELIVERY_UNKNOWN';
    });
    await prisma.$disconnect();
    return;
  }
  await sendDraft(prisma, actor, draftId, true, async () => {
    if (mode === 'after-claim') {
      report('CHECKPOINT_READY');
      await new Promise(() => undefined);
    }
    const response = await fetch(`http://127.0.0.1:${port}/send`, { method: 'POST', body: '{}' });
    if (mode === 'after-accept') {
      await response.text();
      report('CHECKPOINT_READY');
      await new Promise(() => undefined);
    }
    if (!response.ok) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: response.status, correlationId: 'local', retryable: false };
    }
    return { acceptance: 'ACCEPTED', providerMessageId: 'local-1', threadId: 'local-thread', httpStatus: response.status, correlationId: 'local', retryable: false };
  });
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  report(`CRASH_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
