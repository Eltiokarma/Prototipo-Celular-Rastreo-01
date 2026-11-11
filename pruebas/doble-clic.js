// Los dobles clics que hacían daño en Despacho (auditoría del 11/11).
//
//   - Con dos SOS esperando, un doble clic en ATENDIDO cerraba los dos: el
//     segundo aparecía en el mismo lugar apenas se confirmaba el primero, y
//     al chofer le llegaba «Despacho vio tu SOS» sin que nadie lo hubiera
//     leído. Ahora ATENDIDO se arma un momento después de mostrar cada SOS.
//   - Con Gestión abierta, el cartel del SOS quedaba debajo: ahora también
//     está arriba de Gestión.
//   - «Baja» y su «¿Confirmar?» estaban en el mismo lugar: dos clics daban
//     de baja a la persona. Ahora es un diálogo que la nombra, con el botón
//     en otro lugar y armado un momento después.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/doble-clic.db';
const P = 3244;
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
async function socket(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(400);
  return ws;
}
const hasta = async (fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); }
  return false;
};
// Dos clics en el MISMO punto de la pantalla, separados como los de una mano
async function dobleClic(pg, selector, separacion = 250) {
  const c = await pg.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pg.mouse.click(c.x, c.y);
  await pg.waitForTimeout(separacion);
  await pg.mouse.click(c.x, c.y);
}
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };

(async () => {
  borrarBase();
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const H = { Authorization: 'Bearer ' + D };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-7' + v.slice(-2), 'R-14', emp, Date.now());
  }
  for (const [u, n, v] of [['pedro', 'Pedro Mamani', 'M-01'], ['juan', 'Juan Quispe', 'M-02']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, vehicleId: v, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await interceptarHttps(ctx);
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2500);
  await (await pg.$$('input'))[0].fill('DESPACHO');
  await pg.fill('input[type="password"]', 'despacho99');
  await pg.click('button:has-text("INGRESAR")');
  await pg.waitForTimeout(3000);

  console.log('\nDOS SOS ESPERANDO');
  const pedro = await socket(await entrar('pedro', 'clave12345'));
  const juan = await socket(await entrar('juan', 'clave12345'));
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  await sleep(300);
  juan.send(JSON.stringify({ type: 'sos', lat: -15.48, lng: -70.12, timestamp: Date.now() }));
  ok('el cartel muestra el primero y dice que hay otro', await hasta(async () =>
    /PEDRO MAMANI[\s\S]*Y 1 MÁS ESPERANDO/.test(await pg.evaluate(() => document.body.innerText))));

  console.log('\nGESTIÓN ABIERTA');
  await pg.click('button:has-text("Gestión")');
  await pg.waitForTimeout(1200);
  // Desde el retoque de la UI, Gestión es una vista debajo de la cabecera y
  // del cartel: el cartel tiene que seguir a la vista, no tapado
  const enGestion = await pg.$eval('[data-sos-atendido]', e => {
    const cartel = e.parentElement;
    const r = cartel.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { visible: r.height > 0 && cartel.contains(arriba), texto: cartel.innerText };
  }).catch(() => null);
  ok('con Gestión abierta, el cartel del SOS sigue a la vista', !!enGestion && enGestion.visible && /PEDRO MAMANI/.test(enGestion.texto), enGestion);
  await pg.click('button:has-text("Volver al mapa")');
  await pg.waitForTimeout(800);

  console.log('\nDOBLE CLIC EN ATENDIDO');
  await pg.waitForFunction(() => !document.querySelector('[data-sos-atendido]').disabled, null, { timeout: 5000 });
  await dobleClic(pg, '[data-sos-atendido]');
  await pg.waitForTimeout(2500);
  const abiertos = base.prepare("SELECT unitId FROM messages WHERE kind = 'sos' AND atendidoEn IS NULL").all().map(r => r.unitId);
  ok('se atendió el de Pedro y el de Juan sigue abierto', abiertos.length === 1 && abiertos[0] === 'juan', abiertos);
  ok('y el cartel ahora muestra a Juan', /JUAN QUISPE/.test(await pg.evaluate(() => document.body.innerText)));
  await pg.click('[data-sos-atendido]');  // un clic de verdad, con el botón armado
  ok('un clic deliberado sí lo atiende', await hasta(() =>
    !base.prepare("SELECT 1 FROM messages WHERE kind = 'sos' AND atendidoEn IS NULL").get()));

  console.log('\nDOBLE CLIC EN BAJA');
  await pg.click('button:has-text("Gestión")');
  // Desde el retoque, «Baja» vive en el menú «⋯» de la fila
  await pg.waitForSelector('[data-acciones="pedro"]', { timeout: 8000 });
  const abrirBaja = async () => { await pg.click('[data-acciones="pedro"]'); await pg.waitForSelector('[role="menu"] button:has-text("Baja")'); };
  const cuantos = () => base.prepare("SELECT COUNT(*) n FROM users WHERE unitId IN ('pedro','juan')").get().n;
  const antes = cuantos();
  await abrirBaja();
  await dobleClic(pg, '[role="menu"] button:has-text("Baja")');
  await pg.waitForTimeout(1500);
  const despues = cuantos();
  ok('dos clics sobre «Baja» no dan de baja a nadie', antes === 2 && despues === 2, [antes, despues]);
  // El segundo clic cae en el velo del diálogo, que cancela: lo más seguro.
  if (await pg.$('[data-confirmar-aceptar]')) await pg.click('button:has-text("No cambiar nada")');
  await abrirBaja();
  await pg.click('[role="menu"] button:has-text("Baja")');
  await pg.waitForSelector('[data-confirmar-aceptar]', { timeout: 3000 });
  const dialogo = await pg.evaluate(() => document.body.innerText);
  ok('se abre un diálogo que nombra a quién', /¿Dar de baja a Pedro Mamani \(pedro\)\?/.test(dialogo));
  ok('y dice que no se puede deshacer', /No se puede deshacer/.test(dialogo));
  await pg.click('button:has-text("No cambiar nada")');
  await pg.waitForTimeout(400);
  ok('«No cambiar nada» lo cierra sin tocar nada', cuantos() === 2 && !(await pg.$('[data-confirmar-aceptar]')));
  await abrirBaja();
  await pg.click('[role="menu"] button:has-text("Baja")');
  await pg.click('[data-confirmar-aceptar]');   // espera a que se arme
  ok('aceptando en el diálogo, sí', await hasta(() => cuantos() === 1 && !base.prepare("SELECT 1 FROM users WHERE unitId = 'pedro'").get()));

  ok('sin errores de la página', errores.length === 0, errores);
  pedro.close(); juan.close();
  await browser.close();
  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
