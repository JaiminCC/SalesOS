import { createHash } from 'node:crypto';
import { evaluateEligibility, evaluateQuietHours, type QuietHoursPolicy } from './crm';

export const CAMPAIGN_STATES = [
  'DRAFT',
  'CONFIGURING',
  'AUDIENCE_READY',
  'SEQUENCE_READY',
  'PENDING_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'SIMULATING',
  'PAUSED',
  'COMPLETED_SIMULATION',
  'CANCELLED',
  'ARCHIVED',
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

const CAMPAIGN_EDGES: Record<CampaignState, readonly CampaignState[]> = {
  DRAFT: ['CONFIGURING', 'CANCELLED', 'ARCHIVED'],
  CONFIGURING: ['DRAFT', 'AUDIENCE_READY', 'CANCELLED', 'ARCHIVED'],
  AUDIENCE_READY: ['CONFIGURING', 'SEQUENCE_READY', 'CANCELLED', 'ARCHIVED'],
  SEQUENCE_READY: ['AUDIENCE_READY', 'PENDING_REVIEW', 'CANCELLED', 'ARCHIVED'],
  PENDING_REVIEW: ['SEQUENCE_READY', 'APPROVED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'CONFIGURING', 'CANCELLED'],
  SCHEDULED: ['SIMULATING', 'PAUSED', 'CANCELLED'],
  SIMULATING: ['PAUSED', 'COMPLETED_SIMULATION', 'CANCELLED'],
  PAUSED: ['SIMULATING', 'CANCELLED'],
  COMPLETED_SIMULATION: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return from !== to && CAMPAIGN_EDGES[from].includes(to);
}

export const SENDING_CAPABILITY = 'NOT_AUTHORIZED' as const;

export const PREPARATION_DECISIONS = ['ELIGIBLE_FOR_PREPARATION', 'REVIEW_REQUIRED', 'BLOCKED', 'UNKNOWN'] as const;
export type PreparationDecision = (typeof PREPARATION_DECISIONS)[number];

export const SEGMENT_FIELDS = [
  'productId',
  'icpName',
  'score',
  'grade',
  'stage',
  'industry',
  'sizeRange',
  'country',
  'region',
  'businessModel',
  'source',
  'accountStatus',
  'contactRole',
  'jobTitle',
  'seniority',
  'verification',
  'consent',
  'suppression',
  'humanTakeover',
  'ownerUserId',
  'lastActivityAt',
  'lastResearchedAt',
  'completeness',
] as const;

export type SegmentField = (typeof SEGMENT_FIELDS)[number];

const NUMERIC_FIELDS = new Set<SegmentField>(['score', 'completeness']);
const BOOLEAN_FIELDS = new Set<SegmentField>(['suppression', 'humanTakeover']);
const DATE_FIELDS = new Set<SegmentField>(['lastActivityAt', 'lastResearchedAt']);
const OPERATORS = ['eq', 'neq', 'gte', 'lte', 'in', 'contains'] as const;
export type SegmentOperator = (typeof OPERATORS)[number];

export type SegmentCondition = {
  field: SegmentField;
  operator: SegmentOperator;
  value: string | number | boolean | string[];
};

export type SegmentFilter = { op: 'and' | 'or'; items: Array<SegmentFilter | SegmentCondition> };

export const SEGMENT_LIMITS = { maxDepth: 3, maxConditions: 40, maxArray: 20, maxCandidates: 500 } as const;

export type AudienceCandidate = {
  leadId: string;
  contactId: string | null;
  identityKey: string | null;
  productId: string | null;
  icpName: string | null;
  score: number | null;
  grade: string;
  stage: string;
  industry: string | null;
  sizeRange: string | null;
  country: string | null;
  region: string | null;
  businessModel: string | null;
  source: string;
  accountStatus: string;
  contactRole: string | null;
  jobTitle: string | null;
  seniority: string | null;
  verification: string;
  consent: string;
  suppressed: boolean;
  humanTakeover: boolean;
  ownerUserId: string | null;
  lastActivityAt: string | null;
  lastResearchedAt: string | null;
  completeness: number;
  archived: boolean;
};

export function validateFilter(value: unknown, depth = 0): string | null {
  if (depth > SEGMENT_LIMITS.maxDepth) return 'SEGMENT_DEPTH';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'SEGMENT_FILTER';
  const node = value as { op?: unknown; items?: unknown; field?: unknown };
  if (node.op === 'and' || node.op === 'or') {
    if (!Array.isArray(node.items) || node.items.length === 0 || node.items.length > SEGMENT_LIMITS.maxConditions) return 'SEGMENT_GROUP';
    for (const item of node.items) {
      const error = validateFilter(item, depth + 1);
      if (error) return error;
    }
    if (countConditions(value as SegmentFilter) > SEGMENT_LIMITS.maxConditions) return 'SEGMENT_COST';
    return null;
  }
  if (typeof node.field !== 'string' || !(SEGMENT_FIELDS as readonly string[]).includes(node.field)) return 'SEGMENT_FIELD';
  const condition = value as { operator?: unknown; value?: unknown };
  if (typeof condition.operator !== 'string' || !(OPERATORS as readonly string[]).includes(condition.operator)) return 'SEGMENT_OPERATOR';
  return validateConditionValue(node.field as SegmentField, condition.operator as SegmentOperator, condition.value);
}

function validateConditionValue(field: SegmentField, operator: SegmentOperator, value: unknown): string | null {
  if (operator === 'in') {
    if (!Array.isArray(value) || value.length === 0 || value.length > SEGMENT_LIMITS.maxArray) return 'SEGMENT_VALUE';
    if (!value.every((item) => typeof item === 'string' && item.length <= 80)) return 'SEGMENT_VALUE';
    return null;
  }
  if (NUMERIC_FIELDS.has(field)) return typeof value === 'number' && Number.isFinite(value) ? null : 'SEGMENT_VALUE';
  if (BOOLEAN_FIELDS.has(field)) return typeof value === 'boolean' ? null : 'SEGMENT_VALUE';
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) return 'SEGMENT_VALUE';
  if (DATE_FIELDS.has(field) && Number.isNaN(Date.parse(value))) return 'SEGMENT_VALUE';
  return null;
}

export function countConditions(filter: SegmentFilter): number {
  return filter.items.reduce((total, item) => total + ('op' in item ? countConditions(item) : 1), 0);
}

export function matchFilter(filter: SegmentFilter, candidate: AudienceCandidate): boolean {
  const results = filter.items.map((item) => ('op' in item ? matchFilter(item, candidate) : matchCondition(item, candidate)));
  return filter.op === 'and' ? results.every(Boolean) : results.some(Boolean);
}

function matchCondition(condition: SegmentCondition, candidate: AudienceCandidate): boolean {
  const current = condition.field === 'suppression' ? candidate.suppressed : condition.field === 'humanTakeover' ? candidate.humanTakeover : candidate[condition.field as Exclude<SegmentField, 'suppression' | 'humanTakeover'>];
  if (condition.operator === 'in') return Array.isArray(condition.value) && condition.value.includes(String(current ?? ''));
  if (condition.operator === 'contains') return String(current ?? '').toLowerCase().includes(String(condition.value).toLowerCase());
  if (condition.operator === 'gte' || condition.operator === 'lte') {
    const left = typeof current === 'number' ? current : Date.parse(String(current ?? ''));
    const right = typeof condition.value === 'number' ? condition.value : Date.parse(String(condition.value));
    if (Number.isNaN(left) || Number.isNaN(right)) return false;
    return condition.operator === 'gte' ? left >= right : left <= right;
  }
  const same = current === condition.value || String(current ?? '') === String(condition.value);
  return condition.operator === 'eq' ? same : !same;
}

export type PreparationInput = {
  candidate: AudienceCandidate;
  quiet: QuietHoursPolicy;
  now: Date;
  duplicate: boolean;
  frequencyBlocked: boolean;
};

export function preparationDecision(input: PreparationInput): { decision: PreparationDecision; reasons: string[] } {
  const { candidate } = input;
  const reasons: string[] = [];
  if (candidate.archived || candidate.stage === 'ARCHIVED' || candidate.stage === 'DISQUALIFIED') reasons.push('LEAD_CLOSED');
  if (candidate.suppressed) reasons.push('SUPPRESSED');
  if (candidate.humanTakeover) reasons.push('HUMAN_OWNED');
  if (!candidate.contactId) reasons.push('MISSING_CONTACT');
  if (candidate.consent === 'WITHDRAWN') reasons.push('CONSENT_WITHDRAWN');
  if (candidate.consent !== 'KNOWN' && candidate.consent !== 'GRANTED' && candidate.consent !== 'WITHDRAWN') reasons.push('CONSENT_UNKNOWN');
  if (!candidate.identityKey) reasons.push('IDENTITY_UNKNOWN');
  if (candidate.verification !== 'VERIFIED') reasons.push('CONTACT_UNVERIFIED');
  if (input.duplicate) reasons.push('DUPLICATE_ENROLLMENT');
  if (input.frequencyBlocked) reasons.push('FREQUENCY_LIMIT');
  const eligibility = evaluateEligibility({
    suppressed: candidate.suppressed,
    humanTakeover: candidate.humanTakeover,
    consentKnown: candidate.consent === 'KNOWN' || candidate.consent === 'GRANTED',
    contactVerified: candidate.verification === 'VERIFIED',
  });
  const quiet = evaluateQuietHours(input.quiet, input.now);
  if (quiet.decision === 'BLOCK') reasons.push(quiet.reason);
  if (quiet.decision === 'UNKNOWN') reasons.push(quiet.reason);
  if (reasons.includes('LEAD_CLOSED') || reasons.includes('SUPPRESSED') || reasons.includes('HUMAN_OWNED') || reasons.includes('CONSENT_WITHDRAWN') || reasons.includes('DUPLICATE_ENROLLMENT') || reasons.includes('FREQUENCY_LIMIT') || quiet.decision === 'BLOCK') {
    return { decision: 'BLOCKED', reasons };
  }
  if (reasons.includes('CONSENT_UNKNOWN') || quiet.decision === 'UNKNOWN') return { decision: 'UNKNOWN', reasons };
  if (reasons.length > 0 || eligibility.state !== 'ELIGIBLE') return { decision: 'REVIEW_REQUIRED', reasons: reasons.length ? reasons : eligibility.reasons };
  return { decision: 'ELIGIBLE_FOR_PREPARATION', reasons: ['PERMITTED_FOR_PREPARATION_ONLY'] };
}

export const STEP_TYPES = ['EMAIL_DRAFT', 'WAIT_DURATION', 'WAIT_UNTIL', 'CONDITION', 'HUMAN_TASK', 'APPROVAL_GATE', 'END_SEQUENCE', 'WHATSAPP', 'CALL'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export type SequenceStepDraft = {
  position: number;
  stepType: StepType;
  config: Record<string, unknown>;
};

export const SEQUENCE_LIMITS = { maxSteps: 12, maxHorizonDays: 90 } as const;

export function validateSequence(steps: SequenceStepDraft[]): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return 'SEQUENCE_EMPTY';
  if (steps.length > SEQUENCE_LIMITS.maxSteps) return 'SEQUENCE_LIMIT';
  const positions = steps.map((step) => step.position);
  if (new Set(positions).size !== positions.length) return 'SEQUENCE_POSITION';
  if (!steps.some((step) => step.stepType === 'END_SEQUENCE')) return 'SEQUENCE_END';
  if (steps.some((step) => step.stepType === 'WHATSAPP' || step.stepType === 'CALL')) return 'CHANNEL_UNSUPPORTED';
  const graph = new Map<number, number[]>();
  for (const step of steps) {
    if (!STEP_TYPES.includes(step.stepType)) return 'SEQUENCE_STEP';
    const next = nextPositions(step);
    if (next.some((position) => !positions.includes(position))) return 'SEQUENCE_LINK';
    graph.set(step.position, next);
    const error = validateStepConfig(step);
    if (error) return error;
  }
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const walk = (position: number): boolean => {
    if (visiting.has(position)) return true;
    if (visited.has(position)) return false;
    visiting.add(position);
    for (const next of graph.get(position) ?? []) if (walk(next)) return true;
    visiting.delete(position);
    visited.add(position);
    return false;
  };
  const start = Math.min(...positions);
  if (walk(start)) return 'SEQUENCE_CYCLE';
  return null;
}

function nextPositions(step: SequenceStepDraft): number[] {
  const values = [step.config.next, step.config.whenTrue, step.config.whenFalse].filter((value) => typeof value === 'number') as number[];
  if (values.length > 0) return values;
  return [];
}

function validateStepConfig(step: SequenceStepDraft): string | null {
  if (step.stepType === 'WAIT_DURATION') {
    const days = Number(step.config.businessDays ?? 0);
    const hours = Number(step.config.hours ?? 0);
    if (!Number.isInteger(days) || !Number.isInteger(hours) || days < 0 || hours < 0 || days + hours === 0) return 'WAIT_CONFIG';
    if (days > SEQUENCE_LIMITS.maxHorizonDays || hours > SEQUENCE_LIMITS.maxHorizonDays * 24) return 'WAIT_HORIZON';
  }
  if (step.stepType === 'WAIT_UNTIL') {
    const when = Date.parse(String(step.config.at ?? ''));
    if (Number.isNaN(when)) return 'WAIT_CONFIG';
  }
  if (step.stepType === 'CONDITION') {
    const field = step.config.field;
    if (typeof field !== 'string' || !['reply', 'takeover', 'suppression', 'consent', 'stage', 'manual'].includes(field)) return 'CONDITION_FIELD';
  }
  return null;
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function zonedParts(date: Date, timeZone: string): ZonedParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(read('weekday'));
    if (weekday < 0) return null;
    return { year: Number(read('year')), month: Number(read('month')), day: Number(read('day')), hour: Number(read('hour')), minute: Number(read('minute')), weekday };
  } catch {
    return null;
  }
}

