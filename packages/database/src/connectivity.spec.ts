import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('database connectivity', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects and runs a trivial query', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(Number(rows[0]?.ok)).toBe(1);
  });
});
