import { expect, test, type Page } from '@playwright/test';

async function addChild(page: Page, title: string) {
  await page.locator('.map-node [role="button"]').first().focus();
  await page.keyboard.press('Tab');
  await page.getByLabel('Edit node title').fill(title);
  await page.getByLabel('Edit node title').press('Enter');
}

async function waitForShellCache(page: Page) {
  await expect.poll(async () => page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;
    const keys = await caches.keys();
    const key = keys.find((name) => name.startsWith('atlas-shell-'));
    if (!key) return false;
    const cache = await caches.open(key);
    const requests = await cache.keys();
    return requests.some((request) => /\/assets\/.*\.js$/.test(new URL(request.url).pathname));
  }), { timeout: 30_000 }).toBe(true);
}

test('PWA shell loads after a hard reload while offline', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChild(page, 'Offline child');
  await page.waitForTimeout(1_200);
  await waitForShellCache(page);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.map-node').filter({ hasText: 'Offline child' })).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('All changes saved');
  await context.setOffline(false);
});

test('PWA registers a versioned shell cache', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await waitForShellCache(page);
  const version = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.find((key) => key.startsWith('atlas-shell-')) ?? '';
  });
  expect(version).toMatch(/^atlas-shell-[a-f0-9]{12}$/);
});
