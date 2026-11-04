import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withTenant } from '@salesos/database';
import { FOUNDATION_PING_EVENT, FOUNDATION_PING_JOB, foundationJobId, foundationQueueName, type FoundationJobData } from '@salesos/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processFoundationPing } from './processor';

const tenantA = '11111111-1111-4111-8111-111111111111';

describe('worker process', () => {
  it('does not open a public HTTP listener', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(source.includes('.listen(')).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL_APP || !process.env.REDIS_URL)('foundation job processing', () => {
  const prisma = createPrismaClient(process.env.DATABASE_URL_APP as string);
  const redisUrl = process.env.REDIS_URL as string;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retries a failed attempt and stores the successful result', async () => {
    const jobExecutionId = randomUUID();
    const outboxId = randomUUID();
    const idempotencyKey = `retry-${jobExecutionId}`;
    await withTenant(prisma, tenantA, async (tx) => {
      await tx.jobExecution.create({
        data: {
          tenantId: tenantA,
          id: jobExecutionId,
          queueName: foundationQueueName(process.env.SALESOS_QUEUE_PREFIX),
          jobName: FOUNDATION_PING_JOB,
          idempotencyKey,
          status: 'QUEUED',
          payload: { mode: 'fail-once' },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId: tenantA,
          id: outboxId,
          eventType: FOUNDATION_PING_EVENT,
          aggregateId: jobExecutionId,
          payload: { jobExecutionId, mode: 'fail-once' },
          status: 'PENDING',
        },
      });
    });

    const queueConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const workerConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<FoundationJobData>(foundationQueueName(process.env.SALESOS_QUEUE_PREFIX), { connection: queueConnection });
    const worker = new Worker<FoundationJobData>(
      foundationQueueName(process.env.SALESOS_QUEUE_PREFIX),
      (job) => processFoundationPing(job, prisma),
      { connection: workerConnection },
    );
    try {
      await queue.add(
        FOUNDATION_PING_JOB,
        { tenantId: tenantA, jobExecutionId, outboxId },
        { jobId: foundationJobId(tenantA, outboxId), attempts: 5, backoff: { type: 'exponential', delay: 50 } },
      );
      let row: { status: string; attempts: number; result: unknown } | null = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        row = await withTenant(prisma, tenantA, (tx) =>
          tx.jobExecution.findUnique({ where: { tenantId_id: { tenantId: tenantA, id: jobExecutionId } } }),
        );
        if (row?.status === 'SUCCEEDED' && row.attempts >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.attempts).toBeGreaterThanOrEqual(2);
      expect(row?.result).toEqual({ pong: true });
      await processFoundationPing(
        {
          name: FOUNDATION_PING_JOB,
          attemptsMade: 4,
          opts: { attempts: 5 },
          data: { tenantId: tenantA, jobExecutionId, outboxId },
        } as Parameters<typeof processFoundationPing>[0],
        prisma,
      );
      const replayed = await withTenant(prisma, tenantA, (tx) =>
        tx.jobExecution.findUnique({ where: { tenantId_id: { tenantId: tenantA, id: jobExecutionId } } }),
      );
      expect(replayed?.status).toBe('SUCCEEDED');
      expect(replayed?.attempts).toBe(row?.attempts);
    } finally {
      await worker.close();
      await queue.close();
      await queueConnection.quit();
      await workerConnection.quit();
    }
  }, 20000);
});
