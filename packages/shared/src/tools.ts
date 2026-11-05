export type ToolRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type ToolDefinition = {
  name: string;
  version: string;
  description: string;
  permission: 'products.read' | 'agents.read' | 'agents.manage';
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
