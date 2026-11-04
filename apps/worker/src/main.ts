import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createPrismaClient } from '@salesos/database';
import { FOUNDATION_PING_JOB, FOUNDATION_QUEUE, foundationJobId, type FoundationJobData } from '@salesos/shared';
import { parseWorkerEnv } from './env';
import { externalPorts } from './ports';
import { listPendingOutbox, markFinalFailure, processFoundationPing } from './processor';

async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const ports = externalPorts();
  const prisma = createPrismaClient(env.DATABASE_URL_APP);
  const queueConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const workerConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue<FoundationJobData>(FOUNDATION_QUEUE, { connection: queueConnection });
  const worker = new Worker<FoundationJobData>(
    FOUNDATION_QUEUE,
    async (job) => processFoundationPing(job, prisma),
    { connection: workerConnection, concurrency: 4 },
  );
  worker.on('failed', (job, error) => {
    if (!job) return;
    process.stderr.write(`${JSON.stringify({ level: 'error', message: error.message, jobId: job.id })}\n`);
    void markFinalFailure(job, prisma);
  });

  let stopped = false;
  const relay = async () => {
    if (stopped) return;
    try {
      const pending = await listPendingOutbox(prisma);
      for (const row of pending) {
        if (row.event_type !== 'job.foundation_ping.v1') continue;
        const data: FoundationJobData = {
          tenantId: row.tenant_id,
          jobExecutionId: row.aggregate_id,
          outboxId: row.id,
        };
        await queue.add(FOUNDATION_PING_JOB, data, {
          jobId: foundationJobId(data.tenantId, data.outboxId),
          attempts: 5,
          backoff: { type: 'exponential', delay: 200 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '';
          if (!message.includes('already exists')) throw error;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'relay failed';
      process.stderr.write(`${JSON.stringify({ level: 'error', message })}\n`);
    }
  };
  const timer = setInterval(() => void relay(), 2000);
  await relay();
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: 'worker started',
      queue: FOUNDATION_QUEUE,
      mailbox: ports.mailbox.constructor.name,
      whatsapp: ports.whatsapp.constructor.name,
    })}\n`,
  );

  const shutdown = async () => {
    stopped = true;
    clearInterval(timer);
    await worker.close();
    await queue.close();
    await queueConnection.quit();
    await workerConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'worker failed to start';
    process.stderr.write(`${JSON.stringify({ level: 'error', message })}\n`);
    process.exit(1);
  });
}
