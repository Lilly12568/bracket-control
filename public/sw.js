const CACHE_PREFIX = 'bracket-control-';
const CACHE = `${CACHE_PREFIX}v18`;
const SCOPE_URL = new URL(self.registration.scope);
const APP_URL = SCOPE_URL.href;
const REQUIRED_SHELL_FILES = ['manifest.webmanifest', 'favicon.svg', 'icon.svg'];

function isInAppScope(url) {
  return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
}

async function fetchAndCache(cache, url) {
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response.ok) throw new Error(`Could not cache ${url}: ${response.status}`);
  await cache.put(url, response.clone());
  return response;
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE);
  const indexResponse = await fetchAndCache(cache, APP_URL);
  const indexHtml = await indexResponse.text();
  const documentAssets = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], APP_URL))
    .filter(isInAppScope)
    .map((url) => url.href);
  const requiredAssets = REQUIRED_SHELL_FILES.map((path) => new URL(path, APP_URL).href);

  await Promise.all([...new Set([...documentAssets, ...requiredAssets])].map((url) => fetchAndCache(cache, url)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !isInAppScope(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(APP_URL, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request, { ignoreSearch: true })) || caches.match(APP_URL);
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
