// Los agregados del cuadro del gerente, en dos implementaciones.
//
// POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ TIENE DOS VERSIONES DE LO MISMO.
//
// `/gerencia/resumen` traía TODAS las vueltas del período a memoria y las
// agrupaba en JavaScript: a 5000 unidades y 90 días son 244 980 filas, y la
// pantalla tardaba 1244 ms. Como SQLite es sincrónico y comparte hilo con los
// `POST /gps`, eso no es una pantalla lenta: es la ingesta de GPS de la flota
// entera parada 1467 ms (`COSTOS.md` §3).
//
// Agregar en SQL lo arregla. Pero estos números son con los que se juzga a los
// choferes —cumplimiento, vueltas, brecha promedio— y moverle uno al gerente
// sin querer es peor que el segundo y medio. Así que la versión vieja no se
// borró: quedó acá al lado, congelada, y una prueba corre las dos sobre la
// misma base y exige que den EXACTAMENTE lo mismo, campo por campo
// (`pruebas/resumen.js`). Si difiere un solo número, la reescritura no se sube.
//
// Vive en su propio archivo por lo mismo que `server/trazador.js`: es lógica
// pura, Node la carga con require() y la prueba sin levantar nada.
//
// ─────────────────────────────────────────────────────────────────────
// TRES DETALLES QUE HACEN QUE LAS DOS DEN EL MISMO NÚMERO Y NO "PARECIDO"
//
// 1. **Las divisiones se hacen en JavaScript, no en SQL.** SQL trae SUMAS y
//    CUENTAS; el promedio se calcula acá con el mismo `Math.round(suma/n)` de
//    siempre. Usar `AVG()` habría sido más corto y habría dado diferencias en
//    el último bit: SQLite promedia incrementalmente y JS divide al final.
//    Con enteros la suma es exacta en los dos lados, así que el resultado es
//    idéntico por construcción y no por suerte.
//
// 2. **`* 1.0` en la comparación de cumplimiento, y no es cosmético.** En
//    SQLite `entero / entero` es DIVISIÓN ENTERA: `ABS(b - obj) / obj` daría 0
//    para toda diferencia menor al objetivo, o sea "todas cumplen". Hay que
//    forzar el flotante para que la cuenta sea la misma que hace JS.
//
// 3. **La vara de cada vuelta viaja como parámetros, no pegada al SQL.** El
//    objetivo de una ruta se calcula en vivo (puede ser automático), así que
//    no está en la base: entra como una tabla `VALUES` con sus valores
//    atados. Nada de armar SQL con strings — ni siquiera con identificadores
//    que salieron de la base.

'use strict';

