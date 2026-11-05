import { describe, expect, it } from 'vitest';
import { exchangeOAuthCode, readGmailPage, webhookAuthentic, webhookSignature } from './mailbox';

describe('mailbox provider adapters', () => {
  it('pages a local Gmail response and rejects a forged webhook', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'next' }), { status: 200 })) as typeof fetch;
    const page = await readGmailPage('token', undefined, fetchImpl);
    expect(page.messages).toEqual([{ providerMessageId: 'm1', providerThreadId: 't1' }]);
    expect(page.nextCursor).toBe('next');
    const body = '{"eventId":"1"}';
    expect(webhookAuthentic('fixture-hmac-secret-value', body, webhookSignature('fixture-hmac-secret-value', body))).toBe(true);
    expect(webhookAuthentic('fixture-hmac-secret-value', body, 'forged')).toBe(false);
  });

  it('exchanges an authorization code through an injected token endpoint', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ emailAddress: 'owner@example.com' }), { status: 200 });
    }) as typeof fetch;
    const exchanged = await exchangeOAuthCode('google', { clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://example.com/workspace/inbox', verifier: 'verifier' }, fetchImpl);
    expect(exchanged.email).toBe('owner@example.com');
    expect(exchanged.refreshToken).toBe('refresh-token');
    await expect(exchangeOAuthCode('google', { clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://example.com/workspace/inbox', verifier: 'verifier' }, (async () => new Response('no', { status: 400 })) as typeof fetch)).rejects.toThrow(/400/);
  });
});
