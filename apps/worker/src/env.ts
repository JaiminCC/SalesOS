import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(path)) config({ path, override: false });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL_APP: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof schema>;

export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  return schema.parse(source);
}
