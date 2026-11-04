import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const { Client } = createRequire(resolve(root, 'packages/database/package.json'))('pg');
const databaseName = 'salesos_e2e';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required to drop the Playwright database');
  process.exit(1);
}

const admin = new Client({ connectionString });
await admin.connect();
try {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  console.log(`dropped ${databaseName}`);
} finally {
  await admin.end();
}
