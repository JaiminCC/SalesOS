import { describe, expect, it } from 'vitest';
import { redact } from './logger';

describe('redact', () => {
  it('removes secret-like fields', () => {
    expect(redact({ token: 'abc', nested: { password: 'x', ok: 1 } })).toEqual({
      token: '[redacted]',
      nested: { password: '[redacted]', ok: 1 },
    });
  });
});
