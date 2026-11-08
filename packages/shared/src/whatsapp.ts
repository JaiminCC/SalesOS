import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const GRAPH_API_DEFAULT = 'v27.0';
export const GRAPH_API_ALLOWED = ['v22.0', 'v23.0', 'v24.0', 'v25.0', 'v26.0', 'v27.0'] as const;
export const WHATSAPP_PAYLOAD_LIMIT = 1_048_576;
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WHATSAPP_INTENTS = [
  'PRODUCT_INQUIRY',
  'PRICING_QUESTION',
  'FEATURE_QUESTION',
  'DEMO_REQUEST',
  'MEETING_REQUEST',
  'SUPPORT_REQUEST',
  'FOLLOW_UP',
  'NOT_INTERESTED',
  'OPT_OUT',
  'HUMAN_REQUEST',
  'UNKNOWN',
] as const;

export type WhatsAppIntent = (typeof WHATSAPP_INTENTS)[number];
export type WhatsAppWindow = 'WINDOW_OPEN' | 'WINDOW_CLOSED' | 'WINDOW_UNKNOWN';
export type WhatsAppPause = 'before-receipt' | 'after-receipt' | 'during-message' | 'after-message' | 'during-link' | 'after-link' | 'during-draft' | 'after-draft' | 'during-status';
export type WhatsAppReadiness =
  | 'NOT_CONFIGURED'
  | 'CONFIGURATION_INVALID'
  | 'CONFIGURED_UNVERIFIED'
  | 'AUTHORIZATION_REQUIRED'
  | 'WEBHOOK_SETUP_REQUIRED'
  | 'PHONE_VERIFICATION_REQUIRED'
  | 'READY_FOR_READ_VALIDATION'
  | 'LIVE_INBOUND_VERIFIED'
  | 'DEGRADED'
  | 'DISCONNECTED';

const TEMPLATE_ATTRIBUTES = ['contact_first_name', 'company_name', 'product_name'] as const;
const EXACT_OPT_OUT = new Set(['stop', 'unsubscribe', 'opt out', 'opt-out', 'stopall', 'cancel']);

export type MetaEnv = {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_API_VERSION?: string;
  META_EMBEDDED_SIGNUP_CONFIG_ID?: string;
  SALESOS_LIVE_WHATSAPP_SEND_ENABLED?: string;
  NODE_ENV?: string;
  CI?: string;
};

export function graphApiVersion(env: MetaEnv): string {
  const selected = (env.META_GRAPH_API_VERSION || GRAPH_API_DEFAULT).trim();
  if (!(GRAPH_API_ALLOWED as readonly string[]).includes(selected)) {
    throw Object.assign(new Error('UNSAFE_API_VERSION'), { code: 'UNSAFE_API_VERSION' });
  }
  return selected;
}

export function metaAppReadiness(env: MetaEnv): WhatsAppReadiness {
  if (!env.META_APP_ID?.trim()) return 'NOT_CONFIGURED';
  try {
    graphApiVersion(env);
  } catch {
    return 'CONFIGURATION_INVALID';
  }
  const secret = env.META_APP_SECRET?.trim() ?? '';
  const verify = env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? '';
  if (!secret || secret.length < 16 || !verify) return 'CONFIGURATION_INVALID';
  if (!env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim()) return 'CONFIGURED_UNVERIFIED';
  return 'AUTHORIZATION_REQUIRED';
}

export function liveWhatsAppSendEnabled(env: MetaEnv): boolean {
  if (env.NODE_ENV === 'test' || env.CI === 'true') return false;
  return env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED === 'true';
}

