// Una cuenta de chofer no tumba el servidor de todos (auditoría del 11/11).
//
//   - POST /gps tiene cupo por persona (pedidos y posiciones por minuto). Sin
//     cupo, un token hizo 337 pedidos en 6 s y le aceptaron 31.200
//     posiciones, con el hilo único ocupado. Pasado el tope: 429 con
//     Retry-After (y la app guarda el lote, no lo pierde).
//   - `identify` repetido sobre el mismo socket: tres por minuto. Cada uno
//     devolvía el estado y hasta 3 MB de historial.
//   - Conexiones a la vez por cuenta: se cierra la más vieja.
//   - Un socket sin identificar no hace parsear megas: se ignora lo que pase
//     de 8 KB antes del identify.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/cupos.db';
const P = 3246;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    // En la demo el cupo del GPS está apagado: se pide el de producción
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           CUPO_GPS_PEDIDOS: '60', CUPO_GPS_POSICIONES: '1200' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => { if (!/Cupo|conexiones|sin leer/.test(String(d))) process.stderr.write('[srv] ' + d); });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const pedir = (ruta, o = {}) => fetch(API + ruta,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
const abrir = () => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.cerrado = false;
  ws.on('message', raw => { try { ws.visto.push(JSON.parse(raw)); } catch {} });
  ws.on('close', () => { ws.cerrado = true; });
  ws.on('open', () => res(ws));
  ws.on('error', rej);
});
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };

(async () => {
  borrarBase();
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  const a = await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
    body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const T = await entrar('pedro', 'clave12345');
  const H = { Authorization: 'Bearer ' + T };

  console.log('\nPOST /gps CON CUPO');
  const ahora = Date.now();
  const lote = (k) => Array.from({ length: 200 }, (_, i) => ({
    lat: -15.49 + (k * 200 + i) * 1e-6, lng: -70.133, speed: 20, timestamp: ahora - 600_000 + (k * 200 + i) * 50 }));
  let ok200 = 0, n429 = 0, aceptadas = 0, retry = null;
  for (let k = 0; k < 15; k++) {
    const r = await pedir('/gps', { method: 'POST', headers: H, body: JSON.stringify({ posiciones: lote(k), presencia: 'ruta' }) });
    if (r.status === 200) { ok200++; aceptadas += r.body.aceptadas || 0; }
    if (r.status === 429) { n429++; retry = r.headers.get('retry-after'); }
  }
  ok('las primeras pasan', ok200 >= 1, ok200);
  ok('pasado el tope de posiciones por minuto: 429', n429 > 0, { ok200, n429 });
  ok('con Retry-After', !!retry && Number(retry) > 0, retry);
  ok('no entran más de 1200 posiciones en el minuto', aceptadas <= 1200, aceptadas);
  const t0 = Date.now();
  await fetch(API + '/ping');
  ok('el servidor sigue contestando rápido', Date.now() - t0 < 200, Date.now() - t0);
  // Otro chofer no paga el cupo del primero
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-02', 'Z1A-702', 'R-14', emp, Date.now());
  const a2 = await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
    body: JSON.stringify({ unitId: 'juan', name: 'Juan Quispe', vehicleId: 'M-02', password: 'clave12345' }) });
  const T2 = await entrar('juan', 'clave12345');
  const r2 = await pedir('/gps', { method: 'POST', headers: { Authorization: 'Bearer ' + T2 },
    body: JSON.stringify({ posiciones: [{ lat: -15.48, lng: -70.12, speed: 10, timestamp: Date.now() }], presencia: 'ruta' }) });
  ok('el cupo es por persona: otro chofer manda igual', a2.status === 200 && r2.status === 200, [a2.status, r2.status, a2.body.error]);
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  ok('la app guarda el lote ante un 429 (no lo pierde)', /r\.status >= 500 \|\| r\.status === 429\) guardarSiSigue/.test(servicio));

  console.log('\nIDENTIFY REPETIDO');
  const ws = await abrir();
  for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ type: 'identify', token: T }));
  await sleep(1500);
  const historiales = ws.visto.filter(m => m.type === 'chat_history').length;
  ok('sólo los primeros tres reciben estado e historial', historiales <= 3 && historiales >= 1, historiales);
  ok('y se le avisa el cupo', ws.visto.some(m => m.type === 'cupo' && m.que === 'identify'));
  ws.close();

  console.log('\nCONEXIONES POR CUENTA');
  const muchas = [];
  for (let i = 0; i < 9; i++) {
    const w = await abrir();
    w.send(JSON.stringify({ type: 'identify', token: T }));
    muchas.push(w);
    await sleep(80);
  }
  await sleep(1200);
  const abiertas = muchas.filter(w => !w.cerrado).length;
  ok('quedan a lo sumo 6 abiertas', abiertas <= 6, abiertas);
  ok('las que se cerraron son las más viejas', muchas.slice(0, 3).every(w => w.cerrado) && !muchas[8].cerrado);
  muchas.forEach(w => { try { w.close(); } catch {} });
  // Los paneles tienen otro tope: la cuenta DESPACHO se comparte
  const paneles = [];
  for (let i = 0; i < 8; i++) {
    const w = await abrir();
    w.send(JSON.stringify({ type: 'identify', token: D }));
    paneles.push(w);
    await sleep(60);
  }
  await sleep(800);
  ok('ocho pestañas de Despacho siguen abiertas', paneles.every(w => !w.cerrado), paneles.filter(w => w.cerrado).length);
  paneles.forEach(w => { try { w.close(); } catch {} });

  console.log('\nSIN IDENTIFICAR');
  const anon = await abrir();
  anon.send(JSON.stringify({ type: 'identify', token: T, relleno: 'x'.repeat(20_000) }));
  await sleep(600);
  ok('un mensaje de más de 8 KB antes del identify se ignora', anon.visto.length === 0, anon.visto.map(m => m.type));
  anon.send(JSON.stringify({ type: 'identify', token: T }));
  await sleep(600);
  ok('y el identify normal sí anda', anon.visto.some(m => m.type === 'chat_history'));
  anon.close();

  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
