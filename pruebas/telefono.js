// La salud del teléfono en la tarjeta de Despacho (PENDIENTES 0.4, 03/11).
//
// «No aparece en el mapa» se averiguaba llamando al chofer. La app ya sabía
// la respuesta la mitad de las veces —batería, ahorro de batería de Android,
// versión vieja—; ahora la manda pegada a sus posiciones y Despacho la ve:
//
//   - la nativa por POST /gps (con su versión en la cabecera); valores raros
//     no se inventan;
//   - le llega SÓLO a los paneles de esa ruta: ni a los choferes (tampoco en
//     el `state`) ni al Despacho de otra ruta;
//   - la versión se compara con la que se reparte (APP_VERSION_*);
//   - la web por el socket, con la batería del navegador;
//   - y en la tarjeta, en Chromium: batería, cargando, «se está por apagar»,
//     ahorro de batería y versión.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/telefono.db';
const P = 3194;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      STATE_INTERVAL_MS: '300', APP_VERSION_ACTUAL: '6', APP_VERSION_MIN: '5' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const pedir = (ruta, o = {}) => fetch(`http://localhost:${P}${ruta}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
async function socket(token, mirar) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => ws.visto.push(JSON.parse(raw)));
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  if (mirar) ws.send(JSON.stringify({ type: 'watch', routeId: mirar }));
  await sleep(400);
  return ws;
}
const ultimo = (ws, tipo) => [...ws.visto].reverse().find(m => m.type === tipo) || null;
const gps = (token, telefono, version = '0.2.3/5') => pedir('/gps', { method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'X-App-Version': version },
  body: JSON.stringify({ presencia: 'ruta', telefono, posiciones: [{ lat: -15.49, lng: -70.133, speed: 20, timestamp: Date.now() }] }) });

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const H = { Authorization: 'Bearer ' + D };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?,?,?,?,?,?)')
    .run('R-20', 'Juliaca – Puno', 5, 90, emp, Date.now());
  for (const v of ['M-01', 'M-02', 'M-03']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run(v, null, 'R-14', emp, Date.now());
  }
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-20', 'Despacho 20', 'Despacho 20', 'dispatch', 'R-20', ?, ?, ?)`).run(emp, hashPassword('despacho-ruta'), Date.now());
  for (const [u, n, v] of [['pedro', 'Pedro Mamani', 'M-01'], ['luis', 'Luis Apaza', 'M-02'], ['ana', 'Ana Ccama', 'M-03']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, vehicleId: v, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  const panel = await socket(D, 'R-14');
  const d20 = await socket(await entrar('DESP-20', 'despacho-ruta'));
  const tAna = await entrar('ana', 'clave12345');
  const ana = await socket(tAna);

  console.log('\nLA NATIVA, POR POST /gps');
  const tPedro = await entrar('pedro', 'clave12345');
  const tLuis = await entrar('luis', 'clave12345');
  await gps(tPedro, { origen: 'app', bateria: 0.62, cargando: true, optimizada: false }, '0.3.0/6');
  await gps(tLuis, { origen: 'app', bateria: 0.08, cargando: false, optimizada: true }, '0.2.3/5');
  await sleep(900);
  let t = ultimo(panel, 'telefonos');
  ok('a Despacho le llega cómo está cada teléfono', !!(t && t.items.pedro && t.items.luis), t);
  ok('Pedro: 62 %, cargando, sin ahorro, la app al día',
     t.items.pedro.bateria === 62 && t.items.pedro.cargando === true && t.items.pedro.optimizada === false &&
     t.items.pedro.version === '0.3.0' && t.items.pedro.versionEstado === 'al_dia', t.items.pedro);
  ok('Luis: 8 %, con el ahorro de batería, y hay una versión nueva',
     t.items.luis.bateria === 8 && t.items.luis.optimizada === true && t.items.luis.versionEstado === 'hay_nueva', t.items.luis);
  await gps(tLuis, { origen: 'app', bateria: 0.08, cargando: false, optimizada: true }, '0.2.0/4');
  await sleep(900);
  ok('con una versión debajo de la mínima: vieja', ultimo(panel, 'telefonos').items.luis.versionEstado === 'vieja');
  await gps(tPedro, { origen: 'app', bateria: 7, cargando: 'sí', optimizada: 1 }, '0.3.0/6');
  await sleep(900);
  const raro = ultimo(panel, 'telefonos').items.pedro;
  ok('valores raros no se inventan: quedan en blanco', raro.bateria === null && raro.cargando === null && raro.optimizada === null, raro);

  console.log('\nSÓLO A LOS PANELES DE ESA RUTA');
  ok('el chofer de la misma ruta no lo recibe', !ana.visto.some(m => m.type === 'telefonos'));
  ok('ni viaja en el estado que le llega', !JSON.stringify(ana.visto.filter(m => m.type === 'state')).includes('bateria'));
  ok('el Despacho de otra ruta tampoco', !d20.visto.some(m => m.type === 'telefonos' && m.routeId === 'R-14' && Object.keys(m.items).length));
  const otro = await socket(D);
  ok('un panel que se conecta recibe lo que ya se sabe', (ultimo(otro, 'telefonos') || { items: {} }).items.luis?.bateria === 8);
  otro.close();

  console.log('\nLA WEB, POR EL SOCKET');
  const tAnaWeb = await entrar('ana', 'clave12345');
  const anaWeb = await socket(tAnaWeb);
  anaWeb.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));
  anaWeb.send(JSON.stringify({ type: 'gps', lat: -15.491, lng: -70.134, speed: 15, telefono: { origen: 'web', bateria: 0.15, cargando: false } }));
  await sleep(900);
  const web = ultimo(panel, 'telefonos').items.ana;
  ok('llega con su batería, como web y sin versión de app', web && web.bateria === 15 && web.origen === 'web' && web.version === null, web);
  anaWeb.close();

  console.log('\nEN LA TARJETA DE DESPACHO (Chromium)');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  // La página del chofer con la batería del navegador simulada
  const cctx = await browser.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: -15.4905, longitude: -70.1335, accuracy: 10 } });
  await interceptarHttps(cctx);
  await cctx.addInitScript(() => { navigator.getBattery = () => Promise.resolve({ level: 0.43, charging: true }); });
  const ch = await cctx.newPage();
  ch.on('pageerror', e => errores.push('chofer: ' + e.message));
  await ch.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  await ch.fill('input[type="text"]', 'ana');
  await ch.fill('input[type="password"]', 'clave12345');
  await ch.click('button:has-text("INGRESAR")');
  await ch.click('button:has-text("SALIR A RUTA")', { timeout: 15000 });

  const dctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await interceptarHttps(dctx);
  const de = await dctx.newPage();
  de.on('pageerror', e => errores.push('despacho: ' + e.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await gps(tLuis, { origen: 'app', bateria: 0.08, cargando: false, optimizada: true }, '0.2.3/5');
  await gps(tPedro, { origen: 'app', bateria: 0.62, cargando: true, optimizada: false }, '0.3.0/6');
  const tarjeta = async (id) => de.$eval(`[data-telefono="${id}"]`, e => e.innerText).catch(() => null);
  let luis = null, anaT = null, pedro = null;
  for (let i = 0; i < 40 && !(luis && anaT && pedro && /43/.test(anaT)); i++) {
    await de.waitForTimeout(500);
    luis = await tarjeta('luis'); anaT = await tarjeta('ana'); pedro = await tarjeta('pedro');
  }
  ok('Luis: la batería en ámbar y que se está por apagar', /BATERÍA 8 %/.test(luis || '') && /SE ESTÁ POR APAGAR/.test(luis || ''), luis);
  ok('el ahorro de batería, dicho con lo que causa', /AHORRO DE BATERÍA ACTIVADO: PUEDE DESAPARECER DEL MAPA/.test(luis || ''));
  ok('y la versión, con que hay una nueva', /APP 0\.2\.3/.test(luis || '') && /HAY UNA VERSIÓN NUEVA DE LA APP/.test(luis || ''));
  ok('Pedro, todo bien: una línea gris y nada más', /BATERÍA 62 % · CARGANDO · APP 0\.3\.0/.test(pedro || '') &&
     !/AHORRO|POR APAGAR|VERSIÓN NUEVA/.test(pedro || ''), pedro);
  ok('Ana, desde la web: la batería que dio el navegador', /BATERÍA 43 % · CARGANDO · WEB/.test(anaT || ''), anaT);
  ok('ninguna página tiró errores', errores.length === 0, errores);

  await browser.close();
  for (const w of [panel, d20, ana]) w.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
