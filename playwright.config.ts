import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

// Prefer the bundled Chromium (CI installs it via `playwright install`). When the
// binary is absent — a fresh clone where nobody ran the install — fall back to a
// locally installed Chrome/Edge so `npm run test:e2e` works without a magic env
// var. PLAYWRIGHT_CHANNEL still wins when set explicitly.
function resolveChannel(): 'chrome' | 'msedge' | undefined {
  const explicit = process.env.PLAYWRIGHT_CHANNEL;
  if (explicit === 'chrome' || explicit === 'msedge') return explicit;
  if (explicit === 'bundled' || explicit === 'chromium') return undefined;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* executablePath can throw before browsers are resolved — treat as missing */
  }
  return 'chrome';
}

const channel = resolveChannel();

export default defineConfig({
  testDir: './e2e',
  testIgnore: /pwa\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
