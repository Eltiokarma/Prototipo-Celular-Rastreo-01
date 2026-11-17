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
import { avisoDesdeRespuesta, avisoSinSenal } from './hud.js';

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

// Dos cosas distintas que antes eran una (tercera revisión con ChatGPT,
// 17/11): el CANAL, que se crea una vez, y el PERMISO, que el chofer puede
// dar o quitar desde Ajustes con la app viva. Antes un `preparado = true`
// quedaba para siempre: revocado el permiso, la app no se enteraba; y antes
// todavía, un `sinPermiso = true` igual de pegado en el otro sentido. Ahora
// el permiso se vuelve a MIRAR (sin pedirlo) como mucho una vez por minuto
// y al volver a primer plano; al usuario se le PIDE una sola vez.
let canalCreado = false;
let permitido = false;   // lo que dijo el sistema la última vez que se miró
let miradoEn = 0;        // cuándo se miró
let preguntado = false;  // ya se le pidió al usuario: no se le vuelve a pedir
const REMIRAR_MS = 60_000;
let ultimo = null;       // el último título mostrado — igual no se re-emite

async function preparar() {
  if (miradoEn && Date.now() - miradoEn < REMIRAR_MS) return;
  miradoEn = Date.now();
  let permiso = await Notifications.getPermissionsAsync().catch(() => null);
  if (permiso && !permiso.granted && permiso.canAskAgain && !preguntado) {
    preguntado = true;
    permiso = await Notifications.requestPermissionsAsync().catch(() => null);
  }
  const antes = permitido;
  permitido = !!(permiso && permiso.granted);
  // Si cambió, lo último mostrado ya no vale: que la próxima se emita
  if (permitido !== antes) ultimo = null;
  if (!permitido || canalCreado) return;
  // Canal de importancia BAJA: la brecha cambia todo el tiempo y no puede
  // sonar ni vibrar — es información de reojo, no una alerta.
  await Notifications.setNotificationChannelAsync(CANAL, {
    name: 'Brecha en vivo',
    importance: Notifications.AndroidImportance.LOW,
    sound: null, vibrationPattern: null, enableVibrate: false,
  }).catch(() => {});
  canalCreado = true;
}

// Al volver a primer plano (por ejemplo, de Ajustes con el permiso recién
// dado o quitado): mirar ya, sin esperar el minuto.
export function remirarPermiso() { miradoEn = 0; }

// La tarea de fondo llama esto con `cuerpo.brecha` de cada POST que salió
// bien. Se re-emite solo cuando el TEXTO cambia: la misma brecha cada 10 s
// no le aporta nada a nadie y desgasta de más.
export async function notificarBrecha(brecha) {
  return mostrar(avisoDesdeRespuesta(brecha));
}

// Los envíos dejaron de salir: la misma notificación (mismo id, mismo canal
// bajo) pasa a decir «SIN SEÑAL · hace N min» en vez de la última brecha.
// El próximo envío que salga la vuelve a la brecha (auditoría de UI, N1).
export async function notificarSinSenal(ultimoEnvio, ahora = Date.now()) {
  return mostrar(avisoSinSenal(ultimoEnvio, ahora));
}

// ── La notificación de la brecha (ID), en FILA ─────────────────────
// Publicar y limpiar escriben el mismo identificador. Sin fila, una
// publicación que esperaba el permiso o el canal terminaba DESPUÉS de
// limpiarNotificacion() y la brecha volvía a la bandeja, con su título
// repuesto en `ultimo` (quinta revisión con ChatGPT, 17/11). Ahora van de a
// una, y lo pedido antes de una limpieza ya no publica cuando le toca.
let filaBrecha = Promise.resolve();
let limpiezas = 0;
function enFilaBrecha(fn) {
  const p = filaBrecha.then(fn, fn);
  filaBrecha = p.catch(() => {});
  return p;
}

function mostrar(aviso) {
  if (!aviso || aviso.titulo === ultimo) return Promise.resolve();
  const alPedir = limpiezas;
  return enFilaBrecha(() => mostrarAhora(aviso, alPedir));
}

async function mostrarAhora(aviso, alPedir) {
  if (limpiezas !== alPedir || aviso.titulo === ultimo) return;
  await preparar();
  if (!permitido || limpiezas !== alPedir) return;
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
  if (!permitido) return;
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
// El teléfono quedó RELEVADO: otro chofer tomó la unidad y este GPS ya no se
// usa. La pantalla lo dice («modo acompañante»), pero con la pantalla apagada
// la única superficie es esta notificación — y antes se la borraba y ya, así
// que la última brecha que el chofer había visto se quedaba en su memoria sin
// nada que la desmintiera, o peor, la notificación seguía ahí con un número
// que ya no es suyo (revisión del 10/9, C22).
//
// Va con el MISMO identificador que la brecha, así que la reemplaza en vez de
// sumar una segunda. Mismo canal de importancia baja: no suena ni salta.
export function notificarSinRol(motivo) {
  // Relevado, este GPS ya no tiene que mandar: el silencio no es una falla
  apagarVigiaDeSilencio().catch(() => {});
  const alPedir = limpiezas;
  return enFilaBrecha(() => notificarSinRolAhora(motivo, alPedir));
}

async function notificarSinRolAhora(motivo, alPedir) {
  if (limpiezas !== alPedir) return;
  await preparar();
  if (!permitido || limpiezas !== alPedir) return;
  const titulo = 'MODO ACOMPAÑANTE';
  if (titulo === ultimo) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: titulo,
        body: motivo || 'Otro chofer tomó la unidad: tu GPS ya no se usa.',
        sound: false,
      },
      trigger: { channelId: CANAL },
    });
    ultimo = titulo;
  } catch {}
}