export function whatsAppSignature(secret: string, raw: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

export function whatsAppSignatureValid(secret: string, raw: Buffer | string, header: string | undefined): boolean {
  if (!secret || !header?.startsWith('sha256=') || header.length !== `sha256=${''.padEnd(64, 'a')}`.length) return false;
  const expected = whatsAppSignature(secret, raw);
  if (expected.length !== header.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

export function verifyHandshake(input: { mode?: string; token?: string; challenge?: string }, expected: string | undefined): string | null {
  if (input.mode !== 'subscribe' || !expected || !input.token || input.token.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(input.token), Buffer.from(expected))) return null;
  if (!input.challenge || input.challenge.length > 256 || /[\r\n]/.test(input.challenge)) return null;
  return input.challenge;
}

export type WhatsAppEvent = {
  kind: 'message' | 'status';
  phoneNumberId: string;
  id: string;
  timestamp: string;
  messageType?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
};

export function parseWhatsAppEnvelope(value: unknown): WhatsAppEvent[] {
  const root = asRecord(value, 0);
  if (root.object !== 'whatsapp_business_account') throw Object.assign(new Error('INVALID_ENVELOPE'), { code: 'INVALID_ENVELOPE' });
  const entries = asArray(root.entry, 1);
  if (entries.length > 20) throw Object.assign(new Error('PAYLOAD_TOO_WIDE'), { code: 'PAYLOAD_TOO_WIDE' });
  const events: WhatsAppEvent[] = [];
  for (const entry of entries) {
    const changes = asArray(asRecord(entry, 1).changes, 2);
    for (const change of changes) {
      const payload = asRecord(asRecord(change, 2).value, 3);
      const metadata = asRecord(payload.metadata, 4);
      const phoneNumberId = typeof metadata.phone_number_id === 'string' ? metadata.phone_number_id : '';
      if (!/^\d{6,20}$/.test(phoneNumberId)) continue;
      for (const message of asArray(payload.messages, 4)) events.push(readMessage(asRecord(message, 5), phoneNumberId));
      for (const status of asArray(payload.statuses, 4)) {
        const row = asRecord(status, 5);
        const id = typeof row.id === 'string' ? row.id : '';
        const name = row.status;
        if (!id || (name !== 'sent' && name !== 'delivered' && name !== 'read' && name !== 'failed')) continue;
        events.push({ kind: 'status', phoneNumberId, id, timestamp: stamp(row.timestamp), status: name });
      }
    }
  }
  return events.slice(0, 50);
}

export function eventKey(event: WhatsAppEvent): string {
  return createHash('sha256').update(`${event.phoneNumberId}|${event.kind}|${event.id}|${event.status ?? event.messageType ?? ''}`).digest('hex');
}

export function parseE164(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.trim().replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `+${digits}`;
}

export function serviceWindow(lastInbound: Date | null, now: Date): WhatsAppWindow {
  if (!lastInbound) return 'WINDOW_UNKNOWN';
  const age = now.getTime() - lastInbound.getTime();
  if (age < -5 * 60 * 1000) return 'WINDOW_UNKNOWN';
  if (age <= WHATSAPP_SERVICE_WINDOW_MS) return 'WINDOW_OPEN';
  return 'WINDOW_CLOSED';
}

export function optOutCommand(text: string): 'OPT_OUT' | 'REVIEW' | 'NONE' {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, '');
  if (EXACT_OPT_OUT.has(normalized)) return 'OPT_OUT';
  if (/\b(stop|unsubscribe|opt[- ]out)\b/i.test(text)) return 'REVIEW';
  return 'NONE';
}

export function classifyIntent(text: string): { intent: WhatsAppIntent; confidence: number; reviewState: 'PREDICTION' } {
  const value = text.toLowerCase();
  const intent: WhatsAppIntent = /\b(stop|unsubscribe)\b/.test(value)
    ? 'OPT_OUT'
    : /\b(human|agent|person)\b/.test(value)
      ? 'HUMAN_REQUEST'
      : /\bprice|pricing|cost\b/.test(value)
        ? 'PRICING_QUESTION'
        : /\bdemo\b/.test(value)
          ? 'DEMO_REQUEST'
          : /\bmeet|calendar\b/.test(value)
            ? 'MEETING_REQUEST'
            : /\bsupport|help\b/.test(value)
              ? 'SUPPORT_REQUEST'
              : /\bfeature\b/.test(value)
                ? 'FEATURE_QUESTION'
                : /\bnot interested\b/.test(value)
                  ? 'NOT_INTERESTED'
                  : /\bfollow up\b/.test(value)
                    ? 'FOLLOW_UP'
                    : /\bproduct\b/.test(value)
                      ? 'PRODUCT_INQUIRY'
                      : 'UNKNOWN';
  return { intent, confidence: intent === 'UNKNOWN' ? 0.2 : 0.55, reviewState: 'PREDICTION' };
}

export function validateWhatsAppTemplate(body: string): string | null {
  if (!body.trim() || body.length > 4000) return 'TOO_LONG';
  if (/<script|javascript:|\$\{|<\?|on\w+=/i.test(body)) return 'UNSAFE';
  const tokens = body.match(/\{\{[^}]+\}\}/g) ?? [];
  if (tokens.length > 20) return 'TOO_MANY_VARIABLES';
  for (const token of tokens) {
    const inner = token.slice(2, -2).trim();
    if (/^\d{1,2}$/.test(inner)) continue;
    if (!(TEMPLATE_ATTRIBUTES as readonly string[]).includes(inner)) return 'UNKNOWN_VARIABLE';
  }
  return null;
}

export function previewTemplate(body: string, actual: Record<string, string | undefined>, sample: Record<string, string | undefined>): { text: string; unknowns: string[] } {
  const unknowns: string[] = [];
  const text = body.replace(/\{\{([^}]+)\}\}/g, (_match, raw: string) => {
    const key = String(raw).trim();
    if (actual[key]) return actual[key] as string;
    if (sample[key]) return `[sample:${sample[key]}]`;
    unknowns.push(key);
    return `{{${key}}}`;
  });
  return { text, unknowns };
}

