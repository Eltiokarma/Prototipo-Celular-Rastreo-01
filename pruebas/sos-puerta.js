// El SOS en la puerta (auditoría del 11/11).
//
// El chofer pasa por la puerta —antes de SALIR A RUTA, al volver a la
// cochera, cuando el vigía o Despacho lo dejan «fuera»— y ahí no tenía SOS:
// sólo el cobrador. Y sin sesión (un 401 la borra) no le quedaba ni el
// teléfono de la central. Esta suite abre la web del chofer de verdad y
// comprueba:
//   - en la puerta, el chofer tiene el deslizador del SOS;
//   - deslizarlo llega al servidor (queda el SOS en la base) y la pantalla
//     dice ALERTA ENVIADA, sin haber salido a ruta;
//   - el teléfono de la central queda recordado aparte de la sesión, y la
//     pantalla de ingreso ofrece llamarlo después de salir.
// La app nativa (app/App.js) se revisa leyendo el código: no hay Android acá.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/sos-puerta.db';
const P = 3243;
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

async function deslizarSos(pg) {
  await pg.$eval('[data-noswipe="sos"]', e => e.scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(200);
  const caja = await pg.$eval('[data-noswipe="sos"]', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const y = caja.y + caja.h / 2;
  await pg.mouse.move(caja.x + 30, y);
  await pg.mouse.down();
  for (let x = caja.x + 30; x <= caja.x + caja.w - 5; x += 20) { await pg.mouse.move(x, y); await pg.waitForTimeout(15); }
  await pg.mouse.move(caja.x + caja.w - 2, y);
  await pg.mouse.up();
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(`http://localhost:${P}`, DB) };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  const a = await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const nombre = base.prepare('SELECT name FROM companies WHERE companyId = ?').get(emp).name;
  await pedir('/admin/company', { method: 'POST', headers: HG, body: JSON.stringify({ name: nombre, telefonoCentral: '951234567' }) });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 } });
  await interceptarHttps(ctx);
  const ch = await ctx.newPage();
  ch.on('pageerror', e => errores.push(e.message));
  await ch.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  ok('sin central conocida, el ingreso no ofrece llamar', !(await ch.$('[data-central-sin-sesion]')));
  await ch.fill('input[type="text"]', 'pedro');
  await ch.fill('input[type="password"]', 'clave12345');
  await ch.click('button:has-text("INGRESAR")');
  await ch.waitForSelector('button:has-text("SALIR A RUTA")', { timeout: 15000 });
  await ch.waitForTimeout(2500);

  console.log('\nEN LA PUERTA, SIN HABER SALIDO A RUTA');
  ok('el chofer tiene el SOS', !!(await ch.$('[data-sos-puerta] [data-noswipe="sos"]')));
  await deslizarSos(ch);
  await ch.waitForTimeout(1500);
  const sos = base.prepare("SELECT unitId, kind FROM messages WHERE kind = 'sos' ORDER BY id DESC").get();
  ok('el SOS llega al servidor', !!sos && sos.unitId === 'pedro', sos);
  ok('y la pantalla dice ALERTA ENVIADA', /ALERTA ENVIADA/.test(await ch.evaluate(() => document.body.innerText)));
  ok('sigue en la puerta (no salió a ruta)', !!(await ch.$('button:has-text("SALIR A RUTA")')));

  console.log('\nSIN SESIÓN, LA CENTRAL SIGUE A MANO');
  ok('la central quedó recordada aparte de la sesión',
    (await ch.evaluate(() => localStorage.getItem('r14_central'))) === '951234567');
  // Se pierde la sesión (lo que hace un 401) y se recarga
  await ch.evaluate(() => { localStorage.removeItem('r14_session'); localStorage.removeItem('r14_presencia'); });
  await ch.reload({ waitUntil: 'domcontentloaded' });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  const enlace = await ch.$eval('[data-central-sin-sesion]', e => e.getAttribute('href')).catch(() => null);
  ok('el ingreso ofrece llamar a la central', enlace === 'tel:951234567', enlace);

  console.log('\nLA APP NATIVA (leída)');
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  const puerta = app.slice(app.indexOf("if (presencia === 'fuera') {"), app.indexOf("if (presencia === 'ausente') {"));
  ok('en la puerta el SOS no depende del rol', /<SosDeslizable onDisparar=\{onSos\} \/>/.test(puerta) &&
    !/rol === 'collector' \? \([\s\S]*SosDeslizable[\s\S]*\) : \(/.test(puerta));
  ok('la central se guarda aparte de la sesión', /gps\.LLAVE_CENTRAL/.test(app));
  ok('y el ingreso la ofrece', /<Entrar [^>]*central=\{centralGuardada\}/.test(app) && /tel:\$\{central\}/.test(app));
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const limpiar = servicio.slice(servicio.indexOf('export function limpiarSesion'), servicio.indexOf('export function limpiarSesion') + 800);
  ok('limpiar la sesión no borra la central', limpiar.length > 100 && !/LLAVE_CENTRAL/.test(limpiar));

  ok('sin errores de la página', errores.length === 0, errores);
  await browser.close();
  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
