// La prueba diferencial del cuadro del gerente.
//
// `/gerencia/resumen` traía todas las vueltas del período a memoria y las
// agrupaba en JavaScript. Agregando en SQL la pantalla baja de 1244 ms a una
// fracción, pero estos son los números con los que se juzga a los choferes
// —cumplimiento, vueltas, brecha promedio— y moverle uno al gerente sin querer
// es peor que la lentitud.
//
// Así que la versión vieja no se borró: quedó congelada en `server/resumen.js`
// como `agregadosEnJS`, y esta prueba corre LAS DOS sobre la misma base y
// exige que den exactamente lo mismo. **Campo por campo, con igualdad exacta**
// — no hay tolerancia, y no hace falta ninguna: los dos caminos suman enteros
// y hacen la misma división al final, así que la igualdad es por construcción.
// Si alguna vez hiciera falta una tolerancia, sería la señal de que uno de los
// dos está calculando otra cosa.
//
// Los datos son a propósito INCÓMODOS. Un promedio sale igual en las dos
// implementaciones casi siempre; lo que las separa son los bordes:
//
//   · días enteros sin actividad en el medio del período
//   · un chofer que aparece a mitad de período (no tiene el rango completo)
//   · una ruta creada a mitad de período
//   · vueltas SIN brecha guardada (las viejas) mezcladas con las que sí
//   · vueltas sin `objetivoSec` (anteriores a que se guardara) → caen a la
//     vara de la ruta de hoy, que es la parte más fácil de romper
//   · una combi que CAMBIÓ de ruta dentro del período
//   · una unidad con una sola vuelta, y una con vueltas de un solo día
//   · valores en el borde exacto de la tolerancia de cumplimiento
'use strict';

const RAIZ = require('path').join(__dirname, '..');
const fs = require('fs');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const resumen = require(RAIZ + '/server/resumen.js');

const DB = __dirname + '/resumen-test.db';
const TOLERANCIA = 0.15;   // el mismo TOLERANCIA_CUMPLE del servidor

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
const db = new Database(DB);
db.exec(`
  CREATE TABLE routes (routeId TEXT PRIMARY KEY, name TEXT, companyId TEXT, createdAt INTEGER);
  CREATE TABLE laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unitId TEXT NOT NULL, routeId TEXT,
    variantId INTEGER, startedAt INTEGER, finishedAt INTEGER NOT NULL,
    durationSec INTEGER NOT NULL, avgSpeed INTEGER NOT NULL, brechaProm INTEGER,
    objetivoSec INTEGER, parcial INTEGER NOT NULL DEFAULT 0, progresoInicial REAL);
  CREATE INDEX idx_laps_ruta ON laps (routeId, finishedAt, parcial);
`);

const DIA = 86400_000;
// Un "ahora" fijo a mediodía: pegado a la medianoche, un día de diferencia
// entre el reloj de SQLite y el de JavaScript pasaría desapercibido acá y
// aparecería en producción.
const HOY = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();

const EMPRESA = 'COOP-P';
const insRuta = db.prepare('INSERT INTO routes VALUES (?,?,?,?)');
insRuta.run('R-A', 'Ruta A', EMPRESA, HOY - 200 * DIA);
insRuta.run('R-B', 'Ruta B', EMPRESA, HOY - 200 * DIA);
insRuta.run('R-NUEVA', 'Ruta creada a mitad de período', EMPRESA, HOY - 20 * DIA);
insRuta.run('R-AJENA', 'De otra cooperativa', 'COOP-OTRA', HOY - 200 * DIA);

