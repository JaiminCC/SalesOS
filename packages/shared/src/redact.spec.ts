import { describe, expect, it } from 'vitest';
import { redactValue } from './redact';

describe('redactValue', () => {
  it('strips emails, bearer tokens, and WhatsApp token fields', () => {
    const redacted = redactValue({
      note: 'Reach ada@example.com with Bearer abc.def-123',
      whatsappToken: 'secret-value',
      nested: { api_key: 'hidden' },
    }) as { note: string; whatsappToken: string; nested: { api_key: string } };
    expect(redacted.note).toBe('Reach [email] with bearer [redacted]');
    expect(redacted.whatsappToken).toBe('[redacted]');
    expect(redacted.nested.api_key).toBe('[redacted]');
  });
});
