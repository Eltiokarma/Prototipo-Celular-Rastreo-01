const RAIZ = require('path').join(__dirname, '..');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const API = 'http://localhost:3001';
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

(async () => {
  const tk = (await login('DESPACHO', 'despacho99')).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  const bajar = (tipo, q = '') => fetch(`${API}/admin/informe/${tipo}.csv${q}`, { headers: H })
    .then(async r => ({ status: r.status, tipo: r.headers.get('content-type'),
      nombre: r.headers.get('content-disposition'), texto: await r.text() }));

  // Punto de partida: sin recorrido en R-14, para poder comprobar que el
  // informe avisa cuando los números son estimaciones.
  await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida: [], vuelta: [] } }) });

  // Un chofer con nombre que lleva punto y coma y comillas, para probar que
  // el CSV no se parte. Se usa un usuario propio de esta suite: reutilizar
  // uno de otra dejaba el nombre que aquella le hubiera puesto.
  const PERSONA = 'csvtest';
  let alta = await fetch(API + '/admin/users', { method: 'POST', headers: H,
    body: JSON.stringify({ unitId: PERSONA, name: 'Mamani; Raúl "El Chino"', personRole: 'driver', password: 'clave1234' }) });
  if (alta.status === 409) {
    // Ya existía de una corrida anterior: se le vuelve a poner el nombre
    await fetch(`${API}/admin/users/${PERSONA}/identity`, { method: 'POST', headers: H,
      body: JSON.stringify({ name: 'Mamani; Raúl "El Chino"' }) });
  }

  const db = new Database(process.env.DBFILE);
  // Los datos de prueba se borran antes de sembrarlos: si no, cada corrida
  // suma vueltas a las anteriores y los conteos dejan de valer.
  db.prepare('DELETE FROM laps WHERE unitId = ?').run(PERSONA);
  db.prepare('DELETE FROM shifts WHERE personId = ?').run(PERSONA);
  db.prepare("DELETE FROM messages WHERE kind = 'sos' AND unitId = ?").run(PERSONA);
  const ahora = Date.now();
  // Los informes sin rango salen del día de hoy, pero las filas de prueba se
  // arman "hace N horas": corrido apenas pasada la medianoche, esas filas
  // caen en el día anterior y el informe sale vacío. Las consultas de
  // contenido piden un rango explícito de 48 h; el rango por defecto lo
  // sigue cubriendo la prueba 2, que mira la línea del período.
  const RANGO = `?desde=${ahora - 48 * 3600e3}&hasta=${ahora}`;
  for (let i = 0; i < 3; i++) {
    db.prepare('INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed) VALUES (?,?,?,?,?,?)')
      .run(PERSONA, 'R-14', ahora - (i + 1) * 3600e3, ahora - i * 3600e3, 2400 + i * 60, 22 + i);
  }
  db.prepare('INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt) VALUES (?,?,?,?,?,?,?)')
    .run(PERSONA, PERSONA, 'R-14', 'driver', ahora - 5 * 3600e3, ahora, ahora - 1000);
  db.prepare('INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, lat, lng, timestamp) VALUES (?,?,?,?,?,?,?,?)')
    .run('sos', PERSONA, 'El Chino', 'R-14', PERSONA, -15.49, -70.12, ahora - 600e3);
  db.close();

  let r = await bajar('vueltas', RANGO);
  ok('1. El informe de vueltas se descarga como CSV',
     r.status === 200 && /text\/csv/.test(r.tipo) && /attachment/.test(r.nombre),
     (r.nombre || '').replace('attachment; ', ''));

  const lineas = r.texto.split('\r\n');
  ok('2. Dice el período y quién lo generó',
     /^Período;/.test(lineas[1]) && /Generado;/.test(lineas[3]), lineas[1]);
  // Sin pedir una ruta, un supervisor ve varias: la precisión depende de cada
  // una y el informe lo dice así.
  ok('3. Sin elegir ruta, avisa que la precisión depende de cada una',
     /Medido sobre;varias rutas/.test(lineas[2]), lineas[2].slice(0, 90));
  const sinGeo = await bajar('vueltas', RANGO + '&routeId=R-14');
  ok('3b. Y de una ruta sin recorrido, avisa que son estimaciones',
     /SIN recorrido cargado/.test(sinGeo.texto), (sinGeo.texto.split('\r\n')[2] || '').slice(0, 95));
  ok('4. Trae las tres vueltas', lineas.filter(l => l.startsWith(PERSONA + ';')).length === 3);
  ok('5. Con duración en h:mm y en minutos',
     new RegExp(PERSONA + ';R-14;.*;0:40;40;22').test(r.texto),
     (r.texto.match(new RegExp(PERSONA + ';R-14;[^\r\n]*')) || [])[0]);

  // Con recorrido cargado, la línea de "medido sobre" cambia
  const LAT = -15.50, LNG = -70.13, g = 1000 / 111320;
  await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: {
      ida: [{ lat: LAT, lng: LNG }, { lat: LAT + g, lng: LNG }],
      vuelta: [{ lat: LAT + g, lng: LNG }, { lat: LAT, lng: LNG }] } }) });
  r = await bajar('vueltas', RANGO + '&routeId=R-14');
  ok('6. Con recorrido cargado, el informe lo dice',
     /con recorrido cargado \(2\.00 km, ida y vuelta\)/.test(r.texto),
     (r.texto.split('\r\n')[2] || '').slice(0, 90));

  r = await bajar('horas', RANGO);
  ok('7. El informe de horas sale de los turnos, sin minutos "60"',
     r.status === 200 && /Persona;Nombre;Alias;Rol/.test(r.texto) &&
     /5:00/.test(r.texto) && !/:60/.test(r.texto),
     (r.texto.match(new RegExp(PERSONA + ';[^\r\n]*')) || [])[0]);
  ok('8. Un nombre con punto y coma y comillas no parte el CSV',
     /"Mamani; Raúl ""El Chino"""/.test(r.texto));

  r = await bajar('sos', RANGO);
  ok('9. El informe de SOS trae la posición',
     new RegExp(`El Chino;${PERSONA};${PERSONA};R-14;-15\\.49;-70\\.12`).test(r.texto));

  r = await bajar('actividad', RANGO);
  ok('10. El de actividad trae la auditoría', r.status === 200 && /alta/.test(r.texto));

  r = await bajar('inventado');
  ok('11. Un informe que no existe da 404', r.status === 404);

  // Un chofer no puede descargar informes
  const s = await login(PERSONA, 'clave1234');
  const rr = await fetch(API + '/admin/informe/horas.csv', { headers: { Authorization: 'Bearer ' + s.token } });
  ok('12. Un chofer no puede bajar informes', rr.status === 403, 'HTTP ' + rr.status);

  // Rango: un pedido de 5 años se recorta a 90 días
  const r5 = await bajar('vueltas', `?desde=${ahora - 5 * 365 * 86400e3}&hasta=${ahora}`);
  const periodo = r5.texto.split('\r\n')[1];
  const dias = Math.round((ahora - new Date(periodo.match(/(\d{2})\/(\d{2})\/(\d{4})/).slice(1).reverse().join('-')).getTime()) / 86400e3);
  ok('13. Un rango enorme se recorta a 90 días', dias >= 89 && dias <= 91, periodo);

  process.exit(0);
})();
