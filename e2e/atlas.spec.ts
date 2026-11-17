import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Collect runtime errors so the journey fails on any console error, not only on assertions. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * The node's interactive surface is the inner `role="button"` group; the outer
 * `.map-node` is only the positioned wrapper (so the collapse badge can be a
 * sibling instead of a button nested inside a button).
 */
const nodeButton = (page: Page) => page.locator('.map-node [role="button"]').first();

/** Tab now moves focus (browser default); a focused SVG node handles Tab itself. */
async function addChildWithKeyboard(page: Page, title: string) {
  await nodeButton(page).focus();
  await page.keyboard.press('Tab');
  const editor = page.getByLabel('Edit node title');
  await expect(editor).toBeVisible();
  await editor.fill(title);
  await editor.press('Enter');
}

test('create, edit, focus, snapshot, search and present', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');

  // Empty state → blank map.
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await expect(page.locator('.map-node')).toHaveCount(1);

  // Add a child with the keyboard and rename it in the inline editor.
  await addChildWithKeyboard(page, 'First branch');
  await expect(page.locator('.map-node')).toHaveCount(2);
  await expect(page.locator('.map-node').filter({ hasText: 'First branch' })).toHaveCount(1);

  // Undo / redo restore both the document and the selection. The rename is its
  // own undo step, so two undos are needed to remove the newly created node.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.map-node')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.map-node')).toHaveCount(2);
  await expect(page.locator('.map-node').filter({ hasText: 'First branch' })).toHaveCount(1);

  // Rich content + content badge on the canvas.
  await page.getByRole('tab', { name: /Inspector/ }).click();
  await page.getByLabel('Map title').waitFor();
  await page.getByRole('tab', { name: 'Tags', exact: true }).click();
  const tagInput = page.getByPlaceholder('Add tags, comma separated');
  await tagInput.fill('alpha, beta');
  await tagInput.press('Enter');
  await expect(page.locator('.tag-chip')).toHaveCount(2);
  await expect(page.locator('.map-node__badges')).toHaveCount(1);

  // Ranked search with filters. Blur the tag input first — global shortcuts are
  // intentionally suppressed while a text field has focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+f');
  const searchInput = page.getByLabel('Search nodes');
  await searchInput.fill('branch');
  await expect(page.locator('.search-results li').first()).toBeVisible();
  await expect(page.locator('.filter-chip').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Focus Mode dims the rest of the tree.
  await page.locator('.map-node').first().click();
  await page.keyboard.press('Shift+F');
  await expect(page.locator('.focus-banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.focus-banner')).toHaveCount(0);

  // Persistent version history.
  await page.getByRole('tab', { name: /History/ }).click();
  await page.getByRole('button', { name: /Save a snapshot/ }).click();
  await expect(page.locator('.history-list__item').first()).toBeVisible();
  await expect(page.locator('.history-list__item').first()).toContainText('Snapshot');

  // Export options include complete-map and multi-page output.
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('dialog', { name: /Export mind map/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete map' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Presentation mode steps through nodes.
  await page.getByRole('button', { name: /Presentation mode/ }).click();
  await page.getByRole('button', { name: /Start presenting/ }).click();
  await expect(page.locator('.presentation-chrome')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.presentation-chrome__count')).toContainText('2 /');
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation-chrome')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('import, export and reload persistence', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Persisted branch');
  await expect(page.locator('.map-node')).toHaveCount(2);

  // Auto-save writes to IndexedDB; reload should restore the same map.
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');
  await page.reload();
  await expect(page.locator('.map-node').filter({ hasText: 'Persisted branch' })).toHaveCount(1);

  // A Markdown import is validated and creates a fresh document.
  await page.keyboard.press('Control+Shift+i');
  await expect(page.getByRole('dialog', { name: /Import a mind map/ })).toBeVisible();
  await page.getByLabel('Or paste JSON').fill('# Imported plan\n- Discovery\n  - Interviews\n- Delivery\n');
  await page.getByRole('button', { name: 'Import JSON' }).click();
  await expect(page.locator('.map-node').filter({ hasText: 'Discovery' })).toHaveCount(1);

  // Export the actual JSON file and verify its contents, not just the button.
  await page.keyboard.press('Control+e');
  await page.locator('.export-format').filter({ hasText: 'JSON' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
    format: string;
    version: number;
    integrity: string;
    doc: { version: number; nodes: Record<string, { title: string }> };
  };
  expect(exported.format).toBe('atlas-map');
  expect(exported.version).toBe(1);
  expect(exported.integrity).toBeTruthy();
  expect(exported.doc.version).toBe(2);
  expect(Object.values(exported.doc.nodes).map((node) => node.title)).toContain('Discovery');
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  expect(errors).toEqual([]);
});

test('library backup downloads every map and restores it as a copy', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Backup node');
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');

  await page.getByRole('button', { name: 'Settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloadPromise;
  const file = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
    format: string;
    maps: { title: string; doc: { nodes: Record<string, { title: string }> } }[];
  };
  expect(download.suggestedFilename()).toMatch(/^atlas-backup-.*\.json$/);
  expect(file.format).toBe('atlas-backup');
  expect(file.maps.length).toBeGreaterThan(0);
  expect(JSON.stringify(file)).toContain('Backup node');

  // Restoring the same file creates a copy rather than overwriting the original.
  await page.getByLabel('Restore backup file').setInputFiles((await download.path())!);
  await expect(page.locator('.doc-chip__title')).toContainText('restored');
  await expect(page.locator('.map-node').filter({ hasText: 'Backup node' })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('snapshot restore survives a reload', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Snapshot point');
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');

  // Save a named snapshot, then change the map away from it.
  await page.getByRole('tab', { name: /History/ }).click();
  await page.getByRole('button', { name: /Save a snapshot/ }).click();
  await expect(page.locator('.history-list__item').first()).toBeVisible();
  await nodeButton(page).focus();
  await page.keyboard.press('Tab');
  await page.getByLabel('Edit node title').fill('Later change');
  await page.getByLabel('Edit node title').press('Enter');

  // Restoring replaces the live document; with auto-save on the pending write is
  // flushed first, so the restored map must still be present after a reload.
  await page.locator('.history-list__item').first().getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.map-node').filter({ hasText: 'Snapshot point' })).toHaveCount(1);
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');
  await page.reload();
  await expect(page.locator('.map-node').filter({ hasText: 'Snapshot point' })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('keyboard navigation and dialog focus containment', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Tab is no longer hijacked: it moves browser focus instead of adding a node.
  await page.keyboard.press('Tab');
  await expect(page.locator('.map-node')).toHaveCount(1);
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? 'BODY');
  expect(focused).not.toBe('BODY');

  // A focused map node still uses Tab to add exactly one child (no double-fire).
  await addChildWithKeyboard(page, 'Keyboard child');
  await expect(page.locator('.map-node')).toHaveCount(2);

  // Modal traps Tab and restores focus on close.
  await page.keyboard.press('Control+e');
  const dialog = page.getByRole('dialog', { name: /Export mind map/ });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  const trapped = await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement));
  expect(trapped).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('presentation playback and client-side GIF export', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Animated branch');
  await expect(page.locator('.map-node')).toHaveCount(2);

  await page.getByRole('button', { name: /Presentation mode/ }).click();
  await page.getByRole('button', { name: /Start presenting/ }).click();
  await expect(page.locator('.presentation-chrome')).toBeVisible();

  // Play/pause, next/previous and adjustable speed.
  const play = page.getByRole('button', { name: 'Play presentation' });
  const pause = page.getByRole('button', { name: 'Pause presentation' });
  await expect(play).toBeVisible();
  await play.click();
  await expect(pause).toBeVisible();
  await pause.click();
  await page.getByLabel('Playback speed').selectOption('750');
  await page.getByRole('button', { name: 'Next', exact: false }).click();
  await expect(page.locator('.presentation-chrome__count')).toContainText('2 /');
  await page.getByRole('button', { name: 'Previous', exact: false }).click();
  await expect(page.locator('.presentation-chrome__count')).toContainText('1 /');

  // GIF export: all encoding happens in the browser, no network request.
  await page.getByRole('button', { name: /GIF/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Export presentation as GIF/ })).toBeVisible();
  await page.getByRole('button', { name: '480px' }).click();
  await page.getByRole('button', { name: 'Fast' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /Export GIF/ }).click();
  const download = await downloadPromise;
  const bytes = readFileSync((await download.path())!);
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  expect(bytes.length).toBeGreaterThan(200);

  expect(errors).toEqual([]);
});

test('double-click editing, uploads, resize, right-drag selection and SVG export', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.locator('.map-node').first().waitFor();

  // Double-click edits the node title (pointer capture used to eat the event).
  await nodeButton(page).dblclick();
  const editor = page.getByLabel('Edit node title');
  await expect(editor).toBeVisible();
  await editor.fill('Kemon');
  await editor.press('Enter');
  await expect(page.locator('.map-node').filter({ hasText: 'Kemon' })).toHaveCount(1);

  await addChildWithKeyboard(page, 'Heritage');
  await addChildWithKeyboard(page, 'Beauty');
  await expect(page.locator('.map-node')).toHaveCount(3);

  const heritage = page.locator('.map-node').filter({ hasText: 'Heritage' });
  await heritage.locator('[role="button"]').first().click();

  // Focusing a node must not scroll the clipped canvas (that shifted the map).
  expect(await page.locator('.canvas-root').evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);

  // Rich content is reachable from the node itself, not only by scrolling.
  await expect(page.locator('#rich-content-section')).toBeVisible();
  await page.locator('.node-toolbar__btn[aria-label^="Rich content"]').click();
  await expect(page.locator('#rich-content-section.is-highlighted')).toBeVisible();

  // Local image upload: stored as a data URL, shown on the node and in exports.
  await page.getByRole('tab', { name: 'Image', exact: true }).click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByLabel('Upload images').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.content-list--images li')).toHaveCount(1);
  await expect(page.locator('.map-node__image image')).toHaveCount(1);

  // Corner handles resize the selected node in one undoable step.
  await heritage.locator('[role="button"]').first().click();
  const before = (await heritage.boundingBox())!;
  const handle = heritage.locator('[data-resize-corner="se"]');
  await expect(handle).toBeVisible();
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 + 70, { steps: 10 });
  await page.mouse.up();
  const after = (await heritage.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 30);
  // The whole drag is a single history step.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const undone = (await heritage.boundingBox())!;
  expect(undone.width).toBeLessThan(after.width - 30);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);

  // Right-button drag is a marquee; a plain right-click still opens the menu.
  await page.mouse.move(1240, 180);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(340, 640, { steps: 12 });
  await expect(page.locator('.lasso-rect--right')).toBeVisible();
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await expect(page.locator('.bulk-actions .chip')).toContainText('selected');
  await page.mouse.click(400, 120, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu')).toContainText('Add node here');
  await page.keyboard.press('Escape');

  // SVG export keeps the map style and the uploaded image.
  await page.keyboard.press('Control+e');
  await page.locator('.export-format').filter({ hasText: 'SVG' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  const svg = readFileSync((await download.path())!, 'utf8');
  expect(svg).toContain('#f4f6fa'); // canvas background
  expect(svg).toContain('<image href="data:image/'); // uploaded image
  expect(svg).not.toContain('javascript:');

  expect(errors).toEqual([]);
});

test('the node toolbar resets a pinned size back to auto', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  const node = page.locator('.map-node').first();
  await node.locator('[role="button"]').first().click();
  await expect(page.locator('.node-toolbar')).toBeVisible();

  const reset = page.locator('.node-toolbar__btn[aria-label="Reset to auto size"]');
  // A node that already hugs its text has nothing to reset.
  await expect(reset).toHaveCount(0);

  await page.getByRole('tab', { name: /Inspector/ }).click();
  await page.getByLabel('Node width').fill('320');
  await expect(reset).toBeVisible();

  const pinned = (await node.boundingBox())!;
  await reset.click();
  await expect(reset).toHaveCount(0);
  const auto = (await node.boundingBox())!;
  expect(auto.width).toBeLessThan(pinned.width - 40);

  // The toolbar keeps its place over the node as the button leaves.
  const centered = await page.evaluate(() => {
    const bar = document.querySelector('.node-toolbar')!.getBoundingClientRect();
    const target = document.querySelector('.map-node')!.getBoundingClientRect();
    return Math.abs(bar.x + bar.width / 2 - (target.x + target.width / 2));
  });
  expect(centered).toBeLessThan(1.5);

  // One undo step brings the pinned size back, button and all.
  await page.keyboard.press('Control+z');
  await expect(reset).toBeVisible();
});

test('sidebar and rich-content tabs are wired for keyboard users', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.locator('.map-node').first().waitFor();
  await page.locator('.map-node [role="button"]').first().click();

  // Each tab points at its panel, and only the active tab is a tab stop.
  const inspector = page.getByRole('tab', { name: /Inspector/ });
  const outline = page.getByRole('tab', { name: /Outline/ });
  await expect(inspector).toHaveAttribute('aria-controls', 'sidebar-panel-inspector');
  await expect(inspector).toHaveAttribute('tabindex', '0');
  await expect(outline).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#sidebar-panel-inspector')).toHaveAttribute('aria-labelledby', 'sidebar-tab-inspector');

  await inspector.focus();
  await page.keyboard.press('ArrowRight');
  await expect(outline).toBeFocused();
  await expect(outline).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#sidebar-panel-outline')).toBeVisible();
  await expect(page.locator('#sidebar-panel-inspector')).toBeHidden();

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /History/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(inspector).toBeFocused();

  // The rich-content tabs behave the same way.
  const noteTab = page.getByRole('tab', { name: 'Note', exact: true });
  const tagsTab = page.getByRole('tab', { name: 'Tags', exact: true });
  await expect(noteTab).toHaveAttribute('aria-controls', 'content-panel-markdown');
  await noteTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tagsTab).toBeFocused();
  await expect(tagsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#content-panel-tags')).toBeVisible();
  await expect(page.locator('#content-panel-markdown')).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(noteTab).toBeFocused();
  await expect(page.locator('#content-panel-markdown')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a second tab warns about conflicting saves and keeps a recovery copy', async ({ page, context }) => {
  const errorsA = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'From tab A');
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');

  // Deterministic timing: no auto-save while we stage the conflict.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.setting-row', { hasText: 'Auto-save' }).locator('label.switch').click();
  await expect(page.getByLabel('Enable auto-save')).not.toBeChecked();
  await page.keyboard.press('Escape');

  const second = await context.newPage();
  const errorsB = watchConsole(second);
  await second.goto('/');
  await expect(second.locator('.map-node').filter({ hasText: 'From tab A' })).toHaveCount(1);

  // Tab B edits but does not save.
  await second.locator('.map-node [role="button"]').first().focus();
  await second.keyboard.press('Tab');
  await second.getByLabel('Edit node title').fill('From tab B');
  await second.getByLabel('Edit node title').press('Enter');

  // Tab A edits and saves, which publishes a newer revision.
  await page.locator('.map-node [role="button"]').first().focus();
  await page.keyboard.press('Tab');
  await page.getByLabel('Edit node title').fill('From tab A2');
  await page.getByLabel('Edit node title').press('Enter');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => page.locator('.statusbar__group').first().innerText()).toContain('All changes saved');

  // Tab B is warned and its writes are blocked.
  await expect(second.locator('.conflict-banner')).toBeVisible();
  await expect(second.locator('.conflict-banner')).toContainText('another tab');
  await second.getByRole('button', { name: 'Save my copy' }).click();
  await expect(second.locator('.map-node').filter({ hasText: 'From tab B' })).toHaveCount(1);
  await expect(second.locator('.map-node').filter({ hasText: 'From tab A2' })).toHaveCount(0);
  await expect(second.locator('.doc-chip__title')).toContainText('conflict copy');

  // Tab A's version is untouched.
  await expect(page.locator('.map-node').filter({ hasText: 'From tab A2' })).toHaveCount(1);
  await expect(page.locator('.map-node').filter({ hasText: 'From tab B' })).toHaveCount(0);

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
  await second.close();
});

test('re-arrange re-places nodes that were dragged by hand', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Alpha');
  await addChildWithKeyboard(page, 'Beta');

  const alpha = page.locator('.map-node').filter({ hasText: 'Alpha' }).locator('[role="button"]').first();
  const before = (await alpha.boundingBox())!;

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 200, { steps: 12 });
  await page.mouse.up();
  const dragged = (await alpha.boundingBox())!;
  expect(dragged.y).toBeGreaterThan(before.y + 60);

  // The old behaviour skipped manual nodes, so this used to be a no-op.
  await page.getByRole('button', { name: /^Re-arrange$/ }).click();
  await page.waitForTimeout(400);
  const after = (await alpha.boundingBox())!;
  expect(Math.abs(after.y - dragged.y)).toBeGreaterThan(60);
  expect(Math.abs(after.x - before.x)).toBeLessThan(40);
});

