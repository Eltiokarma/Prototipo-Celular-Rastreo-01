// El GPS en segundo plano. Es la razón de existir de la app nativa.
//
// LO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTE ARCHIVO
//
// Android no deja que una app tome la ubicación en segundo plano sin un
// "foreground service", y un foreground service está OBLIGADO a mostrar una
// notificación permanente. No es un costo: esa notificación va a existir sí
// o sí, así que le ponemos la brecha en vivo y el chofer la lee sin
// desbloquear el teléfono.
//
// La cadencia cambia con la pantalla. Con la pantalla encendida el chofer
// mira el HUD y quiere el número fresco: 3 s. Con la pantalla apagada eso ya
// no le sirve a él, solo a la brecha de los demás, y ahí 10 s alcanzan —a
// 30 km/h son ~83 m entre reportes, unos 10 segundos de recorrido, un 8 %
// contra un objetivo de 2 minutos— y el consumo de GPS baja a un tercio.
//
// Ojo con los teléfonos de gama baja: Xiaomi, Huawei y Oppo matan servicios
// en segundo plano aunque tengan foreground service, salvo que el usuario
// habilite "inicio automático" y saque la app de la optimización de batería
// a mano. Eso no se arregla desde acá: es parte de instalar la app en cada
// celular.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';

export const TAREA_GPS = 'coop-r14-gps';

// Dónde quedan guardados el token y el servidor. Tienen que estar en disco y
// no en memoria: cuando Android revive la tarea, el proceso arranca de cero.
export const LLAVE_SESION = 'sesion';
export const LLAVE_SERVIDOR = 'servidor';

export const CADENCIA_PANTALLA_ENCENDIDA = 3000;
export const CADENCIA_PANTALLA_APAGADA = 10000;

// Aviso a la pantalla, SOLO para dibujar. Puede no haber nadie escuchando y
// no pasa nada: lo que importa —mandar la posición— no depende de esto.
let alRecibir = null;
export function cuandoLlegueUnaPosicion(fn) { alRecibir = fn; }

// Cuántas se mandaron y cuándo, para poder mirarlo en pantalla. Sin esto,
// "no aparece en el mapa" no distingue entre el GPS que no dispara, el envío
// que falla y el servidor que rechaza.
//
// Los fallos se cuentan POR MOTIVO y no solo el último: la primera versión
// guardaba `ultimoError` y lo limpiaba al primer envío bueno, así que con
// fallos intermitentes —que es el caso interesante— la causa se perdía justo
// cuando había que verla.
export const diagnostico = {
  enviadas: 0, fallidas: 0, ultimoEnvio: null, ultimoError: null,
  enEspera: 0, motivos: {},
  // Si el servicio de ubicación está CORRIENDO de verdad. Sin esto, "0
  // enviadas y 0 fallidas" es indistinguible de "todavía no llegó ninguna
  // posición", y esa ambigüedad ya costó una sesión entera de diagnóstico.
  servicio: 'sin arrancar',
};

// Lo que no se pudo mandar. Vive en el módulo del SERVICIO y no en la
// pantalla: la pantalla se desmonta cuando Android manda la app atrás, que es
// exactamente cuando fallan los envíos. Acá sobrevive mientras el proceso
// siga vivo — y sigue vivo, porque el foreground service lo mantiene.
//
// Esto sale de una medición: con la app atrás, el `fetch` falla (Doze le
// corta la red a las apps de fondo) y se perdían ~26 posiciones por cada
// fallo. El GPS las tenía, el servidor las habría aceptado, y se tiraban en
// el medio. Ahora esperan y se van con el próximo envío que sí salga, con su
// hora original — el servidor acepta el atraso desde que existe `POST /gps`.
const TOPE_PENDIENTES = 500;
// El servidor rechaza con 413 cualquier envío de más de 200 posiciones. Sin
// cortar en tandas, una cola de más de 200 daba 413 —y como un 4xx no se
// reintenta, se perdía entera— y además la cola no podía vaciarse NUNCA más:
// cada intento mandaba de nuevo demasiadas. Se deja margen sobre el tope.
const MAX_POR_ENVIO = 150;
let pendientes = [];

function anotarFallo(motivo, cuantas) {
  diagnostico.fallidas += cuantas;
  diagnostico.ultimoError = motivo;
  diagnostico.motivos[motivo] = (diagnostico.motivos[motivo] || 0) + 1;
}

