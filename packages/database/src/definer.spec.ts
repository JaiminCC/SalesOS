import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';
import { withTenant } from './with-tenant';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;
const workerUrl = process.env.DATABASE_URL_WORKER;
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!adminUrl || !appUrl || !workerUrl)('security definer privileges', () => {
  const app = createPrismaClient(appUrl as string);
  const worker = createPrismaClient(workerUrl as string);

  afterAll(async () => {
    await app.$disconnect();
    await worker.$disconnect();
  });

  it('keeps application and worker roles from bypassing row security', async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const roles = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolname, rolsuper, rolbypassrls
         FROM pg_roles
         WHERE rolname IN ('salesos_app', 'salesos_worker', 'salesos_definer', 'salesos_outbox')
         ORDER BY rolname`,
      );
      expect(roles.rows).toEqual([
        { rolname: 'salesos_app', rolsuper: false, rolbypassrls: false },
        { rolname: 'salesos_definer', rolsuper: false, rolbypassrls: false },
        { rolname: 'salesos_outbox', rolsuper: false, rolbypassrls: true },
        { rolname: 'salesos_worker', rolsuper: false, rolbypassrls: false },
      ]);
      const functions = await admin.query<{ proname: string; owner: string; search_path: string }>(
        `SELECT p.proname,
                pg_get_userbyid(p.proowner) AS owner,
                (SELECT option FROM unnest(p.proconfig) AS option WHERE option LIKE 'search_path=%') AS search_path
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('tenant_is_active', 'list_pending_outbox')
           AND p.prosecdef
         ORDER BY p.proname`,
      );
      expect(functions.rows).toEqual([
        { proname: 'list_pending_outbox', owner: 'salesos_outbox', search_path: 'search_path=pg_catalog' },
        { proname: 'tenant_is_active', owner: 'salesos_definer', search_path: 'search_path=pg_catalog' },
      ]);
    } finally {
      await admin.end();
    }
  });

  it('lets only the worker role list the outbox and hides payloads', async () => {
    const application = new Client({ connectionString: appUrl });
    const workerClient = new Client({ connectionString: workerUrl });
    await application.connect();
    await workerClient.connect();
    try {
      await expect(application.query('SELECT * FROM public.list_pending_outbox(1)')).rejects.toThrow(/permission denied/i);
      await expect(application.query('SELECT id FROM public.tenants')).rejects.toThrow(/permission denied/i);
      await expect(application.query('SELECT id FROM public.users')).rejects.toThrow(/permission denied/i);
      await expect(workerClient.query('SELECT id FROM public.users')).rejects.toThrow(/permission denied/i);
      await expect(
        workerClient.query('SELECT public.tenant_is_active($1::uuid)', ["'; DROP TABLE public.tenants; --"]),
      ).rejects.toThrow(/invalid input syntax for type uuid/i);
      const listed = await workerClient.query<{ payload?: unknown }>('SELECT * FROM public.list_pending_outbox($1::integer)', [100000]);
      expect(listed.rows.length).toBeLessThanOrEqual(100);
      expect(listed.fields.map((field) => field.name)).toEqual(['tenant_id', 'id', 'event_type', 'aggregate_id', 'attempts']);
      expect(listed.rows.every((row) => row.payload === undefined)).toBe(true);
    } finally {
      await application.end();
      await workerClient.end();
    }
  });

  it('does not reveal suspended tenants or another tenant job through the application role', async () => {
    const admin = new Client({ connectionString: adminUrl });
    const application = new Client({ connectionString: appUrl });
    await admin.connect();
    await application.connect();
    try {
      await admin.query(`UPDATE public.tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenantB]);
      const suspended = await application.query<{ tenant_is_active: boolean }>(
        'SELECT public.tenant_is_active($1::uuid) AS tenant_is_active',
        [tenantB],
      );
      const missing = await application.query<{ tenant_is_active: boolean }>(
        'SELECT public.tenant_is_active($1::uuid) AS tenant_is_active',
        ['99999999-9999-4999-8999-999999999999'],
      );
      expect(suspended.rows[0]?.tenant_is_active).toBe(false);
      expect(missing.rows[0]?.tenant_is_active).toBe(false);
      const visible = await withTenant(app, tenantA, (tx) => tx.outboxEvent.findMany());
      expect(visible.every((row) => row.tenantId === tenantA)).toBe(true);
      const changed = await withTenant(app, tenantA, (tx) =>
        tx.jobExecution.updateMany({
          where: { tenantId: tenantB },
          data: { status: 'FAILED_FINAL', errorCode: 'CROSS_TENANT' },
        }),
      );
      expect(changed.count).toBe(0);
    } finally {
      await admin.query(`UPDATE public.tenants SET status = 'ACTIVE' WHERE id = $1`, [tenantB]);
      await admin.end();
      await application.end();
    }
  });

  it('keeps membership listing and invitation lookup off the application role', async () => {
    const admin = new Client({ connectionString: adminUrl });
    const application = new Client({ connectionString: appUrl });
    await admin.connect();
    await application.connect();
    try {
      const roles = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('salesos_identity', 'salesos_directory') ORDER BY rolname`,
      );
      expect(roles.rows).toEqual([
        { rolname: 'salesos_directory', rolsuper: false, rolbypassrls: true },
        { rolname: 'salesos_identity', rolsuper: false, rolbypassrls: false },
      ]);
      const functions = await admin.query<{ proname: string; owner: string; search_path: string }>(
        `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,
                (SELECT option FROM unnest(p.proconfig) AS option WHERE option LIKE 'search_path=%') AS search_path
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('list_user_memberships', 'lookup_invitation')
         ORDER BY p.proname`,
      );
      expect(functions.rows).toEqual([
        { proname: 'list_user_memberships', owner: 'salesos_directory', search_path: 'search_path=pg_catalog' },
        { proname: 'lookup_invitation', owner: 'salesos_directory', search_path: 'search_path=pg_catalog' },
      ]);
      await expect(application.query('SELECT * FROM public.list_user_memberships($1::uuid)', [tenantA])).rejects.toThrow(/permission denied/i);
      await expect(application.query('SELECT * FROM public.lookup_invitation($1)', ['not-a-token'])).rejects.toThrow(/permission denied/i);
    } finally {
      await admin.end();
      await application.end();
    }
  });
});
