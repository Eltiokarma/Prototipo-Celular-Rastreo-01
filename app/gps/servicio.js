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
import * as FileSystem from 'expo-file-system/legacy';
import { crearVigia } from '../ausencia.js';
import { crearVigiaDeEnvio } from '../envio.js';
import { notificarBrecha, notificarGrabacionPedida, limpiarNotificacion } from '../notificacion.js';
import { crearGrabador } from '../grabador.js';

export const TAREA_GPS = 'coop-r14-gps';

// Dónde quedan guardados el token y el servidor. Tienen que estar en disco y
// no en memoria: cuando Android revive la tarea, el proceso arranca de cero.
export const LLAVE_SESION = 'sesion';
export const LLAVE_SERVIDOR = 'servidor';
// La presencia declarada ('ruta' | 'ausente') viaja pegada a cada POST de
// posiciones: con la pantalla apagada no hay WebSocket, y así el estado
// sobrevive hasta a un reinicio del servidor.
export const LLAVE_PRESENCIA = 'presencia';

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
// El vigía de la ausencia (app/ausencia.js): vive ACÁ y no en React,
// porque los dos olvidos que resuelve pasan con la pantalla apagada.
// La pantalla se entera por `diagnostico.presenciaAuto` (la vigilancia de
// App.js lo lee cada 2 s) y ajusta lo suyo.
let vigia = null;

export const diagnostico = {
  enviadas: 0, fallidas: 0, ultimoEnvio: null, ultimoError: null,
  enEspera: 0, motivos: {},
  // Desde cuándo hay un envío en vuelo, o null. Es lo que distingue "no
  // hay nada que mandar" de "hay uno colgado y todo se apila detrás".
  enVueloDesde: null,
  // Si el servicio de ubicación está CORRIENDO de verdad. Sin esto, "0
  // enviadas y 0 fallidas" es indistinguible de "todavía no llegó ninguna
  // posición", y esa ambigüedad ya costó una sesión entera de diagnóstico.
  servicio: 'sin arrancar',
  // La grabación de recorrido en curso ({puntos, largoM}) o null
  grabacion: null,
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
// Si la tarea dispara tantas veces seguidas sin encontrar sesión en el disco,
// es que NO HAY sesión — el chofer salió— y un servicio de ubicación corriendo
// para nadie es exactamente lo que no puede existir: quema batería, llena la
// cola de posiciones que jamás van a salir e infla los contadores. Pasó de
// verdad: quedó un servicio huérfano reportando "sin sesión guardada" ×38.
// Con la cadencia de pantalla apagada (10 s) esto corta en ~2 minutos.
const SIN_SESION_TOPE = 12;
let sinSesionSeguidas = 0;
// El servidor rechaza con 413 cualquier envío de más de 200 posiciones. Sin
// cortar en tandas, una cola de más de 200 daba 413 —y como un 4xx no se
// reintenta, se perdía entera— y además la cola no podía vaciarse NUNCA más:
// cada intento mandaba de nuevo demasiadas. Se deja margen sobre el tope.
const MAX_POR_ENVIO = 150;
let pendientes = [];

// Cada posición cuenta como fallida UNA sola vez, aunque se reintente veinte.
//
// Antes `fallidas` sumaba el tamaño del lote en cada intento, y como los
// lotes re-encolados se reintentan enteros, las mismas ~150 posiciones
// contadas veinte veces daban "fallidas 3901" al lado de "enviadas 568": un
// número de catástrofe para lo que era una cola esperando red. Un diagnóstico
// que asusta de más es casi tan malo como uno que calla.
//
// El WeakSet funciona porque la cola conserva LOS MISMOS objetos al
// re-encolar, y se limpia solo cuando las posiciones se van.
const yaContadas = new WeakSet();

function anotarFallo(motivo, posiciones) {
  let nuevas = 0;
  for (const p of posiciones) {
    if (!yaContadas.has(p)) { yaContadas.add(p); nuevas++; }
  }
  diagnostico.fallidas += nuevas;
  diagnostico.ultimoError = motivo;
  // Los motivos sí cuentan cada intento: "sin red ×24" dice cuántas veces se
  // chocó contra el problema, que es lo que sirve para dimensionarlo.
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
  // El grabador de recorridos come de las MISMAS posiciones que se mandan:
  // mejor esfuerzo, jamás puede frenar el envío — la posición es el producto.
  try { await grabar(posiciones); } catch {}
  await subir(posiciones);
});

