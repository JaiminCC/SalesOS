import { describe, expect, it } from 'vitest';
import { estimateCostMinor } from './limits';

describe('model cost', () => {
  it('prices tokens per million and does not treat a token as a currency unit', () => {
    expect(estimateCostMinor(1_000_000, 500_000, 200, 400)).toBe(400);
    expect(estimateCostMinor(10, 10, 0, 0)).toBe(0);
  });
});
