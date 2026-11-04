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

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const password = required('SALESOS_APP_PASSWORD').replace(/'/g, "''");
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      DO $body$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_app') THEN
          CREATE ROLE salesos_app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE salesos_app WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END
      $body$;
    `);
    await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(databaseName)} TO salesos_app`);
  } finally {
    await client.end();
  }
  process.stdout.write('salesos_app role is ready\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'role setup failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
