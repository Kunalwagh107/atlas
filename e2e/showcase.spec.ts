import { expect, test, type Page } from '@playwright/test';

function trackExternal(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:\/\//i.test(url) && !url.includes('127.0.0.1') && !url.includes('localhost')) external.push(url);
  });
  return external;
}

test('showcase renders the Atlas hero, demo and product sections', async ({ page }) => {
  const external = trackExternal(page);
  await page.goto('/showcase.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Think in\s+every direction\./);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open Atlas/ })).toHaveAttribute('href', '/');
  await expect(page.getByRole('img', { name: /Animated preview of Atlas/ })).toBeVisible();
  await expect(page.locator('.atlas-window')).toBeVisible();
  await expect(page.locator('.atlas-node')).toHaveCount(6);

  // The poster/result is reachable after the add beat; the new node is real content.
  await page.waitForTimeout(6_400);
  await expect(page.locator('.atlas-new-node[data-added]')).toBeVisible();
  await expect(page.locator('.atlas-new-node')).toContainText('Press kit');
  await expect(page.locator('.atlas-status')).toContainText('All changes saved');
  expect(external).toEqual([]);
});

test('showcase is responsive at a phone width and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/showcase.html');
  await expect(page.locator('.atlas-window')).toHaveAttribute('data-layout', 'compact');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('showcase exposes keyboard navigation and reduced-motion content', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/showcase.html');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await expect(page.locator('.atlas-new-node[data-added]')).toBeVisible();
  await expect(page.locator('.atlas-window')).toBeVisible();
  await expect(page.locator('.feature')).toHaveCount(3);
});
