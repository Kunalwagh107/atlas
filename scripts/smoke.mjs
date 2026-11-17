import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url);
await page.getByRole('button', { name: /Create Blank Map/i }).click();
await page.locator('.map-node [role="button"]').first().focus();
await page.keyboard.press('Tab');
await page.getByLabel('Edit node title').fill('Production node');
await page.getByLabel('Edit node title').press('Enter');
await page.waitForTimeout(1400);

// Persistence across a reload.
await page.reload();
const restored = page.locator('.map-node').filter({ hasText: 'Production node' });
await restored.waitFor({ timeout: 10_000 }).catch(() => undefined);
const persisted = await restored.count();

// Export dialog, including the discoverable GIF entry point.
await page.keyboard.press('Control+e');
const exportDialog = page.getByRole('dialog', { name: /Export mind map/ });
const exportOpen = await exportDialog.isVisible();
const gifEntryVisible = await exportDialog.getByRole('button', { name: /Animated GIF/ }).isVisible();
await exportDialog.getByRole('button', { name: /Animated GIF/ }).click();
await expectGifDownload(page);
await page.getByRole('dialog', { name: /Export presentation as GIF/ }).getByRole('button', { name: 'Close', exact: true }).click();

// GIF from Presentation mode still works.
await page.getByRole('button', { name: /Presentation mode/ }).click();
await page.getByRole('button', { name: /Start presenting/ }).click();
await page.getByRole('button', { name: /GIF/ }).first().click();
const presentationGif = await expectGifDownload(page);
await page.getByRole('dialog', { name: /Export presentation as GIF/ }).getByRole('button', { name: 'Close', exact: true }).click();

// Whole-library backup has a checksum and can be restored as a copy.
await page.getByRole('button', { name: 'Settings' }).click();
const backupDownload = page.waitForEvent('download', { timeout: 30_000 });
await page.getByRole('button', { name: 'Download backup' }).click();
const backupFile = await backupDownload;
const backup = JSON.parse(readFileSync(await backupFile.path(), 'utf8'));
await page.getByLabel('Restore backup file').setInputFiles(await backupFile.path());
await page.getByText(/Restored \d+ map/).first().waitFor({ timeout: 10_000 });

// Multi-tab conflict: keep tab A dirty, save a different edit in tab B.
await page.getByRole('button', { name: 'Settings' }).click();
await page.locator('label.switch').filter({ has: page.getByLabel('Enable auto-save') }).click();
await page.keyboard.press('Escape');
await page.locator('.map-node [role="button"]').first().focus();
await page.keyboard.press('Tab');
await page.getByLabel('Edit node title').fill('Dirty in tab A');
await page.getByLabel('Edit node title').press('Enter');

const second = await page.context().newPage();
await second.goto(url);
await second.locator('.map-node [role="button"]').first().waitFor({ timeout: 10_000 });
await second.locator('.map-node [role="button"]').first().focus();
await second.keyboard.press('Tab');
await second.getByLabel('Edit node title').fill('Saved in tab B');
await second.getByLabel('Edit node title').press('Enter');
await second.keyboard.press('Control+s');
await page.locator('.conflict-banner').waitFor({ timeout: 10_000 });
const conflictVisible = await page.locator('.conflict-banner').isVisible();
await second.close();

console.log(JSON.stringify({
  persistedNode: persisted,
  exportDialogOpens: exportOpen,
  gifEntryVisible,
  gifHeader: presentationGif.header,
  gifBytes: presentationGif.bytes,
  backupVersion: backup.version,
  backupChecksum: backup.maps?.[0]?.integrity,
  conflictVisible,
  consoleErrors: errors,
}, null, 2));
await browser.close();

async function expectGifDownload(target) {
  await target.getByRole('button', { name: '480px' }).click();
  const downloadPromise = target.waitForEvent('download', { timeout: 120_000 });
  await target.getByRole('button', { name: /Export GIF/ }).click();
  const download = await downloadPromise;
  const bytes = readFileSync(await download.path());
  return { header: bytes.subarray(0, 6).toString('ascii'), bytes: bytes.length };
}
