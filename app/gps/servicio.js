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
export const diagnostico = { enviadas: 0, fallidas: 0, ultimoEnvio: null, ultimoError: null };

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

async function subir(posiciones) {
  try {
    const [crudo, servidor] = await Promise.all([
      SecureStore.getItemAsync(LLAVE_SESION),
      SecureStore.getItemAsync(LLAVE_SERVIDOR),
    ]);
    if (!crudo || !servidor) { diagnostico.ultimoError = 'sin sesión guardada'; return; }
    const { token } = JSON.parse(crudo);
    if (!token) { diagnostico.ultimoError = 'sesión sin token'; return; }

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
      diagnostico.fallidas += posiciones.length;
      diagnostico.ultimoError = 'HTTP ' + r.status;
    }
  } catch (e) {
    // Sin datos. La posición de este lote se pierde; la próxima vuelve a
    // intentar. Guardar el atraso en disco es lo que falta para no perderlo.
    diagnostico.fallidas += posiciones.length;
    diagnostico.ultimoError = 'sin red';
  }
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

export async function arrancar({ textoNotificacion = 'Turno en curso' } = {}) {
  if (await TaskManager.isTaskRegisteredAsync(TAREA_GPS)) return;
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
}

// Cambiar la cadencia es volver a arrancar con otro intervalo: expo-location
// no expone un "cambiá el intervalo" sobre una tarea ya corriendo.
export async function cambiarCadencia(ms, textoNotificacion) {
  if (!(await TaskManager.isTaskRegisteredAsync(TAREA_GPS))) return;
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
  if (await TaskManager.isTaskRegisteredAsync(TAREA_GPS)) {
    await Location.stopLocationUpdatesAsync(TAREA_GPS);
  }
}
