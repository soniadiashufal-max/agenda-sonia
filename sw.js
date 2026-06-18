const CACHE_NAME = "agenda-sonia-v1";
const SHELL_FILES = ["./index.html", "./app.js", "./config.js", "./manifest.json"];

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

// Network-first para chamadas de API, cache-first para o resto (shell)
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isApi = url.includes("googleapis.com") || url.includes("anthropic.com") || url.includes("accounts.google.com");
  if (isApi) return; // nunca cachear chamadas de API

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
