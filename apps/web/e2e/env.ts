import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = resolve(__dirname, '../../..');
export const e2eDatabaseName = 'salesos_e2e';
export const webOrigin = 'http://127.0.0.1:3020';
export const apiOrigin = 'http://127.0.0.1:3021';

const envKeys = [
  'DATABASE_URL',
  'DATABASE_URL_APP',
  'DATABASE_URL_IDENTITY',
  'DATABASE_URL_WORKER',
  'DATA_ENCRYPTION_KEY',
  'REDIS_URL',
  'SALESOS_APP_PASSWORD',
  'SALESOS_WORKER_PASSWORD',
  'SALESOS_IDENTITY_PASSWORD',
  'INTERNAL_JOB_TOKEN',
] as const;

export function loadRootEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    const text = readFileSync(resolve(repoRoot, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const key of envKeys) {
    const fromProcess = process.env[key];
    if (fromProcess) values[key] = fromProcess;
  }
  if (!values.DATABASE_URL || !values.DATA_ENCRYPTION_KEY) {
    throw new Error('Playwright requires DATABASE_URL and DATA_ENCRYPTION_KEY from .env or the process environment');
  }
  return values;
}

export function withDatabase(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${e2eDatabaseName}`;
  return url.toString();
}

export function e2eProcessEnv(source: Record<string, string>): Record<string, string> {
  return {
    ...source,
    DATABASE_URL: withDatabase(source.DATABASE_URL),
    DATABASE_URL_APP: withDatabase(source.DATABASE_URL_APP),
    DATABASE_URL_IDENTITY: withDatabase(source.DATABASE_URL_IDENTITY),
    DATABASE_URL_WORKER: withDatabase(source.DATABASE_URL_WORKER),
    MAIL_MODE: 'capture',
    SALESOS_QUEUE_PREFIX: 'playwright',
    SALESOS_PROCESS_KNOWLEDGE: 'inline',
    SALESOS_PROCESS_AGENTS: 'inline',
    SALESOS_EMBEDDING_PROVIDER: 'test',
    SALESOS_STORAGE_ROOT: resolve(repoRoot, '.data/e2e-objects'),
    WEB_ORIGIN: webOrigin,
    API_HOST: '127.0.0.1',
    API_PORT: '3021',
    NODE_ENV: 'development',
    NEXT_PUBLIC_API_BASE_URL: apiOrigin,
    META_APP_ID: '',
    META_APP_SECRET: 'salesos-e2e-meta-app-secret-32',
    META_WEBHOOK_VERIFY_TOKEN: 'salesos-e2e-verify-token',
    META_GRAPH_API_VERSION: 'v27.0',
    SALESOS_LIVE_WHATSAPP_SEND_ENABLED: 'false',
    SALESOS_LIVE_EMAIL_SEND_ENABLED: 'false',
    SALESOS_LIVE_CALENDAR_WRITE_ENABLED: 'false',
  };
}
