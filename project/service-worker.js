// Service Worker — COOP-R14
// Su trabajo: guardar la app en el celular para que funcione sin internet.
// Cada vez que hay una nueva versión, cambiá el número de CACHE_NAME.
const CACHE_NAME = 'coop-r14-v5';

// Archivos que guardamos en el celular la primera vez que se abre la app
const FILES_TO_CACHE = [
  '/Prototipo.html',
  '/manifest.json',
];

// INSTALL: cuando el service worker se instala por primera vez,
// descarga y guarda todos los archivos en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// ACTIVATE: cuando se activa una nueva versión, borra la caché vieja
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// FETCH: cada vez que la app pide algo a internet, este interceptor decide:
// - Si lo tiene en caché, lo devuelve de ahí (rápido, sin internet)
// - Si no, lo busca en internet y lo guarda para la próxima vez
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // solo guardamos respuestas válidas
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
