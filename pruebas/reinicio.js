// Un reinicio no tira las vueltas (PENDIENTES 0.12, 04/11).
//
// Antes, las vueltas y los tramos en curso, los desvíos y paradas abiertos y
// la presencia de cada combi vivían sólo en memoria: un deploy en hora pico le
// tiraba la vuelta a cada combi, y los desvíos abiertos quedaban «cortados».
// Ahora el servidor saca una foto de esa memoria (cada 15 s y al recibir
// SIGTERM) y al arrancar la retoma si es reciente. Se prueba con DOS
// corridas, una contra la otra:
//
//   CON memoria: una combi a media vuelta y otra fuera del recorrido;
//   SIGTERM; arranca de nuevo. La vuelta se cierra ENTERA y con la hora de
//   salida de antes del reinicio; el desvío sigue abierto y se cierra cuando
//   vuelve («regreso», no «corte»); nadie queda acusado de entrada tardía ni
//   aparece un corte de señal por el reinicio; el mapa las muestra antes de
//   que manden nada.
//
//   Un CUELGUE sin aviso (SIGKILL): no se alcanza a guardar al apagar, y
//   sirve la foto periódica.
//
//   SIN memoria (la foto demasiado vieja: lo de antes): la misma situación
//   pierde la vuelta entera y el desvío queda «cortado». Así se ve que la
//   prueba mide algo.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const P = 3214;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// El anillo de `cadena.js`: 900 m de radio, ida al norte y vuelta al sur
const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = (t, r = 900) => ({
  lat: LAT0 + gr * r * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * r * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
async function arrancar(DB, extra = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.log = '';
  servidor.stdout.on('data', d => { servidor.log += d; });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  servidor.salida = new Promise(r => servidor.on('exit', (code, sig) => r({ code, sig })));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); return; } catch {} }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, opts = {}) => fetch(API + ruta, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = async (u, p) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;

// Una corrida entera. `retomar` = si el segundo arranque puede usar la foto.
async function corrida(nombre, { retomar, senal = 'SIGTERM', extra = {} }) {
  const DB = `${S}/reinicio-${nombre}.db`;
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar(DB, extra);
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const ida = Array.from({ length: 30 }, (_, i) => anillo(i / 58));
  const vuelta = Array.from({ length: 30 }, (_, i) => anillo(0.5 + i / 58));
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }) });
  { const b = new Database(DB); b.prepare("UPDATE routes SET durationMin=50, targetGapMin=2, autoTarget=0 WHERE routeId='R-14'").run(); b.close(); }
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const ses = {};
  for (const u of ['M-01', 'M-02']) {
    await pedir('/admin/users', { method: 'POST', headers: HG, body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const gps = (u, t, r = 900) => { const q = anillo(t, r); return pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token },
    body: JSON.stringify({ presencia: 'ruta', posiciones: [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now() }] }),
  }); };

  // M-01 sale del principio y llega a la mitad; M-02 pisa el trazado y se
  // va 400 m afuera, sostenido
  for (const [i, t] of [0.02, 0.06, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].entries()) {
    await gps('M-01', t); await gps('M-02', 0.62 + i * 0.005); await sleep(120);
  }
  const respuestas = [];
  for (let i = 0; i < 12; i++) { respuestas.push((await gps('M-02', 0.68, 1300)).body); await gps('M-01', 0.52 + i * 0.004); await sleep(200); }
  if (process.env.VER) console.log(JSON.stringify(respuestas.slice(0, 3)));
  // Para el cuelgue: que la foto periódica alcance a sacarse con todo adentro
  if (senal === 'SIGKILL') await sleep(1500);
  await sleep(500);
  let b = new Database(DB, { readonly: true });
  const desvio = b.prepare("SELECT id, endedAt, cierre FROM deviations WHERE vehicleId = 'M-02'").get();
  b.close();
  const salidaAntes = Date.now();

  // El deploy: SIGTERM, como hace Railway. O un cuelgue: SIGKILL, sin aviso
  servidor.kill(senal);
  const fin = await servidor.salida;
  b = new Database(DB, { readonly: true });
  const foto = b.prepare('SELECT guardadoEn, motivo, length(datos) n FROM memoria_caliente WHERE id = 1').get();
  b.close();
  await sleep(300);
  await arrancar(DB, retomar ? extra : { ...extra, RETOMAR_MS: '1' });
  const logArranque = servidor.log;

  // El mapa, antes de que nadie mande nada
  const ws = new WebSocket(`ws://localhost:${P}`);
  let ultimo = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ultimo = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: (await login('DESPACHO', 'despacho99')).token }));
  await sleep(900);
  const enElMapa = (ultimo?.units || []).map(u => u.unitId).sort();
  ws.close();

  // Sigue el turno: M-01 completa el circuito; M-02 vuelve al recorrido
  ses['M-01'] = await login('M-01', 'chofer1234');
  ses['M-02'] = await login('M-02', 'chofer1234');
  for (const t of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98, 0.02, 0.05, 0.08]) {
    await gps('M-01', t); await gps('M-02', 0.72); await sleep(150);
  }
  for (let i = 0; i < 6; i++) { await gps('M-02', 0.74 + i * 0.005); await sleep(200); }
  await sleep(800);
  b = new Database(DB, { readonly: true });
  const r = {
    fin, foto, logArranque, enElMapa, desvio, salidaAntes,
    vueltas: b.prepare("SELECT startedAt, parcial, progresoInicial FROM laps WHERE unitId = 'M-01'").all(),
    desvioDespues: desvio && b.prepare('SELECT endedAt, cierre FROM deviations WHERE id = ?').get(desvio.id),
    tardias: b.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'entrada_tardia'").get().n,
    huecosM01: b.prepare("SELECT COUNT(*) n FROM huecos WHERE vehicleId = 'M-01'").get().n,
  };
  b.close();
  servidor.kill('SIGTERM'); await servidor.salida; await sleep(200);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  return r;
}

