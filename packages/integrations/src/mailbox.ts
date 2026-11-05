import { createHmac, timingSafeEqual } from 'node:crypto';
import { NotConfiguredError } from './errors';

export type MailboxPage = { messages: Array<{ providerMessageId: string; providerThreadId: string }>; nextCursor: string | null };

export async function readGmailPage(accessToken: string, cursor: string | undefined, fetchImpl: typeof fetch = fetch): Promise<MailboxPage> {
  if (!accessToken) throw new NotConfiguredError('Gmail', 'read');
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('maxResults', '25');
  if (cursor) url.searchParams.set('pageToken', cursor);
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Gmail read failed with ${response.status}`);
  const body = await response.json() as { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
  return {
    messages: (body.messages ?? []).map((item) => ({ providerMessageId: item.id, providerThreadId: item.threadId })),
    nextCursor: body.nextPageToken ?? null,
  };
}

export function webhookSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function webhookAuthentic(secret: string, body: string, signature: string): boolean {
  if (!secret || !signature) return false;
  const expected = webhookSignature(secret, body);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchangeOAuthCode(
  provider: 'google' | 'microsoft',
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; email: string | null; mailboxId: string | null }> {
  const tokenUrl = provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const form = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: input.verifier,
  });
  const tokenResponse = await fetchImpl(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!tokenResponse.ok) throw new Error(`OAuth token exchange failed with ${tokenResponse.status}`);
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error('OAuth token exchange returned no access token');
  const profileUrl = provider === 'google'
    ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
    : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,id';
  const profileResponse = await fetchImpl(profileUrl, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error(`OAuth profile read failed with ${profileResponse.status}`);
  const profile = await profileResponse.json() as { emailAddress?: string; mail?: string; userPrincipalName?: string; id?: string };
  const email = profile.emailAddress ?? profile.mail ?? profile.userPrincipalName ?? null;
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresIn: token.expires_in ?? null,
    email,
    mailboxId: profile.id ?? email,
  };
}