// ─── EL GRABADOR DE RECORRIDOS (PENDIENTES 3.4) ──────────────
// La lógica (un punto cada 30 m) vive en `app/grabador.js`, puro y con
// suite. Acá va lo que necesita el teléfono: que la grabación sobreviva a
// que Android mate el proceso. El flag vive en disco (la tarea revive sin
// memoria) y los puntos se escriben a un archivo con cada punto nuevo —
// a 30 m por punto es una escritura cada pocos segundos, no cada 3 s.
export const LLAVE_GRABANDO = 'grabando';
const ARCHIVO_GRABACION = () => FileSystem.documentDirectory + 'grabacion.json';
let grabador = null;
let grabadoEnDisco = 0;   // hasta qué punto está persistido (ver abajo)
// Si la grabación en curso la pidió Despacho (4.5), para que la pantalla lo
// diga. Solo memoria: si Android mata el proceso, la grabación sigue (flag y
// archivo están en disco) y únicamente se pierde este rótulo.
let grabacionPedida = false;

async function grabar(posiciones) {
  const flag = await SecureStore.getItemAsync(LLAVE_GRABANDO).catch(() => null);
  if (flag !== '1') { grabador = null; return; }
  if (!grabador) {
    // El proceso es nuevo (o recién se empezó): retomar lo que haya en disco
    let previos = [];
    try { previos = JSON.parse(await FileSystem.readAsStringAsync(ARCHIVO_GRABACION())) || []; }
    catch {}
    grabador = crearGrabador(previos);
    grabadoEnDisco = grabador.cantidad;   // lo retomado YA está en disco
  }
  let huboNuevos = false;
  for (const p of posiciones) {
    if (grabador.posicion(p.lat, p.lng)) huboNuevos = true;
  }
  diagnostico.grabacion = { puntos: grabador.cantidad, largoM: grabador.largoM,
    ...(grabacionPedida ? { pedida: true } : {}) };
  // Se persiste cada 10 puntos y no en cada uno: el archivo se reescribe
  // ENTERO en cada guardado, y punto a punto la escritura acumulada crece
  // al cuadrado del recorrido — flash quemado en el teléfono que además
  // corre el GPS todo el día. Lo que se arriesga si Android mata el proceso
  // son ~10 puntos: 300 metros de una vuelta de kilómetros. (Al TERMINAR no
  // hace falta escribir: los puntos completos salen de la memoria viva.)
  if (huboNuevos && grabador.cantidad - grabadoEnDisco >= 10) {
    await FileSystem.writeAsStringAsync(ARCHIVO_GRABACION(), JSON.stringify(grabador.puntos));
    grabadoEnDisco = grabador.cantidad;
  }
}

// Lo que usa la pantalla del perfil. Todo pasa por el disco porque la
// pantalla y la tarea pueden estar en procesos distintos.
export async function empezarGrabacion() {
  grabador = crearGrabador();
  grabadoEnDisco = 0;
  grabacionPedida = false;
  try { await FileSystem.deleteAsync(ARCHIVO_GRABACION(), { idempotent: true }); } catch {}
  await SecureStore.setItemAsync(LLAVE_GRABANDO, '1');
  diagnostico.grabacion = { puntos: 0, largoM: 0 };
}

// Despacho pidió una grabación (4.5): el flag `grabar` llegó en la respuesta
// del POST /gps. Arranca sola y se le avisa al chofer por notificación — no
// tiene que hacer nada, y mientras maneja no se lo interrumpe (el mismo
// criterio que el desvío). Terminar y enviar sigue siendo suyo, en Perfil.
//
// Dos casos en los que NO se arranca, y el pedido queda esperando en el
// servidor: ya hay una grabación corriendo (el próximo POST manda
// `grabando: true` y el pedido se da por levantado con la que está), y hay
// una grabación PARADA sin enviar — empezar borra su archivo, y una vuelta
// manejada no se pisa por un pedido; cuando el chofer la envíe o descarte,
// el próximo POST arranca la pedida.
//
// El flag se lee ACÁ, no se recibe: el que leyó `subirAhora` puede tener
// hasta 15 s (el corte del fetch), y en ese hueco el chofer pudo apretar
// GRABAR RECORRIDO en Perfil — con el valor viejo, su grabación recién
// empezada se pisaba y encima quedaba rotulada como pedida por Despacho.
async function atenderPedidoGrabacion() {
  const flagGrabando = await SecureStore.getItemAsync(LLAVE_GRABANDO).catch(() => null);
  if (flagGrabando === '1') return;
  const info = await FileSystem.getInfoAsync(ARCHIVO_GRABACION()).catch(() => null);
  if (info?.exists) return;
  await empezarGrabacion();
  grabacionPedida = true;
  diagnostico.grabacion = { puntos: 0, largoM: 0, pedida: true };
  notificarGrabacionPedida().catch(() => {});
}

