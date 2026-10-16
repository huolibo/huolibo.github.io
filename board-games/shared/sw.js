const PREFIX = 'linxi:' + self.registration.scope + ':';
const CACHE = PREFIX + '__REVISION__';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  // Do not skipWaiting: a running match keeps its current code version.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(event.request);
  }));
});
self.addEventListener('message', event => {
  if (event.data === 'offline-status') event.waitUntil(caches.open(CACHE).then(async cache => {
    const ready = (await Promise.all(ASSETS.map(asset => cache.match(asset)))).every(Boolean);
    event.source?.postMessage({ type: 'offline-status', ready, version: CACHE });
  }));
});
