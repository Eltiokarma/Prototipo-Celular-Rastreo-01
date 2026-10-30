// Varias combis por persona: las habilitaciones (30/10).
//
// En la calle una combi la manejan varios, se prestan combis y se llama a un
// suplente. Con la combi fija en la cuenta, Pedro en M-01 hoy y en M-05
// mañana no tenía camino honesto: una cuenta por combi, o la prestada. Ahora
// Despacho habilita las combis de cada uno y la persona elige en la puerta.
//
// Lo que se prueba:
//   - la combi del alta (y la de los que ya estaban) queda habilitada;
//   - la puerta lista las habilitadas con su estado: libre, tuya, u ocupada
//     y por quién; «cualquiera de su ruta» lista las de la ruta;
//   - elegir sólo entre las habilitadas; una que no, se contesta como si no
//     existiera; elegir no toma nada —el relevo es SALIR A RUTA—;
//   - la ruta va con la combi, y los sockets abiertos pasan a la ruta nueva
//     con su privado;
//   - en ruta no se cambia de combi;
//   - Despacho: la lista entera, la combi de hoy, el alcance de un Despacho
//     de ruta, la de otra cooperativa como inexistente; las listas de
//     personas y vehículos las muestran; la baja las borra;
//   - el cobrador también elige, y su turno va con él.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const { hashPassword } = require(RAIZ + '/server/base.js');
const fs = require('fs');

const DB = S + '/combis.db';
const P = 3158;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const pedir = (ruta, token, opts = {}) => fetch(`http://localhost:${P}${ruta}`, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });
const entrar = async (u, clave = 'clave12345') => (await post('/auth/login', null, { user: u, password: clave })).body.token;

