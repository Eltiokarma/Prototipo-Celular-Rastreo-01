// Caché en disco de los assets de CDN (React, Babel, Leaflet, fuentes, tiles).
// El proxy del sandbox falla con 503 cada tanto y dejaba la página en blanco:
// con esto, una vez bajado, los tests no vuelven a depender de la red.
//
// Dos cosas hacen falta para que el caché llegue a poblarse:
//
// - **Una bajada por vez.** El proxy contesta 503 cuando le entran varias
//   juntas, y el navegador pide React, React-DOM, Babel, Leaflet y las fuentes
//   en paralelo. Secuencial las contesta todas con 200.
// - **Reintento con espera.** Un 503 no se cachea; sin reintentar, la primera
//   corrida servía el 503 al navegador y la página quedaba en blanco justo
//   cuando el caché existía para evitar eso.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DIR = path.join(__dirname, 'cdn');

const INTENTOS = 4;
const espera = ms => new Promise(r => setTimeout(r, ms));

// Cola global: las bajadas van de a una aunque el navegador las pida juntas.
let turno = Promise.resolve();
const enFila = (fn) => {
  const mio = turno.then(fn, fn);
  turno = mio.catch(() => {});
  return mio;
};

async function bajar(url) {
  let ultimo = null;
  for (let i = 0; i < INTENTOS; i++) {
    if (i) await espera(400 * 2 ** (i - 1));   // 400ms, 800ms, 1600ms
    try {
      const res = await fetch(url);
      const body = Buffer.from(await res.arrayBuffer());
      const info = { type: res.headers.get('content-type') || 'application/octet-stream', status: res.status };
      if (res.status < 400) return { body, ...info };
      ultimo = { body, ...info };            // 4xx/5xx: se reintenta, no se cachea
    } catch (e) { ultimo = null; }
  }
  if (ultimo) return ultimo;
  throw new Error('no se pudo bajar ' + url);
}

// Una tile de 1×1 gris. Las tiles de verdad piden clave (GEOAPIFY_API_KEY) y
// los tests no tienen ni necesitan una: sin esto, cada tile respondería 401 y
// se reintentaría cuatro veces — cientos de bajadas fallidas por corrida para
// dibujar un fondo que ninguna aserción mira.
const TILE_GRIS = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsaGj4DwAFhAKAkNMOfAAAAABJRU5ErkJggg==',
  'base64');

module.exports = async function interceptarHttps(ctx) {
  const mem = new Map();
  await ctx.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (/maps\.geoapify\.com\/v1\/tile\//.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE_GRIS });
    }
    const clave = crypto.createHash('sha1').update(url).digest('hex');
    const cuerpo = path.join(DIR, clave);
    const meta = cuerpo + '.json';
    try {
      if (!mem.has(url)) {
        if (fs.existsSync(cuerpo) && fs.existsSync(meta)) {
          mem.set(url, { body: fs.readFileSync(cuerpo), ...JSON.parse(fs.readFileSync(meta, 'utf8')) });
        } else {
          // Se revisa el disco otra vez dentro de la cola: mientras esta
          // petición esperaba turno, otra igual pudo haberla dejado bajada.
          const c = await enFila(async () => {
            if (mem.has(url)) return mem.get(url);
            if (fs.existsSync(cuerpo) && fs.existsSync(meta)) {
              return { body: fs.readFileSync(cuerpo), ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
            }
            const bajado = await bajar(url);
            if (bajado.status < 400) {
              fs.mkdirSync(DIR, { recursive: true });
              fs.writeFileSync(cuerpo, bajado.body);
              fs.writeFileSync(meta, JSON.stringify({ type: bajado.type, status: bajado.status }));
            }
            return bajado;
          });
          mem.set(url, c);
        }
      }
      const c = mem.get(url);
      await route.fulfill({ status: c.status, contentType: c.type, body: c.body });
    } catch { await route.abort(); }
  });
};
