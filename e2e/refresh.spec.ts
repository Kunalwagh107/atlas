import { expect, test } from '@playwright/test';

test('refreshed shell keeps the desktop rhythm and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.locator('.map-node').first().waitFor();

  const shell = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      toolbar: box('.toolbar'),
      sidebar: box('.sidebar'),
      status: box('.statusbar'),
      canvas: box('.canvas-root'),
    };
  });

  expect(shell.overflow).toBeLessThanOrEqual(1);
  expect(shell.toolbar?.height).toBe(60);
  expect(shell.status?.height).toBe(36);
  expect(shell.sidebar?.width).toBe(308);
  expect(shell.canvas?.width).toBeGreaterThan(900);
});

test('refreshed shell stays usable at tablet and phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Create your first mind map/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: /Create Blank Map/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar__header').getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('product tour opens inside the Atlas shell and returns to the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Product tour' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.showcase-view')).toBeVisible();
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /Think in/ })).toBeVisible();
  await expect(page.locator('.atlas-window')).toBeVisible();
  await expect(page.locator('.statusbar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to workspace' }).first().click();
  await expect(page.locator('.showcase-view')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Product tour' })).toBeFocused();
  await expect(page.getByRole('heading', { name: /Create your first mind map/i })).toBeVisible();
});

test('the tour preserves an open map while it is displayed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.locator('.map-node [role="button"]').first().focus();
  await page.keyboard.press('Tab');
  await page.getByLabel('Edit node title').fill('Kept while touring');
  await page.getByLabel('Edit node title').press('Enter');

  await page.getByRole('button', { name: 'Product tour' }).click();
  await expect(page.locator('.showcase-view')).toBeVisible();
  await page.getByRole('button', { name: 'Back to workspace' }).first().click();
  await expect(page.locator('.map-node').filter({ hasText: 'Kept while touring' })).toHaveCount(1);
});

test('the empty state tour link and Escape both close the tour', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page.locator('.showcase-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.showcase-view')).toHaveCount(0);

  await page.getByRole('button', { name: 'Product tour' }).click();
  await expect(page.locator('.showcase-view')).toBeVisible();
  await page.getByRole('button', { name: 'Start mapping' }).click();
  await expect(page.locator('.showcase-view')).toHaveCount(0);
});

test('dark mode applies the refreshed palette without losing readable surfaces', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Dark mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const toolbar = getComputedStyle(document.querySelector('.toolbar')!);
    return {
      canvas: root.getPropertyValue('--canvas-bg').trim(),
      surface: root.getPropertyValue('--surface').trim(),
      toolbar: toolbar.backgroundColor,
    };
  });
  expect(colors.canvas).toBe('#0d1219');
  expect(colors.surface).toBe('#161d28');
  expect(colors.toolbar).not.toBe('rgba(0, 0, 0, 0)');
});

/** WCAG relative luminance of a computed `rgb()` / `rgba()` color. */
function luminance(color: string): number {
  const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test('the product tour button shows its icon and label inside one pill', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Product tour' });
  const box = (await button.boundingBox())!;
  const parts = await button.evaluate((el) => {
    const icon = el.querySelector('svg')!.getBoundingClientRect();
    const label = el.querySelector('span')!.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return { iconWidth: icon.width, iconLeft: icon.left, labelRight: label.right, left: own.left, right: own.right };
  });

  // A fixed 34px square squeezed the icon to nothing and let the label spill
  // out over the pill; the button now takes the width its content needs.
  expect(box.width).toBeGreaterThan(90);
  expect(parts.iconWidth).toBeGreaterThan(12);
  expect(parts.iconLeft).toBeGreaterThanOrEqual(parts.left);
  expect(parts.labelRight).toBeLessThanOrEqual(parts.right + 0.5);

  // The pressed state paints one pill behind both, not over the label.
  await button.click();
  await expect(button).toHaveClass(/is-active/);
  const active = await button.evaluate((el) => {
    const label = el.querySelector('span')!.getBoundingClientRect();
    return { labelRight: label.right, right: el.getBoundingClientRect().right };
  });
  expect(active.labelRight).toBeLessThanOrEqual(active.right + 0.5);
});

test('the tour demo follows the theme instead of mixing a light shell with a dark map', async ({ page }) => {
  await page.goto('/');
  const surfaces = () =>
    page.evaluate(() => {
      const stage = document.querySelector('.atlas-stage .ss-stage')!;
      const side = document.querySelector('.atlas-window .ss-window__side')!;
      const body = document.querySelector('.atlas-body')!;
      const title = document.querySelector('.atlas-doc__title')!;
      const root = document.querySelector('.atlas-node--root .atlas-node__title')!;
      return {
        theme: stage.getAttribute('data-theme'),
        side: getComputedStyle(side).backgroundColor,
        body: getComputedStyle(body).backgroundColor,
        title: getComputedStyle(title).color,
        rootText: getComputedStyle(root).color,
        rootFill: getComputedStyle(root.closest('.atlas-node')!).backgroundColor,
      };
    });

  await page.getByRole('button', { name: 'Product tour' }).click();
  await expect(page.locator('.atlas-window')).toBeVisible();
  const light = await surfaces();
  expect(light.theme).toBe('light');
  expect(luminance(light.side)).toBeGreaterThan(0.8);
  expect(contrast(light.title, light.side)).toBeGreaterThan(4.5);

  // The theme toggle stays in the toolbar while the tour is open.
  await page.getByRole('button', { name: /Dark mode/i }).click();
  await expect(page.locator('.atlas-stage .ss-stage')).toHaveAttribute('data-theme', 'dark');
  const dark = await surfaces();
  expect(luminance(dark.side)).toBeLessThan(0.2);
  expect(luminance(dark.body)).toBeLessThan(0.2);
  expect(contrast(dark.title, dark.side)).toBeGreaterThan(4.5);
  expect(contrast(dark.rootText, dark.rootFill)).toBeGreaterThan(4.5);
});

