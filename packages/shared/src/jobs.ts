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

export const WHATSAPP_WEBHOOK_JOB = 'whatsapp.webhook.process';
export const WHATSAPP_CONVERSATION_JOB = 'whatsapp.conversation.resolve';
export const WHATSAPP_CONTACT_JOB = 'whatsapp.contact.link';
export const WHATSAPP_ANALYZE_JOB = 'whatsapp.ai.analyze';
export const WHATSAPP_DRAFT_JOB = 'whatsapp.draft.prepare';
export const WHATSAPP_TEMPLATE_JOB = 'whatsapp.template.validate';
export const WHATSAPP_STATUS_JOB = 'whatsapp.status.correlate';
export const WHATSAPP_HEALTH_JOB = 'whatsapp.health.evaluate';
export const WHATSAPP_ALERT_JOB = 'whatsapp.alert.evaluate';
export const WHATSAPP_JOB_NAMES = [WHATSAPP_WEBHOOK_JOB, WHATSAPP_CONVERSATION_JOB, WHATSAPP_CONTACT_JOB, WHATSAPP_ANALYZE_JOB, WHATSAPP_DRAFT_JOB, WHATSAPP_TEMPLATE_JOB, WHATSAPP_STATUS_JOB, WHATSAPP_HEALTH_JOB, WHATSAPP_ALERT_JOB] as const;
export type WhatsAppJobName = (typeof WHATSAPP_JOB_NAMES)[number];

export type WhatsAppJobData = {
  tenantId: string;
  recordId: string;
  outboxId: string;
};

export const CALENDAR_AVAILABILITY_JOB = 'calendar.availability.refresh';
export const CALENDAR_HOLD_EXPIRE_JOB = 'calendar.slot.hold.expire';
export const CALENDAR_PREPARE_JOB = 'calendar.booking.prepare';
export const CALENDAR_CONFIRM_JOB = 'calendar.booking.confirm_internal';
export const CALENDAR_RESCHEDULE_JOB = 'calendar.booking.reschedule_internal';
export const CALENDAR_CANCEL_JOB = 'calendar.booking.cancel_internal';
export const CALENDAR_PROPOSAL_JOB = 'calendar.ai.proposal';
export const CALENDAR_AGENDA_JOB = 'calendar.ai.agenda';
export const CALENDAR_FOLLOWUP_JOB = 'calendar.meeting.followup.prepare';
export const CALENDAR_HEALTH_JOB = 'calendar.connection.health';
export const CALENDAR_ANALYTICS_JOB = 'calendar.analytics.aggregate';
export const CALENDAR_JOB_NAMES = [CALENDAR_AVAILABILITY_JOB, CALENDAR_HOLD_EXPIRE_JOB, CALENDAR_PREPARE_JOB, CALENDAR_CONFIRM_JOB, CALENDAR_RESCHEDULE_JOB, CALENDAR_CANCEL_JOB, CALENDAR_PROPOSAL_JOB, CALENDAR_AGENDA_JOB, CALENDAR_FOLLOWUP_JOB, CALENDAR_HEALTH_JOB, CALENDAR_ANALYTICS_JOB] as const;
export type CalendarJobName = (typeof CALENDAR_JOB_NAMES)[number];

export type CalendarJobData = {
  tenantId: string;
  recordId: string;
  outboxId: string;
};
