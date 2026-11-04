// Varias combis por persona, en las pantallas (habilitaciones, 30/10).
//
// De punta a punta, en Chromium: Despacho le habilita a Pedro la combi de
// Juan desde Gestión → Personas; Juan la está manejando; Pedro entra por la
// web y en la puerta elige en qué combi sale —ve que la otra la maneja Juan
// y tiene que confirmar el relevo—, sale a ruta, y la combi pasa a ser de él.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/combis-web.db';
const P = 3164;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '400' },
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

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const H = { Authorization: 'Bearer ' + D.token };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-05']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-' + v.slice(2), 'R-14', emp, Date.now());
  }
  for (const [u, n, v] of [['juan', 'Juan Quispe', 'M-01'], ['pedro', 'Pedro Mamani', 'M-05']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, vehicleId: v, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  // Juan sale a ruta en M-01
  const tJuan = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'juan', password: 'clave12345' }) })).body.token;
  const wsJuan = new WebSocket(`ws://localhost:${P}`);
  const rolesJuan = [];
  wsJuan.on('message', m => { const x = JSON.parse(m); if (x.type === 'gps_role') rolesJuan.push(x); });
  await new Promise(r => wsJuan.on('open', r));
  wsJuan.send(JSON.stringify({ type: 'identify', token: tJuan }));
  wsJuan.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));
  await sleep(400);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];

  console.log('\nDESPACHO LE HABILITA A PEDRO LA COMBI DE JUAN');
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await interceptarHttps(dctx);
  const de = await dctx.newPage();
  de.on('pageerror', e => errores.push('despacho: ' + e.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(2500);
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1500);
  const filaPedro = de.locator('div').filter({ hasText: 'pedro' }).filter({ has: de.locator('button:has-text("Combis")') }).last();
  await filaPedro.locator('button:has-text("Combis")').click();
  await de.waitForSelector('[data-combis-de="pedro"]', { timeout: 5000 });
  ok('se abre el editor de sus combis', true);
  const hoy = await de.$eval('[data-combis-de="pedro"] [data-habilitar="M-05"]', b => ({ texto: b.innerText, deshabilitado: b.disabled }));
  ok('la de hoy está marcada y no se puede sacar', /✓ M-05 · hoy/.test(hoy.texto) && hoy.deshabilitado, hoy);
  await de.click('[data-combis-de="pedro"] [data-habilitar="M-01"]');
  await de.click('[data-combis-de="pedro"] button:has-text("Guardar")');
  await de.waitForTimeout(1500);
  const habil = base.prepare("SELECT vehicleId FROM habilitaciones WHERE personId = 'pedro' ORDER BY vehicleId").all().map(h => h.vehicleId);
  ok('guardado: Pedro puede manejar M-01 y M-05', habil.join() === 'M-01,M-05', habil);
  const unidad = await de.evaluate(() => [...document.querySelectorAll('span')].find(s => /^M-05 \+1$/.test(s.innerText.trim()))?.innerText || null);
  ok('la lista lo muestra: M-05 +1', unidad === 'M-05 +1', unidad);
  await de.click('button:has-text("Vehículos")');
  await de.waitForTimeout(1500);
  const enVehiculos = await de.evaluate(() => document.body.innerText);
  ok('y Vehículos dice que M-01 también la puede manejar Pedro', /también Pedro Mamani/.test(enVehiculos));

  console.log('\nPEDRO ELIGE EN LA PUERTA');
  const cctx = await browser.newContext({
    viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: -15.49, longitude: -70.133, accuracy: 10 },
  });
  await interceptarHttps(cctx);
  const ch = await cctx.newPage();
  ch.on('pageerror', e => errores.push('chofer: ' + e.message));
  await ch.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  await ch.fill('input[type="text"]', 'pedro');
  await ch.fill('input[type="password"]', 'clave12345');
  await ch.click('button:has-text("INGRESAR")');
  await ch.waitForSelector('[data-combis]', { timeout: 15000 });
  const lista = await ch.$eval('[data-combis]', d => d.innerText);
  ok('la puerta pregunta en qué combi sale', /¿En qué combi salís\?/i.test(lista), lista);
  ok('M-05 elegida y libre', /M-05[\s\S]*libre[\s\S]*ELEGIDA/.test(lista), lista);
  ok('M-01: la maneja Juan', /M-01[\s\S]*la maneja Juan Quispe/.test(lista), lista);

  await ch.click('[data-combi="M-01"]');
  await ch.waitForTimeout(300);
  const aviso = await ch.$eval('[data-combis] [role="alert"]', d => d.innerText).catch(() => null);
  ok('elegir la de Juan pide confirmar el relevo, nombrándolo', !!aviso && /M-01 la está manejando Juan Quispe/.test(aviso), aviso);
  ok('y todavía no cambió nada', base.prepare("SELECT vehicleId FROM users WHERE unitId = 'pedro'").get().vehicleId === 'M-05');
  await ch.click('button:has-text("ES UN RELEVO")');
  await ch.waitForTimeout(800);
  const elegida = await ch.$eval('[data-combi="M-01"]', b => b.getAttribute('aria-pressed'));
  ok('confirmado: M-01 queda elegida', elegida === 'true', elegida);
  ok('su combi de hoy es M-01', base.prepare("SELECT vehicleId FROM users WHERE unitId = 'pedro'").get().vehicleId === 'M-01');
  ok('y la sesión guardada también', await ch.evaluate(() => JSON.parse(localStorage.getItem('r14_session')).vehicleId) === 'M-01');
  ok('elegir no le sacó nada a Juan', !rolesJuan.some(r => r.reporting === false));

  console.log('\nSALE A RUTA: EL RELEVO');
  await ch.click('button:has-text("SALIR A RUTA")');
  await ch.waitForTimeout(2500);
  ok('a Juan se le avisa que otro tomó la unidad', rolesJuan.some(r => r.reporting === false && /Otro chofer/.test(r.reason || '')), rolesJuan);
  const turnos = base.prepare('SELECT personId, vehicleId FROM shifts WHERE endedAt IS NULL').all();
  ok('el turno abierto es el de Pedro en M-01', turnos.length === 1 && turnos[0].personId === 'pedro' && turnos[0].vehicleId === 'M-01', turnos);
  ok('y queda en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'relevo' AND actor = 'pedro' AND target = 'juan'").get());

  ok('ninguna de las dos páginas tiró errores', errores.length === 0, errores);

  wsJuan.close();
  await browser.close();
  base.close();
  if (servidor) servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
