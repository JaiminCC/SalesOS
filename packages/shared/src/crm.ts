export const CRM_LEAD_STAGES = [
  'NEW',
  'RESEARCHING',
  'RESEARCHED',
  'UNQUALIFIED',
  'QUALIFIED',
  'REVIEW_REQUIRED',
  'SALES_ACCEPTED',
  'SALES_REJECTED',
  'NURTURING',
  'CONVERTED',
  'DISQUALIFIED',
  'ARCHIVED',
] as const;

export type CrmLeadStage = (typeof CRM_LEAD_STAGES)[number];

const STAGE_EDGES: Record<CrmLeadStage, readonly CrmLeadStage[]> = {
  NEW: ['RESEARCHING', 'REVIEW_REQUIRED', 'DISQUALIFIED', 'ARCHIVED'],
  RESEARCHING: ['RESEARCHED', 'REVIEW_REQUIRED', 'DISQUALIFIED', 'ARCHIVED'],
  RESEARCHED: ['QUALIFIED', 'UNQUALIFIED', 'REVIEW_REQUIRED', 'DISQUALIFIED', 'ARCHIVED'],
  UNQUALIFIED: ['REVIEW_REQUIRED', 'RESEARCHING', 'DISQUALIFIED', 'ARCHIVED'],
  QUALIFIED: ['REVIEW_REQUIRED', 'SALES_ACCEPTED', 'SALES_REJECTED', 'NURTURING', 'DISQUALIFIED', 'ARCHIVED'],
  REVIEW_REQUIRED: ['QUALIFIED', 'UNQUALIFIED', 'RESEARCHING', 'DISQUALIFIED', 'ARCHIVED'],
  SALES_ACCEPTED: ['NURTURING', 'CONVERTED', 'SALES_REJECTED', 'ARCHIVED'],
  SALES_REJECTED: ['REVIEW_REQUIRED', 'ARCHIVED'],
  NURTURING: ['QUALIFIED', 'CONVERTED', 'DISQUALIFIED', 'ARCHIVED'],
  CONVERTED: ['ARCHIVED'],
  DISQUALIFIED: ['REVIEW_REQUIRED', 'ARCHIVED'],
  ARCHIVED: ['NEW'],
};

export function canTransitionCrmLead(from: CrmLeadStage, to: CrmLeadStage): boolean {
  return from !== to && STAGE_EDGES[from].includes(to);
}

export const PROVENANCE = ['VERIFIED', 'SOURCE_REPORTED', 'AI_INFERRED', 'UNKNOWN'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const ELIGIBILITY_STATES = [
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'SUPPRESSED',
  'HUMAN_OWNED',
  'CONSENT_UNKNOWN',
  'REVIEW_REQUIRED',
  'CONTACT_DETAILS_UNVERIFIED',
] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export type EligibilityFacts = {
  suppressed: boolean;
  humanTakeover: boolean;
  consentKnown: boolean;
  contactVerified: boolean;
  lookupFailed?: boolean;
};

export function evaluateEligibility(facts: EligibilityFacts): { state: EligibilityState; reasons: string[] } {
  if (facts.lookupFailed) return { state: 'REVIEW_REQUIRED', reasons: ['ELIGIBILITY_LOOKUP_FAILED'] };
  const reasons: string[] = [];
  if (facts.suppressed) reasons.push('SUPPRESSED');
  if (facts.humanTakeover) reasons.push('HUMAN_OWNED');
  if (!facts.consentKnown) reasons.push('CONSENT_UNKNOWN');
  if (!facts.contactVerified) reasons.push('CONTACT_DETAILS_UNVERIFIED');
  if (facts.suppressed) return { state: 'SUPPRESSED', reasons };
  if (facts.humanTakeover) return { state: 'HUMAN_OWNED', reasons };
  if (!facts.consentKnown) return { state: 'CONSENT_UNKNOWN', reasons };
  if (!facts.contactVerified) return { state: 'CONTACT_DETAILS_UNVERIFIED', reasons };
  return { state: 'ELIGIBLE', reasons: ['PERMITTED_BY_RECORDED_EVIDENCE'] };
}

export type QuietHoursPolicy = {
  timezone: string | null;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  holidays: string[];
  minimumIntervalHours: number;
  maxAttemptsPerPeriod: number;
};

export type QuietHoursResult = { decision: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL' | 'UNKNOWN'; reason: string };

export function evaluateQuietHours(policy: QuietHoursPolicy, now: Date, lastAttemptAt?: Date | null, attemptsInPeriod = 0): QuietHoursResult {
  if (!policy.timezone) return { decision: 'UNKNOWN', reason: 'TIMEZONE_UNKNOWN' };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: policy.timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return { decision: 'UNKNOWN', reason: 'TIMEZONE_INVALID' };
  }
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(read('weekday'));
  const minutes = Number(read('hour')) * 60 + Number(read('minute'));
  const holiday = `${read('year')}-${read('month')}-${read('day')}`;
  if (policy.holidays.includes(holiday)) return { decision: 'BLOCK', reason: 'HOLIDAY' };
  if (!policy.weekdays.includes(weekday)) return { decision: 'BLOCK', reason: 'WEEKDAY' };
  if (minutes < policy.startMinute || minutes >= policy.endMinute) return { decision: 'BLOCK', reason: 'OUTSIDE_WINDOW' };
  if (lastAttemptAt && policy.minimumIntervalHours > 0) {
    const elapsed = now.getTime() - lastAttemptAt.getTime();
    if (elapsed < policy.minimumIntervalHours * 60 * 60 * 1000) return { decision: 'BLOCK', reason: 'MINIMUM_INTERVAL' };
  }
  if (policy.maxAttemptsPerPeriod > 0 && attemptsInPeriod >= policy.maxAttemptsPerPeriod) return { decision: 'BLOCK', reason: 'ATTEMPT_LIMIT' };
  return { decision: 'ALLOW', reason: 'WITHIN_WINDOW' };
}

export const DEFAULT_SCORE_WEIGHTS = {
  industry: 20,
  size: 15,
  geography: 15,
  buyer: 10,
  need: 15,
  trigger: 10,
  technology: 15,
} as const;

export type ScoreDimension = keyof typeof DEFAULT_SCORE_WEIGHTS;
export type Fit = 'MATCH' | 'MISS' | 'UNKNOWN';

export type ScoreInput = {
  fits: Record<ScoreDimension, Fit>;
  excluded: boolean;
  weights?: Partial<typeof DEFAULT_SCORE_WEIGHTS>;
};

export type ScoreResult = {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'UNRATED';
  confidence: number;
  excluded: boolean;
  dimensions: Array<{ name: ScoreDimension; fit: Fit; weight: number; awarded: number }>;
  weights: typeof DEFAULT_SCORE_WEIGHTS;
};

export function scoreIcp(input: ScoreInput): ScoreResult {
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...input.weights };
  const dimensions = (Object.keys(DEFAULT_SCORE_WEIGHTS) as ScoreDimension[]).map((name) => {
    const weight = weights[name];
    const fit = input.fits[name];
    return { name, fit, weight, awarded: fit === 'MATCH' ? weight : 0 };
  });
  const known = dimensions.filter((item) => item.fit !== 'UNKNOWN');
  const confidence = Number((known.length / dimensions.length).toFixed(2));
  if (input.excluded) {
    return { score: 0, grade: 'D', confidence, excluded: true, dimensions, weights };
  }
  if (known.length < 2) {
    return { score: 0, grade: 'UNRATED', confidence, excluded: false, dimensions, weights };
  }
  const score = dimensions.reduce((sum, item) => sum + item.awarded, 0);
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
  return { score, grade, confidence, excluded: false, dimensions, weights };
}

