import { describe, expect, it } from 'vitest';
import { budgetStop, decide } from './policy';

const base = { autonomyLevel: 'A4' as const, suppressed: false, humanOwned: false, killSwitch: false };

describe('decide', () => {
  it('requires approval for the first outbound action', () => {
    const result = decide({ actionType: 'SEND_EMAIL', external: true, firstOutbound: true, modelRequiresApproval: false }, base);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
  });

  it('blocks an opted-out recipient', () => {
    const result = decide({ actionType: 'SEND_EMAIL', external: true }, { ...base, suppressed: true });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('OPT_OUT');
  });

  it('does not allow a price guarantee when the model skips approval', () => {
    const result = decide(
      { actionType: 'SEND_EMAIL', external: true, commercialCommitment: true, modelRequiresApproval: false },
      base,
    );
    expect(result.decision).not.toBe('ALLOW');
    expect(result.reason).toBe('COMMERCIAL_COMMITMENT');
  });

  it('does not authorize an external action when suppression or ownership is unknown', () => {
    const unknown = { ...base, audienceKnown: false };
    const missing = decide({ actionType: 'SEND_EMAIL', external: true, firstOutbound: false }, { ...unknown, autonomyLevel: 'A2' });
    expect(missing.decision).not.toBe('ALLOW');
    expect(missing.reason).toBe('UNKNOWN_AUDIENCE');
    expect(decide({ actionType: 'SEND_EMAIL', external: true }, base).decision).not.toBe('ALLOW');
    expect(decide({ actionType: 'CREATE_TASK', external: false }, unknown).decision).toBe('ALLOW');
  });

  it('blocks external writes during a kill switch and allows an internal task', () => {
    const paused = { ...base, killSwitch: true };
    expect(decide({ actionType: 'SEND_EMAIL', external: true }, paused).decision).toBe('BLOCK');
    expect(decide({ actionType: 'CREATE_TASK', external: false }, paused).decision).toBe('ALLOW');
  });
});

describe('budgetStop', () => {
  it('stops when spend reaches the monthly limit', () => {
    expect(budgetStop(10, 10)).toBe(true);
    expect(budgetStop(9, 10)).toBe(false);
  });
});
