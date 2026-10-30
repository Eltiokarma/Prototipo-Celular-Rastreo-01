// La puerta, abierta de verdad en Chromium (opciones A y C, 30/10).
//
//   A. Despacho ve al chofer que entró y no salió a ruta, con hace cuánto,
//      y deja de verlo cuando sale.
//   C. La web del chofer, en la puerta y con el permiso de ubicación ya
//      dado, mira el GPS sin mandarlo: si ve que ya está manejando avisa con
//      cuenta regresiva y, si nadie contesta, sale a ruta sola. Despacho lo
//      ve en la Actividad. «No estoy manejando» lo calla.
//
// El reloj de la página del chofer se maneja a mano (Playwright clock): la
// cuenta regresiva es de un minuto y la velocidad se mide sobre ventanas de
// 30 s, y esperarlas de verdad haría esta suite de cinco minutos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/puerta-web.db';
const P = 3156;
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

const LAT = -15.4900, LNG = -70.1330, M = 1 / 111320;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const H = { Authorization: 'Bearer ' + D.token };
  const db0 = new Database(DB);
  const emp = db0.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  db0.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-05', 'Z1A-705', 'R-14', emp, Date.now());
  db0.close();
  const alta = await pedir('/admin/users', { method: 'POST', headers: H,
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-05', password: 'clave12345' }) });
  if (alta.status !== 200) throw new Error('alta: ' + JSON.stringify(alta.body));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];

  // Despacho
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await interceptarHttps(dctx);
  const de = await dctx.newPage();
  de.on('pageerror', e => errores.push('despacho: ' + e.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(3000);
  const bloque = () => de.evaluate(() => document.querySelector('[data-puerta]')?.innerText || null);

  // El chofer, con el permiso de ubicación ya dado y el reloj en la mano
  const cctx = await browser.newContext({
    viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: LAT, longitude: LNG, accuracy: 10 },
  });
  await interceptarHttps(cctx);
  const ch = await cctx.newPage();
  ch.on('pageerror', e => errores.push('chofer: ' + e.message));
  await ch.clock.install({ time: new Date() });
  await ch.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  await ch.fill('input[type="text"]', 'pedro');
  await ch.fill('input[type="password"]', 'clave12345');
  await ch.click('button:has-text("INGRESAR")');
  await ch.waitForSelector('button:has-text("SALIR A RUTA")', { timeout: 15000 });

  console.log('\nA. DESPACHO VE AL QUE ENTRÓ Y NO SALIÓ');
  await de.waitForTimeout(2500);
  let b = await bloque();
  ok('aparece el bloque', !!b && /1 chofer entró y no salió a ruta/.test(b), b);
  ok('con el nombre y la combi', !!b && /Pedro Mamani · M-05/.test(b), b);
  ok('y desde cuándo', !!b && /recién|hace \d+ min/.test(b), b);

  console.log('\nC. QUIETO EN LA PUERTA, NADA');
  // Cinco minutos quieto, con el zigzag del GPS
  for (let i = 0; i < 60; i++) {
    await cctx.setGeolocation({ latitude: LAT + 8 * Math.sin(i) * M, longitude: LNG + 6 * Math.cos(i) * M, accuracy: 10 });
    await ch.clock.fastForward(5000);
  }
  await ch.waitForTimeout(300);
  ok('sin aviso', !(await ch.$('[data-vigia-puerta]')));

  console.log('\nC. ARRANCA SIN SALIR A RUTA');
  // A 25 km/h hacia el sur: 35 m cada 5 s
  let metros = 0, aviso = null, paso = 0;
  for (; paso < 60 && !aviso; paso++) {
    metros += 35;
    await cctx.setGeolocation({ latitude: LAT - metros * M, longitude: LNG, accuracy: 10 });
    await ch.clock.fastForward(5000);
    aviso = await ch.$('[data-vigia-puerta]');
  }
  ok('avisa', !!aviso);
  ok('antes de los dos minutos de andar', paso * 5 <= 120, paso * 5);
  const texto = aviso ? await aviso.innerText() : '';
  ok('dice qué pasa y cuánto falta', /¿Ya estás manejando\?/.test(texto) && /Salís a ruta solo en \d+ s/.test(texto), texto);

  // «No estoy manejando»
  await ch.click('button:has-text("No estoy manejando")');
  await ch.waitForTimeout(200);
  ok('«No estoy manejando» lo calla', !(await ch.$('[data-vigia-puerta]')));
  for (let i = 0; i < 24; i++) {   // dos minutos más andando
    metros += 35;
    await cctx.setGeolocation({ latitude: LAT - metros * M, longitude: LNG, accuracy: 10 });
    await ch.clock.fastForward(5000);
  }
  ok('y sigue callado aunque ande', !(await ch.$('[data-vigia-puerta]')) && !!(await ch.$('button:has-text("SALIR A RUTA")')));

  // Pasada la media hora callado, vuelve a mirar
  await ch.clock.fastForward('30:00');
  aviso = null;
  for (paso = 0; paso < 60 && !aviso; paso++) {
    metros += 35;
    await cctx.setGeolocation({ latitude: LAT - metros * M, longitude: LNG, accuracy: 10 });
    await ch.clock.fastForward(5000);
    aviso = await ch.$('[data-vigia-puerta]');
  }
  ok('pasada la media hora vuelve a avisar', !!aviso);

  console.log('\nC. NADIE CONTESTA: SALE SOLO');
  await ch.clock.fastForward(61_000);
  await ch.waitForTimeout(1500);
  const fuera = await ch.$('button:has-text("SALIR A RUTA")');
  ok('al minuto sale a ruta solo', !fuera);
  const t = await ch.evaluate(() => document.body.innerText);
  ok('y se le dice', /SALISTE A RUTA SOLO/.test(t), t.slice(0, 200));
  ok('quedó declarado en ruta', await ch.evaluate(() => localStorage.getItem('r14_presencia')) === 'ruta');

  await sleep(2500);
  const aud = await pedir('/admin/audit', { headers: H });
  const ev = (aud.body.events || aud.body || []).find(e => e.action === 'salio_solo');
  ok('Despacho lo ve en la Actividad', !!ev && ev.actor === 'pedro' && ev.target === 'M-05', ev);
  b = await bloque();
  ok('y deja de figurar como que no salió', !b, b);

  ok('ninguna de las dos páginas tiró errores', errores.length === 0, errores);

  await browser.close();
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
