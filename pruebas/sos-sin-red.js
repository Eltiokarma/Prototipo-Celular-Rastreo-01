// El SOS sin internet: llamar o mandar un SMS a la central (PENDIENTES 0.5,
// 03/11).
//
// Antes, si el SOS no salía, la web decía «NO SALIÓ… o llamá» cuatro segundos
// y se iba, sin decir a quién; la nativa, «NO SALIÓ — REPETÍ». Una llamada o
// un SMS salen con señal de voz aunque no haya datos, que es justo lo que pasa
// donde el SOS no sale. Acá:
//
//   - la gerencia carga el teléfono de la central (y Despacho no puede); se
//     normaliza, se valida, queda en la Actividad;
//   - viaja con el login (queda guardado, sirve sin internet) y con /marca
//     (si cambia, la app se entera sin volver a entrar);
//   - en Chromium, con el servidor apagado: el SOS no sale y queda un panel
//     con LLAMAR (tel:), SMS (con la combi, el nombre y la posición) y los
//     números de emergencia, hasta que se lo cierra;
//   - y si la cooperativa no lo cargó, lo dice y quedan los de emergencia.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/sos-sin-red.db';
const P = 3199;
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
  servidor.salida = new Promise(r => servidor.on('exit', r));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const parar = async () => { servidor.kill(); await servidor.salida; await sleep(300); };
