// El GPS que inventa: la heurística para el que NO trae el flag de Android.
//
// El flag `mocked` (TRUCOS-2026-09-10.md, T2) cubre a las apps de
// «ubicación simulada», que son la inmensa mayoría. No cubre a un teléfono
// rooteado con un módulo que inyecta la posición al sistema: ésas llegan
// como si fueran de verdad. Pero un GPS de verdad, en una combi, en Juliaca,
// tiene una firma que un simulador no imita sin esfuerzo:
//
//   1. La velocidad implícita entre posiciones seguidas VARÍA. Una combi
//      frena en cada esquina, sube y baja pasajeros, espera un semáforo. Un
//      simulador dibuja la ruta a velocidad constante.
//   2. La posición ZIGZAGUEA alrededor del trazado: 10-30 m de error en la
//      ciudad, más entre edificios. Un simulador va clavado sobre la línea.
//   3. La velocidad que reporta el aparato y la que sale de dividir metros
//      por segundos COINCIDEN, más o menos. Un simulador manda una velocidad
//      inventada, o cero, mientras la posición avanza.
//
// Ninguna de las tres sola alcanza: una avenida recta y vacía a la madrugada
// da velocidad casi constante; un GPS excelente en campo abierto va cerca
// del trazado. Por eso se exige una VENTANA entera (doce posiciones, ~2 min
// con la pantalla apagada) y se dice cuál firma se vio. Y por eso esto se
// ANOTA y no se avisa ni bloquea: es una sospecha, con su motivo, para que
// Despacho mire. El falso positivo cuesta más que el truco.
//
// Puro, con suite (`pruebas/farsa.js`). Cada unidad tiene su ventana.

'use strict';

const VENTANA = 12;            // posiciones seguidas para decir algo
const EN_MARCHA_KMH = 8;       // por debajo de esto está parada: no se juzga
const VARIACION_MIN_KMH = 1.0; // desvío estándar de la velocidad (implícita y reportada) por debajo del cual es "constante"
const RUIDO_MIN_M = 1.5;       // desvío al trazado por debajo del cual es "clavado"
const INCOHERENCIA_KMH = 30;   // diferencia mediana entre velocidad reportada e implícita

const METROS_POR_GRADO = 111_320;
function metrosEntre(aLat, aLng, bLat, bLng) {
  const kLng = Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  return Math.hypot((bLat - aLat) * METROS_POR_GRADO, (bLng - aLng) * METROS_POR_GRADO * kLng);
}

function desvioEstandar(xs) {
  if (xs.length < 2) return Infinity;
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}
function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function crearDetectorDeFarsa({
  ventana = VENTANA, enMarchaKmh = EN_MARCHA_KMH, variacionMinKmh = VARIACION_MIN_KMH,
  ruidoMinM = RUIDO_MIN_M, incoherenciaKmh = INCOHERENCIA_KMH,
} = {}) {
  const estados = new Map(); // vehicleId → { muestras: [{ t, lat, lng, speed, desvioM, implicita }], motivo }

  // Una posición nueva. `speed` es la que reporta el aparato (km/h);
  // `desvioM` la distancia al trazado que calculó la proyección (null si la
  // ruta no tiene trazado). Devuelve { sospechoso, motivo, cambio }, con
  // cambio en 'empezo' | 'termino' | null para anotar una vez por episodio.
  function posicion(vehicleId, { cuando, lat, lng, speed = 0, desvioM = null }) {
    let e = estados.get(vehicleId);
    if (!e) { e = { muestras: [], motivo: null }; estados.set(vehicleId, e); }
    const ultima = e.muestras[e.muestras.length - 1];
    let implicita = null;
    if (ultima && cuando > ultima.t) {
      const dtH = (cuando - ultima.t) / 3600_000;
      // Con menos de 2 s entre posiciones la velocidad implícita es ruido
      if (cuando - ultima.t >= 2000) implicita = metrosEntre(ultima.lat, ultima.lng, lat, lng) / 1000 / dtH;
    }
    e.muestras.push({ t: cuando, lat, lng, speed: Number(speed) || 0, desvioM, implicita });
    if (e.muestras.length > ventana) e.muestras.shift();

    const motivo = juzgar(e.muestras);
    const antes = e.motivo;
    e.motivo = motivo;
    const cambio = motivo && !antes ? 'empezo' : !motivo && antes ? 'termino' : null;
    return { sospechoso: !!motivo, motivo, cambio };
  }

  function juzgar(muestras) {
    if (muestras.length < ventana) return null;
    const conImplicita = muestras.filter(m => m.implicita !== null);
    if (conImplicita.length < ventana - 1) return null;
    const implicitas = conImplicita.map(m => m.implicita);
    // Sólo se juzga en marcha: parada, todo GPS parece constante y quieto
    if (implicitas.some(v => v < enMarchaKmh)) return null;

    // 3) La velocidad reportada no tiene nada que ver con la implícita
    const diffs = conImplicita.map(m => Math.abs(m.speed - m.implicita));
    if (mediana(diffs) > incoherenciaKmh) return 'velocidad_incoherente';
    // 1) Velocidad constante: la implícita Y la reportada. Un GPS de verdad,
    // aunque la combi vaya pareja por una avenida, mueve la implícita con su
    // propio error de posición (±15 m en 10 s son ±5 km/h) y la reportada con
    // el Doppler. Las dos clavadas a la vez es la firma del que dibuja.
    if (desvioEstandar(implicitas) < variacionMinKmh &&
        desvioEstandar(conImplicita.map(m => m.speed)) < variacionMinKmh) return 'velocidad_constante';
    // 2) Clavado sobre el trazado (sólo con trazado)
    const desvios = muestras.map(m => m.desvioM).filter(d => typeof d === 'number');
    if (desvios.length >= ventana && desvios.every(d => d <= ruidoMinM)) return 'sin_ruido';
    return null;
  }

  function olvidar(vehicleId) { estados.delete(vehicleId); }
  function estadoDe(vehicleId) { return { motivo: (estados.get(vehicleId) || {}).motivo || null }; }

  return { posicion, olvidar, estadoDe };
}

module.exports = { crearDetectorDeFarsa, VENTANA, EN_MARCHA_KMH, VARIACION_MIN_KMH, RUIDO_MIN_M, INCOHERENCIA_KMH };
