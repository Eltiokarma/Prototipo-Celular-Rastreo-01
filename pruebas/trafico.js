// La parada sostenida y el aviso de tráfico, contra el servidor de verdad.
//
// Lo que se defiende: que una combi que lleva N minutos sin avanzar por la
// ruta quede marcada sola (`parado`), que el chofer pueda decirlo antes de
// un toque (`trafico`) por WebSocket y por HTTP, que las dos cosas lleguen
// al de atrás en su brecha —para que deje de recibir "apurá" hacia el
// embotellamiento—, que se apaguen solas al volver a andar, que el terminal
// no cuente, y que cada episodio quede guardado con dónde y cuánto.
//
// Los plazos se acortan por entorno: 3 s en vez de 3 min.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/trafico-test.db';
const P = 3197;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un anillo de 900 m de radio: ~5655 m de circuito, ida y vuelta de media
// vuelta cada una. `t` es la fracción del círculo.
const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});
const CIRCUITO_M = 2 * Math.PI * 900;

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '300',
           PARADA_MS: '3000', PARADA_LIBRE_MS: '1500', TRAFICO_GRACIA_MS: '1500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { salida += d; });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
let salida = '';

const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

const post = (ruta, token, cuerpo) => fetch(API + ruta, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify(cuerpo),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// N posiciones en el mismo punto (o avanzando), con su hora: el servidor
// mide con la hora de cada posición, así que 3 s de parada caben en un POST.
const quieto = (t, n, desdeMs, pasoMs = 500) =>
  Array.from({ length: n }, (_, i) => {
    const p = anillo(t);
    return { lat: p.lat, lng: p.lng, speed: 0, timestamp: desdeMs + i * pasoMs };
  });
const avanzando = (t0, metros, n, desdeMs, pasoMs = 500) =>
  Array.from({ length: n }, (_, i) => {
    const p = anillo(t0 + (metros / CIRCUITO_M) * (i + 1) / n);
    return { lat: p.lat, lng: p.lng, speed: 25, timestamp: desdeMs + i * pasoMs };
  });

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
  for (const [u, n] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: n, personRole: 'driver', password: 'clave1234' }) });
  }
  const altaCobrador = await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'C-12', name: 'Cobrador Doce', personRole: 'collector',
                           vehicleId: 'M-12', password: 'clave1234' }) }).then(r => r.status);

  const s12 = await login('M-12', 'clave1234');   // la que se traba, adelante
  const s08 = await login('M-08', 'clave1234');   // la que viene atrás

  // El de atrás mira el estado por WebSocket, como una combi de verdad
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => ws.on('open', res));
  let estado = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
  ws.send(JSON.stringify({ type: 'identify', token: s08.token }));
  await sleep(600);
  const vista = (id = 'M-12') => (estado?.units || []).find(u => u.unitId === id);
  const brechaDe = (id) => estado?.gaps?.[id] || null;

  console.log('\nTRES "MINUTOS" SIN AVANZAR = PARADA, SOLA');
  {
    // M-08 atrás, andando; M-12 adelante, a mitad de la ida, clavada
    let t = Date.now() - 6000;
    const r08 = await post('/gps', s08.token, { posiciones: quieto(0.15, 1, t) });
    ok('la de atrás también reporta', r08.status === 200, r08.body);
    let r = await post('/gps', s12.token, { posiciones: quieto(0.25, 5, t) });   // 2 s parada
    ok('acepta las posiciones', r.status === 200 && r.body.aceptadas === 5, r.body);
    await sleep(500);
    ok('a los 2 s todavía no es parada', vista()?.parado === false, vista()?.parado);
    r = await post('/gps', s12.token, { posiciones: quieto(0.25, 4, t + 2500) });  // hasta 4 s
    await sleep(500);
    ok('pasados los 3 s, la unidad queda PARADA', vista()?.parado === true, vista());
    ok('con la hora desde la que no avanza', typeof vista()?.paradoDesde === 'number' && Math.abs(vista().paradoDesde - t) < 1500,
       { desde: vista()?.paradoDesde, t });
    ok('y no es "tráfico": nadie lo dijo todavía', vista()?.trafico === false, vista()?.trafico);
    ok('el servidor lo cuenta en el log', /Parada: M-12 lleva/.test(salida), salida.split('\n').filter(l => /Parada/.test(l)));

    // Lo que ve el de atrás en su brecha
    const g = brechaDe('M-08');
    ok('al de atrás le llega en su brecha: adelante en tráfico',
       g?.aheadUnit === 'M-12' && g.aheadEnTrafico === true && g.aheadTraficoConfirmado === false,
       { g, unidades: (estado?.units || []).map(u => [u.unitId, u.lat, u.enRuta, u.presencia, u.sinSenal]), gaps: Object.keys(estado?.gaps || {}) });
    ok('con la hora, para decir "hace N min"', typeof g?.aheadTraficoDesde === 'number', g?.aheadTraficoDesde);
    ok('y la de adelante ve al de atrás sin tráfico', brechaDe('M-12')?.behindEnTrafico === false, brechaDe('M-12'));
  }

  console.log('\nEL CHOFER LO CONFIRMA DE UN TOQUE');
  {
    const r = await post('/trafico', s12.token, { activo: true });
    ok('POST /trafico acepta', r.status === 200 && r.body.activo === true, r.body);
    await sleep(500);
    ok('la unidad pasa a EN TRÁFICO, sin perder la parada',
       vista()?.trafico === true && typeof vista()?.traficoDesde === 'number' && vista()?.parado === true, vista());
    ok('y el de atrás lo ve confirmado', brechaDe('M-08')?.aheadTraficoConfirmado === true, brechaDe('M-08'));
    const db2 = new Database(DB, { readonly: true });
    const fila = db2.prepare("SELECT * FROM paradas WHERE vehicleId = 'M-12' ORDER BY id DESC LIMIT 1").get();
    db2.close();
    ok('el episodio abierto quedó marcado como confirmado por el chofer',
       fila && fila.endedAt === null && fila.confirmado === 1, fila);
    ok('con dónde y en qué punto del circuito',
       fila && typeof fila.lat === 'number' && typeof fila.progreso === 'number' && fila.tramo === 'ida', fila);
  }

  console.log('\nAL VOLVER A ANDAR SE APAGA SOLO');
  {
    const t = Date.now() - 2000;
    // 200 m en 1,5 s: mucho más que los 100 m del último "minuto" (1,5 s)
    await post('/gps', s12.token, { posiciones: avanzando(0.25, 200, 4, t) });
    await sleep(500);
    ok('ya no está parada', vista()?.parado === false, vista());
    ok('y el aviso de tráfico se apagó solo: nadie tuvo que desmarcar', vista()?.trafico === false, vista());
    ok('el de atrás vuelve a la brecha de siempre', brechaDe('M-08')?.aheadEnTrafico === false, brechaDe('M-08'));
    ok('el servidor dice que siguió', /Sigue: M-12 volvió a andar/.test(salida));
    const db2 = new Database(DB, { readonly: true });
    const fila = db2.prepare("SELECT * FROM paradas WHERE vehicleId = 'M-12' ORDER BY id DESC LIMIT 1").get();
    db2.close();
    ok('el episodio quedó cerrado como "se movió", con su duración',
       fila && fila.endedAt !== null && fila.cierre === 'movio' && fila.durationSec >= 3 && fila.confirmado === 1, fila);
  }

  console.log('\nLA PALABRA DEL CHOFER SIN PARADA AUTOMÁTICA');
  {
    // Va lento pero circula: la parada automática no salta. Marca tráfico.
    ws.send(JSON.stringify({ type: 'trafico', activo: true }));   // el de ATRÁS (M-08) avisa por WebSocket
    await sleep(500);
    ok('por WebSocket también', vista('M-08')?.trafico === true && vista('M-08')?.parado === false, vista('M-08'));
    ok('y la de adelante lo ve atrás en tráfico', brechaDe('M-12')?.behindEnTrafico === true && brechaDe('M-12')?.behindTraficoConfirmado === true,
       brechaDe('M-12'));
    // Se arrepiente: lo retira a mano
    ws.send(JSON.stringify({ type: 'trafico', activo: false }));
    await sleep(500);
    ok('retirarlo a mano lo apaga', vista('M-08')?.trafico === false, vista('M-08'));
    const db2 = new Database(DB, { readonly: true });
    const fila = db2.prepare("SELECT * FROM paradas WHERE vehicleId = 'M-08' ORDER BY id DESC LIMIT 1").get();
    db2.close();
    ok('y el episodio queda cerrado como retirado por el chofer', fila && fila.cierre === 'chofer' && fila.confirmado === 1, fila);
  }
  {
    // Marcado a mano mientras arrastra (200 m en 4 s: circula, no es parada
    // medida), y después arranca: se apaga por andar. Ojo con dejarla quieta
    // acá: M-08 ya tenía una posición en el mismo punto de hace rato, y desde
    // el arreglo de la ventana (10/9) eso SÍ es una parada medida.
    let t = Date.now() - 4000;
    await post('/gps', s08.token, { posiciones: avanzando(0.18, 300, 4, t, 1000) });
    await post('/trafico', s08.token, { activo: true });
    await sleep(400);
    ok('marcado a mano, sin parada automática', vista('M-08')?.trafico === true && vista('M-08')?.parado === false, vista('M-08'));
    // Recién marcado: la gracia. Dos posiciones rápidas no lo apagan todavía.
    await post('/gps', s08.token, { posiciones: avanzando(0.233, 60, 2, t + 3200) });
    await sleep(400);
    ok('en el minuto de gracia no se apaga aunque ande', vista('M-08')?.trafico === true, vista('M-08'));
    await sleep(1600);   // pasa la gracia (1,5 s)
    await post('/gps', s08.token, { posiciones: avanzando(0.2436, 200, 3, Date.now() - 1200) });
    await sleep(400);
    ok('pasada la gracia, al andar se apaga solo', vista('M-08')?.trafico === false, vista('M-08'));
  }

  console.log('\nLO QUE NO CUENTA');
  {
    // En el terminal (el principio de la ida) se espera: no es parada
    const t = Date.now() - 6000;
    await post('/gps', s12.token, { posiciones: quieto(0.005, 10, t) });
    await sleep(500);
    ok('parada en el terminal no se marca', vista()?.parado === false, vista());
  }
  {
    // Ausente: fuera de la cadena, parado todo lo que quiera
    await post('/presencia', s12.token, { estado: 'ausente' });
    const t = Date.now() - 6000;
    await post('/gps', s12.token, { posiciones: quieto(0.30, 10, t) });
    await sleep(500);
    ok('ausente y quieta no es parada', vista()?.parado === false && vista()?.presencia === 'ausente', vista());
    await post('/presencia', s12.token, { estado: 'ruta' });
  }
  {
    const cob = await login('C-12', 'clave1234');
    ok('el cobrador se dio de alta', altaCobrador === 200, altaCobrador);
    const r = await post('/trafico', cob.token, { activo: true });
    ok('el cobrador no avisa tráfico: 403', r.status === 403, r.status);
    const r2 = await post('/trafico', s12.token, { activo: 'sí' });
    ok('sin un booleano, 400', r2.status === 400, r2.status);
    const r3 = await fetch(API + '/trafico', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: true }) }).then(r => r.status);
    ok('sin sesión, 401', r3 === 401, r3);
  }

  console.log('\nLOS EPISODIOS SE PUEDEN LEER');
  {
    const r = await fetch(API + '/admin/paradas?dias=7', { headers: H }).then(async x => ({ status: x.status, body: await x.json() }));
    ok('Despacho lista las paradas de la cooperativa', r.status === 200 && Array.isArray(r.body.paradas) && r.body.paradas.length >= 2,
       r.body.paradas?.length);
    const p = r.body.paradas.find(x => x.vehicleId === 'M-12' && x.cierre === 'movio');
    ok('con unidad, ruta, dónde, cuánto y si el chofer lo confirmó',
       p && p.routeId === 'R-14' && typeof p.lat === 'number' && p.durationSec >= 3 && p.confirmado === 1, p);
    const sinSesion = await fetch(API + '/admin/paradas').then(x => x.status);
    ok('sin sesión de Despacho, 401', sinSesion === 401, sinSesion);
    const r2 = await fetch(API + '/admin/paradas?dias=0', { headers: H }).then(x => x.json());
    ok('los días se recortan a algo razonable', r2.dias === 7, r2.dias);
    const r3 = await fetch(API + '/admin/paradas?dias=9999', { headers: H }).then(x => x.json());
    ok('y por arriba también', r3.dias === 365, r3.dias);
  }

  console.log('\nNO QUEDA NADA ABIERTO');
  {
    await post('/presencia', s12.token, { estado: 'fuera' });
    await sleep(400);
    const db2 = new Database(DB, { readonly: true });
    const abiertas = db2.prepare('SELECT COUNT(*) c FROM paradas WHERE endedAt IS NULL').get().c;
    db2.close();
    ok('al salir de ruta no queda ningún episodio abierto', abiertas === 0, abiertas);
  }

  ws.close();
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})();
