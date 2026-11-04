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

const password = 'browser-product-pass';
const env = e2eProcessEnv(loadRootEnv());

test('configures a product and keeps another organization isolated', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString();
  const email = `catalog-${stamp}@example.com`;
  const organization = `Catalog Org ${stamp}`;
  await registerAndSignIn(page, email, 'Catalog Owner', organization);

  await page.getByRole('button', { name: 'Products & Services' }).click();
  await expect(page.locator('.proto-badge')).toHaveText(/LIVE DATA/);
  await expect(page.getByText('Live organization data')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Product catalog' })).toBeVisible();

  await page.getByLabel('New product name').fill('Field Kit');
  await page.getByLabel('New product type').selectOption('PHYSICAL');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Field Kit/ })).toBeVisible();

  await page.getByRole('tab', { name: 'ICP' }).click();
  await page.getByLabel('ICP name').fill('Regional operators');
  await page.getByLabel('Target industries').fill('Logistics');
  await page.getByRole('button', { name: 'Add ICP' }).click();
  await expect(page.getByText('ICP added.')).toBeVisible();
  await expect(page.getByText('Regional operators')).toBeVisible();

  await page.getByRole('tab', { name: 'Positioning' }).click();
  await page.getByLabel('Value propositions').fill('Works away from the office');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft positioning saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Knowledge' }).click();
  await page.getByLabel('Knowledge file').setInputFiles({
    name: 'field-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Setup\n\nApproved installation steps for the field kit.\n'),
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByText('PENDING_APPROVAL')).toBeVisible();
  await page.getByRole('button', { name: 'Approve document' }).click();
  await expect(page.getByText('Document approved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Versions' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Draft submitted for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Version approved.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish version' }).click();
  await expect(page.getByText('Version published.')).toBeVisible();

  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Preview published context' }).click();
  await expect(page.getByText('Live agent context uses the published version.')).toBeVisible();
  await expect(page.getByText('Works away from the office')).toBeVisible();
  await expect(page.getByText(/field-notes.md/)).toBeVisible();

  await page.getByRole('button', { name: 'Command Center' }).click();
  await expect(page.locator('.proto-badge')).toHaveText(/SIMULATED/);

  await page.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await page.getByLabel('New organization').fill(`Second Catalog ${stamp}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByText('Organization created and selected.')).toBeVisible();
  await expect(page.locator('.ws-name strong')).toHaveText(`Second Catalog ${stamp}`);
  await page.getByRole('button', { name: 'Products & Services' }).click();
  await expect(page.getByRole('button', { name: /Field Kit/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await page.getByLabel('Active workspace').selectOption({ label: organization });
  await expect(page.locator('.ws-name strong')).toHaveText(organization);
  await page.getByRole('button', { name: 'Products & Services' }).click();
  await expect(page.getByRole('button', { name: /Field Kit/ })).toBeVisible();
});

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
  await expect(page.getByText(name)).toBeVisible();
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
