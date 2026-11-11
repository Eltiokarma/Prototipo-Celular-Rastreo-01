// Números que perjudicaban a choferes y cooperativas (auditoría del 11/11).
//
//   A. La brecha y el objetivo hablan de la MISMA vuelta: con vueltas medidas
//      de 90 min y `durationMin` de fábrica (50), dos combis a 0,165 del
//      circuito marcaban 8:15 en vez de ~14:51.
//   B. Una combi estacionada en el terminal no suma vueltas: el ruido del GPS
//      hacía rebotar el progreso entre ~0 y ~1 y cada rebote cerraba una.
//      Una vuelta de verdad sigue contando.
//   C. Un usuario con turnos de alguien que se dio de baja no se reusa: el
//      nuevo heredaba sus horas.
//   D. Tras una zona sin señal, el turno arranca donde arrancan las
//      posiciones que llegaron de la cola, no «ahora».
//   E. En producción, sin TZ, el servidor usa la hora de Perú.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/vueltas-horas.db';
const P = 3250;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let semilla = 7;
const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(azar())) * Math.cos(2 * Math.PI * azar());

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };
const pedir = (ruta, o = {}) => fetch(API + ruta, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = async (u, p) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;
const minutos = (txt) => { const m = /^(\d+):(\d\d)$/.exec(String(txt || '')); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };

let servidor = null;
(async () => {
  borrarBase();
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           ARRANQUE_GRACIA_MS: '0', MEMORIA: '0', STATE_INTERVAL_MS: '400', OBJETIVO_RECALCULO_MS: '300' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  // Un tramo de 3 km; la vuelta vuelve por la MISMA calle (el caso del terminal)
  const LAT0 = -15.50, LNG = -70.13, g = 3000 / 111320;
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: {
    ida: [{ lat: LAT0, lng: LNG }, { lat: LAT0 + g, lng: LNG }], vuelta: [{ lat: LAT0 + g, lng: LNG }, { lat: LAT0, lng: LNG }] } }) });
  const base = new Database(DB);
  base.prepare("UPDATE routes SET durationMin = 50, autoTarget = 1 WHERE routeId = 'R-14'").run();
  const variante = base.prepare("SELECT variantId FROM route_variants WHERE routeId = 'R-14' AND activa = 1").get().variantId;
  const alta = async (u, { declarar = true } = {}) => {
    const r = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, personRole: 'driver', password: 'chofer1234' }) });
    if (r.status !== 200) throw new Error('alta ' + u + ': ' + JSON.stringify(r.body));
    const s = await login(u, 'chofer1234');
    const H = { Authorization: 'Bearer ' + s.token };
    if (declarar) await pedir('/presencia', { method: 'POST', headers: H, body: JSON.stringify({ estado: 'ruta' }) });
    return H;
  };
  const enviar = (H, posiciones) => pedir('/gps', { method: 'POST', headers: H, body: JSON.stringify({ posiciones, presencia: 'ruta' }) });
  const aMetros = (mN, mE = 0) => ({ lat: LAT0 + mN / 111320, lng: LNG + mE / 107000 });

  console.log('\nA. LA BRECHA CON LA VUELTA MEDIDA');
  // Tres vueltas medidas de 90 min con el trazado vigente
  const ins = base.prepare(`INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, parcial)
                            VALUES ('M-99', 'R-14', ?, ?, ?, 5400, 20, 0)`);
  for (let i = 1; i <= 3; i++) ins.run(variante, Date.now() - i * 6 * 3600_000 - 5400_000, Date.now() - i * 6 * 3600_000);
  const H3 = await alta('M-03'), H4 = await alta('M-04');
  // El circuito mide 6 km: 0,10 = 600 m y 0,265 = 1590 m por la ida
  for (let k = 0; k < 3; k++) {
    const t = Date.now() - (3 - k) * 3000;
    await enviar(H3, [{ ...aMetros(560 + k * 20), speed: 20, timestamp: t }]);
    await enviar(H4, [{ ...aMetros(1550 + k * 20), speed: 20, timestamp: t }]);
  }
  await sleep(1200);
  const WebSocket = require(RAIZ + '/server/node_modules/ws');
  const ws = new WebSocket(`ws://localhost:${P}`);
  let estado = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(1500);
  ws.close();
  const brecha = minutos(estado && estado.gaps && estado.gaps['M-03'] && estado.gaps['M-03'].toAhead);
  ok('0,165 del circuito con vueltas de 90 min son ~14,9 min (antes 8:15)', brecha !== null && Math.abs(brecha - 14.85) < 0.6,
    estado && estado.gaps && estado.gaps['M-03']);

  console.log('\nB. ESTACIONADA EN EL TERMINAL NO SUMA VUELTAS');
  const H1 = await alta('M-01');
  let t = Date.now() - 3 * 3600_000;
  const lote = [];
  const pos = (mN, mE) => { t += 10_000; lote.push({ ...aMetros(mN, mE), speed: 0, precision: 15, timestamp: t }); };
  for (const m of [2000, 1500, 1000, 600, 300, 100, 20]) pos(m, 0);       // llega por la vuelta
  for (let i = 0; i < 120; i++) pos(gauss() * 10, gauss() * 10);           // 20 min quieta, GPS ±10 m
  for (let i = 0; i < lote.length; i += 50) await enviar(H1, lote.slice(i, i + 50));
  const fantasmas = base.prepare("SELECT COUNT(*) n FROM laps WHERE unitId = 'M-01'").get().n;
  ok('20 min quieta con el GPS rebotando: ninguna vuelta', fantasmas === 0, fantasmas);

  const H2 = await alta('M-02');
  t = Date.now() - 2 * 3600_000;
  const real = [];
  const paso = (mN) => { t += 10_000; real.push({ ...aMetros(mN), speed: 36, precision: 8, timestamp: t }); };
  for (let m = 0; m <= 3000; m += 100) paso(m);          // la ida
  for (let m = 2900; m >= 0; m -= 100) paso(m);           // la vuelta, por la misma calle
  for (let m = 100; m <= 600; m += 100) paso(m);          // y arranca la siguiente
  for (let i = 0; i < real.length; i += 50) await enviar(H2, real.slice(i, i + 50));
  const vueltas = base.prepare("SELECT durationSec, parcial FROM laps WHERE unitId = 'M-02'").all();
  ok('una vuelta de verdad sí cuenta, entera', vueltas.length === 1 && vueltas[0].parcial === 0, vueltas);

  console.log('\nC. UN USUARIO CON TURNOS NO SE REUSA');
  const Hr = await alta('raul');
  await enviar(Hr, [{ ...aMetros(800), speed: 20, timestamp: Date.now() }]);
  await sleep(300);
  ok('raul tiene un turno', !!base.prepare("SELECT 1 FROM shifts WHERE personId = 'raul'").get());
  const baja = await pedir('/admin/users/raul', { method: 'DELETE', headers: HG });
  ok('se da de baja', baja.status === 200, baja.body);
  const nuevo = await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'raul', name: 'Otro Raúl', personRole: 'driver', password: 'chofer1234' }) });
  ok('el usuario no se le da a otra persona, y se dice por qué', nuevo.status === 409 && /lo usó otra persona/.test(nuevo.body.error), nuevo.body);

  console.log('\nD. EL TURNO TRAS UNA ZONA SIN SEÑAL');
  // Sin declarar aparte: la presencia viaja con el lote, como con la pantalla apagada
  const H5 = await alta('M-05', { declarar: false });
  const ahora = Date.now();
  const cola = [];
  for (let k = 0; k < 20; k++) cola.push({ ...aMetros(1000 + k * 50), speed: 30, timestamp: ahora - 22 * 60_000 + k * 60_000 });
  await enviar(H5, cola);
  const turno = base.prepare("SELECT startedAt FROM shifts WHERE personId = 'M-05' ORDER BY id DESC").get();
  ok('el turno arranca con la posición más vieja del lote (hace 22 min), no ahora',
    !!turno && Math.abs(turno.startedAt - (ahora - 22 * 60_000)) < 5000, turno && Math.round((ahora - turno.startedAt) / 60000));
  // El que venía trabajando y se calló 21 min: se retoma el MISMO turno
  const H6 = await alta('M-06', { declarar: false });
  base.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt)
                VALUES ('M-06', 'M-06', 'R-14', 'driver', ?, ?, ?)`).run(ahora - 90 * 60_000, ahora - 25 * 60_000, ahora - 25 * 60_000);
  const previo = base.prepare("SELECT id FROM shifts WHERE personId = 'M-06'").get().id;
  await enviar(H6, [{ ...aMetros(1200), speed: 30, timestamp: ahora - 21 * 60_000 }, { ...aMetros(1500), speed: 30, timestamp: ahora - 60_000 }]);
  const turnos6 = base.prepare("SELECT id, endedAt FROM shifts WHERE personId = 'M-06'").all();
  ok('tras 21 min mudo, con posiciones de la cola, se retoma el turno (las horas no se cortan)',
    turnos6.length === 1 && turnos6[0].id === previo && turnos6[0].endedAt === null, turnos6);

  console.log('\nE. LA HORA DE PERÚ POR DEFECTO');
  const idx = fs.readFileSync(RAIZ + '/server/index.js', 'utf8');
  ok('en producción, sin TZ, se pone America/Lima', /if \(!process\.env\.TZ && [^\n]*!== 'demo'\) \{\s*process\.env\.TZ = 'America\/Lima';/.test(idx));

  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
