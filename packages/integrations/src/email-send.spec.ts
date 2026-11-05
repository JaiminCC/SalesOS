import { describe, expect, it } from 'vitest';
import { gmailSendCapability, graphSendCapability, reconcileGmail, reconcileGraph, sendWithGmail, sendWithGraph } from './email-send';

const message = { from: 'owner@example.com', to: ['buyer@example.com'], subject: 'Hello', text: 'Draft was reviewed.' };

describe('outbound provider adapters', () => {
  it('accepts a Gmail stub and does not treat it as live verified', async () => {
    expect(gmailSendCapability()).toBe('STUB_TESTED');
    const result = await sendWithGmail('token', message, async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'g-1', threadId: 't-1' }) }));
    expect(result.acceptance).toBe('ACCEPTED');
    expect(result.providerMessageId).toBe('g-1');
    expect(result.capability).toBe('STUB_TESTED');
    const denied = await sendWithGmail('token', message, async () => ({ ok: false, status: 401, text: async () => '' }));
    expect(denied.acceptance).toBe('REJECTED');
    expect(denied.retryable).toBe(false);
    const limited = await sendWithGmail('token', message, async () => ({ ok: false, status: 429, text: async () => '' }));
    expect(limited.acceptance).toBe('UNKNOWN');
    const down = await sendWithGmail('token', message, async () => ({ ok: false, status: 503, text: async () => '' }));
    expect(down.acceptance).toBe('UNKNOWN');
    const dropped = await sendWithGmail('token', message, async () => { throw new Error('socket'); });
    expect(dropped.acceptance).toBe('UNKNOWN');
    expect(dropped.providerMessageId).toBeNull();
    const redirected = await sendWithGmail('token', message, async (_url, init) => {
      expect(init.redirect).toBe('manual');
      return { ok: false, status: 302, text: async () => '' };
    });
    expect(redirected.acceptance).toBe('UNKNOWN');
    expect(redirected.retryable).toBe(false);
    const confirmed = await reconcileGmail('token', 'g-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'g-1', labelIds: ['SENT'] }) }));
    expect(confirmed).toBe('SENT_ITEM_CONFIRMED');
    const hidden = await reconcileGmail('token', 'g-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'g-1', labelIds: ['INBOX'] }) }));
    expect(hidden).toBe('DELIVERY_UNKNOWN');
    const missing = await reconcileGmail('token', '', async () => ({ ok: true, status: 200, text: async () => '{}' }));
    expect(missing).toBe('DELIVERY_UNKNOWN');
    const sent = await reconcileGraph('token', 'immutable-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'immutable-1', isDraft: false }) }));
    expect(sent).toBe('SENT_ITEM_CONFIRMED');
    const stillDraft = await reconcileGraph('token', 'immutable-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'immutable-1', isDraft: true }) }));
    expect(stillDraft).toBe('DELIVERY_UNKNOWN');
    const absent = await reconcileGraph('token', 'immutable-1', async () => ({ ok: false, status: 404, text: async () => '' }));
    expect(absent).toBe('DELIVERY_UNKNOWN');
  });

  it('correlates Graph acceptance to the immutable draft id and does not invent one', async () => {
    expect(graphSendCapability()).toBe('STUB_TESTED');
    const accepted = await sendWithGraph('token', message, async (url) => {
      if (String(url).endsWith('/send')) return { ok: true, status: 202, text: async () => '' };
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'immutable-1' }) };
    });
    expect(accepted.acceptance).toBe('ACCEPTED');
    expect(accepted.providerMessageId).toBe('immutable-1');
    expect(accepted.capability).not.toBe('LIVE_VERIFIED');
    const denied = await sendWithGraph('token', message, async () => ({ ok: false, status: 401, text: async () => '' }));
    expect(denied.acceptance).toBe('REJECTED');
    expect(denied.providerMessageId).toBeNull();
    const limited = await sendWithGraph('token', message, async (url) => {
      if (String(url).endsWith('/send')) return { ok: false, status: 429, text: async () => '' };
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'immutable-2' }) };
    });
    expect(limited.acceptance).toBe('UNKNOWN');
    expect(limited.providerMessageId).toBe('immutable-2');
    const down = await sendWithGraph('token', message, async (url) => {
      if (String(url).endsWith('/send')) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'immutable-3' }) };
    });
    expect(down.acceptance).toBe('UNKNOWN');
    expect(down.providerMessageId).toBe('immutable-3');
    const moved = await sendWithGraph('token', message, async (_url, init) => {
      expect(init.redirect).toBe('manual');
      return { ok: false, status: 302, text: async () => '' };
    });
    expect(moved.acceptance).toBe('UNKNOWN');
    expect(moved.providerMessageId).toBeNull();
    expect(moved.retryable).toBe(false);
    const dropped = await sendWithGraph('token', message, async (url) => {
      if (String(url).endsWith('/send')) throw new Error('socket hang up');
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'immutable-4' }) };
    });
    expect(dropped.acceptance).toBe('UNKNOWN');
    expect(dropped.providerMessageId).toBe('immutable-4');
    const confirmed = await reconcileGraph('token', 'immutable-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'immutable-1', isDraft: false }) }));
    expect(confirmed).toBe('SENT_ITEM_CONFIRMED');
    const stillDraft = await reconcileGraph('token', 'immutable-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'immutable-1', isDraft: true }) }));
    expect(stillDraft).toBe('DELIVERY_UNKNOWN');
    const missing = await reconcileGraph('token', 'immutable-1', async () => ({ ok: false, status: 404, text: async () => '' }));
    expect(missing).toBe('DELIVERY_UNKNOWN');
    const again = await reconcileGraph('token', 'immutable-1', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'immutable-1', isDraft: false }) }));
    expect(again).toBe('SENT_ITEM_CONFIRMED');
  });
});
