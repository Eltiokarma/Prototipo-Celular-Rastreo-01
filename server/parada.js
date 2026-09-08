// La parada sostenida: una combi que lleva N minutos sin avanzar por la ruta.
//
// Es la mitad automática del aviso de tráfico. La otra mitad es la palabra
// del chofer ("estoy en tráfico"), que vive en index.js; esto sólo mide.
//
// QUÉ MIDE, Y POR QUÉ ASÍ
//
// No mide velocidad. El GPS parado da 0-3 km/h de ruido, y un embotellamiento
// que avanza a paso de hombre da 2-4 km/h: no se distinguen con un umbral de
// velocidad. Tampoco mide "no se movió de acá" con un ancla: la fila que
// avanza cinco metros cada diez segundos escapa de cualquier radio y sigue
// siendo tráfico. Mide lo que le importa a los demás choferes: CUÁNTO AVANZÓ
// POR LA RUTA en los últimos N minutos. Menos que `avanceM` en `paradaMs` es
// parada, sea que esté clavada o que arrastre. Los metros sobre la ruta ya
// los calcula la proyección del servidor (`recorridoM`), así que el zigzag
// del GPS —que en Juliaca son 10-30 m— se aplana solo.
//
// En Juliaca se sube y se baja en cada esquina; no hay paraderos. Pero nadie
// tarda tres minutos en subir: el umbral de tiempo es lo que separa la parada
// de pasajeros del embotellamiento, y por eso es lo único configurable.
//
// LO QUE NO CUENTA
//
//   - Los extremos del tramo: en el terminal se espera, y eso no es tráfico.
//     Quien llama dice `enExtremo`, porque sabe dónde termina cada tramo.
//   - Fuera de ruta: parado a tres cuadras del trazado no es tráfico DE la
//     ruta, y el desvío ya tiene su propia alarma.
//   - El cambio de vuelta: cuando el recorrido vuelve a cero, la ventana se
//     reinicia en vez de medir un avance negativo gigante.
//
// SALIDA: vuelve a "andando" cuando avanzó `libreAvanceM` dentro de los
// últimos `libreMs`. Es menos exigente que la entrada a propósito: un semáforo
// largo adentro de un embotellamiento no puede apagar y prender el aviso.
//
// JavaScript puro. Se prueba en `pruebas/parada.js` con un reloj inyectado;
// contra el servidor de verdad, en `pruebas/trafico.js`.

'use strict';

const PARADA_MS = 3 * 60_000;      // N minutos sin avanzar = parada
const AVANCE_M = 150;              // menos que esto en N minutos es "sin avanzar" (3 km/h)
const LIBRE_MS = 60_000;           // para salir: avanzó lo suyo en el último minuto
const LIBRE_AVANCE_M = 100;        // ... y "lo suyo" son 100 m (6 km/h)
const SALTO_ATRAS_M = 500;         // un retroceso así es cambio de vuelta, no marcha atrás

function crearDetectorDeParada({
  paradaMs = PARADA_MS, avanceM = AVANCE_M,
  libreMs = LIBRE_MS, libreAvanceM = LIBRE_AVANCE_M,
} = {}) {
  // vehicleId → { muestras: [{ t, m }], parado, desde }
  const estados = new Map();

  function avanceDesde(muestras, tDesde) {
    // Cuánto avanzó desde la primera muestra de la ventana hasta la última.
    // Se mira el MÁXIMO, no la última: una proyección que titubea entre dos
    // tramos no puede convertir "avanzó 200 m" en "retrocedió".
    let primera = null, max = -Infinity;
    for (const s of muestras) {
      if (s.t < tDesde) continue;
      if (primera === null) primera = s.m;
      if (s.m > max) max = s.m;
    }
    return primera === null ? 0 : Math.max(0, max - primera);
  }

  // Una posición nueva de la unidad. `recorridoM` son sus metros sobre la
  // ruta (proyección); `enExtremo` y `fueraDeRuta` los decide quien llama.
  // Devuelve { parado, desde, cambio } con cambio en 'empezo' | 'termino' |
  // null, para que el que llama abra o cierre el episodio.
  function posicion(vehicleId, { cuando, recorridoM, enExtremo = false, fueraDeRuta = false }) {
    let e = estados.get(vehicleId);
    if (!e) { e = { muestras: [], parado: false, desde: null }; estados.set(vehicleId, e); }

    // Lo que no se puede medir, o no cuenta, reinicia la ventana. Si estaba
    // parado, termina: no se puede sostener una parada sin datos.
    if (typeof recorridoM !== 'number' || !Number.isFinite(recorridoM) || enExtremo || fueraDeRuta) {
      return terminar(vehicleId, e, cuando);
    }
    const ultima = e.muestras[e.muestras.length - 1];
    if (ultima && ultima.m - recorridoM > SALTO_ATRAS_M) {
      // Cambió de vuelta (el circuito volvió a cero): ventana nueva
      e.muestras = [];
    }
    e.muestras.push({ t: cuando, m: recorridoM });
    // Sólo se guarda lo que entra en la ventana más larga
    const corte = cuando - Math.max(paradaMs, libreMs);
    while (e.muestras.length && e.muestras[0].t < corte) e.muestras.shift();

    // "Anda": avanzó lo suyo en el último minuto. Sirve para salir de la
    // parada, y para que la palabra del chofer ("estoy en tráfico") se apague
    // sola cuando vuelve a circular, esté o no marcada la parada automática.
    const andando = avanceDesde(e.muestras, cuando - libreMs) >= libreAvanceM;

    if (e.parado) {
      if (andando) return terminar(vehicleId, e, cuando, true);
      return { parado: true, desde: e.desde, cambio: null, andando };
    }

    // Para entrar hace falta la ventana ENTERA sin avance: si la primera
    // muestra es más nueva que N minutos, todavía no se sabe.
    const primera = e.muestras[0];
    if (!primera || cuando - primera.t < paradaMs) return { parado: false, desde: null, cambio: null, andando };
    if (avanceDesde(e.muestras, cuando - paradaMs) < avanceM) {
      e.parado = true;
      e.desde = primera.t;
      return { parado: true, desde: e.desde, cambio: 'empezo', andando };
    }
    return { parado: false, desde: null, cambio: null, andando };
  }

  function terminar(vehicleId, e, cuando, andando = false) {
    const estaba = e.parado;
    const desde = e.desde;
    e.muestras = [];
    e.parado = false;
    e.desde = null;
    return estaba
      ? { parado: false, desde, cambio: 'termino', duroMs: Math.max(0, cuando - desde), andando }
      : { parado: false, desde: null, cambio: null, andando };
  }

  // La unidad se fue (olvido, fuera de ruta declarada, cambio de trazado).
  // Devuelve si estaba parada, para que el que llama cierre el episodio.
  function olvidar(vehicleId) {
    const e = estados.get(vehicleId);
    estados.delete(vehicleId);
    return e ? { estabaParado: e.parado, desde: e.desde } : { estabaParado: false, desde: null };
  }

  function estadoDe(vehicleId) {
    const e = estados.get(vehicleId);
    return e ? { parado: e.parado, desde: e.desde } : { parado: false, desde: null };
  }

  return { posicion, olvidar, estadoDe };
}

module.exports = { crearDetectorDeParada, PARADA_MS, AVANCE_M, LIBRE_MS, LIBRE_AVANCE_M };
