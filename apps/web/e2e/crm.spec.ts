import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { e2eProcessEnv, loadRootEnv, repoRoot } from './env';

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
};

const password = 'browser-crm-pass';
const env = e2eProcessEnv(loadRootEnv());

test('manages live companies, imports, qualification, and eligibility without sending', async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const email = `crm-${stamp}@example.com`;
  const organization = `CRM Org ${stamp}`;
  await registerAndSignIn(page, email, 'CRM Owner', organization);
  await publishProduct(organization);
  await page.getByRole('button', { name: 'Lead Discovery', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lead intelligence' })).toBeVisible();
  await expect(page.getByText('LIVE')).toBeVisible();

  await page.getByRole('button', { name: 'Add company' }).click();
  await expect(page.getByRole('heading', { name: 'Add company' })).toBeVisible();
  await page.getByLabel('Legal name').fill('Northwind Logistics');
  await page.getByLabel('Website').fill('https://northwind.example');
  await page.getByLabel('Industry').fill('Logistics');
  await page.getByLabel('Country').fill('US');
  await page.getByLabel('Company size').fill('51-200');
  await page.getByLabel('Description').fill('Needs offline barcode capture');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Company saved.')).toBeVisible();
  await expect(page.getByText('Northwind Logistics')).toBeVisible();
  await page.getByLabel('Search').fill('Northwind');
  await page.getByLabel('Page size').selectOption('10');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Northwind Logistics' })).toBeVisible();
  await expect(page).not.toHaveURL(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Northwind Logistics' })).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('button', { name: 'Lead Discovery', exact: true }).click();
  await second.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Edit company' })).toBeVisible();
  await second.reload();
  await expect(second.getByLabel('Legal name')).toHaveValue('Northwind Logistics');
  await second.close();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Name').fill('Ada North');
  await page.getByLabel('Job title').fill('Operations');
  await page.getByLabel('Business email').fill('ada@northwind.example');
  await page.getByLabel('Company').selectOption({ label: 'Northwind Logistics' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Consent stays unknown')).toBeVisible();

  await page.getByRole('button', { name: 'Leads', exact: true }).click();
  await page.getByRole('button', { name: 'Create lead' }).click();
  await page.getByLabel('Company').selectOption({ label: 'Northwind Logistics' });
  await page.getByLabel('Product').selectOption({ label: 'Field Kit' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('not authorized for outreach')).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Run qualification' }).click();
  await expect(page.getByText(/Score \d+\. No message was sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Check eligibility' }).click();
  await expect(page.getByText(/Nothing was sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Assign me as owner' }).click();
  await expect(page.getByText('Takeover was not removed.')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('CSV').fill('companyName,website,industry,country\nAcme Freight,https://acme.example,Logistics,US\n=cmd|calc,https://evil.example,Logistics,US\n,https://missing.example,Logistics,US\n');
  await page.getByRole('button', { name: 'Run import' }).click();
  await expect(page.getByText(/Import (COMPLETED|PARTIAL|FAILED)/)).toBeVisible();

  await page.getByRole('button', { name: 'Discovery', exact: true }).click();
  await expect(page.getByText('LOCAL_ONLY').first()).toBeVisible();
  await page.getByRole('button', { name: 'Run test discovery' }).click();
  await expect(page.getByText('not a live external source')).toBeVisible();
  await expect(page.getByText('live false')).toBeVisible();

  await page.getByRole('button', { name: 'Companies', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Northwind Logistics' }).check();
  await page.getByRole('button', { name: 'Archive selected' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Archive completed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send email' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send WhatsApp' })).toHaveCount(0);
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
      `INSERT INTO product_versions (tenant_id, product_id, version_number, status, snapshot, created_by, updated_by, published_at)
       VALUES ($1, $2, 1, 'PUBLISHED', $3::jsonb, $4, $4, now())`,
      [row.id, product.rows[0]?.id, JSON.stringify({ icps: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Field operators', priority: 1, industries: ['Logistics'], countries: ['US'], companySizes: ['51-200'] }] }), row.user_id],
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
