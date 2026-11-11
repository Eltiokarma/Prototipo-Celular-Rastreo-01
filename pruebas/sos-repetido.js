// El mismo SOS no suena dos veces, y la app nativa se da cuenta del socket
// «medio muerto» (auditoría del 11/11).
//
//   - La app manda el SOS por el socket y, sin eco a tiempo, por HTTP; la web
//     al revés. Si el primero llegó y la respuesta se perdió, salían dos
//     alarmas. Ahora, mientras la persona tenga un SOS sin atender de los
//     últimos minutos, volver a mandarlo devuelve ESE: no suena de nuevo,
//     pero el que lo mandó recibe su confirmación.
//   - Atendido el anterior, uno nuevo es otra emergencia. Y el de otra
//     persona, también.
//   - La app nativa no tenía latido: un socket que deja de contestar sin
//     cerrarse la dejaba en «EN VIVO» para siempre. Ahora, pasado el silencio
//     máximo, se da por muerto y se reconecta.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { crearCliente } = require(RAIZ + '/app/protocolo/cliente.js');
const fs = require('fs');

const DB = S + '/sos-repetido.db';
const P = 3249;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };
const pedir = (ruta, o = {}) => fetch(API + ruta,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
async function socket(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => { try { ws.visto.push(JSON.parse(raw)); } catch {} });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(500);
  return ws;
}

let servidor = null;
(async () => {
  borrarBase();
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const D = await entrar('DESPACHO', 'despacho99');
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-7' + v.slice(-2), 'R-14', emp, Date.now());
  }
  for (const [u, n, v] of [['pedro', 'Pedro Mamani', 'M-01'], ['juan', 'Juan Quispe', 'M-02']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
      body: JSON.stringify({ unitId: u, name: n, vehicleId: v, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  }
  const TP = await entrar('pedro', 'clave12345');
  const panel = await socket(D);
  const pedro = await socket(TP);
  const alertas = () => panel.visto.filter(m => m.type === 'sos_alert');
  const filas = () => base.prepare("SELECT COUNT(*) n FROM messages WHERE kind = 'sos'").get().n;

  console.log('\nEL MISMO SOS POR LAS DOS PUERTAS');
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  await sleep(500);
  const primero = alertas()[0];
  ok('el primero suena en el panel', !!primero && primero.unitId === 'pedro');
  const h = await pedir('/sos', { method: 'POST', headers: { Authorization: 'Bearer ' + TP },
    body: JSON.stringify({ lat: -15.49, lng: -70.133, timestamp: Date.now() }) });
  await sleep(500);
  ok('el HTTP que llega después contesta ok con el MISMO id', h.status === 200 && h.body.sosId === primero.sosId && h.body.repetido === true, h.body);
  ok('y no suena de nuevo', alertas().length === 1, alertas().length);
  ok('queda un solo SOS en la base', filas() === 1, filas());
  const ecos = pedro.visto.filter(m => m.type === 'sos_alert').length;
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  await sleep(500);
  const eco = pedro.visto.filter(m => m.type === 'sos_alert').slice(ecos)[0];
  ok('repetido por el socket, el que lo mandó recibe su eco', !!eco && eco.sosId === primero.sosId && eco.repetido === true, eco);
  ok('y el panel sigue con una sola alarma', alertas().length === 1 && filas() === 1);

  console.log('\nOTRA PERSONA, OTRA EMERGENCIA');
  const juan = await socket(await entrar('juan', 'clave12345'));
  juan.send(JSON.stringify({ type: 'sos', lat: -15.48, lng: -70.12, timestamp: Date.now() }));
  await sleep(500);
  ok('el de Juan suena aparte', alertas().length === 2 && alertas()[1].unitId === 'juan');

  console.log('\nATENDIDO EL ANTERIOR, UNO NUEVO ES OTRO');
  panel.send(JSON.stringify({ type: 'sos_atender', sosId: primero.sosId }));
  await sleep(500);
  pedro.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.133, timestamp: Date.now() }));
  await sleep(500);
  const nuevo = alertas().filter(m => m.unitId === 'pedro').pop();
  ok('suena de nuevo, con otro id', alertas().length === 3 && nuevo.sosId !== primero.sosId, alertas().map(a => a.sosId));
  pedro.close(); juan.close(); panel.close();

  console.log('\nLA APP NATIVA: SOCKET MEDIO MUERTO');
  // Un servidor que acepta la conexión y no contesta NADA nunca, ni cierra
  const mudo = new WebSocket.Server({ port: P + 100 });
  mudo.on('connection', (ws) => { ws.on('error', () => {}); });
  const c = crearCliente({ servidor: `http://localhost:${P + 100}`, WebSocketImpl: WebSocket, latidoMs: 200, silencioMaxMs: 900 });
  const eventos = [];
  c.on('conexion', e => eventos.push(e));
  c.on('reintento', e => eventos.push({ reintento: e }));
  c.conectar('x'.repeat(40), { unitId: 'pedro' });
  await sleep(2000);
  ok('se da cuenta de que está mudo', eventos.some(e => e.conectado === false && e.motivo === 'mudo'), eventos);
  ok('y agenda la reconexión', eventos.some(e => e.reintento));
  c.salir();
  mudo.close();

  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