// La clave de día del agrupado: AÑO-MES-DÍA en hora LOCAL, que es la del
// lugar donde manejan. Se replica igual en las dos versiones porque cambiarla
// movería los puntos de la tendencia de lugar.
function claveDia(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════
// LA REFERENCIA — la implementación que estaba en producción, movida acá
// tal cual. NO se toca para arreglar nada: si algo está mal acá, está mal en
// producción y cambiarlo es una decisión aparte, no un efecto secundario de
// una optimización. Su único trabajo hoy es ser el patrón contra el que se
// mide la nueva.
// ═══════════════════════════════════════════════════════════════════
function agregadosEnJS(vueltas, { objetivoDeRuta, tolerancia }) {
  const varaDe = (l) => l.objetivoSec || objetivoDeRuta.get(l.routeId) || null;
  const juzgar = (l) => {
    const obj = varaDe(l);
    if (l.brechaProm === null || !obj) return null;
    return Math.abs(l.brechaProm - obj) / obj <= tolerancia;
  };
  const prom = (lista, campo) => lista.length
    ? Math.round(lista.reduce((a, x) => a + x[campo], 0) / lista.length) : null;
  const porcentaje = (juzgadas) => {
    const con = juzgadas.filter(v => v !== null);
    return con.length ? Math.round((con.filter(Boolean).length / con.length) * 100) : null;
  };

  const conBrecha = vueltas.filter(l => l.brechaProm !== null);

  // Tendencia: un punto por día del rango QUE TENGA vueltas. Sin rellenar los
  // días vacíos con ceros — un feriado sin servicio no es un día de cero
  // cumplimiento, es un día sin datos, y la diferencia importa.
  const dias = new Map();
  for (const l of vueltas) {
    const clave = claveDia(l.finishedAt);
    if (!dias.has(clave)) dias.set(clave, []);
    dias.get(clave).push(l);
  }
  const porDia = Array.from(dias.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([dia, ls]) => ({
      dia,
      vueltas: ls.length,
      unidades: new Set(ls.map(l => l.unitId)).size,
      duracionProm: prom(ls, 'durationSec'),
      brechaProm: prom(ls.filter(l => l.brechaProm !== null), 'brechaProm'),
      cumplimiento: porcentaje(ls.map(juzgar)),
    }));

  const unidades = new Map();
  for (const l of vueltas) {
    if (!unidades.has(l.unitId)) unidades.set(l.unitId, []);
    unidades.get(l.unitId).push(l);
  }
  const porUnidad = new Map();
  for (const [unitId, ls] of unidades) {
    const conB = ls.filter(l => l.brechaProm !== null);
    porUnidad.set(unitId, {
      routeId: ls[0].routeId,
      vueltas: ls.length,
      duracionProm: prom(ls, 'durationSec'),
      duracionMejor: Math.min(...ls.map(l => l.durationSec)),
      velocidadProm: prom(ls, 'avgSpeed'),
      brechaProm: prom(conB, 'brechaProm'),
      cumplimiento: porcentaje(ls.map(juzgar)),
      sinBrecha: ls.length - conB.length,
    });
  }

  return {
    porDia,
    porUnidad,
    totales: {
      vueltas: vueltas.length,
      duracionProm: prom(vueltas, 'durationSec'),
      brechaProm: prom(conBrecha, 'brechaProm'),
      cumplimiento: porcentaje(vueltas.map(juzgar)),
      sinBrecha: vueltas.length - conBrecha.length,
      conObjetivoPropio: vueltas.filter(l => l.brechaProm !== null && l.objetivoSec).length,
      conObjetivoViejo: vueltas.filter(l => l.brechaProm !== null && !l.objetivoSec).length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// LA NUEVA — la misma cuenta, hecha por el motor.
// ═══════════════════════════════════════════════════════════════════

// La vara de cada vuelta: la que guardó, y si no la de su ruta hoy. Como el
// objetivo de una ruta se calcula en vivo, entra como tabla de valores atados.
// Sin rutas no hay con qué comparar y se usa NULL, que es lo que hace `varaDe`.
function trozoVara(objetivoDeRuta) {
  const rutas = Array.from(objetivoDeRuta.entries()).filter(([, v]) => v);
  if (!rutas.length) return { cte: '', join: '', vara: 'l.objetivoSec', params: [] };
  const filas = rutas.map(() => '(?, ?)').join(', ');
  return {
    cte: `WITH vara(rutaId, obj) AS (VALUES ${filas})`,
    join: 'LEFT JOIN vara ON vara.rutaId = l.routeId',
    // `objetivoSec` primero y la de la ruta después: mismo orden que el `||`
    // de la referencia. Un `objetivoSec` de 0 cae al de la ruta, igual que allá.
    vara: 'CASE WHEN l.objetivoSec THEN l.objetivoSec ELSE vara.obj END',
    params: rutas.flat(),
  };
}

// Las tres columnas que resuelven el cumplimiento sin traerse las filas.
// `* 1.0` obligatorio: sin eso la división es entera y todo "cumple".
const columnasCumple = (vara, tol) => `
  SUM(CASE WHEN l.brechaProm IS NOT NULL AND (${vara}) THEN 1 ELSE 0 END) AS juzgables,
  SUM(CASE WHEN l.brechaProm IS NOT NULL AND (${vara})
            AND (ABS(l.brechaProm - (${vara})) * 1.0) / (${vara}) <= ${tol}
      THEN 1 ELSE 0 END) AS cumplen`;

function agregadosEnSQL(db, { where, filtro, objetivoDeRuta, tolerancia }) {
  const v = trozoVara(objetivoDeRuta);
  const cumple = columnasCumple(v.vara, tolerancia);
  // Los promedios se arman ACÁ con suma y cuenta, no con AVG(): ver la nota
  // de arriba sobre por qué eso es lo que hace que los números sean iguales
  // y no parecidos.
  const prom = (suma, n) => (n ? Math.round(suma / n) : null);
  const porcentaje = (cumplen, juzgables) => (juzgables ? Math.round((cumplen / juzgables) * 100) : null);
  const correr = (sql, extra = []) => db.prepare(sql).all(...v.params, ...extra, filtro);

  // ── Por día ──
  // La clave de día se calcula en SQL con `localtime` para que caiga en el
  // mismo día que `new Date(...)` de la referencia.
  const dias = correr(`
    ${v.cte}
    SELECT strftime('%Y-%m-%d', l.finishedAt / 1000, 'unixepoch', 'localtime') AS dia,
           COUNT(*) AS n,
           COUNT(DISTINCT l.unitId) AS unidades,
           SUM(l.durationSec) AS sumDur,
           SUM(l.brechaProm) AS sumBrecha,
           COUNT(l.brechaProm) AS nBrecha,
           ${cumple}
    FROM laps l ${v.join}
    WHERE ${where}
    GROUP BY dia
    ORDER BY dia
  `);
  const porDia = dias.map(d => ({
    dia: d.dia,
    vueltas: d.n,
    unidades: d.unidades,
    duracionProm: prom(d.sumDur, d.n),
    brechaProm: prom(d.sumBrecha, d.nBrecha),
    cumplimiento: porcentaje(d.cumplen, d.juzgables),
  }));

  // ── Por unidad ──
  // `MIN(l.routeId)` para la ruta: la referencia usa la de la PRIMERA vuelta
  // que le llegó, y como el índice recorre por (routeId, finishedAt) esa
  // primera es la del routeId más chico. Sólo se distinguen si una combi
  // cambió de ruta dentro del período; la prueba diferencial lo verifica.
  const unidades = correr(`
    ${v.cte}
    SELECT l.unitId AS unitId,
           MIN(l.routeId) AS routeId,
           COUNT(*) AS n,
           SUM(l.durationSec) AS sumDur,
           MIN(l.durationSec) AS mejorDur,
           SUM(l.avgSpeed) AS sumVel,
           SUM(l.brechaProm) AS sumBrecha,
           COUNT(l.brechaProm) AS nBrecha,
           ${cumple}
    FROM laps l ${v.join}
    WHERE ${where}
    GROUP BY l.unitId
  `);
  const porUnidad = new Map(unidades.map(u => [u.unitId, {
    routeId: u.routeId,
    vueltas: u.n,
    duracionProm: prom(u.sumDur, u.n),
    duracionMejor: u.mejorDur,
    velocidadProm: prom(u.sumVel, u.n),
    brechaProm: prom(u.sumBrecha, u.nBrecha),
    cumplimiento: porcentaje(u.cumplen, u.juzgables),
    sinBrecha: u.n - u.nBrecha,
  }]));

  // ── Totales ──
  const t = correr(`
    ${v.cte}
    SELECT COUNT(*) AS n,
           SUM(l.durationSec) AS sumDur,
           SUM(l.brechaProm) AS sumBrecha,
           COUNT(l.brechaProm) AS nBrecha,
           SUM(CASE WHEN l.brechaProm IS NOT NULL AND l.objetivoSec THEN 1 ELSE 0 END) AS conPropio,
           -- Un NOT a secas NO sirve: en SQL, NOT NULL es NULL y no
           -- verdadero, así que la fila se perdería. La referencia usa el !x
           -- de JavaScript, que sí es verdadero para NULL y para 0.
           SUM(CASE WHEN l.brechaProm IS NOT NULL
                     AND (l.objetivoSec IS NULL OR l.objetivoSec = 0)
               THEN 1 ELSE 0 END) AS conViejo,
           ${cumple}
    FROM laps l ${v.join}
    WHERE ${where}
  `)[0] || {};

  return {
    porDia,
    porUnidad,
    totales: {
      vueltas: t.n || 0,
      duracionProm: prom(t.sumDur, t.n),
      brechaProm: prom(t.sumBrecha, t.nBrecha),
      cumplimiento: porcentaje(t.cumplen, t.juzgables),
      sinBrecha: (t.n || 0) - (t.nBrecha || 0),
      conObjetivoPropio: t.conPropio || 0,
      conObjetivoViejo: t.conViejo || 0,
    },
  };
}

module.exports = { agregadosEnJS, agregadosEnSQL, claveDia };
