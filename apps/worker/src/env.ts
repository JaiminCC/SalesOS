import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(path)) config({ path, override: false });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL_WORKER: z.string().min(1),
  DATA_ENCRYPTION_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SALESOS_QUEUE_PREFIX: z.string().default(''),
  SALESOS_STORAGE_ROOT: z.string().optional(),
  SALESOS_KNOWLEDGE_MAX_BYTES: z.coerce.number().int().positive().max(20_000_000).default(5_242_880),
  SALESOS_EMBEDDING_PROVIDER: z.enum(['disabled', 'test', 'http']).default('disabled'),
  SALESOS_EMBEDDING_URL: z.string().optional(),
  SALESOS_EMBEDDING_MODEL: z.string().default('configured-embedding'),
  CI: z.string().optional(),
}).superRefine((value, context) => {
  if (value.SALESOS_EMBEDDING_PROVIDER === 'http' && (value.NODE_ENV === 'test' || value.CI === 'true')) {
    context.addIssue({ code: 'custom', path: ['SALESOS_EMBEDDING_PROVIDER'], message: 'Hosted embedding APIs are disabled when NODE_ENV=test or CI=true' });
  }
});

export type WorkerEnv = z.infer<typeof schema>;

export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  return schema.parse(source);
}
