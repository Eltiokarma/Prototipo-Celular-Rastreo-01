// Señal y presencia (TRUCOS-2026-09-10.md): lo que hasta ahora sólo estaba
// en el log, ahora se puede preguntar.
//
// Lo que se defiende: que cada corte de señal quede con dónde se cortó, dónde
// reapareció y cuánto duró; que se distinga el corte de red (las posiciones
// llegan después) del teléfono apagado (no llegan); que un salto imposible,
// el ausente en marcha y el reloj queden anotados; que los minutos ausente se
// sumen; que todo salga en el resumen del gerente y en dos CSV; y que NADA de
// esto avise ni acuse en vivo.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const fs = require('fs');

const S = __dirname;
const DB = S + '/huecos-test.db';
const P = 3165;
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
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400',
           // Plazos cortos: el barrido corre cada 10 s fijos; con 30 s / 3 min
           // de producción esta suite duraría diez minutos.
           SIN_SENAL_MS: '2000', OLVIDAR_MS: '15000', REANUDA_MS: '20000',
           AUSENTE_MARCHA_MS: '1500', ARRANQUE_GRACIA_MS: '0' },
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
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };
  const ses = {};
  for (const u of ['M-01', 'M-02', 'M-03']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const gps = (u, t, extra = {}, hace = 0) => { const q = anillo(t); return pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token },
    body: JSON.stringify({ posiciones: [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now() - hace, ...extra }] }),
  }); };
  const presencia = (u, estado) => pedir('/presencia', { method: 'POST',
    headers: { Authorization: 'Bearer ' + ses[u].token }, body: JSON.stringify({ estado }) });
  const huecos = async () => (await pedir('/admin/huecos?dias=1', { headers: HD })).body.huecos || [];
  const anomalias = async () => (await pedir('/admin/anomalias?dias=1', { headers: HD })).body.anomalias || [];
  const resumen = async () => (await pedir(`/gerencia/resumen?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`, { headers: HG })).body;

  // Un panel mirando, para comprobar que nada de esto avisa en vivo
  const ws = new WebSocket(`ws://localhost:${P}`);
  const avisos = [];
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type !== 'state') avisos.push(m.type); });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(500);

  console.log('\nEL CORTE DE SEÑAL QUEDA CON DÓNDE Y CUÁNTO');
  {
    // M-01 reporta en el punto 0,10 y se calla
    for (let i = 0; i < 3; i++) { await gps('M-01', 0.10); await sleep(300); }
    await sleep(11_000);   // un barrido con más de SIN_SENAL_MS (2 s)
    let h = await huecos();
    ok('al quedar sin señal se abre un hueco, con dónde se cortó',
       h.length === 1 && h[0].vehicleId === 'M-01' && h[0].endedAt === null && typeof h[0].latDesde === 'number', h[0]);
    ok('y con la presencia que tenía', h[0] && h[0].presencia === 'ruta', h[0] && h[0].presencia);
    // Reaparece 5 % del anillo más adelante (~280 m), fresca
    const t0 = Date.now();
    await gps('M-01', 0.15);
    await sleep(600);
    h = await huecos();
    ok('con la primera posición fresca se cierra: dónde reapareció y cuánto duró',
       h.length === 1 && h[0].cierre === 'volvio' && typeof h[0].latHasta === 'number' && h[0].durationSec >= 10, h[0]);
    ok('con los metros entre los dos puntos y la velocidad implícita',
       h[0].metros > 200 && h[0].metros < 400 && typeof h[0].kmh === 'number', { metros: h[0].metros, kmh: h[0].kmh });
    ok('y como no llegó ninguna posición DEL corte, «sin datos»', h[0].recuperadas === 0, h[0].recuperadas);
  }

  console.log('\nEL CORTE DE RED SE DISTINGUE: LAS POSICIONES LLEGAN DESPUÉS');
  {
    // M-02 reporta, se corta, y al volver manda la cola del corte (posiciones
    // con la hora real de cuando no había red) junto con la de ahora.
    for (let i = 0; i < 3; i++) { await gps('M-02', 0.30); await sleep(300); }
    await sleep(11_000);
    const ahora = Date.now();
    const cola = [9000, 7000, 5000, 3000].map(hace => { const q = anillo(0.30 + (9000 - hace) / 1_000_000);
      return { lat: q.lat, lng: q.lng, speed: 15, timestamp: ahora - hace }; });
    const q = anillo(0.31);
    await pedir('/gps', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-02'].token },
      body: JSON.stringify({ posiciones: [...cola, { lat: q.lat, lng: q.lng, speed: 15, timestamp: ahora }] }) });
    await sleep(600);
    const h = (await huecos()).find(x => x.vehicleId === 'M-02');
    ok('el hueco se cierra igual', !!h && h.cierre === 'volvio', h && h.cierre);
    ok('pero cuenta las posiciones del corte que llegaron después: fue la red, no el teléfono apagado',
       !!h && h.recuperadas === 4, h && h.recuperadas);
  }

  console.log('\nEL SALTO IMPOSIBLE');
  {
    // M-03 en el 0,05 y diez segundos «después» en el 0,55: la otra punta
    // del anillo, 1,8 km en 10 s = 650 km/h. Dos teléfonos, o un GPS que inventa.
    await gps('M-03', 0.05, {}, 10_000);
    await sleep(300);
    await gps('M-03', 0.55);
    await sleep(600);
    const a = (await anomalias()).filter(x => x.tipo === 'salto' && x.vehicleId === 'M-03');
    ok('queda anotado como salto, con la velocidad implícita', a.length === 1 && a[0].valor > 120, a[0]);
    // Otro salto enseguida no se anota de nuevo: uno por minuto
    await sleep(2500);
    await gps('M-03', 0.05);
    await sleep(600);
    ok('y un segundo salto en el mismo minuto no suma otra fila', (await anomalias()).filter(x => x.tipo === 'salto' && x.vehicleId === 'M-03').length === 1);
  }

  console.log('\nAUSENTE Y EN MARCHA SOBRE EL TRAZADO');
  {
    await presencia('M-01', 'ausente');
    await sleep(300);
    // Se mueve por el trazado a 20 km/h durante más de AUSENTE_MARCHA_MS (1,5 s)
    for (let i = 0; i < 6; i++) { await gps('M-01', 0.20 + i * 0.001); await sleep(400); }
    await sleep(500);
    const a = (await anomalias()).filter(x => x.tipo === 'ausente_en_marcha' && x.vehicleId === 'M-01');
    ok('queda anotado: ausente, moviéndose sobre el trazado', a.length === 1, a);
    await presencia('M-01', 'ruta');
    await sleep(300);
  }

  console.log('\nLOS MINUTOS AUSENTE SE SUMAN, Y NADA AVISÓ EN VIVO');
  {
    const r = await resumen();
    const u1 = (r.porUnidad || []).find(u => u.unitId === 'M-01');
    ok('el resumen del gerente trae señal y presencia por unidad', !!u1 && !!u1.senal, u1 && Object.keys(u1.senal || {}));
    ok('con los cortes de M-01 contados, todos sin datos (nunca mandó cola)', u1 && u1.senal.cortes >= 1 && u1.senal.sinDatos === u1.senal.cortes, u1 && u1.senal);
    ok('y su ausencia: una vez, unos segundos', u1 && u1.senal.ausencias === 1 && u1.senal.ausenteSec >= 2 && u1.senal.ausenteSec < 60, u1 && u1.senal);
    ok('y el ausente en marcha', u1 && u1.senal.ausenteEnMarcha === 1);
    const u2 = (r.porUnidad || []).find(u => u.unitId === 'M-02');
    ok('el de M-02 fue de red: al menos un corte con datos recuperados', u2 && u2.senal.cortes >= 1 && u2.senal.sinDatos < u2.senal.cortes, u2 && { senal: u2.senal, anomalias: (await anomalias()).filter(a => a.vehicleId === 'M-02') });
    const u3 = (r.porUnidad || []).find(u => u.unitId === 'M-03');
    ok('M-03 con su salto', u3 && u3.senal.saltos === 1, u3 && u3.senal);
    ok('y los totales de la cooperativa', r.totales.cortes >= 2 && r.totales.cortesSinDatos >= 1 && r.totales.saltos >= 1, r.totales);
    ok('el panel no recibió ningún aviso por nada de esto (sólo estados)', avisos.every(t => ['routes', 'route_geometry', 'chat_history', 'unit_joined', 'unit_left', 'gps_role'].includes(t)), [...new Set(avisos)]);
  }

  console.log('\nLOS DOS CSV');
  {
    const csv = await fetch(`${API}/admin/informe/senal.csv?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`, { headers: HD }).then(r => r.text());
    ok('senal.csv existe y trae los cortes', /Informe de senal/.test(csv) && /M-01;R-14;/.test(csv) && /Posiciones del corte que llegaron después/.test(csv), csv.split('\r\n')[5]);
    ok('con «volvió» y los metros', /volvió/.test(csv));
    const csv2 = await fetch(`${API}/admin/informe/anomalias.csv?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`, { headers: HD }).then(r => r.text());
    ok('anomalias.csv existe y dice qué es cada una', /salto imposible/.test(csv2) && /ausente y en marcha/.test(csv2), csv2.split('\r\n').slice(6, 8));
  }

  console.log('\nSALIR DE RUTA CIERRA EL HUECO, Y EL QUE NO VUELVE QUEDA SIN FIN');
  {
    // M-02 se calla y sale de ruta por HTTP mientras está sin señal
    await sleep(11_000);
    await presencia('M-02', 'fuera');
    await sleep(500);
    const h2 = (await huecos()).filter(x => x.vehicleId === 'M-02').sort((a, b) => b.startedAt - a.startedAt)[0];
    ok('el hueco abierto se cierra como «fuera»', !!h2 && h2.cierre === 'fuera', h2 && h2.cierre);
    // M-03 se calla y no vuelve: el olvido (15 s) y después REANUDA_MS (20 s)
    await sleep(25_000);
    const h3 = (await huecos()).filter(x => x.vehicleId === 'M-03').sort((a, b) => b.startedAt - a.startedAt)[0];
    ok('el que no volvió en el plazo queda «no volvió», sin fin ni duración',
       !!h3 && h3.cierre === 'no_volvio' && h3.endedAt === null && h3.durationSec === null, h3 && { cierre: h3.cierre, fin: h3.endedAt });
    const r = await resumen();
    const u3 = (r.porUnidad || []).find(u => u.unitId === 'M-03');
    ok('y el resumen lo cuenta como corte que no volvió', u3 && u3.senal.noVolvio === 1, u3 && u3.senal);
  }

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