const insLap = db.prepare(`INSERT INTO laps
  (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec, parcial)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const vuelta = (u, r, diasAtras, dur, vel, brecha, obj, parcial = 0) =>
  insLap.run(u, r, HOY - diasAtras * DIA - dur * 1000, HOY - diasAtras * DIA, dur, vel, brecha, obj, parcial);

// ── Los datos incómodos ───────────────────────────────────────────────
// Actividad normal, con un HUECO deliberado: nada entre los días 40 y 55.
for (let d = 0; d < 90; d++) {
  if (d >= 40 && d <= 55) continue;                   // días sin servicio
  for (let v = 0; v < 3; v++) {
    vuelta('M-1', 'R-A', d, 2400 + (d + v) % 300, 20 + (v % 5), 300 + ((d * 7 + v) % 90), 300);
    vuelta('M-2', 'R-B', d, 2700 + (d * 3 + v) % 400, 18 + (v % 7), 250 + ((d * 11 + v) % 120), 240);
  }
}
// Un chofer que APARECE a mitad de período
for (let d = 0; d < 35; d++) vuelta('M-TARDE', 'R-A', d, 2500 + d % 200, 21, 320 + d % 40, 300);
// Una ruta creada a mitad de período, con su unidad
for (let d = 0; d < 18; d++) vuelta('M-NUEVA', 'R-NUEVA', d, 2600, 19, 280 + d % 30, null);
// Vueltas SIN brecha guardada, mezcladas con las que sí
for (let d = 0; d < 90; d += 7) vuelta('M-1', 'R-A', d, 2450, 20, null, 300);
// Vueltas SIN objetivoSec: caen a la vara de la ruta de HOY
for (let d = 0; d < 90; d += 5) vuelta('M-2', 'R-B', d, 2800, 17, 260 + d % 50, null);
// Una combi que CAMBIÓ de ruta dentro del período
for (let d = 60; d < 90; d++) vuelta('M-MUDA', 'R-A', d, 2500, 20, 300, 300);
for (let d = 0; d < 30; d++) vuelta('M-MUDA', 'R-B', d, 2600, 20, 260, 240);
// Una unidad con UNA sola vuelta, y otra con vueltas de un solo día
vuelta('M-UNA', 'R-A', 12, 3000, 25, 310, 300);
for (let v = 0; v < 6; v++) vuelta('M-UNDIA', 'R-B', 33, 2000 + v, 22, 240 + v, 240);
// Justo en el BORDE de la tolerancia: 15 % exacto por arriba y por abajo
vuelta('M-BORDE', 'R-A', 5, 2400, 20, 345, 300);     // +15,0 % → cumple
vuelta('M-BORDE', 'R-A', 5, 2400, 20, 255, 300);     // −15,0 % → cumple
vuelta('M-BORDE', 'R-A', 5, 2400, 20, 346, 300);     // +15,3 % → no cumple
// Parciales: NO tienen que entrar en ningún número
for (let d = 0; d < 90; d += 3) vuelta('M-1', 'R-A', d, 900, 30, 900, 300, 1);
// De otra cooperativa: tampoco
for (let d = 0; d < 90; d++) vuelta('M-AJENA', 'R-AJENA', d, 2400, 20, 300, 300);

db.exec('ANALYZE');

// ── El contexto, igual que lo arma el endpoint ────────────────────────
// `R-NUEVA` queda SIN objetivo a propósito: sus vueltas no tienen `objetivoSec`
// y su ruta tampoco tiene vara, así que no se pueden juzgar. Es el caso que
// devuelve `null` y el que más fácil se rompe al pasar a SQL.
const objetivoDeRuta = new Map([['R-A', 300], ['R-B', 240], ['R-NUEVA', 0]]);

const WHERE = `l.finishedAt BETWEEN @desde AND @hasta AND l.parcial = 0
  AND l.routeId IN (SELECT routeId FROM routes WHERE companyId = @empresa)
  AND (@ruta IS NULL OR l.routeId = @ruta)`;
const TRAER = `SELECT unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec
  FROM laps l WHERE ${WHERE}`;

function comparar(etiqueta, filtro) {
  const vueltas = db.prepare(TRAER).all(filtro);
  const viejo = resumen.agregadosEnJS(vueltas, { objetivoDeRuta, tolerancia: TOLERANCIA });
  const nuevo = resumen.agregadosEnSQL(db, { where: WHERE, filtro, objetivoDeRuta, tolerancia: TOLERANCIA });

  console.log(`\n${etiqueta}  (${vueltas.length.toLocaleString('es')} vueltas)`);

  // TOTALES, campo por campo
  const camposT = Object.keys(viejo.totales);
  const distintosT = camposT.filter(k => viejo.totales[k] !== nuevo.totales[k]);
  ok('los totales son idénticos, campo por campo', distintosT.length === 0,
     distintosT.map(k => `${k}: viejo ${viejo.totales[k]} vs nuevo ${nuevo.totales[k]}`));

  // POR DÍA: misma cantidad, mismo orden, mismos campos
  ok('la tendencia tiene los mismos días y en el mismo orden',
     viejo.porDia.length === nuevo.porDia.length &&
     viejo.porDia.every((d, i) => d.dia === nuevo.porDia[i].dia),
     { viejo: viejo.porDia.length, nuevo: nuevo.porDia.length,
       primero: [viejo.porDia[0]?.dia, nuevo.porDia[0]?.dia],
       ultimo: [viejo.porDia.at(-1)?.dia, nuevo.porDia.at(-1)?.dia] });
  const difDia = [];
  for (let i = 0; i < Math.min(viejo.porDia.length, nuevo.porDia.length); i++) {
    for (const k of Object.keys(viejo.porDia[i])) {
      if (viejo.porDia[i][k] !== nuevo.porDia[i][k]) {
        difDia.push(`${viejo.porDia[i].dia}.${k}: ${viejo.porDia[i][k]} vs ${nuevo.porDia[i][k]}`);
      }
    }
  }
  ok('y cada día da los mismos números', difDia.length === 0, difDia.slice(0, 6));

  // POR UNIDAD: mismas unidades y mismos campos
  const uv = [...viejo.porUnidad.keys()].sort(), un = [...nuevo.porUnidad.keys()].sort();
  ok('aparecen las mismas unidades', JSON.stringify(uv) === JSON.stringify(un),
     { soloViejo: uv.filter(x => !un.includes(x)), soloNuevo: un.filter(x => !uv.includes(x)) });
  const difU = [];
  for (const u of uv) {
    const a = viejo.porUnidad.get(u), b = nuevo.porUnidad.get(u) || {};
    for (const k of Object.keys(a)) if (a[k] !== b[k]) difU.push(`${u}.${k}: ${a[k]} vs ${b[k]}`);
  }
  ok('y cada unidad da los mismos números', difU.length === 0, difU.slice(0, 8));

  return { viejo, nuevo, vueltas };
}

(function () {
  const base = { empresa: EMPRESA, ruta: null };
  const rango = (dias) => ({ desde: HOY - dias * DIA - DIA / 2, hasta: HOY + DIA, ...base });

  comparar('7 DÍAS', rango(7));
  comparar('30 DÍAS', rango(30));
  const r90 = comparar('90 DÍAS (el rango máximo)', rango(90));
  comparar('90 DÍAS, ACOTADO A UNA RUTA', { ...rango(90), ruta: 'R-B' });
  comparar('UN RANGO QUE CAE ENTERO EN EL HUECO SIN ACTIVIDAD',
    { desde: HOY - 52 * DIA, hasta: HOY - 45 * DIA, ...base });
  comparar('UN RANGO SIN NINGUNA VUELTA (futuro)',
    { desde: HOY + 10 * DIA, hasta: HOY + 20 * DIA, ...base });
  comparar('UN SOLO DÍA', { desde: HOY - 33 * DIA - DIA / 2, hasta: HOY - 33 * DIA + DIA / 2, ...base });

  // Que los datos incómodos de verdad estén ejercitando lo que se cree
  console.log('\nLOS DATOS INCÓMODOS ESTÁN EJERCITANDO LO QUE TIENEN QUE EJERCITAR');
  {
    const t = r90.viejo.totales;
    ok('hay vueltas sin brecha guardada en el período', t.sinBrecha > 0, t.sinBrecha);
    ok('hay vueltas que se miden contra la vara de hoy', t.conObjetivoViejo > 0, t.conObjetivoViejo);
    ok('y otras contra la que guardaron', t.conObjetivoPropio > 0, t.conObjetivoPropio);
    ok('el cumplimiento no es ni 0 ni 100 (hay de las dos)',
       t.cumplimiento > 0 && t.cumplimiento < 100, t.cumplimiento);
    const huecos = r90.viejo.porDia.length;
    ok('la tendencia NO rellena los días sin servicio', huecos < 90, `${huecos} días con datos de 90`);
    ok('la combi que cambió de ruta está', r90.viejo.porUnidad.has('M-MUDA'));
    ok('la unidad de una sola vuelta está', r90.viejo.porUnidad.get('M-UNA').vueltas === 1);
    ok('la ruta sin vara deja el cumplimiento en null',
       r90.viejo.porUnidad.get('M-NUEVA').cumplimiento === null,
       r90.viejo.porUnidad.get('M-NUEVA').cumplimiento);
    ok('las parciales no entraron en ningún conteo',
       !r90.viejo.porUnidad.has('M-PARCIAL') &&
       r90.viejo.porUnidad.get('M-1').vueltas === db.prepare(
         "SELECT COUNT(*) c FROM laps WHERE unitId='M-1' AND parcial=0 AND finishedAt >= ?"
       ).get(HOY - 90 * DIA - DIA / 2).c);
    ok('la cooperativa ajena quedó afuera', !r90.viejo.porUnidad.has('M-AJENA'));
  }

  db.close();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLA(S) — la reescritura NO se sube` : '\nTodo OK: las dos implementaciones dan lo mismo');
  process.exit(fallas ? 1 : 0);
})();
