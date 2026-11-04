import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { e2eDatabaseName, loadRootEnv, repoRoot } from './env';

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<unknown>;
  };
};

export default async function globalTeardown(): Promise<void> {
  const source = loadRootEnv();
  const admin = new Client({ connectionString: source.DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [e2eDatabaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${e2eDatabaseName}`);
  } finally {
    await admin.end();
  }
}
