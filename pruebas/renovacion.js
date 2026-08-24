// Renovar el mapa propio en un servidor que YA lo tiene.
//
// Es la suite de un pendiente que era un procedimiento manual: hasta acá,
// re-extraer el mapa y publicarlo no servía de nada. Los archivos se
// llamaban siempre igual (`juliaca-claro.pmtiles`), el servidor bajaba solo
// lo que le faltaba, y como no le faltaba nada, el mapa nuevo no llegaba
// nunca. La única forma era entrar al volumen, vaciar la carpeta de tiles y
// redesplegar — a mano, en cada servidor, sin que nada avisara si te lo
// olvidabas.
//
// Ahora el nombre lleva la versión adentro (los 8 primeros hex del sha256
// del contenido, puestos por el extractor), y de eso salen cuatro
// propiedades que esta suite verifica UNA POR UNA contra el servidor real:
//
//   1. Arranque en frío: se baja el mapa y se sirve.
//   2. Mapa renovado: cambia el nombre, se baja solo, y el anterior SE
//      BORRA — si no, cada renovación deja una copia entera del mapa viejo
//      tirada en un volumen que se paga por GB, y se acumulan.
//   3. Lo que no cambió no se vuelve a bajar (el estilo oscuro conserva su
//      nombre y su archivo no se toca).
//   4. Reiniciar sin release nuevo no mueve un byte.
//
// Y el contrato de las dos URLs de tile: la versionada es inmutable (un año
// de caché) y la de siempre —la que piden los APK que ya están en la calle—
// sigue contestando, con caché de 30 días.
//
// El fixture: los .pmtiles de tiles-fixture/ copiados con nombres
// versionados. Lo que se prueba es el mecanismo de renovación, no la
// cartografía; el mapa de verdad pesa cientos de MB y no vive en el repo.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const S = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const PUERTO = 3173;            // el servidor de verdad
const PUERTO_RELEASE = 3174;    // el que hace de release de GitHub
const API = `http://localhost:${PUERTO}`;
const DB = path.join(S, 'renovacion.db');
const VOLUMEN = path.join(S, 'renovacion-tiles');      // el TILES_DIR: hace de volumen
const RELEASE = path.join(S, 'renovacion-release');    // lo que publica el workflow
const FIXTURE = path.join(S, 'tiles-fixture');

const limpiar = () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  for (const d of [VOLUMEN, RELEASE]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
};

// Lo que el workflow deja publicado: los .pmtiles con su versión en el
// nombre y el zonas.json que los nombra.
function publicarRelease(versiones) {
  fs.rmSync(RELEASE, { recursive: true, force: true });
  fs.mkdirSync(RELEASE, { recursive: true });
  const archivos = {};
  for (const [estilo, version] of Object.entries(versiones)) {
    const nombre = `juliaca-${estilo}-${version}.pmtiles`;
    fs.copyFileSync(path.join(FIXTURE, `juliaca-${estilo}.pmtiles`), path.join(RELEASE, nombre));
    archivos[estilo] = nombre;
  }
  fs.writeFileSync(path.join(RELEASE, 'zonas.json'), JSON.stringify({
    juliaca: {
      nombre: 'Juliaca',
      bbox: [-70.21, -15.56, -70.04, -15.41],
      zooms: [11, 18],
      archivos, versiones,
      extraido: '2026-08-07',
    },
  }, null, 2));
}

const listar = () => { try { return fs.readdirSync(VOLUMEN).sort(); } catch { return []; } };
const marcaDe = (f) => { try { const s = fs.statSync(path.join(VOLUMEN, f)); return s.mtimeMs + ':' + s.size; } catch { return null; } };

// El servidor real, con el volumen y el release apuntados a los de arriba.
// Se espera a que el mapa que anuncia sea el que se acaba de publicar: es
// la señal observable de que la descarga terminó.
async function arrancarYEsperar(versionEsperada) {
  const p = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PUERTO), DB_FILE: DB,
      DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      TILES_DIR: VOLUMEN,
      TILES_RELEASE_URL: `http://localhost:${PUERTO_RELEASE}`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    try {
      const z = await (await fetch(API + '/tiles/zonas.json')).json();
      if (z.juliaca?.versiones?.claro === versionEsperada) return p;
    } catch {}
  }
  console.error('  [el servidor nunca anunció', versionEsperada + ']', err.slice(0, 500));
  return p;
}

