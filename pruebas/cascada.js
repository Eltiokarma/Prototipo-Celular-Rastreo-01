// La cascada de tiles, vista desde el navegador del chofer.
//
// Tres niveles: caché del service worker → mapa propio → proveedor. Esta
// suite verifica el contrato que no se puede ver en el código quieto:
//
//   1. En zooms cubiertos por el mapa propio, las tiles salen de NUESTRO
//      servidor y el proveedor no recibe ni un pedido.
//   2. Cuando el mapa propio no tiene la tile (404), esa tile — y solo
//      esa — cae al proveedor. El mapa no queda con huecos.
//   3. Los contadores (window.TILES_STATS) cuentan la verdad, porque son
//      la evidencia con la que se verifica "el proveedor es la excepción".
//
// El fixture (tiles-fixture/) tiene tiles reales solo en z14-16 y declara
// z11-18: acercarse a z17 es pedir algo que no está — el rescate en vivo.
//
// Acá se lo copia con NOMBRES VERSIONADOS, que es como se ve un mapa
// extraído desde que se puede renovar: `juliaca-oscuro-c0ffee01.pmtiles`,
// y el índice declarando esa versión. Así este navegador pide las URLs que
// pide el chofer de verdad —con la versión adentro—, que es lo que hace que
// un mapa nuevo le llegue al celular en vez de quedarse con el cacheado.
// (El caso contrario —un volumen viejo, sin versiones— lo cubre `tiles`.)
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/cascada.db';
const P = 3172;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
(async () => {
  // Que el puerto esté LIBRE antes de arrancar: un servidor zombi de una
  // corrida anterior contesta con SU base y todos los pasos fallan por
  // motivos que no tienen nada que ver con la cascada.
  for (let i = 0; i < 40; i++) {
    const vivo = await fetch(`http://localhost:${P}/ping`).then(() => true, () => false);
    if (!vivo) break;
    if (i === 39) throw new Error(`el puerto ${P} sigue ocupado por otra corrida`);
    await sleep(250);
  }
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

  // El mismo fixture, con los nombres y el índice de un mapa versionado
  const TILES = S + '/cascada-tiles';
  fs.rmSync(TILES, { recursive: true, force: true });
  fs.mkdirSync(TILES, { recursive: true });
  const VERSIONES = { claro: 'c0ffee01', oscuro: 'c0ffee02' };
  for (const [estilo, version] of Object.entries(VERSIONES)) {
    fs.copyFileSync(`${S}/tiles-fixture/juliaca-${estilo}.pmtiles`,
                    `${TILES}/juliaca-${estilo}-${version}.pmtiles`);
  }
  fs.writeFileSync(TILES + '/zonas.json', JSON.stringify({
    juliaca: {
      nombre: 'Juliaca', bbox: [-70.21, -15.56, -70.04, -15.41], zooms: [11, 18],
      archivos: { claro: `juliaca-claro-${VERSIONES.claro}.pmtiles`,
                  oscuro: `juliaca-oscuro-${VERSIONES.oscuro}.pmtiles` },
      versiones: VERSIONES,
    },
  }));

  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           TILES_DIR: TILES, STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); break; } catch {}
  }

  const pedir = (ruta, opts = {}) =>
    fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
      .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) });
  if (!login.body.token) { console.error('login DESPACHO falló:', login); process.exit(1); }
  // El vehículo lo da de alta la GERENCIA (fusión de paneles): la cuenta se
  // crea directo en la base, como hace la suite de seguridad.
  {
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const coop = require(RAIZ + '/server/cooperativas.js');
    const base = new Database(DB);
    coop.gerente(base, { companyId: 'R14', usuario: 'GER-CAS', clave: 'gerentecas1' });
    base.close();
  }
  const lg = await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'GER-CAS', password: 'gerentecas1' }) });
  if (!lg.body.token) { console.error('login gerente falló:', lg); process.exit(1); }
  const veh = await pedir('/admin/vehicles', {
    method: 'POST', headers: { Authorization: 'Bearer ' + lg.body.token },
    body: JSON.stringify({ vehicleId: 'M-12', label: 'Combi 12' }),
  });
  if (veh.status !== 200) { console.error('alta de vehículo falló:', veh); process.exit(1); }
  const alta = await pedir('/admin/users', {
    method: 'POST', headers: { Authorization: 'Bearer ' + login.body.token },
    body: JSON.stringify({ unitId: 'M-12', name: 'Elmer Ccama', password: 'chofer1234' }),
  });
  if (alta.status !== 200 && alta.status !== 201) { console.error('alta M-12 falló:', alta); process.exit(1); }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: -15.4904, longitude: -70.1333 },  // centro de Juliaca
  });
  await interceptarHttps(ctx);

  // El registro de todo lo que el navegador pide: la evidencia
  const pedidos = [];
  ctx.on('request', r => pedidos.push(r.url()));
  const respuestas = new Map();
  ctx.on('response', r => respuestas.set(r.url(), r.status()));

  const p = await ctx.newPage();
  p.on('pageerror', e => console.error('  [página]', e.message));
  await p.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.fill('input[type="text"]', 'M-12');
  await p.fill('input[type="password"]', 'chofer1234');
  await p.click('button:has-text("INGRESAR")');
  await p.waitForTimeout(3000);
  try {
    await p.click('button:has-text("SALIR A RUTA")', { timeout: 15000 });
  } catch (e) {
    console.error('  [pantalla al fallar]', (await p.evaluate(() => document.body.innerText)).slice(0, 300));
    throw e;
  }
  await p.waitForTimeout(1000);

  // A la pantalla del mapa: es un carrusel — se llega DESLIZANDO a la
  // izquierda desde el HUD (chat=0, HUD=1, mapa=2), como con el dedo.
  const deslizar = async () => {
    await p.mouse.move(360, 250);
    await p.mouse.down();
    for (let x = 360; x >= 40; x -= 40) { await p.mouse.move(x, 250); await p.waitForTimeout(30); }
    await p.mouse.up();
    await p.waitForTimeout(900);
  };
  await deslizar();
  // Si el HUD arrancó en otra página, un segundo deslizamiento no hace daño
  if (!(await p.locator('.leaflet-container').count())) await deslizar();
  await p.waitForTimeout(3500);

  console.log('\nNIVEL 2: EN ZONA, LAS TILES SON NUESTRAS');
  const propias = () => pedidos.filter(u => u.includes('/tiles/xyz/'));
  const alProveedor = () => pedidos.filter(u => u.includes('maps.geoapify.com'));
  ok('la pantalla pidió tiles del mapa propio', propias().length > 0, propias().length);
  ok('todas las del mapa propio llegaron bien (200)',
     propias().every(u => respuestas.get(u) === 200),
     propias().map(u => respuestas.get(u)).filter(s => s !== 200));
  const proveedorAntes = alProveedor().length;
  ok('y el proveedor no recibió NI UN pedido', proveedorAntes === 0, proveedorAntes);

  const stats1 = await p.evaluate(() => window.TILES_STATS);
  ok('los contadores lo confirman: propias > 0, rescatadas = 0',
     stats1 && stats1.propias > 0 && stats1.rescatadas === 0, stats1);

  // La versión del mapa, en la URL de cada tile. Es lo que hace que una
  // renovación le llegue al chofer: el service worker guarda las tiles
  // caché-primero y sin expiración, así que con la URL de siempre seguiría
  // viendo el mapa viejo hasta que la poda lo sacara. Y el `/v` no puede
  // salir de una variable sin valor: `/vundefined/` daría 404 en cada tile.
  const FORMA = /^\/tiles\/xyz\/juliaca\/(claro|oscuro)\/v(c0ffee01|c0ffee02)\/\d+\/\d+\/\d+\.png$/;
  const rutas = propias().map(u => new URL(u).pathname);
  ok('todas las tiles propias piden la versión que declara el índice',
     rutas.length > 0 && rutas.every(r => FORMA.test(r)), rutas.filter(r => !FORMA.test(r)).slice(0, 3));
  ok('y ninguna salió con una versión sin valor',
     !rutas.some(r => /\/v(undefined|null|)\//.test(r)), rutas.filter(r => /\/v(undefined|null|)\//.test(r)).slice(0, 3));

  console.log('\nNIVEL 3: LA TILE QUE NO TENEMOS CAE AL PROVEEDOR');
  // Acercarse con la rueda hasta z17-18: el fixture no tiene esas tiles,
  // el servidor responde 404 y cada tile se rescata con el proveedor.
  // De a UN nivel por vez (60 px = 1 nivel para Leaflet): un golpe fuerte
  // saltaría a z19, que ya queda fuera de la zona y no prueba el rescate.
  const mapa = p.locator('.leaflet-container');
  await mapa.hover();
  for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -60); await p.waitForTimeout(1200); }
  await p.waitForTimeout(2500);

  const rescatadas = await p.evaluate(() => window.TILES_STATS.rescatadas);
  ok('hubo tiles pedidas al propio que no estaban y se rescataron', rescatadas > 0, rescatadas);
  ok('esas tiles se volvieron a pedir al proveedor', alProveedor().length > 0, alProveedor().length);
  ok('ninguna tile propia fallida quedó sin reintento: proveedor ≥ rescatadas',
     alProveedor().length >= rescatadas, { proveedor: alProveedor().length, rescatadas });
  const con404 = propias().filter(u => respuestas.get(u) === 404).length;
  ok('los 404 del propio existen (el rescate salió de ahí)', con404 > 0, con404);

  // El mapa no puede haber quedado con huecos: toda tile visible cargada
  const rotas = await p.evaluate(() =>
    [...document.querySelectorAll('.leaflet-tile')].filter(t => !t.complete || t.naturalWidth === 0).length);
  await p.waitForTimeout(1500);
  ok('sin huecos: todas las tiles del mapa terminaron cargadas', rotas === 0, rotas);

  await browser.close();
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  fs.rmSync(TILES, { recursive: true, force: true });
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
