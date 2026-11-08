import { describe, expect, it } from 'vitest';
import { TOOL_REGISTRY } from './tools';
import {
  acceptPersonalization,
  addBusinessDays,
  canTransitionCampaign,
  matchFilter,
  preparationDecision,
  renderTemplate,
  stopReason,
  validateFilter,
  validateSequence,
  validateTemplate,
  waitUntil,
  zonedParts,
  type AudienceCandidate,
  type SegmentFilter,
} from './campaigns';
import type { QuietHoursPolicy } from './crm';

const quiet: QuietHoursPolicy = { timezone: 'UTC', weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440, holidays: [], minimumIntervalHours: 0, maxAttemptsPerPeriod: 0 };

function candidate(overrides: Partial<AudienceCandidate> = {}): AudienceCandidate {
  return {
    leadId: 'lead',
    contactId: 'contact',
    identityKey: 'hmac',
    productId: 'product',
    icpName: 'Operators',
    score: 80,
    grade: 'A',
    stage: 'QUALIFIED',
    industry: 'Logistics',
    sizeRange: '51-200',
    country: 'US',
    region: 'West',
    businessModel: 'B2B',
    source: 'manual',
    accountStatus: 'ACTIVE',
    contactRole: 'Operations',
    jobTitle: 'Lead',
    seniority: 'MANAGER',
    verification: 'VERIFIED',
    consent: 'KNOWN',
    suppressed: false,
    humanTakeover: false,
    ownerUserId: 'owner',
    lastActivityAt: '2026-11-01T00:00:00.000Z',
    lastResearchedAt: '2026-11-01T00:00:00.000Z',
    completeness: 80,
    archived: false,
    ...overrides,
  };
}

describe('campaign preparation', () => {
  it('keeps a high score from authorizing an unknown or blocked contact', () => {
    expect(canTransitionCampaign('DRAFT', 'SIMULATING')).toBe(false);
    expect(canTransitionCampaign('APPROVED', 'SCHEDULED')).toBe(true);
    expect(preparationDecision({ candidate: candidate(), quiet, now: new Date('2026-11-02T12:00:00Z'), duplicate: false, frequencyBlocked: false }).decision).toBe('ELIGIBLE_FOR_PREPARATION');
    expect(preparationDecision({ candidate: candidate({ consent: 'UNKNOWN', score: 99 }), quiet, now: new Date('2026-11-02T12:00:00Z'), duplicate: false, frequencyBlocked: false }).decision).toBe('UNKNOWN');
    expect(preparationDecision({ candidate: candidate({ suppressed: true, score: 99 }), quiet, now: new Date('2026-11-02T12:00:00Z'), duplicate: false, frequencyBlocked: false }).decision).toBe('BLOCKED');
    expect(preparationDecision({ candidate: candidate({ humanTakeover: true }), quiet, now: new Date('2026-11-02T12:00:00Z'), duplicate: false, frequencyBlocked: false }).reasons).toContain('HUMAN_OWNED');
    expect(preparationDecision({ candidate: candidate(), quiet: { ...quiet, timezone: null }, now: new Date(), duplicate: false, frequencyBlocked: false }).decision).toBe('UNKNOWN');
  });

  it('rejects injected filters and matches bounded groups', () => {
    expect(validateFilter({ op: 'and', items: [{ field: 'stage; drop table', operator: 'eq', value: 'QUALIFIED' }] })).toBe('SEGMENT_FIELD');
    expect(validateFilter({ op: 'or', items: [{ field: 'score', operator: 'gte', value: 70 }, { op: 'and', items: [{ field: 'country', operator: 'eq', value: 'US' }] }] })).toBeNull();
    const filter = { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'QUALIFIED' }, { field: 'country', operator: 'in', value: ['US'] }] } as SegmentFilter;
    expect(matchFilter(filter, candidate())).toBe(true);
    expect(matchFilter(filter, candidate({ country: 'IN' }))).toBe(false);
  });

  it('rejects cycles, unsupported channels, and unsafe templates', () => {
    expect(validateSequence([
      { position: 1, stepType: 'EMAIL_DRAFT', config: { next: 2 } },
      { position: 2, stepType: 'WAIT_DURATION', config: { businessDays: 2, next: 3 } },
      { position: 3, stepType: 'CONDITION', config: { field: 'reply', whenTrue: 4, whenFalse: 1 } },
      { position: 4, stepType: 'END_SEQUENCE', config: {} },
    ])).toBe('SEQUENCE_CYCLE');
    expect(validateSequence([{ position: 1, stepType: 'WHATSAPP', config: {} }, { position: 2, stepType: 'END_SEQUENCE', config: {} }])).toBe('CHANNEL_UNSUPPORTED');
    expect(validateTemplate('Hello {{company_name}}')).toBeNull();
    expect(validateTemplate('Hello {{ignore_previous}}')).toBe('TEMPLATE_VARIABLE');
    expect(renderTemplate('Hi {{contact_first_name}} <{{company_name}}>', { contact_first_name: 'Ada', company_name: '<North>' }, true).text).toBe('Hi Ada <&lt;North&gt;>');
    expect(renderTemplate('Subject {{contact_first_name}}', { contact_first_name: 'Ada\r\nBcc: x' }, false).text).toBe('Subject Ada Bcc: x');
  });

  it('keeps invented model text out of an accepted draft and handles time zones', () => {
    const safe = acceptPersonalization('Hello {{company_name}}', ['Northwind'], 'Northwind has $40 million revenue');
    expect(safe.acceptedModel).toBe(false);
    expect(safe.status).toBe('REVIEW_REQUIRED');
    expect(safe.text).toContain('{{company_name}}');
    const accepted = acceptPersonalization('Hello Northwind', ['Northwind', 'Logistics'], 'Hello Northwind in Logistics');
    expect(accepted.acceptedModel).toBe(true);
    const start = new Date('2026-03-08T06:30:00.000Z');
    expect(waitUntil(start, { hours: 2 }, 'America/New_York')?.toISOString()).toBe('2026-03-08T08:30:00.000Z');
    expect(zonedParts(start, 'America/New_York')?.hour).toBe(1);
    expect(zonedParts(new Date('2026-03-08T08:30:00.000Z'), 'America/New_York')?.hour).toBe(4);
    const monday = addBusinessDays(new Date('2026-03-06T15:00:00.000Z'), 1, 'America/New_York');
    expect(zonedParts(monday!, 'America/New_York')?.weekday).toBe(1);
    expect(stopReason({ verifiedReply: false, replyDetection: 'UNAVAILABLE', humanTakeover: false, suppressed: false, consentWithdrawn: false, leadClosed: false, contactInvalid: false, tenantSuspended: false, campaignStopped: false, manualStop: false, stepsExhausted: false, endDateReached: false })).toBeNull();
    expect(stopReason({ verifiedReply: true, replyDetection: 'NONE_RECORDED', humanTakeover: false, suppressed: true, consentWithdrawn: false, leadClosed: false, contactInvalid: false, tenantSuspended: false, campaignStopped: false, manualStop: false, stepsExhausted: false, endDateReached: false })).toBe('SUPPRESSED');
    expect(Object.keys(TOOL_REGISTRY).some((name) => name.startsWith('campaign.') && name.endsWith('.send'))).toBe(false);
    expect(TOOL_REGISTRY['campaign.message.personalize']?.external).toBe(false);
  });
});
