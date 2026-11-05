import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_PROVIDERS,
  canTransitionCrmLead,
  compareTextList,
  discoveryCandidates,
  externalDiscoveryAdapter,
  externalDiscoveryStatus,
  evaluateEligibility,
  evaluateQuietHours,
  mapImportRow,
  neutralizeCsvFormula,
  normalizeDomain,
  normalizeEmail,
  parseCsv,
  scoreIcp,
} from './crm';

describe('crm lead intelligence', () => {
  it('scores a strong match, a partial match, and an exclusion differently', () => {
    const strong = scoreIcp({
      fits: { industry: 'MATCH', size: 'MATCH', geography: 'MATCH', buyer: 'MATCH', need: 'MATCH', trigger: 'MATCH', technology: 'MATCH' },
      excluded: false,
    });
    const partial = scoreIcp({
      fits: { industry: 'MATCH', size: 'MATCH', geography: 'MATCH', buyer: 'UNKNOWN', need: 'UNKNOWN', trigger: 'UNKNOWN', technology: 'MISS' },
      excluded: false,
    });
    const excluded = scoreIcp({
      fits: { industry: 'MATCH', size: 'MISS', geography: 'MATCH', buyer: 'MATCH', need: 'MATCH', trigger: 'MATCH', technology: 'MATCH' },
      excluded: true,
    });
    expect(strong).toMatchObject({ score: 100, grade: 'A' });
    expect(partial.score).toBe(50);
    expect(partial.grade).toBe('C');
    expect(excluded).toMatchObject({ score: 0, grade: 'D', excluded: true });
    expect(scoreIcp({
      fits: { industry: 'UNKNOWN', size: 'UNKNOWN', geography: 'UNKNOWN', buyer: 'UNKNOWN', need: 'UNKNOWN', trigger: 'UNKNOWN', technology: 'MATCH' },
      excluded: false,
    }).grade).toBe('UNRATED');
  });

  it('keeps unknown consent and suppression from becoming permission', () => {
    expect(evaluateEligibility({ suppressed: true, humanTakeover: false, consentKnown: true, contactVerified: true }).state).toBe('SUPPRESSED');
    expect(evaluateEligibility({ suppressed: false, humanTakeover: true, consentKnown: true, contactVerified: true }).state).toBe('HUMAN_OWNED');
    expect(evaluateEligibility({ suppressed: false, humanTakeover: false, consentKnown: false, contactVerified: true }).state).toBe('CONSENT_UNKNOWN');
    expect(evaluateEligibility({ suppressed: false, humanTakeover: false, consentKnown: true, contactVerified: false }).state).toBe('CONTACT_DETAILS_UNVERIFIED');
    expect(evaluateEligibility({ suppressed: false, humanTakeover: false, consentKnown: true, contactVerified: true }).state).toBe('ELIGIBLE');
    expect(evaluateEligibility({ suppressed: false, humanTakeover: false, consentKnown: true, contactVerified: true, lookupFailed: true }).state).toBe('REVIEW_REQUIRED');
  });

  it('blocks outside the window and refuses to guess an unknown time zone', () => {
    const policy = { timezone: 'America/New_York', weekdays: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60, holidays: ['2026-11-26'], minimumIntervalHours: 24, maxAttemptsPerPeriod: 2 };
    expect(evaluateQuietHours({ ...policy, timezone: null }, new Date('2026-11-05T15:00:00Z')).decision).toBe('UNKNOWN');
    expect(evaluateQuietHours(policy, new Date('2026-11-05T15:00:00Z')).decision).toBe('ALLOW');
    expect(evaluateQuietHours(policy, new Date('2026-11-05T02:00:00Z')).reason).toBe('OUTSIDE_WINDOW');
    expect(evaluateQuietHours(policy, new Date('2026-11-26T15:00:00Z')).reason).toBe('HOLIDAY');
    const springForward = evaluateQuietHours(policy, new Date('2026-03-09T13:30:00Z'));
    expect(springForward.decision).toBe('ALLOW');
  });

  it('rejects formula injection and maps columns', () => {
    expect(neutralizeCsvFormula('=cmd|open')).toBe("'=cmd|open");
    const parsed = parseCsv('companyName,website\nHarbor,https://www.harbor.example\n"=1+1",https://bad.example\n');
    expect(parsed.rows[1]?.[0]).toBe("'=1+1");
    expect(normalizeDomain('https://www.harbor.example/path')).toBe('harbor.example');
    expect(normalizeEmail('Buyer@Harbor.Example')).toBe('buyer@harbor.example');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(mapImportRow(parsed.headers, parsed.rows[0] ?? [], {}).companyName).toBe('Harbor');
    expect(compareTextList('Logistics', ['logistics'])).toBe('MATCH');
  });

  it('labels discovery providers as not live', () => {
    expect(DISCOVERY_PROVIDERS.map((item) => item.label)).toEqual(['USER PROVIDED DATA', 'LOCAL TEST DATA']);
    expect(externalDiscoveryStatus()).toEqual({ id: 'external', configured: false, status: 'NOT_CONFIGURED' });
    expect(externalDiscoveryAdapter()).toMatchObject({ configured: false, live: false, credentialStorage: 'encrypted', pagination: true, cancellation: true });
    expect(DISCOVERY_PROVIDERS.every((item) => item.live === false)).toBe(true);
    const manual = discoveryCandidates('manual', [{ name: 'Harbor', website: 'https://harbor.example', industry: 'Logistics', country: 'US' }]);
    const test = discoveryCandidates('test', []);
    expect(manual[0]).toMatchObject({ domain: 'harbor.example', live: false, providerMode: 'manual' });
    expect(test[0]).toMatchObject({ name: 'Northwind Logistics', live: false, providerMode: 'test' });
    expect(canTransitionCrmLead('NEW', 'RESEARCHING')).toBe(true);
    expect(canTransitionCrmLead('CONVERTED', 'NEW')).toBe(false);
    expect(canTransitionCrmLead('ARCHIVED', 'NEW')).toBe(true);
  });
});
