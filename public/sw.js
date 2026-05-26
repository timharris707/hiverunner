const CACHE = "hr-v2";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(clients.claim()); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  if (e.request.method !== "GET") {
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const clone = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, clone));
    return res;
  })));
});
