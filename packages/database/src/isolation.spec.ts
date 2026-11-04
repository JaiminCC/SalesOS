import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';
import { TENANT_TABLES } from './tenant-tables';
import { withTenant } from './with-tenant';

const appUrl = process.env.DATABASE_URL_APP;
const adminUrl = process.env.DATABASE_URL;
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!appUrl || !adminUrl)('tenant isolation', () => {
  const prisma = createPrismaClient(appUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('forces row level security on every tenant table', async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const result = await admin.query<{ relname: string }>(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1::text[])
           AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`,
        [TENANT_TABLES],
      );
      expect(result.rows).toEqual([]);
      const withTenantId = await admin.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
      );
      const names = withTenantId.rows.map((row) => row.table_name).sort();
      expect(names).toEqual([...TENANT_TABLES].sort());
    } finally {
      await admin.end();
    }
  });

  it('returns no memberships when tenant context is missing', async () => {
    const rows = await prisma.membership.findMany();
    expect(rows).toEqual([]);
  });

  it('does not leak tenant A into the next pooled transaction', async () => {
    const visible = await withTenant(prisma, tenantA, (tx) => tx.membership.findMany());
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((row) => row.tenantId === tenantA)).toBe(true);
    const next = await prisma.membership.findMany();
    expect(next).toEqual([]);
    const other = await withTenant(prisma, tenantA, (tx) =>
      tx.membership.findMany({ where: { tenantId: tenantB } }),
    );
    expect(other).toEqual([]);
  });

  it('denies the application role direct access to platform user rows', async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await expect(app.query('SELECT id FROM users')).rejects.toThrow(/permission denied/i);
    } finally {
      await app.end();
    }
  });

  it('checks tenant activity without granting a tenant table scan', async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      const active = await app.query<{ tenant_is_active: boolean }>('SELECT tenant_is_active($1::uuid)', [tenantA]);
      expect(active.rows[0]?.tenant_is_active).toBe(true);
      const missing = await app.query<{ tenant_is_active: boolean }>(
        'SELECT tenant_is_active($1::uuid)',
        ['99999999-9999-4999-8999-999999999999'],
      );
      expect(missing.rows[0]?.tenant_is_active).toBe(false);
    } finally {
      await app.end();
    }
  });
});
