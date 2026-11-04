import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL_APP: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().min(1),
  INTERNAL_JOB_TOKEN: z.string().min(16),
});

export type ApiEnv = z.infer<typeof schema>;

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return schema.parse(source);
}
