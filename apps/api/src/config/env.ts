import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL_APP: z.string().min(1),
  DATABASE_URL_IDENTITY: z.string().min(1),
  DATA_ENCRYPTION_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().min(1),
  INTERNAL_JOB_TOKEN: z.string().min(16),
  SALESOS_QUEUE_PREFIX: z.string().default(''),
  MAIL_MODE: z.enum(['capture', 'disabled']).default('capture'),
  SALESOS_STORAGE_ROOT: z.string().optional(),
  SALESOS_KNOWLEDGE_MAX_BYTES: z.coerce.number().int().positive().max(20_000_000).default(5_242_880),
  SALESOS_PROCESS_KNOWLEDGE: z.enum(['queue', 'inline']).default('queue'),
  SALESOS_PROCESS_AGENTS: z.enum(['queue', 'inline']).default('queue'),
  SALESOS_EMBEDDING_PROVIDER: z.enum(['disabled', 'test', 'http']).default('disabled'),
  SALESOS_EMBEDDING_URL: z.string().optional(),
  SALESOS_EMBEDDING_MODEL: z.string().default('configured-embedding'),
  CI: z.string().optional(),
  SALESOS_LIVE_EMAIL_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
  SALESOS_LIVE_WHATSAPP_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().optional(),
  META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  SALESOS_CAPTURE_WEBHOOK_ENABLED: z.enum(['true', 'false']).default('false'),
  SALESOS_CAPTURE_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.MAIL_MODE === 'capture') {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_MODE'],
      message: 'MAIL_MODE=capture is refused in production',
    });
  }
  if (value.SALESOS_EMBEDDING_PROVIDER === 'http' && (value.NODE_ENV === 'test' || value.CI === 'true')) {
    context.addIssue({
      code: 'custom',
      path: ['SALESOS_EMBEDDING_PROVIDER'],
      message: 'Hosted embedding APIs are disabled when NODE_ENV=test or CI=true',
    });
  }
  if (value.SALESOS_EMBEDDING_PROVIDER === 'http' && !value.SALESOS_EMBEDDING_URL) {
    context.addIssue({
      code: 'custom',
      path: ['SALESOS_EMBEDDING_URL'],
      message: 'SALESOS_EMBEDDING_URL is required for the http embedding provider',
    });
  }
  if (value.SALESOS_LIVE_EMAIL_SEND_ENABLED === 'true' && (value.NODE_ENV === 'test' || value.CI === 'true')) {
    context.addIssue({ code: 'custom', path: ['SALESOS_LIVE_EMAIL_SEND_ENABLED'], message: 'Live email sending is disabled when NODE_ENV=test or CI=true' });
  }
  if (value.SALESOS_LIVE_WHATSAPP_SEND_ENABLED === 'true' && (value.NODE_ENV === 'test' || value.CI === 'true')) {
    context.addIssue({ code: 'custom', path: ['SALESOS_LIVE_WHATSAPP_SEND_ENABLED'], message: 'Live WhatsApp sending is disabled when NODE_ENV=test or CI=true' });
  }
  if (value.NODE_ENV === 'production' && value.SALESOS_CAPTURE_WEBHOOK_ENABLED === 'true') {
    context.addIssue({ code: 'custom', path: ['SALESOS_CAPTURE_WEBHOOK_ENABLED'], message: 'Capture webhooks are refused in production' });
  }
  if (value.SALESOS_CAPTURE_WEBHOOK_ENABLED === 'true' && (value.SALESOS_CAPTURE_WEBHOOK_SECRET ?? '').length < 32) {
    context.addIssue({ code: 'custom', path: ['SALESOS_CAPTURE_WEBHOOK_SECRET'], message: 'Capture webhook secret must be at least 32 characters' });
  }
});

export type ApiEnv = z.infer<typeof schema>;

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return schema.parse(source);
}
