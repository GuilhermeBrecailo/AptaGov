const CACHE_NAME = 'aptagov-shell-v3';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL, '/manifest.webmanifest', '/icons/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const fallback = {
    title: 'AptaGov',
    body: 'Uma nova oportunidade aderente chegou.',
    url: '/',
  };
  let payload = fallback;
  try {
    if (event.data) payload = { ...fallback, ...event.data.json() };
  } catch {
    payload = fallback;
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    tag: `opportunity-${payload.url}`,
    data: { url: payload.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data?.url ?? '/';
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const current = clients.find((client) => 'focus' in client);
    if (current && 'focus' in current) return current.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const isDevNuxtAsset = url.pathname.startsWith('/_nuxt/@')
    || url.pathname.startsWith('/_nuxt/C:')
    || url.pathname === '/_nuxt/assets/css/main.css'
    || url.pathname.endsWith('.ts')
    || url.searchParams.has('v');
  if (isDevNuxtAsset) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});
