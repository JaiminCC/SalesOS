import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createPrismaClient } from '@salesos/database';
import { AGENT_RUN_JOB, CAMPAIGN_JOB_NAMES, CRM_DISCOVERY_JOB, CRM_IMPORT_JOB, CRM_QUALIFY_JOB, FOUNDATION_PING_JOB, KNOWLEDGE_PROCESS_JOB, MAILBOX_INCREMENTAL_JOB, MAILBOX_RECONCILE_JOB, MAILBOX_SEND_JOB, MAILBOX_SYNC_JOB, WHATSAPP_JOB_NAMES, foundationQueueName, type AgentRunJobData, type CampaignJobData, type CrmJobData, type FoundationJobData, type KnowledgeJobData, type MailboxJobData, type WhatsAppJobData } from '@salesos/shared';
import { parseWorkerEnv } from './env';
import { readWorkerHealth } from './health';
import { processAgentRunJob } from './agent-job';
import { processKnowledgeJob, purgeDueKnowledge } from './knowledge';
import { externalPorts } from './ports';
import { markFinalFailure, processCampaignWorkerJob, processCrmJob, processFoundationPing, processMailboxJob, processWhatsAppWorkerJob, publishPendingOutbox, scheduleCampaignWaits, scheduleMailboxReads } from './processor';

async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const ports = externalPorts();
  const prisma = createPrismaClient(env.DATABASE_URL_WORKER);
  const queueConnection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    enableOfflineQueue: false,
  });
  const workerConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  queueConnection.on('error', () => undefined);
  workerConnection.on('error', () => undefined);
  const queueName = foundationQueueName(env.SALESOS_QUEUE_PREFIX);
  const queue = new Queue<FoundationJobData | KnowledgeJobData | AgentRunJobData | CrmJobData | MailboxJobData | CampaignJobData | WhatsAppJobData>(queueName, { connection: queueConnection });
  const worker = new Worker<FoundationJobData | KnowledgeJobData | AgentRunJobData | CrmJobData | MailboxJobData | CampaignJobData | WhatsAppJobData>(
    queueName,
    async (job) => {
      if (job.name === KNOWLEDGE_PROCESS_JOB) return processKnowledgeJob(job as Job<KnowledgeJobData>, prisma);
      if (job.name === AGENT_RUN_JOB) return processAgentRunJob(job as Job<AgentRunJobData>, prisma, env.DATA_ENCRYPTION_KEY);
      if (job.name === CRM_IMPORT_JOB || job.name === CRM_DISCOVERY_JOB || job.name === CRM_QUALIFY_JOB) return processCrmJob(job as Job<CrmJobData>, prisma, env.DATA_ENCRYPTION_KEY);
      if (job.name === MAILBOX_SYNC_JOB || job.name === MAILBOX_INCREMENTAL_JOB || job.name === MAILBOX_SEND_JOB || job.name === MAILBOX_RECONCILE_JOB) return processMailboxJob(job as Job<MailboxJobData>, prisma, env.DATA_ENCRYPTION_KEY);
      if ((CAMPAIGN_JOB_NAMES as readonly string[]).includes(job.name)) return processCampaignWorkerJob(job as Job<CampaignJobData>, prisma);
      if ((WHATSAPP_JOB_NAMES as readonly string[]).includes(job.name)) return processWhatsAppWorkerJob(job as Job<WhatsAppJobData>, prisma, env.DATA_ENCRYPTION_KEY);
      return processFoundationPing(job as Job<FoundationJobData>, prisma);
    },
    { connection: workerConnection, concurrency: 4 },
  );
  worker.on('failed', (job, error) => {
    if (!job) return;
    process.stderr.write(`${JSON.stringify({ level: 'error', message: error.message, jobId: job.id })}\n`);
    void markFinalFailure(job, prisma);
  });

  let stopped = false;
  const report = async () => {
    const health = await readWorkerHealth(prisma, queueConnection);
    process.stdout.write(
      `${JSON.stringify({
        level: health.postgres === 'up' && health.redis === 'up' ? 'info' : 'error',
        message: 'worker heartbeat',
        ...health,
        job: FOUNDATION_PING_JOB,
      })}\n`,
    );
  };
  const relay = async () => {
    if (stopped) return;
    try {
      await publishPendingOutbox(prisma, queue);
      await purgeDueKnowledge(prisma);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'relay failed';
      process.stderr.write(`${JSON.stringify({ level: 'error', message: 'outbox relay failed', detail: message })}\n`);
    }
  };
  const relayTimer = setInterval(() => void relay(), 2000);
  const healthTimer = setInterval(() => void report(), 15000);
  const mailboxTimer = setInterval(() => void scheduleMailboxReads(prisma, queue), 60_000);
  const campaignTimer = setInterval(() => void scheduleCampaignWaits(prisma).catch(() => undefined), 60_000);
  await report();
  await relay();
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: 'worker started',
      queue: queueName,
      job: FOUNDATION_PING_JOB,
      mailbox: ports.mailbox.constructor.name,
      whatsapp: ports.whatsapp.constructor.name,
    })}\n`,
  );

  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(relayTimer);
    clearInterval(healthTimer);
    clearInterval(mailboxTimer);
    clearInterval(campaignTimer);
    await worker.close();
    await queue.close();
    queueConnection.disconnect();
    workerConnection.disconnect();
    await prisma.$disconnect();
    process.stdout.write(`${JSON.stringify({ level: 'info', message: 'worker stopped' })}\n`);
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
