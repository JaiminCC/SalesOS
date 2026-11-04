import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) found.push(full);
  }
  return found;
}

describe('agent-core dependency boundary', () => {
  it('does not import Nest, Prisma, or a vendor SDK', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const forbidden = ['@nestjs/', '@prisma/', 'prisma', 'openai', '@anthropic-ai/', 'bullmq', 'ioredis'];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const token of forbidden) {
        expect(text.includes(`'${token}`) || text.includes(`"${token}`), `${file} imports ${token}`).toBe(false);
      }
    }
  });
});