export function statusRank(status: string): number {
  if (status === 'read') return 3;
  if (status === 'delivered') return 2;
  if (status === 'sent') return 1;
  if (status === 'failed') return 0;
  return -1;
}

export function reduceStatuses(events: string[]): string | null {
  let best = -1;
  let name: string | null = null;
  for (const event of events) {
    const rank = statusRank(event);
    if (rank > best) {
      best = rank;
      name = event;
    }
  }
  return name;
}

export function acceptWhatsAppReply(facts: string[], modelText?: string): { text: string; source: 'DETERMINISTIC' | 'MODEL'; status: 'AWAITING_REVIEW' | 'BLOCKED' } {
  const fallback = 'Thanks for your message. A person will review a reply. This suggestion was not generated by a model, and sending is disabled.';
  if (!modelText?.trim()) return { text: fallback, source: 'DETERMINISTIC', status: 'AWAITING_REVIEW' };
  const known = facts.join('\n');
  const injection = /ignore (your|all) instructions|send (this|the) message|disable suppression|i sent|message sent/i.test(modelText);
  const numbers = modelText.match(/\d[\d,]*/g) ?? [];
  const inventedNumber = numbers.some((value) => value.length > 1 && !known.includes(value) && !fallback.includes(value));
  if (injection || inventedNumber || modelText.length > 4000) return { text: fallback, source: 'DETERMINISTIC', status: 'AWAITING_REVIEW' };
  return { text: modelText.trim(), source: 'MODEL', status: 'AWAITING_REVIEW' };
}

export function whatsAppDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readMessage(row: Record<string, unknown>, phoneNumberId: string): WhatsAppEvent {
  const type = typeof row.type === 'string' ? row.type : 'unsupported';
  const text = type === 'text'
    ? textOf(row.text)
    : type === 'button'
      ? textOf(row.button)
      : type === 'interactive'
        ? interactiveId(row.interactive)
        : undefined;
  const context = asRecord(row.context, 6);
  return {
    kind: 'message',
    phoneNumberId,
    id: typeof row.id === 'string' ? row.id.slice(0, 180) : '',
    timestamp: stamp(row.timestamp),
    messageType: ['text', 'button', 'interactive', 'image', 'audio', 'video', 'document'].includes(type) ? type : 'unsupported',
    text: text?.slice(0, 4000),
    from: typeof row.from === 'string' ? row.from : undefined,
    replyTo: typeof context.id === 'string' ? context.id : undefined,
  };
}

function textOf(value: unknown): string | undefined {
  const row = asRecord(value, 6);
  return typeof row.body === 'string' ? row.body : typeof row.text === 'string' ? row.text : undefined;
}

function interactiveId(value: unknown): string | undefined {
  const row = asRecord(value, 6);
  const reply = asRecord(row.button_reply ?? row.list_reply, 7);
  return typeof reply.id === 'string' ? reply.id : undefined;
}

function stamp(value: unknown): string {
  const seconds = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(seconds)) return new Date(0).toISOString();
  return new Date(seconds * 1000).toISOString();
}

function asRecord(value: unknown, depth: number): Record<string, unknown> {
  if (depth > 8) throw Object.assign(new Error('PAYLOAD_TOO_DEEP'), { code: 'PAYLOAD_TOO_DEEP' });
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown, depth: number): unknown[] {
  if (depth > 8) throw Object.assign(new Error('PAYLOAD_TOO_DEEP'), { code: 'PAYLOAD_TOO_DEEP' });
  return Array.isArray(value) ? value.slice(0, 50) : [];
}
