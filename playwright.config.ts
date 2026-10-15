import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const address = new URL(baseURL);
if (!['127.0.0.1', 'localhost'].includes(address.hostname)) throw new Error('M2 browser checks require a local server.');

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    viewport: { width: 1400, height: 1100 },
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm --filter @aether/game-client exec next dev --hostname 127.0.0.1 --port ${address.port || '3000'}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !!process.env.E2E_BASE_URL || !process.env.CI,
  },
});
