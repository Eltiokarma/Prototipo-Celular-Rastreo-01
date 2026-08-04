// Aislamiento entre empresas, de punta a punta.
// Requiere el servidor corriendo en 3001 con DB_FILE = emp.db
const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { execFileSync } = require('child_process');

const DB = process.env.DB_FILE;
const API = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const cli = (...args) => execFileSync('node', [RAIZ + '/server/empresa.js', ...args],
  { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });

(async () => {
  // ─── Punto de partida limpio ───────────────────────────────
  // La suite se tiene que poder correr dos veces seguidas.
  const db = new Database(DB);
  for (const emp of ['EMP-A', 'EMP-B']) {
    db.prepare('DELETE FROM sessions WHERE unitId IN (SELECT unitId FROM users WHERE companyId = ?)').run(emp);
    db.prepare('DELETE FROM users WHERE companyId = ?').run(emp);
    db.prepare('DELETE FROM vehicles WHERE companyId = ?').run(emp);
    db.prepare('DELETE FROM laps WHERE routeId IN (SELECT routeId FROM routes WHERE companyId = ?)').run(emp);
    db.prepare('DELETE FROM shifts WHERE routeId IN (SELECT routeId FROM routes WHERE companyId = ?)').run(emp);
    db.prepare('DELETE FROM messages WHERE routeId IN (SELECT routeId FROM routes WHERE companyId = ?)').run(emp);
    // El recorrido cuelga de la variante, no de la ruta, desde que hay
    // rutas alternas: hay que borrar por variantId y después las variantes.
    db.prepare(`DELETE FROM route_points WHERE variantId IN
      (SELECT variantId FROM route_variants WHERE routeId IN
        (SELECT routeId FROM routes WHERE companyId = ?))`).run(emp);
    db.prepare('DELETE FROM route_variants WHERE routeId IN (SELECT routeId FROM routes WHERE companyId = ?)').run(emp);
    db.prepare('DELETE FROM audit WHERE companyId = ?').run(emp);
    db.prepare('DELETE FROM routes WHERE companyId = ?').run(emp);
    db.prepare('DELETE FROM companies WHERE companyId = ?').run(emp);
  }
  db.close();

  cli('alta', 'EMP-A', 'Cooperativa Alfa', '--ruta', 'RA-1', '--despacho', 'SUP-A', '--clave', 'clavealfa1');
  cli('alta', 'EMP-B', 'Cooperativa Beta', '--ruta', 'RB-1', '--despacho', 'SUP-B', '--clave', 'clavebeta1');
  // Cada una con su gerente: desde la fusión, los choferes-con-combi y los
  // datos de la empresa los carga la gerencia, no el despacho del día.
  cli('gerencia', 'EMP-A', 'GER-A', 'clavegerentea');
  cli('gerencia', 'EMP-B', 'GER-B', 'clavegerenteb');

  const A = (await login('SUP-A', 'clavealfa1')).body;
  const B = (await login('SUP-B', 'clavebeta1')).body;
  const GA = (await login('GER-A', 'clavegerentea')).body;
  const GB = (await login('GER-B', 'clavegerenteb')).body;
  const HGA = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GA.token };
  const HGB = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GB.token };
  const HA = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A.token };
  const HB = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + B.token };
  const get = (h, url) => fetch(API + url, { headers: h }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const post = (h, url, body) => fetch(API + url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  console.log('\nLOGIN');
  ok('el login trae la empresa', A.companyId === 'EMP-A' && A.companyName === 'Cooperativa Alfa', A.companyId);
  ok('y el supervisor es supervisor', A.supervisor === true && B.supervisor === true);

  // Cada gerencia carga su gente (chofer y combi de una)
  await post(HGA, '/admin/users', { unitId: 'CH-A', name: 'Chofer Alfa', password: 'chofer1234' });
  await post(HGB, '/admin/users', { unitId: 'CH-B', name: 'Chofer Beta', password: 'chofer1234' });

  console.log('\nLO QUE CADA UNA VE');
  const rutasA = await get(HA, '/admin/routes');
  ok('A ve solo sus rutas', rutasA.body.routes.length === 1 && rutasA.body.routes[0].routeId === 'RA-1',
    rutasA.body.routes.map(r => r.routeId));
  ok('y sabe de qué empresa es', rutasA.body.empresa?.name === 'Cooperativa Alfa', rutasA.body.empresa);

  const usersA = await get(HA, '/admin/users');
  const idsA = usersA.body.users.map(u => u.unitId);
  ok('A no ve al chofer de B', !idsA.includes('CH-B'), idsA);
  ok('A no ve al despacho de B', !idsA.includes('SUP-B') && !idsA.includes('DESPACHO'), idsA);

  const vehA = await get(HA, '/admin/vehicles');
  ok('A no ve la flota de B', !vehA.body.vehicles.some(v => v.vehicleId === 'CH-B'),
    vehA.body.vehicles.map(v => v.vehicleId));

  const audA = await get(HA, '/admin/audit');
  ok('A no ve los movimientos de B', !audA.body.events.some(e => String(e.target).includes('-B') || e.actor === 'SUP-B'));

  const turA = await get(HA, '/admin/shifts');
  ok('A no ve los turnos de B', !turA.body.turnos.some(t => t.routeId === 'RB-1'));

  console.log('\nLO QUE NO PUEDE TOCAR');
  ok('recorrido ajeno: no existe', (await get(HA, '/admin/routes/RB-1/points')).status === 404);
  ok('objetivo ajeno: no existe', (await post(HA, '/admin/routes/RB-1/target', { targetGapMin: 9 })).status === 404);
  ok('desvío ajeno: no existe', (await post(HA, '/admin/routes/RB-1/desvio', { umbralM: 900 })).status === 404);
  const putAjeno = await fetch(API + '/admin/routes/RB-1/points', {
    method: 'PUT', headers: HA,
    body: JSON.stringify({ tramos: { ida: [{ lat: -15.5, lng: -70.1 }, { lat: -15.4, lng: -70.1 }], vuelta: [] } }),
  });
  ok('dibujar sobre una ruta ajena: no existe', putAjeno.status === 404, putAjeno.status);
  ok('reset de clave ajena: no existe', (await post(HA, '/admin/users/CH-B/password', { password: 'nuevaclave' })).status === 404);
  ok('baja ajena: no existe',
    (await fetch(API + '/admin/users/CH-B', { method: 'DELETE', headers: HA })).status === 404);
  ok('identidad ajena: no existe', (await post(HA, '/admin/users/CH-B/identity', { name: 'Robado' })).status === 404);

  // Que el objetivo de B no se haya movido
  const objB = (await get(HB, '/admin/routes')).body.routes[0];
  ok('el objetivo de B quedó intacto', objB.targetGapMin === 2, objB.targetGapMin);
  ok('y su recorrido sigue vacío', objB.puntos === 0, objB.puntos);

  console.log('\nPEDIR LA RUTA DE OTRO COMO PARÁMETRO');
  const altaCruzada = await post(HGA, '/admin/users', {
    unitId: 'CH-A2', name: 'Chofer dos', password: 'chofer1234', routeId: 'RB-1',
  });
  ok('un alta pidiendo la ruta ajena cae en la propia', altaCruzada.body.routeId === 'RA-1', altaCruzada.body.routeId);
  const vehCruzado = await post(HGA, '/admin/users', {
    unitId: 'CH-A3', name: 'Chofer tres', password: 'chofer1234', vehicleId: 'CH-B',
  });
  ok('y con un vehículo ajeno, ese vehículo no existe', vehCruzado.status === 400, vehCruzado.body.error);

  console.log('\nINFORMES');
  const csvA = await fetch(API + '/admin/informe/actividad.csv', { headers: HA }).then(r => r.text());
  ok('el informe sale a nombre de la cooperativa', csvA.includes('Cooperativa Alfa'), csvA.split('\r\n')[0]);
  ok('y no trae movimientos de B', !csvA.includes('SUP-B') && !csvA.includes('CH-B'));
  ok('pedir el informe de una ruta ajena: no existe',
    (await fetch(API + '/admin/informe/vueltas.csv?routeId=RB-1', { headers: HA })).status === 404);
  ok('métricas de una ruta ajena: no existe', (await get(HA, '/admin/metrics?routeId=RB-1')).status === 404);

  console.log('\nLA EMPRESA');
  const empA = await get(HA, '/admin/company');
  ok('cada una ve su ficha', empA.body.empresa.companyId === 'EMP-A', empA.body.empresa.companyId);
  ok('con su resumen', empA.body.resumen.rutas === 1 && empA.body.resumen.personas >= 1, empA.body.resumen);
  ok('el despacho ya no corrige la ficha: es de la gerencia',
    (await post(HA, '/admin/company', { name: 'Pisada' })).status === 403);
  const editada = await post(HGA, '/admin/company', { name: 'Cooperativa Alfa S.A.', ruc: '20999888777' });
  ok('la gerencia la puede corregir', editada.status === 200 && editada.body.empresa.ruc === '20999888777');
  const empB = await get(HB, '/admin/company');
  ok('y no le tocó la de al lado', empB.body.empresa.name === 'Cooperativa Beta', empB.body.empresa.name);

  console.log('\nTIEMPO REAL');
  const abrir = async (token) => {
    const ws = new WebSocket('ws://localhost:3001');
    const recibido = [];
    await new Promise(r => ws.on('open', r));
    ws.on('message', raw => { try { recibido.push(JSON.parse(raw)); } catch {} });
    ws.send(JSON.stringify({ type: 'identify', token }));
    await sleep(400);
    return { ws, recibido };
  };

  const supA = await abrir(A.token);
  const supB = await abrir(B.token);
  const mirandoA = supA.recibido.filter(m => m.type === 'state').pop();
  ok('el supervisor arranca en una ruta suya', mirandoA?.routeId === 'RA-1', mirandoA?.routeId);
  const listaA = supA.recibido.find(m => m.type === 'routes');
  ok('y el selector solo trae sus rutas',
    listaA?.routes.length === 1 && listaA.routes[0].routeId === 'RA-1',
    listaA?.routes.map(r => r.routeId));

  supA.recibido.length = 0;
  supA.ws.send(JSON.stringify({ type: 'watch', routeId: 'RB-1' }));
  await sleep(500);
  ok('pedir mirar una ruta ajena no hace nada',
    !supA.recibido.some(m => m.type === 'state' && m.routeId === 'RB-1'),
    supA.recibido.filter(m => m.type === 'state').map(m => m.routeId));

  // Un SOS en B no puede sonar en A
  const chB = (await login('CH-B', 'chofer1234')).body;
  const conB = await abrir(chB.token);
  supA.recibido.length = 0;
  supB.recibido.length = 0;
  conB.ws.send(JSON.stringify({ type: 'sos', lat: -15.5, lng: -70.1, timestamp: Date.now() }));
  await sleep(700);
  ok('el SOS de B llega a su propio despacho', supB.recibido.some(m => m.type === 'sos_alert'));
  ok('y no llega al despacho de A', !supA.recibido.some(m => m.type === 'sos_alert'),
    supA.recibido.map(m => m.type));

  [supA.ws, supB.ws, conB.ws].forEach(w => { try { w.close(); } catch {} });
  await sleep(300);

  console.log('\nSUSPENDER UNA COOPERATIVA');
  cli('desactivar', 'EMP-B');
  const intento = await login('SUP-B', 'clavebeta1');
  ok('con la empresa suspendida no se entra', intento.status === 403, intento.body.error);
  const intentoA = await login('SUP-A', 'clavealfa1');
  ok('y la de al lado sigue trabajando', intentoA.status === 200);
  cli('activar', 'EMP-B');
  ok('al habilitarla vuelve a entrar', (await login('SUP-B', 'clavebeta1')).status === 200);

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  process.exit(fallas === 0 ? 0 : 1);
})();
