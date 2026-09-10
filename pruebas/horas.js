// Las horas (REVISION-2026-09-10.md, tanda 1: L1, L2, L11, L12, P1, E1, E3).
//
// Lo que se defiende: que el turno del chofer que trabaja por HTTP con la
// pantalla apagada se cierre al salir de ruta, al cerrar sesión y cuando
// deja de oírse —y no cuando alguien reinicie el servidor—; que las CUATRO
// lecturas de horas (el perfil, el resumen del gerente, la pestaña Turnos y
// el CSV) den el mismo número; que las horas por unidad no sumen al cobrador;
// que cambiar de combi abra un turno nuevo; y que el turno que cruza el borde
// del período se recorte a los dos lados.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/horas-test.db';
const P = 3167;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});
const H = 3600_000;

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400', ARRANQUE_GRACIA_MS: '0',
           // El olvido en segundos (el barrido corre cada 10 s fijos) y el
           // latido del socket cada segundo, para ver moverse `lastSeenAt`.
           SIN_SENAL_MS: '2000', OLVIDAR_MS: '6000', WS_PING_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  servidor.stdout.on('data', d => { salida += d; });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const pedir = (ruta, opts = {}) => fetch(API + ruta, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = async (u, p) =>
    (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;

  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const ida    = Array.from({ length: 30 }, (_, i) => anillo(i / 58));
  const vuelta = Array.from({ length: 30 }, (_, i) => anillo(0.5 + i / 58));
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }) });
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };
  const ses = {};
  for (const u of ['M-01', 'M-02', 'M-03', 'M-05', 'M-06']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'C-03', name: 'Cobrador Tres', personRole: 'collector', vehicleId: 'M-03', password: 'chofer1234' }) });
  ses['C-03'] = await login('C-03', 'chofer1234');

  const gps = (u, t) => { const q = anillo(t); return pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token },
    body: JSON.stringify({ posiciones: [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now() }] }),
  }); };
  const presencia = (u, estado) => pedir('/presencia', { method: 'POST',
    headers: { Authorization: 'Bearer ' + ses[u].token }, body: JSON.stringify({ estado }) });
  const turnos = async (desde) => (await pedir('/admin/shifts' + (desde ? `?desde=${desde}` : ''), { headers: HD })).body;
  const turnoDe = async (u, desde) => ((await turnos(desde)).turnos || []).filter(t => t.personId === u).sort((a, b) => b.startedAt - a.startedAt)[0];
  const resumen = async (desde, hasta) => (await pedir(`/gerencia/resumen?desde=${desde}&hasta=${hasta}`, { headers: HG })).body;
  const perfil = async (u) => (await pedir('/perfil', { headers: { Authorization: 'Bearer ' + ses[u].token } })).body;
  const csvHoras = (desde, hasta) => fetch(`${API}/admin/informe/horas.csv?desde=${desde}&hasta=${hasta}`, { headers: HD }).then(r => r.text());
  const bd = () => new Database(DB, { readonly: true });

  console.log('\nEL TURNO POR HTTP SE CIERRA AL SALIR DE RUTA');
  {
    const t0 = Date.now();
    await gps('M-01', 0.10);
    await sleep(300);
    let t = await turnoDe('M-01');
    ok('reportar por HTTP abre el turno', !!t && t.abierto === true, t);
    await sleep(1500);
    await gps('M-01', 0.101);
    await presencia('M-01', 'fuera');
    await sleep(300);
    t = await turnoDe('M-01');
    ok('«fuera» por HTTP lo cierra (antes sólo lo cerraba el WebSocket)', !!t && t.abierto === false && typeof t.endedAt === 'number', t && { abierto: t.abierto, endedAt: t.endedAt });
    ok('con la duración real, de un par de segundos', t && t.duracionSec >= 1 && t.duracionSec <= 5, t && t.duracionSec);
    ok('y no crece con el tiempo', (await sleep(1200), (await turnoDe('M-01')).duracionSec === t.duracionSec));
    void t0;
  }

  console.log('\nEL QUE DEJA DE OÍRSE SE CIERRA CON SU ÚLTIMA SEÑAL, NO CON AHORA');
  {
    await gps('M-02', 0.20);
    await sleep(1200);
    await gps('M-02', 0.201);
    const ultima = Date.now();
    // Se calla: el olvido son 6 s; el barrido corre cada 10 s
    await sleep(16_500);
    const t = await turnoDe('M-02');
    ok('el turno quedó cerrado por silencio', !!t && t.abierto === false, t && t.abierto);
    ok('con `endedAt` = la última señal (no el momento del barrido)', t && Math.abs(t.endedAt - ultima) < 2500, t && { endedAt: t.endedAt - ultima });
    ok('y el servidor lo dice en el log', /Turnos cerrados por silencio/.test(salida));
    // Vuelve dentro del plazo de reconexión: es el MISMO turno
    await gps('M-02', 0.202);
    await sleep(300);
    const t2 = await turnoDe('M-02');
    ok('si vuelve enseguida se retoma el mismo turno', t2 && t2.id === t.id && t2.abierto === true, t2 && { id: t2.id, abierto: t2.abierto });
  }

  console.log('\nCERRAR SESIÓN TAMBIÉN CIERRA EL TURNO, Y EL COBRADOR NO SUMA A LA UNIDAD');
  {
    // M-03 sube por WebSocket con su cobrador; el latido mantiene vivo al
    // cobrador aunque no mande GPS
    const abrir = async (u) => {
      const ws = new WebSocket(`ws://localhost:${P}`);
      await new Promise(r => ws.on('open', r));
      ws.on('message', () => {});
      ws.send(JSON.stringify({ type: 'identify', token: ses[u].token }));
      await sleep(400);
      return ws;
    };
    const wsChofer = await abrir('M-03');
    const wsCob = await abrir('C-03');
    await gps('M-03', 0.30);
    await sleep(3500);
    await gps('M-03', 0.301);
    await sleep(300);
    const tc = await turnoDe('C-03');
    ok('el cobrador tiene su turno y el latido le mueve la última señal', !!tc && tc.abierto && tc.lastSeenAt - tc.startedAt >= 1500, tc && { ls: tc.lastSeenAt - tc.startedAt });
    const desde = Date.now() - H, hasta = Date.now() + 60_000;
    const r = await resumen(desde, hasta);
    const u3 = (r.porUnidad || []).find(u => u.unitId === 'M-03');
    const p3 = (r.porPersona || []).find(p => p.personId === 'M-03');
    const pc = (r.porPersona || []).find(p => p.personId === 'C-03');
    ok('las horas de la UNIDAD son las del chofer solo (antes sumaban al cobrador)', !!u3 && !!p3 && u3.horasSec === p3.horasSec, { unidad: u3 && u3.horasSec, chofer: p3 && p3.horasSec, cobrador: pc && pc.horasSec });
    ok('y el cobrador está en «por persona» con las suyas', !!pc && pc.role === 'collector' && pc.horasSec >= 2, pc);
    // El chofer cierra sesión desde el teléfono
    await pedir('/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-03'].token }, body: '{}' });
    await sleep(300);
    const t3 = await turnoDe('M-03');
    ok('cerrar sesión cierra el turno', !!t3 && t3.abierto === false, t3 && t3.abierto);
    try { wsChofer.close(); wsCob.close(); } catch {}
    ses['M-03'] = await login('M-03', 'chofer1234');
  }

  console.log('\nCAMBIAR DE COMBI ABRE UN TURNO NUEVO');
  {
    // M-05 tiene un turno abierto en OTRA combi (la de ayer, que nadie cerró)
    const w = new Database(DB);
    const ahora = Date.now();
    w.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt) VALUES ('M-05', 'M-99', 'R-14', 'driver', ?, ?)`)
      .run(ahora - 40 * 60_000, ahora - 30 * 60_000);
    w.close();
    await gps('M-05', 0.40);
    await sleep(300);
    const filas = bd().prepare("SELECT vehicleId, endedAt, lastSeenAt FROM shifts WHERE personId = 'M-05' ORDER BY id").all();
    ok('el viejo se cierra con su última señal y el nuevo es de la combi de hoy',
       filas.length === 2 && filas[0].vehicleId === 'M-99' && filas[0].endedAt === filas[0].lastSeenAt && filas[1].vehicleId === 'M-05' && filas[1].endedAt === null, filas);
  }

  console.log('\nEL TURNO QUE CRUZA EL BORDE SE RECORTA, Y LAS CUATRO LECTURAS DICEN LO MISMO');
  {
    // M-06 trabajó de hace 14 h a hace 2 h (12 h). El período es de hace 10 h a hace 6 h: 4 h adentro.
    const ahora = Date.now();
    const w = new Database(DB);
    w.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt) VALUES ('M-06', 'M-06', 'R-14', 'driver', ?, ?, ?)`)
      .run(ahora - 14 * H, ahora - 2 * H, ahora - 2 * H);
    w.close();
    const desde = ahora - 10 * H, hasta = ahora - 6 * H;
    const r = await resumen(desde, hasta);
    const p6 = (r.porPersona || []).find(p => p.personId === 'M-06');
    const u6 = (r.porUnidad || []).find(u => u.unitId === 'M-06');
    ok('el gerente cuenta 4 h por persona (antes: 12, o nada si empezaba antes del rango)', !!p6 && p6.horasSec === 4 * 3600, p6 && p6.horasSec);
    ok('y 4 h por unidad', !!u6 && u6.horasSec === 4 * 3600, u6 && u6.horasSec);
    const csv = await csvHoras(desde, hasta);
    const fila = csv.split('\r\n').find(l => l.startsWith('M-06;'));
    ok('el CSV de horas dice 4:00 en el período, y cuándo fue la última señal', !!fila && /;4:00;no;/.test(fila) && /Horas en el período/.test(csv), fila);
    // Turnos (pestaña) desde hace 10 h: el mismo recorte
    const t6 = await turnoDe('M-06', desde);
    ok('la pestaña Turnos recorta igual', !!t6 && t6.duracionSec === (ahora - 2 * H - desde) / 1000, t6 && t6.duracionSec);
    // Y el perfil, con su ventana de 7 días, ve las 12 h enteras
    const pf = await perfil('M-06');
    ok('el perfil (7 días) ve las 12 h enteras', pf.metricas && Math.abs(pf.metricas.horasSec - 12 * 3600) <= 2, pf.metricas && pf.metricas.horasSec);
    // Las cuatro lecturas de M-01 (turno cerrado, adentro de todo) coinciden
    const desde1 = ahora - H, hasta1 = ahora + 60_000;
    const r1 = await resumen(desde1, hasta1);
    const g1 = ((r1.porPersona || []).find(p => p.personId === 'M-01') || {}).horasSec;
    const s1 = (await turnoDe('M-01', desde1)).duracionSec;
    const c1 = ((await csvHoras(desde1, hasta1)).split('\r\n').find(l => l.startsWith('M-01;')) || '').split(';')[8];
    const f1 = (await perfil('M-01')).metricas.horasSec;
    ok('gerente, Turnos, CSV y perfil: el mismo número para el mismo turno',
       g1 === s1 && f1 === s1 && c1 === '0:00' && s1 > 0, { gerente: g1, turnos: s1, csv: c1, perfil: f1 });
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); try { servidor && servidor.kill(); } catch {} process.exit(1); });
