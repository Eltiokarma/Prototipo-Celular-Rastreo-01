// El consentimiento del chofer (Ley 29733, PENDIENTES 0.10, 04/11).
//
// El trámite es fuera del código; lo que el sistema pone es:
//   - /consentimiento: el formulario para imprimir, con la versión y el
//     contacto, sin marcadores sueltos ni scripts, y diciendo lo de la
//     ubicación con la pantalla apagada;
//   - el registro de quién firmó, de qué fecha y de qué versión: con las
//     reglas (fecha válida y no futura, sólo choferes y cobradores, sólo los
//     de la propia cooperativa), y el retiro con motivo;
//   - todo en la Actividad, como gestión;
//   - y en Chromium: el panel de Personas cuenta los que faltan, anota la
//     firma, marca a quien firmó una versión vieja y anota el retiro.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/consentimiento.db';
const P = 3211;
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
      CONTACTO_PRIVACIDAD: 'soporte@ejemplo.pe' },
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
const post = (ruta, token, cuerpo) => fetch(`http://localhost:${P}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(cuerpo),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const leer = (ruta, token) => fetch(`http://localhost:${P}${ruta}`, { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json());
const entrar = async (u, c) => (await post('/auth/login', null, { user: u, password: c })).body.token;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run('M-01', null, 'R-14', emp, Date.now());
  const otra = coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  if (otra.error) throw new Error(otra.error);
  for (const [u, n] of [['pedro', 'Pedro Mamani'], ['juan', 'Juan Apaza'], ['rosa', 'Rosa Ccama']]) {
    const a = await post('/admin/users', HG, { unitId: u, name: n, vehicleId: 'M-01', password: 'clave12345' });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }

  console.log('\nEL FORMULARIO PARA IMPRIMIR');
  const html = await fetch(`http://localhost:${P}/consentimiento`).then(r => r.text());
  const r0 = await leer('/admin/users', D);
  const vigente = r0.consentimientoVigente;
  ok('se sirve en /consentimiento con la versión vigente', /^\d{4}-\d{2}-\d{2}$/.test(vigente) && html.includes('versión ' + vigente), vigente);
  ok('con el contacto, y sin marcadores sueltos', html.includes('soporte@ejemplo.pe') && !/__[A-Z]+__/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
  ok('sin scripts: es un documento', !/<script/i.test(html));
  ok('en el papel va la dirección entera de la política', html.includes(`http://localhost:${P}/privacidad`));
  ok('dice lo de la pantalla apagada, lo de salir a ruta solo y lo de los servidores afuera',
     /pantalla apagada/.test(html) && /salga a ruta por mí/.test(html) && /fuera del Perú/.test(html));
  ok('cada autorización es una casilla aparte', (html.match(/class="casilla"/g) || []).length >= 3);

  console.log('\nEL REGISTRO DE QUIÉN FIRMÓ');
  ok('al principio nadie firmó', r0.users.filter(u => u.role === 'driver').every(u => u.consentimientoFecha === null));
  const anotar = (u, cuerpo, t = D) => post(`/admin/users/${u}/consentimiento`, t, cuerpo);
  let r = await anotar('pedro', { firmado: true, fecha: '2026-02-30' });
  ok('una fecha que no existe, no', r.status === 400, r.body);
  const manana = new Date(Date.now() + 3 * 86400_000);
  r = await anotar('pedro', { firmado: true, fecha: iso(manana) });
  ok('una fecha futura, no', r.status === 400, r.body);
  r = await anotar('pedro', { firmado: true, fecha: '2026-11-02' });
  ok('con la fecha del papel, sí', r.status === 200 && r.body.consentimientoVersion === vigente, r.body);
  const fila = (u) => base.prepare('SELECT consentimientoFecha f, consentimientoVersion v, consentimientoPor p FROM users WHERE unitId = ?').get(u);
  ok('queda la fecha, la versión y quién lo anotó', JSON.stringify(fila('pedro')) === JSON.stringify({ f: '2026-11-02', v: vigente, p: 'DESPACHO' }), fila('pedro'));
  const ev = base.prepare("SELECT clase, detail FROM audit WHERE action = 'consentimiento_firmado' AND target = 'pedro'").get();
  ok('y en la Actividad, como gestión', !!ev && ev.clase === 'gestion' && /2026-11-02/.test(ev.detail), ev);
  r = await anotar('DESPACHO', { firmado: true, fecha: '2026-11-02' });
  ok('el consentimiento es de choferes y cobradores', r.status === 400, r.body);
  r = await anotar('juan', { firmado: true, fecha: '2026-11-02' }, await entrar('DESPACHO-2', 'clavelarga2'));
  ok('el Despacho de otra cooperativa no puede', r.status === 404, r.status);
  r = await anotar('pedro', { firmado: false });
  ok('el retiro sin motivo, no', r.status === 400, r.body);
  r = await anotar('pedro', { firmado: false, motivo: 'Carta entregada el 03/11' });
  ok('con motivo, se anota y se borra la firma', r.status === 200 && fila('pedro').f === null &&
     !!base.prepare("SELECT 1 FROM audit WHERE action = 'consentimiento_retirado' AND target = 'pedro' AND detail LIKE '%Carta%'").get());

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
  await anotar('pedro', { firmado: true, fecha: '2026-11-03' });
  // Rosa firmó una versión anterior del formulario
  base.prepare("UPDATE users SET consentimientoFecha = '2026-01-10', consentimientoVersion = '2026-01-01' WHERE unitId = 'rosa'").run();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await interceptarHttps(ctx);
  const de = await ctx.newPage();
  de.on('pageerror', x => errores.push(x.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(3000);
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1500);
  const resumen = () => de.$eval('[data-consentimiento-abrir]', b => b.innerText).catch(() => '');
  ok('Personas dice cuántos firmaron y cuántos faltan', /1 de 3 firmaron · faltan 2/.test(await resumen()), await resumen());
  await de.click('[data-consentimiento-abrir]');
  await de.waitForTimeout(300);
  const estado = (u) => de.$eval(`[data-consentimiento-de="${u}"] [data-estado]`, x => x.dataset.estado + ' · ' + x.innerText).catch(() => '');
  ok('el que firmó, con la fecha', /^ok · firmó el 03\/11\/2026/.test(await estado('pedro')), await estado('pedro'));
  ok('la que firmó una versión vieja figura como faltante', /^vieja · .*falta firmar la nueva/.test(await estado('rosa')), await estado('rosa'));
  ok('y hay cómo abrir el formulario para imprimir', !!(await de.$('[data-consentimiento] a[href$="/consentimiento"]')));
  await de.fill('[data-fecha-consentimiento="juan"]', '2026-11-04');
  await de.click('[data-anotar-consentimiento="juan"]');
  await de.waitForTimeout(1500);
  ok('anotar la firma de Juan', /^ok · firmó el 04\/11\/2026/.test(await estado('juan')) && fila('juan').f === '2026-11-04', await estado('juan'));
  ok('y el resumen se actualiza', /2 de 3 firmaron · faltan 1/.test(await resumen()), await resumen());
  await de.click('[data-retiro-consentimiento="juan"]');
  await de.fill('[data-motivo-retiro="juan"]', 'Lo pidió por escrito');
  ok('el botón de retiro nombra a quién', /Anotar que Juan Apaza lo retiró/.test(await de.$eval('[data-confirmar-retiro="juan"]', b => b.innerText)));
  await de.click('[data-confirmar-retiro="juan"]');
  await de.waitForTimeout(1500);
  ok('anotado el retiro, vuelve a faltar', /^falta · falta firmar/.test(await estado('juan')) && fila('juan').f === null, await estado('juan'));

  // El formulario impreso, en un teléfono: que no se salga de la pantalla
  const tel = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const pf = await tel.newPage();
  pf.on('pageerror', x => errores.push(x.message));
  await pf.goto(`http://localhost:${P}/consentimiento`);
  const ancho = await pf.evaluate(() => document.documentElement.scrollWidth);
  ok('el formulario se lee en un teléfono sin correrse de costado', ancho <= 375, ancho);
  ok('ninguna página tiró errores', errores.length === 0, errores);

  await browser.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const x of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(x); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
