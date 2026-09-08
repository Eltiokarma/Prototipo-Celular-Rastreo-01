// El reloj del teléfono, cuando va atrasado.
//
// El servidor juzga si una posición es de AHORA por la hora que trae puesta
// (`timestamp`, la del teléfono) contra la suya. Un Android con el reloj dos
// minutos atrás —pasa: hora manual, zona mal puesta, sin sincronizar— manda
// una posición cada 3 s, perfecta, y ninguna pasa por fresca: la unidad queda
// gris el turno entero, los vecinos la ven sin tiempo, no se la muestrea y
// el objetivo automático no la cuenta. Todo por un reloj.
//
// La firma de un reloj atrasado es distinta de la de un atraso de red:
//
//   - reloj atrasado: TODOS los envíos llegan con la posición más nueva ~N s
//     vieja, sostenido, siempre el mismo N;
//   - vaciado de atraso tras un corte: cada envío trae la posición de ahora
//     adentro (la cola guarda las más nuevas), así que la más nueva del lote
//     tiene edad ~0 aunque el resto sea viejo;
//   - la app repitiendo lo mismo ("150 ya vistas, la más nueva de hace
//     4302 s"): edades enormes, que no son un reloj de nadie.
//
// Entonces el sesgo se estima como el MÍNIMO de la edad de la posición más
// nueva de cada envío, sobre una ventana de minutos, y sólo se cree cuando se
// sostuvo un rato (varias muestras a lo largo de por lo menos `lapsoMs`) y
// es un número que un reloj puede tener (hasta `topeMs`). Un mínimo no se
// deja engañar por el vaciado: basta un envío con la posición de ahora para
// que baje a cero.
//
// Lo que NO cubre: un reloj que salta hacia ATRÁS a mitad de turno. Sus
// posiciones pasan a ser más viejas que la última conocida y el filtro de
// «ya vistas» las descarta durante lo que saltó (un minuto, si saltó un
// minuto); recién después el mínimo baja y se la juzga bien. Se acepta: es
// raro, dura lo que dura el salto, y el filtro protege de algo más común.
//
// Puro, con suite (`pruebas/reloj.js`). Ver REVISION-2026-09-08.md, L5.

'use strict';

const LAPSO_MS = 60_000;          // sostenido por lo menos un minuto
const MIN_MUESTRAS = 3;           // y con tres envíos como mínimo
const VENTANA_MS = 5 * 60_000;    // se mira lo de los últimos cinco minutos
const TOPE_MS = 10 * 60_000;      // más que esto no es un reloj: es atraso
const MAX_MUESTRAS = 64;          // por unidad; 2000 unidades no son un problema

function crearEstimadorDeReloj({
  lapsoMs = LAPSO_MS, minMuestras = MIN_MUESTRAS, ventanaMs = VENTANA_MS, topeMs = TOPE_MS,
} = {}) {
  const porUnidad = new Map(); // id → [{ t, edad }]

  // Un envío del teléfono: `cuando` es la hora de llegada (la del servidor) y
  // `edadMs` cuánto más vieja que esa hora venía la posición más nueva.
  function muestra(id, { cuando, edadMs }) {
    if (!Number.isFinite(cuando) || !Number.isFinite(edadMs)) return;
    let m = porUnidad.get(id);
    if (!m) { m = []; porUnidad.set(id, m); }
    m.push({ t: cuando, edad: Math.max(0, edadMs) });
    while (m.length && (m[0].t < cuando - ventanaMs || m.length > MAX_MUESTRAS)) m.shift();
  }

  // Cuánto se estima que atrasa el reloj de esa unidad, en ms. 0 cuando no
  // hay con qué decirlo o cuando lo que se ve no es un reloj.
  function sesgoDe(id, ahora = Date.now()) {
    const m = porUnidad.get(id);
    if (!m) return 0;
    const vivas = m.filter(s => s.t >= ahora - ventanaMs);
    if (vivas.length < minMuestras) return 0;
    if (vivas[vivas.length - 1].t - vivas[0].t < lapsoMs) return 0;
    let min = Infinity;
    for (const s of vivas) if (s.edad < min) min = s.edad;
    return min > topeMs ? 0 : min;
  }

  function olvidar(id) { porUnidad.delete(id); }

  return { muestra, sesgoDe, olvidar };
}

module.exports = { crearEstimadorDeReloj, LAPSO_MS, MIN_MUESTRAS, VENTANA_MS, TOPE_MS };
