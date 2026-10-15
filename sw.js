/* =====================================================================
   sw.js — service worker

   The app shell is cached so the tracker opens instantly and works with
   no signal. Firestore traffic is never cached here: the Firebase SDK
   keeps its own offline copy and queue.
   ===================================================================== */

var VERSION = 'glazing-v6-reports';
var SHELL = VERSION + '-shell';
var VENDOR = VERSION + '-vendor';

var SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/firebase-config.js',
  './js/config.js',
  './js/store.js',
  './js/data.js',
  './data/seed.json',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* Third-party assets we want available offline too. */
function isVendor(url) {
  // Only the Firebase library files — never live Firestore/Auth requests.
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) return true;
  // PDF library for reports.
  if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.indexOf('/ajax/libs/jspdf') === 0) return true;
  return url.hostname === 'cdn.jsdelivr.net' ||
         url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return c.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== VENDOR) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Fonts and the Firebase library: serve from cache, fill it in the background.
  if (isVendor(url)) {
    e.respondWith(
      caches.open(VENDOR).then(function (cache) {
        return cache.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  // Same-origin navigations: always fall back to the cached shell so a
  // deep link still opens when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html', { ignoreSearch: true });
      })
    );
    return;
  }

  // Everything else same-origin: network first so a deploy (or a config
  // change) reaches phones on the next open; the cache covers no signal.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true });
      })
    );
  }
});

/* Let the page trigger an immediate update after a deploy. */
self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
