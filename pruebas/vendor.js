// Ninguna pantalla depende de un CDN para poder dibujar el mapa.
//
// Esto no es una precaución teórica: **pasó en producción**. unpkg no le
// entregó `leaflet.js` al navegador del creador y elegir una ruta dejaba la
// página en blanco, sin un solo error a la vista — el mapa se inicializaba
// con `L` sin existir y el script se cortaba en la primera línea. El panel
// del creador se arregló sirviéndose su propia copia; Despacho y la app web
// del chofer se quedaron colgadas del CDN, y el WebView del APK también.
//
// A 2000 unidades el problema cambia de tamaño por dos motivos que se suman:
// son 2000 navegadores pidiéndole a un CDN gratuito, y el que abre la app del
// chofer por primera vez lo hace en la calle, con la señal que hay en
// Juliaca. Un mapa en blanco ahí no se reporta como error: se desinstala.
//
// Se prueba lo que se puede romper de verdad:
//   1. el servidor entrega Leaflet, con contenido real y no un 404 con forma
//      de página;
//   2. los HTML lo piden a este origen y no al CDN;
//   3. hay una sola versión de Leaflet en el repositorio (la del servidor, la
//      del APK y la que declaran los HTML son la misma).
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB = S + '/vendor-test.db';
const P = 3159;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const VERSION = '1.9.4';
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ─── Sin servidor: lo que dicen los archivos ───────────────────────────────

