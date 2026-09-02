/* global indexedDB */

const CACHE_NAME = 'aptagov-shell-v4';
const OFFLINE_URL = '/offline.html';
const PUSH_DEDUPE_DB = 'aptagov-push-dedupe-v1';
const PUSH_DEDUPE_STORE = 'events';

function rememberPushEvent(dedupeKey) {
  if (!dedupeKey || typeof indexedDB === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const open = indexedDB.open(PUSH_DEDUPE_DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(PUSH_DEDUPE_STORE)) {
        open.result.createObjectStore(PUSH_DEDUPE_STORE, { keyPath: 'dedupeKey' });
      }
    };
    open.onerror = () => resolve(true);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(PUSH_DEDUPE_STORE, 'readwrite');
      const store = transaction.objectStore(PUSH_DEDUPE_STORE);
      let duplicate = false;
      const request = store.add({ dedupeKey, receivedAt: Date.now() });
      request.onerror = (error) => {
        if (request.error?.name === 'ConstraintError') {
          error.preventDefault();
          duplicate = true;
        }
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(!duplicate);
      };
      transaction.onerror = () => {
        database.close();
        resolve(true);
      };
      transaction.onabort = () => {
        database.close();
        resolve(true);
      };
    };
  });
}

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
  event.waitUntil((async () => {
    const isNew = await rememberPushEvent(typeof payload.dedupeKey === 'string' ? payload.dedupeKey : '');
    if (!isNew) return;
    return self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: payload.dedupeKey ? `push-${payload.dedupeKey}` : `opportunity-${payload.url}`,
      data: { url: payload.url, eventId: payload.eventId, dedupeKey: payload.dedupeKey },
    });
  })());
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
