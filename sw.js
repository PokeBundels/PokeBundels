// PokeBundels service worker: werkt zonder bereik en meldt nieuwe versies.
// Verhoog VERSION bij elke release (samen met VERSION in js/app.js).
const VERSION = '2.1.0';
const CACHE = 'pb-' + VERSION;
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/logic.js', 'js/db.js', 'js/tcgdex.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

// cache: 'reload' = altijd vers van de server, niet uit de browsercache (GitHub Pages bewaart 10 min).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pb-') && k !== CACHE && k !== 'pb-images').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// De app vraagt de nieuwe versie actief te maken als je op de updatemelding tikt.
self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Kaartafbeeldingen: eerst uit de cache
  if (url.hostname === 'assets.tcgdex.net') {
    e.respondWith(caches.open('pb-images').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Eigen bestanden: uit de cache (snel en zonder bereik); nieuwe versies komen via een nieuwe service worker.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
