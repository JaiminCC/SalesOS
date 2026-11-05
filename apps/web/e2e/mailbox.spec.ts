import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { e2eProcessEnv, loadRootEnv, repoRoot, apiOrigin, webOrigin } from './env';

const { Client } = createRequire(resolve(repoRoot, 'packages/database/package.json'))('pg') as {
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
};

const password = 'browser-mailbox-pass';
const env = e2eProcessEnv(loadRootEnv());

test('signed-in inbox uses capture mail and does not claim a live send', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString();
  const email = `inbox-${stamp}@example.com`;
  await registerAndSignIn(page, email, 'Inbox Owner', `Inbox Org ${stamp}`);
  await page.getByRole('button', { name: /AI Conversations/ }).click();
  await expect(page).toHaveURL(/\/workspace\/inbox$/);
  await expect(page.getByText('SEND DISABLED')).toBeVisible();
  await expect(page.getByText('Google Workspace: NOT CONFIGURED')).toBeVisible();
  await expect(page.getByText('LIVE SEND NOT CONFIGURED')).toBeVisible();
  await expect(page.getByText('Read-only mailbox. Approval does not send. Capture stays unsent.')).toBeVisible();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await expect(page).toHaveURL(/\/workspace\/inbox\/add$/);
  await page.getByLabel('Mailbox address').fill(`capture-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Mailboxes', exact: true }).click();
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.getByText('No mailbox records')).toBeVisible();
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Sending', exact: true }).click();
  await expect(page.getByText('SEND DISABLED · READ ONLY · SEND SCOPE REQUIRED')).toBeVisible();
  await expect(page.getByText(/Hourly cap 20/)).toBeVisible();
  await expect(page.getByText(/Recipient limit 5/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'SEND NOW' })).toHaveCount(0);
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('inbox links, ownership, drafts, and a second tab stay inside the signed-in mailbox', async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString();
  const email = `inbox-desk-${stamp}@example.com`;
  const organization = `Inbox Desk ${stamp}`;
  await registerAndSignIn(page, email, `Desk Owner ${stamp}`, organization);
  await page.getByRole('button', { name: /AI Conversations/ }).click();
  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await page.getByLabel('Mailbox address').fill(`desk-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await expect(page.getByText('MOCK / CAPTURE MODE · live false')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('cell', { name: 'DISCONNECTED' })).toBeVisible();
  await expect(page.getByText('Mailbox disconnected.')).toBeVisible();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await page.getByLabel('Mailbox address').fill(`live-label-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Capture mailbox').selectOption({ label: `live-label-${stamp}@example.com` });
  await page.getByLabel('Message').fill('Can your product capture barcode scans when the warehouse has no internet?');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await expect(page.getByText('Can your product capture barcode scans when the warehouse has no internet?')).toBeVisible();
  await seedAnalysis(organization);
  await page.reload();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await expect(page.getByText('Can your product capture barcode scans when the warehouse has no internet?')).toBeVisible();
  await expect(page.getByText('AI summary')).toBeVisible();
  await expect(page.getByText('Warehouse barcode scans can be captured offline.')).toBeVisible();
  await expect(page.getByText('ollama gemma4:e4b')).toBeVisible();
  const second = await context.newPage();
  await second.goto('/workspace/inbox');
  await expect(second.getByText('SEND DISABLED')).toBeVisible();
  await second.getByRole('button', { name: 'Drafts', exact: true }).click();
  await expect(second.getByText('No mailbox records')).toBeVisible();
  await expect(page.getByText('Can your product capture barcode scans when the warehouse has no internet?')).toBeVisible();
  await second.close();

  const account = await api(page, '/api/v1/management/accounts/create', { legalName: `Northwind ${stamp}`, displayName: `Northwind ${stamp}` });
  const contact = await api(page, '/api/v1/management/contacts/create', { accountId: account.id, name: `Ada ${stamp}` });
  await api(page, '/api/v1/management/leads/create', { accountId: account.id, contactId: contact.id, sourceType: 'manual' });
  await page.reload();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await page.locator('#link-type').selectOption('contact');
  await page.locator('#link-record').selectOption({ label: `Ada ${stamp}` });
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText('Linked contact')).toBeVisible();
  await page.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByText('Linked contact')).toHaveCount(0);
  await page.locator('#link-type').selectOption('lead');
  await page.locator('#link-record').selectOption({ label: `Northwind ${stamp}` });
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText('Linked lead')).toBeVisible();
  await page.locator('#owner').selectOption({ label: `Desk Owner ${stamp}` });
  await page.getByRole('button', { name: 'Assign owner' }).click();
  await expect(page.getByText('Human owner', { exact: true })).toBeVisible();
  await expect(page.getByText('Human owner assigned. Nothing was sent.')).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Add draft' }).click();
  await page.getByLabel('Mailbox').selectOption({ label: `live-label-${stamp}@example.com` });
  await page.getByLabel('Subject').fill('Reply');
  await page.getByLabel('Body').fill('Offline barcode capture is supported.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/inbox\/view$/);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Submitted for review. Nothing was sent.')).toBeVisible();

  const reviewerEmail = `inbox-review-${stamp}@example.com`;
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await registerAndSignIn(reviewerPage, reviewerEmail, `Desk Reviewer ${stamp}`, `Reviewer Home ${stamp}`);
  await grantReviewer(organization, `Desk Reviewer ${stamp}`, `live-label-${stamp}@example.com`);
  await reviewerPage.reload();
  await reviewerPage.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await reviewerPage.getByLabel('Active workspace').selectOption({ label: organization });
  await expect(reviewerPage.locator('.ws-name')).toContainText(organization);
  await reviewerPage.getByRole('button', { name: /AI Conversations/ }).click();
  await reviewerPage.getByRole('button', { name: 'Approvals', exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'View', exact: true }).click();
  await expect(reviewerPage).toHaveURL(/\/workspace\/inbox\/view$/);
  await reviewerPage.getByRole('button', { name: 'Approve' }).click();
  await expect(reviewerPage.getByText('Approved. Nothing was sent.')).toBeVisible();
  await reviewerContext.close();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByText('Status APPROVED')).toBeVisible();
  await expect(page.getByText('No SEND NOW action while live sending is off.')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Body').fill('Offline barcode capture is supported. Edited.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Approval revoked. The draft was not sent.')).toBeVisible();

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await registerAndSignIn(viewer, `inbox-view-${stamp}@example.com`, `Desk Viewer ${stamp}`, `Viewer Home ${stamp}`);
  await grantMembership(organization, `Desk Viewer ${stamp}`);
  await viewer.reload();
  await viewer.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await viewer.getByLabel('Active workspace').selectOption({ label: organization });
  await expect(viewer.locator('.ws-name')).toContainText(organization);
  await viewer.getByRole('button', { name: /AI Conversations/ }).click();
  await expect(viewer.getByText(`live-label-${stamp}@example.com`)).toHaveCount(0);
  await viewerContext.close();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
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
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function api(page: Page, path: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const cookies = await page.context().cookies(apiOrigin);
  const response = await page.request.post(`${apiOrigin}${path}`, {
    data: body,
    headers: {
      cookie: cookies.map((item) => `${item.name}=${item.value}`).join('; '),
      'x-salesos-csrf': '1',
      origin: webOrigin,
    },
  });
  const payload = await response.json();
  if (!response.ok()) throw new Error(JSON.stringify(payload));
  return payload.data as { id: string };
}

async function seedAnalysis(organization: string): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO mailbox_ai_analyses (tenant_id, thread_id, summary, intent, model_provider, model_name)
       SELECT t.id, th.id, 'Warehouse barcode scans can be captured offline.', 'product_question', 'ollama', 'gemma4:e4b'
       FROM tenants t
       JOIN mailbox_threads th ON th.tenant_id = t.id
       WHERE t.name = $1
       ORDER BY th.created_at DESC
       LIMIT 1`,
      [organization],
    );
  } finally {
    await client.end();
  }
}

