// De dónde vienen las tiles del mapa — y de dónde NO pueden venir.
//
// CARTO restringe su CDN de tiles a clientes enterprise y proyectos sin
// fines de lucro. Una cooperativa que cobra pasaje es uso comercial: usarlo
// era estar fuera de licencia, y el corte habría llegado sin aviso y a las
// 2000 unidades a la vez. Lo mismo vale para cualquier servidor de tiles
// "gratis" sin acuerdo: el de OSM prohíbe apps de distribución masiva.
//
// La regla ejecutable: en el código que llega a las pantallas, las tiles
// solo pueden venir de (a) nuestro propio origen o (b) el proveedor con
// clave (Geoapify). Y la clave JAMÁS puede estar escrita en el código.
//
// La lección de la suite `vendor`: una aserción que se conforma con que una
// palabra aparezca en el archivo la satisface un comentario. Acá:
// - lo PROHIBIDO se busca como host completo (basemaps.cartocdn.com), que
//   no tiene por qué aparecer ni en un comentario — si aparece, falla, esté
//   donde esté;
// - lo EXIGIDO se busca como URL entre comillas y con la plantilla
//   {z}/{x}/{y} adentro: la prosa no escribe eso, el código sí.
const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ─── QUÉ SE REVISA ───────────────────────────────────────────
// Todo lo que se ejecuta en una pantalla o en el servidor. Las pruebas y los
// .md quedan afuera: pueden nombrar a CARTO para contar la historia.
function archivosDeCodigo() {
  const lista = [];
  const barrer = (dir) => {
    for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) {
        if (['node_modules', 'vendor', 'uploads', '.git'].includes(e.name)) continue;
        barrer(rel);
      } else if (/\.(js|html|json)$/.test(e.name) && !/package(-lock)?\.json$/.test(e.name)) {
        lista.push(rel);
      }
    }
  };
  for (const d of ['project', 'server', 'app', 'herramientas']) barrer(d);
  return lista;
}

// ─── HOSTS DE TILES PROHIBIDOS ───────────────────────────────
// Hosts completos: si uno de estos aparece en el código que se despliega,
// alguien volvió a colgar el mapa de un servicio sin licencia para esto.
const PROHIBIDOS = [
  /basemaps\.cartocdn\.com/,      // CARTO: solo enterprise y sin fines de lucro
  /cartocdn\.com/,                // cualquier otra puerta de CARTO
  /tile\.openstreetmap\.org/,     // el tile server de OSM prohíbe apps masivas
  /tile\.openstreetmap\.fr/,
  /tiles?\.stadiamaps\.com/,      // Stadia: el tier gratuito es no comercial
  /api\.maptiler\.com/,           // MapTiler: ídem
  /stamen-tiles/,
  /tile\.opentopomap\.org/,
  /server\.arcgisonline\.com/,
  /mt\d\.google(?:apis)?\.com/,   // tiles de Google sin SDK ni contrato
  /api\.mapbox\.com/,             // Mapbox exige su propio SDK/token
];

console.log('\nNINGÚN HOST DE TILES SIN LICENCIA, EN NINGÚN ARCHIVO');
{
  const archivos = archivosDeCodigo();
  ok('el barrido encuentra los archivos (las 4 pantallas incluidas)',
     archivos.length > 10 &&
     ['project/Prototipo.html', 'project/despacho.html', 'server/creador.html', 'app/mapa.js']
       .every(p => archivos.includes(p)),
     archivos.length + ' archivos');
  for (const rel of archivos) {
    const texto = leer(rel);
    const pegado = PROHIBIDOS.find(re => re.test(texto));
    if (pegado) ok(rel + ' no nombra hosts prohibidos', false, String(pegado));
  }
  ok('ningún archivo desplegable nombra un host prohibido', true);
}