// Un cuelgue justo después de cerrar una vuelta y un desvío: la última foto
// periódica es de ANTES del cierre (revisión integral del 04/11)
async function corridaCierre() {
  const DB = `${S}/reinicio-cierre.db`;
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const extra = { MEMORIA_CADA_MS: '5000' };
  await arrancar(DB, extra);
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const ida = Array.from({ length: 30 }, (_, i) => anillo(i / 58));
  const vuelta = Array.from({ length: 30 }, (_, i) => anillo(0.5 + i / 58));
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }) });
  { const b = new Database(DB); b.prepare("UPDATE routes SET durationMin=50, targetGapMin=2, autoTarget=0 WHERE routeId='R-14'").run(); b.close(); }
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const ses = {};
  for (const u of ['M-01', 'M-02']) {
    await pedir('/admin/users', { method: 'POST', headers: HG, body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const gps = (u, t, r = 900) => { const q = anillo(t, r); return pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token },
    body: JSON.stringify({ presencia: 'ruta', posiciones: [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now() }] }),
  }); };
  for (const [i, t] of [0.02, 0.06, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].entries()) {
    await gps('M-01', t); await gps('M-02', 0.62 + i * 0.003); await sleep(100);
  }
  for (let i = 0; i < 12; i++) { await gps('M-02', 0.68, 1300); await gps('M-01', 0.92 + i * 0.004); await sleep(120); }
  // Se espera una foto periódica NUEVA (con la vuelta y el desvío abiertos)…
  const fotoEn = () => { const b = new Database(DB, { readonly: true }); const f = b.prepare('SELECT guardadoEn FROM memoria_caliente').get(); b.close(); return f && f.guardadoEn; };
  const antes = fotoEn();
  for (let i = 0; i < 80 && fotoEn() === antes; i++) await sleep(100);
  // …y enseguida, antes de la próxima, se cierran las dos cosas
  for (const t of [0.97, 0.99, 0.02, 0.04, 0.06]) await gps('M-01', t);
  for (let i = 0; i < 6; i++) await gps('M-02', 0.7 + i * 0.004);
  let b = new Database(DB, { readonly: true });
  const desvioAntes = b.prepare("SELECT endedAt, cierre FROM deviations WHERE vehicleId = 'M-02'").get();
  b.close();
  servidor.kill('SIGKILL'); await servidor.salida; await sleep(300);
  await arrancar(DB, extra);
  const log = servidor.log;
  b = new Database(DB, { readonly: true });
  const fotoDespues = b.prepare('SELECT guardadoEn FROM memoria_caliente').get();
  b.close();
  ses['M-01'] = await login('M-01', 'chofer1234'); ses['M-02'] = await login('M-02', 'chofer1234');
  // Sigue andando: con la vuelta vieja retomada, esto la cerraba otra vez
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.85, 0.95, 0.98, 0.02, 0.05]) { await gps('M-01', t); await gps('M-02', 0.75); await sleep(100); }
  await sleep(600);
  b = new Database(DB, { readonly: true });
  const vueltas = b.prepare("SELECT startedAt, finishedAt FROM laps WHERE unitId = 'M-01' ORDER BY id").all();
  const desvioDespues = b.prepare("SELECT endedAt, cierre FROM deviations WHERE vehicleId = 'M-02'").get();
  b.close();
  servidor.kill('SIGTERM'); await servidor.salida; await sleep(200);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const repetidas = vueltas.length - new Set(vueltas.map(v => v.startedAt)).size;
  return { vueltas, repetidas, desvioAntes, desvioDespues, log, fotoDespues };
}