async function conectar(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', m => ws.visto.push(JSON.parse(m)));
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(350);
  return ws;
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

  // Uno que ya estaba antes de las habilitaciones: se carga en la base ANTES
  // de que arranque el servidor, para ver la migración
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const base = new Database(DB);
  const empresa = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  coop.altaRuta(base, { companyId: empresa, routeId: 'R-18B', name: 'Ruta 18B' });
  coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  const altaV = base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)');
  for (const [v, r, e] of [['M-01', 'R-14', empresa], ['M-05', 'R-14', empresa], ['M-07', 'R-14', empresa],
    ['M-21', 'R-18B', empresa], ['M-90', 'R-9', 'OTRA']]) altaV.run(v, 'Placa ' + v, r, e, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-14', 'Despacho 14', 'Despacho 14', 'dispatch', 'R-14', ?, ?, ?)`)
    .run(empresa, hashPassword('despacho14'), Date.now());
  // El viejo: una cuenta con su combi, sin fila de habilitación
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, vehicleId, companyId, passHash, createdAt)
                VALUES ('viejo', 'Viejo', 'Viejo', 'driver', 'R-14', 'M-07', ?, ?, ?)`)
    .run(empresa, hashPassword('clave12345'), Date.now());
  // Reiniciar para que corra la migración
  servidor.kill(); await sleep(600);
  await arrancar();

  for (const [u, n, v, rol] of [['juan', 'Juan', 'M-01'], ['pedro', 'Pedro', 'M-05'], ['rosa', 'Rosa', 'M-01', 'collector']]) {
    const a = await post('/admin/users', HG, { unitId: u, name: n, vehicleId: v, password: 'clave12345', personRole: rol || 'driver' });
    if (a.status !== 200) throw new Error(`alta de ${u}: ${JSON.stringify(a.body)}`);
  }
  const habil = (p) => base.prepare('SELECT vehicleId FROM habilitaciones WHERE personId = ? ORDER BY vehicleId').all(p).map(h => h.vehicleId);

  console.log('\nLA COMBI DE SIEMPRE QUEDA HABILITADA');
  ok('el que ya estaba: su combi, por la migración', habil('viejo').join() === 'M-07', habil('viejo'));
  ok('el del alta: la combi del alta', habil('pedro').join() === 'M-05', habil('pedro'));

  console.log('\nLA PUERTA');
  const tJuan = await entrar('juan'), tPedro = await entrar('pedro');
  let r = await pedir('/mis-combis', tPedro);
  ok('con una sola, la lista trae una', r.status === 200 && r.body.combis.length === 1 && r.body.actual === 'M-05', r.body);
  r = await pedir('/mis-combis', null);
  ok('sin sesión: 401', r.status === 401);
  r = await pedir('/mis-combis', D);
  ok('Despacho no tiene combis que elegir: 403', r.status === 403);

  // Despacho le habilita a Pedro también M-01 (la de Juan)
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-05', 'M-01'] });
  ok('Despacho le habilita a Pedro la M-01', r.status === 200 && habil('pedro').join() === 'M-01,M-05', r.body);

  // Juan sale a ruta en M-01: para Pedro, M-01 queda ocupada por Juan
  const wsJuan = await conectar(tJuan);
  wsJuan.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));
  await sleep(300);
  r = await pedir('/mis-combis', tPedro);
  const m01 = r.body.combis.find(c => c.vehicleId === 'M-01');
  const m05 = r.body.combis.find(c => c.vehicleId === 'M-05');
  ok('la de hoy va primero', r.body.combis[0].vehicleId === 'M-05', r.body.combis.map(c => c.vehicleId));
  ok('M-05 libre', m05.estado === 'libre', m05);
  ok('M-01 ocupada, por Juan, desde cuándo', m01.estado === 'ocupada' && m01.quien === 'Juan' && Number.isFinite(m01.desde), m01);
  ok('con su placa y su ruta', m01.label === 'Placa M-01' && m01.routeId === 'R-14', m01);
  r = await pedir('/mis-combis', tJuan);
  ok('para Juan, M-01 es la suya y está en ruta', r.body.combis[0].estado === 'tuya' && r.body.enRuta === true, r.body);

  console.log('\nELEGIR');
  r = await post('/combi', tPedro, { vehicleId: 'M-07' });
  ok('una que no tiene habilitada: 404, como si no existiera', r.status === 404, r.body);
  r = await post('/combi', tPedro, { vehicleId: 'M-90' });
  ok('una de otra cooperativa: 404', r.status === 404, r.body);
  const wsPedro = await conectar(tPedro);
  r = await post('/combi', tPedro, { vehicleId: 'M-01' });
  ok('elige M-01 (la que maneja Juan)', r.status === 200 && r.body.vehicleId === 'M-01' && r.body.routeId === 'R-14', r.body);
  ok('su combi de hoy es M-01', base.prepare("SELECT vehicleId FROM users WHERE unitId = 'pedro'").get().vehicleId === 'M-01');
  await sleep(300);
  ok('su socket se entera (mensaje combi)', wsPedro.visto.some(m => m.type === 'combi' && m.vehicleId === 'M-01'));
  ok('y recibe el privado de su combi nueva', wsPedro.visto.some(m => m.type === 'chat_history'));
  r = await pedir('/mis-combis', tJuan);
  ok('elegir no le sacó nada a Juan: sigue en ruta en M-01', r.body.enRuta === true && r.body.combis[0].estado === 'tuya', r.body);
  // El relevo es SALIR A RUTA
  wsPedro.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));
  await sleep(300);
  ok('Pedro sale a ruta: releva a Juan en M-01',
     wsJuan.visto.some(m => m.type === 'gps_role' && m.reporting === false) &&
     wsPedro.visto.some(m => m.type === 'gps_role' && m.reporting === true));
  ok('el relevo queda en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'relevo' AND actor = 'pedro' AND target = 'juan'").get());
  ok('y el cambio de combi también', !!base.prepare("SELECT 1 FROM audit WHERE action = 'cambio_combi' AND actor = 'pedro' AND detail = 'M-05 → M-01'").get());

  console.log('\nEN RUTA NO SE CAMBIA DE COMBI');
  r = await post('/combi', tPedro, { vehicleId: 'M-05' });
  ok('Pedro en ruta en M-01 pide M-05: 409 que dice qué hacer', r.status === 409 && /SALIR DE RUTA/.test(r.body.error || ''), r.body);
  wsPedro.send(JSON.stringify({ type: 'presencia', estado: 'fuera' }));
  await sleep(300);
  r = await post('/combi', tPedro, { vehicleId: 'M-05' });
  ok('fuera de ruta, sí', r.status === 200 && r.body.vehicleId === 'M-05', r.body);

  console.log('\nLA RUTA VA CON LA COMBI');
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-05', 'M-01', 'M-21'] });
  ok('el supervisor le habilita una de la 18B', r.status === 200, r.body);
  r = await post('/combi', tPedro, { vehicleId: 'M-21' });
  ok('Pedro elige M-21: queda en la R-18B', r.status === 200 && r.body.routeId === 'R-18B'
     && base.prepare("SELECT routeId FROM users WHERE unitId = 'pedro'").get().routeId === 'R-18B', r.body);
  await sleep(300);
  ok('y su socket recibe el estado y el trazado de la R-18B',
     wsPedro.visto.some(m => m.type === 'state' && m.routeId === 'R-18B') &&
     wsPedro.visto.some(m => m.type === 'route_geometry' && m.routeId === 'R-18B'));
  r = await post('/combi', tPedro, { vehicleId: 'M-05' });
  ok('y vuelve a la R-14', r.body.routeId === 'R-14', r.body);

  console.log('\nDESPACHO');
  const d14 = await entrar('DESP-14', 'despacho14');
  r = await post('/admin/users/pedro/combis', d14, { combis: ['M-05', 'M-21'] });
  ok('un Despacho de la R-14 no habilita combis de la 18B: 403', r.status === 403, r.body);
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-05', 'M-90'] });
  ok('una combi de otra cooperativa: 400 como inexistente', r.status === 400 && /no existe/.test(r.body.error), r.body);
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-01'] });
  ok('la lista tiene que incluir la de hoy', r.status === 400, r.body);
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-01', 'M-07'], actual: 'M-07' });
  ok('o se le cambia la de hoy en el mismo pedido', r.status === 200 && r.body.actual === 'M-07'
     && base.prepare("SELECT vehicleId FROM users WHERE unitId = 'pedro'").get().vehicleId === 'M-07'
     && habil('pedro').join() === 'M-01,M-07', r.body);
  wsJuan.send(JSON.stringify({ type: 'presencia', estado: 'fuera' }));
  wsJuan.send(JSON.stringify({ type: 'presencia', estado: 'ruta' }));   // Juan sale (fue relevado: fuera + ruta)
  await sleep(300);
  r = await post('/admin/users/juan/combis', D, { combis: ['M-01', 'M-05'], actual: 'M-05' });
  ok('a uno en ruta no se le cambia la de hoy: 409', r.status === 409, r.body);

  r = await pedir('/admin/users', D);
  const fila = (r.body.users || []).find(u => u.unitId === 'pedro');
  ok('la lista de personas trae sus combis', !!fila && fila.combis.join() === 'M-01,M-07' && fila.todaLaRuta === false, fila);
  r = await pedir('/admin/vehicles', D);
  const v01 = (r.body.vehicles || []).find(v => v.vehicleId === 'M-01');
  ok('la de vehículos, quiénes la pueden manejar', !!v01 && ['Juan', 'Pedro', 'Rosa'].every(n => v01.habilitados.some(h => h.nombre === n)),
     v01 && v01.habilitados);

  console.log('\nCUALQUIERA DE SU RUTA');
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-07'], todaLaRuta: true });
  ok('el comodín se habilita', r.status === 200 && r.body.todaLaRuta === true, r.body);
  r = await pedir('/mis-combis', tPedro);
  ok('y ve todas las combis de su ruta, ninguna de otra',
     ['M-01', 'M-05', 'M-07'].every(v => r.body.combis.some(c => c.vehicleId === v)) &&
     !r.body.combis.some(c => c.vehicleId === 'M-21' || c.vehicleId === 'M-90'), r.body.combis.map(c => c.vehicleId));
  r = await post('/combi', tPedro, { vehicleId: 'M-05' });
  ok('y puede elegir una sin habilitarla una por una', r.status === 200, r.body);

  console.log('\nEL COBRADOR');
  const tRosa = await entrar('rosa');
  const wsRosa = await conectar(tRosa);
  await post('/admin/users/rosa/combis', D, { combis: ['M-01', 'M-05'] });
  r = await pedir('/mis-combis', tRosa);
  ok('también ve sus combis', r.status === 200 && r.body.combis.length === 2, r.body);
  const turno = () => base.prepare("SELECT vehicleId FROM shifts WHERE personId = 'rosa' AND endedAt IS NULL").get();
  ok('con su turno en M-01 (lo abre al conectarse)', turno()?.vehicleId === 'M-01', turno());
  r = await post('/combi', tRosa, { vehicleId: 'M-05' });
  await sleep(200);
  ok('cambia a M-05 y su turno va con ella', r.status === 200 && turno()?.vehicleId === 'M-05', turno());

  console.log('\nLA BAJA');
  await pedir('/admin/users/rosa', D, { method: 'DELETE' });
  ok('se lleva sus habilitaciones', habil('rosa').length === 0);

  wsJuan.close(); wsPedro.close(); wsRosa.close();
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
