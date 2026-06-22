const CACHE_NAME = "agenda-sonia-v3";
const SHELL_FILES = ["./index.html", "./app.js?v=3", "./config.js?v=3", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first para TUDO (shell incluído), com "cache: no-store" para
// ignorar por completo qualquer cache HTTP intermédia do browser, não só a
// cache do service worker. Isto garante que uma atualização ao app.js,
// index.html ou config.js fica sempre visível assim que a pessoa reabre a
// app, sem precisar de limpar dados manualmente.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isApi = url.includes("googleapis.com") || url.includes("anthropic.com") || url.includes("accounts.google.com");
  if (isApi) return; // nunca intercetar chamadas de API

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