// LA TAREA MANDA SOLA, y esto es lo único que hace que la app sirva.
//
// La versión anterior le pasaba la posición a un callback de React y ESE
// hacía el POST. Se probó en un teléfono real y no funcionaba: cuando Android
// manda la app atrás suspende el contexto JavaScript, la pantalla se
// desmonta, y el callback deja de existir. La tarea seguía disparando —el
// servicio nativo sigue vivo, la notificación sigue en la barra— pero
// `alRecibir?.()` no encontraba a nadie y se tragaba la posición en silencio.
//
// Por eso el envío vive acá, en el mismo módulo donde está `defineTask`: es
// código que Android vuelve a cargar cuando revive la tarea, aunque no haya
// ni una pantalla montada. Y el token se lee del disco, no de una variable,
// porque la memoria del proceso anterior ya no está.
TaskManager.defineTask(TAREA_GPS, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const posiciones = data.locations.map(l => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    // El GPS da m/s y el resto del sistema habla km/h. Puede venir null
    // cuando el aparato está quieto: eso es 0, no "no sé".
    speed: Math.max(0, Math.round((l.coords.speed || 0) * 3.6)),
    timestamp: l.timestamp,
  }));

  for (const p of posiciones) alRecibir?.(p);   // solo para la pantalla
  await subir(posiciones);
});

// Cuántas están esperando, para verlo en pantalla
export function enEspera() { return pendientes.length; }

async function subir(nuevas) {
  // Lo atrasado va primero y ordenado: el servidor mide las vueltas con la
  // hora de cada posición, así que el orden importa. Se manda como mucho una
  // tanda; lo que sobra espera al próximo envío y así la cola se drena de a
  // poco en vez de rebotar contra el límite.
  const todas = [...pendientes, ...nuevas].sort((a, b) => a.timestamp - b.timestamp);
  const posiciones = todas.slice(0, MAX_POR_ENVIO);
  pendientes = todas.slice(MAX_POR_ENVIO);
  diagnostico.enEspera = pendientes.length;
  if (!posiciones.length) return;
  try {
    const [crudo, servidor] = await Promise.all([
      SecureStore.getItemAsync(LLAVE_SESION),
      SecureStore.getItemAsync(LLAVE_SERVIDOR),
    ]);
    if (!crudo || !servidor) { guardar(posiciones); anotarFallo('sin sesión guardada', posiciones.length); return; }
    const { token } = JSON.parse(crudo);
    if (!token) { guardar(posiciones); anotarFallo('sesión sin token', posiciones.length); return; }

    const r = await fetch(servidor + '/gps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ posiciones }),
    });
    if (r.ok) {
      diagnostico.enviadas += posiciones.length;
      diagnostico.ultimoEnvio = Date.now();
      diagnostico.ultimoError = null;
    } else {
      // El cuerpo del error dice bastante más que el número: 403 del cobrador,
      // 409 del relevo y 400 del reloj mal puesto se ven igual desde afuera.
      const cuerpo = await r.json().catch(() => ({}));
      // Un 4xx que no sea de red es culpa del contenido o del permiso: no se
      // reintenta, porque reintentarlo daría el mismo error para siempre y
      // taparía las posiciones nuevas detrás de un atraso que nunca se vacía.
      if (r.status >= 500) guardar(posiciones);
      anotarFallo(`HTTP ${r.status}${cuerpo.error ? ' ' + cuerpo.error : ''}`, posiciones.length);
    }
  } catch (e) {
    // Sin datos: en segundo plano es lo normal, Doze le corta la red a la app.
    // NO se pierden — esperan al próximo envío que salga.
    guardar(posiciones);
    anotarFallo('sin red', posiciones.length);
  }
}

// Se tiran las MÁS VIEJAS si el corte fue largo: si estuvo una hora sin red,
// las de hace una hora ya no le sirven a nadie y solo hacen más pesada la
// descarga cuando vuelva.
function guardar(posiciones) {
  pendientes = [...pendientes, ...posiciones].slice(-TOPE_PENDIENTES);
  diagnostico.enEspera = pendientes.length;
}