// Borra la notificación SÓLO si la que está puesta es la del relevo. Lo
// llama la pantalla cuando el rol de GPS vuelve, y ese aviso (`gps_role`
// con `reporting: true`) llega en CADA identificación del socket, no sólo
// al terminar un relevo: borrar a ciegas se llevaba también la brecha en
// cada reconexión (segundo repaso, 22/9).
export async function limpiarSiSinRol() {
  if (ultimo !== 'MODO ACOMPAÑANTE') return;
  await limpiarNotificacion();
}

export async function limpiarNotificacion() {
  limpiezas++;
  await enFilaBrecha(async () => {
    ultimo = null;
    try { await Notifications.dismissNotificationAsync(ID); } catch {}
  });
  await apagarVigiaDeSilencio();
}

// ─── EL VIGÍA DEL SILENCIO (auditoría 11/11) ──────────────────────
// El GPS se apaga sin avisar: un reinicio del teléfono, «forzar detención»,
// una actualización de la app, la ubicación apagada desde la barra rápida.
// La notificación de la brecha desaparece y nada más: el chofer sigue
// manejando, la combi desaparece del mapa y, si pasan dos horas, la vuelta
// cuenta como entrada tardía. Nadie le avisó.
//
// Es un aviso a futuro que cada lectura del GPS CORRE: se programa para
// dentro de 10 minutos y, mientras el GPS lea, nunca llega (en una zona sin
// señal el GPS lee igual: no es falsa alarma). Si el servicio
// murió, nadie lo corre y suena. Es el sistema el que lo dispara, no esta
// app: funciona aunque el proceso no exista. Se reprograma a lo sumo una vez
// por minuto (cada envío sería un costo de batería) y se apaga al salir de
// ruta, al cerrar sesión y en el relevo.
const CANAL_SILENCIO = 'gps-detenido';
const ID_SILENCIO = 'gps-silencio';
export const SILENCIO_AVISO_MS = 10 * 60_000;
let silencioCorridoEn = 0;
// El vigía también va en FILA. La época de la cuarta revisión evitaba que
// el aviso viejo sobreviviera al apagado, pero su cancelación tardía usaba
// el identificador compartido y podía borrar el aviso de una vigilancia
// NUEVA programada en el medio (quinta revisión con ChatGPT, 17/11). En
// fila, apagar corre después de lo que ya estaba programándose, y lo que se
// pide después de apagar corre después de la cancelación.
let filaVigia = Promise.resolve();
let apagados = 0;
function enFilaVigia(fn) {
  const p = filaVigia.then(fn, fn);
  filaVigia = p.catch(() => {});
  return p;
}

export function vigilarSilencio(ahora = Date.now()) {
  if (ahora - silencioCorridoEn < 60_000) return Promise.resolve();
  const alPedir = apagados;
  return enFilaVigia(() => vigilarAhora(ahora, alPedir));
}

async function vigilarAhora(ahora, alPedir) {
  const vigente = () => apagados === alPedir && permitido;
  if (apagados !== alPedir || ahora - silencioCorridoEn < 60_000) return;
  await preparar();
  if (!vigente()) return;
  silencioCorridoEn = ahora;
  try {
    await Notifications.setNotificationChannelAsync(CANAL_SILENCIO, {
      name: 'GPS detenido',
      // Alta: es la única forma de enterarse, y pasa con la pantalla apagada
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
    if (!vigente()) return;
    await Notifications.cancelScheduledNotificationAsync(ID_SILENCIO).catch(() => {});
    if (!vigente()) return;
    const tipo = Notifications.SchedulableTriggerInputTypes
      ? Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL : 'timeInterval';
    await Notifications.scheduleNotificationAsync({
      identifier: ID_SILENCIO,
      content: {
        title: 'Tu GPS dejó de funcionar',
        body: 'Estás en ruta y hace 10 minutos que el GPS no lee tu ubicación: tu combi no está en el mapa. Abre la app.',
      },
      trigger: { type: tipo, seconds: Math.round(SILENCIO_AVISO_MS / 1000), channelId: CANAL_SILENCIO },
    });
  } catch {}
}

export function apagarVigiaDeSilencio() {
  apagados++;
  silencioCorridoEn = 0;
  return enFilaVigia(async () => {
    try { await Notifications.cancelScheduledNotificationAsync(ID_SILENCIO); } catch {}
    try { await Notifications.dismissNotificationAsync(ID_SILENCIO); } catch {}
  });
}
