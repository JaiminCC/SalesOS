import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, withTenant } from '@salesos/database';
import {
  FOUNDATION_PING_EVENT,
  FOUNDATION_PING_JOB,
  FOUNDATION_QUEUE,
  foundationJobId,
  type FoundationJobData,
  type FoundationPingMode,
} from '@salesos/shared';
import { DatabaseService } from '../database/database.service';
import { logError } from '../logging/logger';
import { FoundationQueue } from './queue.provider';

const ROUTE = 'POST /api/v1/jobs/foundation-ping';

@Injectable()
export class JobsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FoundationQueue) private readonly queues: FoundationQueue,
  ) {}

  assertToken(header: string | undefined, expected: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const provided = Buffer.from(header.slice('Bearer '.length));
    const actual = Buffer.from(expected);
    if (provided.length !== actual.length) return false;
    return timingSafeEqual(provided, actual);
  }

  async enqueue(input: { tenantId: string; idempotencyKey: string; mode: FoundationPingMode }) {
    const active = await this.database.prisma.$queryRaw<Array<{ tenant_is_active: boolean }>>(
      Prisma.sql`SELECT tenant_is_active(CAST(${input.tenantId} AS uuid)) AS tenant_is_active`,
    );
    if (!active[0]?.tenant_is_active) throw new NotFoundException('Tenant was not found');

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tenantId: input.tenantId, mode: input.mode }))
      .digest('hex');

    const created = await withTenant(this.database.prisma, input.tenantId, async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { tenantId_key: { tenantId: input.tenantId, key: input.idempotencyKey } },
      });
      if (existingKey && existingKey.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key was reused with a different request');
      }
      const existingJob = await tx.jobExecution.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (existingJob) return { job: existingJob, replay: true as const };

      const jobExecutionId = randomUUID();
      const outboxId = randomUUID();
      const job = await tx.jobExecution.create({
        data: {
          tenantId: input.tenantId,
          id: jobExecutionId,
          queueName: FOUNDATION_QUEUE,
          jobName: FOUNDATION_PING_JOB,
          idempotencyKey: input.idempotencyKey,
          status: 'QUEUED',
          payload: { mode: input.mode },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId: input.tenantId,
          id: outboxId,
          eventType: FOUNDATION_PING_EVENT,
          aggregateId: jobExecutionId,
          payload: { jobExecutionId, mode: input.mode },
          status: 'PENDING',
        },
      });
      await tx.idempotencyKey.create({
        data: {
          tenantId: input.tenantId,
          key: input.idempotencyKey,
          route: ROUTE,
          requestHash,
          response: { jobExecutionId },
        },
      });
      return { job, replay: false as const, outboxId };
    });

    if (!created.replay && created.outboxId) {
      await this.publish({
        tenantId: input.tenantId,
        jobExecutionId: created.job.id,
        outboxId: created.outboxId,
      });
    }
    return { id: created.job.id, status: created.job.status, replay: created.replay };
  }

  async publish(data: FoundationJobData): Promise<void> {
    try {
      await this.queues.queue.add(FOUNDATION_PING_JOB, data, {
        jobId: foundationJobId(data.tenantId, data.outboxId),
        attempts: 5,
        backoff: { type: 'exponential', delay: 200 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'enqueue failed';
      if (!message.includes('already exists')) {
        logError('foundation job enqueue deferred to outbox relay', { message });
      }
    }
  }
}
