// AED Finance service worker: caches the static app shell only.
// API responses (financial data) are NEVER cached — always network.
const CACHE = "aed-shell-v1";
const SHELL = ["/icons/icon.svg", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => new Response("<h1>Offline</h1><p>AED Finance needs a connection to load live financial data.</p>", { headers: { "Content-Type": "text/html" } })));
  }
});
