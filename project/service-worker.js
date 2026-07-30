// Service Worker — COOP-R14
// Guarda la app en el celular para que abra rápido y sin internet, y
// —sobre todo— cachea los tiles del mapa, que sin caché cuestan entre
// 20 y 50 MB de datos móviles por turno.
//
// Tres cachés separadas a propósito: al publicar una versión nueva se
// renueva la de la app, pero los tiles y las librerías se conservan
// (no cambian y volver a bajarlos costaría datos del chofer).
const CACHE_NAME = 'coop-r14-v16';       // app: HTML, JS propio, iconos
const TILE_CACHE = 'coop-r14-tiles-v1';  // tiles del mapa
const LIB_CACHE  = 'coop-r14-libs-v1';   // React, Babel, Leaflet, fuentes

// Tope de tiles guardados: a ~25 KB cada uno son unos 15 MB, suficiente
// para cubrir la ruta completa con varios niveles de zoom.
const TILE_MAX = 600;

const FILES_TO_CACHE = [
  '/Prototipo.html',
  '/despacho.html',
  '/realtime.js',
  '/manifest.json',
];

// Nunca se cachean: dependen del momento o del estado de la sesión.
// (Antes se cacheaban y el panel podía mostrar una lista de choferes vieja.)
const NUNCA_CACHEAR = [
  /\/auth\//,
  /\/admin\//,
  /\/ping$/,
  /\/config\.js$/,
];

const ES_TILE = /basemaps\.cartocdn\.com|tile\.openstreetmap\.org/;
const ES_LIB  = /unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/;

// INSTALL: guarda la app. Si algún archivo falla, no aborta la instalación.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(FILES_TO_CACHE.map((f) => cache.add(f)))
    )
  );
  self.skipWaiting();
});

// ACTIVATE: borra versiones viejas de la app, pero conserva tiles y librerías
self.addEventListener('activate', (event) => {
  const conservar = [CACHE_NAME, TILE_CACHE, LIB_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !conservar.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Mantiene la caché de tiles bajo el tope, borrando los más antiguos
async function podarTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_MAX) return;
  const sobran = keys.length - TILE_MAX;
  for (let i = 0; i < sobran; i++) await cache.delete(keys[i]);
}

// Caché primero: si está guardado se sirve sin tocar la red (0 datos).
// Los tiles y las librerías llegan como respuestas opaque (status 0)
// porque son de otro dominio: hay que guardarlas igual.
async function cachePrimero(request, cacheName, podar) {
  const cache = await caches.open(cacheName);
  const guardado = await cache.match(request);
  if (guardado) return guardado;
  const respuesta = await fetch(request);
  if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) {
    await cache.put(request, respuesta.clone());
    if (podar) await podarTiles(cache);
  }
  return respuesta;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Solo GET: los POST (login, chat) siempre van a la red
  if (req.method !== 'GET') return;

  // API y configuración: siempre a la red, nunca caché
  if (NUNCA_CACHEAR.some((re) => re.test(url))) return;

  if (ES_TILE.test(url)) {
    event.respondWith(
      cachePrimero(req, TILE_CACHE, true).catch(() => caches.match(req))
    );
    return;
  }

  if (ES_LIB.test(url)) {
    event.respondWith(
      cachePrimero(req, LIB_CACHE, false).catch(() => caches.match(req))
    );
    return;
  }

  // Resto (la app): caché primero, y si no está se busca y se guarda
  event.respondWith(
    cachePrimero(req, CACHE_NAME, false).catch(() => caches.match(req))
  );
});
