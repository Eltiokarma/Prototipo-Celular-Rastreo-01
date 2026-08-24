// Service Worker — COOP-R14
// Guarda la app en el celular para que abra rápido y sin internet, y
// —sobre todo— cachea los tiles del mapa, que sin caché cuestan entre
// 20 y 50 MB de datos móviles por turno.
//
// Tres cachés separadas a propósito: al publicar una versión nueva se
// renueva la de la app, pero los tiles y las librerías se conservan
// (no cambian y volver a bajarlos costaría datos del chofer).
const CACHE_NAME = 'coop-r14-v49';       // app: HTML, JS propio, iconos
// tiles-v2: las tiles ahora vienen de Geoapify — las de CARTO guardadas con
// la v1 tienen URLs que ya nadie pide y solo ocupan los ~15 MB del tope.
const TILE_CACHE = 'coop-r14-tiles-v2';  // tiles del mapa
const LIB_CACHE  = 'coop-r14-libs-v1';   // React, Babel, Leaflet, fuentes

// Tope de tiles guardados: a ~25 KB cada uno son unos 15 MB, suficiente
// para cubrir la ruta completa con varios niveles de zoom.
const TILE_MAX = 600;

const FILES_TO_CACHE = [
  '/Prototipo.html',
  '/despacho.html',
  '/gerencia.html',
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
  // El índice de zonas del mapa propio: si quedara congelado acá, una
  // ciudad nueva no aparecería hasta la próxima versión de la app.
  /\/tiles\/zonas\.json$/,
];

// La URL de una tile lleva la clave (?apiKey=...) y entra en la clave del
// caché: si la clave rota, las guardadas quedan huérfanas y se van podando
// solas — no hace falta versionar la caché por eso.
//
// `/tiles/xyz/` es el MAPA PROPIO servido por nuestro backend (la mayoría
// del tráfico desde la fase 3): mismas reglas de caché que el proveedor —
// cache primero, la segunda vista no gasta un byte.
//
// Y por la misma razón que la clave, su URL lleva la VERSIÓN del mapa
// adentro (`/tiles/xyz/juliaca/oscuro/v3f9a1c02/…`). Acá una tile guardada
// se sirve para siempre —no hay expiración, es el ahorro entero—, así que
// sin la versión en la URL un mapa renovado no llegaría nunca a este
// celular: el chofer seguiría viendo el trazado viejo hasta que la poda de
// abajo lo sacara por antigüedad. Con la versión, el mapa nuevo son URLs
// nuevas y las viejas se van solas al pasar el tope.
const ES_TILE = /maps\.geoapify\.com\/v1\/tile\/|\/tiles\/xyz\//;
// `/vendor/leaflet/` es de este mismo origen pero pertenece acá y no a la
// caché de la app: Leaflet no cambia cuando publicamos una versión nueva, y
// mandarlo a CACHE_NAME lo haría rebajar 160 kB en cada despliegue. Es
// exactamente la misma librería que antes venía de unpkg, solo que ahora la
// sirve el servidor propio.
const ES_LIB  = /unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|\/vendor\/leaflet\//;

// Los archivos NUESTROS (el HTML de las apps y realtime.js) van a la red
// primero. Antes eran caché-primero y una versión nueva no aparecía hasta
// cerrar y reabrir la app: el chofer seguía con la pantalla vieja sin saberlo.
// No cuesta datos: son ~100 KB y el navegador revalida con ETag, así que si
// no cambió nada la respuesta es un 304 de ~1 KB. Los tiles y las librerías
// siguen siendo caché-primero — ahí está el ahorro de verdad.
const ES_APP_PROPIA = /\.html$|\/realtime\.js$|\/manifest[^/]*\.json$/;

// Cuánto se espera a la red antes de servir la copia guardada. En una zona
// sin señal la app tiene que abrir igual, no quedarse en blanco.
const RED_TIMEOUT_MS = 4000;

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
// Red primero con tope de espera: si el servidor responde, esa copia es la
// buena y se guarda; si tarda o no hay señal, se sirve la guardada.
async function redPrimero(request, cacheName) {
  const cache = await caches.open(cacheName);

  // Se pide por URL en vez de reenviar la petición original: las de
  // navegación (abrir la app) son un caso especial y reenviarlas tal cual
  // no traía la copia fresca — se seguía viendo la versión vieja. Sin
  // 'no-store' a propósito: así el navegador revalida con ETag y, cuando
  // no cambió nada, la respuesta es un 304 de ~1 KB.
  const pedido = new Request(request.url);

  let respuesta;
  try {
    respuesta = await Promise.race([
      fetch(pedido),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), RED_TIMEOUT_MS)),
    ]);
  } catch {
    // Sin red o demasiado lenta: la copia guardada
    const guardado = await cache.match(request);
    if (guardado) return guardado;
    throw new Error('sin red y sin copia guardada');
  }

  if (respuesta && respuesta.ok) {
    // Guardar en un try aparte: si falla (la Cache API rechaza algunos
    // pedidos, como los de navegación) igual se sirve la copia fresca.
    // Se guarda una petición simple por URL, que es la que después
    // encuentra cache.match cuando no hay señal.
    try {
      await cache.put(pedido, respuesta.clone());
    } catch {}
    return respuesta;
  }

  // Respuesta rara (500, etc.): mejor lo guardado que un error en pantalla
  const guardado = await cache.match(request);
  return guardado || respuesta;
}

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

  // Las apps propias: red primero, para que una versión nueva se vea en la
  // primera recarga. Una navegación (abrir la app) entra por acá aunque la
  // URL no termine en .html — p. ej. la raíz del sitio.
  if (req.mode === 'navigate' || ES_APP_PROPIA.test(new URL(url).pathname)) {
    event.respondWith(
      redPrimero(req, CACHE_NAME).catch(() => caches.match(req))
    );
    return;
  }

  // Resto (iconos, etc.): caché primero, y si no está se busca y se guarda
  event.respondWith(
    cachePrimero(req, CACHE_NAME, false).catch(() => caches.match(req))
  );
});