// Para de grabar y devuelve los puntos — pero NO borra el archivo: una
// vuelta grabada es una hora de manejo, y perderla por un corte de señal
// en el momento de mandarla sería carísimo. El archivo se va recién con
// `descartarGrabacion()`, cuando el envío salió bien (o el chofer descarta).
export async function pararGrabacion() {
  let puntos = grabador ? grabador.puntos : [];
  // Los puntos van a disco ANTES de soltar el grabador. Sin esto, una
  // grabación corta (menos de 10 puntos: el guardado periódico nunca
  // escribió) que falla al enviarse quedaba sólo en la memoria del
  // grabador que se acaba de soltar — el reintento leía un archivo que no
  // existía, encontraba cero puntos y la descartaba, mientras la pantalla
  // decía "quedó guardada". Ahora "quedó guardada" es literal.
  if (puntos.length) {
    try { await FileSystem.writeAsStringAsync(ARCHIVO_GRABACION(), JSON.stringify(puntos)); } catch {}
  }
  grabador = null;
  try { await SecureStore.deleteItemAsync(LLAVE_GRABANDO); } catch {}
  if (!puntos.length) {
    try { puntos = JSON.parse(await FileSystem.readAsStringAsync(ARCHIVO_GRABACION())) || []; }
    catch {}
  }
  if (diagnostico.grabacion) diagnostico.grabacion = { ...diagnostico.grabacion, parada: true };
  return puntos;
}

export async function descartarGrabacion() {
  grabador = null;
  grabacionPedida = false;
  diagnostico.grabacion = null;
  try { await SecureStore.deleteItemAsync(LLAVE_GRABANDO); } catch {}
  try { await FileSystem.deleteAsync(ARCHIVO_GRABACION(), { idempotent: true }); } catch {}
}

// Cuántas están esperando, para verlo en pantalla
export function enEspera() { return pendientes.length; }

// `fetch` en React Native NO tiene timeout: un socket que la red dejó a
// medias puede quedar esperando PARA SIEMPRE. Y ese silencio era invisible
// de las dos puntas: el envío colgado no cuenta como fallo —no hay error, no
// hay nada—, sus posiciones no vuelven a la cola (solo vuelven en el catch),
// y todo lo que llega después se apila detrás. Medido en un teléfono real:
// "enviadas 300 · fallidas 0 · 523 esperando · último hace 2123 s" — 35
// minutos sin un solo envío y ni un error a la vista.
//
// El corte tiene DOS relojes, y el segundo es el que importa:
//
//   1. Un `setTimeout` de 15 s. Sirve con la pantalla encendida, y NADA
//      MÁS: con la pantalla apagada React Native no corre los timers de
//      JavaScript (se quita el callback del Choreographer al pausarse la
//      actividad — está en `JavaTimerManager`), así que este corte se
//      quedaba esperando junto con el fetch que tenía que cortar. Fue la
//      primera versión, y en el servidor se veía como ráfagas de posiciones
//      y silencios de minutos, aunque el teléfono tuviera la batería sin
//      restricción.
//   2. La propia tarea del GPS, que sí dispara con la pantalla apagada. En
//      cada disparo el vigía (`app/envio.js`) mira hace cuánto está en
//      vuelo el envío anterior y, si pasó el corte, lo aborta desde acá:
//      `abort()` es sincrónico y no necesita ningún timer. Sus posiciones
//      vuelven a la cola y salen con la tanda nueva.
//
// El corte convierte el cuelgue en un error común y corriente: se re-encola
// y se cuenta, con un motivo distinto según qué reloj lo cortó.
const FETCH_CORTE_MS = 15_000;
function fetchConCorte(url, opciones, control = new AbortController()) {
  const corte = setTimeout(() => control.abort(), FETCH_CORTE_MS);
  return fetch(url, { ...opciones, signal: control.signal })
    .finally(() => clearTimeout(corte));
}