console.log('\nLOS HTML PIDEN EL LEAFLET DE ACÁ, NO EL DEL CDN');
for (const rel of ['project/despacho.html', 'project/Prototipo.html', 'server/creador.html']) {
  const t = leer(rel);
  const nombre = rel.split('/').pop();

  // La etiqueta que el navegador ejecuta SIEMPRE tiene que ser la local. La
  // del CDN puede seguir existiendo, pero solo adentro de la caída de
  // emergencia — o sea, adentro de un `if`, nunca suelta en el <head>.
  const sueltoCdn = new RegExp(
    '^\\s*<script[^>]*src="https://unpkg\\.com/leaflet', 'm').test(t);
  ok(`${nombre}: no trae el <script> de Leaflet del CDN suelto`, !sueltoCdn);

  // Y tiene que haber una RUTA a leaflet.js que no sea una URL absoluta:
  // `vendor/leaflet/leaflet.js` en los dos paneles web, y `BASE + '/leaflet.js'`
  // en el del creador, que la arma con la de su propia página (`CREATOR_PATH`
  // es configurable).
  //
  // Se exige la barra de antes para no contar la prosa: estos archivos
  // explican en comentarios por qué ya NO usan unpkg, y "no entregó
  // leaflet.js" no es una ruta. Y se descarta el prefijo con `http` porque el
  // del CDN también termina en `/leaflet.js` — sin eso la prueba pasaría con
  // la caída de emergencia y sin haber verificado nada.
  const rutas = [...t.matchAll(/(\S{0,60})\/leaflet\.js/g)].map(m => m[1]);
  const local = rutas.some(antes => !/https?:\/\//.test(antes));
  ok(`${nombre}: pide Leaflet a su propio origen`, local, rutas);

  // Si el archivo nombra una versión de Leaflet, tiene que ser LA versión.
  const versiones = [...t.matchAll(/leaflet@(\d+\.\d+\.\d+)/g)].map(m => m[1]);
  ok(`${nombre}: no nombra otra versión de Leaflet`,
     versiones.every(v => v === VERSION), versiones);
}

console.log('\nEL WEBVIEW DEL APK LO LLEVA ADENTRO');
{
  // Un WebView de React Native no puede leer archivos del repo en tiempo de
  // ejecución: lo que existe es lo que Metro empaquetó. Por eso Leaflet viaja
  // como texto en app/vendor/leaflet.js.
  const t = leer('app/mapa.js');
  // Las tiles del mapa sí son de la red y no hay forma de que no lo sean
  // (son cientos de MB de imágenes). Sin señal el fondo queda gris, pero los
  // puntos y el trazado se dibujan igual — que es justamente lo que se pierde
  // entero cuando el que falta es Leaflet.
  // Se busca la URL, no la palabra: el archivo explica en un comentario por
  // qué ya NO usa unpkg, y esa explicación no puede poner la prueba en rojo.
  ok('mapa.js no baja librerías de ningún CDN',
     !/https?:\/\/(\w+\.)?(unpkg|cdnjs|jsdelivr)/.test(t));
  ok('y carga el Leaflet incrustado', /require\('\.\/vendor\/leaflet'\)/.test(t));

  const incrustado = require(RAIZ + '/app/vendor/leaflet.js');
  ok('el módulo trae el código y los estilos',
     incrustado.js.length > 100000 && incrustado.css.length > 5000,
     [incrustado.js.length, incrustado.css.length]);
  ok('y declara la versión', incrustado.version === VERSION, incrustado.version);
}

console.log('\nUNA SOLA VERSIÓN DE LEAFLET EN EL REPOSITORIO');
{
  // La copia del APK sale de la del servidor por
  // herramientas/vendor-leaflet.js. Si alguien sube la versión en
  // server/vendor/ y se olvida de regenerar, la app se queda con la vieja
  // adentro y nadie se entera hasta ver algo raro en el teléfono.
  const { huella, ORIGEN } = require(RAIZ + '/herramientas/vendor-leaflet.js');
  const incrustado = require(RAIZ + '/app/vendor/leaflet.js');
  const enServidor = huella(
    fs.readFileSync(ORIGEN + '/leaflet.js', 'utf8'),
    fs.readFileSync(ORIGEN + '/leaflet.css', 'utf8'),
  );
  ok('la del APK y la del servidor son la misma',
     incrustado.huella === enServidor,
     'app ' + incrustado.huella + ' vs servidor ' + enServidor +
     ' — correr: node herramientas/vendor-leaflet.js');

  // Y que la copia del servidor sea Leaflet de verdad, no un archivo vacío
  // que alguien dejó al mover cosas.
  const js = fs.readFileSync(ORIGEN + '/leaflet.js', 'utf8');
  ok('la copia del servidor es Leaflet ' + VERSION,
     js.includes('Leaflet ' + VERSION + ', a JS library'));
}

console.log('\nLA CACHÉ DEL CELULAR LO TRATA COMO LIBRERÍA');
{
  // Leaflet no cambia cuando publicamos una versión de la app. Si cayera en
  // la caché de la app, cada despliegue le costaría 160 kB de datos móviles
  // al chofer por una librería que es idéntica.
  const sw = leer('project/service-worker.js');
  ok('el service worker manda /vendor/leaflet/ a la caché de librerías',
     /ES_LIB\s*=[^;]*vendor\\\/leaflet/.test(sw));
}

// ─── Con servidor: que de verdad lo entregue ───────────────────────────────

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  console.log('\nEL SERVIDOR ENTREGA LEAFLET');
  {
    const js = await fetch(API + '/vendor/leaflet/leaflet.js');
    const cuerpo = await js.text();
    ok('leaflet.js responde 200', js.status === 200, js.status);
    ok('y es Leaflet de verdad, no una página de error',
       cuerpo.includes('Leaflet ' + VERSION + ', a JS library'), cuerpo.slice(0, 60));
    ok('con el tipo de contenido de un script',
       /javascript/.test(js.headers.get('content-type') || ''), js.headers.get('content-type'));

    const css = await fetch(API + '/vendor/leaflet/leaflet.css');
    const cssCuerpo = await css.text();
    ok('leaflet.css responde 200', css.status === 200, css.status);
    ok('y trae los estilos del mapa', /\.leaflet-pane\s*\{/.test(cssCuerpo));
    ok('con el tipo de contenido de una hoja de estilos',
       /text\/css/.test(css.headers.get('content-type') || ''), css.headers.get('content-type'));

    // Se cachea un día: es código público de Leaflet, no datos de nadie, y
    // pesa más que todo lo demás junto.
    ok('se puede cachear', /max-age=\d+/.test(js.headers.get('cache-control') || ''),
       js.headers.get('cache-control'));
  }

  console.log('\nY NADA MÁS SE ESCAPA POR ESA PUERTA');
  {
    // La ruta sirve DOS archivos nombrados, no una carpeta: un `sendFile` con
    // el nombre pegado del pedido sería una forma de leer el disco del
    // servidor desde afuera.
    for (const intento of ['/vendor/leaflet/../../index.js',
                           '/vendor/leaflet/leaflet.js.map',
                           '/vendor/']) {
      const r = await fetch(API + intento);
      const t = await r.text();
      ok('no entrega ' + intento,
         r.status === 404 || !/require\(|better-sqlite3/.test(t), r.status);
    }
  }

  // La app del chofer y Despacho se sirven de este mismo servidor: pedir la
  // página y ver que la etiqueta que trae apunte acá cierra el círculo.
  console.log('\nLA PÁGINA QUE SE SIRVE ES LA QUE PIDE EL LEAFLET LOCAL');
  {
    for (const [ruta, nombre] of [['/despacho.html', 'Despacho'], ['/Prototipo.html', 'la app del chofer']]) {
      const r = await fetch(API + ruta);
      const t = await r.text();
      ok(`${nombre} se sirve`, r.status === 200, r.status);
      ok(`${nombre} apunta a vendor/leaflet/leaflet.js`,
         t.includes('src="vendor/leaflet/leaflet.js"'));
    }
  }

  servidor.kill();
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
