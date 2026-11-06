import { describe, expect, it } from 'vitest';
import { classifyProviderEvidence } from './mailbox-operations';

const live = {
  provider: 'google',
  fetchImpl: fetch,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  identityMatched: true,
  authenticated: true,
  pageCommitted: true,
  fenceOk: true,
  credentialsConfigured: true,
};

describe('provider evidence', () => {
  it('refuses forged, stubbed, and configured-only results', () => {
    const previous = process.env.NODE_ENV;
    const ci = process.env.CI;
    process.env.NODE_ENV = 'production';
    delete process.env.CI;
    try {
      expect(classifyProviderEvidence(live)).toBe('REAL_READ_VERIFIED');
      expect(classifyProviderEvidence({ ...live, fetchImpl: (async () => new Response('')) as typeof fetch })).toBe('STUB_TESTED');
      expect(classifyProviderEvidence({ ...live, declaredOrigin: 'REAL_READ_VERIFIED' })).toBe('CONFIGURED_UNVERIFIED');
      expect(classifyProviderEvidence({ ...live, identityMatched: false })).toBe('CONFIGURED_UNVERIFIED');
      expect(classifyProviderEvidence({ ...live, pageCommitted: false })).toBe('CONFIGURED_UNVERIFIED');
      expect(classifyProviderEvidence({ ...live, fenceOk: false })).toBe('CONFIGURED_UNVERIFIED');
      expect(classifyProviderEvidence({ ...live, scopes: ['https://www.googleapis.com/auth/gmail.send'] })).toBe('CONFIGURED_UNVERIFIED');
      expect(classifyProviderEvidence({ ...live, credentialsConfigured: false })).toBe('NOT_CONFIGURED');
      expect(classifyProviderEvidence({ ...live, credentialsConfigured: true, fetchImpl: undefined })).toBe('STUB_TESTED');
    } finally {
      process.env.NODE_ENV = previous;
      if (ci === undefined) delete process.env.CI;
      else process.env.CI = ci;
    }
    expect(classifyProviderEvidence(live)).not.toBe('REAL_READ_VERIFIED');
  });
});
