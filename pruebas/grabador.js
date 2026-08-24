// El grabador de recorridos (`app/grabador.js` + el ida y vuelta con el
// servidor).
//
// Primera mitad, sin servidor: la lógica pura de posiciones a puntos. Lo
// que defiende es la regla que hace servible una grabación —un punto cada
// 30 m RECORRIDOS— y que el archivo que sale entre por la puerta que ya
// existe: el import de GeoJSON del trazador, con las coordenadas en el
// orden que GeoJSON exige y no en el que uno esperaría.
//
// Segunda mitad, contra el servidor real: la grabación sube por POST
// /grabacion, la lista y el GeoJSON los baja el panel con el borde de
// empresa de siempre, y las viejas se podan solas.
const RAIZ = require('path').join(__dirname, '..');
const { crearGrabador, metrosEntre, PASO_M } = require(RAIZ + '/app/grabador.js');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/grabador-test.db';
const P = 3182;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// ~1 m en latitud. Sirve para armar movimientos de metros exactos.
const M = 1 / 111_320;
const LAT = -15.4904, LNG = -70.1333;

console.log('\nUN PUNTO CADA 30 METROS, NO CADA N SEGUNDOS');
{
  const g = crearGrabador();
  ok('la primera posición siempre queda', g.posicion(LAT, LNG) === true && g.cantidad === 1);

  // El semáforo: veinte disparos del GPS moviéndose centímetros
  for (let i = 0; i < 20; i++) g.posicion(LAT + M * 0.3 * Math.sin(i), LNG);
  ok('parado en un semáforo no se acumula un nudo de puntos', g.cantidad === 1, g.cantidad);

  // Arranca: 35 m de un saque
  ok('moverse más del paso agrega punto', g.posicion(LAT + M * 35, LNG) === true && g.cantidad === 2);
  // 20 m más: todavía no llegó al paso desde el ÚLTIMO GUARDADO
  ok('el paso se mide desde el último punto GUARDADO, no desde el anterior disparo',
     g.posicion(LAT + M * 50, LNG) === false && g.cantidad === 2, g.cantidad);
  ok('y al pasar los 30 desde el guardado, entra',
     g.posicion(LAT + M * 66, LNG) === true && g.cantidad === 3);
}

console.log('\nEL LARGO ES EL RECORRIDO, NO LA CUENTA DE PUNTOS');
{
  const g = crearGrabador();
  g.posicion(LAT, LNG);
  g.posicion(LAT + M * 40, LNG);        // 40 m al norte
  g.posicion(LAT + M * 40, LNG + M * 40 / Math.cos(LAT * Math.PI / 180)); // 40 m al este
  ok('suma los tramos guardados', Math.abs(g.largoM - 80) <= 1, g.largoM);
  ok('metrosEntre mide razonable: 111.32 km por grado de latitud',
     Math.abs(metrosEntre(LAT, LNG, LAT + 1, LNG) - 111_320) < 1,
     Math.round(metrosEntre(LAT, LNG, LAT + 1, LNG)));
}

console.log('\nSOBREVIVE A QUE ANDROID MATE EL PROCESO');
{
  // La persistencia la hace quien lo usa; acá se prueba que RETOMAR con los
  // puntos guardados deja el grabador como estaba: mismo largo, mismo paso.
  const a = crearGrabador();
  a.posicion(LAT, LNG);
  a.posicion(LAT + M * 40, LNG);
  const b = crearGrabador(a.puntos);
  ok('retoma con los puntos y el largo del muerto',
     b.cantidad === 2 && Math.abs(b.largoM - a.largoM) <= 1, { a: a.largoM, b: b.largoM });
  ok('y sigue midiendo el paso desde el último guardado',
     b.posicion(LAT + M * 50, LNG) === false && b.posicion(LAT + M * 75, LNG) === true);
}

console.log('\nEL GEOJSON ENTRA POR LA PUERTA DEL TRAZADOR');
{
  const g = crearGrabador();
  g.posicion(LAT, LNG);
  g.posicion(LAT + M * 40, LNG);
  const geo = g.geojson('Vuelta de prueba');
  const linea = geo.features?.[0];
  ok('es una FeatureCollection con una LineString',
     geo.type === 'FeatureCollection' && linea?.geometry?.type === 'LineString');
  ok('con nombre', linea.properties.name === 'Vuelta de prueba', linea.properties);
  // El error clásico de GeoJSON: [lng, lat], al revés que todo lo demás
  ok('las coordenadas van [lng, lat] — el orden que GeoJSON exige',
     linea.geometry.coordinates[0][0] === LNG && linea.geometry.coordinates[0][1] === LAT,
     linea.geometry.coordinates[0]);
}

console.log('\nBORDES');
{
  const g = crearGrabador();
  ok('una posición rota no entra ni revienta',
     g.posicion(null, LNG) === false && g.posicion(NaN, LNG) === false && g.cantidad === 0);
  ok('el geojson vacío no revienta', g.geojson().features[0].geometry.coordinates.length === 0);
  const copia = g.puntos;
  copia.push({ lat: 0, lng: 0 });
  ok('los puntos que devuelve son copia: mutarlos no toca la grabación', g.cantidad === 0);
}

