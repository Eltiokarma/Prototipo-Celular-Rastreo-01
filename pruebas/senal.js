// Qué pasa cuando una unidad deja de reportar.
//
// Esta suite existe por una medición: con la unidad de adelante borrada, la
// de atrás pasaba a medirse contra la que sigue, veía el doble de brecha y la
// pantalla le decía "apurá" hacia una combi que tenía justo adelante. Sin
// moverse un metro. Todo lo de acá defiende que eso no vuelva.
//
// Levanta su propio servidor con los plazos acortados: los de producción son
// 30 s y 3 min, y esperar eso haría una suite de cuatro minutos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/senal-test.db';
const P = 3151;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Acortados para la prueba. La proporción se mantiene: olvidar es bastante
// después de marcar sin señal.
const SIN_SENAL_MS = 2000;
const OLVIDAR_MS = 8000;

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
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '500',
           SIN_SENAL_MS: String(SIN_SENAL_MS), OLVIDAR_MS: String(OLVIDAR_MS) },
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

async function hasta(cond, ms = 12000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(150); }
  return false;
}

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

  // Tres en fila sobre el anillo: M-01 adelante, M-02 en el medio, M-03 atrás.
  const unidades = ['M-01', 'M-02', 'M-03'];
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  for (const u of unidades) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'clave1234' }) });
  }

  const cx = {};
  for (const u of unidades) {
    const s = await login(u, 'clave1234');
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    let ultimo = null;
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ultimo = m; });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(250);
    cx[u] = { ws, get estado() { return ultimo; } };
  }

  // 1/25 del anillo entre unidades ≈ el objetivo de 2 min sobre 50 de vuelta.
  const pos = { 'M-01': 0.120, 'M-02': 0.080, 'M-03': 0.040 };
  const reportar = u => { const q = anillo(pos[u]);
    cx[u].ws.send(JSON.stringify({ type: 'gps', lat: q.lat, lng: q.lng, speed: 25 })); };
  const brechaDe = u => cx[u].estado?.gaps?.[u] || {};
  const unidadEn = (quien, cual) => (cx[quien].estado?.units || []).find(x => x.unitId === cual);

  console.log('\nCON LAS TRES REPORTANDO');
  for (let i = 0; i < 4; i++) { unidades.forEach(reportar); await sleep(600); }
  await hasta(() => brechaDe('M-03').aheadUnit === 'M-02');
  const antes = brechaDe('M-03');
  ok('la de atrás se mide contra la del medio', antes.aheadUnit === 'M-02', antes);
  ok('y con un tiempo de verdad', /^\d{2}:\d{2}$/.test(antes.toAhead || ''), antes.toAhead);
  ok('nadie está marcado sin señal', cx['M-03'].estado.sinSenal === 0);

  console.log('\nA LA DEL MEDIO SE LE APAGA LA PANTALLA');
  // M-01 y M-03 siguen reportando; M-02 no. M-03 NO SE MUEVE.
  const seguirReportando = setInterval(() => { reportar('M-01'); reportar('M-03'); }, 500);
  ok('a los pocos segundos queda marcada sin señal',
     await hasta(() => unidadEn('M-03', 'M-02')?.sinSenal === true));

  const dur = brechaDe('M-03');
  ok('la de atrás SIGUE viéndola adelante y no salta a la siguiente',
     dur.aheadUnit === 'M-02', dur);
  ok('pero sin tiempo: no se mide contra una posición vieja',
     dur.toAhead === null, dur.toAhead);
  ok('y se dice por qué', dur.aheadSinSenal === true, dur);

  // Esto es exactamente lo que se midió y salió mal antes del cambio.
  ok('NO aparece una brecha del doble contra M-01',
     dur.aheadUnit !== 'M-01', dur.aheadUnit);
  ok('la unidad sigue en el mapa con su última posición',
     typeof unidadEn('M-03', 'M-02')?.lat === 'number');
  ok('y el panel puede contar cuántas están calladas',
     cx['M-03'].estado.sinSenal === 1, cx['M-03'].estado.sinSenal);
  ok('sin sacarla de las que están en ruta',
     cx['M-03'].estado.totalOnRoute === 3, cx['M-03'].estado.totalOnRoute);

  console.log('\nVUELVE LA SEÑAL');
  reportar('M-02');
  ok('se le saca la marca', await hasta(() => unidadEn('M-03', 'M-02')?.sinSenal === false));
  ok('y vuelve a haber tiempo contra ella',
     await hasta(() => /^\d{2}:\d{2}$/.test(brechaDe('M-03').toAhead || '')),
     brechaDe('M-03'));

  console.log('\nSI NO VUELVE, SE OLVIDA');
  ok('pasado el plazo largo, desaparece de verdad',
     await hasta(() => !unidadEn('M-03', 'M-02'), OLVIDAR_MS + 6000));
  const sola = brechaDe('M-03');
  ok('recién ahí la de atrás se mide contra la que sigue',
     sola.aheadUnit === 'M-01', sola);
  clearInterval(seguirReportando);

  console.log('\nEL FORMATO DE LA BRECHA');
  // "02:60" no es una hora, y era lo que salía cuando los segundos
  // redondeaban a 60. No se barre al azar: se apunta al borde. Con la vuelta
  // en 50 minutos, una diferencia de progreso de 0,059984 da 2,9992 min =
  // 179,95 s. Redondeado son 180 → "03:00". El código viejo partía primero
  // en minutos (2) y redondeaba los segundos aparte (60) → "02:60".
  //
  // Se manda de a una posición por segundo: el cupo del servidor es 40 GPS
  // por minuto y pasarse hace que descarte en silencio, con lo cual el
  // barrido no barre nada y la prueba pasa sin haber probado.
  const bordes = [
    [0.059984, '03:00'],   // 2,9992 min
    [0.039984, '02:00'],   // 1,9992 min
    [0.079984, '04:00'],   // 3,9992 min
  ];
  let malFormadas = 0, comprobados = 0;
  for (const [diff, esperado] of bordes) {
    pos['M-03'] = 0.120 - diff;
    reportar('M-01'); reportar('M-03');
    await sleep(1100);
    const t = brechaDe('M-03').toAhead;
    if (t && !/^\d{2}:[0-5]\d$/.test(t)) malFormadas++;
    if (t === esperado) comprobados++;
    ok(`una brecha de ${(diff * 50).toFixed(4)} min sale "${esperado}"`, t === esperado, t);
  }
  ok('ninguna brecha sale con segundos en 60', malFormadas === 0, malFormadas);
  ok('y los tres bordes se comprobaron de verdad', comprobados === 3, comprobados);

  Object.values(cx).forEach(c => c.ws.close());
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
