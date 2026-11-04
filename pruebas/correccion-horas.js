// Corregir horas a mano (PENDIENTES 0.6, 04/11).
//
// Las horas salen del turno que abre y cierra el sistema. Cuando eso no es lo
// que pasó —el que se olvidó de salir de ruta, el teléfono que se apagó—,
// Despacho lo corrige, y queda quién, cuándo, el antes, el después y por qué:
//
//   - las reglas: motivo obligatorio, hasta 31 días atrás, no más de 24 h,
//     nada en el futuro, y sin pisarse con otro turno de la misma persona;
//   - corregir, agregar uno que faltó y anular (queda en cero, no se borra);
//   - el historial, la Actividad, la lista de turnos y el informe de horas;
//   - un turno corregido no se vuelve a abrir solo si la persona reconecta;
//   - el Despacho de otra ruta no lo ve;
//   - y la pantalla, en Chromium: corregir, agregar y anular (con la
//     confirmación que nombra a quién).
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/correccion-horas.db';
const P = 3204;
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
const pedir = (ruta, token, o = {}) => fetch(`http://localhost:${P}${ruta}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})), texto: '' }));
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });
const entrar = async (u, c) => (await post('/auth/login', null, { user: u, password: c })).body.token;
const H = 3600_000;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?,?,?,?,?,?)')
    .run('R-20', 'Juliaca – Puno', 5, 90, emp, Date.now());
  for (const v of ['M-01', 'M-02']) base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run(v, null, 'R-14', emp, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-20', 'Despacho 20', 'Despacho 20', 'dispatch', 'R-20', ?, ?, ?)`).run(emp, hashPassword('despacho-ruta'), Date.now());
  for (const [u, n, v, rol] of [['pedro', 'Pedro Mamani', 'M-01', 'driver'], ['ana', 'Ana Ccama', 'M-02', 'driver'], ['luz', 'Luz Quispe', 'M-01', 'collector']]) {
    const a = await post('/admin/users', HG, { unitId: u, name: n, vehicleId: v, password: 'clave12345', personRole: rol });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  // Los turnos de partida
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  const anteayer = hoy0.getTime() - 2 * 24 * H;
  const ahora = Date.now();
  const turno = base.prepare('INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt) VALUES (?,?,?,?,?,?,?)');
  // Pedro se olvidó de salir de ruta anteayer: 06:00 → 23:30
  const s1 = turno.run('pedro', 'M-01', 'R-14', 'driver', anteayer + 6 * H, anteayer + 23.5 * H, anteayer + 23.5 * H).lastInsertRowid;
  // Y hoy, de hace 3 h a hace 1 h
  const s2 = turno.run('pedro', 'M-01', 'R-14', 'driver', ahora - 3 * H, ahora - H, ahora - H).lastInsertRowid;
  // Ana terminó hace 2 min (para ver que un corregido no se reabre)
  const s3 = turno.run('ana', 'M-02', 'R-14', 'driver', ahora - H, ahora - 2 * 60_000, ahora - 2 * 60_000).lastInsertRowid;

  console.log('\nLAS REGLAS');
  let r = await post(`/admin/shifts/${s1}/correccion`, D, { startedAt: anteayer + 6 * H, endedAt: anteayer + 18 * H });
  ok('sin motivo, no', r.status === 400 && /motivo/.test(r.body.error), r.body);
  r = await post(`/admin/shifts/${s1}/correccion`, D, { startedAt: anteayer, endedAt: anteayer + 25 * H, motivo: 'turno largo' });
  ok('más de 24 h, no', r.status === 400 && /24 horas/.test(r.body.error), r.body);
  r = await post(`/admin/shifts/${s2}/correccion`, D, { startedAt: ahora - 3 * H, endedAt: ahora + H, motivo: 'hasta la noche' });
  ok('una salida en el futuro, no', r.status === 400 && /futuro/.test(r.body.error), r.body);
  r = await post(`/admin/shifts/${s1}/correccion`, D, { startedAt: ahora - 40 * 24 * H, endedAt: ahora - 40 * 24 * H + H, motivo: 'muy viejo ya' });
  ok('más de 31 días atrás, no', r.status === 400 && /31 días/.test(r.body.error), r.body);
  r = await post(`/admin/shifts/${s1}/correccion`, D, { startedAt: anteayer + 18 * H, endedAt: anteayer + 6 * H, motivo: 'al revés de propósito' });
  ok('la salida antes de la entrada, no', r.status === 400, r.body);
  const D20 = await entrar('DESP-20', 'despacho-ruta');
  r = await post(`/admin/shifts/${s1}/correccion`, D20, { startedAt: anteayer + 6 * H, endedAt: anteayer + 18 * H, motivo: 'no es mi ruta' });
  ok('el Despacho de otra ruta no lo ve', r.status === 404, r.status);

  console.log('\nCORREGIR');
  r = await post(`/admin/shifts/${s1}/correccion`, D, { startedAt: anteayer + 6 * H, endedAt: anteayer + 18 * H + 10 * 60_000,
    motivo: 'Se olvidó de salir de ruta; dejó la combi a las 18:10' });
  ok('Pedro se olvidó de salir: la salida pasa a las 18:10', r.status === 200, r.body);
  const fila = base.prepare('SELECT startedAt, endedAt, corregido FROM shifts WHERE id = ?').get(s1);
  ok('el turno quedó así y marcado', fila.endedAt === anteayer + 18 * H + 10 * 60_000 && fila.corregido === 1, fila);
  const c = base.prepare('SELECT * FROM correcciones_turno WHERE turnoId = ?').get(s1);
  ok('con el antes, el después, quién y por qué', c && c.antesFin === anteayer + 23.5 * H && c.despuesFin === anteayer + 18 * H + 10 * 60_000 &&
     c.quien === 'DESPACHO' && /olvidó de salir/.test(c.motivo) && c.tipo === 'corregir', c);
  ok('y en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'turno_corregido' AND target = 'pedro' AND detail LIKE '%olvidó%'").get());
  r = await pedir(`/admin/shifts/${s1}/correcciones`, D);
  ok('el historial del turno', r.body.correcciones.length === 1 && r.body.correcciones[0].quienNombre === 'Despacho', r.body);

  console.log('\nAGREGAR UNO QUE FALTÓ');
  r = await post('/admin/shifts', D, { personId: 'pedro', vehicleId: 'M-01', startedAt: anteayer + 17 * H, endedAt: anteayer + 19 * H, motivo: 'se pisa con el otro' });
  ok('si se pisa con otro turno suyo, no (se contaría dos veces)', r.status === 409 && /Se pisa con otro turno suyo/.test(r.body.error), r.body);
  r = await post('/admin/shifts', D, { personId: 'luz', startedAt: hoy0.getTime() - 24 * H + 7 * H, endedAt: hoy0.getTime() - 24 * H + 15 * H,
    motivo: 'El teléfono de Luz no tenía batería; vino a trabajar' });
  ok('a Luz, cobradora, el turno de ayer que no se registró', r.status === 200 && r.body.turno.role === 'collector' && r.body.turno.vehicleId === 'M-01', r.body);
  const agregado = r.body.turno.id;
  r = await post('/admin/shifts', D, { personId: 'DESP-20', startedAt: anteayer + H, endedAt: anteayer + 2 * H, motivo: 'no es chofer' });
  ok('a una cuenta de Despacho, no', r.status === 404, r.body);

  console.log('\nANULAR');
  r = await post(`/admin/shifts/${s3}/correccion`, D, { anular: true, motivo: 'Dejó la app abierta en su casa' });
  ok('el turno de Ana queda en cero, no se borra', r.status === 200 &&
     base.prepare('SELECT startedAt = endedAt AS cero FROM shifts WHERE id = ?').get(s3).cero === 1, r.body);

  console.log('\nLO VEN LOS INFORMES');
  r = await pedir(`/admin/shifts?desde=${anteayer}`, D);
  const t1 = r.body.turnos.find(t => t.id === s1), t3 = r.body.turnos.find(t => t.id === s3), ta = r.body.turnos.find(t => t.id === agregado);
  ok('la lista: 12 h 10 min y quién lo corrigió', t1.duracionSec === 12 * 3600 + 600 && t1.correccion.quien === 'Despacho' && /olvidó/.test(t1.correccion.motivo), t1);
  ok('el anulado dice anulado, con cero', t3.anulado === true && t3.duracionSec === 0, t3);
  ok('y el agregado figura', ta && ta.correccion.tipo === 'agregar', ta);
  const csv = await fetch(`http://localhost:${P}/admin/informe/horas.csv?desde=${anteayer}`, { headers: { Authorization: 'Bearer ' + D } }).then(x => x.text());
  ok('el informe de horas tiene la columna y dice qué se corrigió', /Corrección a mano/.test(csv) && /corregir · DESPACHO · Se olvidó de salir/.test(csv) &&
     /anular · DESPACHO · Dejó la app abierta/.test(csv), csv.split('\r\n').slice(0, 3));

  console.log('\nUN CORREGIDO NO SE REABRE SOLO');
  // Ana vuelve a salir a ruta enseguida (dentro de los 15 min que retoman
  // el turno anterior): el anulado no se reabre, se abre uno nuevo
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise(x => ws.on('open', x));
  ws.send(JSON.stringify({ type: 'identify', token: await entrar('ana', 'clave12345') }));
  await sleep(300);
  ws.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));
  ws.send(JSON.stringify({ type: 'gps', lat: -15.49, lng: -70.133, speed: 20 }));
  await sleep(800);
  const deAna = base.prepare("SELECT id, startedAt, endedAt FROM shifts WHERE personId = 'ana' ORDER BY id").all();
  ok('el anulado sigue anulado y hay un turno nuevo, abierto', deAna.length === 2 && deAna[0].endedAt === deAna[0].startedAt && deAna[1].endedAt === null, deAna);
  ws.close();

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await interceptarHttps(ctx);
  const de = await ctx.newPage();
  de.on('pageerror', e => errores.push(e.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(2500);
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1200);
  await de.click('button:has-text("Turnos")');
  await de.waitForTimeout(800);
  await de.click('button:has-text("Esta semana")');
  await de.waitForSelector(`[data-corregido="${s1}"]`, { timeout: 8000 }).catch(() => {});
  const marca = await de.$eval(`[data-corregido="${s1}"]`, e => ({ texto: e.innerText, titulo: e.getAttribute('title') })).catch(() => null);
  ok('la fila corregida lo dice, con quién y por qué', !!marca && /CORREGIDO A MANO/.test(marca.texto) && /Despacho: Se olvidó de salir/.test(marca.titulo), marca);

  // Corregir el de hoy: la salida media hora antes
  await de.click(`[data-corregir-turno="${s2}"]`);
  await de.waitForSelector(`[data-editor-turno="${s2}"]`);
  const p2 = (n) => String(n).padStart(2, '0');
  const local = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const nuevaSalida = ahora - 90 * 60_000;
  await de.fill(`[data-editor-turno="${s2}"] [data-turno-fin]`, local(nuevaSalida));
  await de.click(`[data-editor-turno="${s2}"] [data-turno-guardar]`);
  await de.waitForTimeout(800);
  const txtError = await de.evaluate(() => document.body.innerText);
  ok('sin motivo, la pantalla dice por qué no', /Escribí el motivo/.test(txtError));
  await de.fill(`[data-editor-turno="${s2}"] [data-turno-motivo]`, 'Dejó la combi en el paradero antes de lo que marcó');
  await de.click(`[data-editor-turno="${s2}"] [data-turno-guardar]`);
  await de.waitForSelector(`[data-corregido="${s2}"]`, { timeout: 8000 }).catch(() => {});
  const en2 = base.prepare('SELECT endedAt FROM shifts WHERE id = ?').get(s2).endedAt;
  ok('con motivo, se corrige desde la pantalla', Math.abs(en2 - nuevaSalida) < 60_000 && !!(await de.$(`[data-corregido="${s2}"]`)), en2 - nuevaSalida);

  // Anular el de hoy: la confirmación nombra a quién
  await de.click(`[data-corregir-turno="${s2}"]`);
  await de.waitForSelector(`[data-editor-turno="${s2}"] [data-historial-turno]`, { timeout: 5000 }).catch(() => {});
  ok('el editor muestra la corrección anterior', /Dejó la combi en el paradero/.test(await de.$eval(`[data-editor-turno="${s2}"]`, e => e.innerText).catch(() => '')));
  await de.fill(`[data-editor-turno="${s2}"] [data-turno-motivo]`, 'Prueba: ese turno no fue');
  await de.click(`[data-editor-turno="${s2}"] [data-turno-anular]`);
  const conf = await de.$eval(`[data-editor-turno="${s2}"] [role="alert"]`, e => e.innerText).catch(() => '');
  ok('anular pide confirmar, nombrando a quién y qué turno', /¿Anular el turno de Pedro Mamani en M-01/.test(conf) && /quedan en cero/.test(conf), conf);
  await de.click(`[data-editor-turno="${s2}"] [data-turno-anular-si]`);
  await de.waitForTimeout(1200);
  ok('anulado', base.prepare('SELECT startedAt = endedAt AS cero FROM shifts WHERE id = ?').get(s2).cero === 1);

  // Agregar uno que faltó
  await de.click('[data-agregar-turno]');
  await de.waitForSelector('[data-editor-turno="nuevo"]');
  await de.selectOption('[data-editor-turno="nuevo"] [data-turno-persona]', 'luz');
  const ini = hoy0.getTime() - 24 * H + 16 * H, fin = hoy0.getTime() - 24 * H + 18 * H;
  await de.fill('[data-editor-turno="nuevo"] [data-turno-inicio]', local(ini));
  await de.fill('[data-editor-turno="nuevo"] [data-turno-fin]', local(fin));
  await de.fill('[data-editor-turno="nuevo"] [data-turno-motivo]', 'Hizo la tarde con el teléfono apagado');
  await de.click('[data-editor-turno="nuevo"] [data-turno-guardar]');
  await de.waitForTimeout(1200);
  const nuevo = base.prepare("SELECT s.vehicleId, s.startedAt, s.endedAt FROM shifts s JOIN correcciones_turno c ON c.turnoId = s.id WHERE s.personId = 'luz' AND c.motivo LIKE 'Hizo la tarde%'").get();
  ok('se agrega desde la pantalla, en la combi de hoy de Luz', !!nuevo && nuevo.vehicleId === 'M-01' && nuevo.startedAt === ini && nuevo.endedAt === fin, nuevo);
  await de.click('button:has-text("Actividad")').catch(() => {});
  await de.waitForTimeout(1200);
  ok('la Actividad dice quién corrigió, agregó y anuló', /corrigió el turno de/.test(await de.evaluate(() => document.body.innerText)) &&
     /anuló un turno de/.test(await de.evaluate(() => document.body.innerText)));
  ok('la página no tiró errores', errores.length === 0, errores);

  await browser.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
