import { createPrismaClient, decodeEncryptionKey, syncConnection, syncMailbox } from '@salesos/database';

async function main(): Promise<void> {
  const [tenantId, connectionId, kind] = process.argv.slice(2);
  const userId = process.env.SALESOS_MAILBOX_USER;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!tenantId || !connectionId || !userId || !workerUrl || !key) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  const actor = { tenantId, userId, key: decodeEncryptionKey(key), pause: kind === 'provider' ? 'after-claim' as const : 'after-row' as const };
  if (kind === 'provider') await syncConnection(prisma, actor, connectionId);
  else await syncMailbox(prisma, actor, connectionId);
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'mailbox crash failed');
  process.exit(2);
});
