// El vigía de la puerta: el chofer que entró, no tocó SALIR A RUTA y ya está
// manejando.
//
// SALIR A RUTA es lo que convierte una combi cualquiera en una que hay que
// seguir —desde ahí tiene mando, turno, brecha— y es un botón: se olvida.
// El que se olvida trabaja invisible: sin brecha, sin vueltas contadas, sin
// horas, y Despacho sin entender (opción C del 30/10; la A es la lista de
// Despacho, en el servidor).
//
// En la puerta la app NO manda la ubicación, y la política de privacidad lo
// promete: fuera del turno no se emite. Pero con la app abierta puede MIRARLA
// sin mandarla, como el vigía de AUSENTE (`ausencia.js`), y darse cuenta.
//
// «Está manejando» son dos cosas a la vez, y sostenidas (dos lecturas):
//   - LEJOS de donde estaba al entrar: más que RADIO_M, el mismo radio del
//     vigía de ausente. Sola no alcanza: el que camina del paradero a su casa
//     con la app abierta también se aleja.
//   - RODANDO a velocidad de combi, y SOSTENIDA: en las dos últimas ventanas
//     de VENTANA_MS, no entre dos lecturas. Un salto del GPS —el primer fix
//     de la mañana, que sale con el wifi a 400 m y se corrige solo— cae en
//     una sola ventana; manejar llena las dos. Una persona caminando hace
//     5 km/h. Y las lecturas de más de PRECISION_MAX_M de error, ni se miran.
//
// Lo que hace con eso: primero AVISA —fuerte, con cuenta regresiva— y si nadie
// contesta en AVISO_MS sale a ruta solo. «No estoy manejando» (va de pasajero,
// lo llevan al terminal) lo calla CALLADO_MS y vuelve a anclar donde está.
//
// Lógica pura, para probarla en Node. La web del chofer tiene una copia en
// `project/Prototipo.html` (no tiene build para importarla); la suite
// `vigia-puerta` corre los mismos casos contra las dos.

'use strict';

const RADIO_M = 300;
const MARCHA_KMH = 15;
const VENTANA_MS = 30_000;
const SEGUIDAS = 2;
const AVISO_MS = 60_000;
const CALLADO_MS = 30 * 60_000;
const PRECISION_MAX_M = 100;

const METROS_POR_GRADO = 111320;
function metrosEntre(aLat, aLng, bLat, bLng) {
  const kLng = Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  return Math.hypot((bLat - aLat) * METROS_POR_GRADO, (bLng - aLng) * METROS_POR_GRADO * kLng);
}

// El vigía de UNA estadía en la puerta. Se crea al llegar a la puerta y se
// tira al salir de ella (a ruta o ausente, o al cerrar sesión).
function crearVigiaPuerta({ radioM = RADIO_M, marchaKmh = MARCHA_KMH, ventanaMs = VENTANA_MS,
  avisoMs = AVISO_MS, calladoMs = CALLADO_MS } = {}) {
  let ancla = null;          // dónde estaba al entrar (o al decir «no estoy manejando»)
  let recientes = [];        // { lat, lng, ts } de las últimas ventanas
  let seguidas = 0;
  let avisoDesde = null;     // cuándo empezó la cuenta regresiva
  let calladoHasta = 0;

  const vencio = (ts) => avisoDesde !== null && ts - avisoDesde >= avisoMs;

  return {
    // Cada posición. Devuelve null, 'avisar' (empieza la cuenta) o 'salir'
    // (se acabó la cuenta y nadie contestó).
    posicion(lat, lng, ts = Date.now(), precisionM = null) {
      if (avisoDesde !== null) return vencio(ts) ? 'salir' : null;
      if (ts < calladoHasta) return null;
      if (precisionM != null && precisionM > PRECISION_MAX_M) return null;
      if (!ancla) ancla = { lat, lng };
      recientes.push({ lat, lng, ts });
      recientes = recientes.filter(p => ts - p.ts <= ventanaMs * 4);
      // Dos ventanas seguidas hacia atrás: la lectura más nueva con al menos
      // una ventana de antigüedad, y la más nueva con una ventana más que
      // ésa. Sin las dos, todavía no se sabe.
      const anterior = (t) => { let b = null; for (const p of recientes) if (t - p.ts >= ventanaMs) b = p; return b; };
      const b1 = anterior(ts);
      const b2 = b1 && anterior(b1.ts);
      if (!b2) return null;
      const kmh = (a, b) => metrosEntre(a.lat, a.lng, b.lat, b.lng) / ((b.ts - a.ts) / 1000) * 3.6;
      const rodando = kmh(b1, { lat, lng, ts }) >= marchaKmh && kmh(b2, b1) >= marchaKmh;
      const lejos = metrosEntre(ancla.lat, ancla.lng, lat, lng) > radioM;
      if (lejos && rodando) {
        seguidas++;
        if (seguidas >= SEGUIDAS) { avisoDesde = ts; return 'avisar'; }
      } else {
        seguidas = 0;
      }
      return null;
    },

    // El reloj solo: la cuenta corre aunque el GPS no mande nada nuevo.
    tic(ts = Date.now()) { return vencio(ts) ? 'salir' : null; },

    // Cuánto falta para salir solo, o null si no hay cuenta en marcha
    faltaMs(ts = Date.now()) {
      return avisoDesde === null ? null : Math.max(0, avisoMs - (ts - avisoDesde));
    },

    // «No estoy manejando»: se calla un rato y vuelve a anclar donde esté
    callar(ts = Date.now()) {
      avisoDesde = null; seguidas = 0; ancla = null; recientes = [];
      calladoHasta = ts + calladoMs;
    },
  };
}

module.exports = {
  crearVigiaPuerta, metrosEntre,
  RADIO_M, MARCHA_KMH, VENTANA_MS, SEGUIDAS, AVISO_MS, CALLADO_MS, PRECISION_MAX_M,
};
