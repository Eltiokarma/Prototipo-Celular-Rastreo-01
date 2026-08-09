// El cuadro por unidad de Despacho muestra UN PERÍODO, y dice cuál.
//
// Esta pantalla era la única lectura del sistema que agrupaba todo lo
// retenido —120 días de la empresa entera— cada vez que alguien abría la
// pestaña. A 5000 unidades eran 1003 ms con la ingesta de GPS parada al lado
// (`COSTOS.md` §3, `PENDIENTES` 4.6). Ahora se acota.
//
// Pero lo que esta suite defiende no es el rendimiento: es que **el número y
// el rótulo digan lo mismo**. Acotar una pantalla que sigue diciendo
// "acumulado" es peor que no acotarla — el despachador lee un total y está
// viendo una semana, y con estos números se toman decisiones sobre personas.
// Por eso se prueba que el servidor devuelva QUÉ período sirvió, y que ese
// período sea el que efectivamente se aplicó a los datos.
//
// Las vueltas se insertan directo en la base con fechas elegidas: hacerlas
// nacer manejando llevaría horas de reloj y acá lo que importa es la edad de
// cada fila, no cómo se generó.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/periodo-test.db';
const P = 3193;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIA = 86400_000;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => { if (!/GEOAPIFY|clave se crea/.test(String(d))) process.stderr.write('[srv] ' + d); });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const pedir = (ruta, opts = {}) => fetch(API + ruta, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = async (u, p) =>
    (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;

  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };

  // Tres combis, cada una con vueltas de una edad distinta.
  for (const u of ['P-HOY', 'P-MES', 'P-VIEJA']) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, personRole: 'driver', password: 'chofer1234' }) });
  }

  const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
  const base = new Database(DB);
  const ahora = Date.now();
  const meter = base.prepare(`INSERT INTO laps
    (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, parcial)
    VALUES (?, 'R-14', ?, ?, ?, 20, 0)`);
  const meterTramo = base.prepare(`INSERT INTO legs
    (unitId, routeId, leg, startedAt, finishedAt, durationSec, parcial)
    VALUES (?, 'R-14', 'ida', ?, ?, ?, 0)`);
  // edad en días → una vuelta de esa antigüedad
  const vuelta = (unidad, edadDias, dur) => {
    const fin = ahora - edadDias * DIA;
    meter.run(unidad, fin - dur * 1000, fin, dur);
    meterTramo.run(unidad, fin - dur * 1000, fin, Math.round(dur / 2));
  };
  vuelta('P-HOY', 0, 3000);        // de hoy: entra en todos los períodos
  vuelta('P-MES', 20, 3100);       // de hace 20 días: entra en 30 y 90, no en 7
  vuelta('P-VIEJA', 200, 3200);    // de hace 200 días: sólo con ?todo=1
  base.close();

  const metricas = (q = '') => pedir('/admin/metrics' + q, { headers: HD });
  const unidades = (b) => (b.metrics || []).map(m => m.unitId).sort();

  console.log('\nEL DEFAULT SON 7 DÍAS, NO TODO EL HISTORIAL');
  {
    const r = await metricas();
    ok('contesta', r.status === 200, r.status);
    ok('dice qué período sirvió', !!r.body.periodo, r.body.periodo);
    ok('y ese período es 7 días',
       r.body.periodo && r.body.periodo.dias === 7 && r.body.periodo.todo === false, r.body.periodo);
    ok('la de hoy está', unidades(r.body).includes('P-HOY'), unidades(r.body));
    ok('la de hace 20 días NO está', !unidades(r.body).includes('P-MES'), unidades(r.body));
    ok('la de hace 200 días tampoco', !unidades(r.body).includes('P-VIEJA'), unidades(r.body));
  }

  console.log('\nEL PERÍODO PEDIDO SE APLICA A LOS DATOS, NO SÓLO SE ACEPTA');
  {
    const r30 = await metricas('?dias=30');
    ok('a 30 días aparece la de hace 20', unidades(r30.body).includes('P-MES'), unidades(r30.body));
    ok('pero no la de hace 200', !unidades(r30.body).includes('P-VIEJA'), unidades(r30.body));
    ok('y lo rotula como 30', r30.body.periodo && r30.body.periodo.dias === 30, r30.body.periodo);

    const r90 = await metricas('?dias=90');
    ok('a 90 días sigue sin estar la de hace 200',
       !unidades(r90.body).includes('P-VIEJA'), unidades(r90.body));
  }

  console.log('\nTODO EL HISTORIAL SIGUE ESTANDO, COMO ELECCIÓN EXPRESA');
  {
    const r = await metricas('?todo=1');
    ok('con ?todo=1 aparecen las tres', unidades(r.body).length === 3, unidades(r.body));
    ok('y el período dice que es todo',
       r.body.periodo && r.body.periodo.todo === true && r.body.periodo.dias === null, r.body.periodo);
  }

  console.log('\nUN PEDIDO ABSURDO SE RECORTA Y EL SERVIDOR LO DICE');
  {
    // El rótulo de la pantalla sale de `periodo`, no de lo que el panel creyó
    // pedir. Si el servidor recorta y no lo dijera, la pantalla afirmaría un
    // período que no es el que tiene en la tabla.
    const r = await metricas('?dias=9999');
    ok('9999 días se recorta a 365', r.body.periodo && r.body.periodo.dias === 365, r.body.periodo);
    const r0 = await metricas('?dias=0');
    ok('0 días no deja el período en cero', r0.body.periodo && r0.body.periodo.dias >= 1, r0.body.periodo);
    const rx = await metricas('?dias=abc');
    ok('un número que no es número cae al default', rx.body.periodo && rx.body.periodo.dias === 7, rx.body.periodo);
  }

  console.log('\nLAS MEDIAS VUELTAS SE ACOTAN CON EL MISMO CORTE');
  {
    // Si `legs` no se acotara junto con `laps`, una unidad sin vueltas en la
    // semana aparecería igual —traída por sus idas viejas— en una tabla que
    // dice "últimos 7 días".
    const r = await metricas();
    const vieja = (r.body.metrics || []).find(m => m.unitId === 'P-VIEJA');
    ok('la unidad vieja no entra por sus tramos', !vieja, vieja);
    const todo = await metricas('?todo=1');
    const v2 = (todo.body.metrics || []).find(m => m.unitId === 'P-VIEJA');
    ok('pero con ?todo=1 sí, y con su ida contada', !!v2 && v2.idas === 1, v2 && { idas: v2.idas });
  }

  console.log(fallas ? `\n=== ${fallas} FALLA(S) ===` : '\n=== TODO OK ===');
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('FALLA (excepción):', e);
  if (servidor) servidor.kill();
  process.exit(1);
});
