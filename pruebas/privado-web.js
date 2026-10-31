// Los dos privados en las pantallas (31/10), en Chromium.
//
// Despacho le escribe a Pedro «solo a él» desde la tarjeta de su combi; en la
// web de Pedro aparece en la pestaña PERSONAL y no en la de la COMBI; su
// cobradora, que va arriba de la misma combi, no lo recibe. Pedro contesta
// en personal y a Despacho le aparece en la bandeja de privados sin leer. Y
// el privado de la combi sigue como siempre: lo ven los dos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/privado-web.db';
const P = 3179;
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
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  for (const [u, n, rol] of [['pedro', 'Pedro Mamani', 'driver'], ['rosa', 'Rosa Ticona', 'collector']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, vehicleId: 'M-01', password: 'clave12345', personRole: rol }) });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  // Rosa, la cobradora, por el socket
  const tRosa = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'rosa', password: 'clave12345' }) })).body.token;
  const wsRosa = new WebSocket(`ws://localhost:${P}`);
  const deRosa = [];
  wsRosa.on('message', m => { const x = JSON.parse(m); if (x.type === 'chat_msg') deRosa.push(x.text); });
  await new Promise(r => wsRosa.on('open', r));
  wsRosa.send(JSON.stringify({ type: 'identify', token: tRosa }));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];

  // Pedro, por la web, sale a ruta
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
  await ch.click('button:has-text("SALIR A RUTA")', { timeout: 15000 });
  await ch.waitForTimeout(3000);

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
  await de.waitForTimeout(3500);

  console.log('\nDESPACHO LE ESCRIBE SOLO A PEDRO');
  const boton = de.locator('button:has-text("Solo a Pedro")');
  ok('la tarjeta de M-01 ofrece «Solo a Pedro»', await boton.count() === 1);
  await boton.click();
  await de.waitForTimeout(500);
  const cabecera = await de.evaluate(() => document.body.innerText);
  ok('la columna dice con quién y que es solo esa persona', /Pedro Mamani[\s\S]*Solo esa persona/i.test(cabecera));
  const entrada = de.locator('input[placeholder^="Mensaje solo para"]');
  ok('y el campo dice «solo para Pedro Mamani»', (await entrada.getAttribute('placeholder')) === 'Mensaje solo para Pedro Mamani…');
  await entrada.fill('Pedro, pasá por la oficina a las 18');
  await entrada.press('Enter');
  await de.waitForTimeout(1200);
  // El eco del propio mensaje viene firmado «Despacho»: no puede pisar el nombre
  ok('después de mandar, sigue diciendo con quién (no «Despacho»)',
     (await de.locator('input[placeholder^="Mensaje solo para"]').getAttribute('placeholder')) === 'Mensaje solo para Pedro Mamani…');

  console.log('\nEN LA WEB DE PEDRO');
  await ch.click('button[aria-label="Chat"]');
  await ch.waitForTimeout(600);
  const insignia = await ch.$eval('[data-canal="personal"]', b => b.innerText);
  ok('la pestaña PERSONAL avisa que hay uno', /PERSONAL\s*1/.test(insignia), insignia);
  await ch.click('[data-canal="despacho"]');
  await ch.waitForTimeout(300);
  ok('en la de la COMBI no está', !(await ch.evaluate(() => document.body.innerText)).includes('pasá por la oficina'));
  await ch.click('[data-canal="personal"]');
  await ch.waitForTimeout(300);
  const personal = await ch.evaluate(() => document.body.innerText);
  ok('en PERSONAL sí, como «solo para vos»', /DESPACHO · SOLO PARA VOS[\s\S]*Pedro, pasá por la oficina a las 18/.test(personal));
  ok('su cobradora, en la misma combi, no lo recibió', !deRosa.includes('Pedro, pasá por la oficina a las 18'), deRosa);

  console.log('\nPEDRO CONTESTA EN PERSONAL');
  await de.click('button:has-text("← Grupo")');
  await de.waitForTimeout(300);
  await ch.fill('input[placeholder="Mensaje solo a Despacho…"]', 'Ahí estaré');
  await ch.press('input[placeholder="Mensaje solo a Despacho…"]', 'Enter');
  await de.waitForTimeout(1200);
  const bandeja = await de.$eval('[data-bandeja]', d => d.innerText).catch(() => null);
  ok('a Despacho le aparece en la bandeja de privados sin leer', !!bandeja && /Pedro Mamani · 1/.test(bandeja), bandeja);
  await de.click('[data-bandeja] button');
  await de.waitForTimeout(400);
  ok('y al abrirla está la respuesta', (await de.evaluate(() => document.body.innerText)).includes('Ahí estaré'));
  ok('que su cobradora tampoco vio', !deRosa.includes('Ahí estaré'));

  console.log('\nEL PRIVADO DE LA COMBI, COMO SIEMPRE');
  await de.click('button:has-text("← Grupo")');
  await de.click('button:has-text("Mensaje directo")');
  await de.waitForTimeout(300);
  const aCombi = de.locator('input[placeholder="Mensaje solo para M-01…"]');
  await aCombi.fill('M-01: esperá en el mercado');
  await aCombi.press('Enter');
  await ch.waitForTimeout(1200);
  ok('lo recibe la cobradora', deRosa.includes('M-01: esperá en el mercado'));
  await ch.click('[data-canal="despacho"]');
  await ch.waitForTimeout(300);
  ok('y Pedro lo ve en COMBI, «para tu combi»',
     /DESPACHO · PARA TU COMBI[\s\S]*M-01: esperá en el mercado/.test(await ch.evaluate(() => document.body.innerText)));

  console.log('\nDESDE PERSONAS');
  await de.click('button:has-text("← Grupo")');
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1500);
  const filaRosa = de.locator('div').filter({ hasText: 'rosa' }).filter({ has: de.locator('button:has-text("Escribir")') }).last();
  await filaRosa.locator('button:has-text("Escribir")').click();
  await de.waitForTimeout(800);
  const aRosa = de.locator('input[placeholder="Mensaje solo para Rosa Ticona…"]');
  ok('«Escribir» abre el privado personal de la cobradora en el mapa', await aRosa.count() === 1);
  await aRosa.fill('Rosa, mañana vas en M-05');
  await aRosa.press('Enter');
  await de.waitForTimeout(1000);
  ok('le llega a ella', deRosa.includes('Rosa, mañana vas en M-05'));
  await ch.click('[data-canal="personal"]');
  await ch.waitForTimeout(300);
  ok('y no a Pedro', !(await ch.evaluate(() => document.body.innerText)).includes('Rosa, mañana vas en M-05'));

  ok('ninguna de las dos páginas tiró errores', errores.length === 0, errores);

  wsRosa.close();
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
