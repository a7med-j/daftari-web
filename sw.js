// Keeps Waraqa's web pages and the Firebase library in this browser, so apps open at once and also
// without a connection. Pages and scripts: the kept copy right away, while the latest is fetched in
// the background; when it changed, open pages are told (they refresh). The Firebase library (fixed
// versions): the kept copy. Data itself is kept by Firestore.
const CACHE = "waraqa-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const versionOf = res => res && (res.headers.get("etag") || res.headers.get("last-modified") || "");

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;
  const library = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameSite && !library) return; // Firestore, sign-in and other calls go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const kept = await cache.match(req);
    if (library && kept) return kept;
    // The latest copy (skipping the browser's short-term copy), kept for next time.
    const latest = fetch(req, { cache: "no-cache" }).then(async res => {
      if (res.ok) {
        await cache.put(req, res.clone());
        if (kept && !library && versionOf(kept) !== versionOf(res)) {
          for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "waraqa-updated" });
        }
      }
      return res;
    });
    if (kept) {
      e.waitUntil(latest.catch(() => {}));
      return kept;
    }
    try { return await latest; }
    catch (err) { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
  })());
});