async function grantMembership(organization: string, displayName: string): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, status)
       SELECT t.id, u.id, 'ACTIVE' FROM tenants t, users u
       WHERE t.name = $1 AND u.display_name = $2
       ON CONFLICT DO NOTHING`,
      [organization, displayName],
    );
  } finally {
    await client.end();
  }
}

async function grantReviewer(organization: string, displayName: string, address: string): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await grantMembership(organization, displayName);
    const role = await client.query<{ id: string; tenant_id: string; user_id: string }>(
      `WITH member AS (
         SELECT t.id AS tenant_id, u.id AS user_id
         FROM tenants t, users u
         WHERE t.name = $1 AND u.display_name = $2
       ), created AS (
         INSERT INTO roles (tenant_id, name, is_system)
         SELECT tenant_id, 'Mailbox reviewer', false FROM member
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, tenant_id
       )
       SELECT created.id, created.tenant_id, member.user_id
       FROM created, member`,
      [organization, displayName],
    );
    const row = role.rows[0];
    if (!row) throw new Error('reviewer role was not created');
    for (const permission of ['mailbox.read', 'mailbox.review']) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [row.tenant_id, row.id, permission],
      );
    }
    await client.query(
      `INSERT INTO membership_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [row.tenant_id, row.user_id, row.id],
    );
    await client.query(
      `INSERT INTO mailbox_access (tenant_id, connection_id, user_id, access_role)
       SELECT $1, id, $2, 'READ' FROM mailbox_connections WHERE tenant_id = $1 AND address = $3
       ON CONFLICT DO NOTHING`,
      [row.tenant_id, row.user_id, address],
    );
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
    throw new Error('verification mail was not captured');
  } finally {
    await client.end();
  }
}
