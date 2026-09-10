// Los pasos 2 y 3 de TRUCOS-2026-09-10.md, contra el servidor de verdad:
// el GPS impreciso (T11), el GPS que inventa sin el flag (T2, segundo paso,
// server/farsa.js) y el contador de avisos de tráfico (T7).
//
// Lo que se defiende: que una posición con más de 100 m de error declarado
// entre al mapa pero NO juzgue desvío ni parada, y quede anotada una vez por
// episodio; que doce posiciones con la firma de un simulador dejen a la
// unidad «sospechosa» con su motivo, una anotación, y que el GPS de verdad
// la limpie; que un aviso de tráfico sin parada medida se cuente aparte del
// que sí la tuvo; y que un APK viejo (sin `precision`) siga como siempre.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const fs = require('fs');

const S = __dirname;
const DB = S + '/trucos-test.db';
const P = 3166;
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
// Determinista, para que la suite sea la misma cada vez
let semilla = 11;
const azar = () => { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; };

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400', ARRANQUE_GRACIA_MS: '0',
           // La parada en segundos, como en la suite `trafico`
           PARADA_MS: '3000', PARADA_LIBRE_MS: '1500', TRAFICO_GRACIA_MS: '1500' },
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
  for (const u of ['M-01', 'M-02', 'M-03', 'M-04', 'M-05']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
    ses[u] = await login(u, 'chofer1234');
  }
  const mandar = (u, posiciones) => pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ses[u].token }, body: JSON.stringify({ posiciones }),
  });
  const gps = (u, t, extra = {}) => { const q = anillo(t); return mandar(u, [{ lat: q.lat, lng: q.lng, speed: 20, timestamp: Date.now(), ...extra }]); };
  const anomalias = async () => (await pedir('/admin/anomalias?dias=1', { headers: HD })).body.anomalias || [];
  const paradas = async () => (await pedir('/admin/paradas?dias=1', { headers: HD })).body.paradas || [];
  const resumen = async () => (await pedir(`/gerencia/resumen?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`, { headers: HG })).body;

  // Un panel mirando el estado
  let estado = null;
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(500);
  const vista = (u) => (estado?.units || []).find(x => x.unitId === u);

  console.log('\nEL GPS IMPRECISO ENTRA AL MAPA PERO NO SE JUZGA');
  {
    await gps('M-01', 0.10, { precision: 8 });
    await sleep(600);
    ok('con 8 m de error, nada que decir', vista('M-01')?.gpsImpreciso === false && vista('M-01')?.precisionM === 8, vista('M-01'));
    await gps('M-01', 0.101, { precision: 250 });
    await sleep(600);
    ok('con 250 m, la unidad sigue en el mapa, marcada', !!vista('M-01') && vista('M-01').gpsImpreciso === true && vista('M-01').precisionM === 250, vista('M-01'));
    await gps('M-01', 0.102, { precision: 300 });
    await sleep(600);
    const a = (await anomalias()).filter(x => x.tipo === 'gps_impreciso' && x.vehicleId === 'M-01');
    ok('y queda anotado UNA vez por episodio, con los metros', a.length === 1 && a[0].valor === 250, a);
    // Histéresis: 70 m no alcanza para salir (el 60 % de 100), 50 m sí
    await gps('M-01', 0.1025, { precision: 70 });
    await sleep(600);
    ok('a 70 m sigue impreciso (histéresis: sale recién por debajo de 60)', vista('M-01')?.gpsImpreciso === true, vista('M-01')?.gpsImpreciso);
    await gps('M-01', 0.103, { precision: 6 });
    await sleep(600);
    ok('con el GPS bueno otra vez, la marca se va', vista('M-01')?.gpsImpreciso === false, vista('M-01')?.gpsImpreciso);
    // Y el que oscila 95/110 no escribe una fila por posición: una por minuto
    for (let i = 0; i < 6; i++) { await gps('M-01', 0.1031 + i * 0.0001, { precision: i % 2 ? 110 : 95 }); await sleep(150); }
    await sleep(500);
    const a2 = (await anomalias()).filter(x => x.tipo === 'gps_impreciso' && x.vehicleId === 'M-01');
    ok('oscilando en 95/110 m no se anota una fila por posición (una por minuto)', a2.length === 1, a2.length);
    ok('y la unidad dice el chofer aunque nunca abrió el WebSocket', vista('M-01')?.driverName === 'Chofer M-01', vista('M-01')?.driverName);
  }
  {
    // Doce posiciones a 600 m del trazado con 400 m de error: con eso no se
    // sabe si se salió. El desvío exige 10 seguidas; acá hay 12 y no cuenta.
    const afuera = { lat: LAT0 + gr * 1500, lng: LNG0 };
    for (let i = 0; i < 12; i++) { await mandar('M-01', [{ lat: afuera.lat + gr * i, lng: afuera.lng, speed: 20, timestamp: Date.now(), precision: 400 }]); await sleep(150); }
    await sleep(600);
    ok('doce posiciones lejos del trazado con 400 m de error: NO es salida de ruta', vista('M-01')?.fueraDeRuta === false, vista('M-01') && { fuera: vista('M-01').fueraDeRuta, desvioM: vista('M-01').desvioM });
    // Las mismas con 10 m de error sí lo son
    for (let i = 0; i < 12; i++) { await mandar('M-01', [{ lat: afuera.lat + gr * (12 + i), lng: afuera.lng, speed: 20, timestamp: Date.now(), precision: 10 }]); await sleep(150); }
    await sleep(600);
    ok('las mismas doce con 10 m de error: salida de ruta, como siempre', vista('M-01')?.fueraDeRuta === true, vista('M-01') && vista('M-01').fueraDeRuta);
    // Se declara ausente mientras el GPS sigue impreciso: el episodio se
    // cierra igual (la revisión del 10/9, L4: antes el atajo de la
    // imprecisión se tomaba antes de mirar si estaba en la cadena, y el
    // desvío quedaba abierto y emitido hasta el olvido).
    await pedir('/presencia', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-01'].token }, body: JSON.stringify({ estado: 'ausente' }) });
    await sleep(200);
    await mandar('M-01', [{ lat: afuera.lat + gr * 30, lng: afuera.lng, speed: 20, timestamp: Date.now(), precision: 400 }]);
    await sleep(600);
    ok('ausente con el GPS impreciso: la salida de ruta se cierra igual', vista('M-01')?.fueraDeRuta === false && vista('M-01')?.presencia === 'ausente', vista('M-01') && { fuera: vista('M-01').fueraDeRuta, presencia: vista('M-01').presencia });
    await pedir('/presencia', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-01'].token }, body: JSON.stringify({ estado: 'ruta' }) });
    await sleep(200);
  }
  {
    // M-05 quieta a mitad del tramo con 500 m de error durante más de PARADA_MS (3 s)
    for (let i = 0; i < 10; i++) { await gps('M-05', 0.20, { precision: 500 }); await sleep(400); }
    await sleep(600);
    ok('quieta 4 s con 500 m de error: no es parada (no se sabe si está quieta)', vista('M-05')?.parado === false, vista('M-05') && vista('M-05').parado);
    for (let i = 0; i < 12; i++) { await gps('M-05', 0.20, { precision: 10 }); await sleep(400); }
    await sleep(600);
    ok('quieta 5 s con 10 m: parada, como siempre', vista('M-05')?.parado === true, vista('M-05'));
  }
  {
    // El APK viejo no manda `precision`: se lo trata como siempre
    await gps('M-02', 0.40);
    await sleep(600);
    ok('sin `precision` (APK viejo), null y sin marca', vista('M-02')?.precisionM === null && vista('M-02')?.gpsImpreciso === false, vista('M-02'));
    ok('y un valor absurdo se ignora', (await mandar('M-02', [{ ...anillo(0.401), speed: 20, timestamp: Date.now(), precision: 'mucha' }])).status === 200);
    await sleep(500);
    ok('  (queda null)', vista('M-02')?.precisionM === null, vista('M-02')?.precisionM);
  }

  console.log('\nEL GPS QUE INVENTA SIN EL FLAG: LA FIRMA DEL SIMULADOR');
  {
    // M-03 manda la cola de un «corte»: catorce posiciones cada 5 s, a paso
    // exacto sobre el anillo (que ES el trazado), a 22 km/h clavados. La
    // cola termina hace 70 s: lo que viene después tiene que ser más nuevo
    // (el filtro «ya vistas») y no puede ser del futuro.
    const ahora = Date.now() - 70_000;
    const n = 14;
    const cola = Array.from({ length: n }, (_, i) => ({
      ...anillo(0.05 + i * 0.0053), speed: 22, timestamp: ahora - (n - 1 - i) * 5_000, precision: 5,
    }));
    const r = await mandar('M-03', cola);
    ok('las catorce entran', r.status === 200 && r.body.aceptadas === n, r.body);
    await sleep(700);
    ok('la unidad queda SOSPECHOSA, con su motivo', typeof vista('M-03')?.gpsSospechoso === 'string', vista('M-03')?.gpsSospechoso);
    const a = (await anomalias()).filter(x => x.tipo === 'gps_sospechoso' && x.vehicleId === 'M-03');
    ok('anotada una vez, y dice por qué', a.length === 1 && /velocidad|trazado/.test(a[0].detalle || ''), a);
    const act = (await fetch(`${API}/admin/audit`, { headers: HD }).then(r => r.json())).events || [];
    ok('y en la auditoría', act.some(e => e.action === 'gps_sospechoso' && e.target === 'M-03'));
    ok('sigue en el mapa: se marca, no se esconde', !!vista('M-03') && typeof vista('M-03').lat === 'number');
    // Vuelve el GPS de verdad: frena en cada esquina, zigzaguea 15 m, la
    // velocidad reportada acompaña
    const ahora2 = Date.now();
    let t = 0.05 + n * 0.0053;
    const reales = [];
    for (let i = 0; i < n; i++) {
      const v = 2 + (i % 4) * 2.3 + azar();            // m/s
      t += v * 5 / 5655;                                // el anillo mide 5655 m
      const q = anillo(t);
      reales.push({ lat: q.lat + gr * (azar() * 30 - 15), lng: q.lng + gr * (azar() * 30 - 15),
                    speed: Math.round(v * 3.6), timestamp: ahora2 - (n - 1 - i) * 5_000, precision: 12 });
    }
    await mandar('M-03', reales);
    await sleep(700);
    ok('con catorce posiciones de verdad, la sospecha se va', vista('M-03')?.gpsSospechoso === null, vista('M-03')?.gpsSospechoso);
    ok('y no se anotó otra', (await anomalias()).filter(x => x.tipo === 'gps_sospechoso' && x.vehicleId === 'M-03').length === 1);
  }
  {
    // La combi de verdad desde el principio nunca queda sospechosa
    const ahora = Date.now();
    let t = 0.60;
    const reales = [];
    for (let i = 0; i < 14; i++) {
      const v = 2 + (i % 4) * 2.3 + azar();
      t += v * 10 / 5655;
      const q = anillo(t);
      reales.push({ lat: q.lat + gr * (azar() * 30 - 15), lng: q.lng + gr * (azar() * 30 - 15),
                    speed: Math.round(v * 3.6), timestamp: ahora - (13 - i) * 10_000 });
    }
    await mandar('M-04', reales);
    await sleep(700);
    ok('la combi de verdad, sin precision (APK viejo), no es sospechosa', vista('M-04')?.gpsSospechoso === null, vista('M-04')?.gpsSospechoso);
  }

  console.log('\nEL AVISO DE TRÁFICO SIN PARADA SE CUENTA APARTE');
  {
    // M-02 anda (arranca 220 m más adelante de donde estaba hace rato, y
    // sigue a 57 m por posición) y avisa tráfico igual
    for (let i = 0; i < 5; i++) { await gps('M-02', 0.44 + i * 0.01); await sleep(300); }
    await sleep(500);
    ok('M-02 anda: no está parada', vista('M-02')?.parado === false, vista('M-02') && vista('M-02').parado);
    const r = await pedir('/trafico', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-02'].token }, body: JSON.stringify({ activo: true }) });
    ok('el aviso entra', r.status === 200, r.body);
    await sleep(400);
    let p = (await paradas()).filter(x => x.vehicleId === 'M-02');
    ok('queda el episodio: confirmado por el chofer, NO medido', p.length === 1 && p[0].confirmado === 1 && p[0].medida === 0, p);
    // M-05 ya está parada de verdad (medida): avisa tráfico
    const r2 = await pedir('/trafico', { method: 'POST', headers: { Authorization: 'Bearer ' + ses['M-05'].token }, body: JSON.stringify({ activo: true }) });
    ok('la que está parada de verdad avisa', r2.status === 200);
    await sleep(400);
    p = (await paradas()).filter(x => x.vehicleId === 'M-05');
    ok('su episodio queda confirmado Y medido', p.length === 1 && p[0].confirmado === 1 && p[0].medida === 1, p[0]);
    const res = await resumen();
    const u2 = (res.porUnidad || []).find(u => u.unitId === 'M-02');
    const u5 = (res.porUnidad || []).find(u => u.unitId === 'M-05');
    ok('el resumen cuenta el aviso sin parada de M-02', u2 && u2.senal.avisosTrafico === 1 && u2.senal.avisosSinParada === 1, u2 && u2.senal);
    ok('y el aviso con parada de M-05', u5 && u5.senal.avisosTrafico === 1 && u5.senal.avisosSinParada === 0, u5 && u5.senal);
    const u1 = (res.porUnidad || []).find(u => u.unitId === 'M-01');
    const u3 = (res.porUnidad || []).find(u => u.unitId === 'M-03');
    // M-01 tuvo dos episodios imprecisos en el mismo minuto (250 m y después
    // las doce de 400 m): se anota UNO por minuto. M-05, uno.
    ok('el GPS impreciso de M-01 (uno por minuto) y el sospechoso de M-03', u1 && u1.senal.gpsImpreciso === 1 && u3 && u3.senal.gpsSospechoso === 1, { u1: u1 && u1.senal, u3: u3 && u3.senal });
    ok('con los totales', res.totales.avisosTrafico === 2 && res.totales.avisosSinParada === 1 && res.totales.gpsSospechoso === 1 && res.totales.gpsImpreciso === 2, res.totales);
    const csv = await fetch(`${API}/admin/informe/anomalias.csv?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`, { headers: HD }).then(r => r.text());
    ok('anomalias.csv dice qué son las dos nuevas', /GPS sospechoso/.test(csv) && /GPS impreciso/.test(csv));
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  try { ws.close(); } catch {}
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); try { servidor && servidor.kill(); } catch {} process.exit(1); });
