import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { e2eProcessEnv, loadRootEnv } from './env';

const env = e2eProcessEnv(loadRootEnv());

const password = 'browser-calendar-pass';

test('signed-in calendar keeps bookings internal', async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  await registerAndSignIn(page, `calendar-${stamp}@example.com`, `Calendar Owner ${stamp}`, `Calendar Org ${stamp}`);
  await page.getByRole('button', { name: 'Meetings & Notes', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/meetings$/);
  await expect(page.getByText('EXTERNAL CALENDAR WRITES DISABLED')).toBeVisible();
  await expect(page.getByText('LIVE GOOGLE CALENDAR — NOT CONFIGURED')).toBeVisible();
  await expect(page.getByText('LIVE MICROSOFT CALENDAR — NOT CONFIGURED')).toBeVisible();
  await expect(page.getByText('EXTERNAL EVENT CREATION — NOT AUTHORIZED')).toBeVisible();
  await expect(page.getByText('CALENDAR INVITATIONS — NOT AUTHORIZED')).toBeVisible();

  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Display name').fill(`Desk ${stamp}`);
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('NOT_CONFIGURED')).toBeVisible();
  await expect(page.getByText('NOT_AUTHORIZED')).toBeVisible();

  await page.getByRole('button', { name: 'Types', exact: true }).click();
  await page.getByRole('button', { name: 'Add meeting type' }).click();
  await page.getByLabel('Meeting type name').fill('Product demonstration');
  await page.getByRole('button', { name: 'Save meeting type' }).click();
  await expect(page.getByText('Product demonstration')).toBeVisible();

  await page.getByRole('button', { name: 'Policies', exact: true }).click();
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(page.getByText('Working hours saved for this organizer.')).toBeVisible();

  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  await page.getByRole('button', { name: 'Show local slots' }).click();
  await expect(page.getByText('LOCAL_ONLY · READY')).toBeVisible();
  await page.getByRole('button', { name: 'Hold first slot' }).click();
  await expect(page.getByText('Slot held inside SalesOS. Nothing was written to an external calendar.')).toBeVisible();
  await page.getByRole('button', { name: 'Hold first slot' }).click();
  await expect(page.getByText('SLOT_CONFLICT')).toBeVisible();
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await expect(page.getByRole('button', { name: /^Send/ })).toHaveCount(0);

  const second = await context.newPage();
  await second.goto('/workspace/meetings');
  await expect(second.getByText('EXTERNAL CALENDAR WRITES DISABLED')).toBeVisible();
  await second.reload();
  await second.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(second.getByText(`Desk ${stamp}`)).toBeVisible();
});

test('a separate reviewer can approve an internal booking', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString();
  const organization = `Calendar Review Org ${stamp}`;
  await registerAndSignIn(page, `calendar-review-${stamp}@example.com`, `Calendar Review Owner ${stamp}`, organization);
  await page.getByRole('button', { name: 'Meetings & Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Types', exact: true }).click();
  await page.getByRole('button', { name: 'Add meeting type' }).click();
  await page.getByLabel('Meeting type name').fill('Product demonstration');
  await page.getByRole('button', { name: 'Save meeting type' }).click();
  await page.getByRole('button', { name: 'Policies', exact: true }).click();
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(page.getByText('Working hours saved for this organizer.')).toBeVisible();
  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  await page.getByRole('button', { name: 'Show local slots' }).click();
  await expect(page.getByText('LOCAL_ONLY · READY')).toBeVisible();
  await page.getByRole('button', { name: 'Hold first slot' }).click();
  await expect(page.getByText('Slot held inside SalesOS. Nothing was written to an external calendar.')).toBeVisible();
  await page.getByRole('button', { name: 'Create booking request' }).click();
  await expect(page.getByText('Booking request stored. It is not on an external calendar.')).toBeVisible();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Submitted for review. Nothing was written externally.')).toBeVisible();

  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await registerAndSignIn(reviewerPage, `calendar-reviewer-${stamp}@example.com`, `Calendar Reviewer ${stamp}`, `Reviewer Home ${stamp}`);
  await grantReviewer(organization, `Calendar Reviewer ${stamp}`);
  await reviewerPage.reload();
  await reviewerPage.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await reviewerPage.getByLabel('Active workspace').selectOption({ label: organization });
  await expect(reviewerPage.locator('.ws-name')).toContainText(organization);
  await reviewerPage.getByRole('button', { name: 'Meetings & Notes', exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'Requests', exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'Approve' }).click();
  await expect(reviewerPage.getByText('Approved inside SalesOS. Nothing was written to an external calendar.')).toBeVisible();
  await reviewerContext.close();

  await page.reload();
  await page.getByRole('button', { name: 'Meetings & Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Booked inside SalesOS. The external calendar was not updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Reschedule' }).click();
  await expect(page.getByText('Reschedule stored for review. Nothing was written externally.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel meeting' }).click();
  await expect(page.getByText('Meeting cancelled inside SalesOS. No notice was sent.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Google event' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Proposals', exact: true }).click();
  await page.getByLabel('Meeting request').fill('Please schedule a product demonstration from stored availability.');
  await page.getByRole('button', { name: 'Prepare proposal' }).click();
  await expect(page.getByText('Proposal stored for review. It did not book an external calendar.')).toBeVisible();

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await registerAndSignIn(other, `calendar-other-${stamp}@example.com`, `Other Owner ${stamp}`, `Other Calendar Org ${stamp}`);
  await other.getByRole('button', { name: 'Meetings & Notes', exact: true }).click();
  await expect(other.getByText('Warehouse walkthrough')).toHaveCount(0);
  await expect(other.getByText('EXTERNAL CALENDAR WRITES DISABLED')).toBeVisible();
  await otherContext.close();
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

async function grantReviewer(organization: string, displayName: string): Promise<void> {
  const { createRequire } = await import('node:module');
  const { resolve } = await import('node:path');
  const { Client } = createRequire(resolve(process.cwd(), '../../packages/database/package.json'))('pg') as { Client: new (config: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> } };
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
    const role = await client.query<{ id: string; tenant_id: string; user_id: string }>(
      `WITH member AS (
         SELECT t.id AS tenant_id, u.id AS user_id
         FROM tenants t, users u
         WHERE t.name = $1 AND u.display_name = $2
       ), created AS (
         INSERT INTO roles (tenant_id, name, is_system)
         SELECT tenant_id, 'Calendar reviewer', false FROM member
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, tenant_id
       )
       SELECT created.id, created.tenant_id, member.user_id
       FROM created, member`,
      [organization, displayName],
    );
    const row = role.rows[0];
    if (!row) throw new Error('reviewer role was not created');
    for (const permission of ['calendar.meetings.read', 'calendar.bookings.read', 'calendar.bookings.review']) {
      await client.query(`INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [row.tenant_id, row.id, permission]);
    }
    await client.query(`INSERT INTO membership_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [row.tenant_id, row.user_id, row.id]);
  } finally {
    await client.end();
  }
}
