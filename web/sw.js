/* Fold Drive service worker: works offline for the app itself; maps and search still need internet. */
var CACHE = 'fold-drive-v1.0.0';
var SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'nav.js', 'manifest.webmanifest', 'prices.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // fuel prices: always try the network first
  if (url.pathname.endsWith('prices.json')) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put('prices.json', copy); });
      return res;
    }).catch(function () { return caches.match('prices.json'); }));
    return;
  }
  // app files: serve from cache, refresh in the background
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
