// El que se METE a la ruta empezada, y el que hace MEDIA VUELTA.
//
// Dos agujeros que se veían igual desde afuera —una fila en `laps` idéntica
// a las demás, o ninguna fila— y que son cosas distintas:
//
//   1. El chofer que no sale del paradero inicial y se engancha a mitad de
//      ruta cerraba una "vuelta" que es el pedazo que le faltaba al circuito.
//      Duraba una fracción y entraba a los promedios como entera: bajaba la
//      duración promedio de la ruta, movía el objetivo automático y le
//      sumaba una vuelta que no dio. Ahora se guarda MARCADA (`parcial`) y
//      queda fuera de todo promedio, sin desaparecer de la lista.
//
//   2. El chofer que hace la ida y se va no completaba el circuito, así que
//      no dejaba NADA: ni fila, ni conteo, ni línea en el informe. Quedaban
//      sus horas y ningún dato que dijera qué hizo con ellas. Ahora cada
//      tramo terminado se guarda por su cuenta en `legs`.
//
// El circuito de prueba es el mismo de `tramos.js`: 1 km al norte (ida) y el
// mismo kilómetro al sur (vuelta), por la MISMA calle. Es el caso duro —los
// dos tramos empatan por cercanía y el desempate lo hace el rumbo—, así que
// si las medias vueltas se cuentan bien acá, se cuentan bien en cualquier
// trazado.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/metidos-test.db';
const P = 3184;
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

  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };

  // El circuito: 1 km al norte y el mismo kilómetro al sur.
  const LAT0 = -15.50, LNG = -70.13;
  const g = 1000 / 111320;                       // 1 km en grados de latitud
  const ida = [{ lat: LAT0, lng: LNG }, { lat: LAT0 + g, lng: LNG }];
  const vuelta = [{ lat: LAT0 + g, lng: LNG }, { lat: LAT0, lng: LNG }];
  await pedir('/admin/routes/R-14/points', {
    method: 'PUT', headers: HD, body: JSON.stringify({ tramos: { ida, vuelta } }),
  });

  for (const u of ['M-01', 'M-02']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, personRole: 'driver', password: 'chofer1234' }) });
  }
  const s1 = await login('M-01', 'chofer1234');
  const s2 = await login('M-02', 'chofer1234');

  const presencia = (sesion, estado) => pedir('/presencia', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sesion.token },
    body: JSON.stringify({ estado }),
  });
  // `frac` es la fracción del kilómetro: 0 abajo (inicio de la ida), 1 arriba
  // (la punta, donde la ida termina y la vuelta empieza).
  const gps = (sesion, frac) => pedir('/gps', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sesion.token },
    body: JSON.stringify({ posiciones: [{ lat: LAT0 + g * frac, lng: LNG, speed: 20, timestamp: Date.now() }] }),
  });
  // Un recorrido: varias posiciones seguidas, que es lo que necesita tanto la
  // detección de vuelta (mínimo de muestras) como la de tramo (confirmación).
  const recorrer = async (sesion, fracs, espera = 120) => {
    for (const f of fracs) { await gps(sesion, f); await sleep(espera); }
  };

  const WebSocket = require(RAIZ + '/server/node_modules/ws');
  const ws = new WebSocket(`ws://localhost:${P}`);
  let ultimo = null;
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ultimo = m; });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token: d.token }));
  await sleep(800);
  const estado = async () => { await sleep(600); return ultimo || {}; };
  const unidad = async (id) => ((await estado()).units || []).find(u => u.unitId === id);

  const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
  const base = new Database(DB, { readonly: true });
  const lapsDe = (u) => base.prepare('SELECT * FROM laps WHERE unitId = ? ORDER BY id').all(u);
  const legsDe = (u) => base.prepare('SELECT * FROM legs WHERE unitId = ? ORDER BY id').all(u);

  console.log('\nEL QUE SE METE A MITAD DE RUTA SE DETECTA AL CONFIRMAR');
  {
    await presencia(s1, 'ruta');
    // Se engancha arriba de todo: la punta de la ida es la mitad del
    // circuito, o sea que el 50 % ya se lo salteó.
    await gps(s1, 0.98);
    const el = await unidad('M-01');
    ok('lo confirma en ruta igual (pisó el trazado)', !!el && el.enRuta === true, el && el.enRuta);
    ok('pero marcado como entrada tardía', !!el && el.entradaTardia === true, el && el.entradaTardia);
    ok('y con el punto por el que entró', !!el && el.entroEn > 0.4 && el.entroEn < 0.6,
       el && Number(el.entroEn).toFixed(3));

    const act = await pedir('/admin/audit', { headers: HD });
    ok('queda en la auditoría, para poder contarlo después',
       (act.body.events || []).some(e => e.action === 'entrada_tardia' && e.target === 'M-01'),
       (act.body.events || []).slice(0, 3).map(e => e.action));
  }

  console.log('\nY SU PRIMERA VUELTA SE GUARDA MARCADA, NO SE CUENTA');
  {
    // Baja por la vuelta hasta cruzar el inicio del circuito: eso cierra la
    // medición que arrancó a mitad de camino.
    await recorrer(s1, [0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0.02]);
    // Y arranca la ida de nuevo, que es lo que hace caer el progreso a ~0
    await recorrer(s1, [0.05, 0.15, 0.3]);
    await sleep(600);

    const ls = lapsDe('M-01');
    ok('cerró una vuelta', ls.length >= 1, ls.length);
    ok('marcada como parcial', ls.length >= 1 && ls[0].parcial === 1, ls[0] && ls[0].parcial);
    ok('con el progreso por el que entró guardado',
       ls.length >= 1 && ls[0].progresoInicial > 0.4 && ls[0].progresoInicial < 0.6,
       ls[0] && Number(ls[0].progresoInicial).toFixed(3));

    const v = await pedir('/admin/vueltas', { headers: HD });
    ok('Despacho la LISTA (no se esconde)',
       (v.body.vueltas || []).some(l => l.unitId === 'M-01' && l.parcial === 1),
       (v.body.vueltas || []).map(l => [l.unitId, l.parcial]));
    ok('pero no la cuenta como vuelta cerrada', v.body.resumen.cerradas === 0, v.body.resumen.cerradas);
    ok('y la cuenta aparte', v.body.resumen.parciales === 1, v.body.resumen.parciales);
    ok('el promedio no se ensucia con ella', v.body.resumen.duracionProm === null,
       v.body.resumen.duracionProm);

    const m = await pedir('/admin/metrics', { headers: HD });
    const mm = (m.body.metrics || []).find(x => x.unitId === 'M-01');
    ok('el cuadro por unidad tampoco la suma', !!mm && mm.lapsTotal === 0, mm && mm.lapsTotal);
    ok('pero dice cuántas parciales tiene', !!mm && mm.parciales === 1, mm && mm.parciales);
  }

  console.log('\nLA VUELTA SIGUIENTE, YA DESDE EL INICIO, SÍ ES ENTERA');
  {
    // Sube la ida entera, baja la vuelta entera y vuelve a cruzar el inicio
    await recorrer(s1, [0.5, 0.7, 0.9, 0.99]);
    await recorrer(s1, [0.9, 0.7, 0.5, 0.3, 0.1, 0.02]);
    await recorrer(s1, [0.05, 0.2]);
    await sleep(600);

    const ls = lapsDe('M-01');
    const enteras = ls.filter(l => l.parcial === 0);
    ok('cerró una vuelta entera', enteras.length >= 1, ls.map(l => l.parcial));
    ok('que arranca cerca del inicio del circuito',
       enteras.length >= 1 && enteras[0].progresoInicial < 0.15,
       enteras[0] && Number(enteras[0].progresoInicial).toFixed(3));

    const v = await pedir('/admin/vueltas', { headers: HD });
    ok('ahora sí cuenta', v.body.resumen.cerradas >= 1, v.body.resumen.cerradas);
    ok('y el promedio existe', v.body.resumen.duracionProm !== null, v.body.resumen.duracionProm);
  }

  console.log('\nLAS MEDIAS VUELTAS SE CUENTAN POR SEPARADO');
  {
    const tramos = legsDe('M-01');
    ok('se guardaron tramos', tramos.length >= 2, tramos.map(t => t.leg));
    ok('hay al menos una ida y una vuelta',
       tramos.some(t => t.leg === 'ida') && tramos.some(t => t.leg === 'vuelta'),
       tramos.map(t => `${t.leg}${t.parcial ? '(parcial)' : ''}`));

    const v = await pedir('/admin/vueltas', { headers: HD });
    ok('Despacho ve idas y retornos en el resumen',
       v.body.resumen.idas >= 1 && v.body.resumen.retornos >= 1,
       { idas: v.body.resumen.idas, retornos: v.body.resumen.retornos });

    const m = await pedir('/admin/metrics', { headers: HD });
    const mm = (m.body.metrics || []).find(x => x.unitId === 'M-01');
    ok('y por unidad', !!mm && mm.idas >= 1 && mm.retornos >= 1,
       mm && { idas: mm.idas, retornos: mm.retornos });
  }

  console.log('\nEL QUE HACE LA IDA Y SE VA: LA IDA NO SE PIERDE');
  {
    // M-02 sale del principio, hace la ida completa y declara "fuera" arriba.
    // Antes de esto no dejaba ni una fila: no completó el circuito.
    await presencia(s2, 'ruta');
    await recorrer(s2, [0.02, 0.15, 0.35, 0.55, 0.75, 0.9, 0.99]);
    await sleep(500);

    ok('todavía no cerró ninguna vuelta (no volvió)', lapsDe('M-02').length === 0, lapsDe('M-02').length);

    const r = await presencia(s2, 'fuera');
    ok('termina el turno', r.status === 200, r.body);
    await sleep(700);

    const tramos = legsDe('M-02');
    ok('pero la IDA quedó guardada', tramos.length === 1 && tramos[0].leg === 'ida',
       tramos.map(t => t.leg));
    ok('entera, no parcial', tramos.length === 1 && tramos[0].parcial === 0, tramos[0] && tramos[0].parcial);
    ok('y sigue sin haber vuelta cerrada', lapsDe('M-02').length === 0, lapsDe('M-02').length);

    const m = await pedir('/admin/metrics', { headers: HD });
    const mm = (m.body.metrics || []).find(x => x.unitId === 'M-02');
    ok('Despacho la ve con 1 ida y 0 retornos —salió y no volvió—',
       !!mm && mm.idas === 1 && mm.retornos === 0, mm && { idas: mm.idas, retornos: mm.retornos });
  }

  console.log('\nEL PERFIL DEL CHOFER MUESTRA LO MISMO');
  {
    const p = await pedir('/perfil', { headers: { Authorization: 'Bearer ' + s2.token } });
    const met = p.body.metricas || {};
    ok('el que hizo la ida ve su ida', met.idas === 1, met.idas);
    ok('y ningún retorno', met.retornos === 0, met.retornos);
    ok('sin vueltas cerradas', met.vueltas === 0, met.vueltas);

    const p1 = await pedir('/perfil', { headers: { Authorization: 'Bearer ' + s1.token } });
    const met1 = p1.body.metricas || {};
    ok('el que se metió ve su vuelta entera', met1.vueltas >= 1, met1.vueltas);
    ok('y su parcial contada aparte', met1.parciales === 1, met1.parciales);
  }

  console.log('\nEL INFORME DE MEDIAS VUELTAS EXISTE Y SALE');
  {
    const desde = Date.now() - 3600_000, hasta = Date.now() + 60_000;
    const r = await fetch(`${API}/admin/informe/tramos.csv?desde=${desde}&hasta=${hasta}`, { headers: HD });
    const csv = await r.text();
    ok('el CSV se genera', r.status === 200, r.status);
    ok('trae la columna del tramo', csv.includes('Tramo'), csv.split('\r\n')[5]);
    ok('y las filas de las dos unidades', csv.includes('M-01') && csv.includes('M-02'),
       csv.split('\r\n').length + ' líneas');

    const rv = await fetch(`${API}/admin/informe/vueltas.csv?desde=${desde}&hasta=${hasta}`, { headers: HD });
    const csvv = await rv.text();
    // El CSV dice el HECHO, no la causa: una vuelta arranca a mitad de
    // circuito porque el chofer se enganchó ahí, pero también porque estuvo
    // sin señal y la medición se cortó. Este archivo se imprime y se lleva a
    // una reunión — no puede afirmar lo que no sabe.
    ok('y el de vueltas dice cuál no es entera, sin acusar de la causa',
       csvv.includes('la medición no arrancó en el inicio') &&
       !/se metió a mitad de ruta/.test(csvv), csvv.includes('Arrancó al % del circuito'));
  }

  base.close();
  ws.close();
  servidor.kill();

  // ── LA ZONA MUERTA NO ES UNA ENTRADA TARDÍA ──────────────────────────
  //
  // El caso que puede arruinar la detección entera: el olvido desconfirma a
  // los 3 minutos sin oír al teléfono, y un cerro, un sótano o una batería
  // agotada duran más que eso. Al reaparecer, el chofer que venía desde el
  // paradero se ve EXACTAMENTE IGUAL que el que se acaba de meter — y si el
  // sistema no los distingue, deja acusado en la auditoría a alguien que
  // hizo su trabajo. Una acusación automática y falsa es peor que no tener
  // la detección: se descubre discutiendo con un chofer que tiene razón.
  //
  // Servidor aparte con el olvido en 2 s: el barrido corre cada 10 s, así que
  // reproducirlo con el valor real serían tres minutos de prueba.
  await correrZonaMuerta();

  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);

  async function correrZonaMuerta() {
    console.log('\nUNA ZONA MUERTA NO CONVIERTE AL CHOFER EN UNO QUE SE METIÓ');
    const DB2 = S + '/metidos-muerta.db';
    const P2 = 3185, API2 = `http://localhost:${P2}`;
    for (const f of [DB2, DB2 + '-wal', DB2 + '-shm']) { try { fs.unlinkSync(f); } catch {} }
    const srv = spawn('node', [RAIZ + '/server/index.js'], {
      env: { ...process.env, PORT: String(P2), DB_FILE: DB2, DISPATCH_PASSWORD: 'despacho99',
             STATE_INTERVAL_MS: '400', OLVIDAR_MS: '2000' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    srv.stderr.on('data', x => process.stderr.write('[srv2] ' + x));
    for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API2 + '/ping'); break; } catch {} }
    try {
      const p2 = (ruta, opts = {}) => fetch(API2 + ruta, {
        ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
      const log2 = async (u, c) =>
        (await p2('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body;

      const d2 = await log2('DESPACHO', 'despacho99');
      const H2 = { Authorization: 'Bearer ' + d2.token };
      const HG2 = { Authorization: 'Bearer ' + await require('./gerente.js')(API2, DB2) };
      await p2('/admin/routes/R-14/points', {
        method: 'PUT', headers: H2, body: JSON.stringify({ tramos: { ida, vuelta } }) });
      await p2('/admin/users', { method: 'POST', headers: HG2,
        body: JSON.stringify({ unitId: 'M-09', name: 'Chofer nueve', personRole: 'driver', password: 'chofer1234' }) });
      const s9 = await log2('M-09', 'chofer1234');
      const gps2 = (frac) => p2('/gps', {
        method: 'POST', headers: { Authorization: 'Bearer ' + s9.token },
        body: JSON.stringify({ posiciones: [{ lat: LAT0 + g * frac, lng: LNG, speed: 20, timestamp: Date.now() }] }),
      });

      const ws2 = new WebSocket(`ws://localhost:${P2}`);
      let ult = null;
      ws2.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') ult = m; });
      await new Promise(r => ws2.on('open', r));
      ws2.send(JSON.stringify({ type: 'identify', token: d2.token }));
      await sleep(600);
      const u9 = async () => { await sleep(600); return ((ult || {}).units || []).find(u => u.unitId === 'M-09'); };

      // Sale del principio, como corresponde
      await p2('/presencia', { method: 'POST', headers: { Authorization: 'Bearer ' + s9.token },
        body: JSON.stringify({ estado: 'ruta' }) });
      await gps2(0.02);
      let el = await u9();
      ok('sale desde el inicio: entrada normal', !!el && el.enRuta === true && el.entradaTardia === false,
         el && { enRuta: el.enRuta, tardia: el.entradaTardia });

      // Maneja un rato y entra a la zona muerta a mitad de la ida
      for (const f of [0.15, 0.3, 0.45]) { await gps2(f); await sleep(150); }
      const antes = ((await p2('/admin/audit', { headers: H2 })).body.events || [])
        .filter(e => e.action === 'entrada_tardia').length;

      // Silencio: más que OLVIDAR_MS y que el barrido de 10 s
      await sleep(13_000);
      ok('el barrido la olvida, como siempre', !(await u9()), 'fuera del mapa');

      // Y vuelve, más adelante en la ruta — como vuelve cualquiera que
      // siguió manejando mientras no había señal
      await gps2(0.62);
      el = await u9();
      ok('al volver entra de nuevo a la cadena', !!el && el.enRuta === true, el && el.enRuta);
      ok('pero NO como entrada tardía: reanuda, no entra',
         !!el && el.entradaTardia === false, el && { tardia: el.entradaTardia, entroEn: el.entroEn });

      const despues = ((await p2('/admin/audit', { headers: H2 })).body.events || [])
        .filter(e => e.action === 'entrada_tardia').length;
      ok('y no queda acusado en la auditoría', despues === antes, { antes, despues });

      ws2.close();
    } finally {
      srv.kill();
      for (const f of [DB2, DB2 + '-wal', DB2 + '-shm']) { try { fs.unlinkSync(f); } catch {} }
    }
  }
})().catch(e => {
  console.error('FALLA (excepción):', e);
  if (servidor) servidor.kill();
  process.exit(1);
});