// Se piden por separado y en este orden porque Android lo exige: primero la
// de primer plano, y recién después se puede pedir la de segundo plano. Al
// revés, la segunda se rechaza sola sin mostrarle nada al usuario.
export async function pedirPermisos() {
  const frente = await Location.requestForegroundPermissionsAsync();
  if (frente.status !== 'granted') return { ok: false, cual: 'primer plano' };
  const fondo = await Location.requestBackgroundPermissionsAsync();
  if (fondo.status !== 'granted') return { ok: false, cual: 'segundo plano' };
  return { ok: true };
}

// OJO CON LA PREGUNTA QUE SE HACE ACÁ. Son dos cosas distintas:
//
//   isTaskRegisteredAsync        ¿existe el REGISTRO de la tarea?
//   hasStartedLocationUpdatesAsync  ¿el servicio está CORRIENDO?
//
// El registro lo guarda Android y **sobrevive a que el servicio muera**: a
// una reinstalación del APK, a que el fabricante mate la app, a un reinicio.
// La versión anterior preguntaba por el registro, así que en cuanto quedaba
// un registro viejo sin servicio detrás, `arrancar` volvía enseguida sin
// arrancar nada. La app se veía perfecta —entraba, chateaba, mandaba fotos y
// SOS— y el GPS, que es el punto de todo esto, no existía: `enviadas 0 ·
// fallidas 0`, ni un error.
//
// Y el caso que lo dispara es el más común de todos: **instalar una versión
// nueva**. O sea que le iba a pasar a cada chofer en cada actualización.
export async function arrancar({ textoNotificacion = 'Turno en curso' } = {}) {
  if (await Location.hasStartedLocationUpdatesAsync(TAREA_GPS)) {
    diagnostico.servicio = 'corriendo';
    return;
  }
  // Un registro huérfano —sin servicio detrás— se limpia antes de arrancar.
  // `startLocationUpdatesAsync` lo pisaría igual, pero dejarlo dando vueltas
  // es lo que hizo que este bug fuera invisible.
  if (await TaskManager.isTaskRegisteredAsync(TAREA_GPS)) {
    diagnostico.servicio = 'registro huérfano, rearrancando';
    try { await TaskManager.unregisterTaskAsync(TAREA_GPS); } catch {}
  }
  await Location.startLocationUpdatesAsync(TAREA_GPS, {
    accuracy: Location.Accuracy.High,
    timeInterval: CADENCIA_PANTALLA_ENCENDIDA,
    distanceInterval: 0,
    // Sin esto, Android junta varias posiciones y las entrega de a lotes
    // cuando le conviene: para una brecha en minutos eso es inservible.
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Control de ruta',
      notificationBody: textoNotificacion,
      notificationColor: '#2580CF',
      killServiceOnDestroy: false,
    },
  });
  diagnostico.servicio = 'corriendo';
}

// Cambiar la cadencia es volver a arrancar con otro intervalo: expo-location
// no expone un "cambiá el intervalo" sobre una tarea ya corriendo.
//
// Misma pregunta que en `arrancar`, y por el mismo motivo: con el registro
// como condición, esto reiniciaba una tarea que no estaba corriendo.
export async function cambiarCadencia(ms, textoNotificacion) {
  if (!(await Location.hasStartedLocationUpdatesAsync(TAREA_GPS))) return;
  await Location.startLocationUpdatesAsync(TAREA_GPS, {
    accuracy: Location.Accuracy.High,
    timeInterval: ms,
    distanceInterval: 0,
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Control de ruta',
      notificationBody: textoNotificacion || 'Turno en curso',
      notificationColor: '#2580CF',
      killServiceOnDestroy: false,
    },
  });
}

export async function parar() {
  if (await Location.hasStartedLocationUpdatesAsync(TAREA_GPS)) {
    await Location.stopLocationUpdatesAsync(TAREA_GPS);
  } else if (await TaskManager.isTaskRegisteredAsync(TAREA_GPS)) {
    // Registro sin servicio: si no se limpia, queda ahí para confundir a la
    // próxima sesión. Es la basura que causó el bug de arriba.
    try { await TaskManager.unregisterTaskAsync(TAREA_GPS); } catch {}
  }
  diagnostico.servicio = 'detenido';
}

// Para mirarlo desde la pantalla sin adivinar. Se pregunta al sistema, no a
// una variable nuestra: la variable puede estar al día y el servicio muerto.
export async function estaCorriendo() {
  try { return await Location.hasStartedLocationUpdatesAsync(TAREA_GPS); }
  catch { return false; }
}
