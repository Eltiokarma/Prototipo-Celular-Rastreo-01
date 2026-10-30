// Entrar no es salir, y el relevado no recupera solo (opción B, 30/10).
// Y Despacho ve quién entró y no salió a ruta (opción A).
//
// El caso que lo originó: Juan maneja M-01 a la mañana; a las 14:00 lo releva
// Pedro. Juan se va a su casa con la app abierta y, al perder el wifi, la app
// reconecta y re-declara «ruta» sola. Antes eso le devolvía el mando: la
// combi saltaba a la casa de Juan, sus horas corrían, a Pedro se le cerraba
// el turno, y así ida y vuelta en cada reconexión. Y la app nativa se conecta
// apenas el chofer pone la clave: Pedro en la PUERTA ya le sacaba la combi a
// Juan y empezaba a contar horas, sin haber tocado SALIR A RUTA.
//
// Lo que se prueba:
//   - entrar (login o identify) no da mando ni turno ni cambia el nombre de
//     la combi; SALIR A RUTA sí, y ENTRAR AUSENTE también;
//   - el relevo es declarar ruta, aunque el otro siga manejando;
//   - el relevado no recupera la combi por WS ni por HTTP, ni re-declarando
//     ni mandando posiciones, ni cuando el otro termina el turno;
//   - la recupera con un acto suyo: SALIR DE RUTA + SALIR A RUTA, o volver a
//     entrar con la clave; o a las RELEVO_MAX_MS;
//   - un chofer conectado no hereda el mando de otro al cerrarse su socket;
//   - el cliente viejo que manda posiciones sin declarar sigue andando;
//   - el cobrador, como antes;
//   - la lista de la puerta: quién entra, quién sale de ella, que vence sin
//     app, y que sólo la recibe Despacho.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/relevo.db';
const P = 3154;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
let log = '';
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      STATE_INTERVAL_MS: '300', RELEVO_MAX_MS: '15000', PUERTA_SIN_SOCKET_MS: '2000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, o = {}) => fetch(`http://localhost:${P}${ruta}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, clave = 'clave12345') =>
  (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: clave }) })).body.token;

// Un socket que junta lo que le llega
async function conectar(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.roles = []; ws.puertas = []; ws.estados = [];
  ws.on('message', m => {
    const x = JSON.parse(m);
    if (x.type === 'gps_role') ws.roles.push(x);
    if (x.type === 'puerta') ws.puertas.push(x);
    if (x.type === 'state') ws.estados.push(x);
  });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(350);
  return ws;
}
const mandar = (ws, m) => ws.send(JSON.stringify(m));
const ultimoRol = ws => ws.roles[ws.roles.length - 1] || null;

const base = () => new Database(DB, { readonly: true });
const abiertos = () => {
  const d = base();
  const r = d.prepare('SELECT personId FROM shifts WHERE endedAt IS NULL ORDER BY personId').all().map(t => t.personId);
  d.close(); return r;
};
// La unidad como la ve Despacho: el último estado que le llegó a su socket
let desp = null;
const unidad = async (id) => {
  await sleep(450);   // STATE_INTERVAL_MS = 300
  const e = desp.estados[desp.estados.length - 1];
  return e ? (e.units || []).find(u => u.unitId === id) || null : null;
};

