// Actualizar sin reinstalar (PENDIENTES 0.11, 04/11).
//
// El JavaScript de la app (pantallas, chat, SOS, puerta…) se actualiza con
// EAS Update: la app pregunta si hay uno más nuevo PARA SU VERSIÓN NATIVA
// (`runtimeVersion` = la versión de app.json), lo baja sin molestar y lo
// aplica reiniciándose. Lo que es nativo —un permiso, un módulo, la versión de
// Expo— sigue necesitando una APK nueva.
//
// Lo delicado es CUÁNDO reiniciar. Reiniciar el JavaScript con el chofer en
// ruta le cortaría la conexión, la cola de posiciones y la pantalla en medio
// del turno. Así que la regla es estricta: sólo cuando no está trabajando —
// en la pantalla de entrada, o en la puerta sin que el vigía esté contando—,
// sin un SOS sin salir en pantalla, y en el momento en que la app VUELVE AL
// FRENTE (lo que ve es el arranque, no un salto en medio de algo que estaba
// haciendo). El cobrador nunca «sale a ruta» (siempre está «fuera»): para él
// también vale sólo al volver al frente.
//
// Esto es la lógica; quien la usa le pasa el estado y hace el reinicio. No se
// importa nada nativo: se prueba en Node (`pruebas/actualizacion.js`).

// Cada cuánto preguntar si hay una nueva al volver al frente, además de la
// pregunta que el módulo hace solo al arrancar. Media hora: el chofer abre y
// cierra la app muchas veces por día y cada pregunta es un pedido de red.
const PREGUNTAR_CADA_MS = 30 * 60_000;

function tocaPreguntar(ultimaVez, ahora) {
  return !ultimaVez || ahora - ultimaVez >= PREGUNTAR_CADA_MS;
}

// ¿Se puede reiniciar para aplicar la que ya bajó?
//   sesion        hay alguien adentro (null = pantalla de entrada)
//   presencia     'fuera' | 'ruta' | 'ausente'
//   vigiaContando el vigía de la puerta cree que está manejando
//   sosSinRed     hay un SOS que no salió en pantalla
//   alVolver      la app acaba de volver al frente
function sePuedeAplicar({ sesion, presencia, vigiaContando, sosSinRed, alVolver }) {
  if (sosSinRed) return false;
  if (!sesion) return true;                       // nadie trabajando
  if (presencia !== 'fuera') return false;        // en ruta o ausente: nunca
  if (vigiaContando) return false;                // puede estar manejando
  return !!alVolver;                              // y sólo al volver al frente
}

module.exports = { PREGUNTAR_CADA_MS, tocaPreguntar, sePuedeAplicar };
