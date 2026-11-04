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
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.MAIL_MODE === 'capture') {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_MODE'],
      message: 'MAIL_MODE=capture is refused in production',
    });
  }
});

export type ApiEnv = z.infer<typeof schema>;

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return schema.parse(source);
}
