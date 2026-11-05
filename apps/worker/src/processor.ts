import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { Prisma, decodeEncryptionKey, importCrmBatch, qualifyCrmLead, reconcileSend, runCrmDiscovery, sendDraft, syncConnection, withTenant, type PrismaClient } from '@salesos/database';
import { reconcileGmail, reconcileGraph, sendWithGmail, sendWithGraph } from '@salesos/integrations';
import { AGENT_RUN_EVENT, AGENT_RUN_JOB, CRM_DISCOVERY_EVENT, CRM_DISCOVERY_JOB, CRM_IMPORT_EVENT, CRM_IMPORT_JOB, CRM_QUALIFY_EVENT, CRM_QUALIFY_JOB, FOUNDATION_PING_EVENT, FOUNDATION_PING_JOB, KNOWLEDGE_PROCESS_EVENT, KNOWLEDGE_PROCESS_JOB, MAILBOX_INCREMENTAL_JOB, MAILBOX_RECONCILE_JOB, MAILBOX_SEND_EVENT, MAILBOX_SEND_JOB, MAILBOX_SYNC_EVENT, MAILBOX_SYNC_JOB, foundationJobId, liveEmailSendEnabled, type AgentRunJobData, type CrmJobData, type FoundationJobData, type KnowledgeJobData, type MailboxJobData } from '@salesos/shared';

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

