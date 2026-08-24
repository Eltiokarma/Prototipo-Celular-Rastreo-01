// Rutas alternas: variantes del recorrido, de punta a punta.
// Arranca sus propios servidores (una parte se prueba reiniciando).
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/variantes.db';
const CLAVE_CREADOR = 'clave-larga-del-creador';
const P = 3051;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  if (servidor) { servidor.kill(); await sleep(600); }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: {
      ...process.env, PORT: String(P), DB_FILE: DB,
      DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', CREATOR_PASSWORD: CLAVE_CREADOR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return () => log; } catch {}
  }
  throw new Error('no arrancó: ' + log);
}

const pedir = (ruta, opts = {}) =>
  fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// Un trazado recto de norte a sur, en metros desde un punto base
const LAT = -15.50, LNG = -70.13;
const gLat = 1 / 111320;
const gLng = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const punto = (norte, este = 0) => ({ lat: LAT + gLat * norte, lng: LNG + gLng * este });

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const login = (u, p) => pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) });
  const D = (await login('DESPACHO', 'despacho99')).body;
  const HD = { Authorization: 'Bearer ' + D.token };
  const C = (await pedir('/creador/login', { method: 'POST', body: JSON.stringify({ password: CLAVE_CREADOR }) })).body;
  const HC = { Authorization: 'Bearer ' + C.token };
  const EMP = D.companyId;

  console.log('\nTODA RUTA ARRANCA CON UNA');
  {
    const v = await pedir('/admin/routes/R-14/variantes', { headers: HD });
    ok('la ruta tiene una variante y está activa',
      v.body.variantes.length === 1 && v.body.variantes[0].activa === 1,
      v.body.variantes.map(x => x.name));
    ok('se llama "Recorrido normal"', v.body.variantes[0].name === 'Recorrido normal');
  }

  // El recorrido de siempre: 1000 m al norte y vuelta por la misma calle
  await fetch(`http://localhost:${P}/admin/routes/R-14/points`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...HD },
    body: JSON.stringify({ tramos: { ida: [punto(0), punto(1000)], vuelta: [punto(1000), punto(0)] } }),
  });

  console.log('\nCREAR UNA VARIANTE (DESDE EL CREADOR)');
  let obraId;
  {
    const sinPermiso = await pedir(`/admin/routes/R-14/variantes`, {
      method: 'POST', headers: HD, body: JSON.stringify({ name: 'A mano' }),
    });
    ok('Despacho no puede crear variantes: no existe el endpoint', sinPermiso.status === 404, sinPermiso.status);

    const nueva = await pedir(`/creador/empresas/${EMP}/rutas/R-14/variantes`, {
      method: 'POST', headers: HC,
      body: JSON.stringify({ name: 'Obra Circunvalación', copiarDe: 1 }),
    });
    ok('el creador la crea copiando la de siempre', nueva.status === 200 && nueva.body.copiadaDe === 'Recorrido normal',
      nueva.body);
    obraId = nueva.body.variantId;

    const copiada = await pedir(`/admin/routes/R-14/points?variantId=${obraId}`, { headers: HD });
    ok('y nace con los puntos copiados', copiada.body.tramos.ida.length === 2, copiada.body.tramos.ida.length);
    ok('pero no está activa', copiada.body.variante.activa === false);

    const ajena = await pedir(`/creador/empresas/EMP-INVENTADA/rutas/R-14/variantes`, { headers: HC });
    ok('una empresa que no es la dueña de la ruta: no existe', ajena.status === 404, ajena.status);
  }

  console.log('\nDIBUJAR UNA VARIANTE GUARDADA NO MUEVE NADA');
  {
    // Un chofer conectado, mirando el mapa
    const tokenG = await require('./gerente.js')(`http://localhost:${P}`, DB);
    await pedir('/admin/users', { method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenG, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId: 'M-V1', name: 'Chofer variante', password: 'chofer1234' }) });
    const s = (await login('M-V1', 'chofer1234')).body;
    const ws = new WebSocket(`ws://localhost:${P}`);
    const geo = [];
    await new Promise(r => ws.on('open', r));
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'route_geometry') geo.push(m); });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(600);
    ok('el chofer recibe el trazado y sabe cuál es', geo.length === 1 && geo[0].variante === 'Recorrido normal',
      geo[0]?.variante);

    // La obra desvía 400 m al costado, en el medio
    geo.length = 0;
    await fetch(`http://localhost:${P}/admin/routes/R-14/points?variantId=${obraId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...HD },
      body: JSON.stringify({ tramos: {
        ida: [punto(0), punto(400, 400), punto(600, 400), punto(1000)],
        vuelta: [punto(1000), punto(0)],
      } }),
    });
    await sleep(700);
    ok('dibujar una variante guardada no le cambia el mapa a nadie', geo.length === 0,
      geo.map(g => g.variante));

    const activa = await pedir('/admin/routes/R-14/points', { headers: HD });
    ok('y la activa sigue siendo la de siempre', activa.body.variante.name === 'Recorrido normal' &&
      activa.body.tramos.ida.length === 2, activa.body.variante);

    console.log('\nACTIVARLA SÍ');
    const act = await pedir(`/admin/routes/R-14/variantes/${obraId}/activar`, { method: 'POST', headers: HD });
    await sleep(800);
    ok('Despacho puede elegir entre las cargadas', act.status === 200, act.body.error);
    ok('el chofer recibe el trazado nuevo, con su nombre',
      geo.length === 1 && geo[0].variante === 'Obra Circunvalación' && geo[0].tramos.ida.length === 4,
      geo.map(g => g.variante));

    const rutas = await pedir('/admin/routes', { headers: HD });
    const r14 = rutas.body.routes.find(r => r.routeId === 'R-14');
    ok('el panel muestra con cuál se está midiendo', r14.variante === 'Obra Circunvalación' && r14.variantes.length === 2,
      { variante: r14.variante, variantes: r14.variantes.length });
    ok('y el circuito ahora es más largo', r14.largoM > 2000, r14.largoM);

    ws.close();
    await sleep(300);
  }

  console.log('\nLAS VUELTAS NO SE MEZCLAN ENTRE TRAZADOS');
  {
    const db = new Database(DB);
    const idObra = db.prepare("SELECT variantId FROM route_variants WHERE name = 'Obra Circunvalación'").get().variantId;
    const normal = db.prepare("SELECT variantId FROM route_variants WHERE name = 'Recorrido normal' AND routeId = 'R-14'").get().variantId;
    // Historial: 3 vueltas de 40 min con el recorrido normal
    const ins = db.prepare('INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const ahora = Date.now();
    for (let i = 0; i < 3; i++) ins.run('M-V1', 'R-14', normal, ahora - 3600e3, ahora - 3600e3 + 2400e3, 2400, 25);
    db.close();

    await pedir('/admin/routes/R-14/target', { method: 'POST', headers: { ...HD, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto: true, targetGapMin: 5 }) });
    const conObra = await pedir('/admin/routes', { headers: HD });
    const obj = conObra.body.routes.find(r => r.routeId === 'R-14').objetivo;
    // 'esperando' = el automático está prendido pero todavía no tiene con qué
    ok('midiendo con la obra, las vueltas del trazado viejo no cuentan',
      obj.vueltas === 0 && obj.min === 5, obj);

    // Al volver al recorrido normal, su historial vuelve a valer
    const base = new Database(DB).prepare("SELECT variantId FROM route_variants WHERE name = 'Recorrido normal' AND routeId = 'R-14'").get().variantId;
    await pedir(`/admin/routes/R-14/variantes/${base}/activar`, { method: 'POST', headers: HD });
    await sleep(400);
    const conNormal = await pedir('/admin/routes', { headers: HD });
    const obj2 = conNormal.body.routes.find(r => r.routeId === 'R-14').objetivo;
    ok('y al volver al de siempre, su historial vuelve a valer',
      obj2.vueltas === 3, obj2);
  }

  console.log('\nLA VUELTA EN CURSO NO SE MIDE CON DOS TRAZADOS');
  {
    // El vehículo arranca una vuelta con el recorrido normal
    const s = (await login('M-V1', 'chofer1234')).body;
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(500);
    for (let i = 0; i <= 8; i++) {
      ws.send(JSON.stringify({ type: 'gps', lat: punto(i * 100).lat, lng: punto(i * 100).lng, speed: 20 }));
      await sleep(120);
    }
    const antes = new Database(DB).prepare('SELECT COUNT(*) c FROM laps').get().c;

    await pedir(`/admin/routes/R-14/variantes/${obraId}/activar`, { method: 'POST', headers: HD });
    await sleep(500);

    // Al volver al inicio, si la vuelta se hubiera conservado se guardaría
    // una medida hecha con dos geometrías
    for (let i = 8; i >= 0; i--) {
      ws.send(JSON.stringify({ type: 'gps', lat: punto(i * 100).lat, lng: punto(i * 100).lng, speed: 20 }));
      await sleep(120);
    }
    await sleep(500);
    const despues = new Database(DB).prepare('SELECT COUNT(*) c FROM laps').get().c;
    ok('la vuelta que venía a medias se descarta', despues === antes, { antes, despues });

    const aud = await pedir('/admin/audit', { headers: HD });
    const cambio = aud.body.events.find(e => e.action === 'variante');
    ok('y el cambio de variante queda registrado', !!cambio, cambio?.detail);
    ok('diciendo que se descartó', /descartada/.test(cambio?.detail || ''), cambio?.detail);
    ws.close();
    await sleep(300);
  }

  console.log('\nNO SE PUEDE DEJAR UNA RUTA SIN CON QUÉ MEDIR');
  {
    const activa = await pedir(`/creador/variantes/${obraId}`, { method: 'DELETE', headers: HC });
    ok('borrar la que está midiendo: no', activa.status === 400, activa.body.error);

    // Una ruta recién creada tiene una sola variante
    await pedir(`/creador/empresas/${EMP}/rutas`, { method: 'POST', headers: HC,
      body: JSON.stringify({ routeId: 'R-99', name: 'Ruta de una sola' }) });
    const suya = await pedir('/admin/routes/R-99/variantes', { headers: HD });
    const ultima = await pedir(`/creador/variantes/${suya.body.variantes[0].variantId}`,
      { method: 'DELETE', headers: HC });
    ok('y la única que queda tampoco (la agarra el chequeo de activa)', ultima.status === 400, ultima.body.error);

    // La que no está activa sí
    const dbb = new Database(DB);
    const normal = dbb.prepare("SELECT variantId FROM route_variants WHERE name = 'Recorrido normal' AND routeId = 'R-14'").get().variantId;
    dbb.close();
    const borrable = await pedir(`/creador/variantes/${normal}`, { method: 'DELETE', headers: HC });
    ok('una guardada sí se borra', borrable.status === 200, borrable.body.error);
    const quedan = await pedir('/admin/routes/R-14/variantes', { headers: HD });
    ok('y la ruta sigue midiendo', quedan.body.variantes.length === 1 && quedan.body.variantes[0].activa === 1,
      quedan.body.variantes.map(v => v.name));
  }

  console.log('\nVIGENCIA PROGRAMADA');
  {
    // Una variante que rige desde ayer hasta mañana: al reiniciar, manda
    const prog = await pedir(`/creador/empresas/${EMP}/rutas/R-14/variantes`, {
      method: 'POST', headers: HC,
      body: JSON.stringify({
        name: 'Desfile 28 de julio', copiarDe: obraId,
        desde: Date.now() - 86400e3, hasta: Date.now() + 86400e3,
      }),
    });
    ok('se programa con fechas', prog.status === 200 && !!prog.body.desde, prog.body.error);
    ok('una vigencia al revés se rechaza',
      (await pedir(`/creador/empresas/${EMP}/rutas/R-14/variantes`, { method: 'POST', headers: HC,
        body: JSON.stringify({ name: 'Mal', desde: Date.now() + 86400e3, hasta: Date.now() }) })).status === 400);

    await arrancar();
    const D2 = (await login('DESPACHO', 'despacho99')).body;
    const v = await pedir('/admin/routes/R-14/variantes', { headers: { Authorization: 'Bearer ' + D2.token } });
    const activa = v.body.variantes.find(x => x.activa);
    ok('al arrancar, la vigente se activa sola', activa.name === 'Desfile 28 de julio', activa.name);

    // Y cuando se vence, vuelve la que no tiene fechas
    const db = new Database(DB);
    db.prepare("UPDATE route_variants SET hasta = ? WHERE name = 'Desfile 28 de julio'").run(Date.now() - 1000);
    db.close();
    await arrancar();
    const D3 = (await login('DESPACHO', 'despacho99')).body;
    const v2 = await pedir('/admin/routes/R-14/variantes', { headers: { Authorization: 'Bearer ' + D3.token } });
    const activa2 = v2.body.variantes.find(x => x.activa);
    ok('vencida, vuelve la que no tiene fechas', activa2.name === 'Obra Circunvalación', activa2.name);
  }

  console.log('\nVIGENCIA SEMANAL: «LOS DOMINGOS»');
  {
    // Varios recorridos cambian TODOS los domingos, y la vigencia por
    // fechas obligaba a activarlos a mano cada semana. Se prueba con el día
    // de HOY (el que sea): la regla es la misma para cualquier día.
    const HOY = new Date().getDay();
    const OTRO = (HOY + 3) % 7;

    // Las sesiones del creador viven en memoria a propósito: los reinicios
    // de la sección anterior las cerraron, así que se entra de nuevo.
    const C2 = (await pedir('/creador/login', { method: 'POST',
      body: JSON.stringify({ password: CLAVE_CREADOR }) })).body;
    const HC = { Authorization: 'Bearer ' + C2.token };

    let r = await pedir(`/creador/empresas/${EMP}/rutas/R-14/variantes`, {
      method: 'POST', headers: HC,
      body: JSON.stringify({ name: 'Mal día', dias: [9] }) });
    ok('un día que no existe se rechaza', r.status === 400, r.body.error);

    r = await pedir(`/creador/empresas/${EMP}/rutas/R-14/variantes`, {
      method: 'POST', headers: HC,
      body: JSON.stringify({ name: 'Recorrido semanal', copiarDe: obraId, dias: [HOY] }) });
    ok('se crea con día de la semana', r.status === 200 && r.body.dias === String(HOY), r.body);
    const semanalId = r.body.variantId;

    await arrancar();
    let D2 = (await login('DESPACHO', 'despacho99')).body;
    let v = await pedir('/admin/routes/R-14/variantes', { headers: { Authorization: 'Bearer ' + D2.token } });
    let activa = v.body.variantes.find(x => x.activa);
    ok('el día que le toca, rige sola', activa.name === 'Recorrido semanal', activa.name);

    // Se le corre el día a otro: hoy ya no le toca → vuelve la de siempre,
    // sin que nadie la desactive a mano. Es exactamente el lunes a la
    // madrugada del recorrido de domingo.
    const db = new Database(DB);
    db.prepare('UPDATE route_variants SET dias = ? WHERE variantId = ?').run(String(OTRO), semanalId);
    db.close();
    await arrancar();
    D2 = (await login('DESPACHO', 'despacho99')).body;
    v = await pedir('/admin/routes/R-14/variantes', { headers: { Authorization: 'Bearer ' + D2.token } });
    activa = v.body.variantes.find(x => x.activa);
    ok('el día que no le toca, vuelve la de siempre sola',
       activa.name === 'Obra Circunvalación', activa.name);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
