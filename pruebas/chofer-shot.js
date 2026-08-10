// Banco de pruebas visual de la app del chofer (Prototipo.html).
//
// Era la única pantalla sin banco: Despacho tiene `rediseno.js`, Gerencia
// tiene `gerencia-shot.js` y el creador tiene `creador-ui-run.js`, pero la
// pantalla que mira el chofer todo el día no la abría nadie. Un error de
// JavaScript ahí solo se veía arriba de la combi.
//
// Levanta el servidor con una ruta dibujada y otra unidad ya en camino,
// entra como chofer, le da GPS falso al navegador, y saca capturas de la
// pantalla en ruta y del chat. Cualquier error de la página queda listado
// al final y el proceso sale con 1.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/chofer.db';
const P = 3131;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALIDA = process.env.SALIDA || S + '/shots';

// El mismo anillo de ~900 m alrededor del centro de Juliaca que usa
// `rediseno.js`, para que las dos pantallas hablen de la misma geografía.
const LAT = -15.4904, LNG = -70.1333;
const g = 1 / 111320;
const anillo = (t) => {
  const v = t % 1, r = 900, ang = v * 2 * Math.PI;
  return { lat: LAT + g * r * Math.cos(ang), lng: LNG + g * r * Math.sin(ang) / Math.cos(LAT * Math.PI / 180) };
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      STATE_INTERVAL_MS: '400',
      // Cortos, para poder ver el "sin señal" sin esperar los 30 s de producción
      SIN_SENAL_MS: '3000', OLVIDAR_MS: '120000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, opts = {}) =>
  fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  fs.mkdirSync(SALIDA, { recursive: true });
  await arrancar();

  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const H = { Authorization: 'Bearer ' + D.token, 'Content-Type': 'application/json' };

  const db0 = new Database(DB);
  db0.prepare("UPDATE companies SET name = 'Señor de Huayllani' WHERE companyId = (SELECT companyId FROM routes WHERE routeId = 'R-14')").run();
  db0.prepare("UPDATE routes SET name = 'Cerro Colorado ⇄ Centro', durationMin = 50, targetGapMin = 2, autoTarget = 0 WHERE routeId = 'R-14'").run();
  // Los VEHÍCULOS primero — la misma lección que `rediseno.js` (3bis):
  // desde la fusión con Gerencia, el chofer-con-combi de una es del gerente
  // y el alta de Despacho devolvía 403 EN SILENCIO. Este banco quedó
  // esperando la pantalla de turno de un chofer que nunca existió.
  const empresaR14 = db0.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  const altaVehiculo = db0.prepare(
    'INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)');
  for (const u of ['M-08', 'M-12']) altaVehiculo.run(u, 'Placa ' + u, 'R-14', empresaR14, Date.now());
  db0.close();

  const ida = Array.from({ length: 40 }, (_, i) => anillo(i / 78));
  const vuelta = Array.from({ length: 40 }, (_, i) => anillo(0.5 + i / 78));
  await fetch(`http://localhost:${P}/admin/routes/R-14/points`, {
    method: 'PUT', headers: H, body: JSON.stringify({ tramos: { ida, vuelta } }),
  });

  for (const [u, nombre] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama']]) {
    const alta = await pedir('/admin/users', { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: nombre, vehicleId: u, password: 'chofer1234' }) });
    // Que un alta falle en silencio es exactamente lo que dejó a este banco
    // esperando un botón que nunca iba a aparecer. Que se caiga acá y diga.
    if (alta.status !== 200) throw new Error(`el alta de ${u} falló: HTTP ${alta.status} ${JSON.stringify(alta.body)}`);
  }

  // M-08 va adelante por WebSocket: así el chofer que miramos (M-12) tiene
  // contra quién medir la brecha y la pantalla no sale en blanco.
  const s8 = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'M-08', password: 'chofer1234' }) })).body;
  const ws8 = new WebSocket(`ws://localhost:${P}`);
  await new Promise(r => ws8.on('open', r));
  ws8.send(JSON.stringify({ type: 'identify', token: s8.token }));
  await sleep(300);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const fallos = [];
  // El chofer que miramos arranca detrás de M-08 y avanza sobre el anillo:
  // el GPS del navegador se mueve solo, como en la calle.
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 }, deviceScaleFactor: 2,
    permissions: ['geolocation'], geolocation: { latitude: anillo(0.06).lat, longitude: anillo(0.06).lng },
  });
  await interceptarHttps(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });

  await p.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: SALIDA + '/c0-puerta.png' });

  await p.fill('input[type="text"]', 'M-12');
  await p.fill('input[type="password"]', 'chofer1234');
  await p.click('button:has-text("INGRESAR")');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: SALIDA + '/c1-turno.png' });

  // La pantalla de inicio de turno tenía cableados un "V-247" y un horario
  // de maqueta: al chofer le aparecía una unidad que no era la suya. Esto
  // no deja que vuelva.
  const turno = await p.evaluate(() => document.body.innerText);
  if (!/M-12/.test(turno)) fallos.push('la pantalla de turno no muestra la unidad del que entró (M-12)');
  if (/V-247|13:00 — 21:00/.test(turno)) fallos.push('la pantalla de turno muestra datos de maqueta');
  if (!/ELMER CCAMA/i.test(turno)) fallos.push('la pantalla de turno no muestra el nombre del chofer');

  await p.click('button:has-text("SALIR A RUTA")');
  await p.waitForTimeout(2000);

  // Doce rondas: las dos unidades avanzan sobre el anillo y el servidor
  // acumula progreso, tramo y brecha.
  for (let ronda = 0; ronda < 12; ronda++) {
    const a = anillo(0.10 + ronda * 0.004);
    ws8.send(JSON.stringify({ type: 'gps', lat: a.lat, lng: a.lng, speed: 22 }));
    const b = anillo(0.06 + ronda * 0.004);
    await ctx.setGeolocation({ latitude: b.lat, longitude: b.lng });
    await sleep(700);
  }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SALIDA + '/c2-en-ruta.png' });

  // En ruta tiene que verse contra quién se mide: si la pantalla queda sin
  // brecha ni unidad de adelante, el chofer no tiene nada que hacer con ella.
  const enRuta = await p.evaluate(() => document.body.innerText);
  if (!/ADELANTE|ATRÁS/i.test(enRuta)) fallos.push('la pantalla en ruta no muestra adelante/atrás');
  if (!/M-08/.test(enRuta)) fallos.push('la pantalla en ruta no nombra a la unidad de adelante (M-08)');

  // Lo que más costó ver: con dos unidades en ruta, el que va último no
  // tiene a nadie atrás y el servidor manda null. La pantalla mostraba ahí
  // los valores de la maqueta —una unidad M-21 que no existe, un ±2 y un
  // tramo "Tumbes → Lambayeque"— con el mismo peso visual que el dato real.
  const maqueta = [
    [/M-21/, 'unidad M-21 de la maqueta'],
    [/Tumbes|Lambayeque/, 'tramo "Tumbes → Lambayeque" de la maqueta'],
    [/[+−-]2\s+\d+:\d\d/, 'brechas ±2 de la maqueta (el servidor solo manda ±1)'],
    // El GPS del navegador no informa velocidad, así que el servidor la
    // guarda en 0. Los 28 km/h son el valor de arranque de la maqueta: si
    // aparecen, volvió el `||` que los dejaba pasar.
    [/\b28\s*km\/h/, 'la velocidad 28 km/h de la maqueta con la unidad parada'],
  ];
  for (const [re, qué] of maqueta) {
    if (re.test(enRuta)) fallos.push('la pantalla en ruta muestra ' + qué);
  }
  if (!/sin nadie/i.test(enRuta)) fallos.push('el lado sin unidad no se marca como vacío');

  // Al de adelante se le apaga la pantalla. La combi sigue en la calle: la
  // pantalla tiene que decirlo, y sobre todo NO puede pasar a medirse contra
  // otro ni mandar a apurar.
  ws8.close();
  await p.waitForTimeout(9000);
  await p.screenshot({ path: SALIDA + '/c3-sin-senal.png' });
  const perdida = await p.evaluate(() => document.body.innerText);
  if (!/sin señal/i.test(perdida)) fallos.push('no avisa que la unidad de adelante perdió la señal');
  if (!/M-08/.test(perdida)) fallos.push('deja de nombrar a la unidad que se quedó sin señal');
  if (/Apurá|Aflojá/.test(perdida)) fallos.push('sigue dando instrucción de ritmo contra una posición vieja');
  if (/única unidad en ruta/i.test(perdida)) fallos.push('dice que está sola teniendo una unidad adelante');

  console.log('capturas en', SALIDA);
  console.log('errores de la página:', errores.length ? errores : 'ninguno');
  console.log('comprobaciones:', fallos.length ? fallos : 'todas en orden');
  await browser.close();
  ws8.close();
  if (servidor) servidor.kill();
  await sleep(400);
  process.exit(errores.length || fallos.length ? 1 : 0);
})().catch(e => {
  console.error('EL BANCO SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
