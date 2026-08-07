// El perfil del conductor (PENDIENTES 3.5): lo SUYO, y nada más.
//
// Tres cosas se defienden acá:
//
//   1. El espejo dice la verdad: las vueltas son del VEHÍCULO y las horas
//      de la PERSONA — el mismo criterio del panel del gerente, porque si
//      los dos números difieren alguien tiene razón y el otro no.
//   2. El alias que el chofer se edita llega EN VIVO a Despacho: el perfil
//      en memoria, la unidad del mapa y el próximo estado. Un alias que
//      solo cambia en la base es dos nombres para la misma persona.
//   3. La contraseña se cambia con la actual en la mano, y el intento
//      queda auditado — QUE la cambió, nunca cuál es.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/perfil-test.db';
const P = 3180;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           STATE_INTERVAL_MS: '400' },
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

const pedir = (ruta, token, opts = {}) => fetch(API + ruta, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const dias = n => Date.now() - n * 86400_000;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const gerente = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  for (const [u, n] of [['M-01', 'Elmer Ccama'], ['M-02', 'Rufino Quispe']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: gerente,
      body: JSON.stringify({ unitId: u, name: n, password: 'clave1234' }) });
  }

  // El historial se siembra a mano: dos vueltas de ayer (una en objetivo,
  // una fuera), una de hoy sin vara, una VIEJA (fuera de los 7 días) y una
  // AJENA — las últimas dos existen para no aparecer.
  {
    const b = new Database(DB);
    const vuelta = b.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt,
      durationSec, avgSpeed, brechaProm, objetivoSec) VALUES (?, 'R-14', ?, ?, 3000, 22, ?, ?)`);
    vuelta.run('M-01', dias(1), dias(1), 120, 120);       // clavada en el objetivo
    vuelta.run('M-01', dias(1), dias(1) + 1, 300, 120);   // muy afuera (150 %)
    vuelta.run('M-01', Date.now() - 3600e3, Date.now() - 3600e3, null, null); // hoy, sin vara
    vuelta.run('M-01', dias(30), dias(30), 120, 120);     // vieja: fuera de los 7 días
    vuelta.run('M-02', dias(1), dias(1), 120, 120);       // ajena: de otra combi
    const turno = b.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role,
      startedAt, endedAt, lastSeenAt) VALUES (?, ?, 'R-14', 'driver', ?, ?, ?)`);
    turno.run('M-01', 'M-01', dias(2), dias(2) + 4 * 3600e3, dias(2) + 4 * 3600e3); // 4 h anteayer
    turno.run('M-02', 'M-02', dias(1), dias(1) + 8 * 3600e3, dias(1) + 8 * 3600e3); // ajeno
    b.close();
  }

  const s1 = await login('M-01', 'clave1234');

  console.log('\nEL ESPEJO DICE LO SUYO — Y SOLO LO SUYO');
  {
    const r = await pedir('/perfil', s1.token);
    const m = r.body.metricas || {};
    ok('contesta con quién es', r.status === 200 && r.body.persona?.name === 'Elmer Ccama', r.body.persona);
    ok('y en qué anda', r.body.vehiculo?.vehicleId === 'M-01' && r.body.ruta?.routeId === 'R-14',
       { vehiculo: r.body.vehiculo, ruta: r.body.ruta });
    ok('las vueltas de los 7 días son las suyas: ni la vieja ni la ajena',
       m.vueltas === 3, m.vueltas);
    ok('la de hoy se distingue', m.vueltasHoy === 1, m.vueltasHoy);
    ok('el cumplimiento juzga solo las que tienen su vara guardada: 1 de 2',
       m.cumplimiento === 50 && m.juzgables === 2, m);
    ok('las horas son de la persona: 4 h, no las 8 del otro',
       m.horasSec === 4 * 3600, m.horasSec);
    ok('y hoy, cero', m.horasHoySec === 0, m.horasHoySec);
  }

  console.log('\nEL BORDE');
  {
    const d = await login('DESPACHO', 'despacho99');
    const r = await pedir('/perfil', d.token);
    ok('Despacho tiene sus paneles: acá 403', r.status === 403, r.status);
    const sin = await pedir('/perfil', 'token-inventado');
    ok('sin sesión, 401', sin.status === 401, sin.status);
  }

  console.log('\nEL ALIAS LLEGA EN VIVO A DESPACHO');
  {
    // M-01 conectado y reportando; M-02 mira la ruta. El alias tiene que
    // cambiar en el estado que M-02 recibe SIN que nadie vuelva a entrar.
    const ws1 = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws1.on('open', r));
    ws1.send(JSON.stringify({ type: 'identify', token: s1.token }));
    const s2 = await login('M-02', 'clave1234');
    const ws2 = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws2.on('open', r));
    let estado = null;
    ws2.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estado = m; });
    ws2.send(JSON.stringify({ type: 'identify', token: s2.token }));
    await sleep(300);
    ws1.send(JSON.stringify({ type: 'gps', lat: -15.4904, lng: -70.1333, speed: 20 }));
    await sleep(700);
    const nombreDe = () => (estado?.units || []).find(u => u.unitId === 'M-01')?.driverName;
    ok('antes del cambio firma con su nombre', nombreDe() === 'Elmer Ccama', nombreDe());

    const r = await pedir('/perfil/alias', s1.token, { method: 'POST',
      body: JSON.stringify({ alias: 'El Puma' }) });
    ok('el alias se guarda', r.status === 200 && r.body.alias === 'El Puma', r.body);
    await sleep(700);
    ok('y el mapa de todos ya lo llama así — sin volver a entrar',
       nombreDe() === 'El Puma', nombreDe());

    const b = new Database(DB, { readonly: true });
    const enBase = b.prepare("SELECT alias, driverName FROM users WHERE unitId = 'M-01'").get();
    const auditado = b.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'alias_propio' AND actor = 'M-01'").get().n;
    b.close();
    ok('la base quedó igual que la pantalla', enBase.alias === 'El Puma' && enBase.driverName === 'El Puma', enBase);
    ok('y el cambio quedó auditado', auditado === 1, auditado);
    ws1.close(); ws2.close();
  }

  console.log('\nLA CONTRASEÑA, CON LA ACTUAL EN LA MANO');
  {
    let r = await pedir('/perfil/clave', s1.token, { method: 'POST',
      body: JSON.stringify({ actual: 'no-es-esta', nueva: 'nueva-clave-9' }) });
    ok('sin la actual correcta, 403', r.status === 403, r.status);

    r = await pedir('/perfil/clave', s1.token, { method: 'POST',
      body: JSON.stringify({ actual: 'clave1234', nueva: 'corta' }) });
    ok('una nueva demasiado corta, 400', r.status === 400, r.status);

    r = await pedir('/perfil/clave', s1.token, { method: 'POST',
      body: JSON.stringify({ actual: 'clave1234', nueva: 'nueva-clave-9' }) });
    ok('con la actual en la mano, cambia', r.status === 200, r.status);

    const vieja = await login('M-01', 'clave1234');
    const nueva = await login('M-01', 'nueva-clave-9');
    ok('la vieja ya no abre', !vieja.token, vieja.error);
    ok('la nueva sí', !!nueva.token);
    const sigue = await pedir('/perfil', s1.token);
    ok('y la sesión con la que la cambió sigue viva — el que cambió fue él',
       sigue.status === 200, sigue.status);

    const b = new Database(DB, { readonly: true });
    const fila = b.prepare("SELECT detail FROM audit WHERE action = 'clave_propia' AND actor = 'M-01'").get();
    b.close();
    ok('auditado QUE la cambió, nunca cuál es', fila !== undefined && !fila.detail, fila);
  }

  servidor.kill();
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { servidor.kill(); } catch {}
  process.exit(1);
});