// Un solo envío en vuelo. La tarea dispara de nuevo mientras el anterior
// espera la red —con la pantalla apagada Android entrega las posiciones en
// lotes cuando le conviene, y justo ahí la red está peor—, y dos `subir` a
// la vez leen y escriben `pendientes` sin ningún orden: posiciones contadas
// dos veces o perdidas, y colas por encima de su propio tope (los 523 sobre
// un tope de 500 del mismo teléfono). El que llega mientras otro está
// enviando deja lo suyo en la cola y se va; el próximo envío se lo lleva.
//
// Salvo que el anterior esté COLGADO: entonces se lo corta y se manda igual.
// Sin esto, un solo fetch que no vuelve tapaba el resto del turno.
const vigiaEnvio = crearVigiaDeEnvio({ corteMs: FETCH_CORTE_MS });

async function subir(nuevas) {
  const r = vigiaEnvio.revisar();
  if (r.accion === 'esperar') { guardar(nuevas); return; }
  if (r.accion === 'cortado') {
    // Las posiciones del envío colgado vuelven a la cola YA, para salir en
    // esta misma tanda. El `catch` del envío cortado no las vuelve a tocar.
    guardar(r.vuelo.posiciones);
    anotarFallo('envío colgado (cortado por la tarea)', r.vuelo.posiciones);
  }
  await subirAhora(nuevas);
}

