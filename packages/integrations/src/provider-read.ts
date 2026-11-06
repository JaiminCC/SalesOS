import { NotConfiguredError } from './errors';

export type NormalizedMail = {
  providerMessageId: string;
  providerThreadId?: string | null;
  internetMessageId?: string;
  inReplyTo?: string;
  references?: string[];
  sender: string;
  recipients?: string[];
  subject?: string;
  text?: string;
  html?: string;
  receivedAt?: string;
  provenance: 'GMAIL' | 'MICROSOFT_GRAPH';
  attachments?: Array<{ fileName: string; contentType: string; sizeBytes: number }>;
};

export type ProviderCursor = { mode: 'list' | 'history' | 'delta'; token: string | null; historyId: string | null };

export type ProviderReadResult = {
  messages: NormalizedMail[];
  nextCursor: string | null;
  historyId: string | null;
  mode: 'list' | 'history' | 'delta';
  expiredCursor: boolean;
  rateLimited: boolean;
  retryAfterMs: number | null;
  mailboxAddress: string | null;
};

const PAGE = 10;
const GMAIL = 'https://gmail.googleapis.com';
const GRAPH = 'https://graph.microsoft.com';

export async function refreshOAuthToken(
  provider: 'google' | 'microsoft',
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null }> {
  if (!input.refreshToken) throw new NotConfiguredError(provider, 'refresh');
  const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const form = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await providerFetch(fetchImpl, tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (response.status === 429) throw new Error('OAuth refresh was rate limited');
  if (!response.ok) throw new Error(`OAuth refresh failed with ${response.status}`);
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error('OAuth refresh returned no access token');
  return { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresIn: token.expires_in ?? null };
}

export async function readProviderPage(input: { provider: 'google' | 'microsoft'; accessToken: string; cursor: ProviderCursor }, fetchImpl: typeof fetch = fetch): Promise<ProviderReadResult> {
  if (!input.accessToken) throw new NotConfiguredError(input.provider, 'read');
  if (input.provider === 'google') return readGmail(input.accessToken, input.cursor, fetchImpl);
  return readGraph(input.accessToken, input.cursor, fetchImpl);
}

async function readGmail(accessToken: string, cursor: ProviderCursor, fetchImpl: typeof fetch): Promise<ProviderReadResult> {
  if (cursor.mode === 'history' && cursor.historyId) {
    const url = new URL(`${GMAIL}/gmail/v1/users/me/history`);
    url.searchParams.set('startHistoryId', cursor.historyId);
    url.searchParams.set('historyTypes', 'messageAdded');
    url.searchParams.set('maxResults', String(PAGE));
    const response = await providerFetch(fetchImpl, url, { headers: auth(accessToken) });
    if (response.status === 429) return limited(response, 'history', cursor.historyId);
    if (response.status === 404) return empty('list', true);
    if (!response.ok) throw new Error(`Gmail history failed with ${response.status}`);
    const body = await response.json() as { history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>; historyId?: string; nextPageToken?: string };
    const ids = (body.history ?? []).flatMap((row) => row.messagesAdded ?? []).map((item) => item.message).filter((item): item is { id: string; threadId?: string } => Boolean(item?.id));
    const messages = await loadGmailMessages(accessToken, ids.slice(0, PAGE), fetchImpl);
    return { messages, nextCursor: body.nextPageToken ?? null, historyId: body.historyId ?? cursor.historyId, mode: 'history', expiredCursor: false, rateLimited: false, retryAfterMs: null, mailboxAddress: null };
  }
  const url = new URL(`${GMAIL}/gmail/v1/users/me/messages`);
  url.searchParams.set('maxResults', String(PAGE));
  if (cursor.token) url.searchParams.set('pageToken', cursor.token);
  const response = await providerFetch(fetchImpl, url, { headers: auth(accessToken) });
  if (response.status === 429) return limited(response, 'list', cursor.historyId);
  if (!response.ok) throw new Error(`Gmail list failed with ${response.status}`);
  const body = await response.json() as { messages?: Array<{ id: string; threadId?: string }>; nextPageToken?: string };
  const messages = await loadGmailMessages(accessToken, body.messages ?? [], fetchImpl);
  const profile = await providerFetch(fetchImpl, `${GMAIL}/gmail/v1/users/me/profile`, { headers: auth(accessToken) });
  const profileBody = profile.ok ? await profile.json() as { historyId?: string; emailAddress?: string } : {};
  return { messages, nextCursor: body.nextPageToken ?? null, historyId: profileBody.historyId ?? cursor.historyId, mode: body.nextPageToken ? 'list' : 'history', expiredCursor: false, rateLimited: false, retryAfterMs: null, mailboxAddress: profileBody.emailAddress ?? null };
}

async function loadGmailMessages(accessToken: string, ids: Array<{ id: string; threadId?: string }>, fetchImpl: typeof fetch): Promise<NormalizedMail[]> {
  const messages: NormalizedMail[] = [];
  for (const item of ids.slice(0, PAGE)) {
    const response = await providerFetch(fetchImpl, `${GMAIL}/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, { headers: auth(accessToken) });
    if (response.status === 429) throw new Error('Gmail message read was rate limited');
    if (!response.ok) throw new Error(`Gmail message read failed with ${response.status}`);
    const body = await response.json() as { id: string; threadId?: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }>; mimeType?: string; filename?: string; body?: { data?: string; size?: number }; parts?: Array<{ mimeType?: string; filename?: string; body?: { data?: string; size?: number } }> } };
    const headers = body.payload?.headers ?? [];
    const references = header(headers, 'References')?.split(/\s+/).filter(Boolean) ?? [];
    messages.push({
      providerMessageId: body.id,
      providerThreadId: body.threadId ?? item.threadId,
      internetMessageId: header(headers, 'Message-ID') ?? header(headers, 'Message-Id'),
      inReplyTo: header(headers, 'In-Reply-To'),
      references,
      sender: header(headers, 'From') ?? 'unknown',
      recipients: header(headers, 'To')?.split(',').map((value) => value.trim()),
      subject: header(headers, 'Subject'),
      text: gmailText(body.payload),
      receivedAt: body.internalDate ? new Date(Number(body.internalDate)).toISOString() : undefined,
      provenance: 'GMAIL',
      attachments: gmailAttachments(body.payload),
    });
  }
  return messages;
}

async function readGraph(accessToken: string, cursor: ProviderCursor, fetchImpl: typeof fetch): Promise<ProviderReadResult> {
  const url = cursor.token && allowedGraphUrl(cursor.token) ? cursor.token : `${GRAPH}/v1.0/me/mailFolders/inbox/messages/delta?$top=${PAGE}`;
  if (cursor.token && !allowedGraphUrl(cursor.token)) return empty('delta', true);
  const profile = await providerFetch(fetchImpl, `${GRAPH}/v1.0/me?$select=mail`, { headers: auth(accessToken) });
  const profileBody = profile.ok ? await profile.json() as { mail?: string } : {};
  const response = await providerFetch(fetchImpl, url, { headers: auth(accessToken) });
  if (response.status === 429) return limited(response, 'delta', null);
  if (response.status === 410) return empty('delta', true);
  if (!response.ok) throw new Error(`Graph read failed with ${response.status}`);
  const body = await response.json() as { value?: Array<Record<string, unknown>>; '@odata.nextLink'?: string; '@odata.deltaLink'?: string; error?: { code?: string } };
  if (body.error?.code === 'SyncStateNotFound') return empty('delta', true);
  const messages = (body.value ?? []).slice(0, PAGE).map(graphMessage).filter((item) => item.providerMessageId);
  const next = body['@odata.nextLink'] ?? body['@odata.deltaLink'] ?? null;
  if (next && !allowedGraphUrl(next)) return empty('delta', true);
  return { messages, nextCursor: next, historyId: null, mode: 'delta', expiredCursor: false, rateLimited: false, retryAfterMs: null, mailboxAddress: profileBody.mail ?? null };
}

function graphMessage(row: Record<string, unknown>): NormalizedMail {
  const from = row.from as { emailAddress?: { address?: string } } | undefined;
  const to = row.toRecipients as Array<{ emailAddress?: { address?: string } }> | undefined;
  const headers = row.internetMessageHeaders as Array<{ name: string; value: string }> | undefined;
  const body = row.body as { contentType?: string; content?: string } | undefined;
  return {
    providerMessageId: String(row.id ?? ''),
    providerThreadId: typeof row.conversationId === 'string' ? row.conversationId : null,
    internetMessageId: typeof row.internetMessageId === 'string' ? row.internetMessageId : header(headers, 'Message-ID'),
    inReplyTo: header(headers, 'In-Reply-To'),
    references: header(headers, 'References')?.split(/\s+/).filter(Boolean),
    sender: from?.emailAddress?.address ?? 'unknown',
    recipients: to?.map((item) => item.emailAddress?.address ?? '').filter(Boolean),
    subject: typeof row.subject === 'string' ? row.subject : undefined,
    text: typeof row.bodyPreview === 'string' ? row.bodyPreview : body?.contentType === 'text' ? body.content : undefined,
    html: body?.contentType === 'html' ? body.content : undefined,
    receivedAt: typeof row.receivedDateTime === 'string' ? row.receivedDateTime : undefined,
    provenance: 'MICROSOFT_GRAPH',
    attachments: graphAttachments(row.attachments),
  };
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function gmailAttachments(payload: { filename?: string; mimeType?: string; body?: { size?: number }; parts?: Array<{ filename?: string; mimeType?: string; body?: { size?: number } }> } | undefined): Array<{ fileName: string; contentType: string; sizeBytes: number }> {
  const parts = [payload, ...(payload?.parts ?? [])].filter((part): part is { filename?: string; mimeType?: string; body?: { size?: number } } => Boolean(part?.filename));
  return parts.slice(0, 20).map((part) => ({ fileName: part.filename ?? 'attachment', contentType: part.mimeType || 'application/octet-stream', sizeBytes: part.body?.size ?? 0 }));
}

function graphAttachments(value: unknown): Array<{ fileName: string; contentType: string; sizeBytes: number }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    const row = item as { name?: string; contentType?: string; size?: number };
    return { fileName: row.name || 'attachment', contentType: row.contentType || 'application/octet-stream', sizeBytes: row.size ?? 0 };
  });
}

function gmailText(payload: { mimeType?: string; body?: { data?: string }; parts?: Array<{ mimeType?: string; body?: { data?: string } }> } | undefined): string | undefined {
  const plain = payload?.mimeType === 'text/plain' ? payload.body?.data : payload?.parts?.find((part) => part.mimeType === 'text/plain')?.body?.data;
  if (!plain) return undefined;
  return Buffer.from(plain.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function allowedGraphUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'graph.microsoft.com' && !url.username && !url.password && (!url.port || url.port === '443') && url.pathname.startsWith('/v1.0/');
  } catch {
    return false;
  }
}

function empty(mode: ProviderReadResult['mode'], expiredCursor: boolean): ProviderReadResult {
  return { messages: [], nextCursor: null, historyId: null, mode, expiredCursor, rateLimited: false, retryAfterMs: null, mailboxAddress: null };
}

async function providerFetch(fetchImpl: typeof fetch, url: string | URL, init: RequestInit): Promise<Response> {
  const response = await fetchImpl(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error('Provider redirect was refused');
  return response;
}

function limited(response: Response, mode: ProviderReadResult['mode'], historyId: string | null): ProviderReadResult {
  const header = response.headers.get('retry-after');
  const seconds = Number(header);
  const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : 1000;
  return { messages: [], nextCursor: null, historyId, mode, expiredCursor: false, rateLimited: true, retryAfterMs, mailboxAddress: null };
}
