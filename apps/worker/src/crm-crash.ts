import { createPrismaClient, decodeEncryptionKey, importCrmBatch, qualifyCrmLead, runCrmDiscovery } from '@salesos/database';

async function main(): Promise<void> {
  const [kind, tenantId, recordId] = process.argv.slice(2);
  const userId = process.env.SALESOS_CRM_USER;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!kind || !tenantId || !recordId || !userId || !workerUrl || !key) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  const actor = {
    tenantId,
    userId,
    key: decodeEncryptionKey(key),
    pause: kind === 'qualify' ? 'before-write' as const : 'after-row' as const,
    runId: recordId,
  };
  if (kind === 'import') await importCrmBatch(prisma, actor, recordId);
  else if (kind === 'discovery') await runCrmDiscovery(prisma, actor, recordId);
  else await qualifyCrmLead(prisma, actor, recordId);
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'crm crash failed');
  process.exit(2);
});
