// Despacho no queda en blanco (auditoría del 11/11).
//
//   - Un error al dibujar Gestión ya no se lleva el panel entero: queda un
//     cartel en Gestión que dice qué se rompió y «Volver al mapa», y el mapa
//     y el SOS siguen andando.
//   - Un error al dibujar el panel muestra el cartel del muro (no una página
//     en blanco) y la página se recarga sola.
//   - Si las librerías no llegan del CDN, la página lo dice en vez de quedar
//     en blanco sin un solo error.
//
// Los errores se fabrican desde afuera, sin tocar el código: Gestión recibe
// una lista de personas con un dato imposible (lo que dibuja revienta), y el
// panel entero se rompe con una línea agregada al HTML que sirve la prueba.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/muro.db';
const P = 3245;
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
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
const hasta = async (fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); }
  return false;
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };

async function abrir(browser, { romperPanel = false, sinLibrerias = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await interceptarHttps(ctx);
  if (sinLibrerias) await ctx.route(/unpkg\.com\/(react|react-dom|@babel)/, r => r.abort());
  if (romperPanel) {
    await ctx.route(/\/despacho\.html$/, async (r) => {
      const res = await r.fetch();
      const html = (await res.text()).replace(
        'function Panel({ session, onLogout, onAuthError, modo, onAlternarModo }) {',
        "function Panel({ session, onLogout, onAuthError, modo, onAlternarModo }) {\n  if (localStorage.getItem('r14_romper')) throw new Error('prueba del muro');");
      await r.fulfill({ response: res, body: html });
    });
  }
  const pg = await ctx.newPage();
  pg.errores = [];
  pg.on('pageerror', e => pg.errores.push(e.message));
  await pg.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return pg;
}
async function login(pg) {
  await pg.waitForSelector('input[type="password"]', { timeout: 30000 });
  await (await pg.$$('input'))[0].fill('DESPACHO');
  await pg.fill('input[type="password"]', 'despacho99');
  await pg.click('button:has-text("INGRESAR")');
  await pg.waitForTimeout(3000);
}
const texto = (pg) => pg.evaluate(() => document.body.innerText);

(async () => {
  borrarBase();
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  const a = await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\nSE ROMPE GESTIÓN');
  const pg = await abrir(browser);
  await login(pg);
  await pg.route(/\/admin\/users$/, (r) => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ users: [{ unitId: 'x', role: 'driver', name: { roto: true } }] }) })
    : r.continue());
  await pg.click('button:has-text("Gestión")');
  ok('Gestión muestra su cartel con el error', await hasta(async () => /Gestión se rompió/.test(await texto(pg))));
  ok('y dice que el mapa y los SOS siguen', /El mapa y los SOS siguen funcionando/.test(await texto(pg)));
  await pg.click('[data-muro="Gestión"] button:has-text("Volver al mapa")');
  await pg.waitForTimeout(500);
  ok('«Volver al mapa» vuelve al panel', !!(await pg.$('button:has-text("Gestión")')) && !/se rompió/.test(await texto(pg)));
  const pedro = new WebSocket(`ws://localhost:${P}`);
  await new Promise(r => pedro.on('open', r));
  pedro.send(JSON.stringify({ type: 'identify', token: await entrar('pedro', 'clave12345') }));
  await sleep(400);
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  ok('y un SOS que llega después se ve', await hasta(async () => !!(await pg.$('[data-sos-atendido]'))));
  pedro.close();
  await pg.context().close();

  console.log('\nSE ROMPE EL PANEL ENTERO');
  const pr = await abrir(browser, { romperPanel: true });
  await login(pr);
  await pr.evaluate(() => { sessionStorage.removeItem('r14_muro'); localStorage.setItem('r14_romper', '1'); });
  ok('no queda en blanco: el muro dice qué se rompió', await hasta(async () =>
    /El panel se rompió/.test(await texto(pr)) && /prueba del muro/.test(await texto(pr)), 8000));
  ok('y avisa que se recarga solo', /se recarga sola en \d+ s/.test(await texto(pr)));
  await pr.evaluate(() => localStorage.removeItem('r14_romper'));
  ok('a los 20 s se recargó y el panel volvió', await hasta(async () =>
    !!(await pr.$('button:has-text("Gestión")').catch(() => null)), 30000));
  await pr.context().close();

  console.log('\nSIN LIBRERÍAS');
  const pl = await abrir(browser, { sinLibrerias: true });
  ok('a los 8 s la página lo dice, en vez de quedar en blanco', await hasta(async () =>
    !!(await pl.$('[data-sin-librerias]')), 12000));
  ok('y nombra lo que no se ve', /no ves el mapa ni los SOS/.test(await texto(pl)));
  await pl.context().close();

  ok('sin errores de la página fuera de los fabricados', pg.errores.length === 0, pg.errores);
  await browser.close();
  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
