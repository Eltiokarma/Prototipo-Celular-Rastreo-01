// La tormenta de reconexión tras un deploy (auditoría del 11/11).
//
// Tras un deploy, todos los teléfonos y paneles pierden el socket en el mismo
// segundo y, con la misma espera fija de 3 s, volvían todos juntos. Cada
// `identify` armaba en el acto su historial (hasta 3 MB de fotos y audios)
// en el hilo único: 600 sockets congelaron el servidor ~11 s.
//
//   - El servidor arma los historiales en cola, cediendo el hilo: con 300
//     identify a la vez y ~2,4 MB de fotos en el chat, /ping sigue
//     contestando rápido y todos reciben su historial.
//   - Los tres clientes reconectan con espera creciente y azar.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/tormenta.db';
const P = 3248;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SOCKETS = 300;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };

let servidor = null;
(async () => {
  borrarBase();
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           WS_POR_CUENTA_PANEL: String(SOCKETS + 10) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const D = (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) }).then(r => r.json())).token;

  // Ocho fotos de 300 KB en el chat de la ruta
  const base = new Database(DB);
  const foto = 'data:image/jpeg;base64,' + Buffer.alloc(225_000, 7).toString('base64');
  const ins = base.prepare(`INSERT INTO messages (kind, unitId, driverName, routeId, text, data, timestamp)
                            VALUES ('photo', 'DESPACHO', 'Despacho', 'R-14', 'foto', ?, ?)`);
  for (let i = 0; i < 8; i++) ins.run(foto, Date.now() - 60_000 + i);
  base.close();

  console.log(`\n${SOCKETS} PANELES SE IDENTIFICAN A LA VEZ`);
  const sockets = await Promise.all(Array.from({ length: SOCKETS }, () => new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${P}`, { perMessageDeflate: false });
    ws.historial = false;
    ws.on('message', (raw) => { if (String(raw).startsWith('{"type":"chat_history"')) ws.historial = true; });
    ws.on('open', () => res(ws));
    ws.on('error', () => res(ws));
  })));
  const t0 = Date.now();
  for (const ws of sockets) { try { ws.send(JSON.stringify({ type: 'identify', token: D })); } catch {} }
  // Mientras se arman los historiales, /ping cada 100 ms
  let peor = 0;
  const fin = Date.now() + 8000;
  while (Date.now() < fin && sockets.some(w => !w.historial)) {
    const a = Date.now();
    await fetch(API + '/ping').catch(() => {});
    peor = Math.max(peor, Date.now() - a);
    await sleep(100);
  }
  const conHistorial = sockets.filter(w => w.historial).length;
  ok('todos reciben su historial', conHistorial === SOCKETS, { conHistorial, enMs: Date.now() - t0 });
  ok('y /ping nunca tardó más de 1,5 s mientras tanto', peor < 1500, peor);
  sockets.forEach(w => { try { w.terminate(); } catch {} });

  console.log('\nLOS CLIENTES RECONECTAN CON AZAR');
  const leer = (f) => fs.readFileSync(RAIZ + '/' + f, 'utf8');
  ok('la app nativa', /RECONEXION_TOPE_MS\) \* \(0\.5 \+ Math\.random\(\)\)/.test(leer('app/protocolo/cliente.js')));
  ok('la web del chofer', /function esperaReconexion\(\)[\s\S]{0,200}Math\.random\(\)/.test(leer('project/realtime.js')) &&
     !/setTimeout\(\(\) => connect\(\{ token: authToken \}\), 3000\)/.test(leer('project/realtime.js')));
  ok('Despacho', /Math\.min\(3000 \* 2 \*\* intentos, 30000\) \* \(0\.5 \+ Math\.random\(\)\)/.test(leer('project/despacho.html')) &&
     !/reconnect = setTimeout\(open, 3000\)/.test(leer('project/despacho.html')));

  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