// Apagar y esperar a que suelte el puerto: si no, el siguiente arranque no
// puede atarse y la ronda que sigue le habla al servidor de la anterior.
async function apagar(p) {
  if (!p) return;
  p.kill();
  for (let i = 0; i < 40; i++) {
    const vivo = await fetch(API + '/ping').then(() => true, () => false);
    if (!vivo) return;
    await sleep(250);
  }
}

// ─── LA MITAD QUE NO SE VE CORRIENDO ─────────────────────────
// El servidor de acá abajo se prueba solo. Lo que NO se puede probar
// levantándolo es la otra punta de la cadena: que el extractor le ponga la
// versión al nombre, y que las dos pantallas la pongan en la URL. Si
// cualquiera de las tres se cae, el servidor sigue en verde y la renovación
// deja de funcionar en silencio — que es exactamente como estaba antes.
//
// Se busca la FORMA del código y no una palabra suelta: un comentario que
// diga "versión" no alcanza para pasar (la lección de la suite `vendor`).
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
{
  console.log('EL EXTRACTOR Y LAS PANTALLAS SOSTIENEN SU PUNTA');

  const extractor = leer('herramientas/mapa-propio/extraer.js');
  ok('el extractor calcula la versión del contenido (sha256)',
     /createHash\('sha256'\)/.test(extractor) && /versionDe/.test(extractor));
  ok('y la mete en el nombre del archivo',
     /`\$\{zonaId\}-\$\{estilo\}-\$\{version\}\.pmtiles`/.test(extractor));
  ok('y la declara en zonas.json, que es de donde la leen las pantallas',
     /\n\s*versiones,/.test(extractor));

  // Las dos pantallas que dibujan el mapa del chofer. Son las que cachean
  // tiles de verdad: la web por el service worker, la nativa por el WebView.
  const web = leer('project/Prototipo.html');
  ok('la app web saca la versión de la zona y la pone en la URL de la tile',
     /versiones\?\.\[estilo\]/.test(web) && /\$\{v \? '\/v' \+ v : ''\}/.test(web));
  const nativa = leer('app/mapa.js');
  ok('la app nativa hace lo mismo en su WebView',
     /\(zo\.versiones \|\| \{\}\)\.oscuro/.test(nativa) && /\(v \? '\/v' \+ v : ''\)/.test(nativa));

  // Las dos rutas del servidor: la versionada y la de los APK que ya están
  // en la calle. Borrar la segunda deja sin mapa a los teléfonos de hoy.
  const servidorJs = leer('server/index.js');
  ok('el servidor atiende la URL versionada',
     /'\/tiles\/xyz\/:zona\/:estilo\/:version\/:z\/:x\/:y\.png'/.test(servidorJs));
  ok('y sigue atendiendo la de siempre (los APK que ya están en la calle)',
     /'\/tiles\/xyz\/:zona\/:estilo\/:z\/:x\/:y\.png'/.test(servidorJs));
  ok('y borra las versiones que reemplazó',
     /limpiarVersionesViejas\(zonas\)/.test(servidorJs));

  // El workflow ya no puede seguir diciendo que hay que vaciar el volumen a
  // mano: es justo el procedimiento que esto vino a borrar.
  const wf = leer('.github/workflows/mapa-propio.yml');
  ok('el workflow ya no manda vaciar la carpeta del volumen a mano',
     !/hay que vaciar la\s*\n?#?\s*carpeta de tiles del volumen y redesplegar/.test(wf));
}

let release = null, servidor = null;
(async () => {
  limpiar();

  // Que los dos puertos estén LIBRES antes de empezar (la misma lección que
  // `cascada` y `regresion`): un servidor todavía apagándose de otra corrida
  // hace fallar el `listen` de acá, y la suite se cae por un motivo que no
  // tiene nada que ver con lo que prueba.
  for (let i = 0; i < 40; i++) {
    const ocupado = await Promise.all([
      fetch(API + '/ping').then(() => true, () => false),
      fetch(`http://localhost:${PUERTO_RELEASE}/zonas.json`).then(() => true, () => false),
    ]);
    if (!ocupado.includes(true)) break;
    if (i === 39) throw new Error(`los puertos ${PUERTO}/${PUERTO_RELEASE} siguen ocupados por otra corrida`);
    await sleep(250);
  }

  // El release de GitHub, de mentira: un file server sobre RELEASE
  release = http.createServer((req, res) => {
    const nombre = path.basename(decodeURIComponent(req.url.split('?')[0]));
    const ruta = path.join(RELEASE, nombre);
    if (!fs.existsSync(ruta) || !fs.statSync(ruta).isFile()) { res.statusCode = 404; return res.end('no'); }
    res.end(fs.readFileSync(ruta));
  });
  await new Promise(r => release.listen(PUERTO_RELEASE, r));

  // ── RONDA 1: el servidor nuevo se baja el mapa ──────────────
  console.log('\nARRANQUE EN FRÍO: EL MAPA SE BAJA SOLO');
  publicarRelease({ claro: '11111111', oscuro: '22222222' });
  servidor = await arrancarYEsperar('11111111');

  ok('el volumen arrancó vacío y ahora tiene el mapa',
     listar().includes('juliaca-claro-11111111.pmtiles') &&
     listar().includes('juliaca-oscuro-22222222.pmtiles'), listar());
  ok('zonas.json publica la versión de cada estilo',
     (await (await fetch(API + '/tiles/zonas.json')).json()).juliaca?.versiones?.oscuro === '22222222');

  // La URL versionada: la que arma la cascada desde que zonas.json trae
  // `versiones`. Sus bytes no cambian nunca, así que se guarda un año.
  const v1 = await fetch(API + '/tiles/xyz/juliaca/claro/v11111111/15/10000/17812.png');
  ok('la tile versionada llega como PNG', v1.status === 200 &&
     (v1.headers.get('content-type') || '').includes('image/png'), v1.status);
  ok('y se puede guardar para siempre (inmutable)',
     /max-age=31536000.*immutable/.test(v1.headers.get('cache-control') || ''), v1.headers.get('cache-control'));

  // La de siempre: la que piden los APK que ya están en la calle. Contesta
  // igual, pero con caché corta — su contenido SÍ cambia al renovar.
  const s1 = await fetch(API + '/tiles/xyz/juliaca/claro/15/10000/17812.png');
  ok('la URL sin versión sigue contestando (los APK viejos ven el mapa)', s1.status === 200, s1.status);
  ok('pero con caché de 30 días, no de un año',
     /max-age=2592000/.test(s1.headers.get('cache-control') || ''), s1.headers.get('cache-control'));

  const oscuroAntes = marcaDe('juliaca-oscuro-22222222.pmtiles');
  await apagar(servidor);

  // ── RONDA 2: el mapa se renovó ──────────────────────────────
  // Solo el claro cambia. Y se deja basura en el volumen: un .tmp de una
  // descarga cortada y un archivo que ya nadie nombra.
  console.log('\nMAPA RENOVADO: BAJA SOLO Y EL VIEJO SE VA');
  publicarRelease({ claro: '33333333', oscuro: '22222222' });
  fs.writeFileSync(path.join(VOLUMEN, 'juliaca-claro-99999999.pmtiles.tmp'), 'descarga cortada');
  fs.writeFileSync(path.join(VOLUMEN, 'sobra-vieja.pmtiles'), 'de una versión que ya nadie nombra');
  servidor = await arrancarYEsperar('33333333');

  const tras2 = listar();
  ok('el mapa nuevo está en el volumen', tras2.includes('juliaca-claro-33333333.pmtiles'), tras2);
  ok('EL VIEJO SE BORRÓ (sin esto, cada renovación ocupa el doble)',
     !tras2.includes('juliaca-claro-11111111.pmtiles'), tras2);
  ok('el estilo que no cambió NO se volvió a bajar',
     marcaDe('juliaca-oscuro-22222222.pmtiles') === oscuroAntes,
     { antes: oscuroAntes, ahora: marcaDe('juliaca-oscuro-22222222.pmtiles') });
  ok('la descarga cortada (.tmp) se limpió', !tras2.some(f => f.endsWith('.tmp')), tras2);
  ok('y el archivo que ya nadie nombra también', !tras2.includes('sobra-vieja.pmtiles'), tras2);

  // Que la tile siga llegando DESPUÉS de borrar el archivo viejo es la
  // prueba de que el servidor está leyendo el nuevo: si hubiera quedado
  // colgado del nombre anterior, esto sería un 404.
  const v2 = await fetch(API + '/tiles/xyz/juliaca/claro/v33333333/15/10000/17812.png');
  ok('la tile del mapa NUEVO llega (el servidor cambió de archivo)', v2.status === 200, v2.status);
  const viejaUrl = await fetch(API + '/tiles/xyz/juliaca/claro/v11111111/15/10000/17812.png');
  ok('y la pantalla que quedó abierta con la versión vieja recibe el mapa de ahora, no un 404',
     viejaUrl.status === 200, viejaUrl.status);

  // Los .pmtiles son lo que pesa: son ELLOS los que no se pueden volver a
  // bajar por gusto. zonas.json es aparte y va abajo.
  const pesados = () => Object.fromEntries(listar().filter(f => f.endsWith('.pmtiles')).map(f => [f, marcaDe(f)]));
  const marcasTras2 = pesados();
  await apagar(servidor);

  // ── RONDA 3: nada nuevo que bajar ───────────────────────────
  console.log('\nSIN RELEASE NUEVO: NO SE MUEVE UN BYTE');
  const indiceTras2 = marcaDe('zonas.json');
  servidor = await arrancarYEsperar('33333333');

  // OJO con la espera: acá el índice YA dice 33333333 desde la ronda
  // anterior, así que `arrancarYEsperar` vuelve apenas el servidor contesta
  // — puede ser ANTES de que la descarga de arranque haya corrido. Esperar
  // a que el índice se reescriba es lo que da la señal de que la pasada
  // terminó de verdad; sin esto, la aserción de abajo pasaba por no haber
  // pasado nada todavía, que es la peor forma de estar en verde.
  let indiceNuevo = false;
  for (let i = 0; i < 80 && !indiceNuevo; i++) {
    await sleep(250);
    indiceNuevo = marcaDe('zonas.json') !== indiceTras2;
  }
  // Que el índice se vuelva a pedir en cada arranque no es un detalle: son
  // unos cientos de bytes y es la ÚNICA forma que tiene el servidor de
  // enterarse de que hay un mapa nuevo. Uno que no lo relee no se renueva
  // nunca.
  ok('el índice se vuelve a pedir (es como se entera de una renovación)',
     indiceNuevo, { antes: indiceTras2, ahora: marcaDe('zonas.json') });
  // Y recién ahora la pregunta que importa: con la pasada ya hecha, los
  // archivos pesados siguen intactos.
  ok('y con la pasada hecha, no se re-bajó ni un .pmtiles (renovar no cuesta si no cambió nada)',
     JSON.stringify(pesados()) === JSON.stringify(marcasTras2),
     { antes: marcasTras2, ahora: pesados() });

  // ── Y lo que NO puede pasar: la ruta no es un file server ───
  console.log('\nLA VERSIÓN NO ABRE PUERTAS');
  for (const mala of ['xyz/juliaca/claro/v..%2F..%2Fpackage.json/15/10000/17812.png',
                      'xyz/juliaca/claro/VERSION-RARA/15/10000/17812.png',
                      'xyz/juliaca/claro/v1/15/10000/17812.png']) {
    const r = await fetch(API + '/tiles/' + mala);
    ok(`rechaza ${mala.split('/')[3]}`, r.status === 404, r.status);
  }

  await apagar(servidor);
  // `close()` solo deja de aceptar conexiones NUEVAS: las de keep-alive que
  // dejó abiertas el fetch del servidor lo tendrían esperando, y la suite
  // que corre después encontraría el puerto tomado. Se las cierra a mano.
  release.closeAllConnections?.();
  await new Promise(r => release.close(r));
  limpiar();
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})().catch(async (e) => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  if (release) release.close();
  limpiar();
  process.exit(1);
});
