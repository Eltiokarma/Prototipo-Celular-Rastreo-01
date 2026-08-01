// Se ataca al servidor con lo que haría alguien con una cuenta válida o con
// ninguna. Cada chequeo describe el ataque, no la implementación.
const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const API = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p, ip) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
  body: JSON.stringify({ user: u, password: p }) }).then(async r => ({ status: r.status, body: await r.json() }));

(async () => {
  const tk = (await login('DESPACHO', 'despacho99')).body.token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  const alta = (b) => fetch(API + '/admin/users', { method: 'POST', headers: H, body: JSON.stringify(b) })
    .then(async r => ({ status: r.status, body: await r.json() }));

  // Punto de partida limpio: esta suite da de alta M-77 y M-78, y en una
  // segunda corrida el alta chocaba con la de la corrida anterior — el test
  // fallaba por "usuario tomado" y parecía un problema de seguridad.
  for (const u of ['M-77', 'M-78']) {
    await fetch(API + `/admin/users/${u}`, { method: 'DELETE', headers: H });
  }

  // ── 1. Inyección de HTML por el identificador
  const XSS = '<img src=x onerror=alert(1)>';
  let r = await alta({ unitId: XSS, name: 'Malicioso', personRole: 'driver', password: 'clave1234' });
  ok('1. No deja crear una unidad con HTML en el nombre de usuario', r.status === 400, JSON.stringify(r.body));

  r = await fetch(API + '/admin/vehicles', { method: 'POST', headers: H,
    body: JSON.stringify({ vehicleId: XSS, label: 'x' }) }).then(async x => ({ status: x.status, body: await x.json() }));
  ok('2. Ni un vehículo', r.status === 400, JSON.stringify(r.body));

  // Las rutas ya no se crean desde Despacho — el endpoint no existe. El
  // rechazo de un código con HTML se prueba en la suite del creador, que es
  // donde vive el alta ahora.
  r = await fetch(API + '/admin/routes', { method: 'POST', headers: H,
    body: JSON.stringify({ routeId: 'R-XX', name: 'x' }) }).then(async x => ({ status: x.status }));
  ok('3. Despacho no puede crear rutas: no existe el endpoint', r.status === 404, r.status);

  // El NOMBRE sí puede tener cualquier cosa: lo pinta React, que lo escapa
  r = await alta({ unitId: 'M-77', name: XSS, personRole: 'driver', password: 'clave1234' });
  ok('4. El nombre de la persona sí acepta cualquier texto (lo escapa React)', r.status === 200);

  // ── 2. Contraseñas
  r = await alta({ unitId: 'M-78', name: 'Corto', personRole: 'driver', password: 'abc' });
  ok('5. Rechaza una contraseña corta al dar de alta', r.status === 400, JSON.stringify(r.body));
  r = await fetch(API + '/admin/users/M-77/password', { method: 'POST', headers: H,
    body: JSON.stringify({ password: '123' }) }).then(async x => ({ status: x.status, body: await x.json() }));
  ok('6. Y al resetear', r.status === 400);

  // ── 3. Fuerza bruta desde un mismo origen contra MUCHAS cuentas
  //     (el bloqueo por cuenta no lo detecta: es una prueba por cuenta)
  const IP = '203.0.113.7';
  let bloqueado = null;
  for (let i = 0; i < 40 && !bloqueado; i++) {
    const res = await login('unidad' + i, 'probando123', IP);
    if (res.status === 429) bloqueado = i;
  }
  ok('7. Bloquea al que prueba una clave contra muchas cuentas', bloqueado !== null,
     bloqueado !== null ? `cortado al intento ${bloqueado}` : 'nunca se cortó');

  // El bloqueo es del atacante, no del servicio: otro origen sigue entrando
  const otro = await login('DESPACHO', 'despacho99', '198.51.100.9');
  ok('8. Y no deja afuera a los demás', otro.status === 200);

  // ── 4. Inundación por WebSocket con una sesión VÁLIDA
  const s = await login('M-77', 'clave1234');
  const ws = new WebSocket('ws://localhost:3001');
  await new Promise(res => ws.on('open', res));
  let recibidos = 0;
  ws.on('message', raw => { if (JSON.parse(raw).type === 'chat_msg') recibidos++; });
  ws.send(JSON.stringify({ type: 'identify', token: s.body.token }));
  await sleep(600);
  for (let i = 0; i < 200; i++) {
    ws.send(JSON.stringify({ type: 'chat', text: 'spam ' + i, timestamp: Date.now() }));
  }
  await sleep(2500);
  ok('9. Corta la inundación de chat de una sesión válida', recibidos > 0 && recibidos <= 30,
     `${recibidos} de 200 mensajes pasaron`);

  // Un mensaje descomunal no tumba nada
  const enorme = 'x'.repeat(3_000_000);
  ws.send(JSON.stringify({ type: 'chat', text: enorme, timestamp: Date.now() }));
  await sleep(1200);
  const vivo = await fetch(API + '/ping').then(r => r.ok).catch(() => false);
  ok('10. Un mensaje de 3 MB no voltea al servidor', vivo === true);

  // ── 5. Escalada: un chofer no puede administrar
  const rr = await fetch(API + '/admin/users', { headers: { Authorization: 'Bearer ' + s.body.token } });
  ok('11. Un chofer no entra a la administración', rr.status === 403, 'HTTP ' + rr.status);
  const rd = await fetch(API + '/admin/users/M-78', { method: 'DELETE',
    headers: { Authorization: 'Bearer ' + s.body.token } });
  ok('12. Ni puede dar de baja a nadie', rd.status === 403, 'HTTP ' + rd.status);

  // ── 6. Token inventado
  const falso = await fetch(API + '/admin/users', { headers: { Authorization: 'Bearer ' + 'a'.repeat(48) } });
  ok('13. Un token inventado no sirve', falso.status === 401, 'HTTP ' + falso.status);

  ws.close(); process.exit(0);
})();
