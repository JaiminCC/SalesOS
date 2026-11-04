import { Client } from 'pg';
import './load-env';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing unsafe database identifier: ${name}`);
  }
  return `"${name}"`;
}

async function ensureLoginRole(client: Client, role: string, password: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role)) throw new Error(`Refusing unsafe role name: ${role}`);
  const escaped = password.replace(/'/g, "''");
  await client.query(`
    DO $body$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} LOGIN PASSWORD '${escaped}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE ${role} WITH LOGIN PASSWORD '${escaped}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $body$;
  `);
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const appPassword = required('SALESOS_APP_PASSWORD');
  const workerPassword = required('SALESOS_WORKER_PASSWORD');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureLoginRole(client, 'salesos_app', appPassword);
    await ensureLoginRole(client, 'salesos_worker', workerPassword);
    const database = quoteIdent(databaseName);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO salesos_app`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO salesos_worker`);
  } finally {
    await client.end();
  }
  process.stdout.write('salesos_app and salesos_worker roles are ready\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'role setup failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
