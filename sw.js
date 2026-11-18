// Keeps Waraqa's web pages and the Firebase library in this browser, so installed apps open without
// a connection. Pages and scripts: the network first (always the latest), the kept copy when offline.
// The Firebase library (fixed versions): the kept copy first. Data itself is kept by Firestore.
const CACHE = "waraqa-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;
  const library = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameSite && !library) return; // Firestore, sign-in and other calls go straight to the network
  if (library) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const kept = await cache.match(req);
      if (kept) return kept;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: "no-cache" }); // skip the browser's short-term copy: always the latest
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
