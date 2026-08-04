const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const API = 'http://localhost:3001';
const DB = process.env.DBFILE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

let H;
const objetivo = (body) => fetch(API + '/admin/routes/R-14/target', { method: 'POST', headers: H, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
const rutas = () => fetch(API + '/admin/routes', { headers: H }).then(r => r.json());

// Vueltas sintéticas: es la forma de tener historial sin manejar 10 horas
const db = new Database(DB);
// La vuelta se guarda contra la variante ACTIVA de la ruta: el promedio solo
// mira las que se midieron con el trazado que está midiendo hoy, así que una
// vuelta sin variante no cuenta para una ruta que tiene recorrido cargado.
const varianteDe = (routeId) => {
  const v = db.prepare('SELECT variantId FROM route_variants WHERE routeId = ? AND activa = 1').get(routeId);
  const hayPuntos = v && db.prepare('SELECT COUNT(*) c FROM route_points WHERE variantId = ?').get(v.variantId).c > 0;
  return hayPuntos ? v.variantId : null;
};
const meterVuelta = (unitId, minutos, cuandoMs, routeId = 'R-14') => {
  db.prepare('INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(unitId, routeId, varianteDe(routeId), cuandoMs - minutos * 60000, cuandoMs, minutos * 60, 25);
};

(async () => {
  // Punto de partida limpio: las otras suites recorren circuitos y dejan
  // vueltas reales registradas, y este mismo test deja el objetivo cambiado
  // al terminar. Sin esto, correrlo dos veces da resultados distintos.
  db.prepare("DELETE FROM laps WHERE routeId IN ('R-14','R-20')").run();
  db.prepare("UPDATE routes SET autoTarget = 0, targetGapMin = 2 WHERE routeId IN ('R-14','R-20')").run();

  const tk = (await login('DESPACHO', 'despacho99')).token;
  H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  // Sembrar choferes crea vehículos, y eso es de la gerencia desde la fusión
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const alta = (b) => fetch(API + '/admin/users', { method: 'POST', headers: HG, body: JSON.stringify(b) });
  // El servidor cachea el objetivo un minuto: este POST lo hace recalcular
  await objetivo({});
  for (const u of ['M-01', 'M-02', 'M-03', 'M-04']) {
    await alta({ unitId: u, name: 'Chofer ' + u, personRole: 'driver', password: 'clave1234' });
  }

  // 4 unidades en ruta
  const conexiones = [];
  for (const u of ['M-01', 'M-02', 'M-03', 'M-04']) {
    const s = await login(u, 'clave1234');
    const ws = new WebSocket('ws://localhost:3001');
    await new Promise(r => ws.on('open', r));
    const rec = { states: [] };
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') rec.states.push(m); });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(300);
    ws.send(JSON.stringify({ type: 'gps', lat: -15.49, lng: -70.12, speed: 25, routeProgress: 0.3 }));
    conexiones.push({ ws, rec });
  }
  await sleep(4000);
  const ultimo = () => conexiones[0].rec.states.at(-1);

  ok('1. Por defecto el objetivo es el manual', ultimo().targetGapMin === 2 && ultimo().objetivo.modo === 'manual',
     `${ultimo().targetGapMin} min · ${ultimo().objetivo.modo}`);

  // Prender el automático SIN historial: no debe inventar nada
  let r = await objetivo({ auto: true });
  await sleep(1200);
  ok('2. Automático sin vueltas: espera y usa el manual',
     ultimo().objetivo.modo === 'esperando' && ultimo().targetGapMin === 2,
     `${ultimo().targetGapMin} min · ${ultimo().objetivo.modo} · ${ultimo().objetivo.vueltas} vueltas`);

  // Dos vueltas: sigue siendo poco (el mínimo son 3)
  //
  // OJO con la hora: el objetivo agrupa las vueltas por día de la semana, así
  // que una vuelta "de hace una hora" corrida a las 00:30 cae en el día
  // anterior y el promedio del día se queda sin datos. Se recorta para que
  // nunca se salga de hoy.
  const inicioDeHoy = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const haceRato = (ms) => Math.max(inicioDeHoy + 60e3, Date.now() - ms);
  const hoy = Date.now();
  meterVuelta('M-01', 40, haceRato(3600e3));
  meterVuelta('M-02', 40, haceRato(3000e3));
  await objetivo({});                       // fuerza recálculo
  await sleep(1200);
  ok('3. Con 2 vueltas todavía no se confía', ultimo().objetivo.modo === 'esperando',
     `${ultimo().objetivo.vueltas} vueltas`);

  // Tres vueltas de 40 min con 4 unidades → 40/4 = 10 min
  meterVuelta('M-03', 40, haceRato(2400e3));
  await objetivo({});
  await sleep(1500);
  ok('4. Con 3 vueltas ya calcula: 40 min ÷ 4 unidades = 10',
     ultimo().objetivo.modo === 'auto' && ultimo().targetGapMin === 10,
     `${ultimo().targetGapMin} min · ${ultimo().objetivo.vueltas} vueltas · ${ultimo().objetivo.unidades} unidades · ${ultimo().objetivo.dia || 'promedio general'}`);

  // Se van dos unidades: el objetivo tiene que SUBIR (menos combis, más espacio)
  conexiones[3].ws.close();
  conexiones[2].ws.close();
  await sleep(2500);
  await objetivo({});
  await sleep(1500);
  ok('5. Con 2 unidades el objetivo sube a 20', ultimo().targetGapMin === 20,
     `${ultimo().targetGapMin} min · ${ultimo().objetivo.unidades} unidades`);

  // Vueltas de OTRO día de la semana no deben pesar si hoy ya tiene
  // suficientes. Se fijan al mediodía de hace 3 días para que ninguna se
  // corra al día de hoy (fue el error de la primera versión de este test).
  const mediodiaHace3Dias = (() => {
    const d = new Date(hoy - 3 * 86400e3);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  })();
  for (let i = 0; i < 10; i++) meterVuelta('M-01', 90, mediodiaHace3Dias + i * 60e3);
  await objetivo({});
  await sleep(1500);
  ok('6. Las vueltas de otro día no ensucian el de hoy',
     ultimo().targetGapMin === 20 && ultimo().objetivo.dia !== null,
     `${ultimo().targetGapMin} min · día: ${ultimo().objetivo.dia}`);

  // Una ruta con historial pero SIN vueltas hoy: cae al promedio general.
  // Es el caso que va a pasar de verdad todos los lunes a primera hora.
  // Las rutas las crea el nivel de arriba, no Despacho
  try {
    require('child_process').execFileSync('node',
      [RAIZ + '/server/empresa.js', 'ruta', 'R14', 'R-20', 'Ruta de prueba'],
      { env: { ...process.env, DB_FILE: DB }, stdio: 'ignore' });
  } catch { /* ya existía */ }
  await fetch(API + '/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'V-01', name: 'Chofer V-01', personRole: 'driver', routeId: 'R-20', password: 'clave1234' }) });
  for (let i = 0; i < 5; i++) {
    meterVuelta('V-01', 30, mediodiaHace3Dias + i * 60e3, 'R-20');
  }
  const s20 = await login('V-01', 'clave1234');
  const ws20 = new WebSocket('ws://localhost:3001');
  await new Promise(r => ws20.on('open', r));
  const rec20 = { states: [] };
  ws20.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') rec20.states.push(m); });
  ws20.send(JSON.stringify({ type: 'identify', token: s20.token }));
  await sleep(400);
  ws20.send(JSON.stringify({ type: 'gps', lat: -15.49, lng: -70.12, speed: 25, routeProgress: 0.3 }));
  await sleep(4000);
  await fetch(API + '/admin/routes/R-20/target', { method: 'POST', headers: H, body: JSON.stringify({ auto: true }) });
  await sleep(1500);
  const e20 = rec20.states.at(-1);
  ok('6b. Sin vueltas hoy cae al promedio general y lo dice',
     e20.objetivo.modo === 'auto' && e20.objetivo.dia === null && e20.targetGapMin === 30,
     `${e20.targetGapMin} min · día: ${e20.objetivo.dia} · ${e20.objetivo.vueltas} vueltas`);
  ws20.close();

  // El manual sigue siendo el respaldo y se puede fijar
  r = await objetivo({ auto: false, targetGapMin: 3.5 });
  await sleep(1200);
  ok('7. Apagar el automático devuelve el mando al manual',
     ultimo().objetivo.modo === 'manual' && ultimo().targetGapMin === 3.5,
     `${ultimo().targetGapMin} min`);

  r = await objetivo({ targetGapMin: 99 });
  ok('8. Rechaza un objetivo manual fuera de rango', r.status === 400, JSON.stringify(r.body));
  r = await objetivo({ targetGapMin: 0.2 });
  ok('9. Y uno demasiado chico', r.status === 400);

  // El listado de rutas lo informa
  const lista = await rutas();
  const ruta = lista.routes.find(x => x.routeId === 'R-14');
  ok('10. El panel puede leer el objetivo vigente y su modo',
     ruta.objetivo && ruta.objetivo.modo === 'manual' && ruta.objetivo.min === 3.5,
     JSON.stringify(ruta.objetivo));

  // Queda en la auditoría
  const aud = await fetch(API + '/admin/audit', { headers: H }).then(r => r.json());
  const ev = aud.events.filter(e => e.action === 'objetivo');
  ok('11. Cada cambio queda en la auditoría', ev.length >= 2, ev[0] && `${ev[0].actor}: ${ev[0].detail}`);

  conexiones.forEach(c => { try { c.ws.close(); } catch {} });
  process.exit(0);
})();
