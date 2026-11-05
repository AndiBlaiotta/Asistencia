// Service worker de TRAPO — Asistencia.
//
// Único objetivo: que la app SIEMPRE cargue la última versión al abrir/recargar
// (online), sin esperar el caché de 10 min que impone GitHub Pages
// (cache-control: max-age=600, que no podemos cambiar).
//
// Estrategia: "network-first" SOLO para el documento HTML. Pide lo fresco a la
// red ignorando el caché del navegador (cache:"no-store"); si no hay internet,
// cae a la última copia cacheada. Todo lo demás (iconos, Apps Script, fuentes)
// pasa de largo al navegador: este SW no lo toca.

const CACHE = "trapo-html-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const accept = req.headers.get("accept") || "";
  const esHTML = req.mode === "navigate" || accept.includes("text/html");
  if (!esHTML) return; // no interceptar nada que no sea la página en sí

  e.respondWith((async () => {
    try {
      // Siempre lo último de la red, salteando el caché HTTP del navegador.
      const fresh = await fetch(req, { cache: "no-store" });
      (await caches.open(CACHE)).put(req, fresh.clone());
      return fresh;
    } catch (err) {
      // Sin internet: última copia guardada (o la raíz, o un aviso simple).
      const cached = (await caches.match(req)) || (await caches.match("/"));
      return cached || new Response(
        "Sin conexión. Reintentá cuando tengas internet.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
  })());
});
