const CACHE = 'najah-retail-shell-v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './supabase-config.js', './activity-config.js', './activity-runtime.js', './sync-bridge.js', './retail-features.js', './sw.js',
  './app-Tj80XYGl.js', './asset-BVFJfZJX.css', './theme.css', './company-logo.png', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    if (response.ok && new URL(event.request.url).origin === self.location.origin) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