export function compareTextList(value: string | null | undefined, allowed: string[]): Fit {
  if (!value?.trim() || allowed.length === 0) return 'UNKNOWN';
  const needle = value.trim().toLowerCase();
  return allowed.some((item) => item.trim().toLowerCase() === needle) ? 'MATCH' : 'MISS';
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.split('?')[0] ?? '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) return null;
  return raw;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

export const CSV_LIMITS = { maxBytes: 1_000_000, maxRows: 500 };

export function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  if (text.includes('\0')) throw new Error('The file contains binary data');
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(neutralizeCsvFormula(cell.trim()));
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(neutralizeCsvFormula(cell.trim()));
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(neutralizeCsvFormula(cell.trim()));
  if (row.some((item) => item.length > 0)) rows.push(row);
  if (rows.length === 0) throw new Error('The file has no rows');
  if (rows.length - 1 > CSV_LIMITS.maxRows) throw new Error('The file exceeds the row limit');
  const headers = rows[0]?.map((item) => item.toLowerCase()) ?? [];
  return { headers, rows: rows.slice(1) };
}

export const IMPORT_FIELDS = ['companyName', 'website', 'industry', 'country', 'contactName', 'jobTitle', 'email', 'phone', 'source'] as const;

export function mapImportRow(headers: string[], cells: string[], mapping: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const header = mapping[field];
    const index = header ? headers.indexOf(header.toLowerCase()) : headers.indexOf(field.toLowerCase());
    result[field] = index >= 0 ? cells[index] ?? '' : '';
  }
  return result;
}

export type DiscoveryProvider = {
  id: string;
  version: string;
  mode: 'manual' | 'test';
  label: string;
  live: false;
};

export const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [
  { id: 'manual', version: '1', mode: 'manual', label: 'USER PROVIDED DATA', live: false },
  { id: 'test', version: '1', mode: 'test', label: 'LOCAL TEST DATA', live: false },
];

export type ExternalDiscoveryStatus = {
  id: 'external';
  configured: false;
  status: 'NOT_CONFIGURED';
};

export function externalDiscoveryStatus(): ExternalDiscoveryStatus {
  return { id: 'external', configured: false, status: 'NOT_CONFIGURED' };
}

export type DiscoveryAdapterContract = {
  id: 'external';
  configured: false;
  live: false;
  credentialStorage: 'encrypted';
  provenanceRequired: true;
  pagination: true;
  rateLimitPerMinute: null;
  usageQuota: null;
  cancellation: true;
  retryStates: ['FAILED_RETRYABLE'];
  restrictions: ['NO_LICENSED_PROVIDER', 'NO_SCRAPING', 'NO_INVENTED_RESULTS'];
};

export function externalDiscoveryAdapter(): DiscoveryAdapterContract {
  return {
    id: 'external',
    configured: false,
    live: false,
    credentialStorage: 'encrypted',
    provenanceRequired: true,
    pagination: true,
    rateLimitPerMinute: null,
    usageQuota: null,
    cancellation: true,
    retryStates: ['FAILED_RETRYABLE'],
    restrictions: ['NO_LICENSED_PROVIDER', 'NO_SCRAPING', 'NO_INVENTED_RESULTS'],
  };
}

export function discoveryCandidates(providerId: string, supplied: Array<{ name: string; website?: string; industry?: string; country?: string }>) {
  const provider = DISCOVERY_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) throw new Error('The discovery provider is not available');
  const source = provider.mode === 'test'
    ? [{ name: 'Northwind Logistics', website: 'https://northwind.example', industry: 'Logistics', country: 'US' }]
    : supplied;
  return source.slice(0, 25).map((item) => ({
    ...item,
    domain: normalizeDomain(item.website),
    providerId: provider.id,
    providerMode: provider.mode,
    live: false as const,
  }));
}