// ─── SEGUNDA MITAD: EL IDA Y VUELTA CON EL SERVIDOR ─────────────
let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
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

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const gerente = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  await fetch(`${API}/admin/users`, { method: 'POST', headers: gerente,
    body: JSON.stringify({ unitId: 'M-01', name: 'Elmer Ccama', password: 'clave1234' }) });
  const s1 = await login('M-01', 'clave1234');
  const d = await login('DESPACHO', 'despacho99');

  // Una vuelta grabada como la grabaría la app: puntos cada ~35 m
  const g = crearGrabador();
  for (let i = 0; i < 60; i++) g.posicion(LAT + M * 35 * i, LNG);

  console.log('\nLA GRABACIÓN SUBE COMO SE GRABÓ');
  {
    let r = await pedir('/grabacion', s1.token, { method: 'POST',
      body: JSON.stringify({ nombre: 'Vuelta al centro', puntos: g.puntos }) });
    ok('el chofer la sube', r.status === 200 && r.body.puntos === 60, r.body);
    ok('el largo lo calcula el SERVIDOR, no se le cree al teléfono',
       Math.abs(r.body.largoM - g.largoM) <= 2, { servidor: r.body.largoM, app: g.largoM });

    r = await pedir('/grabacion', s1.token, { method: 'POST',
      body: JSON.stringify({ puntos: [{ lat: LAT, lng: LNG }] }) });
    ok('un solo punto no es un recorrido: 400', r.status === 400, r.status);
    r = await pedir('/grabacion', s1.token, { method: 'POST',
      body: JSON.stringify({ puntos: [{ lat: 'x', lng: null }, { lat: LAT, lng: LNG }] }) });
    ok('la basura no numérica se filtra y sin dos puntos buenos, 400', r.status === 400, r.status);
    r = await pedir('/grabacion', d.token, { method: 'POST',
      body: JSON.stringify({ puntos: g.puntos }) });
    ok('Despacho no graba recorridos — el que graba iba arriba: 403', r.status === 403, r.status);
  }

  console.log('\nEL PANEL LA LISTA Y LA BAJA');
  {
    let r = await pedir('/admin/grabaciones', d.token);
    const fila = (r.body.grabaciones || [])[0];
    ok('Despacho la ve en la lista, con quién y cuánto',
       r.status === 200 && fila?.nombre === 'Vuelta al centro' &&
       fila?.quien === 'Elmer Ccama' && fila?.puntos === 60, fila);

    r = await pedir('/admin/grabaciones', s1.token);
    ok('un chofer no lista grabaciones — es cosa del panel', r.status === 403, r.status);

    const geo = await fetch(`${API}/admin/grabaciones/${fila.id}.geojson`, {
      headers: { Authorization: 'Bearer ' + d.token } });
    const cuerpo = await geo.json();
    const linea = cuerpo.features?.[0];
    ok('baja como GeoJSON — la puerta que el trazador ya importa',
       geo.status === 200 && linea?.geometry?.type === 'LineString' &&
       linea.geometry.coordinates.length === 60);
    ok('con las coordenadas [lng, lat], como GeoJSON exige',
       linea.geometry.coordinates[0][0] === LNG && linea.geometry.coordinates[0][1] === LAT,
       linea.geometry.coordinates[0]);

    const nada = await fetch(`${API}/admin/grabaciones/99999.geojson`, {
      headers: { Authorization: 'Bearer ' + d.token } });
    ok('una que no existe da 404', nada.status === 404, nada.status);
  }

  console.log('\nLAS VIEJAS SE VAN SOLAS');
  {
    // 26 grabaciones más: el tope por empresa es 25, así que la primera
    // ("Vuelta al centro") tiene que haber salido de la lista.
    const dos = [{ lat: LAT, lng: LNG }, { lat: LAT + M * 40, lng: LNG }];
    for (let i = 0; i < 26; i++) {
      await pedir('/grabacion', s1.token, { method: 'POST',
        body: JSON.stringify({ nombre: `relleno ${i}`, puntos: dos }) });
    }
    const r = await pedir('/admin/grabaciones', d.token);
    const nombres = (r.body.grabaciones || []).map(x => x.nombre);
    ok('quedan 25 como máximo', nombres.length === 25, nombres.length);
    ok('y la más vieja fue la que se fue', !nombres.includes('Vuelta al centro'),
       nombres.slice(-3));
  }

  // El POST /gps del chofer, con lo que la app manda pegado a sus posiciones
  const gps = (extra = {}) => pedir('/gps', s1.token, { method: 'POST',
    body: JSON.stringify({ posiciones: [{ lat: LAT, lng: LNG, timestamp: Date.now() }], ...extra }) });

  console.log('\nDESPACHO PIDE UNA GRABACIÓN (4.5)');
  {
    let r = await pedir('/admin/grabaciones/pedir', s1.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    ok('un chofer no pide grabaciones — es una puerta del panel: 403', r.status === 403, r.status);

    r = await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-99' }) });
    ok('una unidad que no existe: 404', r.status === 404, r.status);

    r = await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    ok('Despacho pide una grabación a M-01', r.status === 200 && r.body.estado === 'pedida', r.body);
    r = await pedir('/admin/grabaciones', d.token);
    ok('el panel lista el pedido, esperando a la app',
       (r.body.pedidos || []).some(p => p.vehicleId === 'M-01' && p.estado === 'pedida'),
       r.body.pedidos);

    // El pedido viaja por el canal que sobrevive a la pantalla apagada
    r = await gps();
    ok('el próximo POST /gps de esa unidad trae grabar: true',
       r.status === 200 && r.body.grabar === true, r.body);
    r = await gps({ grabando: false });
    ok('y lo sigue trayendo mientras la app no confirme', r.body.grabar === true, r.body);

    r = await gps({ grabando: true });
    ok('la app confirma con grabando: true y el "arrancá" se apaga',
       r.status === 200 && r.body.grabar === undefined, r.body);
    r = await pedir('/admin/grabaciones', d.token);
    ok('el panel ve el pedido GRABANDO',
       (r.body.pedidos || []).some(p => p.vehicleId === 'M-01' && p.estado === 'grabando'),
       r.body.pedidos);

    const dos = [{ lat: LAT, lng: LNG }, { lat: LAT + M * 40, lng: LNG }];
    await pedir('/grabacion', s1.token, { method: 'POST',
      body: JSON.stringify({ nombre: 'la pedida', puntos: dos }) });
    r = await pedir('/admin/grabaciones', d.token);
    ok('subir la grabación deja el pedido cumplido: desaparece',
       (r.body.pedidos || []).length === 0, r.body.pedidos);

    // El chofer que descarta también limpia: la app reporta grabando: false
    await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    await gps({ grabando: true });
    await gps({ grabando: false });
    r = await pedir('/admin/grabaciones', d.token);
    ok('si la app deja de grabar sin subir nada, el pedido también se va',
       (r.body.pedidos || []).length === 0, r.body.pedidos);

    // Cancelar antes de que la app lo levante
    await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    r = await pedir('/admin/grabaciones/pedir/M-01', d.token, { method: 'DELETE' });
    ok('Despacho cancela el pedido', r.status === 200, r.status);
    r = await gps();
    ok('y a la app ya no le llega ningún "arrancá"', r.body.grabar === undefined, r.body);

    // Repetir el pedido sobre una grabación en curso no la reinicia
    await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    await gps({ grabando: true });
    r = await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    ok('pedir de nuevo mientras graba responde "grabando", no degrada el estado',
       r.status === 200 && r.body.estado === 'grabando', r.body);
    r = await gps({ grabando: true });
    ok('y la app no recibe otro "arrancá" arriba de la grabación en curso',
       r.body.grabar === undefined, r.body);
    await gps({ grabando: false });   // deja la mesa limpia para lo que sigue
  }

  console.log('\nEL PEDIDO NO CRUZA EL BORDE DE EMPRESA, Y SE VENCE SOLO');
  {
    // Otra cooperativa, creada con las mismas piezas que usa la consola —
    // el mismo camino que gerente.js.
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const coop = require(RAIZ + '/server/cooperativas.js');
    const db2 = new Database(DB);
    const alta = coop.alta(db2, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9',
      despacho: 'DESPACHO-2', clave: 'clavelarga2' });
    db2.close();
    ok('la segunda cooperativa existe', alta.ok === true, alta);
    const d2 = await login('DESPACHO-2', 'clavelarga2');
    let r = await pedir('/admin/grabaciones/pedir', d2.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    ok('el Despacho de otra empresa no le pide a M-01 — 404, como si no existiera',
       r.status === 404, r.status);
    r = await pedir('/admin/grabaciones/pedir/M-01', d2.token, { method: 'DELETE' });
    ok('ni le cancela un pedido — mismo 404', r.status === 404, r.status);

    // El vencimiento: un pedido de hace 13 horas ya no existe para nadie
    await pedir('/admin/grabaciones/pedir', d.token, { method: 'POST',
      body: JSON.stringify({ vehicleId: 'M-01' }) });
    const db3 = new Database(DB);
    db3.prepare('UPDATE recording_requests SET pedidaEn = ? WHERE vehicleId = ?')
      .run(Date.now() - 13 * 3600_000, 'M-01');
    db3.close();
    r = await gps();
    ok('a la app no le llega un pedido vencido', r.body.grabar === undefined, r.body);
    r = await pedir('/admin/grabaciones', d.token);
    ok('y el panel tampoco lo lista', (r.body.pedidos || []).length === 0, r.body.pedidos);
  }

  servidor.kill();
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { servidor.kill(); } catch {}
  process.exit(1);
});
