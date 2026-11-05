import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { Prisma, withTenant, type PrismaClient } from '@salesos/database';
import { AGENT_RUN_EVENT, AGENT_RUN_JOB, FOUNDATION_PING_EVENT, FOUNDATION_PING_JOB, KNOWLEDGE_PROCESS_EVENT, KNOWLEDGE_PROCESS_JOB, foundationJobId, type AgentRunJobData, type FoundationJobData, type KnowledgeJobData } from '@salesos/shared';

type PendingOutbox = {
  tenant_id: string;
  id: string;
  event_type: string;
  aggregate_id: string;
  attempts: number;
};

export async function listPendingOutbox(prisma: PrismaClient): Promise<PendingOutbox[]> {
  return prisma.$queryRaw<PendingOutbox[]>(Prisma.sql`SELECT * FROM public.list_pending_outbox(25)`);
}

export async function publishPendingOutbox(prisma: PrismaClient, queue: Queue<FoundationJobData | KnowledgeJobData | AgentRunJobData>): Promise<number> {
  const pending = await listPendingOutbox(prisma);
  let published = 0;
  for (const row of pending) {
    const jobId = foundationJobId(row.tenant_id, row.id);
    const options = { jobId, attempts: 5, backoff: { type: 'exponential' as const, delay: 200 }, removeOnComplete: 1000, removeOnFail: 1000 };
    try {
      if (row.event_type === FOUNDATION_PING_EVENT) {
        const data: FoundationJobData = { tenantId: row.tenant_id, jobExecutionId: row.aggregate_id, outboxId: row.id };
        await queue.add(FOUNDATION_PING_JOB, data, options);
      } else if (row.event_type === KNOWLEDGE_PROCESS_EVENT) {
        const data: KnowledgeJobData = { tenantId: row.tenant_id, documentId: row.aggregate_id, outboxId: row.id };
        await queue.add(KNOWLEDGE_PROCESS_JOB, data, options);
      } else if (row.event_type === AGENT_RUN_EVENT) {
        const data: AgentRunJobData = { tenantId: row.tenant_id, runId: row.aggregate_id, outboxId: row.id };
        await queue.add(AGENT_RUN_JOB, data, options);
      } else {
        continue;
      }
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('already exists')) throw error;
    }
  }
  return published;
}

export async function processFoundationPing(job: Job<FoundationJobData>, prisma: PrismaClient): Promise<{ pong: true }> {
  if (job.name !== FOUNDATION_PING_JOB) throw new UnrecoverableError('unexpected job name');
  const { tenantId, jobExecutionId } = job.data;
  return withTenant(prisma, tenantId, async (tx) => {
    const row = await tx.jobExecution.findUnique({
      where: { tenantId_id: { tenantId, id: jobExecutionId } },
    });
    if (!row) throw new UnrecoverableError('job execution is missing');
    if (row.status === 'SUCCEEDED') return { pong: true };
    const payload = row.payload as { mode?: string };
    const attempt = Math.max(job.attemptsMade, 1);
    if (payload.mode === 'fail-once' && attempt < 2) {
      await tx.jobExecution.update({
        where: { tenantId_id: { tenantId, id: jobExecutionId } },
        data: { status: 'FAILED_RETRYABLE', attempts: attempt, errorCode: 'INTENTIONAL', startedAt: new Date() },
      });
      throw new Error('intentional retry');
    }
    await tx.jobExecution.update({
      where: { tenantId_id: { tenantId, id: jobExecutionId } },
      data: {
        status: 'SUCCEEDED',
        attempts: attempt,
        result: { pong: true },
        errorCode: null,
        startedAt: row.startedAt ?? new Date(),
        finishedAt: new Date(),
      },
    });
    await tx.outboxEvent.updateMany({
      where: { tenantId, aggregateId: jobExecutionId, status: 'PENDING' },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    return { pong: true };
  });
}

export async function markFinalFailure(job: Job<FoundationJobData | KnowledgeJobData | AgentRunJobData>, prisma: PrismaClient): Promise<void> {
  const max = job.opts.attempts ?? 1;
  if (job.attemptsMade < max) return;
  if (job.name === FOUNDATION_PING_JOB && 'jobExecutionId' in job.data) {
    const data = job.data as FoundationJobData;
    await withTenant(prisma, data.tenantId, async (tx) => {
      await tx.jobExecution.updateMany({
        where: { tenantId: data.tenantId, id: data.jobExecutionId, status: { not: 'SUCCEEDED' } },
        data: { status: 'FAILED_FINAL', attempts: job.attemptsMade, errorCode: 'EXHAUSTED', finishedAt: new Date() },
      });
      await tx.outboxEvent.updateMany({
        where: { tenantId: data.tenantId, id: data.outboxId, status: 'PENDING' },
        data: { status: 'FAILED', processedAt: new Date() },
      });
    });
    return;
  }
  if (job.name !== AGENT_RUN_JOB || !('runId' in job.data)) return;
  const data = job.data as AgentRunJobData;
  await withTenant(prisma, data.tenantId, async (tx) => {
    await tx.agentRun.updateMany({
      where: { tenantId: data.tenantId, id: data.runId, state: { in: ['QUEUED', 'RUNNING'] } },
      data: { state: 'FAILED_FINAL', errorCode: 'EXHAUSTED', finishedAt: new Date() },
    });
    await tx.outboxEvent.updateMany({
      where: { tenantId: data.tenantId, id: data.outboxId, status: 'PENDING' },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  });
}
