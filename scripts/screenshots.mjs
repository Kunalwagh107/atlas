/**
 * Regenerate the README screenshots from the production build.
 *
 *   npm run build && npm run preview   # terminal 1 (http://127.0.0.1:4173)
 *   node scripts/screenshots.mjs       # terminal 2
 *
 * Every image in docs/screenshots/ is produced by this script, so the README
 * can never drift from the shipped UI. Pass `--base` to shoot another origin.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:4173';
const OUT = new URL('../docs/screenshots/', import.meta.url);

const DEMO_MARKDOWN = `# Atlas launch plan
- Product
  - Canvas performance
  - Export formats
  - Offline mode
- Marketing
  - Showcase page
  - Launch post
  - Demo video
- Research
  - User interviews
  - Benchmarks
- Design
  - Dark theme
  - Design tokens
`;

/** A smaller map: at 390px a 15-node tree has to shrink to fit. */
const DEMO_MARKDOWN_COMPACT = `# Atlas launch plan
- Product
  - Export formats
  - Offline mode
- Marketing
  - Launch post
- Research
  - Benchmarks
`;

/** The bundled Chromium when installed, otherwise the local Chrome. */
async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: 'chrome' });
  }
}

async function newPage(browser, { width, height, theme = 'light', scale = 1 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  // Theme is a persisted local setting, so seed it before the app boots.
  await context.addInitScript(
    (value) => localStorage.setItem('atlas:local-settings', JSON.stringify({ theme: value })),
    theme,
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('  page error:', error.message));
  return { context, page };
}

/** Build a realistic map through the real import path, so the shot is honest. */
async function seedMap(page, { title = 'Atlas launch plan', rename = true, markdown = DEMO_MARKDOWN } = {}) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Import JSON/i }).click();
  const dialog = page.getByRole('dialog', { name: /Import a mind map/ });
  await dialog.getByLabel('Or paste JSON').fill(markdown);
  await dialog.getByRole('button', { name: 'Import JSON' }).click();
  await page.locator('.map-node').first().waitFor();

  // The import names the document after the file, not the heading. The chip is
  // hidden in the mobile toolbar, so narrow viewports skip the rename.
  if (rename) {
    await page.locator('.doc-chip').click();
    const renameDialog = page.getByRole('dialog', { name: /Rename map/ });
    await renameDialog.locator('#rename-input').fill(title);
    await renameDialog.locator('#rename-input').press('Enter');
    await renameDialog.waitFor({ state: 'detached' });
  }

  // Drop the confirmation toast and clear the selection so no toolbar floats
  // over the map in the shot.
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  if (await dismiss.count()) await dismiss.first().click();
  const canvas = page.locator('.canvas-root');
  const box = await canvas.boundingBox();
  if (box) await page.mouse.click(box.x + 24, box.y + box.height - 40);
  await page.waitForTimeout(700);
}

async function shoot(page, name) {
  const path = new URL(name, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  await page.screenshot({ path, animations: 'disabled' });
  console.log('  ✓', name);
}

const browser = await launch();
await mkdir(OUT, { recursive: true });

// 1. Hero: canvas with a real map.
{
  const { context, page } = await newPage(browser, { width: 1440, height: 1000 });
  await seedMap(page);
  await page.keyboard.press('f'); // fit to screen
  await page.waitForTimeout(500);
  await shoot(page, 'canvas-light.png');
  await context.close();
}

// 2. Export dialog with every format.
{
  const { context, page } = await newPage(browser, { width: 1440, height: 1000 });
  await seedMap(page);
  await page.keyboard.press('Control+e');
  const dialog = page.getByRole('dialog', { name: /Export mind map/ });
  await dialog.waitFor();
  await page.waitForTimeout(400);
  await shoot(page, 'export-dialog.png');
  await context.close();
}

// 3. Presentation mode.
{
  const { context, page } = await newPage(browser, { width: 1440, height: 1000 });
  await seedMap(page);
  await page.getByRole('button', { name: /Presentation mode/ }).click();
  await page.getByRole('button', { name: /Start presenting/ }).click();
  await page.locator('.presentation-chrome').waitFor();
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
  await page.mouse.move(700, 520); // drop the toolbar tooltip
  await page.waitForTimeout(700);
  await shoot(page, 'presentation.png');
  await context.close();
}

// 4. Dark theme.
{
  const { context, page } = await newPage(browser, { width: 1440, height: 1000, theme: 'dark' });
  await seedMap(page);
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  await shoot(page, 'canvas-dark.png');
  await context.close();
}

// 5. Mobile: the map with the sidebar as a drawer.
{
  const { context, page } = await newPage(browser, { width: 390, height: 844, scale: 2 });
  await seedMap(page, { rename: false, markdown: DEMO_MARKDOWN_COMPACT });
  // The toolbar chip is hidden at this width, so rename from the inspector.
  const mapTitle = page.getByLabel('Map title');
  await mapTitle.fill('Atlas launch plan');
  await mapTitle.evaluate((el) => el.blur());
  await page.getByRole('banner').getByRole('button', { name: 'Hide sidebar' }).click();
  // Fit to the drawer-free viewport, then clear the selection so no toolbar
  // floats over the root node. Clicking the control beats the `F` shortcut,
  // which is suppressed while a text field still holds focus.
  await page.getByRole('button', { name: 'Fit to screen' }).last().click();
  await page.mouse.click(195, 700);
  // A fit at 390px leaves a wide map small; two steps in keeps the labels legible.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.mouse.move(195, 300); // dismiss the zoom tooltip
  await page.waitForTimeout(900);
  await shoot(page, 'mobile.png');
  await context.close();
}

await browser.close();
console.log('\nScreenshots written to docs/screenshots/');