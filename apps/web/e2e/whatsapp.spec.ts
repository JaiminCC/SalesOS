import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { apiOrigin, e2eProcessEnv, loadRootEnv } from './env';

const env = e2eProcessEnv(loadRootEnv());
const password = 'browser-whatsapp-pass';
const secret = 'salesos-e2e-meta-app-secret-32';

test('signed-in WhatsApp records a fixture and does not send', async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const name = `Desk ${stamp}`;
  await registerAndSignIn(page, `whatsapp-${stamp}@example.com`, `WhatsApp Owner ${stamp}`, `WhatsApp Org ${stamp}`);
  await page.getByRole('button', { name: 'WhatsApp AI', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/whatsapp$/);
  await expect(page.getByText('LIVE WHATSAPP SENDING DISABLED')).toBeVisible();
  await expect(page.getByText('LIVE META — NOT CONFIGURED')).toBeVisible();
  await expect(page.getByText('REAL WEBHOOK — NOT TESTED')).toBeVisible();
  await expect(page.getByText('LIVE WHATSAPP SEND — NOT AUTHORIZED')).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('A display name and WABA id are required.')).toBeVisible();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('WABA id').fill('123456789012345');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText(name)).toBeVisible();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  await page.getByRole('button', { name: 'Phones', exact: true }).click();
  await page.getByRole('button', { name: 'Add phone' }).click();
  await page.getByLabel('Provider phone id').fill(`1555${stamp.slice(-10)}`);
  await page.getByLabel('Display number').fill('+15550001111');
  await page.getByRole('button', { name: 'Save phone' }).click();
  await expect(page.getByText('+15550001111')).toBeVisible();

  const phoneId = `1555${stamp.slice(-10)}`;
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneId }, messages: [{ from: '15551230000', id: `wamid.E2E.${stamp}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'What is the product?' } }] } }] }] });
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const posted = await page.request.post(`${apiOrigin}/api/v1/webhooks/whatsapp`, { data: Buffer.from(body), headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature } });
  expect(posted.status(), await posted.text()).toBe(200);
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Process received events' }).click();
  await expect(page.getByText('Received events were processed. Nothing was sent.')).toBeVisible();
  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  await expect(page.getByText('+15551230000')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Send/ })).toHaveCount(0);

  const second = await context.newPage();
  await second.goto('/workspace/whatsapp');
  await expect(second.getByText('LIVE WHATSAPP SENDING DISABLED')).toBeVisible();
  await second.reload();
  await second.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(second.getByText(name)).toBeVisible();
  expect(second.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
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
  const { createRequire } = await import('node:module');
  const { resolve } = await import('node:path');
  const { Client } = createRequire(resolve(process.cwd(), '../../packages/database/package.json'))('pg') as { Client: new (config: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> } };
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
