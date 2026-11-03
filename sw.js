// Кэш для офлайн-работы: после первого запуска приложение и модель открываются без интернета
const CACHE = "coach-v3";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const local = new URL(e.request.url).origin === location.origin;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (local) { // свои файлы: сначала сеть (чтобы обновления доходили), потом кэш
      try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
      catch { return (await cache.match(e.request)) || Response.error(); }
    }
    const hit = await cache.match(e.request); // библиотека и модель: из кэша
    if (hit) return hit;
    const r = await fetch(e.request); if (r.ok || r.type === "opaque") cache.put(e.request, r.clone()); return r;
  })());
});
