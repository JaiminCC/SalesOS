const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /bearer\s+[a-z0-9._~+/-]+=*/gi;
const SECRET_KEY = /whatsapp|token|secret|authorization|password|api[-_]?key|ciphertext/i;

export function redactText(value: string): string {
  return value.replace(EMAIL, '[email]').replace(BEARER, 'bearer [redacted]');
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactValue(item);
  }
  return output;
}
