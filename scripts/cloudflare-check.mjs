import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 8788;
const base = `http://127.0.0.1:${port}`;

function fail(message) {
  throw new Error(message);
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('wrangler pages dev did not start in time');
}

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'wrangler', 'pages', 'dev', 'dist', '--port', String(port), '--ip', '127.0.0.1'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

try {
  await waitForServer();
  const checks = {};

  const index = await fetch(`${base}/`);
  const indexHtml = await index.text();
  checks.indexStatus = index.status;
  checks.indexCsp = index.headers.get('content-security-policy') ?? '';
  checks.indexCache = index.headers.get('cache-control') ?? '';
  if (index.status !== 200 || !indexHtml.includes('<div id="root">')) fail('index.html was not served correctly');
  if (!checks.indexCsp.includes("script-src 'self'")) fail('CSP header is missing from index.html');
  if (!/no-cache/i.test(checks.indexCache)) fail('index.html is not served with no-cache');

  const showcase = await fetch(`${base}/showcase.html`);
  const showcaseHtml = await showcase.text();
  checks.showcaseStatus = showcase.status;
  checks.showcaseCsp = showcase.headers.get('content-security-policy') ?? '';
  if (showcase.status !== 200 || !showcaseHtml.includes('showcase-root')) fail('showcase.html was not served correctly');
  if (!checks.showcaseCsp.includes("script-src 'self'")) fail('CSP header is missing from showcase.html');

  const sw = await fetch(`${base}/sw.js`);
  checks.swStatus = sw.status;
  checks.swCache = sw.headers.get('cache-control') ?? '';
  if (sw.status !== 200 || !(await sw.text()).includes('atlas-shell-')) fail('sw.js was not served correctly');
  if (!/no-cache|no-store/i.test(checks.swCache)) fail('sw.js is not served with a revalidation cache policy');

  const assetPath = indexHtml.match(/src="\.?\/?(assets\/[^"]+\.js)"/)?.[1];
  if (!assetPath) fail('could not find the hashed JS asset in index.html');
  const asset = await fetch(`${base}/${assetPath}`);
  checks.assetStatus = asset.status;
  checks.assetCache = asset.headers.get('cache-control') ?? '';
  if (asset.status !== 200 || !/immutable/i.test(checks.assetCache)) fail('hashed assets are not immutable');

  const missing = await fetch(`${base}/definitely-not-a-route`);
  const missingHtml = await missing.text();
  checks.missingStatus = missing.status;
  checks.missingUses404 = missingHtml.includes('404.js') || missingHtml.includes('Atlas lives at');
  if (missing.status !== 404 || !checks.missingUses404) fail('unknown paths do not use 404.html');

  const manifest = await fetch(`${base}/manifest.webmanifest`);
  checks.manifestStatus = manifest.status;
  checks.manifestType = manifest.headers.get('content-type') ?? '';
  if (manifest.status !== 200) fail('manifest.webmanifest was not served');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
  console.error(logs.slice(-4000));
  throw error;
} finally {
  if (process.platform === 'win32' && child.pid) {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
  } else {
    child.kill('SIGTERM');
  }
}