(async () => {
  console.log('\nCON LA MEMORIA CALIENTE');
  const a = await corrida('con', { retomar: true });
  ok('antes del reinicio, M-02 tenía un desvío abierto', !!a.desvio && a.desvio.endedAt === null, a.desvio);
  ok('con SIGTERM, el servidor guarda la foto y sale limpio', a.fin.code === 0 && a.foto && a.foto.motivo === 'SIGTERM', { fin: a.fin, foto: a.foto && a.foto.motivo });
  ok('al arrancar la retoma y lo dice', /Memoria caliente retomada .*2 unidad\(es\), 2 vuelta\(s\).*1 desvío\(s\)/.test(a.logArranque),
     a.logArranque.split('\n').filter(l => /Memoria/.test(l)));
  ok('el mapa muestra las dos combis antes de que manden nada', JSON.stringify(a.enElMapa) === '["M-01","M-02"]', a.enElMapa);
  ok('el desvío no se cerró como «cortado» al arrancar', !/desvío\(s\) quedaron abiertos/.test(a.logArranque));
  ok('la vuelta de M-01 se cierra ENTERA', a.vueltas.length === 1 && a.vueltas[0].parcial === 0, a.vueltas);
  ok('y con la hora de salida de antes del reinicio', a.vueltas.length === 1 && a.vueltas[0].startedAt < a.salidaAntes - 1000);
  ok('el desvío se cierra cuando vuelve: «regreso», no «corte»', a.desvioDespues && a.desvioDespues.cierre === 'regreso', a.desvioDespues);
  ok('nadie queda acusado de entrada tardía', a.tardias === 0, a.tardias);
  ok('el reinicio no aparece como corte de señal de la combi', a.huecosM01 === 0, a.huecosM01);

  console.log('\nUN CUELGUE SIN AVISO (SIGKILL): sirve la foto periódica');
  const k = await corrida('cuelgue', { retomar: true, senal: 'SIGKILL', extra: { MEMORIA_CADA_MS: '700' } });
  ok('no hubo tiempo de guardar al apagar: quedó la periódica', k.fin.sig === 'SIGKILL' && k.foto && k.foto.motivo === 'periodica', { fin: k.fin, foto: k.foto && k.foto.motivo });
  ok('y con ella la vuelta se cierra entera igual', k.vueltas.length === 1 && k.vueltas[0].parcial === 0, k.vueltas);
  ok('y el desvío vuelve por «regreso»', k.desvioDespues && k.desvioDespues.cierre === 'regreso', k.desvioDespues);

  console.log('\nLO QUE SE CERRÓ DESPUÉS DE LA ÚLTIMA FOTO NO SE RETOMA');
  const c = await corridaCierre();
  ok('la vuelta cerrada después de la foto no se duplica', c.repetidas === 0, c.vueltas);
  ok('el desvío cerrado después de la foto no se vuelve a cerrar', c.desvioAntes && c.desvioDespues &&
     c.desvioDespues.endedAt === c.desvioAntes.endedAt && c.desvioDespues.cierre === 'regreso', [c.desvioAntes, c.desvioDespues]);
  ok('y lo dice al arrancar', /ya estaban cerradas en la base: no se retoman/.test(c.log), c.log.split('\n').filter(l => /Memoria/.test(l)));
  ok('la foto se usa una sola vez', c.fotoDespues === undefined, c.fotoDespues);

  console.log('\nSIN MEMORIA (la foto demasiado vieja: como antes)');
  const s = await corrida('sin', { retomar: false });
  ok('la foto vieja no se retoma, y lo dice', /demasiado vieja para retomarla/.test(s.logArranque) && !/Memoria caliente retomada/.test(s.logArranque));
  ok('la vuelta entera se pierde', !s.vueltas.some(v => v.parcial === 0), s.vueltas);
  ok('y el desvío queda «cortado» al arrancar', s.desvioDespues && s.desvioDespues.cierre === 'corte', s.desvioDespues);

  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA PRUEBA SE CAYÓ:', e.stack); try { servidor && servidor.kill(); } catch {} process.exit(1); });
