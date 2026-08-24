// La notificación VIVA de la brecha (PENDIENTES 3.3).
//
// La notificación permanente del servicio de ubicación no se puede tocar en
// caliente: cambiarle el texto es reiniciar el servicio, y colgarla de la
// brecha lo reiniciaba cada 3 segundos y quemaba la batería — se midió.
// Esta es OTRA notificación, de expo-notifications, que sí se actualiza
// barato: misma identidad, contenido nuevo, cero sonido.
//
// El dato llega por el único canal que sobrevive a la pantalla apagada: la
// respuesta del POST /gps, que la tarea de fondo ya recibe cada 10 s. El
// texto lo arma `hud.js` (avisoDesdeRespuesta) — la misma lógica probada
// que dibuja la pantalla, así la notificación nunca dice otra cosa.
//
// Todo acá es mejor esfuerzo: sin permiso de notificaciones, o con
// cualquier error del sistema, el GPS sigue como si nada. La notificación
// es un lujo; la posición es el producto.

import * as Notifications from 'expo-notifications';
import { avisoDesdeRespuesta } from './hud.js';

const CANAL = 'brecha';
const ID = 'brecha-viva';

// Si la app está en primer plano cuando la tarea actualiza, no hay nada que
// anunciar: el chofer tiene el HUD gigante delante. La notificación queda en
// la bandeja, sin banner ni sonido.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false, shouldShowList: true,
    shouldPlaySound: false, shouldSetBadge: false,
  }),
});

let preparado = false;   // canal creado y permiso preguntado, UNA vez
let sinPermiso = false;  // dijo que no: no volver a preguntar cada 10 s
let ultimo = null;       // el último título mostrado — igual no se re-emite

async function preparar() {
  if (preparado || sinPermiso) return;
  // Canal de importancia BAJA: la brecha cambia todo el tiempo y no puede
  // sonar ni vibrar — es información de reojo, no una alerta.
  await Notifications.setNotificationChannelAsync(CANAL, {
    name: 'Brecha en vivo',
    importance: Notifications.AndroidImportance.LOW,
    sound: null, vibrationPattern: null, enableVibrate: false,
  }).catch(() => {});
  let permiso = await Notifications.getPermissionsAsync().catch(() => null);
  if (permiso && !permiso.granted && permiso.canAskAgain) {
    permiso = await Notifications.requestPermissionsAsync().catch(() => null);
  }
  if (!permiso || !permiso.granted) { sinPermiso = true; return; }
  preparado = true;
}

// La tarea de fondo llama esto con `cuerpo.brecha` de cada POST que salió
// bien. Se re-emite solo cuando el TEXTO cambia: la misma brecha cada 10 s
// no le aporta nada a nadie y desgasta de más.
export async function notificarBrecha(brecha) {
  const aviso = avisoDesdeRespuesta(brecha);
  if (!aviso || aviso.titulo === ultimo) return;
  await preparar();
  if (!preparado) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: aviso.titulo,
        body: aviso.detalle,
        sound: false,
      },
      // El canal va EN EL TRIGGER, no en content — ahí expo-notifications lo
      // ignora en silencio y la notificación sale por el canal por defecto,
      // que sí suena y salta: lo contrario de lo que este canal BAJO existe
      // para evitar. Con solo channelId es "ahora, por este canal", y con el
      // mismo identifier, REEMPLAZA.
      trigger: { channelId: CANAL },
    });
    ultimo = aviso.titulo;
  } catch {}
}

// Despacho pidió una grabación (4.5) y la app la arrancó sola: se le dice
// al chofer QUE pasó, no se le pide nada — la grabación ya corre y se
// termina desde Perfil cuando él quiera. Canal propio de importancia BAJA,
// como la brecha: información de reojo, nada que suene ni salte mientras
// maneja (el mismo criterio que el desvío).
const CANAL_GRABACION = 'grabacion';

export async function notificarGrabacionPedida() {
  await preparar();
  if (!preparado) return;
  try {
    await Notifications.setNotificationChannelAsync(CANAL_GRABACION, {
      name: 'Grabación de recorrido',
      importance: Notifications.AndroidImportance.LOW,
      sound: null, vibrationPattern: null, enableVibrate: false,
    }).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'grabacion-pedida',
      content: {
        title: 'Despacho pidió grabar este recorrido',
        body: 'La grabación ya arrancó sola. Se termina y envía desde Perfil.',
        sound: false,
      },
      trigger: { channelId: CANAL_GRABACION },
    });
  } catch {}
}

// Al salir de ruta o cerrar sesión, la brecha vieja no puede quedar colgada
// en la bandeja diciendo un número de hace una hora.
export async function limpiarNotificacion() {
  ultimo = null;
  try { await Notifications.dismissNotificationAsync(ID); } catch {}
}
