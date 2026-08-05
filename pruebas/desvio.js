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
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, process.env.DBFILE || process.env.DB_FILE) };
  await fetch(API + '/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'M-01', name: 'Chofer uno', personRole: 'driver', password: 'clave1234' }) });

  // Punto de partida limpio: sin recorrido, umbral normal y sin silenciar.
  // Borrar el recorrido además limpia el estado de desvío que hubiera quedado
  // en memoria de otra suite o de una corrida anterior de esta misma.
  await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida: [], vuelta: [] } }) });
  await fetch(API + '/admin/routes/R-14/desvio', { method: 'POST', headers: H,
    body: JSON.stringify({ silenciarMin: 0 }) });
  await sleep(500);

  // La auditoría acumula entre corridas: se cuenta la DIFERENCIA, no el total
  const contarDesvios = async () => {
    const a = await fetch(API + '/admin/audit', { headers: H }).then(r => r.json());
    return a.events.filter(x => x.action === 'desvio').length;
  };
  const desviosAlEmpezar = await contarDesvios();

  const s = await login('M-01', 'clave1234');
  const rec = { states: [] };
  let ws;
  // El test manda posiciones mucho más rápido que una combi real (una cada
  // 3 s = 20 por minuto) y choca con el cupo antiinundación de 40 por minuto.
  // Reconectar es lo que haría un celular que perdió señal, y renueva el cupo.
  const conectar = async () => {
    if (ws) { try { ws.close(); } catch {} await sleep(400); }
    ws = new WebSocket('ws://localhost:3001');
    await new Promise(r => ws.on('open', r));
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') rec.states.push(m); });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(500);
  };
  await conectar();

  const LAT = -15.50, LNG = -70.13;
  const gLat = 1 / 111320;   // 1 metro en latitud
  const kLng = Math.cos(LAT * Math.PI / 180);
  const gLng = 1 / (111320 * kLng);

  const mandar = async (metrosAlCostado, veces = 1) => {
    for (let i = 0; i < veces; i++) {
      ws.send(JSON.stringify({
        type: 'gps',
        lat: LAT + gLat * 200,                       // a mitad del trazado
        lng: LNG + gLng * metrosAlCostado,           // desplazado al costado
        speed: 20, routeProgress: 0,
      }));
      await sleep(120);
    }
    await sleep(3800);
    return rec.states.at(-1).units.find(u => u.unitId === 'M-01');
  };

  // Una ruta nueva tolera tres cuadras: un chofer puede esquivar un
  // embotellamiento sin que eso figure como que se salió de la ruta.
  const rutas = await fetch(API + '/admin/routes', { headers: H }).then(r => r.json());
  const r14 = rutas.routes.find(x => x.routeId === 'R-14');
  ok('0. El umbral por defecto son tres cuadras', r14.desvioMaxM === 300, r14.desvioMaxM + ' m');

  // Sin recorrido cargado no se puede hablar de desvío
  let u = await mandar(500, 3);
  ok('1. Sin recorrido cargado, nadie está "fuera de ruta"',
     u.fueraDeRuta === false && u.desvioM === null, `desvioM: ${u.desvioM}`);

  // Recorrido recto de 400 m hacia el norte
  await fetch(API + '/admin/routes/R-14/points', { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida: [
      { lat: LAT, lng: LNG }, { lat: LAT + gLat * 400, lng: LNG },
    ], vuelta: [] } }) });
  await sleep(600);

  // Sobre el trazado: nada
  u = await mandar(0, 5);
  ok('2. Sobre el trazado, todo normal', u.fueraDeRuta === false && u.desvioM <= 2, `${u.desvioM} m`);

  // Un solo salto de GPS lejos: NO tiene que marcar nada
  u = await mandar(400, 1);
  ok('3. Un salto suelto del GPS no marca desvío', u.fueraDeRuta === false, `${u.desvioM} m, un solo dato`);

  // Vuelve al trazado y después se va sostenido
  await mandar(0, 5);
  u = await mandar(400, 12);
  ok('4. Un desvío sostenido sí lo marca', u.fueraDeRuta === true, `${u.desvioM} m del trazado`);
  ok('5. Y dice desde cuándo', typeof u.fueraDesde === 'number' && u.fueraDesde > 0);

  // Vuelve
  u = await mandar(0, 6);
  ok('6. Al volver al recorrido se limpia solo', u.fueraDeRuta === false, `${u.desvioM} m`);

  // Umbral por ruta: con 200 m de tolerancia, ese mismo desvío no cuenta
  await conectar();
  let r = await fetch(API + '/admin/routes/R-14/desvio', { method: 'POST', headers: H,
    body: JSON.stringify({ umbralM: 600 }) }).then(async x => ({ status: x.status, body: await x.json() }));
  ok('7. Se puede subir el umbral de la ruta', r.status === 200 && r.body.umbralM === 600);
  u = await mandar(400, 12);
  ok('8. Con el umbral alto, ese mismo desvío ya no es desvío', u.fueraDeRuta === false, `${u.desvioM} m con umbral 600`);

  r = await fetch(API + '/admin/routes/R-14/desvio', { method: 'POST', headers: H,
    body: JSON.stringify({ umbralM: 20 }) }).then(x => x.status);
  ok('9. Rechaza un umbral que solo daría falsas alarmas', r === 400);

  // Silenciar: hay obra hoy y ya lo sabemos
  await fetch(API + '/admin/routes/R-14/desvio', { method: 'POST', headers: H,
    body: JSON.stringify({ umbralM: 300, silenciarMin: 60 }) });
  await sleep(600);
  const e = rec.states.at(-1);
  ok('10. El estado avisa que el desvío está silenciado',
     !!e.desvio.mudoHasta && e.desvio.umbralM === 300,
     `hasta ${new Date(e.desvio.mudoHasta).toLocaleTimeString('es-PE')}`);

  // Silenciado NO significa ciego: se sigue viendo, no se registra
  await conectar();
  u = await mandar(400, 12);
  ok('11. Silenciado sigue mostrando la unidad fuera (no queda ciego)', u.fueraDeRuta === true);
  const nuevos = (await contarDesvios()) - desviosAlEmpezar;
  ok('12. Pero no vuelve a registrarlo mientras está silenciado',
     nuevos === 1, `${nuevos} registro(s) nuevo(s) en esta corrida`);

  await fetch(API + '/admin/routes/R-14/desvio', { method: 'POST', headers: H,
    body: JSON.stringify({ silenciarMin: 0 }) });
  await sleep(500);
  ok('13. Se puede quitar el silencio', rec.states.at(-1).desvio.mudoHasta === null);

  // ─── Y ADEMÁS QUEDA GUARDADO ────────────────────────────────────────────
  //
  // Hasta ahora el desvío se veía en vivo y se perdía: al día siguiente no
  // había forma de contestar "¿cuántas veces se salió M-01 y por cuánto
  // tiempo?". Un desvío aislado es una obra; el mismo desvío todos los días es
  // otra cosa, y mientras no se guarden las dos se ven igual.
  const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
  const base = new Database(process.env.DBFILE || process.env.DB_FILE, { readonly: true });
  const guardados = base.prepare(
    'SELECT * FROM deviations WHERE vehicleId = ? ORDER BY id').all('M-01');

  ok('14. El desvío que pasó quedó guardado', guardados.length >= 1,
     `${guardados.length} episodio(s)`);

  const vuelto = guardados.find(d => d.cierre === 'regreso');
  ok('15. El que volvió al recorrido está cerrado',
     !!vuelto && vuelto.endedAt > vuelto.startedAt && vuelto.durationSec >= 0,
     vuelto && `${vuelto.durationSec} s`);
  ok('16. Con la distancia máxima a la que llegó, no la última',
     !!vuelto && vuelto.maxM >= 380, vuelto && `${vuelto.maxM} m`);
  ok('17. Y contra qué umbral se lo midió — cambia por ruta y se puede editar',
     !!vuelto && vuelto.umbralM === 300, vuelto && `${vuelto.umbralM} m`);

  // Silenciar es "ya lo sé, no me avises más", NO "esto no pasó". Si el
  // silencio borrara el registro, la forma de que un desvío no apareciera en
  // el informe sería apretar el botón de silencio.
  const mudo = guardados.find(d => d.silenciado === 1);
  ok('18. Un desvío silenciado igual se guarda, marcado como silenciado',
     !!mudo, guardados.map(d => `${d.cierre || 'abierto'}/${d.silenciado}`).join(' '));

  // Ninguno puede quedar abierto para siempre: una fila sin cerrar crece sola
  // y el informe del mes diría que una combi estuvo cuatro días fuera de ruta.
  const abiertosViejos = base.prepare(
    'SELECT COUNT(*) c FROM deviations WHERE endedAt IS NULL AND startedAt < ?').get(Date.now() - 60_000).c;
  ok('19. No quedan episodios abiertos de hace rato', abiertosViejos === 0, abiertosViejos);
  base.close();

  // Y llega al informe, que es donde lo va a leer la cooperativa
  const csv = await fetch(`${API}/admin/informe/desvios.csv?desde=${Date.now() - 3600e3}&hasta=${Date.now()}`,
    { headers: H }).then(r => r.text());
  ok('20. Hay un informe de salidas del recorrido', /Informe de desvios/i.test(csv),
     csv.split('\r\n')[0]);
  ok('21. Con una fila por episodio y su duración',
     /M-01;R-14;/.test(csv) && /Máxima distancia/.test(csv),
     csv.split('\r\n').find(l => l.startsWith('M-01')));

  ws.close(); process.exit(0);
})();
