import { describe, expect, it } from 'vitest';
import { canTransitionAction, canTransitionLead } from './states';

describe('lead transitions', () => {
  it('allows the documented research step', () => {
    expect(canTransitionLead('DISCOVERED', 'RESEARCHED')).toBe(true);
  });

  it('rejects a skip from discovered to won', () => {
    expect(canTransitionLead('DISCOVERED', 'WON')).toBe(false);
  });

  it('allows suppression before handoff', () => {
    expect(canTransitionLead('ENGAGED', 'SUPPRESSED')).toBe(true);
  });
});

describe('agent action transitions', () => {
  it('requires a policy check before ready', () => {
    expect(canTransitionAction('PROPOSED', 'READY')).toBe(false);
    expect(canTransitionAction('POLICY_CHECKED', 'READY')).toBe(true);
  });
});
