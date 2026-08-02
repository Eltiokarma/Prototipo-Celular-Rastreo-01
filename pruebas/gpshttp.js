// Posiciones por HTTP (`POST /gps`).
//
// Existe por una medición en un teléfono real: al bloquear la pantalla,
// Android suspende el JavaScript y el WebSocket se cae. El servicio de
// ubicación seguía vivo —la notificación permanente seguía ahí— pero la
// combi quedaba muda. Un POST no necesita nada vivo del lado del cliente.
//
// Y como acepta varias posiciones con su hora, es también lo que le faltaba
// a `app/cola.js` para poder vaciar el atraso de una zona sin datos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/gpshttp-test.db';
const P = 3161;
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

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

const mandar = (token, posiciones) => fetch(API + '/gps', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ posiciones }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const d = await login('DESPACHO', 'despacho99');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token };
  const ida    = Array.from({ length: 30 }, (_, i) => anillo(i / 58));
  const vuelta = Array.from({ length: 30 }, (_, i) => anillo(0.5 + i / 58));
  await fetch(`${API}/admin/routes/R-14/points`, { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida, vuelta } }) });
  const db = new Database(DB);
  db.prepare("UPDATE routes SET durationMin=50, targetGapMin=2, autoTarget=0 WHERE routeId='R-14'").run();
  db.close();
  for (const [u, n] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, personRole: 'driver', password: 'clave1234' }) });
  }
  // Un cobrador necesita el vehículo asignado a mano: no se le crea uno solo,
  // porque el cobrador SUBE a una combi, no es una combi.
  const altaCobrador = await fetch(`${API}/admin/users`, { method: 'POST', headers: H,
    body: JSON.stringify({ unitId: 'C-12', name: 'Cobrador Doce', personRole: 'collector',
                           vehicleId: 'M-12', password: 'clave1234' }) }).then(r => r.status);

  const s12 = await login('M-12', 'clave1234');
  const ahora = Date.now();

  console.log('\nMANDAR SIN WEBSOCKET');
  // Esto es lo que la app hace con la pantalla apagada: no hay socket, no hay
  // React vivo, solo la tarea de fondo mandando un POST.
  const q = anillo(0.10);
  let r = await mandar(s12.token, [{ lat: q.lat, lng: q.lng, speed: 22, timestamp: ahora }]);
  ok('acepta la posición sin ninguna conexión abierta', r.status === 200 && r.body.aceptadas === 1, r.body);

  // Se mira desde otro cliente, para comprobar que entró de verdad al estado.
  const s08 = await login('M-08', 'clave1234');
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws.on('open', res));
  let estado = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  ws.send(JSON.stringify({ type: 'identify', token: s08.token }));
  await sleep(900);
  const vista = () => (estado?.units || []).find(u => u.unitId === 'M-12');
  ok('la unidad aparece en el estado que ven los demás', !!vista(), estado?.units?.map(u => u.unitId));
  ok('con el progreso calculado por el servidor',
     typeof vista()?.routeProgress === 'number' && vista().routeProgress > 0, vista()?.routeProgress);

  console.log('\nEL ATRASO DE UN TÚNEL');
  // Cinco minutos de posiciones guardadas, con su hora real, llegando juntas.
  // Antes esto era imposible: el servidor le ponía la hora de llegada a cada
  // una y la unidad se teletransportaba por el recorrido.
  const atraso = Array.from({ length: 30 }, (_, i) => {
    const p = anillo(0.11 + i * 0.001);
    return { lat: p.lat, lng: p.lng, speed: 20, timestamp: ahora - (30 - i) * 10_000 };
  });
  r = await mandar(s12.token, atraso);
  ok('acepta el atraso entero de una vez', r.status === 200 && r.body.aceptadas === 30, r.body);
  await sleep(900);
  ok('la posición que queda es la MÁS NUEVA del lote',
     Math.abs(vista().lat - anillo(0.11 + 29 * 0.001).lat) < 1e-6, vista()?.lat);
  ok('y la hora guardada es la de la posición, no la de llegada',
     Math.abs(vista().timestamp - (ahora - 10_000)) < 2000,
     { guardada: vista().timestamp, esperada: ahora - 10_000 });

  console.log('\nLO QUE NO SE ACEPTA');
  r = await mandar('token-que-no-existe', [{ lat: LAT0, lng: LNG0, timestamp: ahora }]);
  ok('sin token válido, 401', r.status === 401, r.status);

  ok('el cobrador se dio de alta sobre la combi', altaCobrador === 200, altaCobrador);
  const sC = await login('C-12', 'clave1234');
  r = await mandar(sC.token, [{ lat: LAT0, lng: LNG0, timestamp: ahora }]);
  ok('el cobrador no reporta posición, 403', r.status === 403, { status: r.status, body: r.body });

  r = await mandar(s12.token, []);
  ok('sin posiciones, 400', r.status === 400, r.status);

  r = await mandar(s12.token, Array.from({ length: 201 }, () => ({ lat: LAT0, lng: LNG0, timestamp: ahora })));
  ok('un envío descomunal se rechaza entero, 413', r.status === 413, r.status);

  // Un reloj adelantado mandaría posiciones del futuro y arruinaría la
  // medición de la vuelta; una de hace un día ya no le sirve a nadie.
  const antes = vista().timestamp;
  r = await mandar(s12.token, [
    { lat: LAT0, lng: LNG0, speed: 5, timestamp: ahora + 3600_000 },
    { lat: LAT0, lng: LNG0, speed: 5, timestamp: ahora - 24 * 3600_000 },
  ]);
  ok('las del futuro y las muy viejas se descartan', r.status === 400, { status: r.status, body: r.body });
  await sleep(600);
  ok('y no ensucian la posición que había', vista().timestamp === antes, vista()?.timestamp);

  console.log('\nEL RELEVO SIGUE MANDANDO');
  // Si otro chofer tomó la unidad por WebSocket, el HTTP del anterior ya no
  // vale: son las mismas reglas de `gps_role`, no unas nuevas.
  const otro = await login('M-12', 'clave1234');   // misma persona, sesión nueva
  const ws2 = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws2.on('open', res));
  ws2.send(JSON.stringify({ type: 'identify', token: otro.token }));
  await sleep(500);
  r = await mandar(s12.token, [{ lat: q.lat, lng: q.lng, speed: 10, timestamp: Date.now() }]);
  ok('la misma persona con otra sesión sí puede seguir mandando', r.status === 200, r.status);

  ws.close(); ws2.close();
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
