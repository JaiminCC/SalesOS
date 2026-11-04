import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withTenant } from '@salesos/database';
import { FOUNDATION_PING_EVENT, FOUNDATION_PING_JOB, FOUNDATION_QUEUE, foundationJobId } from '@salesos/shared';
import { readWorkerHealth } from './health';
import { processFoundationPing, publishPendingOutbox } from './processor';

const tenantA = '11111111-1111-4111-8111-111111111111';
const workerUrl = process.env.DATABASE_URL_WORKER;
const redisUrl = process.env.REDIS_URL;

describe.skipIf(!workerUrl || !redisUrl)('outbox recovery', () => {
  const prisma = createPrismaClient(workerUrl as string);
  const redis = new IORedis(redisUrl as string, { maxRetriesPerRequest: null });

  afterAll(async () => {
    redis.disconnect();
    await prisma.$disconnect();
  });

  it('reports live postgres and redis health without opening an HTTP port', async () => {
    const health = await readWorkerHealth(prisma, redis);
    expect(health).toEqual({ postgres: 'up', redis: 'up', queue: FOUNDATION_QUEUE });
  });

  it('keeps a pending outbox row when Redis is unreachable, then publishes it once', async () => {
    const jobExecutionId = randomUUID();
    const outboxId = randomUUID();
    await withTenant(prisma, tenantA, async (tx) => {
      await tx.jobExecution.create({
        data: {
          tenantId: tenantA,
          id: jobExecutionId,
          queueName: FOUNDATION_QUEUE,
          jobName: FOUNDATION_PING_JOB,
          idempotencyKey: `recover-${jobExecutionId}`,
          status: 'QUEUED',
          payload: { mode: 'ok' },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId: tenantA,
          id: outboxId,
          eventType: FOUNDATION_PING_EVENT,
          aggregateId: jobExecutionId,
          payload: { jobExecutionId },
          status: 'PENDING',
        },
      });
    });

    const blocked = new IORedis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: 1,
      connectTimeout: 300,
      commandTimeout: 500,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    blocked.on('error', () => undefined);
    const blockedQueue = new Queue(FOUNDATION_QUEUE, { connection: blocked });
    await expect(publishPendingOutbox(prisma, blockedQueue)).rejects.toThrow();
    const stillPending = await withTenant(prisma, tenantA, (tx) =>
      tx.outboxEvent.findUnique({ where: { tenantId_id: { tenantId: tenantA, id: outboxId } } }),
    );
    expect(stillPending?.status).toBe('PENDING');
    await blockedQueue.close();
    blocked.disconnect();

    const workerRedis = redis.duplicate();
    const queue = new Queue(FOUNDATION_QUEUE, { connection: redis });
    const worker = new Worker(FOUNDATION_QUEUE, (job) => processFoundationPing(job, prisma), { connection: workerRedis });
    try {
      await publishPendingOutbox(prisma, queue);
      let row: { status: string } | null = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        row = await withTenant(prisma, tenantA, (tx) =>
          tx.jobExecution.findUnique({ where: { tenantId_id: { tenantId: tenantA, id: jobExecutionId } } }),
        );
        if (row?.status === 'SUCCEEDED') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(row?.status).toBe('SUCCEEDED');
      await publishPendingOutbox(prisma, queue);
      const outbox = await withTenant(prisma, tenantA, (tx) =>
        tx.outboxEvent.findUnique({ where: { tenantId_id: { tenantId: tenantA, id: outboxId } } }),
      );
      expect(outbox?.status).toBe('PROCESSED');
      expect(foundationJobId(tenantA, outboxId).includes(':')).toBe(false);
    } finally {
      await worker.close();
      await queue.close();
      workerRedis.disconnect();
    }
  }, 20000);

  it('stops the worker process on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    const started = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('worker started')) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    expect(started, output.join('')).toBe(true);
    child.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 10000);
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code, output.join('')).toBe(0);
    expect(output.join('')).toContain('worker stopped');
    expect(output.join('')).not.toContain('.listen(');
  });
});
