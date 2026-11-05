import { createPrismaClient, executeNextCheckpoint } from '@salesos/database';

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  const runId = process.argv[3];
  const mode = process.argv[4] || 'local';
  const workerUrl = process.env.DATABASE_URL_WORKER;
  if (!tenantId || !runId || !workerUrl) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  if (mode === 'hang-model') {
    for (;;) {
      const step = await executeNextCheckpoint(prisma, tenantId, runId, {
        complete: () => new Promise(() => undefined),
      });
      if (step.done) {
        await prisma.$disconnect();
        process.exit(2);
      }
    }
  }
  const result = await executeNextCheckpoint(prisma, tenantId, runId, {
    complete: async () => {
      throw Object.assign(new Error('The first checkpoint is local'), { status: 500 });
    },
  });
  await prisma.$disconnect();
  if (result.state !== 'RUNNING' || result.done) process.exit(2);
  process.exit(1);
}

void main();