// Una posición sobre la calle y otra «en la casa»
const CALLE = { lat: -15.4900, lng: -70.1330 };
const CASA = { lat: -15.5200, lng: -70.1600 };

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const H = { Authorization: 'Bearer ' + D.token };

  const db0 = new Database(DB);
  const emp = db0.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  const altaV = db0.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)');
  for (const v of ['M-01', 'M-02', 'M-03']) altaV.run(v, 'Placa ' + v, 'R-14', emp, Date.now());
  db0.close();
  const personas = [['juan', 'Juan', 'M-01'], ['pedro', 'Pedro', 'M-01'], ['rosa', 'Rosa', 'M-01', 'collector'],
    ['ana', 'Ana', 'M-02'], ['luis', 'Luis', 'M-02'], ['viejo', 'Viejo', 'M-03'], ['web', 'Web', 'M-03']];
  for (const [u, n, v, rol] of personas) {
    const a = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, vehicleId: v, password: 'clave12345', personRole: rol || 'driver' }) });
    if (a.status !== 200) throw new Error(`alta de ${u}: ${JSON.stringify(a.body)}`);
  }
  // Despacho mira la ruta con su socket: es el que tiene que ver la puerta
  desp = await conectar(D.token);

  console.log('\nENTRAR NO ES SALIR');
  const tJuan = await entrar('juan');
  const juan = await conectar(tJuan);
  ok('Juan en la puerta no tiene turno', !abiertos().includes('juan'), abiertos());
  ok('ni el mando (no se le dijo que reporta)', !juan.roles.some(r => r.reporting === true), juan.roles);
  await sleep(1300);
  let puerta = desp.puertas[desp.puertas.length - 1];
  ok('Despacho lo ve en la puerta', !!puerta && puerta.items.some(i => i.personId === 'juan' && i.vehicleId === 'M-01'), puerta);
  ok('con la hora a la que entró', !!puerta && puerta.items.every(i => Number.isFinite(i.desde)));
  ok('el teléfono del chofer no recibe esa lista', juan.puertas.length === 0);

  mandar(juan, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('SALIR A RUTA le abre el turno', abiertos().includes('juan'), abiertos());
  ok('y le da el mando', ultimoRol(juan)?.reporting === true, ultimoRol(juan));
  mandar(juan, { type: 'gps', ...CALLE, speed: 20 });
  await sleep(1300);
  puerta = desp.puertas[desp.puertas.length - 1];
  ok('y deja de figurar en la puerta', !puerta.items.some(i => i.personId === 'juan'), puerta.items);
  ok('la combi lleva su nombre', (await unidad('M-01'))?.driverName === 'Juan');
  // Manejando, entra con su cuenta en otro aparato (la web en una tablet)
  await entrar('juan');
  await sleep(1300);
  puerta = desp.puertas[desp.puertas.length - 1];
  ok('el que ya maneja y entra en otro aparato no figura en la puerta', !puerta.items.some(i => i.personId === 'juan'), puerta.items);

  console.log('\nEL RELEVO');
  const tPedro = await entrar('pedro');
  const pedro = await conectar(tPedro);
  ok('Pedro en la puerta no le saca la combi a Juan', ultimoRol(juan)?.reporting === true && !pedro.roles.some(r => r.reporting));
  ok('ni le cierra el turno, ni abre el suyo', abiertos().includes('juan') && !abiertos().includes('pedro'), abiertos());
  ok('ni le cambia el nombre a la combi', (await unidad('M-01'))?.driverName === 'Juan');
  mandar(pedro, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('Pedro toca SALIR A RUTA: toma la combi', ultimoRol(pedro)?.reporting === true);
  ok('a Juan se le avisa', ultimoRol(juan)?.reporting === false && /Otro chofer/.test(ultimoRol(juan).reason || ''), ultimoRol(juan));
  ok('el turno pasa de Juan a Pedro', abiertos().includes('pedro') && !abiertos().includes('juan'), abiertos());
  mandar(pedro, { type: 'gps', ...CALLE, speed: 22 });
  await sleep(300);
  ok('la combi lleva el nombre de Pedro', (await unidad('M-01'))?.driverName === 'Pedro');

  console.log('\nEL RELEVADO NO RECUPERA SOLO');
  juan.close();
  await sleep(200);
  const juan2 = await conectar(tJuan);
  mandar(juan2, { type: 'presencia', estado: 'ruta' });   // lo que la app re-declara al reconectar
  await sleep(300);
  ok('Juan reconecta y re-declara ruta: no toma la combi', ultimoRol(juan2)?.reporting === false, ultimoRol(juan2));
  ok('y se le dice cómo volver a manejarla', /SALIR DE RUTA y después SALIR A RUTA/.test(ultimoRol(juan2)?.reason || ''));
  ok('Pedro sigue con el turno; Juan sin', abiertos().includes('pedro') && !abiertos().includes('juan'), abiertos());
  const rolesAntes = juan2.roles.length;
  for (let i = 0; i < 3; i++) { mandar(juan2, { type: 'gps', ...CASA, speed: 0 }); await sleep(120); }
  await sleep(200);
  let m01 = await unidad('M-01');
  ok('sus posiciones desde la casa se descartan', Math.abs(m01.lat - CALLE.lat) < 0.001, { lat: m01.lat });
  ok('y se le avisa una sola vez, no en cada posición', juan2.roles.length - rolesAntes <= 1, juan2.roles.length - rolesAntes);
  mandar(juan2, { type: 'presencia', estado: 'ausente' });
  await sleep(200);
  ok('declarar ausente tampoco se la devuelve', abiertos().includes('pedro') && !abiertos().includes('juan'));
  const hJuan = { Authorization: 'Bearer ' + tJuan };
  let r = await pedir('/presencia', { method: 'POST', headers: hJuan, body: JSON.stringify({ estado: 'ruta' }) });
  ok('por HTTP, declarar ruta: ignorada', r.body.ignorada === true && r.body.gpsRole === false, r.body);
  r = await pedir('/gps', { method: 'POST', headers: hJuan, body: JSON.stringify({ posiciones: [{ ...CASA, speed: 0, timestamp: Date.now() }] }) });
  ok('por HTTP, mandar posiciones: gpsRole false', r.body.gpsRole === false && r.body.aceptadas === 0, r.body);

  // El caso de las 22:00: Pedro estaciona y termina. La combi queda sin dueño
  // y el relevado sigue con la app en 'ruta' en su casa.
  mandar(pedro, { type: 'presencia', estado: 'fuera' });
  await sleep(300);
  juan2.close();
  await sleep(200);
  const juan3 = await conectar(tJuan);
  mandar(juan3, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  mandar(juan3, { type: 'gps', ...CASA, speed: 0 });
  await sleep(300);
  ok('Pedro terminó el turno: Juan igual no la recupera desde su casa', ultimoRol(juan3)?.reporting === false && !abiertos().includes('juan'), ultimoRol(juan3));
  m01 = await unidad('M-01');
  ok('y la combi no aparece en su casa', !m01 || Math.abs(m01.lat - CASA.lat) > 0.001, m01 && { lat: m01.lat });

  console.log('\nLO RECUPERA CON UN ACTO SUYO');
  mandar(juan3, { type: 'presencia', estado: 'fuera' });   // SALIR DE RUTA
  await sleep(200);
  mandar(juan3, { type: 'presencia', estado: 'ruta' });    // SALIR A RUTA
  await sleep(300);
  ok('SALIR DE RUTA y SALIR A RUTA: la vuelve a tomar', ultimoRol(juan3)?.reporting === true && abiertos().includes('juan'), ultimoRol(juan3));
  // Y volver a entrar con la clave: Pedro ahora es el relevado
  mandar(pedro, { type: 'presencia', estado: 'ruta' });     // Pedro la retoma (relevo)
  await sleep(300);
  pedro.close();
  await sleep(200);
  const tPedro2 = await entrar('pedro');
  const pedro2 = await conectar(tPedro2);
  ok('Pedro relevó a Juan; Juan quedó relevado', ultimoRol(juan3)?.reporting === false);
  mandar(juan3, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('Juan relevado de nuevo: re-declarar no alcanza', ultimoRol(juan3)?.reporting === false && abiertos().includes('pedro'), abiertos());
  const tJuan2 = await entrar('juan');
  const juan4 = await conectar(tJuan2);
  mandar(juan4, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('volver a entrar con la clave sí alcanza', ultimoRol(juan4)?.reporting === true && abiertos().includes('juan'), ultimoRol(juan4));
  juan3.close(); pedro2.close();

  console.log('\nEL QUE ESTÁ CONECTADO NO HEREDA');
  // Ana maneja M-02 por socket; Luis entró y está en la puerta, conectado.
  const ana = await conectar(await entrar('ana'));
  mandar(ana, { type: 'presencia', estado: 'ruta' });
  mandar(ana, { type: 'gps', ...CALLE, speed: 20 });
  const luis = await conectar(await entrar('luis'));
  await sleep(300);
  ana.close();
  await sleep(500);
  ok('se cierra el socket de Ana: Luis, en la puerta, no recibe el mando', !luis.roles.some(r => r.reporting === true), luis.roles);
  ok('ni turno', !abiertos().includes('luis'), abiertos());
  luis.close();

  console.log('\nEL CLIENTE QUE NO DECLARA');
  // Herramientas y apps viejas: identify y posiciones, sin presencia
  const viejo = await conectar(await entrar('viejo'));
  mandar(viejo, { type: 'gps', ...CALLE, speed: 18 });
  await sleep(400);
  ok('mandar posición con la combi libre toma el mando', ultimoRol(viejo)?.reporting === true, viejo.roles);
  ok('y abre el turno', abiertos().includes('viejo'), abiertos());
  ok('y la combi está en el mapa', !!(await unidad('M-03'))?.lat);
  viejo.close();

  console.log('\nEL COBRADOR, COMO ANTES');
  const rosa = await conectar(await entrar('rosa'));
  ok('modo acompañante', ultimoRol(rosa)?.reporting === false && ultimoRol(rosa).reason === 'Modo acompañante', ultimoRol(rosa));
  ok('con su turno al conectarse', abiertos().includes('rosa'), abiertos());
  await sleep(1300);
  ok('y no figura en la puerta (no sale a ruta)', !desp.puertas[desp.puertas.length - 1].items.some(i => i.personId === 'rosa'));
  rosa.close();

  console.log('\nLA PUERTA SIN APP VENCE');
  // La web: pone la clave en la puerta y no se conecta hasta salir
  await entrar('web');
  await sleep(1300);
  puerta = desp.puertas[desp.puertas.length - 1];
  ok('el que entró por la web figura', puerta.items.some(i => i.personId === 'web'), puerta.items.map(i => i.personId));
  await sleep(13000);   // vence a los 2 s sin socket; el barrido corre cada 10
  puerta = desp.puertas[desp.puertas.length - 1];
  ok('sin app y sin señal, deja de figurar', !puerta.items.some(i => i.personId === 'web'), puerta.items.map(i => i.personId));
  const tWeb = await entrar('web');
  await pedir('/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + tWeb } });
  await sleep(1300);
  ok('cerrar sesión lo saca en el acto', !desp.puertas[desp.puertas.length - 1].items.some(i => i.personId === 'web'));

  console.log('\nLA MARCA VENCE');
  // RELEVO_MAX_MS = 15 s en esta corrida: Juan relevó a Pedro arriba hace
  // más que eso. Pedro, con la app en 'ruta' desde «ayer», no tropieza.
  mandar(juan4, { type: 'presencia', estado: 'fuera' });   // Juan termina
  await sleep(300);
  const pedro3 = await conectar(tPedro2);
  mandar(pedro3, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('al otro día, la app que quedó en ruta vuelve a andar', ultimoRol(pedro3)?.reporting === true, ultimoRol(pedro3));
  pedro3.close(); juan4.close(); desp.close();

  console.log('\nEL LOG');
  ok('el relevo queda escrito', /GPS de M-01: lo toma pedro \(declaró ruta por WS\), relevó a juan/.test(log));

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
