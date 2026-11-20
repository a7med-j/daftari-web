// Keeps Waraqa's web pages and the Firebase library in this browser, so apps open at once and also
// without a connection. Pages and scripts: the kept copy right away, while the latest is fetched in
// the background; when its content changed, open pages are told. The Firebase library (fixed
// versions): the kept copy. Data itself is kept by Firestore. Any problem here falls back to the
// plain network, so a page is never left hanging.
const CACHE = "waraqa-v5";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

/** The latest copy from the site, skipping the browser's short-term copy (by address: works for pages too). */
const fresh = req => fetch(req.url, { cache: "no-cache", credentials: "same-origin" });

async function tellPages() {
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "waraqa-updated" });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;
  const library = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameSite && !library) return; // Firestore, sign-in and other calls go straight to the network

  e.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const kept = await cache.match(req);
      if (library) {
        if (kept) return kept;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }
      if (!kept) {
        const res = await fresh(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }
      // Opens from the kept copy; the latest is checked in the background for next time.
      const before = kept.clone(); // the copy returned below is read by the page
      e.waitUntil((async () => {
        try {
          const res = await fresh(req);
          if (!res.ok) return;
          const [was, now] = await Promise.all([before.text(), res.clone().text()]);
          if (was === now) return;
          await cache.put(req, res);
          await tellPages();
        } catch (err) {}
      })());
      return kept;
    } catch (err) {
      try { return await fetch(req); }
      catch (err2) { return (await caches.match(req, { ignoreSearch: true })) || Response.error(); }
    }
  })());
});
