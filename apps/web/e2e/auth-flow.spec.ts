import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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

const password = 'browser-session-pass';
const replacement = 'replacement-session';
const env = e2eProcessEnv(loadRootEnv());
const shots = resolve(repoRoot, 'docs/verification');

test('registers, verifies, and manages organizations in the browser', async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  const stamp = Date.now().toString();
  const ownerEmail = `owner-${stamp}@example.com`;
  const guestEmail = `guest-${stamp}@example.com`;
  const owner = await browser.newContext();
  const page = await owner.newPage();

  await page.goto('/');
  await page.getByRole('button', { name: 'Create an organization' }).click();
  await page.getByLabel('Display name').fill('Browser Owner');
  await page.getByLabel('Organization').fill(`Browser Org ${stamp}`);
  await page.getByLabel('Business email').fill(ownerEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('verification message was captured locally')).toBeVisible();

  const verification = await captured('email_verification', ownerEmail);
  await page.goto(`/?verify=${verification}`);
  await expect(page.getByText('Email verified. Sign in with your password.')).toBeVisible();
  await page.getByLabel('Business email').fill(ownerEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Browser Owner')).toBeVisible();
  await page.screenshot({ path: resolve(shots, 'signed-in.png') });

  await page.reload();
  await expect(page.getByText('Browser Owner')).toBeVisible();
  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace members' })).toBeVisible();
  await expect(page.getByText('Live organization data')).toBeVisible();
  await expect(page.getByText('ACTIVE ORGANIZATION · LIVE DIRECTORY')).toBeVisible();
  await expect(page.getByText('Members loaded from the active organization')).toBeVisible();
  await expect(page.locator('.proto-badge')).toHaveText(/LIVE DATA/);
  await expect(page.getByText('Sample tenant memberships')).toHaveCount(0);
  await expect(page.getByText('SIMULATED CONFIGURATION')).toHaveCount(0);
  await expect(page.getByText(`${ownerEmail} · Live membership`)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Role permissions' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'OWNER', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'VIEWER', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Manager', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Owner', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'OWNER has tenant.export' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'VIEWER lacks users.manage' })).toBeVisible();
  await expect(page.locator('.ent-permission-table input')).toHaveCount(0);
  await page.screenshot({ path: resolve(shots, 'users.png') });
  await page.screenshot({ path: resolve(shots, 'roles.png') });
  await page.getByRole('button', { name: 'Command Center' }).click();
  await expect(page.locator('.proto-badge')).toHaveText(/SIMULATED/);
  await expect(page.getByText('Demonstration data')).toBeVisible();
  await page.getByRole('button', { name: 'Audit Logs' }).click();
  await expect(page.getByRole('heading', { name: 'Security and activity events' })).toBeVisible();
  await expect(page.getByText('auth.login')).toBeVisible();
  await page.screenshot({ path: resolve(shots, 'audit.png') });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Business email').fill(ownerEmail);
  await page.getByRole('button', { name: 'Request reset link' }).click();
  await expect(page.getByText('password reset message was captured')).toBeVisible();
  const resetToken = await captured('password_reset', ownerEmail);
  await page.goto(`/?reset=${encodeURIComponent(resetToken)}`);
  await page.getByLabel('New password').fill(replacement);
  await page.getByLabel('Confirm password').fill(replacement);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('Password updated. Sign in with the new password.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByLabel('Business email').fill(ownerEmail);
  await page.getByLabel('Password').fill(replacement);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Browser Owner')).toBeVisible();

  await page.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await page.getByLabel('New organization').fill(`Second Org ${stamp}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByLabel('Active workspace')).toHaveValue(/.+/);
  await expect(page.getByRole('option', { name: `Second Org ${stamp}` })).toHaveCount(1);
  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await expect(page.getByRole('cell', { name: 'OWNER has tenant.export' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Reviewer', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  const secondValue = await page.getByRole('option', { name: `Second Org ${stamp}` }).getAttribute('value');
  const firstName = `Browser Org ${stamp}`;
  await page.getByLabel('Active workspace').selectOption({ label: firstName });
  await expect(page.getByText(firstName).first()).toBeVisible();

  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await page.getByLabel('Invite email').fill(guestEmail);
  await page.getByRole('button', { name: 'Invite user' }).click();
  await expect(page.getByText('Invitation captured locally')).toBeVisible();
  const invitation = await captured('invitation', guestEmail);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await registerAndSignIn(guestPage, guestEmail, 'Browser Guest', `Guest Org ${stamp}`);
  await guestPage.goto(`/?invite=${encodeURIComponent(invitation)}`);
  await expect(guestPage.getByText('Browser Guest')).toBeVisible();
  await guestPage.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await guestPage.getByLabel('Active workspace').selectOption({ label: firstName });
  await expect(guestPage.getByText(firstName).first()).toBeVisible();
  await guestPage.getByRole('button', { name: 'Users & Roles' }).click();
  await expect(guestPage.getByText(`${ownerEmail} · Live membership`)).toBeVisible();
  await expect(guestPage.locator('.proto-badge')).toHaveText(/LIVE DATA/);
  await guestPage.getByLabel('Invite email').fill(`blocked-${stamp}@example.com`);
  await guestPage.getByRole('button', { name: 'Invite user' }).click();
  await expect(guestPage.getByText('You do not have permission for this action')).toBeVisible();
  await guestPage.screenshot({ path: resolve(shots, 'restricted-invite.png') });
  await expect(guestPage.getByRole('cell', { name: 'VIEWER lacks users.manage' })).toBeVisible();
  await expect(guestPage.locator('.ent-permission-table input')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Browser Owner')).toBeVisible();
  await page.getByRole('button', { name: 'Users & Roles' }).click();
  await expect(page.getByLabel('Role for Browser Guest')).toBeVisible();
  await page.getByLabel('Role for Browser Guest').selectOption('VIEWER');
  await expect(page.getByText('Role updated')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'VIEWER lacks users.manage' })).toBeVisible();
  await guestPage.reload();
  await expect(guestPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await guestPage.getByLabel('Business email').fill(guestEmail);
  await guestPage.getByLabel('Password').fill(password);
  await guestPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(guestPage.getByText('Browser Guest')).toBeVisible();
  await guestPage.getByRole('button', { name: 'AI & Workspace Settings' }).click();
  await guestPage.getByLabel('Active workspace').selectOption({ label: firstName });
  await guestPage.getByRole('button', { name: 'Users & Roles' }).click();
  await expect(guestPage.getByRole('cell', { name: 'OWNER has tenant.export' })).toBeVisible();
  await expect(guestPage.getByRole('cell', { name: 'VIEWER lacks users.manage' })).toBeVisible();
  await guestPage.getByLabel('Invite email').fill(`blocked-viewer-${stamp}@example.com`);
  await guestPage.getByRole('button', { name: 'Invite user' }).click();
  await expect(guestPage.getByText('You do not have permission for this action')).toBeVisible();
  const stored = await guestPage.evaluate(() => window.localStorage.getItem('salesos-prototype-v2'));
  expect(stored).toBeTruthy();
  expect(JSON.parse(stored ?? '{}').enterprise?.permissions).toBeUndefined();

  expect(secondValue).toBeTruthy();
  await owner.close();
  await guest.close();
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