const pedir = (ruta, o = {}) => fetch(`http://localhost:${P}${ruta}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, c) => pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) });

// Desliza el SOS de la web con el mouse, de punta a punta
async function deslizarSos(pg) {
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
  const D = (await login('DESPACHO', 'despacho99')).body.token;
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(`http://localhost:${P}`, DB) };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  const a = await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const nombre = base.prepare('SELECT name FROM companies WHERE companyId = ?').get(emp).name;

  console.log('\nLA GERENCIA CARGA EL TELÉFONO DE LA CENTRAL');
  let r = await pedir('/admin/company', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
    body: JSON.stringify({ name: nombre, telefonoCentral: '951 000 000' }) });
  ok('Despacho no puede (es de la gerencia)', r.status === 403, r.status);
  r = await pedir('/admin/company', { method: 'POST', headers: HG, body: JSON.stringify({ name: nombre, telefonoCentral: 'llamar a Juan' }) });
  ok('lo que no es un número se rechaza y se dice', r.status === 400 && /tiene que ser un número/.test(r.body.error), r.body);
  r = await pedir('/admin/company', { method: 'POST', headers: HG, body: JSON.stringify({ name: nombre, telefonoCentral: '+51 (951) 234-567' }) });
  ok('con espacios, guiones y paréntesis: se guarda limpio', r.status === 200 && r.body.empresa.telefonoCentral === '+51951234567', r.body);
  r = await pedir('/admin/company', { method: 'POST', headers: HG, body: JSON.stringify({ name: nombre, ruc: '20123456789' }) });
  ok('editar otro dato sin mandarlo no lo borra', r.body.empresa.telefonoCentral === '+51951234567', r.body.empresa);
  ok('y queda en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'editar_empresa' AND detail LIKE '%central: +51951234567%'").get());
  const L = await login('pedro', 'clave12345');
  ok('el chofer lo recibe con el login (queda guardado en el teléfono)', L.body.central === '+51951234567', L.body.central);
  const m = await pedir('/marca', { headers: { Authorization: 'Bearer ' + L.body.token } });
  ok('y con /marca, para estar al día sin volver a entrar', m.body.marca && m.body.marca.central === '+51951234567', m.body.marca && m.body.marca.central);

  console.log('\nEN LA WEB DEL CHOFER, SIN INTERNET');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 },
    permissions: ['geolocation'], geolocation: { latitude: -15.49123, longitude: -70.13345, accuracy: 10 } });
  await interceptarHttps(ctx);
  const ch = await ctx.newPage();
  ch.on('pageerror', e => errores.push(e.message));
  await ch.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ch.waitForSelector('input[type="password"]', { timeout: 30000 });
  await ch.fill('input[type="text"]', 'pedro');
  await ch.fill('input[type="password"]', 'clave12345');
  await ch.click('button:has-text("INGRESAR")');
  await ch.click('button:has-text("SALIR A RUTA")', { timeout: 15000 });
  await ch.waitForTimeout(3500);           // conectado y con posición
  await parar();                           // sin internet: ni socket ni HTTP
  await ch.waitForTimeout(1000);
  await deslizarSos(ch);
  ok('el SOS no sale, y queda el panel para pedir ayuda por teléfono',
     await ch.waitForSelector('[data-sos-sin-red]', { timeout: 15000 }).then(() => true).catch(() => false));
  const tel = await ch.$eval('[data-llamar-central]', e => e.getAttribute('href')).catch(() => null);
  ok('LLAMAR A LA CENTRAL marca su número', tel === 'tel:+51951234567', tel);
  const sms = await ch.$eval('[data-sms-central]', e => ({ href: e.getAttribute('href'), texto: e.innerText })).catch(() => null);
  const cuerpo = sms ? decodeURIComponent(sms.href.split('?body=')[1] || '') : '';
  ok('el SMS va a la central', !!sms && sms.href.startsWith('sms:+51951234567?body='), sms && sms.href.slice(0, 40));
  ok('con la combi, el nombre y la posición (y un enlace al mapa)',
     /^SOS M-01 \(Pedro Mamani\): necesito ayuda\./.test(cuerpo) && /-15\.49123,-70\.13345/.test(cuerpo) &&
     /https:\/\/maps\.google\.com\/\?q=-15\.49123,-70\.13345/.test(cuerpo) && /sin internet/.test(cuerpo), cuerpo);
  ok('y el botón dice que va con la posición', /CON TU POSICIÓN/.test(sms ? sms.texto : ''));
  const emerg = await ch.$$eval('[data-sos-sin-red] a[href^="tel:1"]', as => as.map(a => a.getAttribute('href')));
  ok('los números de emergencia: 105, 106 y 116', JSON.stringify(emerg) === '["tel:105","tel:106","tel:116"]', emerg);
  await ch.waitForTimeout(5000);
  ok('no se va solo (antes se borraba a los 4 s)', !!(await ch.$('[data-sos-sin-red]')));
  await ch.click('button:has-text("Cerrar y volver a deslizar el SOS")');
  ok('se cierra cuando el chofer quiere', !(await ch.$('[data-sos-sin-red]')));

  console.log('\nSI LA COOPERATIVA NO LO CARGÓ');
  await arrancar();
  r = await pedir('/admin/company', { method: 'POST', headers: HG, body: JSON.stringify({ name: nombre, telefonoCentral: '' }) });
  ok('la gerencia lo borra', r.status === 200 && r.body.empresa.telefonoCentral === null, r.body.empresa);
  await ch.reload({ waitUntil: 'domcontentloaded' });
  await ch.waitForTimeout(4500);           // retoma la sesión, se conecta y pide /marca
  ok('la web se entera sin volver a entrar (la sesión guardada también)',
     await ch.evaluate(() => JSON.parse(localStorage.getItem('r14_session')).central) === null);
  await parar();
  await ch.waitForTimeout(1000);
  await deslizarSos(ch);
  await ch.waitForSelector('[data-sos-sin-red]', { timeout: 15000 }).catch(() => {});
  const txt = await ch.$eval('[data-sos-sin-red]', e => e.innerText).catch(() => '');
  ok('dice que la cooperativa no lo cargó, y quedan los de emergencia',
     /no cargó el teléfono de la central/.test(txt) && !(await ch.$('[data-llamar-central]')) && /105/.test(txt), txt);
  ok('la página no tiró errores', errores.length === 0, errores);

  await browser.close();
  base.close();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
