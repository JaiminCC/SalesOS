import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { e2eProcessEnv, loadRootEnv, repoRoot } from './env';

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
};

const password = 'browser-manage-pass';
const env = e2eProcessEnv(loadRootEnv());

test('runs management pages without database ids in the address bar', async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const email = `manage-${stamp}@example.com`;
  const organization = `Manage Org ${stamp}`;
  await registerAndSignIn(page, email, 'Manage Owner', organization);

  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByRole('heading', { name: 'Add User' })).toBeVisible();
  await expect(page).not.toHaveURL(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await page.getByLabel('Email').fill(`guest-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace members' })).toBeVisible();
  await page.getByLabel('Search members').fill('Manage Owner');
  await expect(page.getByRole('button', { name: 'Manage Owner' })).toBeVisible();
  await page.getByLabel('Filter by role').selectOption('OWNER');
  await expect(page.getByRole('button', { name: 'Manage Owner' })).toBeVisible();

  await page.getByRole('button', { name: 'Products & Services' }).click();
  await page.getByRole('button', { name: 'Open add page' }).click();
  await expect(page.getByRole('heading', { name: 'Add Product' })).toBeVisible();
  await page.getByLabel('Name').fill('Atlas Kit');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Product Details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atlas Kit' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Atlas Kit');
  await expect(page).not.toHaveURL(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  await page.getByRole('button', { name: 'Products & Services' }).click();
  await page.getByLabel('New product name').fill('Beacon Kit');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('button', { name: /Beacon Kit/ })).toBeVisible();
  await openOtherTab(context, page, 'Beacon Kit');
  await page.getByRole('button', { name: /Atlas Kit/ }).click();
  await page.getByRole('button', { name: 'Open product editor' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Atlas Kit');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /Beacon Kit/ }).click();
  await page.getByRole('tab', { name: 'ICP' }).click();
  await page.getByRole('button', { name: 'Open ICP page' }).click();
  await expect(page.getByRole('heading', { name: 'Add ICP' })).toBeVisible();
  await page.getByLabel('Name').fill('Beacon buyers');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ICP added.')).toBeVisible();
  await page.getByRole('tab', { name: 'Knowledge' }).click();
  await page.getByLabel('Knowledge file').setInputFiles({ name: 'beacon.md', mimeType: 'text/markdown', buffer: Buffer.from('# Beacon\n\nApproved beacon notes.\n') });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByText('PENDING_APPROVAL')).toBeVisible();
  await page.getByLabel('Document status').selectOption('PENDING_APPROVAL');
  await page.getByLabel('Document sort').selectOption('fileName:asc');
  await page.getByRole('button', { name: 'Apply document filters' }).click();
  await expect(page.getByText('beacon.md')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('beacon.md');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete document' }).click();
  await expect(page.getByText('Document deleted.')).toBeVisible();
  const documents = await queryRows<{ status: string; sha256: string }>(
    `SELECT d.status, d.sha256
     FROM knowledge_documents d
     JOIN products p ON p.tenant_id = d.tenant_id AND p.id = d.product_id
     JOIN tenants t ON t.id = d.tenant_id
     WHERE t.name = $1 AND p.name = 'Beacon Kit' AND d.file_name = 'beacon.md'`,
    [organization],
  );
  expect(documents).toHaveLength(1);
  expect(documents[0]).toEqual(expect.objectContaining({ status: 'DELETED' }));
  expect(documents[0]?.sha256.startsWith('deleted:')).toBe(true);

  await page.getByRole('button', { name: /Atlas Kit/ }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Atlas Kit');
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Product archived.')).toBeVisible();

  await page.getByLabel('Select Beacon Kit').check();
  await page.getByRole('button', { name: 'Archive selected' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Selected products archived.')).toBeVisible();

  await page.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await page.getByLabel('New organization').fill(`Empty Org ${stamp}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByRole('button', { name: 'Products & Services' }).click();
  await expect(page.getByText('No products match this view.')).toBeVisible();
});

test('removes selected members and revokes another session', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const email = `bulk-${stamp}@example.com`;
  const organization = `Bulk Org ${stamp}`;
  const guests = [
    { name: 'Guest One', email: `guest-one-${stamp}@example.com` },
    { name: 'Guest Two', email: `guest-two-${stamp}@example.com` },
  ];
  await registerAndSignIn(page, email, 'Bulk Owner', organization);
  await page.getByRole('button', { name: 'Users & Roles' }).click();
  for (const guest of guests) {
    await page.getByLabel('Invite email').fill(guest.email);
    await page.getByRole('button', { name: 'Invite user' }).click();
    await expect(page.getByText('Invitation captured locally. No external email was sent.')).toBeVisible();
  }
  for (const guest of guests) {
    const invitation = await captured('invitation', guest.email);
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await registerAndSignIn(guestPage, guest.email, guest.name, `${guest.name} Org ${stamp}`);
    await guestPage.goto(`/?invite=${encodeURIComponent(invitation)}`);
    await expect(guestPage.getByText(guest.name, { exact: true })).toBeVisible();
    await guestPage.getByRole('button', { name: 'AI & Workspace Settings' }).click();
    await guestPage.getByLabel('Active workspace').selectOption({ label: organization });
    await expect(guestPage.getByText(organization).first()).toBeVisible();
    await guestContext.close();
  }

  await page.reload();
  await expect(page.getByText('Bulk Owner')).toBeVisible();
  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await page.getByLabel('Select Guest One').check();
  await page.getByLabel('Select Guest Two').check();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove members' }).click();
  await expect(page.getByText('Selected members were removed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guest One' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guest Two' })).toHaveCount(0);
  const memberships = await queryRows<{ display_name: string; status: string }>(
    `SELECT u.display_name, m.status
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN tenants t ON t.id = m.tenant_id
     WHERE t.name = $1 AND u.display_name IN ('Guest One', 'Guest Two')
     ORDER BY u.display_name`,
    [organization],
  );
  expect(memberships).toEqual([
    { display_name: 'Guest One', status: 'REMOVED' },
    { display_name: 'Guest Two', status: 'REMOVED' },
  ]);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/');
  await otherPage.getByLabel('Business email').fill(email);
  await otherPage.getByLabel('Password').fill(password);
  await otherPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(otherPage.getByText('Bulk Owner')).toBeVisible();
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked.')).toBeVisible();
  await otherPage.reload();
  await expect(otherPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const sessions = await queryRows<{ revoked: number; live: number }>(
    `SELECT count(*) FILTER (WHERE s.revoked_at IS NOT NULL)::int AS revoked,
            count(*) FILTER (WHERE s.revoked_at IS NULL)::int AS live
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN tenants t ON t.id = s.active_tenant_id
     WHERE u.display_name = 'Bulk Owner' AND t.name = $1`,
    [organization],
  );
  expect(Number(sessions[0]?.revoked)).toBeGreaterThanOrEqual(1);
  expect(Number(sessions[0]?.live)).toBeGreaterThanOrEqual(1);
  await other.close();
});

async function openOtherTab(context: BrowserContext, first: Page, name: string): Promise<void> {
  const second = await context.newPage();
  await second.goto(first.url());
  await second.getByRole('button', { name: 'Products & Services' }).click();
  await second.getByRole('button', { name: new RegExp(name) }).click();
  await second.getByRole('button', { name: 'Open product editor' }).click();
  await expect(second.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await second.reload();
  await expect(second.getByRole('heading', { name: 'Edit Product' })).toBeVisible();
  await expect(second.getByRole('textbox', { name: 'Name' })).toHaveValue(name);
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
    const result = await client.query<T>(text, values);
    return result.rows;
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
