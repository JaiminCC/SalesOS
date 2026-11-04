import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { e2eDatabaseName, e2eProcessEnv, loadRootEnv, repoRoot } from './env';

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<unknown>;
  };
};

export default async function globalSetup(): Promise<void> {
  const source = loadRootEnv();
  const admin = new Client({ connectionString: source.DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [e2eDatabaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${e2eDatabaseName}`);
    await admin.query(`CREATE DATABASE ${e2eDatabaseName}`);
    await admin.query(`GRANT CONNECT ON DATABASE ${e2eDatabaseName} TO salesos_app, salesos_worker, salesos_identity`);
  } finally {
    await admin.end();
  }
  const migrated = spawnSync('pnpm', ['--filter', '@salesos/database', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    env: { ...process.env, ...e2eProcessEnv(source) },
    encoding: 'utf8',
  });
  if (migrated.status !== 0) {
    throw new Error(migrated.stderr || migrated.stdout || 'e2e migration failed');
  }
}
