const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const API = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

(async () => {
  const tk = (await login('DESPACHO', 'despacho99')).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  // Los choferes-con-combi los siembra la gerencia: los vehículos son suyos
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, process.env.DBFILE || process.env.DB_FILE) };
  await fetch(API + '/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'M-01', name: 'Chofer uno', personRole: 'driver', password: 'clave1234' }) });

  // Circuito de 2 km POR LA MISMA CALLE: 1 km hacia el norte (ida) y el
  // mismo kilómetro de vuelta hacia el sur. Es el caso que antes se rompía:
  // por cercanía los dos tramos empatan siempre.
  const LAT0 = -15.50, LNG = -70.13;
  const g = 1000 / 111320;   // 1 km en grados de latitud
  const ida =    [{ lat: LAT0, lng: LNG }, { lat: LAT0 + g, lng: LNG }];
  const vuelta = [{ lat: LAT0 + g, lng: LNG }, { lat: LAT0, lng: LNG }];

  let r = await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida, vuelta } }) });
  const guardado = await r.json();
  ok('1. Guarda los dos tramos', r.status === 200 && guardado.puntos.vuelta === 2,
     `ida ${guardado.puntos.ida} · vuelta ${guardado.puntos.vuelta} · ${guardado.largoM} m`);
  ok('2. El circuito mide la ida más la vuelta', Math.abs(guardado.largoM - 2000) < 20, guardado.largoM + ' m');

  const s = await login('M-01', 'clave1234');
  const ws = new WebSocket('ws://localhost:3001');
  await new Promise(res => ws.on('open', res));
  const rec = { states: [], geo: [] };
  ws.on('message', raw => { const m = JSON.parse(raw);
    if (m.type === 'state') rec.states.push(m);
    if (m.type === 'route_geometry') rec.geo.push(m); });
  ws.send(JSON.stringify({ type: 'identify', token: s.token }));
  await sleep(600);
  ok('3. El trazado llega con los dos tramos',
     rec.geo[0] && rec.geo[0].tramos.ida.length === 2 && rec.geo[0].tramos.vuelta.length === 2);

  const mover = async (frac) => {
    ws.send(JSON.stringify({ type: 'gps', lat: LAT0 + g * frac, lng: LNG, speed: 25, routeProgress: 0 }));
    await sleep(3600);
    return rec.states.at(-1).units.find(u => u.unitId === 'M-01');
  };

  // Subiendo (ida): el progreso del circuito va de 0 a 0,5
  let u = await mover(0.1);
  u = await mover(0.5);
  ok('4. Yendo hacia el norte va por la IDA', u.tramo === 'ida', `${u.tramo} · circuito ${u.routeProgress.toFixed(3)}`);
  ok('5. A mitad de la ida, el circuito va por 0,25', Math.abs(u.routeProgress - 0.25) < 0.02, u.routeProgress.toFixed(3));

  u = await mover(0.95);
  ok('6. Cerca del final de la ida, ~0,475', Math.abs(u.routeProgress - 0.475) < 0.03, u.routeProgress.toFixed(3));

  // Da la vuelta y baja POR LA MISMA CALLE
  u = await mover(0.8);
  u = await mover(0.5);
  ok('7. Al volver hacia el sur pasa a la VUELTA, por la misma calle',
     u.tramo === 'vuelta', `${u.tramo} · circuito ${u.routeProgress.toFixed(3)}`);
  ok('8. A mitad de la vuelta el circuito va por 0,75', Math.abs(u.routeProgress - 0.75) < 0.03, u.routeProgress.toFixed(3));

  u = await mover(0.1);
  ok('9. Casi al final del circuito, ~0,95', u.routeProgress > 0.9, u.routeProgress.toFixed(3));

  // Y arranca otra ida: el progreso vuelve abajo (eso es una vuelta completa)
  u = await mover(0.3);
  u = await mover(0.6);
  ok('10. Al salir otra vez vuelve a la IDA', u.tramo === 'ida', `${u.tramo} · ${u.routeProgress.toFixed(3)}`);

  // Dos unidades, una de ida y otra de vuelta: la brecha se calcula igual
  await fetch(API + '/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'M-02', name: 'Chofer dos', personRole: 'driver', password: 'clave1234' }) });
  const s2 = await login('M-02', 'clave1234');
  const ws2 = new WebSocket('ws://localhost:3001');
  await new Promise(res => ws2.on('open', res));
  ws2.on('message', () => {});
  ws2.send(JSON.stringify({ type: 'identify', token: s2.token }));
  await sleep(500);
  // M-02 baja (vuelta) desde arriba
  ws2.send(JSON.stringify({ type: 'gps', lat: LAT0 + g * 0.9, lng: LNG, speed: 25, routeProgress: 0 }));
  await sleep(500);
  ws2.send(JSON.stringify({ type: 'gps', lat: LAT0 + g * 0.7, lng: LNG, speed: 25, routeProgress: 0 }));
  await sleep(4000);
  const e = rec.states.at(-1);
  const m1 = e.units.find(x => x.unitId === 'M-01');
  const m2 = e.units.find(x => x.unitId === 'M-02');
  ok('11. Dos unidades, una de ida y otra de vuelta, cada una en su tramo',
     m1.tramo === 'ida' && m2.tramo === 'vuelta', `M-01 ${m1.tramo} ${m1.routeProgress.toFixed(2)} · M-02 ${m2.tramo} ${m2.routeProgress.toFixed(2)}`);
  const brechas = e.gaps['M-01'] || {};
  ok('12. Y hay brecha entre ellas, sobre el mismo circuito',
     !!(brechas.toAhead || brechas.toBehind),
     `+1 ${brechas.toAhead || '—'} / −1 ${brechas.toBehind || '—'} contra ${brechas.aheadUnit || brechas.behindUnit}`);

  // Una ruta puede tener solo ida
  r = await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida, vuelta: [] } }) });
  const soloIda = await r.json();
  ok('13. Se puede dejar solo la ida', r.status === 200 && soloIda.largoM === 1000, soloIda.largoM + ' m');

  // Pero no una vuelta sin ida
  r = await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida: [], vuelta } }) });
  ok('14. No se puede cargar la vuelta sin la ida', r.status === 400, JSON.stringify(await r.json()));

  ws.close(); ws2.close(); process.exit(0);
})();
