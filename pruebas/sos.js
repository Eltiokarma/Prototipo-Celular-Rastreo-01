// El tipo de emergencia del SOS — y el orden de las cosas.
//
// El deslizar manda la alerta YA, sin preguntar nada: en una emergencia real
// nadie navega un menú antes de pedir ayuda. El tipo ("falla mecánica",
// "accidente", "policía") se elige DESPUÉS, con la alerta ya sonando en
// Despacho, y sin elegir queda el SOS genérico de siempre. Lo que esta suite
// defiende son los bordes de ese "después":
//
//   - solo quien disparó puede calificar SU emergencia (sin este borde,
//     cualquiera de la ruta reescribe la emergencia de otro);
//   - solo mientras está viva (después es editar historia);
//   - un tipo inventado no entra;
//   - y el historial y el informe cuentan lo mismo que se vio en vivo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/sos-test.db';
const P = 3178;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Acortada para poder probar que CIERRA sin esperar 15 minutos. Los casos de
// adentro corren en el primer segundo; el de afuera espera a que venza.
const VENTANA_MS = 4000;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           SOS_TIPO_VENTANA_MS: String(VENTANA_MS) },
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

async function conectar(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  await new Promise((r, x) => { ws.on('open', r); ws.on('error', x); });
  const visto = { alertas: [], tipos: [], historial: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'sos_alert') visto.alertas.push(m);
    if (m.type === 'sos_tipo') visto.tipos.push(m);
    if (m.type === 'chat_history') visto.historial = m.items;
  });
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(250);
  return { ws, visto };
}

async function hasta(cond, ms = 6000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(100); }
  return false;
}

