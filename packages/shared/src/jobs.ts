export const FOUNDATION_QUEUE = 'foundation';

export function foundationQueueName(prefix = ''): string {
  const cleaned = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned ? `${cleaned}_foundation` : FOUNDATION_QUEUE;
}
export const FOUNDATION_PING_JOB = 'foundation.ping';
export const FOUNDATION_PING_EVENT = 'job.foundation_ping.v1';

export const foundationPingModes = ['ok', 'fail-once'] as const;
export type FoundationPingMode = (typeof foundationPingModes)[number];

export type FoundationJobData = {
  tenantId: string;
  jobExecutionId: string;
  outboxId: string;
};

export function foundationJobId(tenantId: string, outboxId: string): string {
  return `${tenantId}_${outboxId}`;
}

export const KNOWLEDGE_PROCESS_JOB = 'knowledge.process';
export const KNOWLEDGE_PROCESS_EVENT = 'knowledge.document.process.v1';

export type KnowledgeJobData = {
  tenantId: string;
  documentId: string;
  outboxId: string;
};

export const AGENT_RUN_JOB = 'agent.run';
export const AGENT_RUN_EVENT = 'agent.run.requested.v1';

export type AgentRunJobData = {
  tenantId: string;
  runId: string;
  outboxId: string;
};
