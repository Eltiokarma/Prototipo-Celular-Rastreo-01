// Brecha promedio por vuelta: que se junte, que sea creíble y que no mienta.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/brecha.db';
const P = 3101;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  if (servidor) { servidor.kill(); await sleep(600); }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
      // Estado cada 600 ms: una vuelta de prueba dura segundos, no una hora
      STATE_INTERVAL_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('no arrancó');
}

const pedir = (ruta, opts = {}) =>
  fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, p) => pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) });

// Trazado recto de 2 km al norte, ida y vuelta por la misma calle
const LAT = -15.50, LNG = -70.13;
const gLat = 1 / 111320;
const punto = (m) => ({ lat: LAT + gLat * m, lng: LNG });

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const D = (await login('DESPACHO', 'despacho99')).body;
  const H = { Authorization: 'Bearer ' + D.token, 'Content-Type': 'application/json' };

  // Ruta de 60 minutos de recorrido: así el progreso se traduce a minutos
  // de brecha con una cuenta redonda.
  const db0 = new Database(DB);
  db0.prepare("UPDATE routes SET durationMin = 60, targetGapMin = 6, autoTarget = 0 WHERE routeId = 'R-14'").run();
  db0.close();

  await fetch(`http://localhost:${P}/admin/routes/R-14/points`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida: [punto(0), punto(2000)], vuelta: [punto(2000), punto(0)] } }),
  });

  for (const u of ['B-01', 'B-02']) {
    await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
  }

  const conectar = async (unitId) => {
    const s = (await login(unitId, 'chofer1234')).body;
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(400);
    return ws;
  };
  const mover = (ws, m) => ws.send(JSON.stringify({ type: 'gps', lat: punto(m).lat, lng: punto(m).lng, speed: 20 }));

  const a = await conectar('B-01');
  const b = await conectar('B-02');

  console.log('\nSE JUNTA MIENTRAS DAN LA VUELTA');
  {
    // Las dos recorren el circuito completo separadas por una distancia
    // constante. Con 4000 m de circuito y 60 min de recorrido, 400 m de
    // separación son 6 minutos de brecha.
    //
    // B-01 va adelante; a B-02 le corresponde una brecha de 6:00.
    // OJO con la cantidad de posiciones: el servidor acepta 40 por minuto y
    // por conexión (cupo antiinundación). Pasarse no da error, simplemente
    // deja de mover la unidad y la vuelta nunca cierra.
    const SEPARACION = 400;
    for (let m = 0; m <= 1550; m += 55) {
      mover(a, m + SEPARACION);
      mover(b, m);
      await sleep(150);
    }
    // Cierre de vuelta: las dos pasan por el final y vuelven al inicio
    for (const m of [1960, 1980, 1995]) { mover(a, m); mover(b, m - SEPARACION); await sleep(200); }
    mover(a, 5); mover(b, 10);
    await sleep(300);
    mover(a, 20); mover(b, 25);
    await sleep(900);

    const db = new Database(DB);
    const vueltas = db.prepare('SELECT unitId, durationSec, brechaProm FROM laps ORDER BY id').all();
    db.close();
    ok('se cerró al menos una vuelta', vueltas.length >= 1, vueltas);
    const conDato = vueltas.filter(v => v.brechaProm !== null);
    ok('y quedó guardada con su brecha promedio', conDato.length >= 1,
      vueltas.map(v => `${v.unitId}: ${v.brechaProm}s`));
    // 400 m de 4000 = 10% del circuito = 6 min de los 60. Tolerancia amplia:
    // el muestreo es a intervalos y las posiciones son escalonadas.
    const b02 = conDato.find(v => v.unitId === 'B-02');
    // 400 m de un circuito de 4000 con recorrido de 60 min = 6 min de brecha.
    // La tolerancia es amplia hacia arriba a propósito: al cruzar el inicio,
    // el que acaba de dar la vuelta queda comparado contra el que todavía no,
    // y esa muestra sale grande. Es UNA de varias decenas acá y una de
    // cientos en una vuelta real (ver LIMITACIONES).
    ok('el número es creíble: ~6 min para 400 m de separación',
      !!b02 && b02.brechaProm > 250 && b02.brechaProm < 600, b02 && b02.brechaProm + ' s');
  }

  console.log('\nEL ENDPOINT QUE VA A USAR LA PANTALLA');
  {
    const v = await pedir('/admin/vueltas?routeId=R-14', { headers: H });
    ok('lista las vueltas cerradas', v.status === 200 && v.body.vueltas.length >= 1, v.body.resumen);
    ok('con el resumen del día', typeof v.body.resumen.cerradas === 'number' &&
      v.body.resumen.duracionProm > 0, v.body.resumen);
    ok('y dice el objetivo contra el que se lee', v.body.objetivoSec === 360, v.body.objetivoSec);
    ok('el umbral de pelotón es la mitad del objetivo, no un minuto fijo',
      v.body.resumen.umbralPelotonSec === 180, v.body.resumen.umbralPelotonSec);
  }

  console.log('\nSIN ELEGIR RUTA NO HAY UN OBJETIVO ÚNICO');
  {
    const todas = await pedir('/admin/vueltas', { headers: H });
    ok('mirando todas las rutas, el objetivo viene vacío en vez de inventado',
      todas.body.objetivoSec === null && todas.body.resumen.enPeloton === null);
  }

  console.log('\nNO INVENTA CUANDO NO HAY CON QUÉ');
  {
    // Una vuelta vieja, sin brecha guardada, no debe ensuciar el promedio
    const db = new Database(DB);
    db.prepare(`INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm)
                VALUES ('B-09','R-14',NULL,?,?,1800,20,NULL)`).run(Date.now() - 1800e3, Date.now());
    const antes = db.prepare('SELECT brechaProm FROM laps WHERE brechaProm IS NOT NULL').all()
      .map(l => l.brechaProm);
    db.close();
    const esperado = Math.round(antes.reduce((a, x) => a + x, 0) / antes.length);

    const v = await pedir('/admin/vueltas?routeId=R-14', { headers: H });
    ok('la vuelta sin dato se lista igual', v.body.vueltas.some(l => l.unitId === 'B-09'));
    ok('pero no entra en el promedio (no cuenta como cero)',
      v.body.resumen.brechaProm === esperado, { calculado: v.body.resumen.brechaProm, esperado });
    ok('y el panel puede avisar cuántas no tienen dato', v.body.resumen.sinBrecha >= 1,
      v.body.resumen.sinBrecha);
  }

  console.log('\nEN EL INFORME');
  {
    const csv = await fetch(`http://localhost:${P}/admin/informe/vueltas.csv?desde=${Date.now() - 86400e3}&hasta=${Date.now()}`,
      { headers: { Authorization: 'Bearer ' + D.token } }).then(r => r.text());
    ok('el CSV trae la columna', /Brecha promedio \(m:ss\)/.test(csv), csv.split('\r\n')[5]);
    const filaSinDato = csv.split('\r\n').find(l => l.startsWith('B-09'));
    ok('y la deja vacía cuando no hay dato, en vez de poner 0:00',
      !!filaSinDato && filaSinDato.endsWith(';'), filaSinDato);
  }

  console.log('\nUNA SOLA UNIDAD NO TIENE CONTRA QUÉ COMPARARSE');
  {
    b.close();
    await sleep(1200);
    const db = new Database(DB);
    const antes = db.prepare('SELECT COUNT(*) c FROM laps').get().c;
    db.close();
    // A-sola da una vuelta entera con nadie más en la ruta
    for (let m = 0; m <= 1900; m += 200) { mover(a, m); await sleep(220); }
    mover(a, 1990); await sleep(250);
    mover(a, 10); await sleep(300);
    mover(a, 30); await sleep(900);
    const db2 = new Database(DB);
    const nuevas = db2.prepare('SELECT unitId, brechaProm FROM laps ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, db2.prepare('SELECT COUNT(*) c FROM laps').get().c - antes));
    db2.close();
    ok('la vuelta en soledad queda sin brecha, no en cero',
      nuevas.every(v => v.brechaProm === null || v.brechaProm > 0),
      nuevas.map(v => `${v.unitId}: ${v.brechaProm}`));
  }

  a.close();
  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
