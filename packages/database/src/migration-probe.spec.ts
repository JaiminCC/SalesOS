import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import './load-env';

const adminUrl = process.env.DATABASE_URL;
const probeName = 'salesos_migration_probe';

function deploy(databaseUrl: string) {
  return spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
}

describe.skipIf(!adminUrl || !process.env.DATABASE_URL_WORKER)('migration probe', () => {
  it('applies the migration history on a clean database and again on that database', async () => {
    const admin = new URL(adminUrl as string);
    const probe = new URL(adminUrl as string);
    probe.pathname = `/${probeName}`;
    const maintainer = new Client({ connectionString: admin.toString() });
    await maintainer.connect();
    try {
      await maintainer.query(`DROP DATABASE IF EXISTS ${probeName} WITH (FORCE)`);
      await maintainer.query(`CREATE DATABASE ${probeName}`);
      await maintainer.query(`GRANT CONNECT ON DATABASE ${probeName} TO salesos_app, salesos_worker`);
    } finally {
      await maintainer.end();
    }

    try {
      const first = deploy(probe.toString());
      expect(first.status, first.stderr).toBe(0);
      const second = deploy(probe.toString());
      expect(second.status, second.stderr).toBe(0);
      const check = new Client({ connectionString: probe.toString() });
      await check.connect();
      try {
        const functions = await check.query<{ proname: string }>(
          `SELECT proname FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND proname IN ('tenant_is_active', 'list_pending_outbox')
           ORDER BY proname`,
        );
        expect(functions.rows.map((row) => row.proname)).toEqual(['list_pending_outbox', 'tenant_is_active']);
        const vector = await check.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
        expect(vector.rows.map((row) => row.extname)).toEqual(['vector']);
        const tables = await check.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name IN ('products', 'knowledge_embeddings', 'embedding_indexes')
           ORDER BY table_name`,
        );
        expect(tables.rows.map((row) => row.table_name)).toEqual(['embedding_indexes', 'knowledge_embeddings', 'products']);
        const column = await check.query<{ udt_name: string }>(
          `SELECT udt_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'knowledge_embeddings' AND column_name = 'embedding'`,
        );
        expect(column.rows[0]?.udt_name).toBe('vector');
      } finally {
        await check.end();
      }
    } finally {
      const cleanup = new Client({ connectionString: admin.toString() });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${probeName} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    }
  });
});
