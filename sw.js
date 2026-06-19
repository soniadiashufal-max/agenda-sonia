const CACHE_NAME = "agenda-sonia-v2";
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

// Network-first para TUDO (shell incluído): tenta sempre buscar a versão mais
// recente do servidor primeiro. Só usa a cópia em cache se não houver rede
// (modo offline). Isto garante que atualizações ao app.js/index.html ficam
// visíveis assim que a pessoa reabre a app, sem precisar de limpar cache.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isApi = url.includes("googleapis.com") || url.includes("anthropic.com") || url.includes("accounts.google.com");
  if (isApi) return; // nunca intercetar chamadas de API

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