test('local images persist, work offline and never request an external URL', async ({ page, context }) => {
  const errors = watchConsole(page);
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:\/\//i.test(url) && !url.includes('127.0.0.1:5173') && !url.includes('localhost:5173')) {
      external.push(url);
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await page.locator('.map-node').first().waitFor();

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByRole('tab', { name: /Inspector/ }).click();
  await page.getByRole('tab', { name: 'Image', exact: true }).click();
  await page.getByLabel('Upload images').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.content-list--images li')).toHaveCount(1);
  const thumbSrc = await page.locator('.content-thumb').first().getAttribute('src');
  expect(thumbSrc).toMatch(/^blob:/);

  // Auto-save must move the bytes into IndexedDB and keep them across a reload.
  await page.waitForTimeout(1400);
  await page.reload();
  await expect(page.locator('.map-node__image image')).toHaveCount(1);

  // Already loaded: image rendering and JSON export must work with no network.
  await context.setOffline(true);
  await expect(page.locator('.map-node__image image')).toHaveAttribute('href', /^blob:/);
  await page.keyboard.press('Control+e');
  await page.locator('.export-format').filter({ hasText: 'JSON' }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const jsonFile = await jsonDownload;
  const json = readFileSync((await jsonFile.path())!, 'utf8');
  expect(json).toMatch(/data:image\/(?:jpeg|webp|png);base64,/);
  await context.setOffline(false);

  // A whole-library backup embeds the same local bytes.
  await page.getByRole('button', { name: 'Settings' }).click();
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backupFile = await backupDownload;
  const backup = JSON.parse(readFileSync((await backupFile.path())!, 'utf8'));
  expect(backup.version).toBe(2);
  expect(backup.maps[0].integrity).toBeTruthy();
  expect(backup.maps[0].doc.nodes[backup.maps[0].doc.rootId].content.images[0].src).toMatch(/^data:image\/(?:jpeg|webp|png);base64,/);

  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('all documented file export formats produce downloadable files', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(page, 'Exported branch');

  const formats: [string, RegExp][] = [
    ['JSON', /\.json$/],
    ['SVG', /\.svg$/],
    ['PNG', /\.png$/],
    ['PDF', /\.pdf$/],
    ['Markdown', /\.md$/],
    ['OPML', /\.opml$/],
    ['CSV', /\.csv$/],
    ['FreeMind', /\.mm$/],
  ];
  for (const [label, extension] of formats) {
    await page.keyboard.press('Control+e');
    await page.locator('.export-format').filter({ hasText: label }).first().click();
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: `Export ${label.toUpperCase()}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(extension);
    expect((await readFileSync((await download.path())!, 'utf8')).length).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test('portable JSON transfers a map with images into a fresh browser profile', async ({ browser }) => {
  const sourceContext = await browser.newContext();
  const source = await sourceContext.newPage();
  await source.goto('/');
  await source.getByRole('button', { name: /Create Blank Map/i }).click();
  await addChildWithKeyboard(source, 'Transferred branch');
  await source.getByRole('tab', { name: /Inspector/ }).click();
  await source.getByRole('tab', { name: 'Image', exact: true }).click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await source.getByLabel('Upload images').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(source.locator('.map-node__image image')).toHaveCount(1);
  await source.waitForTimeout(1_200);
  await source.keyboard.press('Control+e');
  await source.locator('.export-format').filter({ hasText: 'JSON' }).click();
  const downloadPromise = source.waitForEvent('download');
  await source.getByRole('button', { name: 'Export JSON' }).click();
  const file = await downloadPromise;

  const targetContext = await browser.newContext();
  const target = await targetContext.newPage();
  await target.goto('/');
  await target.getByRole('button', { name: /Import JSON/ }).first().click();
  await target.locator('.dropzone input[type=file]').setInputFiles((await file.path())!);
  await expect(target.locator('.map-node').filter({ hasText: 'Transferred branch' })).toHaveCount(1);
  await expect(target.locator('.map-node__image image')).toHaveCount(1);
  await expect(target.locator('.map-node__image image')).toHaveAttribute('href', /^blob:/);

  await sourceContext.close();
  await targetContext.close();
});