const tipoEnBase = (id) =>
  new Database(DB, { readonly: true }).prepare(
    "SELECT sosTipo FROM messages WHERE id = ?").get(id)?.sosTipo ?? null;

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const gerente = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  for (const u of ['M-01', 'M-02']) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: gerente,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'clave1234' }) });
  }
  const s1 = await login('M-01', 'clave1234');
  const s2 = await login('M-02', 'clave1234');
  const uno = await conectar(s1.token);
  const dos = await conectar(s2.token);

  console.log('\nDISPARAR ES LO PRIMERO, Y NO PIDE NADA');
  uno.ws.send(JSON.stringify({ type: 'sos', lat: -15.49, lng: -70.13, timestamp: Date.now() }));
  await hasta(() => dos.visto.alertas.length >= 1);
  const alerta = dos.visto.alertas[0] || {};
  const sosId = alerta.sosId;
  {
    ok('la alerta llega a la ruta sin que nadie elija nada', dos.visto.alertas.length === 1, dos.visto.alertas.length);
    ok('y trae el id del disparo — el ancla del tipo', Number.isInteger(sosId), alerta);
    ok('en la base nace GENÉRICO (sin tipo)', tipoEnBase(sosId) === null, tipoEnBase(sosId));
  }

  console.log('\nEL TIPO VA DESPUÉS, CON LA ALERTA YA ENVIADA');
  {
    uno.ws.send(JSON.stringify({ type: 'sos_tipo', sosId, tipo: 'accidente' }));
    ok('la ruta se entera del tipo', await hasta(() => dos.visto.tipos.length >= 1), dos.visto.tipos);
    ok('con el id del MISMO disparo', dos.visto.tipos[0]?.sosId === sosId, dos.visto.tipos[0]);
    ok('y la base lo guarda', tipoEnBase(sosId) === 'accidente', tipoEnBase(sosId));

    // Se equivocó de botón: dentro de la ventana puede corregir.
    uno.ws.send(JSON.stringify({ type: 'sos_tipo', sosId, tipo: 'mecanica' }));
    ok('corregir dentro de la ventana vale', await hasta(() => tipoEnBase(sosId) === 'mecanica'),
       tipoEnBase(sosId));
  }

  console.log('\nLOS BORDES: QUIÉN, QUÉ Y HASTA CUÁNDO');
  {
    // Otro chofer de la ruta intenta reescribir la emergencia ajena.
    const tiposAntes = dos.visto.tipos.length;
    dos.ws.send(JSON.stringify({ type: 'sos_tipo', sosId, tipo: 'policia' }));
    await sleep(500);
    ok('otro chofer NO puede calificar una emergencia ajena',
       tipoEnBase(sosId) === 'mecanica', tipoEnBase(sosId));

    uno.ws.send(JSON.stringify({ type: 'sos_tipo', sosId, tipo: 'ovni' }));
    await sleep(500);
    ok('un tipo inventado no entra', tipoEnBase(sosId) === 'mecanica', tipoEnBase(sosId));
    ok('y ninguno de los dos intentos hizo ruido en la ruta',
       dos.visto.tipos.length === tiposAntes, dos.visto.tipos.length - tiposAntes);

    // La ventana cierra: pasada, ya no es calificar — es editar historia.
    await sleep(Math.max(0, VENTANA_MS + 600 - (Date.now() - alerta.timestamp)));
    uno.ws.send(JSON.stringify({ type: 'sos_tipo', sosId, tipo: 'policia' }));
    await sleep(500);
    ok('pasada la ventana, ni el que disparó puede cambiarlo',
       tipoEnBase(sosId) === 'mecanica', tipoEnBase(sosId));
  }

  console.log('\nEL QUE LLEGA DESPUÉS VE LO MISMO QUE EL QUE ESTUVO');
  {
    // Reconexión: el historial trae el SOS ya calificado, con su id.
    const tres = await conectar(s2.token);
    await hasta(() => tres.visto.historial !== null);
    const delHilo = (tres.visto.historial || []).find(i => i.kind === 'sos');
    ok('el historial trae el tipo y el ancla',
       delHilo?.sosTipo === 'mecanica' && delHilo?.sosId === sosId, delHilo);
    tres.ws.close();
  }

  console.log('\nEL INFORME DEJA DE SER UNA LISTA PLANA');
  {
    const d = await login('DESPACHO', 'despacho99');
    const csv = await fetch(`${API}/admin/informe/sos.csv`, {
      headers: { Authorization: 'Bearer ' + d.token } }).then(r => r.text());
    ok('el CSV tiene la columna Tipo', /Tipo/.test(csv), csv.split('\r\n')[6]);
    ok('y la fila dice qué fue', /Falla mecánica/.test(csv), csv.split('\r\n').slice(7, 9));
  }

  console.log('\nY POR HTTP, CUANDO EL SOCKET NO ESTÁ');
  // De la revisión del 8/9 (A1): el SOS era sólo WebSocket. La pantalla
  // recién desbloqueada tiene el socket muerto y el reintento esperando de
  // 3 a 30 s: deslizar no mandaba nada. `POST /sos` es la puerta que queda.
  {
    const antes = dos.visto.alertas.length;
    const r = await fetch(`${API}/sos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s1.token },
      body: JSON.stringify({ lat: -15.49, lng: -70.13, timestamp: Date.now() }) });
    const cuerpo = await r.json();
    ok('POST /sos contesta con la alerta y su id', r.status === 200 && cuerpo.ok === true && Number.isInteger(cuerpo.sosId), cuerpo);
    ok('con quién y desde dónde', cuerpo.unitId === 'M-01' && cuerpo.lat === -15.49, cuerpo);
    ok('y le llega a la ruta igual que por el socket',
       await hasta(() => dos.visto.alertas.length === antes + 1) && dos.visto.alertas.at(-1).sosId === cuerpo.sosId,
       dos.visto.alertas.length - antes);
    ok('queda en la base, genérico', tipoEnBase(cuerpo.sosId) === null);
    // Y el tipo se le puede poner después, por el socket, con ese id
    uno.ws.send(JSON.stringify({ type: 'sos_tipo', sosId: cuerpo.sosId, tipo: 'policia' }));
    ok('y se lo puede tipificar después con ese id', await hasta(() => tipoEnBase(cuerpo.sosId) === 'policia'), tipoEnBase(cuerpo.sosId));

    const sinToken = await fetch(`${API}/sos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok('sin sesión, 401', sinToken.status === 401, sinToken.status);
    const d = await login('DESPACHO', 'despacho99');
    const despacho = await fetch(`${API}/sos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token }, body: '{}' });
    ok('Despacho no manda SOS: 403', despacho.status === 403, despacho.status);
    // Con basura en vez de coordenadas sale igual, sin posición
    const basura = await fetch(`${API}/sos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s1.token },
      body: JSON.stringify({ lat: 'acá', lng: null }) }).then(r => r.json());
    ok('con coordenadas inválidas sale igual, sin posición', basura.ok === true && basura.lat === null, basura);
    // El cupo: 5 por minuto por persona
    let ultimo = 200;
    for (let i = 0; i < 6; i++) {
      ultimo = (await fetch(`${API}/sos`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s1.token }, body: '{}' })).status;
    }
    ok('más de cinco por minuto, 429: un cliente roto no inunda a Despacho', ultimo === 429, ultimo);
  }

  console.log('\nEL TIPO TAMBIÉN POR HTTP: SIN ESO, AMBULANCIA O GRÚA SE ADIVINA');
  // De la revisión del 10/9 (C8). `POST /sos` existe para el socket caído, y
  // era ahí —y sólo ahí— donde el tipo no salía: el cliente lo mandaba por el
  // socket, recibía 'sin-conexion' y cerraba el diálogo como si hubiera
  // salido. Despacho veía un SOS genérico y tenía que adivinar entre una
  // ambulancia y una grúa. M-02 dispara por HTTP y tipifica por HTTP, con el
  // socket abierto sólo para MIRAR que el aviso llegue igual a la ruta.
  {
    const tipoHttp = (token, id, tipo) => fetch(`${API}/sos/${id}/tipo`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ tipo }) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    const antes = uno.visto.tipos.length;
    const disparo = await fetch(`${API}/sos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s2.token },
      body: JSON.stringify({ lat: -15.49, lng: -70.13, timestamp: Date.now() }) }).then(r => r.json());
    ok('M-02 dispara por HTTP y le vuelve el id', Number.isInteger(disparo.sosId), disparo);

    const r = await tipoHttp(s2.token, disparo.sosId, 'accidente');
    ok('POST /sos/:id/tipo lo toma', r.status === 200 && r.body.tipo === 'accidente', r.body);
    ok('y la base lo guarda', tipoEnBase(disparo.sosId) === 'accidente', tipoEnBase(disparo.sosId));
    ok('y la ruta se entera igual que por el socket',
       await hasta(() => uno.visto.tipos.length > antes &&
                         uno.visto.tipos.at(-1).sosId === disparo.sosId &&
                         uno.visto.tipos.at(-1).tipo === 'accidente'),
       uno.visto.tipos.at(-1));

    // Los mismos bordes que por el socket, pero ACÁ se contestan: el cliente
    // tiene que poder distinguir «no salió» de «salió».
    const ajena = await tipoHttp(s1.token, disparo.sosId, 'policia');
    ok('la emergencia del de al lado no se toca, y el error no confirma que exista',
       ajena.status === 404, ajena);
    ok('y sigue diciendo lo que dijo su dueño', tipoEnBase(disparo.sosId) === 'accidente', tipoEnBase(disparo.sosId));
    const inventado = await tipoHttp(s2.token, disparo.sosId, 'ovni');
    ok('un tipo inventado, 400', inventado.status === 400, inventado);
    const noExiste = await tipoHttp(s2.token, 999999, 'policia');
    ok('un id que no existe, 404', noExiste.status === 404, noExiste);
    const sinSesion = await fetch(`${API}/sos/${disparo.sosId}/tipo`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{"tipo":"policia"}' });
    ok('sin sesión, 401', sinSesion.status === 401, sinSesion.status);
    const d2 = await login('DESPACHO', 'despacho99');
    const despacho = await tipoHttp(d2.token, disparo.sosId, 'policia');
    ok('Despacho no califica emergencias ajenas: 403', despacho.status === 403, despacho);

    // Y cuando la emergencia se cerró, se DICE que se cerró: antes de esto
    // el cliente no tenía forma de distinguirlo de un éxito.
    await sleep(VENTANA_MS + 300);
    const tarde = await tipoHttp(s2.token, disparo.sosId, 'policia');
    ok('pasada la ventana, 409 y no se reescribe la historia',
       tarde.status === 409 && tipoEnBase(disparo.sosId) === 'accidente', tarde);
  }

  for (const c of [uno, dos]) { try { c.ws.close(); } catch {} }
  servidor.kill();
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { servidor.kill(); } catch {}
  process.exit(1);
});
