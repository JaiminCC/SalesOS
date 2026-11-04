import { defineConfig, devices } from '@playwright/test';
import { apiOrigin, e2eProcessEnv, loadRootEnv, repoRoot, webOrigin } from './e2e/env';

const env = e2eProcessEnv(loadRootEnv());

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '../docs/verification/playwright-output',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '../docs/verification/playwright-report' }]]
    : 'list',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @salesos/api dev',
      cwd: repoRoot,
      url: `${apiOrigin}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env,
    },
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3020',
      cwd: repoRoot + '/apps/web',
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env,
    },
  ],
});
