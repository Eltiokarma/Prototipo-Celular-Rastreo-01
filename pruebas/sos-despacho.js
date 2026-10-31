// El SOS grita en Despacho (31/10), en Chromium.
//
// Antes entraba como un cartel y una línea de chat, en silencio: con otra
// pestaña adelante nadie se enteraba. «ATENDIDO» era de esa pantalla —el otro
// Despacho lo seguía viendo abierto—, y un SOS que llegaba mientras el panel
// recargaba no volvía a aparecer. Acá:
//
//   - suena (Web Audio) desde el clic en INGRESAR, notifica y el título
//     parpadea;
//   - al retomar una sesión guardada (sin gesto) la alarma está muda y se
//     ofrece activarla, en la cabecera y en el cartel;
//   - el SOS sigue ahí después de recargar;
//   - ATENDIDO en un panel lo cierra en el otro, que dice quién lo atendió;
//     queda en la base, en la Actividad y en el informe;
//   - y por el socket: el Despacho de otra ruta no recibe los abiertos de
//     ésta, un chofer no puede marcar ATENDIDO, y el segundo que lo marca no
//     pisa al primero.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/sos-despacho.db';
const P = 3186;
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
  ws.visto = [];
  ws.on('message', raw => ws.visto.push(JSON.parse(raw)));
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(400);
  return ws;
}
const hasta = async (fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); }
  return false;
};

// Se cuentan los osciladores que crea la página (cada tono es uno) y se
// reemplaza Notification por una que anota: el permiso real no se puede
// conceder en una prueba sin cabeza.
const CONTAR_TONOS = () => {
  window.__tonos = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  const orig = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () { window.__tonos++; return orig.call(this); };
};
const NOTIFICACIONES_CONCEDIDAS = () => {
  window.__notifs = [];
  window.Notification = class {
    constructor(titulo, o = {}) { window.__notifs.push({ titulo, ...o }); }
    close() {}
    static get permission() { return 'granted'; }
    static requestPermission() { return Promise.resolve('granted'); }
  };
};

