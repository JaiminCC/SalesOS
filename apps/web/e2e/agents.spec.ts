import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { e2eProcessEnv, loadRootEnv, repoRoot } from './env';

const { emptySnapshot } = createRequire(resolve(repoRoot, 'packages/shared/package.json'))('@salesos/shared') as {
  emptySnapshot: () => unknown;
};

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
};

const password = 'browser-agent-pass';
const env = e2eProcessEnv(loadRootEnv());

test('manages agents and runs without deleting history or putting ids in the url', async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const email = `agent-${stamp}@example.com`;
  const organization = `Agent Org ${stamp}`;
  await registerAndSignIn(page, email, 'Agent Owner', organization);
  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause automation', exact: true }).click();
  await expect(page.getByText('Automation paused.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume automation', exact: true }).click();
  await expect(page.getByText('Automation resumed.')).toBeVisible();

  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Add model' }).click();
  await expect(page.getByRole('heading', { name: 'Add model' })).toBeVisible();
  await page.getByLabel('Provider').selectOption('openai_compatible');
  await expect(page.getByRole('textbox', { name: 'Endpoint' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Allow loopback HTTP for this' })).toBeVisible();
  await page.getByLabel('Provider').selectOption('ollama');
  await expect(page.getByRole('textbox', { name: 'Endpoint' })).toBeVisible();
  await page.getByLabel('Provider').selectOption('fake');
  await page.getByLabel('Name').fill('Local mock');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Model configuration saved.')).toBeVisible();
  await expect(page.getByText('MOCK')).toBeVisible();
  await publishProduct(organization);

  const goal = 'Research the product and draft a message';
  await page.getByRole('button', { name: 'Execution Inspector', exact: true }).click();
  await page.getByLabel('Goal').fill(goal);
  await page.getByLabel('Product').selectOption({ label: 'Field Kit' });
  await page.getByLabel('Model').selectOption({ label: 'Local mock (MOCK)' });
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/No outbound message was sent/)).toBeVisible();
  await expect(page.getByText('product.context.read').first()).toBeVisible();
  await expect(page.getByText(/Report:/)).toBeVisible();
  await expect(page).not.toHaveURL(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('The run was updated. Its steps were kept.')).toBeVisible();
  await page.getByRole('button', { name: goal }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('The run was updated. Its steps were kept.')).toBeVisible();
  await page.getByRole('button', { name: goal }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel run', exact: true }).click();

  await page.getByLabel('Goal').fill(goal);
  await page.getByLabel('Product').selectOption({ label: 'Field Kit' });
  await page.getByLabel('Model').selectOption({ label: 'Local mock (MOCK)' });
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/No outbound message was sent/)).toBeVisible();
  await page.getByRole('button', { name: /Approval Center/ }).click();
  await page.getByRole('button', { name: 'DRAFT_MESSAGE' }).first().click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved. The proposal was not sent.')).toBeVisible();

  await page.getByRole('button', { name: 'AI Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Add agent' }).click();
  await expect(page.getByRole('heading', { name: 'Add agent' })).toBeVisible();
  await page.getByLabel('Name').fill('Field Agent');
  await page.getByLabel('Role').fill('Researches internal notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Agent saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Field Agent' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit agent' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit agent' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Field Agent');
  await expect(page).not.toHaveURL(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: 'AI Agents', exact: true }).click();
  await second.getByRole('button', { name: 'Sales supervisor' }).click();
  await expect(second.getByRole('heading', { name: 'Sales supervisor' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Name')).toHaveValue('Field Agent');
  await second.close();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Field Agent' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Agent access was updated. History was kept.')).toBeVisible();

  const agents = await queryRows<{ status: string }>(
    `SELECT p.status FROM agent_profiles p JOIN tenants t ON t.id = p.tenant_id WHERE t.name = $1 AND p.name = 'Field Agent'`,
    [organization],
  );
  expect(agents).toEqual([{ status: 'ARCHIVED' }]);
  const runs = await queryRows<{ count: string }>(
    `SELECT count(*)::text AS count FROM agent_runs r JOIN tenants t ON t.id = r.tenant_id WHERE t.name = $1`,
    [organization],
  );
  expect(Number(runs[0]?.count)).toBeGreaterThan(0);
  const sent = await queryRows<{ count: string }>(
    `SELECT count(*)::text AS count FROM agent_actions a JOIN tenants t ON t.id = a.tenant_id WHERE t.name = $1 AND coalesce(a.outcome->>'sent', 'false') = 'true'`,
    [organization],
  );
  expect(Number(sent[0]?.count)).toBe(0);
});

async function publishProduct(organization: string): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const tenant = await client.query<{ id: string; user_id: string }>(
      `SELECT t.id, m.user_id FROM tenants t JOIN memberships m ON m.tenant_id = t.id WHERE t.name = $1 LIMIT 1`,
      [organization],
    );
    const row = tenant.rows[0];
    if (!row) throw new Error('organization missing');
    const product = await client.query<{ id: string }>(
      `INSERT INTO products (tenant_id, name, product_type, created_by, updated_by) VALUES ($1, 'Field Kit', 'PHYSICAL', $2, $2) RETURNING id`,
      [row.id, row.user_id],
    );
    await client.query(
      `INSERT INTO product_versions (tenant_id, product_id, version_number, status, snapshot, created_by, updated_by, published_at) VALUES ($1, $2, 1, 'PUBLISHED', $3::jsonb, $4, $4, now())`,
      [row.id, product.rows[0]?.id, JSON.stringify(emptySnapshot()), row.user_id],
    );
  } finally {
    await client.end();
  }
}

async function registerAndSignIn(page: Page, email: string, name: string, organization: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an organization' }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Organization').fill(organization);
  await page.getByLabel('Business email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const token = await captured('email_verification', email);
  await page.goto(`/?verify=${token}`);
  await page.getByLabel('Business email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function queryRows<T>(text: string, values: unknown[]): Promise<T[]> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function captured(kind: string, email: string): Promise<string> {
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  const hmac = createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const row = await client.query<{ token: string }>(
        `SELECT token FROM captured_messages WHERE kind = $1 AND recipient_hmac = $2 ORDER BY created_at DESC LIMIT 1`,
        [kind, hmac],
      );
      if (row.rows[0]?.token) return row.rows[0].token;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new Error(`missing captured ${kind}`);
  } finally {
    await client.end();
  }
}
