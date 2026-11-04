import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(path)) config({ path, override: false });
}
process.env.SALESOS_QUEUE_PREFIX ??= 'vitest';
