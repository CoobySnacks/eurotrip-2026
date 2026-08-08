/* ══════════════════════════════════════════════════════════
   sw.js — service worker
   · caches the shell so the app opens with no signal
   · always revalidates data/trip.json (network-first) so an
     edit pushed from a phone shows up on next open
   · receives push and opens the Questions tab
   ══════════════════════════════════════════════════════════ */

const CACHE = 'eurotrip-v19';
const SHELL = [
  './', './index.html', './css/style.css',
  './js/store.js', './js/time.js', './js/weather.js',
  './js/render.js', './js/push.js', './js/app.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
  './assets/logo.png', './assets/crew.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  /* never cache the weather API */
  if (url.hostname.includes('open-meteo.com')) return;

  /* Icons and photos never change — cache-first is fine and saves bytes. */
  if (url.pathname.includes('/icons/') || url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
    return;
  }

  /* Everything else same-origin (trip.json, JS, CSS, HTML) is NETWORK-FIRST.
     The whole point of this project is that Jacob edits data/trip.json from his
     phone and the change is live. Cache-first would show the three of them a
     stale itinerary until the second app open — which, mid-trip, is exactly
     when being wrong matters most. The app is ~100 KB; the round trip is cheap,
     and the cache still covers us completely when there's no signal. */
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const c = r.clone();
          caches.open(CACHE).then(x => x.put(e.request, c));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  }
});

/* ---------- PUSH ---------- */
self.addEventListener('push', e => {
  let d = { title: '🍻 Question time', body: 'Tonight\'s questions are unlocked.' };
  try { if (e.data) d = { ...d, ...e.data.json() }; } catch {}

  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || 'nightly-questions',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: d.url || './index.html?tab=questions' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || './index.html?tab=questions';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(target); return c.focus(); }
      }
      return clients.openWindow(target);
    })
  );
});
