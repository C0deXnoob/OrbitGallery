/* Our Orbit service worker: keeps the app and the photo thumbnails available offline, and lets updates show up as soon as you're online. */
const SHELL_CACHE = 'our-orbit-shell-v3';
const PHOTO_CACHE = 'our-orbit-photos-v1';
const DATA_CACHE  = 'our-orbit-data-v1';
const LIB_CACHE   = 'our-orbit-libs-v1';
const KEEP = [SHELL_CACHE, PHOTO_CACHE, DATA_CACHE, LIB_CACHE];
const SHELL = ['./', './index.html', './manifest.json', './icon.svg'];
const MAX_PHOTOS = 700;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max){
  const cache = await caches.open(cacheName), keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}
async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: false });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(request, cacheName, max){
  const cache = await caches.open(cacheName), hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok){ cache.put(request, res.clone()); if (max) trim(cacheName, max); }
  return res;
}
/* sharp preview sizes only; the huge viewer images are never stored */
function isSmallPhoto(url){
  const m = /[=&?](?:sz=)?w(\d+)/.exec(url.href); return !m || +m[1] <= 1100;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin){                          /* the app itself: newest when online, cached when offline */
    event.respondWith(networkFirst(req, SHELL_CACHE).catch(() => caches.match('./index.html')));
    return;
  }
  if (/^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)){
    event.respondWith(cacheFirst(req, LIB_CACHE).catch(() => Response.error()));
    return;
  }
  if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files' && !url.searchParams.has('alt')){   /* the folder listing */
    event.respondWith(networkFirst(req, DATA_CACHE).catch(() => Response.error()));
    return;
  }
  if (req.destination === 'image' && (/googleusercontent\.com$/.test(url.hostname) || (url.hostname === 'drive.google.com' && url.pathname === '/thumbnail')) && isSmallPhoto(url)){
    event.respondWith(cacheFirst(req, PHOTO_CACHE, MAX_PHOTOS).catch(() => Response.error()));
  }
});
