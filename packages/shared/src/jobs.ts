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

export const CRM_IMPORT_JOB = 'crm.import';
export const CRM_IMPORT_EVENT = 'crm.import.requested.v1';
export const CRM_DISCOVERY_JOB = 'crm.discovery';
export const CRM_DISCOVERY_EVENT = 'crm.discovery.requested.v1';
export const CRM_QUALIFY_JOB = 'crm.qualify';
export const CRM_QUALIFY_EVENT = 'crm.qualify.requested.v1';

export type CrmJobData = {
  tenantId: string;
  recordId: string;
  outboxId: string;
};

export const MAILBOX_SYNC_JOB = 'mailbox.sync';
export const MAILBOX_SYNC_EVENT = 'mailbox.sync.requested.v1';
export const MAILBOX_INCREMENTAL_JOB = 'mailbox.incremental_sync';
export const MAILBOX_INCREMENTAL_EVENT = 'mailbox.incremental_sync.requested.v1';
export const MAILBOX_SEND_JOB = 'mailbox.send';
export const MAILBOX_SEND_EVENT = 'mailbox.send.requested.v1';
export const MAILBOX_RECONCILE_JOB = 'mailbox.delivery_reconcile';
export const MAILBOX_RECONCILE_EVENT = 'mailbox.delivery_reconcile.requested.v1';

export type MailboxJobData = {
  tenantId: string;
  recordId: string;
  outboxId: string;
};

export const CAMPAIGN_AUDIENCE_JOB = 'campaign.audience.evaluate';
export const CAMPAIGN_SEGMENT_JOB = 'campaign.segment.materialize';
export const CAMPAIGN_SEQUENCE_JOB = 'campaign.sequence.prepare';
export const CAMPAIGN_ENROLLMENT_JOB = 'campaign.enrollment.advance';
export const CAMPAIGN_DRAFT_JOB = 'campaign.draft.personalize';
export const CAMPAIGN_APPROVAL_JOB = 'campaign.approval.request';
export const CAMPAIGN_SIMULATION_JOB = 'campaign.simulation.run';
export const CAMPAIGN_ANALYTICS_JOB = 'campaign.analytics.aggregate';
export const CAMPAIGN_JOB_NAMES = [CAMPAIGN_AUDIENCE_JOB, CAMPAIGN_SEGMENT_JOB, CAMPAIGN_SEQUENCE_JOB, CAMPAIGN_ENROLLMENT_JOB, CAMPAIGN_DRAFT_JOB, CAMPAIGN_APPROVAL_JOB, CAMPAIGN_SIMULATION_JOB, CAMPAIGN_ANALYTICS_JOB] as const;
export type CampaignJobName = (typeof CAMPAIGN_JOB_NAMES)[number];

export type CampaignJobData = {
  tenantId: string;
  recordId: string;
  outboxId: string;
};
