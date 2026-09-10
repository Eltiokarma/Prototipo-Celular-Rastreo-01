// Lo que falseaba la medición (REVISION-2026-09-10.md, tanda 3: L3, L6, L9,
// L10, L13, E7).
//
// Lo que se defiende: que redibujar el trazado con el que se mide descarte
// lo que se venía midiendo (igual que cambiar de variante); que del vecino
// sin señal no se afirme «está en tráfico»; que el corte que empieza al
// cerrarse el WebSocket quede en `huecos`; que la parada que se corta por el
// olvido se cierre con la hora de la última posición y no tres minutos
// después; que el ausente que empezó antes del rango cuente, y el que se
// murió ausente deje de contar; y que las salidas silenciadas o cerradas por
// cambio de trazado no se le cuenten al chofer como salidas.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/medicion-test.db';
const P = 3168;
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
           // «Sin señal» a los 2 s y olvido a los 25: con el barrido cada 10 s,
           // hace falta que un tick caiga entre los dos para ver el gris.
           SIN_SENAL_MS: '2000', OLVIDAR_MS: '25000',
           PARADA_MS: '3000', PARADA_LIBRE_MS: '1500', TRAFICO_GRACIA_MS: '1500' },
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
  const trazado = () => pedir('/admin/routes/R-14/points', { method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }) });
  await trazado();
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };
  const ses = {};
  for (const u of ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-07']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const mandar = (u, posiciones) => pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token }, body: JSON.stringify({ posiciones }),
  });
  const gps = (u, t) => { const q = anillo(t); return mandar(u, [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now() }]); };
  const presencia = (u, estado) => pedir('/presencia', { method: 'POST',
    headers: { Authorization: 'Bearer ' + ses[u].token }, body: JSON.stringify({ estado }) });
  const resumen = async (desde, hasta) => (await pedir(`/gerencia/resumen?desde=${desde}&hasta=${hasta}`, { headers: HG })).body;
  const huecos = async () => (await pedir('/admin/huecos?dias=1', { headers: HD })).body.huecos || [];
  const paradas = async () => (await pedir('/admin/paradas?dias=1', { headers: HD })).body.paradas || [];
  const bd = () => new Database(DB, { readonly: true });

  let estado = null;
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(500);
  const vista = (u) => (estado?.units || []).find(x => x.unitId === u);
  const brecha = (u) => (estado?.gaps || {})[u] || null;

  console.log('\nREDIBUJAR EL TRAZADO ACTIVO DESCARTA LO QUE SE VENÍA MIDIENDO');
  {
    // M-01 se sale del recorrido (12 posiciones a 600 m): salida abierta
    const afuera = { lat: LAT0 + gr * 1500, lng: LNG0 };
    await gps('M-01', 0.10);
    for (let i = 0; i < 12; i++) { await mandar('M-01', [{ lat: afuera.lat + gr * i, lng: afuera.lng, speed: 20, timestamp: Date.now() }]); await sleep(120); }
    await sleep(600);
    ok('(salida de ruta abierta)', vista('M-01')?.fueraDeRuta === true, vista('M-01') && vista('M-01').fueraDeRuta);
    // Despacho redibuja el trazado de la variante ACTIVA (el mismo, guardado de nuevo)
    await trazado();
    await sleep(700);
    const fila = bd().prepare("SELECT cierre, endedAt FROM deviations WHERE vehicleId = 'M-01' ORDER BY id DESC LIMIT 1").get();
    ok('el episodio de desvío se cierra como «trazado», como al cambiar de variante', !!fila && fila.cierre === 'trazado' && fila.endedAt !== null, fila);
    ok('y la unidad ya no está «fuera de ruta» contra el trazado viejo', vista('M-01')?.fueraDeRuta === false, vista('M-01') && vista('M-01').fueraDeRuta);
    ok('el servidor lo dice', /trazado redibujado/.test(salida) || /Ruta R-14/.test(salida));
  }

  console.log('\nDEL VECINO SIN SEÑAL NO SE AFIRMA «EN TRÁFICO»');
  {
    // M-02 adelante, parada 4 s a mitad del tramo; M-03 atrás, andando
    for (let i = 0; i < 10; i++) { await gps('M-02', 0.30); await gps('M-03', 0.25 + i * 0.001); await sleep(400); }
    await sleep(600);
    ok('(la de adelante está parada)', vista('M-02')?.parado === true, vista('M-02') && vista('M-02').parado);
    ok('la de atrás la ve en tráfico', brecha('M-03')?.aheadEnTrafico === true && brecha('M-03')?.aheadUnit === 'M-02', brecha('M-03'));
    // M-02 se calla más de SIN_SENAL_MS (2 s); M-03 sigue mandando; el barrido (10 s) la marca
    for (let i = 0; i < 28; i++) { await gps('M-03', 0.26 + i * 0.0005); await sleep(400); }
    ok('(la de adelante quedó sin señal)', vista('M-02')?.sinSenal === true, vista('M-02') && vista('M-02').sinSenal);
    ok('y la de atrás ya NO la ve en tráfico: su «parado» es de hace rato', brecha('M-03')?.aheadEnTrafico === false && brecha('M-03')?.aheadSinSenal === true, brecha('M-03'));
  }

  console.log('\nEL CORTE QUE EMPIEZA AL CERRARSE EL WEBSOCKET QUEDA EN «HUECOS»');
  {
    // M-04 manda por el socket (como la web del chofer), se queda callada y cierra
    const ws4 = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws4.on('open', r));
    ws4.on('message', () => {});
    ws4.send(JSON.stringify({ type: 'identify', token: ses['M-04'].token }));
    await sleep(400);
    const q = anillo(0.40);
    ws4.send(JSON.stringify({ type: 'gps', lat: q.lat, lng: q.lng, speed: 20 }));
    await sleep(2600);   // más que SIN_SENAL_MS sin mandar nada
    ws4.close();
    await sleep(600);
    const h = (await huecos()).find(x => x.vehicleId === 'M-04');
    ok('al cerrarse el socket con la última posición vieja, la unidad queda gris', vista('M-04')?.sinSenal === true, vista('M-04') && vista('M-04').sinSenal);
    ok('y el hueco se abre (antes el barrido no lo abría porque ya estaba marcada)', !!h && h.endedAt === null, h);
  }

  console.log('\nLA PARADA QUE SE CORTA POR EL OLVIDO SE CIERRA CON LA ÚLTIMA POSICIÓN');
  {
    for (let i = 0; i < 11; i++) { await gps('M-05', 0.20); await sleep(400); }
    await sleep(500);
    ok('(parada)', vista('M-05')?.parado === true, vista('M-05') && vista('M-05').parado);
    const ultima = Date.now();
    // M-07 se declara ausente y también se muere (se comprueba más abajo)
    await gps('M-07', 0.60);
    await presencia('M-07', 'ausente');
    await sleep(300);
    await gps('M-07', 0.601);
    // Se callan: olvido a los 25 s, barrido cada 10 s
    await sleep(36_500);
    const p = (await paradas()).find(x => x.vehicleId === 'M-05');
    ok('la parada quedó cerrada por corte', !!p && p.cierre === 'corte', p && p.cierre);
    ok('con el fin en la última posición, no en la hora del barrido', !!p && Math.abs(p.endedAt - ultima) < 2500, p && { endedAt: p.endedAt - ultima, durationSec: p.durationSec });
  }

  console.log('\nEL AUSENTE QUE EMPEZÓ ANTES DEL RANGO CUENTA, Y EL QUE SE MURIÓ DEJA DE CONTAR');
  {
    const ahora = Date.now();
    const w = new Database(DB);
    w.prepare(`INSERT INTO presencia_log (vehicleId, routeId, companyId, estado, cuando) VALUES ('M-06', 'R-14', NULL, 'ausente', ?)`).run(ahora - 3 * H);
    w.prepare(`INSERT INTO presencia_log (vehicleId, routeId, companyId, estado, cuando) VALUES ('M-06', 'R-14', NULL, 'ruta', ?)`).run(ahora - 1 * H);
    w.close();
    const r = await resumen(ahora - 2 * H, ahora);
    const u6 = (r.porUnidad || []).find(u => u.unitId === 'M-06');
    ok('ausente de hace 3 h a hace 1 h, rango de hace 2 h a ahora: 1 h ausente', !!u6 && u6.senal.ausencias === 1 && Math.abs(u6.senal.ausenteSec - 3600) <= 5, u6 && u6.senal);
    // M-07 se declaró ausente y se murió (arriba, mientras esperábamos el olvido)
    const filas = bd().prepare("SELECT estado FROM presencia_log WHERE vehicleId = 'M-07' ORDER BY id").all().map(f => f.estado);
    ok('al olvidarla queda «olvido» en el registro de presencia', filas.includes('ausente') && filas[filas.length - 1] === 'olvido', filas);
    const r2 = await resumen(Date.now() - H, Date.now() + H);
    const u7 = (r2.porUnidad || []).find(u => u.unitId === 'M-07');
    ok('y su ausencia dura lo que duró, no hasta el fin del rango', !!u7 && u7.senal.ausencias === 1 && u7.senal.ausenteSec < 30, u7 && u7.senal);
  }

  console.log('\nLAS SALIDAS SILENCIADAS O POR CAMBIO DE TRAZADO NO SE CUENTAN COMO SALIDAS');
  {
    const ahora = Date.now();
    const w = new Database(DB);
    const ins = w.prepare(`INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre) VALUES ('M-08', 'R-14', ?, ?, 120, 400, 300, ?, ?)`);
    ins.run(ahora - 50 * 60_000, ahora - 48 * 60_000, 0, 'regreso');
    ins.run(ahora - 40 * 60_000, ahora - 38 * 60_000, 1, 'regreso');
    ins.run(ahora - 30 * 60_000, ahora - 28 * 60_000, 0, 'trazado');
    w.close();
    const r = await resumen(ahora - H, ahora);
    const u8 = (r.porUnidad || []).find(u => u.unitId === 'M-08');
    ok('una salida real, y dos aparte (silenciada, por trazado)', !!u8 && u8.desvios === 1 && u8.desviosAparte === 2 && u8.desvioSec === 120, u8 && { desvios: u8.desvios, aparte: u8.desviosAparte, sec: u8.desvioSec });
    ok('y los totales igual', r.totales.desviosAparte >= 2 && r.totales.desvios >= 1, { desvios: r.totales.desvios, aparte: r.totales.desviosAparte });
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  try { ws.close(); } catch {}
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); try { servidor && servidor.kill(); } catch {} process.exit(1); });
