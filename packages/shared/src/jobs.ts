export const FOUNDATION_QUEUE = 'foundation';
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
