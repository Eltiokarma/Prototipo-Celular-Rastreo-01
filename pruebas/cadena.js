// La cadena de brechas es por tramo: ida y retorno, no un circuito.
//
// Lo que se defiende (decisión del 8/9, REVISION-2026-09-08.md, L1): una
// combi se mide sólo contra las de SU tramo. La que está por llegar al
// terminal no tiene «adelante» a la que acaba de salir de vuelta —va para el
// otro lado—, y la recién salida no recibe «apurá» hacia la que está a 48
// minutos por el otro extremo del circuito. La vuelta entera sigue siendo
// una métrica (`laps`); lo que no existe es la brecha a través del terminal.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/cadena-test.db';
const P = 3163;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un anillo de 900 m de radio: la ida es la mitad norte (t de 0 a 0,5) y la
// vuelta la mitad sur (0,5 a 1). Calles distintas: el tramo se decide solo.
const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
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
  {
    const db = new Database(DB);
    db.prepare("UPDATE routes SET durationMin=50, targetGapMin=2, autoTarget=0 WHERE routeId='R-14'").run();
    db.close();
  }
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const ses = {};
  for (const u of ['M-01', 'M-02', 'M-03']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const gps = (u, t, extra = {}) => { const q = anillo(t); return pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token },
    body: JSON.stringify({ posiciones: [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now(), ...extra }] }),
  }); };

  const ws = new WebSocket(`ws://localhost:${P}`);
  let ultimo = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ultimo = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(600);
  const estado = async () => { await sleep(700); return ultimo || {}; };
  const tramoDe = (st, u) => (st.units || []).find(x => x.unitId === u)?.tramo;

  console.log('\nTRES EN LA CALLE: DOS DE IDA, UNA DE VUELTA');
  // M-01 por llegar al final de la ida (t = 0,47), M-02 recién salida de
  // vuelta (t = 0,53) —a metros de M-01 por el mapa, pero yendo para el otro
  // lado—, y M-03 arrancando la ida (t = 0,05).
  for (let i = 0; i < 3; i++) {
    await gps('M-01', 0.47); await gps('M-02', 0.53); await gps('M-03', 0.05);
    await sleep(300);
  }
  let st = await estado();
  ok('el servidor sabe el tramo de cada una',
     tramoDe(st, 'M-01') === 'ida' && tramoDe(st, 'M-02') === 'vuelta' && tramoDe(st, 'M-03') === 'ida',
     ['M-01', 'M-02', 'M-03'].map(u => tramoDe(st, u)));
  ok('las tres están en la cadena', st.totalOnRoute === 3 && Object.keys(st.gaps || {}).length === 3,
     { total: st.totalOnRoute, gaps: Object.keys(st.gaps || {}) });

  const g1 = st.gaps['M-01'], g2 = st.gaps['M-02'], g3 = st.gaps['M-03'];
  ok('la de vuelta no tiene a nadie adelante ni atrás: está sola en su tramo',
     g2.aheadUnit === null && g2.behindUnit === null && g2.toAhead === null && g2.toBehind === null, g2);
  ok('la que llega al final de la ida NO tiene adelante a la que salió de vuelta',
     g1.aheadUnit === null && g1.toAhead === null, g1);
  ok('pero sí tiene atrás a la que arranca la ida', g1.behindUnit === 'M-03' && /^\d{2}:\d{2}$/.test(g1.toBehind || ''), g1);
  ok('y ésa la ve adelante, a ~21 min (42 % de 50)',
     g3.aheadUnit === 'M-01' && /^2[01]:\d{2}$/.test(g3.toAhead || ''), g3);
  ok('la recién salida no tiene a nadie atrás: la de vuelta no cuenta', g3.behindUnit === null, g3);

  console.log('\nLA QUE ARRANCA LA IDA TERMINA Y SALE DE VUELTA');
  // M-03 aparece al principio de la vuelta, detrás de M-02: recién ahí son
  // vecinas. M-01 queda sola en la ida.
  for (let i = 0; i < 4; i++) { await gps('M-03', 0.51); await gps('M-02', 0.56); await gps('M-01', 0.47); await sleep(300); }
  st = await estado();
  ok('cambió de tramo', tramoDe(st, 'M-03') === 'vuelta', tramoDe(st, 'M-03'));
  const h2 = st.gaps['M-02'], h3 = st.gaps['M-03'], h1 = st.gaps['M-01'];
  ok('ahora M-02 la tiene atrás', h2.behindUnit === 'M-03' && /^\d{2}:\d{2}$/.test(h2.toBehind || ''), h2);
  ok('y M-03 la tiene adelante, a ~2,5 min (5 % de 50)',
     h3.aheadUnit === 'M-02' && /^0[23]:\d{2}$/.test(h3.toAhead || ''), h3);
  ok('M-01 quedó sola en la ida: nadie adelante, nadie atrás',
     h1.aheadUnit === null && h1.behindUnit === null, h1);

  console.log('\nLA VUELTA SIGUE SIENDO UNA MÉTRICA');
  // M-03 completa el circuito: la vuelta se guarda igual. Lo que no existe
  // es la brecha a través del terminal, no la vuelta.
  for (const t of [0.6, 0.7, 0.8, 0.9, 0.97, 0.02, 0.05, 0.08, 0.1]) { await gps('M-03', t); await sleep(120); }
  await sleep(700);
  {
    const db = new Database(DB, { readonly: true });
    const vueltas = db.prepare('SELECT unitId, parcial FROM laps WHERE unitId = ?').all('M-03');
    db.close();
    ok('la vuelta de M-03 quedó guardada', vueltas.length === 1, vueltas);
  }

  console.log('\nSIN TRAZADO, LA FILA ES UNA SOLA');
  // Una ruta sin recorrido cargado no tiene tramos: el progreso lo estima el
  // cliente (la app web, por WebSocket) y las brechas se miden como siempre,
  // en una sola fila.
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida: [], vuelta: [] } }) });
  await sleep(500);
  const socks = {};
  for (const u of ['M-01', 'M-02', 'M-03']) {
    const s = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => s.on('open', r));
    s.send(JSON.stringify({ type: 'identify', token: ses[u].token }));
    socks[u] = s;
  }
  await sleep(400);
  const gpsWs = (u, t) => { const q = anillo(t); socks[u].send(JSON.stringify({ type: 'gps', lat: q.lat, lng: q.lng, speed: 20, routeProgress: t })); };
  for (let i = 0; i < 3; i++) { gpsWs('M-01', 0.47); gpsWs('M-02', 0.53); gpsWs('M-03', 0.05); await sleep(300); }
  st = await estado();
  for (const s of Object.values(socks)) { try { s.close(); } catch {} }
  ok('sin tramo', st.units.every(u => u.tramo === null), st.units.map(u => u.tramo));
  ok('M-02 (0,53) tiene atrás a M-01 (0,47) y M-01 adelante a M-02',
     st.gaps['M-02'].behindUnit === 'M-01' && st.gaps['M-01'].aheadUnit === 'M-02',
     { m2: st.gaps['M-02'], m1: st.gaps['M-01'] });

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  try { ws.close(); } catch {}
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
