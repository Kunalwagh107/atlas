import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PORT = 4180;
const root = fileURLToPath(new URL('..', import.meta.url));
const swPath = new URL('../dist/sw.js', import.meta.url);

execSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
const original = readFileSync(swPath, 'utf8');
const server = await preview({
  root,
  logLevel: 'error',
  preview: { host: '127.0.0.1', port: PORT },
});
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL === 'msedge' ? 'msedge' : 'chrome',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // Simulate a new deployment: same URL, different bytes. The server sends
  // no-cache for sw.js, so registration.update() sees the new worker.
  writeFileSync(swPath, `${original}\n// deployment update ${Date.now()}\n`, 'utf8');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await page.locator('.update-banner').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.app-shell').waitFor({ timeout: 15_000 });
  console.log(JSON.stringify({ updateBanner: true, reloaded: true }, null, 2));
} finally {
  writeFileSync(swPath, original, 'utf8');
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