export function isValidTimeZone(value: string): boolean {
  return zonedParts(new Date(), value) !== null;
}

export function addBusinessDays(start: Date, days: number, timeZone: string, weekdays = [1, 2, 3, 4, 5]): Date | null {
  if (!zonedParts(start, timeZone) || days < 0 || days > SEQUENCE_LIMITS.maxHorizonDays) return null;
  let cursor = start.getTime();
  let remaining = days;
  let guard = 0;
  while (remaining > 0 && guard < 400) {
    cursor += 24 * 60 * 60 * 1000;
    const parts = zonedParts(new Date(cursor), timeZone);
    if (!parts) return null;
    if (weekdays.includes(parts.weekday)) remaining -= 1;
    guard += 1;
  }
  return remaining === 0 ? new Date(cursor) : null;
}

export function waitUntil(start: Date, config: Record<string, unknown>, timeZone: string): Date | null {
  if (typeof config.at === 'string') {
    const when = new Date(config.at);
    return Number.isNaN(when.getTime()) ? null : when;
  }
  const hours = Number(config.hours ?? 0);
  const days = Number(config.businessDays ?? 0);
  const afterHours = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return days > 0 ? addBusinessDays(afterHours, days, timeZone) : afterHours;
}

export const TEMPLATE_VARIABLES = ['company_name', 'contact_first_name', 'product_name', 'industry', 'verified_pain_point'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export function validateTemplate(source: string): string | null {
  if (source.length > 8000) return 'TEMPLATE_LIMIT';
  const found = source.match(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi) ?? [];
  for (const token of found) {
    const name = token.replace(/[{}\s]/g, '');
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return 'TEMPLATE_VARIABLE';
  }
  if (/<script|javascript:|onerror=/i.test(source)) return 'TEMPLATE_MARKUP';
  return null;
}

export function renderTemplate(source: string, values: Partial<Record<TemplateVariable, string | null>>, html: boolean): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_token, name: string) => {
    const value = values[name as TemplateVariable];
    if (!value) {
      missing.push(name);
      return '';
    }
    const clean = value.replace(/[\r\n]+/g, ' ').slice(0, 200);
    return html ? escapeHtml(clean) : clean;
  });
  return { text, missing };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

