// Los límites de trabajo pendiente (revisión del 15/11, grupo 3).
//
//   A. DIS-01: los ingresos que verifican clave a la vez tienen tope, por
//      origen y en todo el servidor. Antes mil pedidos juntos pasaban todos
//      los frenos (que miran ANTES del scrypt y anotan DESPUÉS) y llenaban el
//      pool de hilos: se demoraban los ingresos de todas las cooperativas.
//   B. DIS-02: un teléfono que no lee no junta fotos en la memoria del
//      servidor. El tope de bytes sin leer sólo lo miraba el historial; el
//      reparto en vivo encolaba sin mirar. Ahora se lo corta al pasarlo, y
//      los demás siguen recibiendo.
//   C. DIS-04: importaciones de planillas a la vez, con tope en el servidor;
//      y cuenta y clave se guardan juntas (ya no hay huella de relleno que
//      quede si el proceso se corta).
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');

const DB = S + '/limites.db';
const P = 3256;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasta = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const pedir = (ruta, o = {}) => fetch(API + ruta,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, c, ip) => pedir('/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': ip },
  body: JSON.stringify({ user: u, password: c }) });
async function socket(token, opciones = {}) {
  const ws = new WebSocket(`ws://localhost:${P}`, opciones);
  ws.visto = [];
  ws.cerrado = false;
  ws.on('message', raw => { try { ws.visto.push(JSON.parse(raw)); } catch {} });
  ws.on('close', () => { ws.cerrado = true; });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(500);
  return ws;
}

let servidor = null;
let log = '';
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           TRUST_PROXY: '1', RESPALDO_CADA_H: '0', WS_BUFFER_MAX: '4000000', WS_LLENO_MS: '500', HISTORIA_MEDIA_KB: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const D = (await login('DESPACHO', 'despacho99', '10.8.0.1')).body.token;
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02', 'M-03']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-7' + v.slice(-2), 'R-14', emp, Date.now());
  }
  for (const [u, v] of [['pedro', 'M-01'], ['juan', 'M-02'], ['luis', 'M-03'], ['ana', 'M-01']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: u, vehicleId: v, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta ' + u + ': ' + JSON.stringify(a.body));
  }

  console.log('\nA. INGRESOS VERIFICANDO A LA VEZ');
  {
    const r = await Promise.all(Array.from({ length: 40 }, () => login('pedro', 'clave12345', '10.8.1.1')));
    const frenados = r.filter(x => x.status === 429 && /muchos ingresos al mismo tiempo/.test(x.body.error || '')).length;
    const entraron = r.filter(x => x.status === 200).length;
    ok('40 juntos desde un origen: entran los del tope, al resto se le dice que espere', // los que terminan liberan su lugar: pueden entrar algunos más que el tope
      frenados > 0 && entraron >= 1 && entraron < 20,
      { entraron, frenados });
    ok('y otro origen entra mientras tanto', (await login('juan', 'clave12345', '10.8.1.2')).status === 200);
    ok('terminados, el lugar se libera', (await login('pedro', 'clave12345', '10.8.1.1')).status === 200);
    const r2 = await Promise.all(Array.from({ length: 90 }, (_, i) => login('luis', 'clave12345', `10.8.2.${i + 1}`)));
    const frenados2 = r2.filter(x => x.status === 429).length;
    ok('90 juntos desde orígenes distintos: el tope del servidor frena el resto', frenados2 > 0 && frenados2 < 90, { frenados: frenados2 });
  }

  console.log('\nB. EL TELÉFONO QUE NO LEE');
  {
    const TP = (await login('pedro', 'clave12345', '10.8.3.1')).body.token;
    const TJ = (await login('juan', 'clave12345', '10.8.3.2')).body.token;
    const TL = (await login('luis', 'clave12345', '10.8.3.3')).body.token;
    const TA = (await login('ana', 'clave12345', '10.8.3.4')).body.token;
    // Sin compresión: así lo encolado pesa lo que pesa la foto
    const mudo = await socket(TL, { perMessageDeflate: false });
    const sano = await socket(TJ);
    // El kernel absorbe hasta ~36 MB de una conexión local que no lee antes
    // de que algo se acumule en el servidor: hacen falta ~50 MB de fotos.
    // Cada conexión tiene su cupo de 6 por minuto, así que van ocho.
    const emisores = [];
    for (let i = 0; i < 6; i++) emisores.push(await socket(TP));
    for (let i = 0; i < 2; i++) emisores.push(await socket(TA));
    // Deja de leer: lo que el servidor le manda se queda en el servidor
    mudo._socket.pause();
    const foto = () => 'data:image/jpeg;base64,' + crypto.randomBytes(780_000).toString('base64');
    let mandadas = 0;
    for (let ronda = 0; ronda < 6; ronda++) {
      for (const e of emisores) { e.send(JSON.stringify({ type: 'photo', data: foto(), timestamp: Date.now() })); mandadas++; }
      await sleep(1000);
    }
    ok('el servidor lo corta al pasar el tope', await hasta(() => /WebSocket de luis con \d+ MB sin leer: se corta/.test(log), 15000),
      log.split('\n').filter(l => /sin leer/.test(l)));
    ok('y los demás reciben las fotos igual', await hasta(() => sano.visto.filter(m => m.type === 'photo_msg').length === mandadas, 30000),
      sano.visto.filter(m => m.type === 'photo_msg').length);
    mudo._socket.resume();
    ok('el cortado se entera (y la app reconecta y recibe el historial)', await hasta(() => mudo.cerrado, 10000));
    mudo.close(); sano.close(); emisores.forEach(e => e.close());
  }

  console.log('\nC. LAS PLANILLAS');
  {
    const HD = { Authorization: 'Bearer ' + D };
    const filas = ['Usuario\tNombre\tRol\tCombi'];
    for (let i = 0; i < 40; i++) filas.push(`p${i}\tPersona ${i}\tchofer\tM-0${1 + (i % 3)}`);
    const texto = filas.join('\n');
    const r = await Promise.all(Array.from({ length: 5 }, () =>
      pedir('/admin/users/importar', { method: 'POST', headers: HD, body: JSON.stringify({ texto, confirmar: false }) })));
    const frenadas = r.filter(x => x.status === 429).length;
    ok('cinco a la vez: el servidor procesa las del tope y a las otras les dice que esperen',
      frenadas > 0 && r.some(x => x.status === 200), r.map(x => x.status));
    const alta = await pedir('/admin/users/importar', { method: 'POST', headers: HD, body: JSON.stringify({ texto, confirmar: true }) });
    ok('confirmada, crea las 40', alta.status === 200 && alta.body.buenas === 40, alta.body.buenas);
    const relleno = base.prepare("SELECT COUNT(*) n FROM users WHERE unitId LIKE 'p%' AND length(passHash) < 40").get().n;
    const conHuella = base.prepare("SELECT COUNT(*) n FROM users WHERE unitId GLOB 'p[0-9]*'").get().n;
    ok('cada cuenta nace con su clave de verdad', conHuella === 40 && relleno === 0, { conHuella, relleno });
    const una = alta.body.filas.find(f => f.usuario === 'p7');
    ok('y la clave que se le dio sirve para entrar', (await login('p7', una.clave, '10.8.4.1')).status === 200);
    const idx = fs.readFileSync(RAIZ + '/server/index.js', 'utf8');
    ok('ya no se pone una huella de relleno que se reemplaza después',
      !/UPDATE users SET passHash = \? WHERE unitId = \? AND passHash = \?/.test(idx));
  }

  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
