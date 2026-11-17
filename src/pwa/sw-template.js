/* Atlas service worker. The Vite build injects the version and precache list. */
const VERSION = '__VERSION__';
const CACHE = `atlas-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;
const SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // All-or-nothing: a broken build must not activate a half-cached shell.
    await cache.addAll(PRECACHE);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('atlas-shell-') && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(SHELL, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(SHELL)) || (await cache.match('./')) || new Response(
      '<!doctype html><title>Atlas offline</title><p>Atlas is offline and its shell has not been cached yet. Reconnect and reload once.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
