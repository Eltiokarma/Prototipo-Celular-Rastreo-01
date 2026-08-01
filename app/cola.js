// Cola de posiciones para cuando no hay datos.
//
// El GPS NO necesita internet: es recepción de satélites y funciona hasta en
// modo avión. Lo que se corta en una zona muerta es *mandar* la posición, no
// tenerla. Sin cola, esos minutos se pierden para siempre —hoy pasa: ver
// LIMITACIONES.md, "no hay cola de reenvío"— y con ellos se van las vueltas
// y la brecha promedio de ese tramo.
//
// Lo que la cola NO salva: la brecha en vivo. Si la combi de adelante estuvo
// dos minutos sin datos, durante esos dos minutos nadie supo dónde estaba, y
// eso no se recupera después. Por eso la cola no reemplaza al estado "sin
// señal": son cosas distintas.
//
// ── OJO, ESTO FALTA DEL LADO DEL SERVIDOR ───────────────────────────────
//
// Hoy el servidor NO acepta posiciones viejas: al recibir un `gps` le pone
// la hora de llegada y recalcula el progreso como si fuera de ahora. Vaciar
// esta cola contra el servidor tal como está haría que la unidad se
// teletransporte por el recorrido y arruinaría la vuelta en curso — peor que
// no mandar nada.
//
// Así que por ahora la cola se usa para UNA sola cosa: al reconectar se manda
// `ultima` —la posición más fresca— y el resto queda guardado. Aprovechar el
// atraso entero necesita un ingreso histórico en el servidor (aceptar el
// `timestamp` del cliente y ordenar por él antes de medir vueltas). Está
// escrito acá y no en un ticket porque es donde se va a leer.
//
// JavaScript puro para poder probarla sin teléfono.

'use strict';

// Un turno son ~8 h. A 10 s por posición con la pantalla apagada son 2880
// posiciones; el tope se pone bastante abajo de eso a propósito: si estuvo
// una hora sin señal, las posiciones más viejas ya no le importan a nadie y
// guardar todo solo hace más lenta la descarga cuando vuelve.
const TOPE = 600;   // ~100 min a 10 s, ~30 min a 3 s

function crearCola({ tope = TOPE } = {}) {
  let items = [];
  let descartadas = 0;

  return {
    // Se guarda el timestamp de CUÁNDO se tomó la posición, no de cuándo se
    // manda: si no, al reconectar el servidor recibiría diez posiciones con
    // la misma hora y el recorrido quedaría hecho un nudo.
    guardar(pos) {
      if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return false;
      items.push({ lat: pos.lat, lng: pos.lng, speed: pos.speed || 0, timestamp: pos.timestamp });
      while (items.length > tope) { items.shift(); descartadas++; }
      return true;
    },

    // Se entrega en orden y de a tandas, porque el servidor corta a 40
    // mensajes de GPS por minuto y descarta el resto EN SILENCIO. Vaciar de
    // golpe una cola de 300 posiciones al salir de un túnel haría que se
    // pierdan casi todas sin que nadie se entere.
    proximas(cuantas) {
      return items.slice(0, Math.max(0, cuantas));
    },

    // Se confirman recién cuando se mandaron: si la conexión se corta a la
    // mitad, lo no enviado sigue en la cola.
    confirmar(cuantas) {
      items = items.slice(Math.max(0, cuantas));
    },

    vaciar() { items = []; },
    get largo() { return items.length; },
    get descartadas() { return descartadas; },
    get primera() { return items[0] || null; },
    get ultima() { return items[items.length - 1] || null; },
  };
}

module.exports = { crearCola, TOPE };
