// La auditoría separada por tipo (PENDIENTES 0.9, 04/11).
//
// Eran 1000 movimientos por cooperativa, todos en la misma bolsa: los
// inicios de sesión y los desvíos que anota el sistema solo se llevaban
// puestas las altas, las bajas y los cambios de clave en días. Ahora cada
// movimiento tiene clase, y cada clase su plazo y su techo:
//
//   - una ráfaga de inicios de sesión no le borra nada a la gestión;
//   - ni a la otra cooperativa;
//   - los plazos por clase (90 / 365 / 730 días), al arrancar;
//   - lo que ya estaba se clasifica una vez, y lo desconocido es gestión;
//   - /admin/audit filtra por clase y pagina hacia atrás sin repetir;
//   - el informe de actividad dice el tipo;
//   - y en Chromium: los botones de tipo y «Ver más viejos».
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const coop = require(RAIZ + '/server/cooperativas.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/auditoria.db';
const P = 3210;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIA = 86400_000;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar(extra = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', ...extra },
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
const post = (ruta, token, cuerpo) => fetch(`http://localhost:${P}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(cuerpo),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const leer = (ruta, token) => fetch(`http://localhost:${P}${ruta}`, { headers: { Authorization: 'Bearer ' + token } })
  .then(r => r.json());
const entrar = async (u, c) => (await post('/auth/login', null, { user: u, password: c })).body.token;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  // Techos chicos para poder llenarlos: 5 accesos y 4 de gestión por cooperativa
  await arrancar({ AUDIT_ACCESO_MAX: '5', AUDIT_GESTION_MAX: '4' });
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  let base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run('M-01', null, 'R-14', emp, Date.now());
  const otra = coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  if (otra.error) throw new Error(otra.error);
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, vehicleId, companyId, passHash, createdAt)
                VALUES ('otro', 'Otro Chofer', 'Otro Chofer', 'driver', 'R-9', NULL, 'OTRA', ?, ?)`).run(hashPassword('clave12345'), Date.now());

  console.log('\nLOS INICIOS DE SESIÓN NO SE LLEVAN PUESTA LA GESTIÓN');
  const a = await post('/admin/users', HG, { unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  await post('/admin/users/pedro/password', D, { password: 'otraclave123' });
  const clase = (accion) => base.prepare('SELECT clase FROM audit WHERE action = ? ORDER BY id DESC LIMIT 1').get(accion)?.clase;
  ok('el alta y el cambio de clave son de gestión', clase('alta') === 'gestion' && clase('reset_clave') === 'gestion',
     [clase('alta'), clase('reset_clave')]);
  for (let i = 0; i < 12; i++) await entrar('pedro', 'otraclave123');
  ok('un inicio de sesión es un acceso', clase('login') === 'acceso', clase('login'));
  const cuantos = (c, e = emp) => base.prepare('SELECT COUNT(*) n FROM audit WHERE clase = ? AND companyId = ?').get(c, e).n;
  ok('los accesos se cortan en su techo (5 en esta prueba)', cuantos('acceso') === 5, cuantos('acceso'));
  ok('y el alta y el cambio de clave siguen ahí', !!base.prepare("SELECT 1 FROM audit WHERE action = 'alta' AND target = 'pedro'").get() &&
     !!base.prepare("SELECT 1 FROM audit WHERE action = 'reset_clave' AND target = 'pedro'").get());
  for (let i = 0; i < 8; i++) await entrar('otro', 'clave12345');
  ok('los accesos de la otra cooperativa no le tocan los suyos', cuantos('acceso') === 5 && cuantos('acceso', 'OTRA') === 5,
     [cuantos('acceso'), cuantos('acceso', 'OTRA')]);
  for (const n of ['Ana Quispe', 'Rosa Ccama', 'Juan Apaza', 'Luis Condori']) {
    await post('/admin/users', HG, { name: n, unitId: n.split(' ')[0].toLowerCase(), vehicleId: 'M-01', password: 'clave12345' });
  }
  ok('la gestión tiene su propio techo (4 en esta prueba)', cuantos('gestion') === 4, cuantos('gestion'));

  console.log('\nLO QUE DICE /admin/audit');
  let r = await leer('/admin/audit?clase=gestion', D);
  ok('filtrado por gestión: sólo gestión', r.events.length > 0 && r.events.every(e => e.clase === 'gestion'), r.events.map(e => e.action));
  r = await leer('/admin/audit?clase=acceso', D);
  ok('filtrado por accesos: sólo inicios de sesión', r.events.length === 5 && r.events.every(e => e.action === 'login'));
  ok('y dice los plazos de cada clase', r.plazos && r.plazos.acceso === 90 && r.plazos.operacion === 365 && r.plazos.gestion === 730, r.plazos);
  r = await leer('/admin/audit?clase=cualquiera', D);
  ok('una clase que no existe es «todo»', r.events.some(e => e.clase === 'acceso') && r.events.some(e => e.clase === 'gestion'));
  const insertar = base.prepare(`INSERT INTO audit (actor, action, target, detail, routeId, companyId, clase, timestamp)
                                 VALUES ('sistema', ?, 'M-01', ?, 'R-14', ?, ?, ?)`);
  base.transaction(() => { for (let i = 0; i < 130; i++) insertar.run('desvio', `${i}`, emp, 'operacion', Date.now() - i * 1000); })();
  const p1 = await leer('/admin/audit?clase=operacion', D);
  const p2 = await leer(`/admin/audit?clase=operacion&antes=${p1.events[p1.events.length - 1].id}`, D);
  const ids = [...p1.events, ...p2.events].map(e => e.id);
  ok('pagina de a 100, avisa que hay más, y la segunda trae el resto sin repetir',
     p1.events.length === 100 && p1.hayMas === true && p2.events.length === 30 && p2.hayMas === false && new Set(ids).size === 130,
     [p1.events.length, p1.hayMas, p2.events.length, p2.hayMas]);
  r = await leer('/admin/audit?clase=gestion', await entrar('DESPACHO-2', 'clavelarga2'));
  ok('el Despacho de otra cooperativa no ve la gestión de ésta', !r.events.some(e => e.target === 'pedro'));
  const csv = await fetch(`http://localhost:${P}/admin/informe/actividad.csv?desde=${Date.now() - DIA}`, { headers: { Authorization: 'Bearer ' + D } }).then(x => x.text());
  ok('el informe de actividad dice el tipo', /;Tipo\r\n/.test(csv) && /;Gestión\r\n/.test(csv) && /;Acceso\r\n/.test(csv) && /;Operación\r\n/.test(csv),
     csv.split('\r\n').slice(5, 7));

  console.log('\nLOS PLAZOS, Y LO QUE YA ESTABA');
  const viejo = (accion, cl, dias) => base.prepare(`INSERT INTO audit (actor, action, target, detail, routeId, companyId, clase, timestamp)
      VALUES ('DESPACHO', ?, 'x', 'viejo', 'R-14', ?, ?, ?)`).run(accion, emp, cl, Date.now() - dias * DIA).lastInsertRowid;
  const acc100 = viejo('login', 'acceso', 100);
  const op100 = viejo('desvio', 'operacion', 100);
  const op400 = viejo('desvio', 'operacion', 400);
  const ge400 = viejo('baja', 'gestion', 400);
  const ge800 = viejo('baja', 'gestion', 800);
  // Como en una base de antes de 0.9: sin clase
  const sinClase = (accion) => viejo(accion, null, 1);
  const m1 = sinClase('login'), m2 = sinClase('sos'), m3 = sinClase('reset_clave'), m4 = sinClase('una_accion_nueva');
  base.close();
  await parar();
  await arrancar();                        // la barrida y la clasificación corren al arrancar
  base = new Database(DB);
  const hay = (id) => base.prepare('SELECT clase FROM audit WHERE id = ?').get(id);
  ok('un inicio de sesión de hace 100 días se va (plazo 90)', !hay(acc100));
  ok('un desvío de hace 100 días se queda (plazo 365)', !!hay(op100));
  ok('uno de hace 400, no', !hay(op400));
  ok('una baja de hace 400 días se queda (plazo 730)', !!hay(ge400));
  ok('una de hace 800, no', !hay(ge800));
  ok('lo que estaba sin clase se clasifica al arrancar',
     hay(m1)?.clase === 'acceso' && hay(m2)?.clase === 'operacion' && hay(m3)?.clase === 'gestion',
     [hay(m1), hay(m2), hay(m3)]);
  ok('y una acción que nadie clasificó es gestión: se guarda de más, nunca de menos', hay(m4)?.clase === 'gestion', hay(m4));

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
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
  await de.waitForTimeout(1200);
  await de.click('button:has-text("Actividad")');
  await de.waitForTimeout(1500);
  const texto = () => de.evaluate(() => document.body.innerText);
  ok('de entrada se ve todo, inicios de sesión incluidos', /inició sesión/.test(await texto()));
  ok('con «Ver más viejos» porque hay más de 100', !!(await de.$('[data-audit-mas]')));
  await de.click('[data-clase-audit="gestion"]');
  await de.waitForTimeout(1200);
  let t = await texto();
  ok('en Gestión: las altas y las bajas, sin los inicios de sesión ni los desvíos',
     /dio de alta a/.test(t) && /dio de baja a/.test(t) && !/inició sesión/.test(t) && !/se salió del recorrido/.test(t));
  ok('el botón elegido se marca', await de.$eval('[data-clase-audit="gestion"]', b => b.getAttribute('aria-pressed')) === 'true');
  ok('y el pie dice cuánto se guarda cada tipo', /gestión[\s\S]*730 días[\s\S]*operación[\s\S]*365[\s\S]*accesos[\s\S]*90/.test(t));
  await de.click('[data-clase-audit="operacion"]');
  await de.waitForTimeout(1200);
  const filas = () => de.$$eval('*', es => es.filter(e => e.children.length === 0 && /se salió del recorrido/.test(e.textContent)).length);
  const antes = await filas();
  await de.click('[data-audit-mas]');
  await de.waitForTimeout(1200);
  const despues = await filas();
  ok('«Ver más viejos» suma los anteriores', antes >= 100 && despues >= antes + 30 && !(await de.$('[data-audit-mas]')), [antes, despues]);
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
