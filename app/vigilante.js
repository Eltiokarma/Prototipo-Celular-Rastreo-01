// ¿El servicio de GPS está corriendo pero MUDO?
//
// El vigilante de App.js le pregunta a Android si el servicio está corriendo
// (`hasStartedLocationUpdatesAsync`), y lo rearranca si no. Pero esa
// respuesta es la del REGISTRO de la tarea, y puede decir «sí» con el
// servicio muerto. Es lo más probable detrás de lo que se vio en las pruebas
// en teléfono (RESULTADOS-TELEFONO.md, H8 y H9): al quitar el permiso de
// notificaciones en ruta, Android mata la app; al volver, la app sigue «en
// ruta» y el chofer no aparece más en Despacho, ni devolviendo el permiso.
//
// El GPS pide una lectura cada 3 s con la pantalla prendida, y sin distancia
// mínima (`distanceInterval: 0`): con la combi parada también llegan. Así
// que un minuto entero sin ninguna, con la app adelante, no es una combi
// quieta: es un servicio que no está. Se para y se arranca de nuevo, como
// mucho una vez cada dos minutos (si lo que falta es el permiso de ubicación,
// rearrancar no lo arregla, y no tiene que convertirse en un bucle).
const MUDO_MS = 60_000;
const REARRANQUE_CADA_MS = 2 * 60_000;

// `desde`: cuándo empezó a mirarse esta salida (el GPS tarda unos segundos
// en dar la primera lectura). Todo en milisegundos de reloj.
function servicioMudo({ ahora, corriendo, primerPlano, ultimaLectura = 0, desde = 0, ultimoRearranque = 0 }) {
  if (!corriendo || !primerPlano) return false;
  if (ahora - ultimoRearranque < REARRANQUE_CADA_MS) return false;
  return ahora - Math.max(ultimaLectura, desde, ultimoRearranque) >= MUDO_MS;
}

// ¿Recargar el JavaScript? Es el último recurso, cuando rearrancar no
// alcanzó: visto con adb en la quinta ronda (logcat del 26/11), Android SÍ
// calcula las posiciones y expo-task-manager las recibe («Handling job»
// cada 2 s), pero ningún JavaScript las procesa (nunca «Finished task»).
// Al relanzarse la app, el TaskService de Expo arranca una copia «sin
// pantalla» del JavaScript; si la pantalla se anota mientras esa copia
// corre, queda en la tabla de las copias sin pantalla
// (`TaskService.setTaskManager`), y al terminar la copia Expo la borra junto
// con ella (`invalidateAppRecord`). La pantalla sólo se anota al crearse su
// JavaScript, así que desde ahí no recibe nada más. Recargar el JavaScript la
// vuelve a anotar. Como mucho una vez cada diez minutos, guardado en el
// teléfono porque la recarga borra la memoria: si recargar tampoco alcanza,
// no se entra en un bucle de recargas.
const RECARGA_CADA_MS = 10 * 60_000;
function tocaRecargar({ ahora, ultimaRecarga = 0 }) {
  return !(ultimaRecarga > 0 && ahora - ultimaRecarga < RECARGA_CADA_MS && ultimaRecarga <= ahora);
}

module.exports = { servicioMudo, tocaRecargar, MUDO_MS, REARRANQUE_CADA_MS, RECARGA_CADA_MS };
