export type SendCapability = 'IMPLEMENTED' | 'STUB_TESTED' | 'LIVE_VERIFIED' | 'NOT_CONFIGURED' | 'NOT_SUPPORTED';

export type OutboundMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
};

export type ProviderSendResult = {
  acceptance: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  providerMessageId: string | null;
  threadId: string | null;
  httpStatus: number | null;
  correlationId: string;
  retryable: boolean;
  capability: SendCapability;
};

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'manual' }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

function redirected(status: number): boolean {
  return status >= 300 && status < 400;
}

export function gmailSendCapability(): SendCapability {
  return 'STUB_TESTED';
}

export function graphSendCapability(): SendCapability {
  return 'STUB_TESTED';
}

export async function sendWithGmail(token: string, message: OutboundMessage, fetchImpl: FetchLike = fetch): Promise<ProviderSendResult> {
  const raw = rfc822(message);
  return postJson('google', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, JSON.stringify({ raw: Buffer.from(raw).toString('base64url'), threadId: message.threadId }), fetchImpl, (body) => {
    const parsed = JSON.parse(body) as { id?: string; threadId?: string };
    return { providerMessageId: parsed.id ?? null, threadId: parsed.threadId ?? null };
  });
}

export async function sendWithGraph(token: string, message: OutboundMessage, fetchImpl: FetchLike = fetch): Promise<ProviderSendResult> {
  const correlationId = `graph-${message.subject.length}-${message.to.length}`;
  let draftId: string | null = null;
  const draftBody = JSON.stringify({
    subject: message.subject,
    body: { contentType: message.html ? 'HTML' : 'Text', content: message.html || message.text },
    toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: (message.cc ?? []).map((address) => ({ emailAddress: { address } })),
    bccRecipients: (message.bcc ?? []).map((address) => ({ emailAddress: { address } })),
  });
  try {
    const created = await fetchImpl('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'IdType="ImmutableId"' },
      body: draftBody,
      redirect: 'manual',
    });
    if (redirected(created.status)) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: created.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    if (created.status === 401 || created.status === 400 || created.status === 403) {
      return { acceptance: 'REJECTED', providerMessageId: null, threadId: null, httpStatus: created.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    if (!created.ok) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: created.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    const draft = JSON.parse(await created.text()) as { id?: string };
    if (!draft.id) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: created.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    draftId = draft.id;
    const sent = await fetchImpl(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'IdType="ImmutableId"' },
      body: '',
      redirect: 'manual',
    });
    if (redirected(sent.status)) {
      return { acceptance: 'UNKNOWN', providerMessageId: draft.id, threadId: null, httpStatus: sent.status, correlationId: draft.id, retryable: false, capability: 'STUB_TESTED' };
    }
    if (sent.status === 202 || sent.ok) {
      return { acceptance: 'ACCEPTED', providerMessageId: draft.id, threadId: null, httpStatus: sent.status, correlationId: draft.id, retryable: false, capability: 'STUB_TESTED' };
    }
    if (sent.status === 401 || sent.status === 400 || sent.status === 403) {
      return { acceptance: 'REJECTED', providerMessageId: draft.id, threadId: null, httpStatus: sent.status, correlationId: draft.id, retryable: false, capability: 'STUB_TESTED' };
    }
    return { acceptance: 'UNKNOWN', providerMessageId: draft.id, threadId: null, httpStatus: sent.status, correlationId: draft.id, retryable: false, capability: 'STUB_TESTED' };
  } catch {
    return { acceptance: 'UNKNOWN', providerMessageId: draftId, threadId: null, httpStatus: null, correlationId: draftId ?? correlationId, retryable: false, capability: 'STUB_TESTED' };
  }
}

export async function reconcileGmail(token: string, providerMessageId: string, fetchImpl: FetchLike = fetch): Promise<'SENT_ITEM_CONFIRMED' | 'DELIVERY_UNKNOWN'> {
  if (!providerMessageId) return 'DELIVERY_UNKNOWN';
  try {
    const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=metadata`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, body: '', redirect: 'manual' });
    if (redirected(response.status) || !response.ok) return 'DELIVERY_UNKNOWN';
    const body = JSON.parse(await response.text()) as { labelIds?: string[] };
    return body.labelIds?.includes('SENT') ? 'SENT_ITEM_CONFIRMED' : 'DELIVERY_UNKNOWN';
  } catch {
    return 'DELIVERY_UNKNOWN';
  }
}

export async function reconcileGraph(token: string, providerMessageId: string, fetchImpl: FetchLike = fetch): Promise<'SENT_ITEM_CONFIRMED' | 'DELIVERY_UNKNOWN'> {
  if (!providerMessageId) return 'DELIVERY_UNKNOWN';
  try {
    const response = await fetchImpl(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}?$select=id,isDraft`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, body: '', redirect: 'manual' });
    if (redirected(response.status) || !response.ok) return 'DELIVERY_UNKNOWN';
    const body = JSON.parse(await response.text()) as { id?: string; isDraft?: boolean };
    if (body.id !== providerMessageId || body.isDraft !== false) return 'DELIVERY_UNKNOWN';
    return 'SENT_ITEM_CONFIRMED';
  } catch {
    return 'DELIVERY_UNKNOWN';
  }
}

function rfc822(message: OutboundMessage): string {
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to.join(', ')}`,
    message.cc?.length ? `Cc: ${message.cc.join(', ')}` : '',
    message.bcc?.length ? `Bcc: ${message.bcc.join(', ')}` : '',
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : '',
    message.references?.length ? `References: ${message.references.join(' ')}` : '',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${message.text}`;
}

async function postJson(provider: string, url: string, token: string, body: string, fetchImpl: FetchLike, read: (body: string) => { providerMessageId: string | null; threadId: string | null }, correlationId = `${provider}-request`): Promise<ProviderSendResult> {
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, redirect: 'manual' });
    if (redirected(response.status)) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: response.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    if (response.status === 401 || response.status === 400 || response.status === 403 || response.status === 404) {
      return { acceptance: 'REJECTED', providerMessageId: null, threadId: null, httpStatus: response.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    if (response.status === 429 || response.status >= 500) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: response.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    if (!response.ok && response.status !== 202) {
      return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: response.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
    }
    const text = await response.text();
    const parsed = text ? read(text) : { providerMessageId: null, threadId: null };
    return { acceptance: 'ACCEPTED', providerMessageId: parsed.providerMessageId, threadId: parsed.threadId, httpStatus: response.status, correlationId, retryable: false, capability: 'STUB_TESTED' };
  } catch {
    return { acceptance: 'UNKNOWN', providerMessageId: null, threadId: null, httpStatus: null, correlationId, retryable: false, capability: 'STUB_TESTED' };
  }
}