async function abrirDespacho(browser, errores, nombre, { concedidas = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await interceptarHttps(ctx);
  await ctx.addInitScript(CONTAR_TONOS);
  if (concedidas) await ctx.addInitScript(NOTIFICACIONES_CONCEDIDAS);
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errores.push(nombre + ': ' + e.message));
  await pg.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2500);
  await (await pg.$$('input'))[0].fill('DESPACHO');
  await pg.fill('input[type="password"]', 'despacho99');
  await pg.click('button:has-text("INGRESAR")');
  await pg.waitForTimeout(3000);
  return pg;
}
const tonos = (pg) => pg.evaluate(() => window.__tonos);
const hayCartel = (pg) => pg.$('[data-sos-atendido]').then(Boolean);

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const H = { Authorization: 'Bearer ' + D };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?,?,?,?,?,?)')
    .run('R-20', 'Juliaca – Puno', 5, 90, emp, Date.now());
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  for (const [u, r] of [['DESP-14', 'R-14'], ['DESP-20', 'R-20']]) {
    base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                  VALUES (?, ?, ?, 'dispatch', ?, ?, ?, ?)`).run(u, 'Despacho ' + r, 'Despacho ' + r, r, emp, hashPassword('despacho-ruta'), Date.now());
  }
  const a = await pedir('/admin/users', { method: 'POST', headers: H,
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const tPedro = await entrar('pedro', 'clave12345');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];

  console.log('\nANTES DEL SOS');
  const A = await abrirDespacho(browser, errores, 'despacho A', { concedidas: true });
  ok('A entró con un clic y tiene permiso: la cabecera no pide nada', !(await A.$('[data-activar-alarma]')));
  const B = await abrirDespacho(browser, errores, 'despacho B');
  ok('B no tiene permiso de notificaciones: la cabecera ofrece activar la alarma', !!(await B.$('[data-activar-alarma]')));
  await B.reload({ waitUntil: 'domcontentloaded' });
  await B.waitForTimeout(3500);
  ok('B retomó la sesión sin tocar nada: sigue ofreciéndola', !!(await B.$('[data-activar-alarma]')));
  ok('y nadie suena todavía', (await tonos(A)) === 0 && (await tonos(B)) === 0);

  console.log('\nPEDRO DISPARA EL SOS');
  const pedro = await socket(tPedro);
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  ok('A ve el cartel', await hasta(() => hayCartel(A)));
  ok('y suena', await hasta(async () => (await tonos(A)) >= 4));
  const t1 = await tonos(A);
  await A.waitForTimeout(3000);
  ok('y sigue sonando mientras nadie lo atiende', (await tonos(A)) > t1, [t1, await tonos(A)]);
  const notifs = await A.evaluate(() => window.__notifs);
  ok('notificación del navegador, que queda hasta que se la toca',
     notifs.length === 1 && /SOS · M-01/.test(notifs[0].titulo) && notifs[0].requireInteraction === true &&
     /Pedro Mamani pide ayuda/.test(notifs[0].body), notifs);
  const titulos = new Set();
  for (let i = 0; i < 6; i++) { titulos.add(await A.title()); await A.waitForTimeout(300); }
  ok('el título de la pestaña parpadea con la combi', [...titulos].some(t => /^SOS · M-01/.test(t)) && titulos.size >= 2, [...titulos]);

  console.log('\nB, CON LA ALARMA MUDA');
  ok('B también ve el cartel', await hasta(() => hayCartel(B)));
  ok('no suena (el navegador no lo deja sin un gesto)', (await tonos(B)) === 0);
  const activar = B.locator('button:has-text("Activar sonido")');
  ok('el cartel ofrece «Activar sonido»', await activar.count() === 1);
  await activar.click();
  ok('tocarlo la hace sonar', await hasta(async () => (await tonos(B)) >= 4));

  console.log('\nRECARGAR NO LO PIERDE');
  await B.reload({ waitUntil: 'domcontentloaded' });
  await B.waitForTimeout(3500);
  ok('después de recargar, el SOS sigue en el cartel', await hayCartel(B));
  ok('con quién y desde dónde', /PEDRO MAMANI · M-01 pide ayuda/.test(await B.evaluate(() => document.body.innerText)));

  console.log('\nA LO ATIENDE');
  await A.click('[data-sos-atendido]');
  ok('a A se le va el cartel', await hasta(async () => !(await hayCartel(A))));
  ok('a B también, sin tocar nada', await hasta(async () => !(await hayCartel(B))));
  ok('y en el hilo de B dice quién lo atendió', await hasta(async () =>
    /Atendido por Despacho · \d\d:\d\d/i.test(await B.evaluate(() => document.body.innerText))));
  const t2 = await tonos(A);
  await A.waitForTimeout(3000);
  ok('A dejó de sonar', (await tonos(A)) === t2, [t2, await tonos(A)]);
  ok('y el título volvió', !/SOS/.test(await A.title()), await A.title());
  const fila = base.prepare("SELECT atendidoPor, atendidoEn FROM messages WHERE kind = 'sos' ORDER BY id DESC LIMIT 1").get();
  ok('en la base: quién y cuándo', fila.atendidoPor === 'DESPACHO' && fila.atendidoEn > 0, fila);
  ok('y en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'sos_atendido' AND actor = 'DESPACHO' AND target = 'pedro'").get());
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForTimeout(3500);
  ok('recargado, ya no aparece', !(await hayCartel(A)));
  const csv = await fetch(`http://localhost:${P}/admin/informe/sos.csv`, { headers: H }).then(r => r.text());
  ok('el informe dice quién lo atendió y cuánto tardó',
     /Atendido por/.test(csv) && /Minutos hasta atender/.test(csv) && /DESPACHO/.test(csv));

  console.log('\nPOR EL SOCKET');
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  await sleep(500);
  const segundo = base.prepare("SELECT id FROM messages WHERE kind = 'sos' ORDER BY id DESC LIMIT 1").get().id;
  const d20 = await socket(await entrar('DESP-20', 'despacho-ruta'));
  const ab20 = d20.visto.find(m => m.type === 'sos_abiertos');
  ok('el Despacho de otra ruta no recibe los abiertos de ésta', !!ab20 && ab20.items.length === 0, ab20);
  const d14 = await socket(await entrar('DESP-14', 'despacho-ruta'));
  const ab14 = d14.visto.find(m => m.type === 'sos_abiertos');
  ok('el de esta ruta sí, al conectar', !!ab14 && ab14.items.some(i => i.sosId === segundo && i.vehicleId === 'M-01'), ab14);
  pedro.send(JSON.stringify({ type: 'sos_atender', sosId: segundo }));
  d20.send(JSON.stringify({ type: 'sos_atender', sosId: segundo }));
  await sleep(400);
  ok('ni el chofer ni el Despacho de otra ruta lo pueden cerrar',
     base.prepare('SELECT atendidoEn FROM messages WHERE id = ?').get(segundo).atendidoEn === null);
  d14.send(JSON.stringify({ type: 'sos_atender', sosId: segundo }));
  ok('el de la ruta lo atiende, y se avisa a los paneles', await hasta(() =>
    d14.visto.some(m => m.type === 'sos_atendido' && m.sosId === segundo && m.por === 'Despacho R-14')));
  ok('al de otra ruta no le llega', !d20.visto.some(m => m.type === 'sos_atendido'));
  const sup = await socket(D);
  sup.send(JSON.stringify({ type: 'sos_atender', sosId: segundo }));
  ok('el que llega segundo no lo pisa: se le dice quién fue', await hasta(() =>
    sup.visto.some(m => m.type === 'sos_atendido' && m.sosId === segundo && m.porId === 'DESP-14')));
  ok('y en la base queda el primero', base.prepare('SELECT atendidoPor FROM messages WHERE id = ?').get(segundo).atendidoPor === 'DESP-14');
  ok('ningún SOS llega a los teléfonos como «abierto»', !pedro.visto.some(m => m.type === 'sos_abiertos' || m.type === 'sos_atendido'));

  ok('ninguna página tiró errores', errores.length === 0, errores);

  for (const w of [pedro, d20, d14, sup]) w.close();
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
