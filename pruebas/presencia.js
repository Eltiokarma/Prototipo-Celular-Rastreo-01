// La presencia: salir a ruta, ausente, fuera — y la CONFIRMACIÓN física.
//
// El caso que se defiende acá tiene nombre: Ignacio marca "en ruta" a las
// 5:30 desde su casa. Su palabra vale para Despacho (se lo ve "yendo"), pero
// NO lo mete a la cadena de brechas: eso lo hace el GPS recién cuando pisa
// el trazado. Sin esto, los que pasan cerca de su casa se medirían contra
// una combi estacionada en un garaje.
//
// Y el otro caso real: las unidades comen, compran repuestos, descansan.
// AUSENTE las saca de la cadena sin echarlas del mapa — no están en la
// ruta, pero tampoco se fueron.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/presencia-test.db';
const P = 3161;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const pedir = (ruta, opts = {}) => fetch(API + ruta, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = async (u, p) =>
    (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;

  // ── Sembrar: trazado real y tres choferes ─────────────────────────────
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };

  // Una diagonal de ~3 km por Juliaca: la ida sube, la vuelta baja.
  const ida = [
    { lat: -15.5000, lng: -70.1400 }, { lat: -15.4900, lng: -70.1300 }, { lat: -15.4800, lng: -70.1200 },
  ];
  const vuelta = [...ida].reverse();
  await pedir('/admin/routes/R-14/points', {
    method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }),
  });

  for (const u of ['M-01', 'M-02', 'M-03']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234' }) });
  }
  const s1 = await login('M-01', 'chofer1234');
  const s2 = await login('M-02', 'chofer1234');
  const s3 = await login('M-03', 'chofer1234');   // Ignacio

  const gps = (sesion, lat, lng, extra = {}) => pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sesion.token },
    body: JSON.stringify({ posiciones: [{ lat, lng, speed: 6, timestamp: Date.now() }], ...extra }),
  });
  const presencia = (sesion, estado) => pedir('/presencia', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sesion.token },
    body: JSON.stringify({ estado }),
  });

  // El estado se mira como lo mira Despacho: por el WebSocket, que es el
  // único lugar donde vive.
  const WebSocket = require(RAIZ + '/server/node_modules/ws');
  const ws = new WebSocket(`ws://localhost:${P}`);
  let ultimo = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ultimo = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(800);
  const estado = async () => { await sleep(600); return ultimo || {}; };

  console.log('\nSIN DECLARAR NADA, TODO SIGUE COMO SIEMPRE');
  {
    // Clientes viejos y flota fantasma vieja: en cadena desde la primera
    // posición. La compatibilidad ES una de las cosas que se defienden.
    await gps(s1, -15.4995, -70.1395);   // arrancando la ida
    await gps(s2, -15.4900, -70.1300);   // a mitad de la ida
    await sleep(700);
    const st = await estado();
    ok('las dos aparecen y están en cadena', st.totalOnRoute === 2, st.totalOnRoute);
    ok('con sus brechas', !!st.gaps['M-01'] && !!st.gaps['M-02'], Object.keys(st.gaps || {}));
    ok('y confirmadas en ruta', st.units.every(u => u.enRuta === true), st.units.map(u => u.enRuta));
  }

  console.log('\nIGNACIO MARCA "EN RUTA" DESDE SU CASA');
  {
    const r = await presencia(s3, 'ruta');
    ok('la declaración entra', r.status === 200, r.body);
    await gps(s3, -15.5200, -70.1650);   // su casa: ~3 km del trazado
    await sleep(700);
    const st = await estado();
    const el = st.units.find(u => u.unitId === 'M-03');
    ok('Despacho LO VE, yendo a la ruta', !!el && el.presencia === 'ruta' && el.enRuta === false,
       el && { presencia: el.presencia, enRuta: el.enRuta });
    ok('pero NO ocupa lugar en la cadena', !st.gaps['M-03'] && st.totalOnRoute === 2,
       { gaps: Object.keys(st.gaps || {}), total: st.totalOnRoute });
    ok('el estado cuenta cuántas van yendo', st.yendo === 1, st.yendo);
    // La brecha entre los que SÍ trabajan no se movió por la señal de la casa
    ok('y las brechas de los demás no lo sienten',
       st.gaps['M-01'].aheadUnit !== 'M-03' && st.gaps['M-02'].aheadUnit !== 'M-03',
       { m1: st.gaps['M-01'].aheadUnit, m2: st.gaps['M-02'].aheadUnit });
  }

  console.log('\nPISA EL TRAZADO Y RECIÉN AHÍ ENTRA');
  {
    await gps(s3, -15.4802, -70.1202);   // llegó: sobre la punta de la ida
    await sleep(700);
    const st = await estado();
    const el = st.units.find(u => u.unitId === 'M-03');
    ok('el GPS lo confirma', !!el && el.enRuta === true, el && el.enRuta);
    ok('ahora sí tiene brecha', !!st.gaps['M-03'], Object.keys(st.gaps || {}));
    ok('y la cadena lo cuenta', st.totalOnRoute === 3 && st.yendo === 0,
       { total: st.totalOnRoute, yendo: st.yendo });
  }

  console.log('\nAUSENTE: COMER NO ES DESAPARECER');
  {
    await presencia(s2, 'ausente');
    await sleep(700);
    const st = await estado();
    const el = st.units.find(u => u.unitId === 'M-02');
    ok('sigue en el mapa, marcada ausente', !!el && el.presencia === 'ausente', el && el.presencia);
    ok('pero fuera de la cadena', !st.gaps['M-02'] && st.totalOnRoute === 2 && st.ausentes === 1,
       { total: st.totalOnRoute, ausentes: st.ausentes });
    // Con M-02 afuera, M-01 y M-03 se miden ENTRE ELLOS: la fila se recompone
    ok('los vecinos se recomponen sin el hueco',
       st.gaps['M-01'].aheadUnit === 'M-03' || st.gaps['M-03'].behindUnit === 'M-01' ||
       (st.gaps['M-01'].toAhead !== null || st.gaps['M-03'].toBehind !== null),
       { m1: st.gaps['M-01'], m3: st.gaps['M-03'] });

    // Vuelve del almuerzo: su palabra la pone "yendo", el GPS la confirma
    // (está parada al lado de la ruta, así que confirma con una posición).
    await presencia(s2, 'ruta');
    await sleep(500);
    let st2 = await estado();
    const antes = st2.units.find(u => u.unitId === 'M-02');
    ok('al volver queda yendo hasta que el GPS diga', antes && antes.enRuta === false, antes && antes.enRuta);
    await gps(s2, -15.4900, -70.1300);
    await sleep(700);
    st2 = await estado();
    ok('y una posición sobre el trazado la devuelve a la cadena',
       !!st2.gaps['M-02'] && st2.totalOnRoute === 3, st2.totalOnRoute);
  }

  console.log('\nSALIR DE RUTA: IRSE ES IRSE EN EL ACTO');
  {
    const r = await presencia(s3, 'fuera');
    ok('la salida entra', r.status === 200, r.status);
    await sleep(700);
    const st = await estado();
    ok('la unidad se fue del mapa sin esperar al olvido de 3 minutos',
       !st.units.some(u => u.unitId === 'M-03'), st.units.map(u => u.unitId));
    ok('y la cadena quedó en dos', st.totalOnRoute === 2, st.totalOnRoute);
  }

  console.log('\nLA PRESENCIA VIAJA PEGADA AL GPS');
  {
    // Con la pantalla apagada no hay WebSocket: el POST /gps lleva el estado
    // — y así sobrevive hasta a un reinicio del servidor.
    await gps(s3, -15.5200, -70.1650, { presencia: 'ruta' });
    await sleep(700);
    const st = await estado();
    const el = st.units.find(u => u.unitId === 'M-03');
    ok('reaparece yendo, declarado en el mismo POST',
       !!el && el.presencia === 'ruta' && el.enRuta === false,
       el && { presencia: el.presencia, enRuta: el.enRuta });
    ok('y sigue sin molestar a la cadena', st.totalOnRoute === 2 && !st.gaps['M-03'], st.totalOnRoute);
  }

  console.log('\nLA PUERTA');
  {
    ok('un estado inventado se rechaza',
       (await presencia(s1, 'durmiendo')).status === 400);
    const deDespacho = await pedir('/presencia', {
      method: 'POST', headers: HD, body: JSON.stringify({ estado: 'ruta' }),
    });
    ok('Despacho no declara presencia: no va arriba de una combi', deDespacho.status === 403, deDespacho.status);
    ok('sin sesión, nada', (await pedir('/presencia', {
      method: 'POST', body: JSON.stringify({ estado: 'ruta' }) })).status === 401);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  try { ws.close(); } catch {}
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
