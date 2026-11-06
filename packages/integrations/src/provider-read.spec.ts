import { describe, expect, it } from 'vitest';
import { readProviderPage, refreshOAuthToken } from './provider-read';

describe('provider read adapters', () => {
  it('reads a Gmail page, refreshes a rotated token, and stops on a rate limit', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600 }), { status: 200 });
      if (url.includes('/users/me/messages?') || url.endsWith('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'page-2' }), { status: 200 });
      if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '42' }), { status: 200 });
      if (url.includes('/messages/m1')) {
        return new Response(JSON.stringify({
          id: 'm1',
          threadId: 't1',
          internalDate: '1700000000000',
          payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Subject', value: 'Question' }, { name: 'Message-ID', value: '<m1@example>' }], body: { data: Buffer.from('Can you share details?').toString('base64url') } },
        }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    }) as typeof fetch;
    const refreshed = await refreshOAuthToken('google', { clientId: 'client', clientSecret: 'secret', refreshToken: 'old' }, fetchImpl);
    expect(refreshed.refreshToken).toBe('next-refresh');
    const page = await readProviderPage({ provider: 'google', accessToken: 'token', cursor: { mode: 'list', token: null, historyId: null } }, fetchImpl);
    expect(page.messages[0]?.providerThreadId).toBe('t1');
    expect(page.messages[0]?.text).toContain('details');
    expect(page.historyId).toBe('42');
    expect(page.nextCursor).toBe('page-2');
    const limited = await readProviderPage({ provider: 'google', accessToken: 'token', cursor: { mode: 'list', token: null, historyId: null } }, (async () => new Response('', { status: 429, headers: { 'retry-after': '2' } })) as typeof fetch);
    expect(limited.rateLimited).toBe(true);
    expect(limited.retryAfterMs).toBe(2000);
    await expect(readProviderPage({ provider: 'google', accessToken: 'token', cursor: { mode: 'list', token: null, historyId: null } }, (async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } })) as typeof fetch)).rejects.toThrow(/redirect/);
  });

  it('recovers an expired Gmail history cursor and a Graph delta separately', async () => {
    const gmail = await readProviderPage(
      { provider: 'google', accessToken: 'token', cursor: { mode: 'history', token: null, historyId: 'old' } },
      (async () => new Response('missing', { status: 404 })) as typeof fetch,
    );
    expect(gmail.expiredCursor).toBe(true);
    expect(gmail.mode).toBe('list');
    const graph = await readProviderPage(
      { provider: 'microsoft', accessToken: 'token', cursor: { mode: 'delta', token: null, historyId: null } },
      (async () => new Response(JSON.stringify({
        value: [{ id: 'g1', conversationId: 'c1', subject: 'Question', from: { emailAddress: { address: 'buyer@example.com' } }, bodyPreview: 'Offline?', internetMessageId: '<g1@example>' }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
      }), { status: 200 })) as typeof fetch,
    );
    expect(graph.messages[0]?.providerThreadId).toBe('c1');
    expect(graph.nextCursor).toContain('graph.microsoft.com');
    const foreign = await readProviderPage(
      { provider: 'microsoft', accessToken: 'token', cursor: { mode: 'delta', token: 'https://evil.example/delta', historyId: null } },
      (async () => { throw new Error('should not fetch'); }) as typeof fetch,
    );
    expect(foreign.expiredCursor).toBe(true);
    const unsafe = await readProviderPage(
      { provider: 'microsoft', accessToken: 'token', cursor: { mode: 'delta', token: null, historyId: null } },
      (async () => new Response(JSON.stringify({ value: [], '@odata.deltaLink': 'https://user:pass@graph.microsoft.com/v1.0/me/messages/delta' }), { status: 200 })) as typeof fetch,
    );
    expect(unsafe.expiredCursor).toBe(true);
    expect(unsafe.nextCursor).toBeNull();
  });
});
