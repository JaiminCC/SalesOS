export type ToolRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type ToolDefinition = {
  name: string;
  version: string;
  description: string;
  permission: 'products.read' | 'agents.read' | 'agents.manage' | 'mailbox.read' | 'mailbox.draft' | 'campaigns.read' | 'campaigns.simulate' | 'campaigns.review' | 'whatsapp.conversations.read' | 'whatsapp.drafts.create';
  risk: ToolRisk;
  approval: 'none' | 'required';
  timeoutMs: number;
  retries: number;
  idempotent: boolean;
  usesModel: boolean;
  external: boolean;
};

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  'product.context.read': {
    name: 'product.context.read',
    version: '1',
    description: 'Read the pinned published product snapshot.',
    permission: 'products.read',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'product.knowledge.search': {
    name: 'product.knowledge.search',
    version: '1',
    description: 'Read approved citations stored on the run.',
    permission: 'products.read',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'product.icp.read': {
    name: 'product.icp.read',
    version: '1',
    description: 'Read approved ICP definitions from the pinned snapshot.',
    permission: 'products.read',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'product.positioning.read': {
    name: 'product.positioning.read',
    version: '1',
    description: 'Read approved positioning from the pinned snapshot.',
    permission: 'products.read',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'sales.strategy.generate': {
    name: 'sales.strategy.generate',
    version: '1',
    description: 'Ask the selected model for a strategy grounded in the pinned snapshot.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 180000,
    retries: 1,
    idempotent: true,
    usesModel: true,
    external: false,
  },
  'research.report.create': {
    name: 'research.report.create',
    version: '1',
    description: 'Ask the selected model for a research report grounded in approved citations.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 180000,
    retries: 1,
    idempotent: true,
    usesModel: true,
    external: false,
  },
  'sales.message.draft': {
    name: 'sales.message.draft',
    version: '1',
    description: 'Draft a message. It does not send the message.',
    permission: 'agents.manage',
    risk: 'HIGH',
    approval: 'required',
    timeoutMs: 180000,
    retries: 1,
    idempotent: true,
    usesModel: true,
    external: true,
  },
  'lead.account.read': {
    name: 'lead.account.read',
    version: '1',
    description: 'Read one tenant account and its provenance.',
    permission: 'agents.manage',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.contact.read': {
    name: 'lead.contact.read',
    version: '1',
    description: 'Read contact provenance without treating missing consent as permission.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.research.evidence.read': {
    name: 'lead.research.evidence.read',
    version: '1',
    description: 'Read stored research evidence for one lead.',
    permission: 'agents.manage',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.research.summarize': {
    name: 'lead.research.summarize',
    version: '1',
    description: 'Ask the selected model to summarize stored evidence. Generated text is not a source.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 180000,
    retries: 1,
    idempotent: true,
    usesModel: true,
    external: false,
  },
  'lead.research.find_gaps': {
    name: 'lead.research.find_gaps',
    version: '1',
    description: 'List account attributes that are unknown.',
    permission: 'agents.manage',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.icp.evaluate': {
    name: 'lead.icp.evaluate',
    version: '1',
    description: 'Score the account against the pinned ICP with the deterministic scorer.',
    permission: 'agents.manage',
    risk: 'LOW',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.qualification.explain': {
    name: 'lead.qualification.explain',
    version: '1',
    description: 'Ask the selected model to explain a stored score. The model cannot change the score.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 180000,
    retries: 1,
    idempotent: true,
    usesModel: true,
    external: false,
  },
  'lead.qualification.propose': {
    name: 'lead.qualification.propose',
    version: '1',
    description: 'Store an advisory qualification. It does not authorize contact.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'lead.eligibility.read': {
    name: 'lead.eligibility.read',
    version: '1',
    description: 'Read suppression, takeover, consent, and verification facts.',
    permission: 'agents.manage',
    risk: 'MEDIUM',
    approval: 'none',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: false,
  },
  'inbox.thread.read': tool('inbox.thread.read', 'Read one mailbox thread the member can access.', 'mailbox.read', false),
  'inbox.message.read': tool('inbox.message.read', 'Read sanitized messages on that thread.', 'mailbox.read', false),
  'inbox.thread.summarize': tool('inbox.thread.summarize', 'Summarize the stored thread. Message text is untrusted data.', 'mailbox.read', true),
  'inbox.intent.classify': tool('inbox.intent.classify', 'Classify intent from stored text without granting authority.', 'mailbox.read', false),
  'inbox.crm.context.read': tool('inbox.crm.context.read', 'Read linked CRM records.', 'mailbox.read', false),
  'inbox.product.context.read': tool('inbox.product.context.read', 'Read the pinned published product.', 'mailbox.read', false),
  'inbox.reply.propose': tool('inbox.reply.propose', 'Propose reply text. It is not permission to send.', 'mailbox.draft', true),
  'inbox.draft.create': tool('inbox.draft.create', 'Store an editable draft. It does not send.', 'mailbox.draft', false),
  'inbox.eligibility.evaluate': tool('inbox.eligibility.evaluate', 'Evaluate contact eligibility. Unknown does not allow sending.', 'mailbox.read', false),
  'campaign.context.read': campaignTool('campaign.context.read', 'Read one campaign without authorizing delivery.', 'campaigns.read', false),
  'campaign.audience.read': campaignTool('campaign.audience.read', 'Read a saved segment version.', 'campaigns.read', false),
  'campaign.segment.evaluate': campaignTool('campaign.segment.evaluate', 'Evaluate a bounded segment. A match is not permission to contact.', 'campaigns.read', false),
  'campaign.lead.context.read': campaignTool('campaign.lead.context.read', 'Read verified lead attributes for one candidate.', 'campaigns.read', false),
  'campaign.product.context.read': campaignTool('campaign.product.context.read', 'Read the pinned published product version.', 'campaigns.read', false),
  'campaign.knowledge.search': campaignTool('campaign.knowledge.search', 'Read approved knowledge already pinned to the run.', 'campaigns.read', false),
  'campaign.message.personalize': campaignTool('campaign.message.personalize', 'Draft recipient text from recorded facts. It does not send.', 'campaigns.simulate', true),
  'campaign.message.validate': campaignTool('campaign.message.validate', 'Reject invented facts and keep the safe template.', 'campaigns.simulate', false),
  'campaign.sequence.preview': campaignTool('campaign.sequence.preview', 'Preview the next internal simulation step.', 'campaigns.read', false),
  'campaign.approval.propose': campaignTool('campaign.approval.propose', 'Request human review. Approval does not send.', 'campaigns.review', false),
  'whatsapp.conversation.read': whatsappTool('whatsapp.conversation.read', 'Read one WhatsApp conversation. It does not send.', 'whatsapp.conversations.read', false),
  'whatsapp.contact.context.read': whatsappTool('whatsapp.contact.context.read', 'Read the linked contact. It does not send.', 'whatsapp.conversations.read', false),
  'whatsapp.lead.context.read': whatsappTool('whatsapp.lead.context.read', 'Read the linked lead. It does not send.', 'whatsapp.conversations.read', false),
  'whatsapp.product.context.read': whatsappTool('whatsapp.product.context.read', 'Read the pinned product. It does not send.', 'whatsapp.conversations.read', false),
  'whatsapp.knowledge.search': whatsappTool('whatsapp.knowledge.search', 'Read approved knowledge already pinned to the run.', 'whatsapp.conversations.read', false),
  'whatsapp.intent.classify': whatsappTool('whatsapp.intent.classify', 'Classify inbound intent as a prediction, not a fact.', 'whatsapp.drafts.create', true),
  'whatsapp.reply.propose': whatsappTool('whatsapp.reply.propose', 'Propose a reply for a person to review. It does not send.', 'whatsapp.drafts.create', true),
  'whatsapp.qualification.propose': whatsappTool('whatsapp.qualification.propose', 'Propose qualification notes. It does not change CRM stage.', 'whatsapp.drafts.create', false),
  'whatsapp.handoff.propose': whatsappTool('whatsapp.handoff.propose', 'Propose a human handoff. It does not assign or send.', 'whatsapp.drafts.create', false),
  'whatsapp.draft.validate': whatsappTool('whatsapp.draft.validate', 'Keep a safe internal draft. It does not send.', 'whatsapp.drafts.create', false),
  'action.proposal.create': {
    name: 'action.proposal.create',
    version: '1',
    description: 'Persist an approval request for a drafted external action.',
    permission: 'agents.manage',
    risk: 'HIGH',
    approval: 'required',
    timeoutMs: 1000,
    retries: 0,
    idempotent: true,
    usesModel: false,
    external: true,
  },
};

export type PlanStep = { tool: string; version: string };

export function toolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}

export function validatePlan(steps: PlanStep[]): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return 'A run needs a plan';
  if (steps.length > 12) return 'The plan exceeds the step limit';
  for (const step of steps) {
    const tool = toolDefinition(step.tool);
    if (!tool || tool.version !== step.version) return `Unknown tool ${step.tool}`;
  }
  return null;
}

export function buildSupervisorPlan(goal: string): PlanStep[] {
  const steps = [
    'product.context.read',
    'product.icp.read',
    'product.positioning.read',
    'product.knowledge.search',
    'research.report.create',
    'sales.strategy.generate',
  ];
  if (/\b(draft|email|message|send)\b/i.test(goal)) {
    steps.push('sales.message.draft', 'action.proposal.create');
  }
  return steps.map((tool) => ({ tool, version: '1' }));
}

export const LEAD_RESEARCH_PLAN = 'LEAD_RESEARCH_AND_QUALIFY';

export function buildLeadResearchPlan(): PlanStep[] {
  return [
    'lead.account.read',
    'lead.contact.read',
    'lead.research.evidence.read',
    'lead.research.find_gaps',
    'lead.icp.evaluate',
    'lead.research.summarize',
    'lead.qualification.explain',
    'lead.qualification.propose',
    'lead.eligibility.read',
  ].map((tool) => ({ tool, version: '1' }));
}

export const INBOX_ANALYZE_PLAN = 'INBOX_ANALYZE_AND_DRAFT';

export const WHATSAPP_ANALYZE_PLAN = 'WHATSAPP_ANALYZE_AND_DRAFT';

export function buildWhatsAppPlan(): PlanStep[] {
  return [
    'whatsapp.conversation.read',
    'whatsapp.contact.context.read',
    'whatsapp.lead.context.read',
    'whatsapp.product.context.read',
    'whatsapp.knowledge.search',
    'whatsapp.intent.classify',
    'whatsapp.reply.propose',
    'whatsapp.qualification.propose',
    'whatsapp.handoff.propose',
    'whatsapp.draft.validate',
  ].map((tool) => ({ tool, version: '1' }));
}

export function buildInboxPlan(): PlanStep[] {
  return [
    'inbox.thread.read',
    'inbox.message.read',
    'inbox.intent.classify',
    'inbox.crm.context.read',
    'inbox.product.context.read',
    'inbox.thread.summarize',
    'inbox.reply.propose',
    'inbox.draft.create',
    'inbox.eligibility.evaluate',
  ].map((tool) => ({ tool, version: '1' }));
}

function whatsappTool(name: string, description: string, permission: 'whatsapp.conversations.read' | 'whatsapp.drafts.create', usesModel: boolean): ToolDefinition {
  return { name, version: '1', description, permission, risk: usesModel ? 'MEDIUM' : 'LOW', approval: 'none', timeoutMs: usesModel ? 180000 : 1000, retries: usesModel ? 1 : 0, idempotent: true, usesModel, external: false };
}

function campaignTool(name: string, description: string, permission: 'campaigns.read' | 'campaigns.simulate' | 'campaigns.review', usesModel: boolean): ToolDefinition {
  return {
    name,
    version: '1',
    description,
    permission,
    risk: usesModel ? 'MEDIUM' : 'LOW',
    approval: name === 'campaign.approval.propose' ? 'required' : 'none',
    timeoutMs: usesModel ? 180000 : 1000,
    retries: usesModel ? 1 : 0,
    idempotent: true,
    usesModel,
    external: false,
  };
}

function tool(name: string, description: string, permission: 'mailbox.read' | 'mailbox.draft', usesModel: boolean): ToolDefinition {
  return {
    name,
    version: '1',
    description,
    permission,
    risk: usesModel ? 'MEDIUM' : 'LOW',
    approval: 'none',
    timeoutMs: usesModel ? 180000 : 1000,
    retries: usesModel ? 1 : 0,
    idempotent: true,
    usesModel,
    external: false,
  };
}
