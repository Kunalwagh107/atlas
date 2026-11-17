import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

function resolveChannel(): 'chrome' | 'msedge' | undefined {
  const explicit = process.env.PLAYWRIGHT_CHANNEL;
  if (explicit === 'chrome' || explicit === 'msedge') return explicit;
  if (explicit === 'bundled' || explicit === 'chromium') return undefined;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* treat as missing */
  }
  return 'chrome';
}

const channel = resolveChannel();

export default defineConfig({
  testDir: './e2e',
  testMatch: /pwa\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
