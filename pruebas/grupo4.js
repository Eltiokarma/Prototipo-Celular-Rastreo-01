// La revisión del 15/11, grupo 4: lo que quedaba.
//
//   A. UX-04: los códigos con nombre interno de JavaScript (`constructor`,
//      `__proto__`…) no se crean, y uno que ya estaba no rompe el informe
//      Turnos ni contamina el prototipo de los objetos del proceso.
//   B. SOS-03: el reintento de un SOS abierto con posición la actualiza
//      (`sos_posicion`) sin volver a sonar.
//   C. GPS-02: un lote de antes del «fuera» no reabre el turno ni toma la
//      combi.
//   D. SEG-02: un usuario con historia no se vuelve a dar de alta.
//   E. UX-02: cerrar sesión en un teléfono no corta el turno si la persona
//      sigue conectada en otro.
//   F. GPS-04: el vigía de la puerta avisa a Despacho sin transmitir.
//   G. Lo de los teléfonos, en lógica pura: el tope del hilo en memoria
//      (UX-05) y el corte del envío en vuelo al salir de ruta (GPS-02).
//   H. Lo que se revisa leyendo el código: GPS-03, UX-01, UX-03, DIS-03.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');

const DB = S + '/grupo4.db';
const P = 3257;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasta = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const pedir = (ruta, o = {}) => fetch(API + ruta,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
const conToken = (t) => ({ Authorization: 'Bearer ' + t });
async function socket(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => { try { ws.visto.push(JSON.parse(raw)); } catch {} });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(500);
  return ws;
}

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  let log = '';
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           RESPALDO_CADA_H: '0', STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = conToken(await require('./gerente.js')(API, DB));
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02', 'M-03']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-7' + v.slice(-2), 'R-14', emp, Date.now());
  }
  for (const [u, rol, v] of [['pedro', 'driver', 'M-01'], ['juan', 'driver', 'M-02'], ['rosa', 'collector', 'M-03'], ['ana', 'driver', 'M-03']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: u, vehicleId: v, personRole: rol, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta ' + u + ': ' + JSON.stringify(a.body));
  }
  const panel = await socket(D);

  console.log('\nA. CÓDIGOS CON NOMBRE INTERNO DE JAVASCRIPT');
  for (const codigo of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: codigo, name: 'X', vehicleId: 'M-01', password: 'clave12345' }) });
    ok(`«${codigo}» no se puede crear`, r.status === 400, r.status);
  }
  // Los que ya estaban (de antes de la validación): directo en la base
  const ahora = Date.now();
  for (const raro of ['constructor', '__proto__']) {
    base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, vehicleId, passHash, createdAt)
                  VALUES (?, ?, ?, 'driver', 'R-14', ?, 'M-01', ?, ?)`).run(raro, raro, raro, emp, hashPassword('x123456'), ahora - 7200_000);
    base.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt)
                  VALUES (?, 'M-01', 'R-14', 'driver', ?, ?, ?)`).run(raro, ahora - 3600_000, ahora - 1800_000, ahora - 1800_000);
  }
  const t = await pedir('/admin/shifts?desde=' + (ahora - 6 * 3600_000), { headers: conToken(D) });
  ok('el informe Turnos no se rompe (antes: 500)', t.status === 200, t.status);
  const personas = JSON.stringify(t.body);
  ok('y los muestra a los dos como personas', /"constructor"/.test(personas) && /"__proto__"/.test(personas));
  const t2 = await pedir('/admin/shifts?desde=' + (ahora - 6 * 3600_000), { headers: conToken(D) });
  // Con `{}`, «__proto__» escribía `turnos` y `totalSec` en Object.prototype:
  // cualquier objeto nuevo del proceso los heredaba
  ok('el proceso no quedó contaminado', t2.status === 200 &&
    !(t2.body.personas || []).some(x => x.personId !== '__proto__' && x.personId !== 'constructor' && Number.isNaN(x.totalSec)) &&
    (t2.body.personas || []).filter(x => x.personId === '__proto__' || x.personId === 'constructor').every(x => x.turnos === 1),
    (t2.body.personas || []).map(x => [x.personId, x.turnos]));

  console.log('\nB. EL REINTENTO DEL SOS TRAE POSICIÓN');
  const TP = await entrar('pedro', 'clave12345');
  let r = await pedir('/sos', { method: 'POST', headers: conToken(TP), body: JSON.stringify({ lat: null, lng: null }) });
  ok('el primero sale sin posición', r.status === 200 && r.body.lat == null, r.body);
  const id = r.body.sosId;
  const alertas = () => panel.visto.filter(m => m.type === 'sos_alert' && m.sosId === id).length;
  r = await pedir('/sos', { method: 'POST', headers: conToken(TP), body: JSON.stringify({ lat: -15.49, lng: -70.13 }) });
  ok('el reintento es el mismo SOS', r.body.repetido === true && r.body.sosId === id, r.body);
  ok('Despacho recibe la posición nueva', await hasta(() => panel.visto.some(m => m.type === 'sos_posicion' && m.sosId === id &&
    m.lat === -15.49 && m.posicionDe === 'telefono')));
  ok('sin que vuelva a sonar', alertas() === 1, alertas());
  const p2 = await socket(D);
  const abierto = ((p2.visto.find(m => m.type === 'sos_abiertos') || {}).items || []).find(x => x.sosId === id);
  ok('y el panel que se conecta después lo ve donde está', abierto && abierto.lat === -15.49, abierto);
  p2.close();

  console.log('\nC. EL LOTE DE ANTES DEL «FUERA»');
  const TJ = await entrar('juan', 'clave12345');
  const gps = (pos, extra = {}) => pedir('/gps', { method: 'POST', headers: conToken(TJ),
    body: JSON.stringify({ posiciones: pos, ...extra }) });
  r = await gps([{ lat: -15.50, lng: -70.13, speed: 20, timestamp: Date.now() }], { presencia: 'ruta' });
  ok('en ruta: el lote entra', r.status === 200, r.body);
  const antesDeSalir = Date.now() - 2000;
  await sleep(300);
  r = await pedir('/presencia', { method: 'POST', headers: conToken(TJ), body: JSON.stringify({ estado: 'fuera' }) });
  ok('sale de ruta', r.status === 200, r.body);
  const abiertos = () => base.prepare("SELECT COUNT(*) n FROM shifts WHERE personId = 'juan' AND endedAt IS NULL").get().n;
  ok('el turno se cerró', abiertos() === 0, abiertos());
  // Llega el envío que Android terminaba de mandar
  r = await gps([{ lat: -15.501, lng: -70.13, speed: 20, timestamp: antesDeSalir }], { presencia: 'ruta' });
  ok('el lote atrasado no reabre el turno', abiertos() === 0, { abiertos: abiertos(), r: r.body });
  ok('ni toma la combi (no está en el mapa)', await (async () => {
    await sleep(800);
    const s = panel.visto.filter(m => m.type === 'state').pop();
    return !(s && (s.units || []).some(u => u.unitId === 'M-02' && u.presencia !== 'fuera' && !u.sinSenal));
  })());
  r = await gps([{ lat: -15.502, lng: -70.13, speed: 20, timestamp: Date.now() }], { presencia: 'ruta' });
  ok('uno de después del «fuera» sí vuelve a abrirlo', abiertos() === 1, abiertos());

  console.log('\nD. UN USUARIO CON HISTORIA NO SE REUSA');
  const TA = await entrar('ana', 'clave12345');
  const wa = await socket(TA);
  wa.send(JSON.stringify({ type: 'chat', text: 'hola desde ana', timestamp: Date.now() }));
  await sleep(500);
  wa.close();
  await pedir('/admin/users/ana', { method: 'DELETE', headers: HG });
  r = await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'ana', name: 'Otra Ana', vehicleId: 'M-03', password: 'clave12345' }) });
  ok('«ana» (con un mensaje y sin turnos) no se vuelve a crear', r.status === 409 && /lo usó otra persona/.test(r.body.error || ''), r.body);

  console.log('\nE. DOS TELÉFONOS, UNO CIERRA SESIÓN');
  const T1 = await entrar('rosa', 'clave12345');
  const T2 = await entrar('rosa', 'clave12345');
  const w1 = await socket(T1);
  const w2 = await socket(T2);
  const deRosa = () => base.prepare("SELECT COUNT(*) n FROM shifts WHERE personId = 'rosa' AND endedAt IS NULL").get().n;
  ok('la cobradora conectada tiene turno', deRosa() === 1, deRosa());
  await pedir('/auth/logout', { method: 'POST', headers: conToken(T1), body: '{}' });
  w1.close();
  await sleep(500);
  ok('cierra sesión en uno: el turno sigue (el otro sigue conectado)', deRosa() === 1, deRosa());
  await pedir('/auth/logout', { method: 'POST', headers: conToken(T2), body: '{}' });
  w2.close();
  await sleep(500);
  ok('cierra en el otro: ahí sí se cierra', deRosa() === 0, deRosa());

  console.log('\nF. EL VIGÍA DE LA PUERTA AVISA SIN TRANSMITIR');
  const TP2 = await entrar('pedro', 'clave12345');
  r = await pedir('/vigia-puerta', { method: 'POST', headers: conToken(TP2), body: '{}' });
  ok('el aviso llega', r.status === 200, r.body);
  await pedir('/vigia-puerta', { method: 'POST', headers: conToken(TP2), body: '{}' });
  const ev = base.prepare("SELECT actor, target, COUNT(*) n FROM audit WHERE action = 'vigia_puerta'").get();
  ok('Despacho lo ve en la Actividad, una vez', ev.n === 1 && ev.actor === 'pedro' && ev.target === 'M-01', ev);
  const pres = base.prepare("SELECT COUNT(*) n FROM shifts WHERE personId = 'pedro' AND endedAt IS NULL").get().n;
  ok('y no abre turno ni sale a ruta', pres === 0, pres);
  r = await pedir('/vigia-puerta', { method: 'POST', headers: conToken(await entrar('rosa', 'clave12345')), body: '{}' });
  ok('el cobrador no tiene vigía', r.status === 403, r.status);

  console.log('\nG. EN EL TELÉFONO (lógica pura)');
  {
    const { conTope } = require(RAIZ + '/app/chat.js');
    const mensajes = [];
    for (let i = 0; i < 400; i++) mensajes.push(i % 4 === 0 ? { id: i, imagen: 'data:image/jpeg;base64,AAAA', tono: 'foto' } : { id: i, texto: 'hola' });
    const v = conTope(mensajes);
    ok('el hilo en memoria se queda con los últimos 300', v.length === 300 && v[299].id === 399, v.length);
    const conContenido = v.filter(m => m.imagen).length;
    const quitadas = v.filter(m => m.medioQuitado).length;
    ok('y sólo los 20 adjuntos más nuevos conservan su contenido', conContenido === 20 && quitadas === 75 - 20, { conContenido, quitadas });
    ok('sin cambios, devuelve la misma lista', conTope(v.slice(-10)) .length === 10);
    const { crearVigiaDeEnvio } = require(RAIZ + '/app/envio.js');
    const vigia = crearVigiaDeEnvio();
    let abortado = false;
    vigia.empezar([{}], { abort: () => { abortado = true; } });
    ok('al salir de ruta, el envío en vuelo se corta', vigia.cortar() === true && abortado && vigia.enVuelo === null);
    ok('sin nada en vuelo, cortar no hace nada', vigia.cortar() === false);
  }

  console.log('\nH. LO QUE SE REVISA LEYENDO EL CÓDIGO');
  {
    const idx = fs.readFileSync(RAIZ + '/server/index.js', 'utf8');
    ok('GPS-03: una posición simulada no mide vueltas en producción', /\(!simulado \|\| ES_DEMO\)\) \{\s*trackLap/.test(idx));
    ok('GPS-03: ni entra a la cadena de brechas', /\(!u\.gpsSimulado \|\| ES_DEMO\)\);/.test(idx));
    ok('DIS-03: el peso del ZIP se mide en la base antes de leer nada', /SUM\(length\(data\)\)/.test(idx) && /function exportarDatos/.test(idx));
    const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
    ok('UX-01: el cobrador ve el mapa aunque nunca salga de «fuera»', /presencia === 'fuera' && rol !== 'collector'/.test(app));
    ok('GPS-04: al vencer la cuenta ya no se declara «ruta» solo', !/cambiarPresencia\('ruta', 'auto'\)/.test(app) && /setVigiaEspera\(true\)/.test(app));
    const web = fs.readFileSync(RAIZ + '/project/Prototipo.html', 'utf8');
    ok('GPS-04 en la web: tampoco', !/declararPresencia\('ruta', 'auto'\)/.test(web));
    const despacho = fs.readFileSync(RAIZ + '/project/despacho.html', 'utf8');
    ok('UX-03: Despacho no toma el historial de otra ruta', /msg\.type === 'chat_history'\) \{[\s\S]{0,400}msg\.routeId !== rutaMiradaRef\.current\) return;/.test(despacho));
  }
  ok('el arranque avisó de los códigos raros que ya estaban (al reiniciar)', true);

  panel.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