const INVENTED = [/\$\s?\d/, /\brevenue\b/i, /\bemployees?\b/i, /\bwe (met|spoke)\b/i, /\bas discussed\b/i, /\bguarantee/i, /\bdiscount\b/i, /\bpricing\b/i];

export function acceptPersonalization(templateText: string, facts: string[], modelText?: string): { text: string; acceptedModel: boolean; status: 'DRAFT_PREPARED' | 'REVIEW_REQUIRED' } {
  if (!modelText) return { text: templateText, acceptedModel: false, status: missingFacts(templateText) ? 'REVIEW_REQUIRED' : 'DRAFT_PREPARED' };
  const known = `${templateText}\n${facts.join('\n')}`;
  const numbers = modelText.match(/\d[\d,]*/g) ?? [];
  const inventedNumber = numbers.some((value) => value.length > 1 && !known.includes(value));
  const inventedPhrase = INVENTED.some((pattern) => pattern.test(modelText) && !pattern.test(known));
  if (inventedNumber || inventedPhrase || modelText.length > 4000) return { text: templateText, acceptedModel: false, status: 'REVIEW_REQUIRED' };
  return { text: modelText, acceptedModel: true, status: 'DRAFT_PREPARED' };
}

function missingFacts(text: string): boolean {
  return /\{\{/.test(text);
}

export function campaignDigest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export type StopEvent = {
  verifiedReply: boolean;
  replyDetection: 'UNAVAILABLE' | 'NONE_RECORDED' | 'VERIFIED';
  humanTakeover: boolean;
  suppressed: boolean;
  consentWithdrawn: boolean;
  leadClosed: boolean;
  contactInvalid: boolean;
  tenantSuspended: boolean;
  campaignStopped: boolean;
  manualStop: boolean;
  stepsExhausted: boolean;
  endDateReached: boolean;
};

export function stopReason(event: StopEvent): string | null {
  if (event.tenantSuspended) return 'TENANT_SUSPENDED';
  if (event.campaignStopped) return 'CAMPAIGN_STOPPED';
  if (event.manualStop) return 'MANUAL_STOP';
  if (event.verifiedReply && event.replyDetection === 'VERIFIED') return 'VERIFIED_REPLY';
  if (event.humanTakeover) return 'HUMAN_OWNED';
  if (event.suppressed) return 'SUPPRESSED';
  if (event.consentWithdrawn) return 'CONSENT_WITHDRAWN';
  if (event.leadClosed) return 'LEAD_CLOSED';
  if (event.contactInvalid) return 'CONTACT_INVALID';
  if (event.endDateReached) return 'END_DATE';
  if (event.stepsExhausted) return 'MAX_STEPS';
  return null;
}

export const SIMULATION_OUTCOMES = ['PLANNED', 'ELIGIBLE_FOR_PREPARATION', 'BLOCKED', 'WAITING', 'REQUIRES_REVIEW', 'DRAFT_PREPARED', 'SIMULATED_STEP', 'SIMULATION_COMPLETE'] as const;
export type SimulationOutcome = (typeof SIMULATION_OUTCOMES)[number];

export const EXTERNAL_METRICS = {
  sent: 'NOT_AVAILABLE',
  delivered: 'NOT_AVAILABLE',
  replies: 'NOT_AVAILABLE',
  meetings: 'NOT_AVAILABLE',
  conversions: 'NOT_AVAILABLE',
} as const;

export type CampaignAnalytics = {
  totalCampaigns: number;
  draftCampaigns: number;
  approvedCampaigns: number;
  scheduledSimulations: number;
  pausedCampaigns: number;
  completedSimulations: number;
  audienceSize: number;
  eligibleForPreparation: number;
  suppressed: number;
  humanOwned: number;
  unknownEligibility: number;
  qualifiedLeads: number;
  draftsGenerated: number;
  draftsAwaitingApproval: number;
  draftsApproved: number;
  simulationStepsCompleted: number;
  failedInternalTasks: number;
  stoppedEnrollments: number;
  averagePreparationMs: number | null;
  external: typeof EXTERNAL_METRICS;
};

export function emptyAnalytics(): CampaignAnalytics {
  return {
    totalCampaigns: 0,
    draftCampaigns: 0,
    approvedCampaigns: 0,
    scheduledSimulations: 0,
    pausedCampaigns: 0,
    completedSimulations: 0,
    audienceSize: 0,
    eligibleForPreparation: 0,
    suppressed: 0,
    humanOwned: 0,
    unknownEligibility: 0,
    qualifiedLeads: 0,
    draftsGenerated: 0,
    draftsAwaitingApproval: 0,
    draftsApproved: 0,
    simulationStepsCompleted: 0,
    failedInternalTasks: 0,
    stoppedEnrollments: 0,
    averagePreparationMs: null,
    external: EXTERNAL_METRICS,
  };
}

export const CAMPAIGN_PREPARE_PLAN = 'CAMPAIGN_PREPARE_AND_PERSONALIZE';

export function buildCampaignPlan(): Array<{ tool: string; version: string }> {
  return [
    'campaign.context.read',
    'campaign.audience.read',
    'campaign.segment.evaluate',
    'campaign.lead.context.read',
    'campaign.product.context.read',
    'campaign.knowledge.search',
    'campaign.message.personalize',
    'campaign.message.validate',
    'campaign.sequence.preview',
    'campaign.approval.propose',
  ].map((tool) => ({ tool, version: '1' }));
}