export async function publishPendingOutbox(prisma: PrismaClient, queue: Queue<FoundationJobData | KnowledgeJobData | AgentRunJobData | CrmJobData | MailboxJobData>): Promise<number> {
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
      } else if (row.event_type === CRM_IMPORT_EVENT || row.event_type === CRM_DISCOVERY_EVENT || row.event_type === CRM_QUALIFY_EVENT) {
        const data: CrmJobData = { tenantId: row.tenant_id, recordId: row.aggregate_id, outboxId: row.id };
        const name = row.event_type === CRM_IMPORT_EVENT ? CRM_IMPORT_JOB : row.event_type === CRM_DISCOVERY_EVENT ? CRM_DISCOVERY_JOB : CRM_QUALIFY_JOB;
        await queue.add(name, data, options);
      } else if (row.event_type === MAILBOX_SYNC_EVENT || row.event_type === MAILBOX_SEND_EVENT) {
        const data: MailboxJobData = { tenantId: row.tenant_id, recordId: row.aggregate_id, outboxId: row.id };
        await queue.add(row.event_type === MAILBOX_SYNC_EVENT ? MAILBOX_SYNC_JOB : MAILBOX_SEND_JOB, data, options);
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

export async function processMailboxJob(job: Job<MailboxJobData>, prisma: PrismaClient, encryptionKey: string): Promise<{ done: true }> {
  const { tenantId, recordId } = job.data;
  const key = decodeEncryptionKey(encryptionKey);
  if (job.name === MAILBOX_RECONCILE_JOB) {
    const attempt = await withTenant(prisma, tenantId, (tx) => tx.mailboxSendAttempt.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
    if (!attempt) throw new UnrecoverableError('delivery attempt is missing');
    const connection = await withTenant(prisma, tenantId, (tx) => tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: attempt.connectionId } } }));
    if (!connection) throw new UnrecoverableError('mailbox connection is missing');
    const live = liveEmailSendEnabled(process.env);
    await reconcileSend(prisma, { tenantId, userId: connection.connectedBy, key }, recordId, live ? async (input) => {
      if (!input.providerMessageId) return 'DELIVERY_UNKNOWN';
      if (input.provider === 'google') return reconcileGmail(input.token, input.providerMessageId);
      if (input.provider === 'microsoft') return reconcileGraph(input.token, input.providerMessageId);
      return 'DELIVERY_UNKNOWN';
    } : undefined);
  } else {
    const connection = await withTenant(prisma, tenantId, (tx) => tx.mailboxConnection.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
    const userId = connection?.connectedBy;
    if (!userId) throw new UnrecoverableError('mailbox connection is missing');
    if (job.name === MAILBOX_SYNC_JOB || job.name === MAILBOX_INCREMENTAL_JOB) {
      const outcome = await syncConnection(prisma, { tenantId, userId, key }, recordId);
      if (outcome.held) throw new Error('LEASE_HELD');
      if (outcome.rateLimited) throw new Error('RATE_LIMIT');
    } else if (job.name === MAILBOX_SEND_JOB) {
      const draft = await withTenant(prisma, tenantId, (tx) => tx.mailboxDraft.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
      if (!draft) throw new UnrecoverableError('draft is missing');
      const live = liveEmailSendEnabled(process.env);
      await sendDraft(prisma, { tenantId, userId: draft.createdBy, key }, recordId, live, live ? async (input) => {
        const message = { from: input.from, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.body, threadId: input.threadRef || undefined };
        return input.provider === 'microsoft' ? sendWithGraph(input.token, message) : sendWithGmail(input.token, message);
      } : undefined);
    } else throw new UnrecoverableError('unexpected job name');
  }
  await withTenant(prisma, tenantId, (tx) => tx.outboxEvent.updateMany({ where: { tenantId, id: job.data.outboxId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } }));
  return { done: true };
}

export async function scheduleMailboxReads(prisma: PrismaClient, queue: { add: (name: string, data: MailboxJobData, options: { jobId: string; removeOnComplete: number; removeOnFail: number }) => Promise<unknown> }): Promise<void> {
  const due = await prisma.$queryRaw<Array<{ tenant_id: string; connection_id: string }>>`SELECT tenant_id, connection_id FROM public.list_due_mailbox_connections()`;
  const hour = new Date().toISOString().slice(0, 13);
  for (const row of due) {
    await queue.add(MAILBOX_INCREMENTAL_JOB, { tenantId: row.tenant_id, recordId: row.connection_id, outboxId: row.connection_id }, { jobId: `mailbox-read-${row.connection_id}-${hour}`, removeOnComplete: 100, removeOnFail: 100 }).catch(() => undefined);
  }
}

export async function processCrmJob(job: Job<CrmJobData>, prisma: PrismaClient, encryptionKey: string): Promise<{ done: true }> {
  const { tenantId, recordId, outboxId } = job.data;
  const key = decodeEncryptionKey(encryptionKey);
  if (job.name === CRM_IMPORT_JOB) {
    const batch = await withTenant(prisma, tenantId, (tx) => tx.crmImportBatch.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
    if (!batch) throw new UnrecoverableError('import batch is missing');
    const outcome = await importCrmBatch(prisma, { tenantId, userId: batch.createdBy, key }, recordId);
    if (outcome.held) throw new Error('LEASE_HELD');
  } else if (job.name === CRM_DISCOVERY_JOB) {
    const discovery = await withTenant(prisma, tenantId, (tx) => tx.crmDiscoveryJob.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
    if (!discovery) throw new UnrecoverableError('discovery job is missing');
    const outcome = await runCrmDiscovery(prisma, { tenantId, userId: discovery.createdBy, key }, recordId);
    if (outcome.held) throw new Error('LEASE_HELD');
  } else if (job.name === CRM_QUALIFY_JOB) {
    const lead = await withTenant(prisma, tenantId, (tx) => tx.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: recordId } } }));
    if (!lead) throw new UnrecoverableError('lead is missing');
    const outcome = await qualifyCrmLead(prisma, { tenantId, userId: lead.createdBy, key, runId: outboxId }, recordId);
    if (outcome.held) throw new Error('LEASE_HELD');
  } else throw new UnrecoverableError('unexpected job name');
  await withTenant(prisma, tenantId, (tx) => tx.outboxEvent.updateMany({ where: { tenantId, id: outboxId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } }));
  return { done: true };
}

export async function markFinalFailure(job: Job<FoundationJobData | KnowledgeJobData | AgentRunJobData | CrmJobData>, prisma: PrismaClient): Promise<void> {
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
