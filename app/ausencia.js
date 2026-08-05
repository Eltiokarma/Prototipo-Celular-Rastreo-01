// El vigía de la ausencia: los dos olvidos humanos, resueltos solos.
//
// AUSENTE es un estado que se declara a mano — comer, un repuesto — y la
// experiencia dice que lo que se marca a mano se olvida a mano:
//
//   1. El chofer almuerza, arranca, y NO toca "volver a ruta". Trabaja
//      invisible: sin brecha, sin vueltas contadas, y Despacho sin entender.
//   2. El chofer termina el día, se va a su casa AUSENTE con la app abierta,
//      y la app emite la ubicación de su CASA toda la noche.
//
// Las dos se resuelven mirando lo único que no miente: el GPS y el reloj.
//   - VOLVER: se ancló dónde quedó parado al declararse ausente; si después
//     aparece LEJOS de esa ancla (dos posiciones seguidas, para que un salto
//     de GPS no lo haga solo), es que está manejando de nuevo.
//   - FUERA: si la ausencia dura más que el tope, ya no es un almuerzo.
//
// Es lógica pura a propósito: vive en la tarea de fondo (pantalla apagada
// incluida) y se prueba en Node sin ningún teléfono.
//
// Lo que esto NO hace, a conciencia: marcar AUSENTE solo. Un embotellamiento
// o la cola del terminal parecen "parado mucho tiempo", y sacar de la cadena
// a una combi trabada es esconderle a Despacho justo lo que tiene que ver.

'use strict';

// Más lejos que esto del lugar donde se quedó = está manejando de nuevo.
// Un restaurante, una llantería o un descanso caben en 300 m; una vuelta al
// recorrido, no. El zigzag del GPS parado (~10-30 m en Juliaca) ni se acerca.
const RADIO_VOLVER_M = 300;

// Más que esto de ausencia ya no es un almuerzo: es que se fue. Dos horas
// cubren la comida más larga y el repuesto más difícil.
const TOPE_AUSENTE_MS = 2 * 60 * 60 * 1000;

// Cuántas posiciones seguidas fuera del radio hacen falta. Con una sola, un
// salto de GPS (rebote de edificio, cambio de antena) devolvería a ruta a
// alguien sentado comiendo.
const SEGUIDAS = 2;

const METROS_POR_GRADO = 111320;

function metrosEntre(aLat, aLng, bLat, bLng) {
  const kLng = Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  return Math.hypot((bLat - aLat) * METROS_POR_GRADO, (bLng - aLng) * METROS_POR_GRADO * kLng);
}

// El vigía de UNA ausencia. Se crea al declararse ausente y se tira al
// salir del estado — cada ausencia ancla de nuevo.
function crearVigia({ radioM = RADIO_VOLVER_M, topeMs = TOPE_AUSENTE_MS } = {}) {
  let ancla = null;        // { lat, lng } — dónde quedó parado
  let desde = null;        // cuándo se declaró ausente
  let lejosSeguidas = 0;

  return {
    // Cada posición que llega estando ausente. Devuelve qué hacer:
    // null (nada), 'volver' (está manejando de nuevo) o 'fuera' (ya no es
    // un almuerzo). El tope se mira primero: pasadas las horas, da igual
    // si se movió.
    posicion(lat, lng, ts = Date.now()) {
      if (desde === null) desde = ts;
      // La PRIMERA posición de la ausencia es el ancla: dónde quedó parado.
      // Se ancla acá y no al declarar, porque se declara a veces todavía
      // rodando hacia el sitio.
      if (!ancla) { ancla = { lat, lng }; return null; }

      if (ts - desde > topeMs) return 'fuera';

      if (metrosEntre(ancla.lat, ancla.lng, lat, lng) > radioM) {
        lejosSeguidas++;
        if (lejosSeguidas >= SEGUIDAS) return 'volver';
      } else {
        lejosSeguidas = 0;   // volvió cerca: era un salto de GPS
      }
      return null;
    },

    // Para la pantalla y el diagnóstico
    haceCuanto(ts = Date.now()) { return desde === null ? 0 : ts - desde; },
  };
}

module.exports = { crearVigia, RADIO_VOLVER_M, TOPE_AUSENTE_MS, SEGUIDAS, metrosEntre };
