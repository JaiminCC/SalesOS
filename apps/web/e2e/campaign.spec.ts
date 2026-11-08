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

const env = e2eProcessEnv(loadRootEnv());

const password = 'browser-campaign-pass';

test('signed-in campaigns prepare records and do not send', async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const organization = `Campaign Org ${stamp}`;
  await registerAndSignIn(page, `campaign-${stamp}@example.com`, `Campaign Owner ${stamp}`, organization);
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/campaigns$/);
  await expect(page.getByText('EXTERNAL DELIVERY — NOT AUTHORIZED')).toBeVisible();
  await page.getByRole('button', { name: 'Add campaign' }).click();
  await expect(page).toHaveURL(/\/workspace\/campaigns\/add$/);
  await page.getByLabel('Campaign name').fill(`Introduction ${stamp}`);
  await page.getByLabel('Goal').fill('Prepare a grounded draft');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Campaign saved. External delivery stays not authorized.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Introduction ${stamp}`)).toBeVisible();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  await page.getByRole('button', { name: 'Segments', exact: true }).click();
  await page.getByRole('button', { name: 'Add segment' }).click();
  await page.getByLabel('Segment name').fill(`Qualified ${stamp}`);
  await page.getByLabel('Filter value').fill('QUALIFIED');
  await page.getByRole('button', { name: 'Preview audience' }).click();
  await expect(page.getByText(/A match is not permission to send/)).toBeVisible();
  await page.getByRole('button', { name: 'Save segment' }).click();
  await expect(page.getByText('Segment saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Sequences', exact: true }).click();
  await page.getByRole('button', { name: 'Add sequence' }).click();
  await page.getByLabel('Sequence name').fill(`Sequence ${stamp}`);
  await page.getByRole('button', { name: 'Add wait step' }).click();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByRole('button', { name: 'Move up' }).first().click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Sequence saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Sequences', exact: true }).click();
  await expect(page.getByText(`Sequence ${stamp}`)).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Publish sequence' }).click();
  await expect(page.getByText('Sequence version published.')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/workspace\/campaigns\/view$/);
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const second = await context.newPage();
  await second.goto('/workspace/campaigns');
  await expect(second.getByText('EXTERNAL DELIVERY — NOT AUTHORIZED')).toBeVisible();
  await second.close();

  await page.getByLabel('Filters').getByRole('button', { name: 'Analytics', exact: true }).click();
  await expect(page.getByText(/Sent NOT AVAILABLE/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'SEND NOW' })).toHaveCount(0);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await registerAndSignIn(otherPage, `campaign-other-${stamp}@example.com`, `Other Owner ${stamp}`, `Other Org ${stamp}`);
  await otherPage.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await expect(otherPage.getByText(`Introduction ${stamp}`)).toHaveCount(0);
  await other.close();
});

async function registerAndSignIn(page: Page, email: string, name: string, organization: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an organization' }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Organization').fill(organization);
  await page.getByLabel('Business email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const token = await captured(email);
  await page.goto(`/?verify=${token}`);
  await page.getByLabel('Business email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function captured(email: string): Promise<string> {
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  const hmac = createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const row = await client.query<{ token: string }>('SELECT token FROM captured_messages WHERE kind = $1 AND recipient_hmac = $2 ORDER BY created_at DESC LIMIT 1', ['email_verification', hmac]);
      if (row.rows[0]?.token) return row.rows[0].token;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new Error('verification mail was not captured');
  } finally {
    await client.end();
  }
}
