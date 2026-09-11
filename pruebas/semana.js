// Lo que el chofer no veía de sí mismo (REVISION-2026-09-10.md, tanda 5b:
// P2, P3, P4, P5, P6, P7).
//
// Lo que se defiende: que el perfil distinga las vueltas de la COMBI de las
// «tuyas» (las que se cerraron con esta persona arriba, con la misma regla
// que el gerente); que devuelva lo de la combi —cortes, ausencias,
// anomalías, salidas de ruta, avisos de tráfico, entradas tardías— con LA
// MISMA cuenta que el cuadro del gerente, y los turnos uno por uno; que diga
// la vara y entre qué valores anduvo; que acepte la ventana (7 o 30 días);
// que el cobrador no vea las horas de sus compañeros; y que el servidor
// anote qué APK tiene cada teléfono y conteste cuál se reparte, para que la
// app avise «hay una nueva».
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/semana-test.db';
const P = 3170;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = 3600_000;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

console.log('\nLA LÓGICA DEL AVISO DE VERSIÓN, PURA');
{
  const { cabeceraDeApp, avisoDeApp } = require(RAIZ + '/app/version.js');
  ok('la cabecera dice versión y código', JSON.stringify(cabeceraDeApp({ version: '0.2.3', versionCode: 5 })) === '{"X-App-Version":"0.2.3/5"}');
  ok('sin código (Expo Go) no manda nada', JSON.stringify(cabeceraDeApp({ version: null, versionCode: null })) === '{}');
  const reparte = { versionCodeActual: 6, versionCodeMin: 4, url: 'https://x/app.apk' };
  ok('al día: sin aviso', avisoDeApp(reparte, { versionCode: 6 }) === null);
  const nueva = avisoDeApp(reparte, { versionCode: 5 });
  ok('una atrás: «hay una nueva», no grave, con la URL', !!nueva && nueva.grave === false && /nueva/.test(nueva.texto) && /6/.test(nueva.texto) && /app\.apk/.test(nueva.texto), nueva);
  const vieja = avisoDeApp(reparte, { versionCode: 3 });
  ok('por debajo del mínimo: «ya no sirve», grave', !!vieja && vieja.grave === true && /NO SIRVE/.test(vieja.texto), vieja);
  ok('si el servidor no dice versiones, nada', avisoDeApp({ versionCodeActual: null, versionCodeMin: null, url: null }, { versionCode: 1 }) === null);
  ok('y sin versión propia, nada', avisoDeApp(reparte, { versionCode: null }) === null);
}