async function subirAhora(nuevas) {
  // Lo atrasado va primero y ordenado: el servidor mide las vueltas con la
  // hora de cada posición, así que el orden importa. Se manda como mucho una
  // tanda; lo que sobra espera al próximo envío y así la cola se drena de a
  // poco en vez de rebotar contra el límite.
  const todas = [...pendientes, ...nuevas].sort((a, b) => a.timestamp - b.timestamp);
  const posiciones = todas.slice(0, MAX_POR_ENVIO);
  pendientes = todas.slice(MAX_POR_ENVIO);
  diagnostico.enEspera = pendientes.length;
  if (!posiciones.length) return;
  // El vuelo se anota ANTES de tocar la red, y con el mismo `control` para
  // todo lo que se espere adentro: es lo que el próximo disparo del GPS va
  // a cortar si esto no vuelve.
  const control = new AbortController();
  const vuelo = vigiaEnvio.empezar(posiciones, control);
  diagnostico.enVueloDesde = vuelo.desde;
  try {
    const [crudo, servidor, presencia, flagGrabando] = await Promise.all([
      SecureStore.getItemAsync(LLAVE_SESION),
      SecureStore.getItemAsync(LLAVE_SERVIDOR),
      SecureStore.getItemAsync(LLAVE_PRESENCIA).catch(() => null),
      SecureStore.getItemAsync(LLAVE_GRABANDO).catch(() => null),
    ]);
    if (!crudo || !servidor || !JSON.parse(crudo)?.token) {
      guardar(posiciones);
      anotarFallo(!crudo || !servidor ? 'sin sesión guardada' : 'sesión sin token', posiciones);
      // Sin sesión SOSTENIDO no es un tropiezo: es que nadie está adentro.
      // El servicio se apaga solo en vez de girar para nadie.
      sinSesionSeguidas++;
      if (sinSesionSeguidas >= SIN_SESION_TOPE) {
        sinSesionSeguidas = 0;
        diagnostico.servicio = 'detenido: sin sesión';
        try { await Location.stopLocationUpdatesAsync(TAREA_GPS); } catch {}
      }
      return;
    }
    sinSesionSeguidas = 0;
    const { token } = JSON.parse(crudo);

    // ── El vigía de la ausencia ─────────────────────────────────
    // Estando AUSENTE: si el GPS lo ve lejos del lugar donde se quedó,
    // arrancó de nuevo → vuelve a ruta solo. Si la ausencia pasa el tope,
    // ya no es un almuerzo → fuera, y este servicio se apaga.
    let presenciaEfectiva = presencia;
    if (presencia === 'ausente' && posiciones.length) {
      if (!vigia) vigia = crearVigia();
      const ultima = posiciones[posiciones.length - 1];
      const accion = vigia.posicion(ultima.lat, ultima.lng, ultima.timestamp || Date.now());
      if (accion === 'volver') {
        vigia = null;
        presenciaEfectiva = 'ruta';
        await SecureStore.setItemAsync(LLAVE_PRESENCIA, 'ruta');
        diagnostico.presenciaAuto = 'ruta';
      } else if (accion === 'fuera') {
        vigia = null;
        await SecureStore.setItemAsync(LLAVE_PRESENCIA, 'fuera');
        // El flag va ANTES de parar el servicio: así la vigilancia de la
        // pantalla nunca ve "servicio caído" sin saber por qué (y no lo
        // rearranca).
        diagnostico.presenciaAuto = 'fuera';
        // Si este POST queda colgado y la tarea lo corta, no hay nada que
        // devolver a la cola: las posiciones de la casa no se mandan.
        vuelo.posiciones = [];
        try {
          await fetchConCorte(servidor + '/presencia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ estado: 'fuera' }),
          }, control);
        } catch {}
        diagnostico.servicio = 'detenido: ausente mucho tiempo';
        try { await Location.stopLocationUpdatesAsync(TAREA_GPS); } catch {}
        // Y la brecha vieja no queda colgada en la bandeja
        limpiarNotificacion().catch(() => {});
        // Las posiciones de la casa no se mandan: irse es irse.
        return;
      }
    } else if (presencia !== 'ausente') {
      vigia = null;
    }

    const r = await fetchConCorte(servidor + '/gps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        posiciones,
        ...(presenciaEfectiva === 'ruta' || presenciaEfectiva === 'ausente'
          ? { presencia: presenciaEfectiva } : {}),
        // Si se está grabando, para que un pedido de Despacho (4.5) se dé
        // por levantado; si no, para que el servidor sepa que la grabación
        // que pidió ya terminó. Un booleano explícito en cada envío.
        grabando: flagGrabando === '1',
      }),
    }, control);
    if (r.ok) {
      diagnostico.enviadas += posiciones.length;
      diagnostico.ultimoEnvio = Date.now();
      diagnostico.ultimoError = null;
      // La brecha vuelve en la misma respuesta: es lo que mantiene VIVA la
      // notificación con la pantalla apagada — el WebSocket ya murió y este
      // POST es el único canal. Mejor esfuerzo: si falla, el GPS ni se entera.
      const cuerpo = await r.json().catch(() => null);
      if (cuerpo?.brecha) notificarBrecha(cuerpo.brecha).catch(() => {});
      // Despacho pidió una grabación (4.5). Mejor esfuerzo, como todo lo que
      // cuelga de esta respuesta: si falla, el pedido sigue vivo en el
      // servidor y el próximo POST lo vuelve a traer.
      if (cuerpo?.grabar === true) atenderPedidoGrabacion().catch(() => {});
    } else {
      // El cuerpo del error dice bastante más que el número: 403 del cobrador,
      // 409 del relevo y 400 del reloj mal puesto se ven igual desde afuera.
      const cuerpo = await r.json().catch(() => ({}));
      // Un 4xx que no sea de red es culpa del contenido o del permiso: no se
      // reintenta, porque reintentarlo daría el mismo error para siempre y
      // taparía las posiciones nuevas detrás de un atraso que nunca se vacía.
      if (r.status >= 500) guardar(posiciones);
      anotarFallo(`HTTP ${r.status}${cuerpo.error ? ' ' + cuerpo.error : ''}`, posiciones);
    }
  } catch (e) {
    // Si lo cortó la tarea, `subir` ya devolvió las posiciones a la cola y
    // las contó: volver a hacerlo acá las mandaría dos veces.
    if (vuelo.cortado) return;
    // Sin datos: en segundo plano es lo normal, Doze le corta la red a la app.
    // NO se pierden — esperan al próximo envío que salga. El envío colgado
    // llega acá por el corte de 15 s, con su propio nombre: "sin red" dice
    // que no hay datos, esto dice que los hay pero el socket quedó muerto.
    guardar(posiciones);
    anotarFallo(e?.name === 'AbortError' ? 'envío colgado (corte a los 15 s)' : 'sin red', posiciones);
  } finally {
    vigiaEnvio.terminar(vuelo);
    if (!vigiaEnvio.enVuelo) diagnostico.enVueloDesde = null;
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
  // La brecha vieja no puede quedar en la bandeja diciendo un número de
  // hace una hora: el que salió de ruta no tiene brecha.
  limpiarNotificacion().catch(() => {});
  diagnostico.servicio = 'detenido';
}

// Para mirarlo desde la pantalla sin adivinar. Se pregunta al sistema, no a
// una variable nuestra: la variable puede estar al día y el servicio muerto.
export async function estaCorriendo() {
  try { return await Location.hasStartedLocationUpdatesAsync(TAREA_GPS); }
  catch { return false; }
}
