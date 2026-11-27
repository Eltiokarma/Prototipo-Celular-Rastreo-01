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

// Lo que se vio con adb el 26/11 (logcat): Android SÍ calcula las
// posiciones y expo-task-manager las recibe («Handling job» cada 2 s), pero
// ningún JavaScript las procesa (nunca «Finished task»). Al relanzarse la app,
// el TaskService de Expo «carga» la app sin pantalla; en la arquitectura nueva
// ese JavaScript es el MISMO de la pantalla (un solo ReactHost), pero queda
// anotado como «sin pantalla» (`TaskService.setTaskManager`), y al terminar
// los eventos Expo lo borra (`invalidateAppRecord`). Rearrancar el GPS no lo
// cura, y recargar el JavaScript tampoco (cae en la misma tabla y además
// rompe el servicio de tareas: CAMBIOS 38). El arreglo es nativo: un parche
// a expo-task-manager (app/patches). La APK 0.3.2 ya lo traía en el disco y
// el teléfono siguió igual (logcat del 27/11): Expo 54 enlaza el módulo YA
// COMPILADO que viene en el paquete, no el código parchado. Desde la 0.3.3 se
// compila desde la fuente (`buildFromSource` en app/package.json; CAMBIOS 40)
// y deja «COOP-R14 parche activo» en el logcat.

module.exports = { servicioMudo, MUDO_MS, REARRANQUE_CADA_MS };