console.log('\nLA PANTALLA, POR LECTURA');
{
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const cliente = fs.readFileSync(RAIZ + '/app/protocolo/cliente.js', 'utf8');
  const pkg = JSON.parse(fs.readFileSync(RAIZ + '/app/package.json', 'utf8'));
  ok('la app lee su versión de la instalación (expo-application), no de app.json',
     /from 'expo-application'/.test(app) && /nativeBuildVersion/.test(app) && pkg.dependencies['expo-application'] === '~7.0.8');
  ok('el login lleva la versión y el perfil y el POST /gps la cabecera',
     /entrar\(usuario\.trim\(\), clave, APP\)/.test(app) && /\.\.\.\(app \? \{ app \} : \{\}\)/.test(cliente) &&
     /\.\.\.CABECERA_APP/.test(app) && /\.\.\.CABECERA_APP/.test(servicio) && /cabeceraDeApp/.test(servicio));
  ok('el aviso de versión está en la pantalla de ruta y en el perfil, y el grave va en rojo',
     /avisoApp=\{avisoDeApp\(sesion && sesion\.app, APP\)\}/.test(app) && (app.match(/avisoApp\.grave && \{ color: C\.rojo \}/g) || []).length === 2);
  ok('el perfil pide la ventana y ofrece 7 o 30 días', /\/perfil\?dias=' \+ dias/.test(app) && /\[7, 30\]\.map/.test(app));
  ok('las vueltas se rotulan de la combi, con las «tuyas» aparte y la vara', /VUELTAS DE \$\{combi\}/.test(app) && /\['TUYAS'/.test(app) && /\['OBJETIVO', mmss\(m\.objetivoSec\)\]/.test(app));
  ok('hay «Mi semana» con lo de la combi y los turnos uno por uno', /'MI SEMANA'/.test(app) && /TUS TURNOS/.test(app) && /datos\.turnos\.map/.test(app));
  ok('las horas de los otros cobradores sólo se dibujan si llegaron', /c\.horasSec != null && \(/.test(app));
  ok('y la versión se ve al pie del perfil y del ingreso', /Versión \{APP\.version/.test(app) && /app \$\{APP\.version\} \(\$\{APP\.versionCode\}\)/.test(app));
}

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', ARRANQUE_GRACIA_MS: '0',
           APP_VERSION_ACTUAL: '6', APP_VERSION_MIN: '4', APP_URL: 'https://ejemplo.pe/chofer.apk' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const pedir = (ruta, opts = {}) => fetch(API + ruta, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = async (u, p, app) =>
    (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p, ...(app ? { app } : {}) }) })).body;
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };
  // Dos choferes que se turnan la combi M-01, y su cobrador
  for (const [u, extra] of [['M-01', {}], ['M-02', { vehicleId: 'M-01' }]]) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234', ...extra }) });
  }
  await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'C-01', name: 'Cobrador Uno', personRole: 'collector', vehicleId: 'M-01', password: 'chofer1234' }) });
  const perfil = async (token, q = '', headers = {}) => (await pedir('/perfil' + q, { headers: { Authorization: 'Bearer ' + token, ...headers } })).body;
  const bd = () => new Database(DB, { readonly: true });

  // Un día sembrado a mano: M-01 manejó de 8 a 12 (3 vueltas, con el
  // cobrador arriba), M-02 de 13 a 17 (2 vueltas y una salida de ruta), una
  // vuelta a las 19 de nadie, y una vuelta de hace 20 días.
  const ahora = Date.now();
  const hoy = (h) => ahora - (24 - h) * H;
  const w = new Database(DB);
  const empresa = w.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  const turno = w.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt) VALUES (?, ?, 'R-14', ?, ?, ?, ?)`);
  turno.run('M-01', 'M-01', 'driver', hoy(8), hoy(12), hoy(12));
  turno.run('C-01', 'M-01', 'collector', hoy(8), hoy(12), hoy(12));
  turno.run('M-02', 'M-01', 'driver', hoy(13), hoy(17), hoy(17));
  const vuelta = w.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, parcial, objetivoSec) VALUES ('M-01', 'R-14', ?, ?, 3000, 20, ?, 0, ?)`);
  for (const h of [9, 10, 11]) vuelta.run(hoy(h) - 3000_000, hoy(h), 600, 600);
  for (const h of [14, 16]) vuelta.run(hoy(h) - 3000_000, hoy(h), 900, 900);
  vuelta.run(hoy(19) - 3000_000, hoy(19), null, 600);
  vuelta.run(ahora - 20 * 24 * H, ahora - 20 * 24 * H + 3000_000, 600, 600);
  const desvio = w.prepare(`INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre) VALUES ('M-01', 'R-14', ?, ?, 120, ?, 300, ?, 'regreso')`);
  desvio.run(hoy(15), hoy(15) + 120_000, 400, 0);         // la de M-02, real
  desvio.run(hoy(10), hoy(10) + 60_000, 350, 1);          // en el turno de M-01, silenciada: va aparte
  w.prepare(`INSERT INTO huecos (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, recuperadas, cierre) VALUES ('M-01', 'R-14', ?, ?, ?, ?, ?, 'volvio')`)
    .run(empresa, hoy(9), hoy(9) + 240_000, 240, 3);
  w.prepare(`INSERT INTO huecos (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, recuperadas, cierre) VALUES ('M-01', 'R-14', ?, ?, ?, ?, ?, 'volvio')`)
    .run(empresa, hoy(15), hoy(15) + 90_000, 90, 0);
  w.prepare(`INSERT INTO presencia_log (vehicleId, routeId, companyId, estado, cuando) VALUES ('M-01', 'R-14', ?, ?, ?)`).run(empresa, 'ausente', hoy(10) + 30 * 60_000);
  w.prepare(`INSERT INTO presencia_log (vehicleId, routeId, companyId, estado, cuando) VALUES ('M-01', 'R-14', ?, ?, ?)`).run(empresa, 'ruta', hoy(10) + 40 * 60_000);
  const anomalia = w.prepare(`INSERT INTO anomalias (vehicleId, routeId, companyId, tipo, cuando, valor) VALUES ('M-01', 'R-14', ?, ?, ?, ?)`);
  anomalia.run(empresa, 'gps_impreciso', hoy(11), 140);
  anomalia.run(empresa, 'gps_impreciso', hoy(14), 160);
  anomalia.run(empresa, 'salto', hoy(16), 300);
  w.prepare(`INSERT INTO audit (actor, action, target, detail, timestamp, routeId, companyId) VALUES ('sistema', 'entrada_tardia', 'M-01', 'entró al 40 %', ?, 'R-14', ?)`).run(hoy(13) + 60_000, empresa);
  w.prepare(`INSERT INTO paradas (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, lat, lng, progreso, tramo, confirmado, medida, cierre) VALUES ('M-01', 'R-14', ?, ?, ?, 0, -15.49, -70.13, 0.4, 'ida', 1, 0, 'chofer')`)
    .run(empresa, hoy(14) + 10 * 60_000, hoy(14) + 11 * 60_000);
  w.prepare(`INSERT INTO messages (kind, unitId, driverName, vehicleId, routeId, lat, lng, timestamp) VALUES ('sos', 'M-01', 'Chofer M-01', 'M-01', 'R-14', -15.49, -70.13, ?)`).run(hoy(11) + 5 * 60_000);
  w.prepare(`INSERT INTO recordings (personId, companyId, routeId, nombre, puntos, cantidad, largoM, createdAt) VALUES ('M-01', ?, 'R-14', 'Recorrido', '[]', 0, 0, ?)`).run(empresa, hoy(12));
  w.close();

  const s1 = await login('M-01', 'chofer1234', { version: '0.2.3', versionCode: 5 });
  const s2 = await login('M-02', 'chofer1234');
  const sc = await login('C-01', 'chofer1234');

  console.log('\nLAS VUELTAS DE LA COMBI Y LAS TUYAS');
  {
    const p1 = await perfil(s1.token);
    const p2 = await perfil(s2.token);
    const pc = await perfil(sc.token);
    ok('M-01 ve las 6 de la combi y 3 suyas', p1.metricas.vueltas === 6 && p1.metricas.vueltasPropias === 3, { vueltas: p1.metricas.vueltas, propias: p1.metricas.vueltasPropias });
    ok('M-02 ve las mismas 6 y 2 suyas', p2.metricas.vueltas === 6 && p2.metricas.vueltasPropias === 2, { vueltas: p2.metricas.vueltas, propias: p2.metricas.vueltasPropias });
    ok('el cobrador: las 3 que fue arriba', pc.metricas.vueltasPropias === 3, pc.metricas.vueltasPropias);
    ok('la vara de hoy y entre qué anduvo (600 y 900 en la semana)', typeof p1.metricas.objetivoSec === 'number' && p1.metricas.objetivoModo === 'manual' && p1.metricas.varaMin === 600 && p1.metricas.varaMax === 900,
       { objetivoSec: p1.metricas.objetivoSec, modo: p1.metricas.objetivoModo, min: p1.metricas.varaMin, max: p1.metricas.varaMax });
    ok('el período viene dicho: 7 días', p1.periodo && p1.periodo.dias === 7 && p1.metricas.dias === 7, p1.periodo);
  }

  console.log('\nLA VENTANA: LA SEMANA O EL MES');
  {
    const p30 = await perfil(s1.token, '?dias=30');
    ok('a 30 días entra la vuelta de hace 20', p30.periodo.dias === 30 && p30.metricas.vueltas === 7, { dias: p30.periodo.dias, vueltas: p30.metricas.vueltas });
    const p99 = await perfil(s1.token, '?dias=99');
    ok('un pedido fuera de rango vuelve a 7', p99.periodo.dias === 7 && p99.metricas.vueltas === 6, p99.periodo);
  }

  console.log('\nLO DE LA COMBI, CON LA MISMA CUENTA QUE EL GERENTE, Y LOS TURNOS UNO POR UNO');
  {
    const p1 = await perfil(s1.token);
    const p2 = await perfil(s2.token);
    const sn = p1.combi && p1.combi.senal;
    ok('dos cortes, uno sin datos, el más largo de 4 min', !!sn && sn.cortes === 2 && sn.sinDatos === 1 && sn.corteMaxSec === 240, sn);
    ok('una ausencia de 10 min, dos imprecisos, un salto, una tardía, un aviso de tráfico sin parada',
       !!sn && sn.ausencias === 1 && sn.ausenteSec === 600 && sn.gpsImpreciso === 2 && sn.saltos === 1 && sn.entradasTardias === 1 && sn.avisosTrafico === 1 && sn.avisosSinParada === 1, sn);
    ok('la combi salió una vez (la silenciada va aparte)', p1.combi.desvios.veces === 1 && p1.combi.desvios.aparte === 1 && p1.combi.desvios.maxM === 400, p1.combi.desvios);
    ok('la salida es del turno de M-02, no del de M-01', p1.propios.desvios === 0 && p2.propios.desvios === 1, { m1: p1.propios.desvios, m2: p2.propios.desvios });
    ok('el SOS y la grabación son de M-01', p1.propios.sos === 1 && p1.propios.grabaciones === 1 && p2.propios.sos === 0, p1.propios);
    // El mismo número que el cuadro del gerente, con el mismo rango
    const r = (await pedir(`/gerencia/resumen?desde=${ahora - 7 * 24 * H}&hasta=${ahora}`, { headers: HG })).body;
    const u1 = (r.porUnidad || []).find(u => u.unitId === 'M-01');
    ok('y es EXACTAMENTE lo que el gerente ve de esa combi', !!u1 && JSON.stringify(u1.senal) === JSON.stringify(sn) && u1.desvios === 1 && u1.desviosAparte === 1, u1 && u1.senal);
    const t = p1.turnos || [];
    ok('M-01 tiene su turno, de 4 h y 3 vueltas', t.length === 1 && t[0].duracionSec === 4 * 3600 && t[0].vueltas === 3 && t[0].abierto === false && t[0].vehicleId === 'M-01', t);
    ok('y la suma de los turnos es HORAS', t.reduce((a, x) => a + x.duracionSec, 0) === p1.metricas.horasSec, p1.metricas.horasSec);
    const tc = (await perfil(sc.token)).turnos || [];
    ok('el cobrador ve el suyo, de cobrador, con sus 3 vueltas arriba', tc.length === 1 && tc[0].role === 'collector' && tc[0].vueltas === 3, tc);
  }

  console.log('\nEL COBRADOR NO VE LAS HORAS DE SUS COMPAÑEROS');
  {
    const p1 = await perfil(s1.token);
    const pc = await perfil(sc.token);
    ok('el chofer ve a su cobrador con horas y usuario', p1.cobradores.length === 1 && p1.cobradores[0].unitId === 'C-01' && p1.cobradores[0].horasSec === 4 * 3600, p1.cobradores);
    ok('el cobrador ve quién más va, sin horas ni usuario', pc.cobradores.length === 1 && pc.cobradores[0].name === 'Cobrador Uno' && !('horasSec' in pc.cobradores[0]) && !('unitId' in pc.cobradores[0]) && !('ultimoIngreso' in pc.cobradores[0]), pc.cobradores);
  }

  console.log('\nQUÉ APK TIENE CADA UNO, Y CUÁL SE REPARTE');
  {
    ok('el login contesta qué se reparte', s1.app && s1.app.versionCodeActual === 6 && s1.app.versionCodeMin === 4 && s1.app.url === 'https://ejemplo.pe/chofer.apk', s1.app);
    let fila = bd().prepare("SELECT appVersion, appVersionCode FROM users WHERE unitId = 'M-01'").get();
    ok('y anota la versión que dijo el teléfono', fila.appVersion === '0.2.3' && fila.appVersionCode === 5, fila);
    const p = await perfil(s1.token, '', { 'X-App-Version': '0.2.4/6' });
    fila = bd().prepare("SELECT appVersion, appVersionCode FROM users WHERE unitId = 'M-01'").get();
    ok('la cabecera de un pedido cualquiera la actualiza (el que actualizó sin volver a entrar)', fila.appVersionCode === 6 && fila.appVersion === '0.2.4' && p.app.versionCode === 6, fila);
    const gps = await pedir('/gps', { method: 'POST', headers: { Authorization: 'Bearer ' + s1.token, 'X-App-Version': '0.2.5/7' },
      body: JSON.stringify({ posiciones: [{ lat: -15.4904, lng: -70.1333, speed: 0, timestamp: Date.now() }] }) });
    fila = bd().prepare("SELECT appVersionCode FROM users WHERE unitId = 'M-01'").get();
    ok('también el POST /gps', gps.status === 200 && fila.appVersionCode === 7, { status: gps.status, fila });
    const basura = await perfil(s1.token, '', { 'X-App-Version': 'lo que sea' });
    fila = bd().prepare("SELECT appVersionCode FROM users WHERE unitId = 'M-01'").get();
    ok('una cabecera rota no pisa nada', basura.persona && fila.appVersionCode === 7, fila);
    const lista = (await pedir('/admin/users', { headers: HD })).body.users || [];
    const m1 = lista.find(u => u.unitId === 'M-01'), m2 = lista.find(u => u.unitId === 'M-02');
    ok('Despacho ve la versión de cada uno (y null del que nunca la dijo)', !!m1 && m1.appVersionCode === 7 && !!m2 && m2.appVersionCode === null, { m1: m1 && m1.appVersionCode, m2: m2 && m2.appVersionCode });
    ok('sin sesión, el perfil sigue siendo 401 aunque diga versión', (await pedir('/perfil', { headers: { 'X-App-Version': '0.2.3/5' } })).status === 401);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); try { servidor && servidor.kill(); } catch {} process.exit(1); });
