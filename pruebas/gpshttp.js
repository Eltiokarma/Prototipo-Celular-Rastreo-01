// Posiciones por HTTP (`POST /gps`).
//
// Existe por una medición en un teléfono real: al bloquear la pantalla,
// Android suspende el JavaScript y el WebSocket se cae. El servicio de
// ubicación seguía vivo —la notificación permanente seguía ahí— pero la
// combi quedaba muda. Un POST no necesita nada vivo del lado del cliente.
//
// Y como acepta varias posiciones con su hora, es también lo que le faltaba
// a `app/cola.js` para poder vaciar el atraso de una zona sin datos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/gpshttp-test.db';
const P = 3161;
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
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '400',
           // Acortados para "VACIAR ATRASO NO ES ESTAR MUERTO": el barrido
           // corre cada 10 s fijos, y con los plazos de producción (30 s /
           // 3 min) verlo actuar sería una suite de cinco minutos.
           SIN_SENAL_MS: '2000', OLVIDAR_MS: '15000' },
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

const mandar = (token, posiciones) => fetch(API + '/gps', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ posiciones }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function hasta(cond, ms = 4000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(120); }
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
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  for (const [u, n] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama'], ['M-13', 'Reloj Atrasado']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: n, personRole: 'driver', password: 'clave1234' }) });
  }
  // Un cobrador necesita el vehículo asignado a mano: no se le crea uno solo,
  // porque el cobrador SUBE a una combi, no es una combi.
  const altaCobrador = await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'C-12', name: 'Cobrador Doce', personRole: 'collector',
                           vehicleId: 'M-12', password: 'clave1234' }) }).then(r => r.status);

  const s12 = await login('M-12', 'clave1234');
  const ahora = Date.now();

  console.log('\nMANDAR SIN WEBSOCKET');
  // Esto es lo que la app hace con la pantalla apagada: no hay socket, no hay
  // React vivo, solo la tarea de fondo mandando un POST.
  const q = anillo(0.10);
  // Con hora de hace un rato, para que el atraso del túnel de abajo sea más
  // nuevo que esto: una posición más vieja que la que ya se tiene no se
  // procesa (ver "LO QUE YA SE SABÍA").
  let r = await mandar(s12.token, [{ lat: q.lat, lng: q.lng, speed: 22, timestamp: ahora - 400_000 }]);
  ok('acepta la posición sin ninguna conexión abierta', r.status === 200 && r.body.aceptadas === 1, r.body);

  // Se mira desde otro cliente, para comprobar que entró de verdad al estado.
  const s08 = await login('M-08', 'clave1234');
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws.on('open', res));
  let estado = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  ws.send(JSON.stringify({ type: 'identify', token: s08.token }));
  await sleep(900);
  const vista = () => (estado?.units || []).find(u => u.unitId === 'M-12');
  ok('la unidad aparece en el estado que ven los demás', !!vista(), estado?.units?.map(u => u.unitId));
  ok('con el progreso calculado por el servidor',
     typeof vista()?.routeProgress === 'number' && vista().routeProgress > 0, vista()?.routeProgress);

  console.log('\nEL ATRASO DE UN TÚNEL');
  // Cinco minutos de posiciones guardadas, con su hora real, llegando juntas.
  // Antes esto era imposible: el servidor le ponía la hora de llegada a cada
  // una y la unidad se teletransportaba por el recorrido.
  const atraso = Array.from({ length: 30 }, (_, i) => {
    const p = anillo(0.11 + i * 0.001);
    return { lat: p.lat, lng: p.lng, speed: 20, timestamp: ahora - (30 - i) * 10_000 };
  });
  r = await mandar(s12.token, atraso);
  ok('acepta el atraso entero de una vez', r.status === 200 && r.body.aceptadas === 30, r.body);
  await sleep(900);
  ok('la posición que queda es la MÁS NUEVA del lote',
     Math.abs(vista().lat - anillo(0.11 + 29 * 0.001).lat) < 1e-6, vista()?.lat);
  ok('y la hora guardada es la de la posición, no la de llegada',
     Math.abs(vista().timestamp - (ahora - 10_000)) < 2000,
     { guardada: vista().timestamp, esperada: ahora - 10_000 });

  console.log('\nLO QUE YA SE SABÍA NO SE PROCESA DOS VECES');
  // Con la pantalla apagada la app corta un envío que no vuelve y lo manda
  // de nuevo — y ese envío pudo haber llegado igual: se perdió la respuesta,
  // no el pedido. El lote repetido no puede volver a pasar por la medición
  // ni mover la unidad; lo único que dice es que al teléfono se lo oye.
  const antesDelRepetido = { ...vista() };
  await sleep(300);
  r = await mandar(s12.token, atraso);
  ok('el mismo lote otra vez: nada aceptado, todo ya visto',
     r.status === 200 && r.body.aceptadas === 0 && r.body.yaVistas === 30, r.body);
  await sleep(700);
  ok('la unidad no se movió ni cambió de hora',
     vista().timestamp === antesDelRepetido.timestamp && vista().lat === antesDelRepetido.lat,
     { antes: antesDelRepetido.timestamp, ahora: vista()?.timestamp });
  ok('pero al teléfono se lo oyó: la hora del enlace avanzó',
     vista().oidoEn > antesDelRepetido.oidoEn, { antes: antesDelRepetido.oidoEn, ahora: vista()?.oidoEn });
  // Y una tanda VIEJA que llega después de una fresca —un envío colgado que
  // se destrabó tarde— no la teletransporta hacia atrás.
  const vieja = anillo(0.05);
  r = await mandar(s12.token, [{ lat: vieja.lat, lng: vieja.lng, speed: 20, timestamp: ahora - 200_000 }]);
  await sleep(600);
  ok('una posición más vieja que la conocida se descarta como ya vista',
     r.body.aceptadas === 0 && r.body.yaVistas === 1, r.body);
  ok('y la unidad sigue donde estaba',
     Math.abs(vista().lat - anillo(0.11 + 29 * 0.001).lat) < 1e-6, vista()?.lat);

  console.log('\nLA BRECHA VUELVE EN LA RESPUESTA');
  // Con la pantalla apagada este POST es el único canal del teléfono: la
  // brecha viaja de vuelta en la misma respuesta (del cache del último
  // estado emitido) y es lo que mantiene viva la notificación del chofer.
  // M-08 se pone adelante por WebSocket, como una combi de verdad.
  const delante = anillo(0.16);
  ws.send(JSON.stringify({ type: 'gps', lat: delante.lat, lng: delante.lng, speed: 20 }));
  await sleep(900);   // que el estado se emita y el cache exista
  const q2 = anillo(0.14);
  r = await mandar(s12.token, [{ lat: q2.lat, lng: q2.lng, speed: 22, timestamp: Date.now() }]);
  ok('la respuesta trae contra quién y a cuánto',
     r.body.brecha?.aheadUnit === 'M-08' && /^\d{2}:\d{2}$/.test(r.body.brecha?.toAhead || ''),
     r.body.brecha);
  ok('y el objetivo vigente, para poder juzgarla', r.body.brecha?.objetivoMin === 2, r.body.brecha);

  console.log('\nLO QUE NO SE ACEPTA');
  r = await mandar('token-que-no-existe', [{ lat: LAT0, lng: LNG0, timestamp: ahora }]);
  ok('sin token válido, 401', r.status === 401, r.status);

  ok('el cobrador se dio de alta sobre la combi', altaCobrador === 200, altaCobrador);
  const sC = await login('C-12', 'clave1234');
  r = await mandar(sC.token, [{ lat: LAT0, lng: LNG0, timestamp: ahora }]);
  ok('el cobrador no reporta posición, 403', r.status === 403, { status: r.status, body: r.body });

  r = await mandar(s12.token, []);
  ok('sin posiciones, 400', r.status === 400, r.status);

  r = await mandar(s12.token, Array.from({ length: 201 }, () => ({ lat: LAT0, lng: LNG0, timestamp: ahora })));
  ok('un envío descomunal se rechaza entero, 413', r.status === 413, r.status);

  // Un reloj adelantado mandaría posiciones del futuro y arruinaría la
  // medición de la vuelta; una de hace un día ya no le sirve a nadie.
  const antes = vista().timestamp;
  r = await mandar(s12.token, [
    { lat: LAT0, lng: LNG0, speed: 5, timestamp: ahora + 3600_000 },
    { lat: LAT0, lng: LNG0, speed: 5, timestamp: ahora - 24 * 3600_000 },
  ]);
  ok('las del futuro y las muy viejas se descartan', r.status === 400, { status: r.status, body: r.body });
  await sleep(600);
  ok('y no ensucian la posición que había', vista().timestamp === antes, vista()?.timestamp);

  console.log('\nEL RELEVO SIGUE MANDANDO');
  // Si otro chofer tomó la unidad por WebSocket, el HTTP del anterior ya no
  // vale: son las mismas reglas de `gps_role`, no unas nuevas.
  const otro = await login('M-12', 'clave1234');   // misma persona, sesión nueva
  const ws2 = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws2.on('open', res));
  ws2.send(JSON.stringify({ type: 'identify', token: otro.token }));
  await sleep(500);
  r = await mandar(s12.token, [{ lat: q.lat, lng: q.lng, speed: 10, timestamp: Date.now() }]);
  ok('la misma persona con otra sesión sí puede seguir mandando', r.status === 200, r.status);

  console.log('\nEL RELEVO POR HTTP: EL QUE DECLARA RUTA TOMA EL MANDO, Y EL RELEVADO SE APAGA');
  // De la revisión del 8/9 (L6) y la del 10/9 (C2). El chofer saliente dejó
  // la app abierta en el asiento (su WebSocket vivo es el dueño del GPS). El
  // que sube declara «ruta» por HTTP con la pantalla apagada y manda: toma el
  // mando (antes: 409 y mudo todo el turno). Al saliente se le avisa por el
  // socket, y si sigue mandando por HTTP —el teléfono en el asiento con el
  // servicio vivo— recibe 200 con `gpsRole: false` y NADA se le procesa:
  // antes, desde el relevo, nadie era dueño y los dos teléfonos entraban
  // intercalados.
  {
    try { ws2.close(); } catch {}
    await sleep(400);
    // Un relevo: otra persona (unitId) sobre la MISMA combi (vehicleId M-12)
    await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: 'M-12R', name: 'Relevo de Elmer', personRole: 'driver',
                             vehicleId: 'M-12', password: 'clave1234' }) });
    const saliente = await login('M-12', 'clave1234');
    const relevoHttp = await login('M-12R', 'clave1234');
    // El saliente deja la app abierta: su WebSocket vivo es el dueño del GPS
    const wsSaliente = new WebSocket(`ws://localhost:${P}`);
    await new Promise(res => wsSaliente.on('open', res));
    let avisado = null;
    wsSaliente.on('message', raw => { const m = JSON.parse(raw);
      if (m.type === 'gps_role' && m.reporting === false) avisado = m.reason; });
    wsSaliente.send(JSON.stringify({ type: 'identify', token: saliente.token }));
    await sleep(600);
    // El que sube, sin declarar nada todavía, manda por HTTP: el dueño (el
    // saliente, con el socket vivo) sigue siendo el dueño → 200 y nada
    const q1 = anillo(0.149);
    const antes = await mandar(relevoHttp.token, [{ lat: q1.lat, lng: q1.lng, speed: 18, timestamp: Date.now() }]);
    ok('sin declarar ruta, el que sube no toma el mando: 200 con gpsRole false y 0 aceptadas',
       antes.status === 200 && antes.body.gpsRole === false && antes.body.aceptadas === 0, antes.body);
    // Declara «ruta» (lo que hace la app al deslizar SALIR A RUTA) y manda
    await fetch(`${API}/presencia`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relevoHttp.token },
      body: JSON.stringify({ estado: 'ruta' }) });
    const q2 = anillo(0.15);
    const sube = await mandar(relevoHttp.token, [{ lat: q2.lat, lng: q2.lng, speed: 18, timestamp: Date.now() }]);
    ok('declarada la ruta, el relevo manda por HTTP y es aceptado (no 409)', sube.status === 200 && sube.body.aceptadas === 1 && sube.body.gpsRole === true, { status: sube.status, body: sube.body });
    ok('y al saliente se le avisa por el socket que su GPS ya no se usa',
       await hasta(() => !!avisado), avisado);
    // El saliente sigue mandando por HTTP (el teléfono en el asiento)
    const qS = anillo(0.151);
    const saliendo = await mandar(saliente.token, [{ lat: qS.lat, lng: qS.lng, speed: 18, timestamp: Date.now() }]);
    ok('al saliente se le contesta 200 con gpsRole false y no se le procesa nada', saliendo.status === 200 && saliendo.body.gpsRole === false && saliendo.body.aceptadas === 0, saliendo.body);
    await sleep(500);
    ok('y la unidad NO saltó a su posición', vista() && Math.abs(vista().lat - q2.lat) < 1e-9, vista() && vista().lat);
    try { wsSaliente.close(); } catch {}
    await sleep(400);
    const q3 = anillo(0.16);
    const sigue = await mandar(relevoHttp.token, [{ lat: q3.lat, lng: q3.lng, speed: 18, timestamp: Date.now() }]);
    ok('el relevo sigue mandando sin trabas', sigue.status === 200 && sigue.body.gpsRole === true, sigue.body);
    // Y devolvemos la combi a M-12: se identifica por WS (el acto explícito)
    const wsVuelve = new WebSocket(`ws://localhost:${P}`);
    await new Promise(res => wsVuelve.on('open', res));
    wsVuelve.send(JSON.stringify({ type: 'identify', token: saliente.token }));
    await sleep(500);
    const q4 = anillo(0.161);
    const otraVez = await mandar(s12.token, [{ lat: q4.lat, lng: q4.lng, speed: 18, timestamp: Date.now() }]);
    ok('identificarse por WS devuelve el mando: M-12 manda de nuevo', otraVez.status === 200 && otraVez.body.gpsRole === true && otraVez.body.aceptadas === 1, otraVez.body);
    const relevado = await mandar(relevoHttp.token, [{ ...anillo(0.162), speed: 18, timestamp: Date.now() }]);
    ok('y ahora el relevo es el de afuera', relevado.body.gpsRole === false, relevado.body);
    try { wsVuelve.close(); } catch {}
  }

  console.log('\nLA COORDENADA INVÁLIDA Y EL RELOJ ADELANTADO');
  // De la revisión del 10/9 (C1, C5). Por HTTP bastaba con que lat y lng
  // fueran números: un `lat: 999` ordenaba la cadena de brechas de la ruta.
  // Y un reloj adelantado mandaba todo del futuro y recibía un 400 mudo.
  {
    const mal = await mandar(s12.token, [{ lat: 999, lng: 9999, speed: 18, timestamp: Date.now() }]);
    ok('lat 999 no entra: 400 «ninguna posición utilizable»', mal.status === 400, mal.body);
    ok('y la unidad sigue donde estaba', vista() && Math.abs(vista().lat) < 90, vista() && vista().lat);
    const q = anillo(0.163);
    const futuro = await mandar(s12.token, [{ lat: q.lat, lng: q.lng, speed: 18, timestamp: Date.now() + 10 * 60_000 }]);
    ok('todo del futuro: 400 que DICE que el reloj está adelantado y cuánto',
       futuro.status === 400 && futuro.body.reloj === 'adelantado' && futuro.body.adelantoSec > 540 && futuro.body.adelantoSec < 660, futuro.body);
  }

  console.log('\nEL GPS SIMULADO SE DICE, NO SE ESCONDE');
  // De TRUCOS-2026-09-10.md, el primer paso: Android marca la posición que
  // sale de una app de «ubicación simulada» (fake GPS) y la app la manda con
  // `simulado: true`. El servidor no la descarta —sería esconderle a
  // Despacho justo lo que tiene que ver—: la unidad queda marcada, la
  // auditoría lo anota una vez por episodio, y al volver el GPS real se limpia.
  {
    const sim = anillo(0.17);
    const actAntes = (await fetch(`${API}/admin/audit`, { headers: H }).then(r => r.json())).events
      .filter(e => e.action === 'gps_simulado' && e.target === 'M-12').length;
    await mandar(s12.token, [{ lat: sim.lat, lng: sim.lng, speed: 20, timestamp: Date.now(), simulado: true }]);
    await sleep(700);
    ok('la posición simulada entra igual y la unidad queda marcada', vista()?.gpsSimulado === true, vista()?.gpsSimulado);
    const sim2 = anillo(0.171);
    await mandar(s12.token, [{ lat: sim2.lat, lng: sim2.lng, speed: 20, timestamp: Date.now(), simulado: true }]);
    await sleep(500);
    const act = (await fetch(`${API}/admin/audit`, { headers: H }).then(r => r.json())).events
      .filter(e => e.action === 'gps_simulado' && e.target === 'M-12').length;
    ok('y la auditoría lo anota UNA vez por episodio, no por posición', act === actAntes + 1, act - actAntes);
    const real = anillo(0.172);
    await mandar(s12.token, [{ lat: real.lat, lng: real.lng, speed: 20, timestamp: Date.now() }]);
    await sleep(700);
    ok('con el GPS de verdad otra vez, la marca se va', vista()?.gpsSimulado === false, vista()?.gpsSimulado);
  }

  console.log('\nVACIAR ATRASO NO ES ESTAR MUERTO');
  // Salió de los logs de producción: la app vaciaba su cola tras un corte
  // —posiciones viejas con su hora real, que el servidor acepta a propósito
  // para las vueltas— y el barrido de frescura, que juzgaba por la hora de
  // la POSICIÓN, la olvidaba en bucle cada 10 s mientras el teléfono seguía
  // llegando perfectamente. Son dos edades: la de la posición (gobierna el
  // gris) y la del enlace (gobierna el olvido).
  //
  // Una posición de hace un minuto, sola, y el barrido (cada 10 s fijos).
  {
    const p = anillo(0.2);
    await mandar(s12.token, [{ lat: p.lat, lng: p.lng, speed: 15, timestamp: Date.now() - 60_000 }]);
  }
  await sleep(11_000);
  ok('la unidad sigue en el estado: se la OYE, aunque su posición sea vieja',
     !!vista(), (estado?.units || []).map(u => u.unitId));
  ok('dibujada en gris — dónde está AHORA no se sabe, y eso se dice',
     vista()?.sinSenal === true, vista());

  console.log('\nEL RELOJ DEL TELÉFONO ATRASADO NO ES ESTAR MUDO');
  // De la revisión del 8/9 (L5). Un Android con la hora un minuto atrás
  // manda cada 2 s, perfecto, y NINGUNA posición pasaba por fresca: gris el
  // turno entero, los vecinos sin tiempo contra ella. Un teléfono así viene
  // atrasado DESDE QUE ARRANCA el turno (M-13, sin historia): si el reloj
  // saltara hacia atrás a mitad de turno, sus posiciones serían «ya vistas»
  // —más viejas que la última conocida— durante lo que saltó, y eso se
  // acepta (ver server/reloj.js).
  const s13 = await login('M-13', 'clave1234');
  const vista13 = () => (estado?.units || []).find(u => u.unitId === 'M-13');
  {
    const p = anillo(0.30);
    await mandar(s13.token, [{ lat: p.lat, lng: p.lng, speed: 15, timestamp: Date.now() - 60_000 }]);
  }
  await sleep(11_000);   // un barrido entero: con una sola muestra no se cree nada
  ok('con una sola posición «de hace un minuto», gris, como corresponde',
     vista13()?.sinSenal === true, vista13() && { sinSenal: vista13().sinSenal, reloj: vista13().relojAtrasadoS });
  // Y ahora sostenido: cada 2 s durante 16 s, siempre un minuto atrás. Dos
  // plazos de «sin señal» (acá 4 s) y el servidor concluye que es el reloj.
  for (let i = 1; i <= 8; i++) {
    const p = anillo(0.30 + i * 0.001);
    await mandar(s13.token, [{ lat: p.lat, lng: p.lng, speed: 15, timestamp: Date.now() - 60_000 }]);
    await sleep(2000);
  }
  ok('sostenido, la saca del gris: se la oye y se sabe cuánto atrasa',
     vista13()?.sinSenal === false, vista13() && { sinSenal: vista13().sinSenal, reloj: vista13().relojAtrasadoS });
  ok('y dice cuánto: ~60 s', vista13()?.relojAtrasadoS >= 58 && vista13()?.relojAtrasadoS <= 63, vista13()?.relojAtrasadoS);
  // El reloj se sincroniza: llega una posición con la hora bien. Sigue en
  // color, y el sesgo vuelve a cero.
  {
    const p = anillo(0.31);
    await mandar(s13.token, [{ lat: p.lat, lng: p.lng, speed: 20, timestamp: Date.now() }]);
  }
  await sleep(700);
  ok('una posición con la hora bien la deja en color', vista13()?.sinSenal === false, vista13()?.sinSenal);
  ok('y el reloj deja de contar como atrasado', vista13()?.relojAtrasadoS === 0, vista13()?.relojAtrasadoS);
  // M-12 sigue donde estaba, para lo que viene
  const fresca = anillo(0.25);
  await mandar(s12.token, [{ lat: fresca.lat, lng: fresca.lng, speed: 20, timestamp: Date.now() }]);
  await sleep(700);
  ok('una posición fresca saca del gris a M-12', vista()?.sinSenal === false, vista()?.sinSenal);

  console.log('\nCERRAR EL SOCKET CON EL HTTP VIVO NO ES QUEDARSE MUDO');
  // De la revisión del 8/9 (L7). La app nativa manda el GPS por HTTP y usa
  // el socket para el chat y el estado; con la pantalla apagada el socket se
  // cae y el GPS sigue. Cerrarlo marcaba «sin señal» en el acto, con brechas
  // en null para los vecinos hasta el siguiente POST.
  ws2.close();
  await sleep(500);
  const ws3 = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws3.on('open', res));
  ws3.send(JSON.stringify({ type: 'identify', token: s12.token }));
  await sleep(500);
  {
    const p = anillo(0.26);
    await mandar(s12.token, [{ lat: p.lat, lng: p.lng, speed: 20, timestamp: Date.now() }]);
  }
  ws3.close();
  await sleep(900);
  ok('al cerrar el socket recién oída por HTTP, sigue en color', vista()?.sinSenal === false, vista()?.sinSenal);
  ok('y si de verdad se calla, el barrido la marca como a cualquiera',
     await (async () => { for (let i = 0; i < 30; i++) { if (vista()?.sinSenal === true) return true; await sleep(500); } return false; })(),
     vista()?.sinSenal);

  ws.close(); ws2.close();
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
