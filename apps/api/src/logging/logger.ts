const SECRET = /password|token|secret|authorization|ciphertext/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET.test(key) ? '[redacted]' : redact(entry);
    }
    return output;
  }
  return value;
}

export function logInfo(message: string, fields: Record<string, unknown> = {}): void {
  write('info', message, fields);
}

export function logError(message: string, fields: Record<string, unknown> = {}): void {
  write('error', message, fields);
}

function write(level: 'info' | 'error', message: string, fields: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, message, ...(redact(fields) as object) })}\n`,
  );
}
