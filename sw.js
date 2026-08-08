/* ══════════════════════════════════════════════════════════
   sw.js — service worker
   · caches the shell so the app opens with no signal
   · always revalidates data/trip.json (network-first) so an
     edit pushed from a phone shows up on next open
   · receives push and opens the Questions tab
   ══════════════════════════════════════════════════════════ */

const CACHE = 'eurotrip-v23';
const SHELL = [
  './', './index.html', './css/style.css',
  './js/store.js', './js/time.js', './js/weather.js',
  './js/render.js', './js/push.js', './js/app.js',
  './data/weather.json', './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
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

/**
 * iOS relaunches an installed PWA at its start_url and throws away the
 * notification's URL, so ?tab= never arrives and postMessage only helps if the
 * app was still in memory. Leave the target somewhere that survives a cold
 * start: the Cache API is reachable from both the worker and the page.
 */
const NAV_CACHE = 'eurotrip-nav';
async function stashTab(tab) {
  try {
    const c = await caches.open(NAV_CACHE);
    await c.put('/__pending', new Response(JSON.stringify({ tab, at: Date.now() }),
      { headers: { 'Content-Type': 'application/json' } }));
  } catch {}
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || './index.html?tab=questions';

  /* Which tab the notification wants, so an ALREADY-OPEN app can be told
     directly. Focusing an existing window doesn't re-run boot(), so the
     ?tab= parameter alone isn't enough — without the postMessage below, a
     tap while the app is open lands on whatever tab was last viewed. */
  let tab = null;
  try { tab = new URL(target, self.location.href).searchParams.get('tab'); } catch {}

  e.waitUntil((async () => {
    if (tab) await stashTab(tab);          // must happen before anything focuses
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        if (tab) c.postMessage({ type: 'navigate', tab });
        if ('navigate' in c) { try { await c.navigate(target); } catch {} }
        return c.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
