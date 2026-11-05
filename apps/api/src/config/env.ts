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
});

export type ApiEnv = z.infer<typeof schema>;

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return schema.parse(source);
}
