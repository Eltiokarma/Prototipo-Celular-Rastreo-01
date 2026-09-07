// El vigía del envío: qué hacer con un POST /gps que no vuelve.
//
// POR QUÉ EXISTE, Y POR QUÉ NO ES UN setTimeout
//
// `fetch` en React Native no tiene timeout. Un socket que la red dejó a
// medias —el NAT del operador que soltó la conexión, la radio que se durmió
// con la pantalla— queda esperando para siempre: no es éxito, no es fallo,
// y como sólo puede haber un envío en vuelo, TODO lo que llega después se
// apila detrás y no sale nada. Medido: 35 minutos sin un envío y ni un
// error a la vista.
//
// El primer arreglo fue un `setTimeout` de 15 s que abortaba el fetch. Y no
// alcanzó, porque **con la pantalla apagada los timers de JavaScript no
// corren**. Está en el código de React Native para Android
// (`JavaTimerManager`): al pausarse la actividad se quita el callback del
// Choreographer y los timers con duración mayor a cero quedan esperando un
// frame que no llega hasta que la pantalla vuelve. Sólo `setTimeout(fn, 0)`
// se llama en el acto — y por eso el fetch SÍ resuelve en segundo plano
// (whatwg-fetch resuelve con un setTimeout de 0), pero el corte de 15 s no.
// Se veía en el servidor: ráfagas de posiciones y silencios de minutos, y al
// prender la pantalla, el corte por fin disparaba, la tanda se re-encolaba y
// llegaba repetida («volvió tras 0 s sin señal»).
//
// Lo único que sigue latiendo con la pantalla apagada es la tarea del GPS,
// que dispara cada 10 s con posiciones nuevas. Entonces EL RELOJ ES ESA
// TAREA: cada vez que llega una tanda, se mira hace cuánto está en vuelo el
// envío anterior. Si pasó el corte, se lo aborta desde acá —`abort()` es
// sincrónico y no necesita ningún timer— y sus posiciones vuelven a la cola
// para salir con la tanda nueva. Un envío colgado cuesta como mucho dos
// disparos del GPS, y el resto del turno sigue.
//
// JavaScript puro, sin timers, con el reloj inyectado: se prueba en Node en
// `pruebas/envio.js`.

'use strict';

// Más que esto en vuelo es un envío colgado, no uno lento. Con la pantalla
// apagada la tarea dispara cada 10 s, así que el corte real cae entre los
// 15 y los 20 s.
const CORTE_MS = 15_000;

function crearVigiaDeEnvio({ corteMs = CORTE_MS, ahora = () => Date.now() } = {}) {
  let enVuelo = null;   // { posiciones, control, desde, cortado }

  return {
    // Arranca un envío. Lo que devuelve es el "vuelo": el que lo hizo lo
    // conserva para saber, al terminar, si todavía es suyo o ya lo cortaron.
    empezar(posiciones, control) {
      enVuelo = { posiciones, control, desde: ahora(), cortado: false };
      return enVuelo;
    },

    // Terminó, bien o mal. Sólo suelta si sigue siendo ESTE vuelo: uno que
    // ya fue cortado no puede pisar al que arrancó después.
    terminar(vuelo) {
      if (enVuelo === vuelo) enVuelo = null;
    },

    // Llega una tanda nueva. Decide qué hacer con la que está en vuelo:
    //
    //   { accion: 'libre' }             no hay nada en vuelo: mandá
    //   { accion: 'esperar' }           hay uno y es reciente: guardá y andate
    //   { accion: 'cortado', vuelo }    había uno colgado: se lo abortó, y
    //                                   sus posiciones van de vuelta a la cola
    revisar() {
      if (!enVuelo) return { accion: 'libre' };
      if (ahora() - enVuelo.desde < corteMs) return { accion: 'esperar' };
      const vuelo = enVuelo;
      vuelo.cortado = true;
      enVuelo = null;
      // El abort dispara el rechazo del fetch (por un setTimeout de 0, que
      // sí corre en fondo) y cancela la llamada nativa, que cierra el socket
      // muerto: el próximo envío abre una conexión nueva en vez de reusar
      // la que no contesta.
      try { vuelo.control?.abort(); } catch {}
      return { accion: 'cortado', vuelo };
    },

    get enVuelo() { return enVuelo; },
  };
}

module.exports = { crearVigiaDeEnvio, CORTE_MS };
