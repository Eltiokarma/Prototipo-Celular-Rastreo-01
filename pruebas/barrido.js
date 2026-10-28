// El barrido completo del 22/9, contra el servidor de verdad.
//
// Una sección por hallazgo del servidor que se arregló: cada una prueba el
// caso que fallaba, tal como lo describió la revisión. Las del panel y de las
// apps se prueban por lectura en `nativas` y por pantalla en las suites
// visuales; ésta es la del servidor.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const fs = require('fs');

const DB = S + '/barrido-test.db';
const P = 3202;
const API = `http://localhost:${P}`;
const CLAVE_CREADOR = 'creador-de-prueba-larga';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// El mismo anillo que las suites de medición: ~5,7 km de circuito.
const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
let log = '';
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           MODO: 'demo', CREATOR_PASSWORD: CLAVE_CREADOR, STATE_INTERVAL_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, token, opciones = {}) => fetch(API + ruta, {
  ...opciones,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, p) => pedir('/auth/login', null, { method: 'POST', body: JSON.stringify({ user: u, password: p }) })
  .then(r => r.body);
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });

const conectar = (token) => new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${P}`);
  const visto = [];
  ws.on('message', raw => { try { visto.push(JSON.parse(raw)); } catch {} });
  ws.on('open', () => {
    if (token) ws.send(JSON.stringify({ type: 'identify', token }));
    setTimeout(() => res({ ws, visto }), 400);
  });
});

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const d = await login('DESPACHO', 'despacho99');
  const H = d.token;
  const HG = await require('./gerente.js')(API, DB);
  const base = new Database(DB);
  const empresa = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;

  // El trazado de R-14: el anillo como ida, y el circuito es ese tramo.
  await pedir('/admin/routes/R-14/points', H, { method: 'PUT',
    body: JSON.stringify({ tramos: { ida: Array.from({ length: 48 }, (_, i) => anillo(i / 48)), vuelta: [] } }) });

  // Una segunda cooperativa con una combi, y una segunda ruta en la primera
  const otra = coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9',
    despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  base.prepare("INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES ('M-50', NULL, 'R-9', 'OTRA', ?)").run(Date.now());
  coop.altaRuta(base, { companyId: empresa, routeId: 'R-20', name: 'Ruta 20' });
  base.prepare("INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES ('V-20', NULL, 'R-20', ?, ?)").run(empresa, Date.now());
  for (const v of ['M-01', 'M-03', 'M-04', 'M-05']) {
    base.prepare('INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, NULL, ?, ?, ?)').run(v, 'R-14', empresa, Date.now());
  }
  ok('la segunda cooperativa existe', otra.ok === true, otra);
  const tramposa = coop.alta(base, { companyId: '__plataforma__', name: 'Tramposa', ruta: 'R-99',
    despacho: 'DESPACHO-9', clave: 'clavelarga9' });
  ok('una cooperativa no puede llamarse como el casillero de la plataforma', !!tramposa.error, tramposa);

  console.log('\nEL ALTA NO SUBE A NADIE A UNA COMBI AJENA');
  {
    // Sin vehicleId, el chofer va a la combi de su mismo código. Si esa combi
    // es de OTRA cooperativa, antes quedaba subido a ella.
    const r = await post('/admin/users', H, { unitId: 'M-50', name: 'Intruso', password: 'clave1234' });
    ok('una combi de otra cooperativa con el código del usuario: 400, como inexistente', r.status === 400, r);
    ok('y no se creó la cuenta', !base.prepare("SELECT 1 FROM users WHERE unitId = 'M-50'").get());
  }

  console.log('\nLA PERSONA VA A LA RUTA DE SU COMBI');
  {
    let r = await post('/admin/users', HG, { unitId: 'C-20', name: 'Cobrador Veinte', personRole: 'collector',
      vehicleId: 'V-20', password: 'clave1234' });
    ok('sin ruta pedida, toma la de la combi (R-20)', r.status === 200 && r.body.routeId === 'R-20', r.body);
    r = await post('/admin/users', HG, { unitId: 'C-21', name: 'Cobrador Otro', personRole: 'collector',
      vehicleId: 'V-20', routeId: 'R-14', password: 'clave1234' });
    ok('con una ruta distinta a la de la combi, 400 que lo dice', r.status === 400 && /R-20/.test(r.body.error || ''), r);
  }

  console.log('\nLOS NOMBRES DEL SISTEMA NO SON CUENTAS');
  {
    const alta = coop.alta(base, { companyId: 'COOP-SIS', name: 'Coop Sistema', despacho: 'SISTEMA', clave: 'clavelarga3' });
    ok('una cooperativa nueva no puede llamar SISTEMA a su Despacho', !!alta.error, alta);
    const r = await post('/admin/users', H, { unitId: 'CREADOR', name: 'x', password: 'clave1234' });
    ok('CREADOR no se da de alta', r.status === 400, r);
    const r2 = await post('/admin/users', H, { unitId: 'sistema', name: 'x', password: 'clave1234' });
    ok('ni «sistema», en minúsculas', r2.status === 400, r2);
  }

  // Choferes para lo que sigue
  for (const [u, veh] of [['M-01', 'M-01'], ['M-02', 'M-01'], ['M-03', 'M-03'], ['M-05', 'M-05']]) {
    await post('/admin/users', HG, { unitId: u, name: 'Chofer ' + u, personRole: 'driver', vehicleId: veh, password: 'clave1234' });
  }

  console.log('\n«CREAR O RESTABLECER DESPACHO» NO CONVIERTE A UN CHOFER');
  {
    const r = coop.supervisor(base, { companyId: empresa, usuario: 'M-03', clave: 'clave-nueva-larga' });
    ok('sobre un chofer, error', !!r.error, r);
    ok('y el chofer sigue siendo chofer', base.prepare("SELECT role FROM users WHERE unitId = 'M-03'").get().role === 'driver');
  }

  console.log('\nEL RELEVADO NO SACA DEL MAPA LA COMBI DEL OTRO');
  {
    const a = await login('M-01', 'clave1234');
    const b = await login('M-02', 'clave1234');
    const gps = (s, t, dt) => post('/gps', s.token, { presencia: 'ruta',
      posiciones: [{ ...anillo(t), speed: 20, timestamp: Date.now() - dt }] });
    await post('/presencia', a.token, { estado: 'ruta' });
    await gps(a, 0.10, 2000);
    await post('/presencia', b.token, { estado: 'ruta' });   // B toma el mando
    const rb = await gps(b, 0.11, 1000);
    ok('B reporta y es el dueño', rb.body.gpsRole === true && rb.body.aceptadas === 1, rb.body);
    const ra = await gps(a, 0.12, 500);
    ok('A queda relevado', ra.body.gpsRole === false, ra.body);

    const fuera = await post('/presencia', a.token, { estado: 'fuera' });
    ok('el «fuera» de A se toma como fin de SU turno, no de la combi', fuera.status === 200 && fuera.body.ignorada === true, fuera.body);
    const enLinea = async () => ((await pedir('/admin/vehicles', H)).body.vehicles || []).find(v => v.vehicleId === 'M-01')?.enLinea;
    ok('M-01 sigue en el mapa', (await enLinea()) === true);
    const traf = await post('/trafico', a.token, { activo: true });
    ok('y su tráfico tampoco toca la combi de B', traf.body.ignorada === true, traf.body);
    const turnoA = base.prepare("SELECT COUNT(*) c FROM shifts WHERE personId = 'M-01' AND endedAt IS NULL").get().c;
    ok('el turno de A quedó cerrado', turnoA === 0, turnoA);

    const fueraB = await post('/presencia', b.token, { estado: 'fuera' });
    ok('el «fuera» de B, que tiene el mando, sí vale', fueraB.status === 200 && !fueraB.body.ignorada, fueraB.body);
    ok('y ahí M-01 se va del mapa', (await enLinea()) === false);
  }

  console.log('\nIR Y VOLVER DE COMBI NO DEJA DOS TURNOS ABIERTOS');
  {
    const s3 = await login('M-03', 'clave1234');
    const gps = (t) => post('/gps', s3.token, { presencia: 'ruta',
      posiciones: [{ ...anillo(t), speed: 20, timestamp: Date.now() }] });
    await gps(0.20); await sleep(50);
    base.prepare("UPDATE users SET vehicleId = 'M-04' WHERE unitId = 'M-03'").run();
    await gps(0.21); await sleep(50);
    base.prepare("UPDATE users SET vehicleId = 'M-03' WHERE unitId = 'M-03'").run();
    await gps(0.22); await sleep(50);
    await gps(0.23);
    const abiertos = base.prepare("SELECT vehicleId FROM shifts WHERE personId = 'M-03' AND endedAt IS NULL").all();
    ok('un solo turno abierto, en M-03', abiertos.length === 1 && abiertos[0].vehicleId === 'M-03', abiertos);
  }

  console.log('\nUNA LECTURA MALA NO CIERRA LA VUELTA');
  {
    const s5 = await login('M-05', 'clave1234');
    await post('/presencia', s5.token, { estado: 'ruta' });
    let t0 = Date.now() - 200_000;
    const mandar = async (ts) => {
      for (const t of ts) {
        await post('/gps', s5.token, { presencia: 'ruta', posiciones: [{ ...anillo(t), speed: 25, timestamp: t0 }] });
        t0 += 2000;
      }
    };
    const vueltas = () => base.prepare("SELECT COUNT(*) c FROM laps WHERE unitId = 'M-05'").get().c;
    await mandar(Array.from({ length: 23 }, (_, i) => 0.02 + i * 0.04));   // hasta 0.90
    await mandar([0.30]);                                                  // una sola lectura mala
    await mandar([0.92, 0.95]);
    await sleep(200);
    ok('una posición que proyecta hacia atrás no cierra la vuelta', vueltas() === 0, vueltas());
    await mandar([0.98, 0.02, 0.05, 0.08]);
    await sleep(200);
    ok('la vuelta de verdad sí se cierra', vueltas() === 1, vueltas());
    const v = base.prepare("SELECT parcial, progresoInicial FROM laps WHERE unitId = 'M-05'").get();
    ok('entera, y no acusa una entrada tardía', v && v.parcial === 0, v);
  }

  console.log('\nUN SALTO SUELTO HACIA ADELANTE TAMPOCO CIERRA LA VUELTA');
  {
    // Ida y vuelta por la misma calle: un rebote del GPS invierte el rumbo y
    // el progreso salta de 0,22 a 0,90 en una sola lectura. Quedaba como «lo
    // alto», y las dos lecturas normales siguientes confirmaban la caída: una
    // vuelta de segundos guardada como entera.
    // Una combi propia: la M-04 tiene el mando de M-03 desde la prueba de
    // ir y volver de combi, y su GPS se descartaría
    base.prepare("INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES ('M-07', NULL, 'R-14', ?, ?)").run(empresa, Date.now());
    await post('/admin/users', HG, { unitId: 'M-07', name: 'Chofer M-07', personRole: 'driver', vehicleId: 'M-07', password: 'clave1234' });
    const s4 = await login('M-07', 'clave1234');
    await post('/presencia', s4.token, { estado: 'ruta' });
    let t0 = Date.now() - 300_000;
    const mandar = async (ts) => {
      for (const t of ts) {
        await post('/gps', s4.token, { presencia: 'ruta', posiciones: [{ ...anillo(t), speed: 25, timestamp: t0 }] });
        t0 += 2000;
      }
    };
    const vueltas = () => base.prepare("SELECT COUNT(*) c FROM laps WHERE unitId = 'M-07'").get().c;
    await mandar([0.02, 0.06, 0.10, 0.14, 0.18, 0.22]);
    await mandar([0.90]);                                   // el salto suelto
    await mandar([0.26, 0.30]);
    await sleep(200);
    ok('el salto suelto no cierra una vuelta', vueltas() === 0, vueltas());

    // Y una lectura mala JUSTO antes del cruce: la vuelta se cierra bien, y la
    // siguiente no nace «parcial» por haber tomado la lectura mala como inicio
    await mandar(Array.from({ length: 16 }, (_, i) => 0.34 + i * 0.04));   // hasta 0.94
    await mandar([0.30, 0.01, 0.03]);
    await sleep(200);
    ok('la vuelta se cierra con la lectura mala antes del cruce', vueltas() === 1, vueltas());
    await mandar(Array.from({ length: 24 }, (_, i) => 0.05 + i * 0.04));   // hasta 0.97
    await mandar([0.01, 0.03]);
    await sleep(200);
    const segunda = base.prepare("SELECT parcial, progresoInicial FROM laps WHERE unitId = 'M-07' ORDER BY id DESC LIMIT 1").get();
    ok('y la siguiente es entera: no acusa una entrada al 30 %', vueltas() === 2 && segunda.parcial === 0 && segunda.progresoInicial < 0.1, segunda);
    ok('sin auditoría de vuelta parcial para M-07',
       !base.prepare("SELECT 1 FROM audit WHERE action = 'vuelta_parcial' AND target = 'M-07'").get());
  }

  console.log('\nLAS LISTAS DEL DÍA NO ARMAN TODO EL HISTORIAL');
  {
    // `?desde=0` armaba en memoria 120 días de vueltas y 365 de turnos en el
    // hilo único. La pantalla pide como mucho una semana.
    const viejo = Date.now() - 20 * 86400_000;
    base.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, parcial)
                  VALUES ('M-05', 'R-14', ?, ?, 3000, 20, 0)`).run(viejo - 3000_000, viejo);
    base.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt)
                  VALUES ('M-05', 'M-05', 'R-14', 'driver', ?, ?, ?)`).run(viejo, viejo + 3600_000, viejo + 3600_000);
    const v = await pedir('/admin/vueltas?desde=0', H);
    const nueveDias = Date.now() - 9 * 86400_000;
    ok('/admin/vueltas con desde=0 se acota a una semana y no trae la de hace 20 días',
       v.status === 200 && v.body.desde > nueveDias && !(v.body.vueltas || []).some(x => x.finishedAt === viejo), v.body.desde);
    const t = await pedir('/admin/shifts?desde=0', H);
    ok('/admin/shifts con desde=0 tampoco',
       t.status === 200 && t.body.desde > nueveDias && !(t.body.turnos || []).some(x => x.startedAt === viejo), t.body.desde);
  }

  console.log('\nEL MANDO VIVO NO SE LO HEREDA UN TERCERO');
  {
    // X3 y X1 con la web abierta en V-20; X1 sale de ruta por el socket y la
    // deja abierta; X2 maneja por HTTP. Cuando X1 cierra la web, el socket
    // le pasaba el mando a X3 y X2 quedaba mudo.
    for (const u of ['X-1', 'X-2', 'X-3']) {
      await post('/admin/users', HG, { unitId: u, name: 'Chofer ' + u, personRole: 'driver', vehicleId: 'V-20', password: 'clave1234' });
    }
    const x1 = await login('X-1', 'clave1234'), x2 = await login('X-2', 'clave1234'), x3 = await login('X-3', 'clave1234');
    const w3 = await conectar(x3.token);
    const w1 = await conectar(x1.token);
    w1.ws.send(JSON.stringify({ type: 'presencia', estado: 'fuera' }));
    await sleep(300);
    const gps2 = () => post('/gps', x2.token, { presencia: 'ruta', posiciones: [{ ...anillo(0.3), speed: 20, timestamp: Date.now() }] });
    await post('/presencia', x2.token, { estado: 'ruta' });
    let r = await gps2();
    ok('X2 toma la combi por HTTP', r.status === 200 && r.body.gpsRole !== false, r.body);
    w1.ws.close();
    await sleep(400);
    r = await gps2();
    ok('cerrar la web de X1 no le pasa el mando a X3: X2 sigue reportando', r.status === 200 && r.body.gpsRole !== false, r.body);
    ok('y X3 no recibió el rol', !w3.visto.slice(-5).some(m => m.type === 'gps_role' && m.reporting === true && m !== w3.visto[0]));

    // El SOS del cobrador sale con la posición de la combi (no manda GPS)
    const c20 = await login('C-20', 'clave1234');
    const sos = await post('/sos', c20.token, {});
    ok('el SOS del cobrador lleva la posición reciente de su combi',
       sos.status === 200 && Math.abs((sos.body.lat || 0) - anillo(0.3).lat) < 1e-6, sos.body);
    w3.ws.close();
  }

  console.log('\nLOS INFORMES NO REVIENTAN');
  {
    const r = await fetch(`${API}/admin/informe/constructor.csv`, { headers: { Authorization: 'Bearer ' + H } });
    ok('`constructor.csv` es un informe que no existe: 404, no 500', r.status === 404, r.status);
    const r2 = await fetch(`${API}/admin/informe/vueltas.csv?desde=1e20`, { headers: { Authorization: 'Bearer ' + H } });
    ok('`desde=1e20` se acota a una fecha posible: 200', r2.status === 200, r2.status);
  }

  console.log('\nEL SOS');
  {
    const chofer = await login('M-03', 'clave1234');
    const oyente = await conectar(chofer.token);
    const desp = await conectar(H);
    const antes = base.prepare("SELECT COUNT(*) c FROM messages WHERE kind = 'sos'").get().c;
    desp.ws.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.13 }));
    await sleep(700);
    ok('Despacho no dispara un SOS por el socket', base.prepare("SELECT COUNT(*) c FROM messages WHERE kind = 'sos'").get().c === antes);
    ok('y a la ruta no le llegó nada', !oyente.visto.some(m => m.type === 'sos_alert'));

    // Un teléfono con el reloj 20 minutos atrás: el SOS nace con la hora del
    // servidor, y la ventana para ponerle el tipo está abierta.
    const r = await post('/sos', chofer.token, { lat: -15.49, lng: -70.13, timestamp: Date.now() - 20 * 60_000 });
    ok('el SOS lleva la hora del servidor', r.status === 200 && Math.abs(r.body.timestamp - Date.now()) < 5000, r.body.timestamp);
    const t = await post(`/sos/${r.body.sosId}/tipo`, chofer.token, { tipo: 'accidente' });
    ok('y se le puede poner el tipo', t.status === 200, t);
    const proto = await post(`/sos/${r.body.sosId}/tipo`, chofer.token, { tipo: 'constructor' });
    ok('«constructor» no es un tipo de emergencia', proto.status === 400, proto);
    oyente.ws.close(); desp.ws.close();
  }

  console.log('\nEL SOCKET');
  {
    // Sin token, tipos que antes abrían casilleros propios en el cupo —y uno
    // que envenenaba Object.prototype—. El servidor sigue entero.
    const suelto = await conectar(null);
    for (const tipo of ['__proto__', 'constructor', 'hasOwnProperty', 'x'.repeat(50)]) {
      suelto.ws.send(JSON.stringify({ type: tipo }));
    }
    await sleep(300);
    ok('el servidor sigue contestando', (await fetch(API + '/ping')).status === 200);
    ok('y ningún mensaje raro quedó en el log como excepción', !/reventó/.test(log));
    suelto.ws.close();

    const s = await login('M-03', 'clave1234');
    const c = await conectar(s.token);
    c.ws.send(JSON.stringify({ type: 'ping' }));
    await sleep(300);
    ok('el latido de la web: ping → pong', c.visto.some(m => m.type === 'pong'));
    c.ws.close();
  }

  console.log('\nTURNOS: «AYER» TERMINA A LA MEDIANOCHE');
  {
    const hasta = Date.now() - 3600_000;
    const r = await pedir(`/admin/shifts?desde=${hasta - 86400_000}&hasta=${hasta}`, H);
    ok('el servidor toma el `hasta` pedido', r.status === 200 && r.body.hasta === hasta, r.body.hasta);
  }

  console.log('\nLAS GRABACIONES');
  {
    const s = await login('M-03', 'clave1234');
    const bien = [anillo(0.1), anillo(0.11)];
    let r = await post('/grabacion', s.token, { puntos: [...bien, { lat: 500, lng: -70 }, { lat: 1e308, lng: 1 }] });
    ok('las coordenadas imposibles se descartan y lo demás entra', r.status === 200 && r.body.puntos === 2, r);
    for (let i = 0; i < 5; i++) await post('/grabacion', s.token, { puntos: bien });
    r = await post('/grabacion', s.token, { puntos: bien });
    ok('la séptima del día de la misma persona: 429', r.status === 429, r);
  }

  console.log('\nLA AUDITORÍA DE LA PLATAFORMA NO ES DE NINGUNA COOPERATIVA');
  {
    const r = await post('/creador/login', null, { password: CLAVE_CREADOR });
    ok('el creador entra', r.status === 200 && !!r.body.token, r.status);
    await sleep(100);
    const fila = base.prepare("SELECT companyId FROM audit WHERE action = 'creador_login' ORDER BY id DESC LIMIT 1").get();
    ok('su login queda en el casillero de la plataforma', fila && fila.companyId === '__plataforma__', fila);
    const eventos = (await pedir('/admin/audit', H)).body.events || [];
    ok('y el Despacho de la cooperativa no lo ve', !eventos.some(e => e.action === 'creador_login'), eventos.slice(0, 3));
  }

  base.close();
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FALLA (excepción):', e.stack || e.message);
  if (servidor) servidor.kill();
  process.exit(1);
});