// ─── LAS CUATRO PANTALLAS USAN EL PROVEEDOR CON CLAVE ────────
// La URL tiene que estar ENTRE COMILLAS y con la plantilla {z}/{x}/{y}:
// eso es una capa de Leaflet de verdad, no una mención en un comentario.
const URL_DE_TILES = /['"`]https:\/\/maps\.geoapify\.com\/v1\/tile\/[^'"`\n]*\{z\}\/\{x\}\/\{y\}/;

console.log('\nLAS CUATRO PANTALLAS, SOBRE EL PROVEEDOR LICENCIADO');
{
  for (const rel of ['project/Prototipo.html', 'project/despacho.html',
                     'server/creador.html', 'app/mapa.js']) {
    const texto = leer(rel);
    ok(rel + ' arma sus tiles con la URL del proveedor', URL_DE_TILES.test(texto));
    // La ODbL exige nombrar a OpenStreetMap; que esté al lado de las tiles.
    ok(rel + ' muestra la atribución de OpenStreetMap',
       /OpenStreetMap<\/a> contributors|OpenStreetMap contributors/.test(texto));
  }
}

console.log('\nLA CLAVE NO ESTÁ ESCRITA EN NINGÚN LADO');
{
  // En el código, `apiKey=` solo puede ir seguido de una interpolación o de
  // una concatenación — nunca de un valor. Una clave de verdad es un chorro
  // alfanumérico largo pegado al `=`.
  for (const rel of archivosDeCodigo()) {
    const texto = leer(rel);
    if (/apiKey=[A-Za-z0-9]{8,}/.test(texto)) {
      ok(rel + ' no lleva la clave commiteada', false);
    }
  }
  ok('ninguna clave commiteada (apiKey= siempre se completa en runtime)', true);

  // Y el servidor la saca del entorno, que es el único lugar donde vive.
  const servidor = leer('server/index.js');
  ok('el servidor lee GEOAPIFY_API_KEY del entorno',
     /process\.env\.GEOAPIFY_API_KEY/.test(servidor));
}

console.log('\nEL SERVICE WORKER CACHEA LAS TILES NUEVAS');
{
  const sw = leer('project/service-worker.js');
  // Sin esto, cada apertura vuelve a bajar 20–50 MB por turno de datos
  // prepago — el caché de tiles es la razón de ser del service worker.
  ok('ES_TILE reconoce al proveedor', /ES_TILE\s*=\s*\/[^\n]*maps\\\.geoapify\\\.com/.test(sw));
  ok('y ya no espera a CARTO', !/cartocdn/.test(sw));
}

// ─── EL SERVIDOR SIRVE EL MAPA PROPIO ────────────────────────
// Con un PMTiles de juguete (pruebas/tiles-fixture/): lo que se prueba es
// el contrato del endpoint, no la cartografía. El de verdad pesa cientos
// de MB y no vive en el repositorio.
const { spawn } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const PUERTO = 3171;
  const API = `http://localhost:${PUERTO}`;
  const DB = path.join(__dirname, 'tiles-test.db');
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const servidor = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PUERTO), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99',
           TILES_DIR: path.join(__dirname, 'tiles-fixture') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    let vivo = false;
    for (let i = 0; i < 80 && !vivo; i++) {
      await sleep(250);
      try { await fetch(API + '/ping'); vivo = true; } catch {}
    }
    console.log('\nEL SERVIDOR SIRVE EL MAPA PROPIO');
    ok('el servidor de prueba arrancó', vivo);

    // El índice de zonas: dice qué hay, y no promete lo que no está
    const zonas = await (await fetch(API + '/tiles/zonas.json')).json();
    ok('zonas.json trae la zona con archivos presentes', !!zonas.juliaca);
    ok('y OMITE la zona cuyos archivos faltan (nada de 404 en cadena)',
       !('fantasma' in zonas), Object.keys(zonas));
    ok('la zona dice su bbox (la cascada decide con esto)',
       Array.isArray(zonas.juliaca?.bbox) && zonas.juliaca.bbox.length === 4);

    // Range: el cliente pide PEDACITOS del archivo, nunca el archivo entero
    const r = await fetch(API + '/tiles/juliaca-claro.pmtiles', { headers: { Range: 'bytes=0-13' } });
    ok('un pedido con Range responde 206 (parcial)', r.status === 206, r.status);
    const cuerpo = Buffer.from(await r.arrayBuffer());
    ok('y trae exactamente los bytes pedidos', cuerpo.length === 14, cuerpo.length);
    ok('que son un PMTiles de verdad (magia del formato)',
       cuerpo.slice(0, 7).toString() === 'PMTiles', cuerpo.slice(0, 7).toString());
    ok('con content-range para seguir pidiendo', /^bytes 0-13\//.test(r.headers.get('content-range') || ''));

    // Inmutable: la actualización del mapa es OTRO archivo, no este cambiado
    ok('la caché es agresiva e inmutable',
       /max-age=31536000.*immutable/.test(r.headers.get('cache-control') || ''),
       r.headers.get('cache-control'));
    ok('y con CORS para el WebView de la app nativa',
       r.headers.get('access-control-allow-origin') === '*');

    // La ruta no es un file server
    for (const malo of ['..%2F..%2Fpackage.json', 'r14.db', 'juliaca-claro.pmtiles.bak', 'MAYUS.pmtiles']) {
      const rm = await fetch(API + '/tiles/' + malo);
      ok(`no entrega ${malo}`, rm.status === 404, rm.status);
    }
  } finally {
    servidor.kill();
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})();
