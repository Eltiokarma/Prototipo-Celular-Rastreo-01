// La app del chofer: brecha en vivo, chat, SOS y GPS en segundo plano.
//
// Falta el mapa, y a propósito: necesita `react-native-maps`, que es una
// librería nativa y obliga a compilar un APK nuevo. El chat y el SOS son
// JavaScript puro y entran por recarga en caliente, así que van primero.
//
// Este archivo SOLO DIBUJA. Lo que decide qué se ve vive afuera, en módulos
// de JavaScript puro con sus propias pruebas, y no es un capricho: es donde
// estuvieron todos los bugs de esta app —la unidad inventada, el lado vacío,
// el "sin señal", el 02:60, el envío colgado de React—, y afuera se pueden
// correr en Node sin un teléfono.
//
//   hud.js       qué brecha se muestra y qué se le dice al chofer
//   chat.js      qué mensaje va en qué canal y quién lo firma
//   protocolo/   hablar con el servidor
//   gps/         el servicio de fondo, que además MANDA las posiciones

import React from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, AppState, StyleSheet,
  FlatList, PanResponder, Animated, Vibration,
  Image, Modal, Dimensions, Keyboard, BackHandler, ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { crearCliente } from './protocolo/cliente';
import { limpiarNotificacion } from './notificacion.js';
import { construirHud, textoNotificacion } from './hud';
import { aMensaje, hilo, sinLeer, conTipoSos, TIPOS_SOS } from './chat';
import { margenes, margenBarra } from './margenes';
import { esHorizontal, desplazamiento, indiceDestino, PANTALLAS, INICIAL } from './gestos';
import * as mapa from './mapa';
import { paleta, esOscuro, siguienteModo, ETIQUETA } from './tema';
import { levantar } from './teclado';
import { useAudioRecorder, useAudioPlayer, RecordingPresets,
         pedirPermisoMicrofono, aDataUrl, MAX_SEGUNDOS } from './voz';
import { tomarFoto, elegirFoto, comoTexto } from './foto';
import { WebView } from 'react-native-webview';
import * as gps from './gps/servicio';

// Por defecto, el servidor que ya está en la nube: así la primera prueba en
// un teléfono no depende de la red de casa. Para pegarle a un servidor local
// hay que poner la IP de la máquina en la wifi — el celular NO resuelve
// "localhost", que para él es él mismo.
// Dónde se guarda el modo elegido. En SecureStore como el resto, no porque
// sea secreto sino para no sumar otra librería de almacenamiento por un dato.
const LLAVE_TEMA = 'r14_tema';

const SERVIDOR = process.env.EXPO_PUBLIC_SERVIDOR
  || 'https://prototipo-celular-rastreo-01-production.up.railway.app';

// La persona firma el mensaje; el vehículo define el canal privado. No son
// lo mismo y confundirlos rompe las dos cosas — ver PROTOCOLO.md.
const quienSoy = (c) => ({
  miPersona: c.sesion?.unitId || null,
  miVehiculo: c.sesion?.vehicleId || c.sesion?.unitId || null,
});

// Los colores y la hoja de estilos dependen del tema, así que no pueden ser
// constantes de módulo: se arman por paleta y viajan por contexto. Se pasan
// por contexto y no por props porque los usa CADA componente de este archivo,
// y enhebrarlos a mano por veinte lugares es el tipo de cambio donde se
// olvida uno y queda una pantalla mitad de día y mitad de noche.
const Tema = React.createContext(null);
const usarTema = () => React.useContext(Tema);

// La hoja se arma una vez por paleta y se guarda: `StyleSheet.create` en cada
// render sería un objeto nuevo por frame, justo mientras el dedo arrastra.
const hojas = new Map();
function hojaDe(C) {
  if (!hojas.has(C)) hojas.set(C, crearEstilos(C));
  return hojas.get(C);
}
const colorEstado = (C) => ({ verde: C.verde, ambar: C.ambar, rojo: C.rojo, ninguno: C.tenue });

// `SafeAreaProvider` tiene que envolver TODO: es quien mide dónde terminan la
// barra de estado y la de navegación de Android, y sin él `useSafeAreaInsets`
// devuelve ceros. Con ceros el botón de CHAT vuelve a quedar debajo de los
// botones del sistema, que es el bug que se midió en un teléfono de verdad.
export default function App() {
  return (
    <SafeAreaProvider>
      <ConTema>
        <Aplicacion />
      </ConTema>
    </SafeAreaProvider>
  );
}

// El tema se revisa cada minuto, no en cada render: el automático depende de
// la hora y nadie está mirando cuando se hace de noche. Un minuto es de sobra
// —el cambio ocurre una vez por turno— y no cuesta nada.
function ConTema({ children }) {
  const [modo, setModo] = React.useState('auto');
  const [ahora, setAhora] = React.useState(() => new Date());

  React.useEffect(() => {
    SecureStore.getItemAsync(LLAVE_TEMA).then(g => { if (g) setModo(g); }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (modo !== 'auto') return;      // forzado: el reloj no manda
    const t = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(t);
  }, [modo]);

  const C = paleta(modo, ahora);
  const valor = React.useMemo(() => ({
    C, s: hojaDe(C), modo, oscuro: esOscuro(modo, ahora),
    alternar: () => {
      const nuevo = siguienteModo(modo);
      setModo(nuevo);
      setAhora(new Date());
      SecureStore.setItemAsync(LLAVE_TEMA, nuevo).catch(() => {});
    },
  }), [C, modo, ahora]);

  return <Tema.Provider value={valor}>{children}</Tema.Provider>;
}

function Aplicacion() {
  const [sesion, setSesion] = React.useState(null);
  const [hud, setHud] = React.useState(() => construirHud(null));
  // El estado crudo y el trazado son para el mapa. El HUD ya sale de la
  // brecha; el mapa necesita dónde está cada una.
  const [estado, setEstado] = React.useState(null);
  const [geometria, setGeometria] = React.useState(null);
  // La marca de la cooperativa. Es lo que le dice al chofer que ésta es la app
  // de SU empresa y no la de cualquiera: con varias cooperativas en el mismo
  // sistema, una pantalla sin marca no se distingue de la de al lado.
  const [marca, setMarca] = React.useState(null);
  const [conectado, setConectado] = React.useState(false);
  const [reporta, setReporta] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);
  const [mensajes, setMensajes] = React.useState([]);
  const [pantalla, setPantalla] = React.useState(INICIAL);  // ver gestos.js
  // La presencia: 'fuera' (recién entrado, sin emitir), 'ruta', 'ausente'.
  // Se DECLARA acá; entrar a la cadena de brechas lo confirma el servidor
  // cuando el GPS pisa el trazado — ver `enRutaConfirmada` más abajo.
  const [presencia, setPresencia] = React.useState('fuera');
  // El perfil: quién soy, cómo me fue, mi alias y mi contraseña (3.5)
  const [verPerfil, setVerPerfil] = React.useState(false);
  // El SOS recién disparado, esperando (si el chofer puede) que le ponga
  // nombre. La alerta YA salió: esto es opcional y se va solo a los 5 min.
  const [tipificarSos, setTipificarSos] = React.useState(false);
  React.useEffect(() => {
    if (!tipificarSos) return;
    const t = setTimeout(() => setTipificarSos(false), 5 * 60_000);
    return () => clearTimeout(t);
  }, [tipificarSos]);
  const [canal, setCanal] = React.useState('grupo');        // 'grupo' | 'directo'
  const [vistoHasta, setVistoHasta] = React.useState({ grupo: 0, directo: 0 });
  const cliente = React.useRef(null);

  // ── El cliente vive fuera de React ──────────────────────────
  // Se crea una sola vez: si se recreara en cada render, cada cambio de
  // brecha abriría un WebSocket nuevo.
  React.useEffect(() => {
    cliente.current = crearCliente({ servidor: SERVIDOR, WebSocketImpl: WebSocket });
    const c = cliente.current;
    const off = [
      c.on('estado', () => { setHud(construirHud(c.miBrecha())); setEstado(c.estado); }),
      c.on('geometria', (g) => setGeometria(g)),
      c.on('conexion', ({ conectado }) => setConectado(conectado)),
      c.on('rolGps', ({ reporta, motivo }) => { setReporta(reporta); setAviso(motivo); }),
      // La presencia vuelve a 'fuera' con la sesión: sin esto, el próximo
      // login saltaba la puerta y mostraba el HUD sin GPS corriendo.
      c.on('authError', (e) => { setAviso(e); setSesion(null); setPresencia('fuera'); }),
      // El historial llega al identificarse y trae solo lo que a este chofer
      // le corresponde ver: el filtrado del privado lo hace el servidor.
      c.on('historial', (items) => setMensajes(items.map(m => aMensaje(m, quienSoy(c))))),
      c.on('chat', (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
      c.on('sos',  (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
      // El tipo llega después que el SOS y actualiza la burbuja YA dibujada
      // en vez de sumar otra: en el hilo la emergencia es una sola.
      c.on('sosTipo', (e) => setMensajes(v =>
        v.map(m => (m.sosId != null && m.sosId === e.sosId) ? conTipoSos(m, e.tipo) : m))),
      // El "¿qué pasó?" se abre recién con el ECO del propio SOS: es la
      // prueba de que la alerta LLEGÓ (y trae el id que el tipo necesita).
      // Abrirlo al deslizar mentía dos veces: sin señal decía "ALERTA
      // ENVIADA" de una alerta que nunca salió, y un tipo tocado antes del
      // eco se perdía en silencio (marcarTipoSos sin id no manda nada).
      c.on('sos', (m) => {
        if (c.sesion && m.unitId === c.sesion.unitId) setTipificarSos(true);
      }),
      c.on('voz',  (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
      c.on('foto', (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
    ];
    return () => off.forEach(f => f());
  }, []);

  // ── Sesión guardada ─────────────────────────────────────────
  // El token dura 30 días: el chofer no vuelve a escribir la contraseña cada
  // mañana. Va en SecureStore y no en AsyncStorage porque es una credencial.
  React.useEffect(() => {
    SecureStore.getItemAsync(gps.LLAVE_SESION).then(guardada => {
      if (guardada) entrarConSesion(JSON.parse(guardada));
    }).catch(() => {});
  }, []);

  const entrarConSesion = async (s) => {
    saliendo.current = false;
    setSesion(s);
    // El servidor va al disco junto con la sesión porque la tarea de fondo
    // los lee de ahí: cuando Android la revive, no queda nada en memoria.
    await SecureStore.setItemAsync(gps.LLAVE_SERVIDOR, SERVIDOR);
    // La sesión va JUNTO con el token: sin ella el cliente no sabe quién soy,
    // y la brecha, el chat y el mapa fallan en silencio. Ver `conectar()`.
    cliente.current.conectar(s.token, s);
    cliente.current.pedirMarca(s.token).then(m => { if (m) setMarca(m); });
    // El GPS ya NO arranca al entrar: arranca al SALIR A RUTA. Pero si la
    // app murió a mitad de turno (Android la mató, el chofer la reabrió),
    // la presencia guardada retoma sola: nadie vuelve a marcar nada.
    const previa = await SecureStore.getItemAsync(gps.LLAVE_PRESENCIA).catch(() => null);
    if (previa !== 'ruta' && previa !== 'ausente') setPresencia('fuera');
    if (previa === 'ruta' || previa === 'ausente') {
      setPresencia(previa);
      cliente.current.marcarPresencia(previa);
      const permisos = await gps.pedirPermisos();
      if (!permisos.ok) { setAviso(`Falta el permiso de ubicación en ${permisos.cual}`); return; }
      setAviso(null);   // el aviso de permisos viejo no sobrevive al permiso dado
      await gps.arrancar({ textoNotificacion: 'Turno en curso' });
    }
  };

  // Cambiar de presencia es UNA función porque toca tres mundos a la vez y
  // el orden importa: el disco (para la tarea de fondo y para retomar), el
  // servidor (la declaración), y el servicio de GPS (que emite o calla).
  const cambiarPresencia = async (nueva) => {
    setPresencia(nueva);
    try { await SecureStore.setItemAsync(gps.LLAVE_PRESENCIA, nueva); } catch {}
    cliente.current.marcarPresencia(nueva);
    if (nueva === 'fuera') {
      // Primero se le avisa al vigilante, DESPUÉS se para: la misma carrera
      // que ya nos costó un servicio huérfano en `onSalir`.
      saliendo.current = true;
      await gps.parar();
    } else {
      // AUSENTE sale de la cadena: el servidor deja de contestar brecha y
      // la notificación viva no se actualiza más — sin esto, la bandeja
      // mostraba una brecha de hace una hora como si fuera de ahora,
      // durante todo el almuerzo.
      if (nueva === 'ausente') limpiarNotificacion().catch(() => {});
      saliendo.current = false;
      const permisos = await gps.pedirPermisos();
      if (!permisos.ok) { setAviso(`Falta el permiso de ubicación en ${permisos.cual}`); return; }
      setAviso(null);   // ídem: al dar el permiso, el cartel viejo se va
      await gps.arrancar({ textoNotificacion: textoRef.current });
    }
  };

  // ── Las posiciones NO se mandan desde acá ───────────────────
  //
  // Las manda la propia tarea de fondo (`gps/servicio.js`), y es la lección
  // más cara de todo esto: cuando Android manda la app atrás, suspende el
  // JavaScript y esta pantalla deja de existir. Cualquier envío colgado de
  // React se corta justo cuando más se lo necesita — con la pantalla
  // bloqueada, que es el caso para el que la app nativa fue hecha.
  //
  // Acá solo se mira, para poder mostrar en pantalla qué está pasando.
  // El SOS vale mucho más con coordenadas: es lo primero que pregunta quien
  // sale a ayudar. Se guarda la última que pasó por la tarea.
  const ultimaPos = React.useRef({ lat: null, lng: null });
  React.useEffect(() => {
    gps.cuandoLlegueUnaPosicion((p) => { ultimaPos.current = { lat: p.lat, lng: p.lng }; });
  }, []);

  // El texto de la notificación va en un ref para que los oyentes se
  // suscriban UNA vez: si dependieran del hud, se re-suscribirían con cada
  // brecha nueva. Lo usan la vigilancia y el cambio de cadencia.
  const textoRef = React.useRef('Turno en curso');
  textoRef.current = textoNotificacion(hud, reporta);

  // ── Vigilancia del servicio de GPS ──────────────────────────
  //
  // No alcanza con arrancarlo una vez. Android lo mata —y Xiaomi, Huawei y
  // Oppo lo matan más—, y cuando eso pasa la app se ve perfecta: entra,
  // chatea, manda fotos y SOS. Lo único que falta es lo único que importa.
  //
  // Se le pregunta AL SISTEMA si está corriendo, no a una variable nuestra:
  // la variable puede estar al día y el servicio muerto. Y si no está, se
  // rearranca. `arrancar` ya chequea antes de hacer nada, así que esto no
  // reinicia un servicio sano — que es lo que quemaría la batería.
  const [diag, setDiag] = React.useState({ ...gps.diagnostico });
  // Levantado mientras se está SALIENDO. Existe por una carrera medida: el
  // vigilante revisa cada 2 s, y su tick podía caer justo entre `gps.parar()`
  // y el desmontaje del efecto — veía el servicio detenido y lo REARRANCABA.
  // Resultado: un servicio huérfano reportando para nadie, con la sesión ya
  // borrada del disco ("sin sesión guardada" ×38 en un teléfono real). Un
  // booleano en un ref le gana a la carrera porque se lee en el momento, no
  // al armar el efecto.
  const saliendo = React.useRef(false);
  React.useEffect(() => {
    // Fuera de ruta no hay nada que vigilar: el servicio está parado a
    // propósito y rearrancarlo sería emitir señal de alguien que no salió.
    if (!sesion || presencia === 'fuera') return;
    let vivo = true;
    const mirar = async () => {
      // PRIMERO el cambio automático de presencia, antes de mirar el
      // servicio: si el vigía de la ausencia lo apagó ('fuera'), hay que
      // enterarse ANTES de la rama que rearranca servicios caídos.
      if (gps.diagnostico.presenciaAuto) {
        const auto = gps.diagnostico.presenciaAuto;
        gps.diagnostico.presenciaAuto = null;
        if (auto === 'fuera') saliendo.current = true;
        setPresencia(auto === 'ruta' ? 'ruta' : 'fuera');
        setAviso(auto === 'ruta'
          ? 'Te vimos en movimiento: volviste a ruta'
          : 'Ausente más de 2 horas: te sacamos de ruta');
      }
      const corriendo = await gps.estaCorriendo();
      if (!vivo || saliendo.current) return;
      if (!corriendo) {
        gps.diagnostico.servicio = 'caído, rearrancando';
        gps.arrancar({ textoNotificacion: textoRef.current }).catch(() => {});
      } else if (gps.diagnostico.servicio !== 'corriendo') {
        gps.diagnostico.servicio = 'corriendo';
      }
      setDiag({ ...gps.diagnostico });
    };
    mirar();
    const t = setInterval(mirar, 2000);
    return () => { vivo = false; clearInterval(t); };
  }, [sesion, presencia]);

  // ── Cadencia según la pantalla ──────────────────────────────
  // Con la pantalla apagada el chofer no mira el HUD: la posición ya solo
  // sirve para la brecha de los demás, y 10 s alcanzan. Baja mucho el gasto.
  //
  // OJO CON ESTO, que ya se rompió una vez: `cambiarCadencia` reinicia el
  // servicio de ubicación —expo-location no deja cambiarle el intervalo ni
  // el texto a una tarea en curso—, así que solo puede llamarse cuando
  // cambia algo de verdad. La versión anterior lo colgaba de la brecha, que
  // cambia cada 3 segundos: reiniciaba el GPS cada 3 segundos y quemaba
  // batería, que es exactamente lo que este build viene a medir.
  //
  React.useEffect(() => {
    if (!sesion || presencia === 'fuera') return;
    const sub = AppState.addEventListener('change', (estado) => {
      const activo = estado === 'active';
      gps.cambiarCadencia(
        activo ? gps.CADENCIA_PANTALLA_ENCENDIDA : gps.CADENCIA_PANTALLA_APAGADA,
        textoRef.current,
      ).catch(() => {});
    });
    return () => sub.remove();
  }, [sesion, presencia]);

  // La notificación permanente lleva la brecha, pero solo se refresca cuando
  // la app pasa a segundo plano (arriba) — que es justo cuando el chofer va a
  // mirarla. Ponerla al día en vivo pide otro camino: una notificación
  // aparte con expo-notifications, para no tocar el servicio de ubicación.
  // Queda pendiente y anotado en el README.

  // El botón ATRÁS de Android navega antes de salir: desde el mapa o el chat
  // vuelve a la ruta, y recién desde la ruta sale de la app. Sin esto, atrás
  // cerraba la app desde cualquier pantalla — y el que está mirando el mapa
  // no quiere irse de la app, quiere volver.
  //
  // OJO CON DÓNDE VIVE ESTE HOOK. Tiene que estar ANTES del `return` temprano
  // de la pantalla de entrar: un hook después de un return condicional hace
  // que el componente rinda 22 hooks sin sesión y 23 con sesión, y React
  // corta con "Rendered more hooks than during the previous render" justo al
  // entrar. Pasó en un teléfono real.
  //
  // (El mapa suelto registra SU propio manejador, más nuevo que éste, así que
  // Android le pregunta primero: atrás ahí bloquea el mapa, no navega.)
  React.useEffect(() => {
    if (!sesion || pantalla === 'ruta') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPantalla('ruta');
      return true;
    });
    return () => sub.remove();
  }, [sesion, pantalla]);

  if (!sesion) return <Entrar servidor={SERVIDOR} aviso={aviso} onEntrar={async (s) => {
    await SecureStore.setItemAsync(gps.LLAVE_SESION, JSON.stringify(s));
    entrarConSesion(s);
  }} clienteRef={cliente} />;

  const irA = (p) => {
    setPantalla(p);
    if (p === 'chat') marcarVisto(canal);
  };
  const marcarVisto = (cual) =>
    setVistoHasta(v => ({ ...v, [cual]: Date.now() }));

  const noLeidos = {
    grupo: sinLeer(mensajes, 'grupo', vistoHasta.grupo),
    directo: sinLeer(mensajes, 'directo', vistoHasta.directo),
  };

  // ¿El servidor ya me confirmó sobre el trazado? Es SU palabra, no la mía:
  // viaja en el estado que él emite. Mientras no, la pantalla dice "yendo".
  const miVehiculo = sesion.vehicleId || sesion.unitId;
  const enRutaConfirmada = !!(estado && estado.units &&
    estado.units.find(u => u.unitId === miVehiculo && u.enRuta !== false));

  const comun = {
    conectado, aviso, diag, pantalla, noLeidos, marca, presencia,
    onIr: irA,
    onSalir: async () => {
      // El orden importa: primero se le avisa al vigilante, DESPUÉS se para
      // el servicio. Al revés, un tick del vigilante en medio lo rearrancaba.
      saliendo.current = true;
      // Que la unidad se vaya del mapa en el acto, no a los 3 min del olvido
      try { cliente.current.marcarPresencia('fuera'); } catch {}
      try { await SecureStore.deleteItemAsync(gps.LLAVE_PRESENCIA); } catch {}
      setPresencia('fuera');
      await SecureStore.deleteItemAsync(gps.LLAVE_SESION);
      await gps.parar();
      cliente.current.salir();
      setSesion(null);
    },
  };

  // Las dos pantallas viven a la vez dentro del carrusel. Antes se devolvía
  // una U otra, y por eso el deslizamiento se sentía tosco: no había nada
  // que se moviera con el dedo, solo un cambio de golpe al soltar. Además,
  // montadas las dos, el chat no pierde el scroll ni el texto a medio
  // escribir cada vez que el chofer mira la brecha.
  return (
    <>
    <Carrusel pantalla={pantalla} onIr={irA}>
      <Mapa {...comun} estado={estado} geometria={geometria}
        yo={cliente.current?.sesion} activo={pantalla === 'mapa'} />
      <Ruta {...comun} hud={hud} reporta={reporta}
        confirmada={enRutaConfirmada}
        onPresencia={cambiarPresencia}
        onSos={() => cliente.current.mandarSos(ultimaPos.current)}
        tipificarSos={tipificarSos}
        onTipoSos={(tipo) => {
          if (tipo) cliente.current.marcarTipoSos(tipo);
          setTipificarSos(false);
        }}
        onPerfil={() => setVerPerfil(true)} />
      <Chat {...comun}
        mensajes={hilo(mensajes, canal)}
        canal={canal}
        onCanal={(cual) => { setCanal(cual); marcarVisto(cual); }}
        onEnviar={(texto) => cliente.current.mandarChat(texto, { privado: canal === 'directo' })}
        onVoz={(data, duration) => cliente.current.mandarVoz({ data, duration, privado: canal === 'directo' })}
        onFoto={(data) => cliente.current.mandarFoto({ data, privado: canal === 'directo' })} />
    </Carrusel>
    {/* Fuera del carrusel: el perfil no es una página más, es un alto */}
    {verPerfil && (
      <Perfil sesion={sesion} marca={marca} onCerrar={() => setVerPerfil(false)} />
    )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Las dos pantallas, una al lado de la otra, corriéndose con el dedo.
//
// La barra de abajo sigue estando: esto es el atajo, no el único camino.
//
// Dos cosas que no son obvias y que sostienen todo lo demás:
//
// 1. `onMoveShouldSetPanResponder` y NO la versión `...Capture`. Esa
//    diferencia de una palabra es la que protege al SOS: sin capturar, el
//    hijo reclama el gesto primero. El SOS es hijo de acá, también se desliza
//    en horizontal, y si esta capa le robara el dedo el chofer creería que
//    pidió ayuda sin haberla pedido.
// 2. `useNativeDriver: true`. La animación corre en el hilo nativo, así que
//    sigue fluida aunque el JavaScript esté ocupado — y acá el JavaScript
//    está ocupado seguido: cada 3 segundos entra una posición y se recalcula
//    la brecha. Con el driver de JS, el deslizamiento se trababa justo
//    cuando llegaba el estado.
//
// La cuenta de cuánto se corre y a dónde se acomoda está en `gestos.js`, que
// se prueba en Node. Acá solo se dibuja.
function Carrusel({ pantalla, onIr, children }) {
  const { ancho } = useVentana();
  const indice = Math.max(0, PANTALLAS.indexOf(pantalla));
  const x = React.useRef(new Animated.Value(0)).current;
  const indiceRef = React.useRef(indice);
  indiceRef.current = indice;

  // Cuando se cambia de pantalla con la barra —no con el dedo— igual se
  // desliza. Que el mismo destino se vea igual sin importar cómo se llegó es
  // lo que hace que la app se sienta de una pieza.
  React.useEffect(() => {
    Animated.spring(x, {
      toValue: -indice * ancho,
      useNativeDriver: true, bounciness: 0, speed: 14,
    }).start();
  }, [indice, ancho]);

  const pan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => esHorizontal(g),
    onPanResponderMove: (_, g) => x.setValue(desplazamiento(indiceRef.current, g.dx, ancho)),
    onPanResponderRelease: (_, g) => {
      const destino = indiceDestino(indiceRef.current, g, ancho);
      Animated.spring(x, {
        toValue: -destino * ancho,
        useNativeDriver: true, bounciness: 0, speed: 14,
      }).start();
      if (destino !== indiceRef.current) onIr(PANTALLAS[destino]);
    },
    // Si el gesto se cancela —una llamada entrante, el sistema tomando el
    // borde—, la pantalla no puede quedar a mitad de camino.
    onPanResponderTerminate: () => {
      Animated.spring(x, {
        toValue: -indiceRef.current * ancho,
        useNativeDriver: true, bounciness: 0, speed: 14,
      }).start();
    },
  }), [ancho, onIr]);

  return (
    <Animated.View
      style={{ flex: 1, flexDirection: 'row', width: ancho * PANTALLAS.length,
               transform: [{ translateX: x }] }}
      {...pan.panHandlers}>
      {React.Children.map(children, (hijo) => <View style={{ width: ancho }}>{hijo}</View>)}
    </Animated.View>
  );
}

// El ancho de la ventana, que cambia al girar el teléfono. Con un ancho fijo
// tomado al arrancar, girarlo dejaba el carrusel a medio camino para siempre.
function useVentana() {
  const [medida, setMedida] = React.useState(() => Dimensions.get('window'));
  React.useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setMedida(window));
    return () => sub.remove();
  }, []);
  return { ancho: medida.width, alto: medida.height };
}

// ═══════════════════════════════════════════════════════════════
function Entrar({ servidor, aviso, onEntrar, clienteRef }) {
  const { s, C } = usarTema();
  const [usuario, setUsuario] = React.useState('');
  const [clave, setClave] = React.useState('');
  const [verClave, setVerClave] = React.useState(false);
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState(null);
  const margen = margenes(useSafeAreaInsets());

  const enviar = async () => {
    setError(null); setCargando(true);
    try {
      onEntrar(await clienteRef.current.entrar(usuario.trim(), clave));
    } catch (e) {
      // El mensaje del servidor ya dice el intento y cuántos quedan: se
      // muestra tal cual en vez de inventar uno genérico.
      setError(e.status ? e.message : 'No se pudo conectar con el servidor');
      setCargando(false);
    }
  };

  return (
    <View style={[s.pantalla, margen]}>
      <StatusBar style="light" />
      <Text style={s.tituloChico}>CONTROL DE RUTA</Text>
      <Text style={s.subtitulo}>Ingresá con el usuario que te dio tu cooperativa</Text>

      <Text style={s.rotulo}>USUARIO</Text>
      <TextInput style={s.campo} value={usuario} onChangeText={setUsuario}
        autoCapitalize="characters" autoCorrect={false} placeholder="M-12"
        placeholderTextColor={C.tenue} />
      <Text style={s.rotulo}>CONTRASEÑA</Text>
      {/* El ojo existe porque escribir a ciegas una clave que te dieron en un
          papel, con el teclado de un celular y a veces con guantes, termina
          en tres intentos fallidos y una llamada a Despacho. Arranca tapada:
          el chofer entra con gente adelante. */}
      <View style={s.campoConBoton}>
        <TextInput style={[s.campo, s.campoSinBorde]} value={clave} onChangeText={setClave}
          secureTextEntry={!verClave} autoCapitalize="none" autoCorrect={false}
          placeholderTextColor={C.tenue} onSubmitEditing={enviar} />
        <Pressable onPress={() => setVerClave(v => !v)} hitSlop={12} style={s.ojo}>
          <Text style={s.ojoTexto}>{verClave ? 'OCULTAR' : 'VER'}</Text>
        </Pressable>
      </View>

      {(error || aviso) && <Text style={s.error}>{error || aviso}</Text>}

      <Pressable style={[s.boton, cargando && { opacity: 0.6 }]} onPress={enviar} disabled={cargando}>
        {cargando ? <ActivityIndicator color="#fff" /> : <Text style={s.botonTexto}>INGRESAR</Text>}
      </Pressable>
      <Text style={s.pie}>{servidor}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
function Ruta({ hud, conectado, reporta, aviso, diag, pantalla, noLeidos, marca,
                presencia, confirmada, onPresencia, onIr, onSalir, onSos,
                tipificarSos, onTipoSos, onPerfil }) {
  const { s, C } = usarTema();
  const p = hud.principal, sec = hud.secundario;
  const color = colorEstado(C)[p.estado];
  // La pantalla termina en la barra de navegación de la app: el aire de abajo
  // lo pone ella, no ésta. Sumar los dos deja la línea divisoria flotando.
  const margen = margenes(useSafeAreaInsets(), { conBarra: true });
  // "Salir de ruta" pide un segundo toque: apretarlo sin querer a mitad de
  // vuelta te saca del mapa de todos. Un confirm de dos toques alcanza.
  const [confirmarSalida, setConfirmarSalida] = React.useState(false);
  React.useEffect(() => {
    if (!confirmarSalida) return;
    const t = setTimeout(() => setConfirmarSalida(false), 4000);
    return () => clearTimeout(t);
  }, [confirmarSalida]);

  const cabecera = (
    <View style={s.barra}>
      <Marca marca={marca} />
      <Text style={[s.chip, { color: conectado ? C.verde : C.ambar }]}>
        {conectado ? '● EN VIVO' : '○ SIN CONEXIÓN'}
      </Text>
      {onPerfil && <Pressable onPress={onPerfil}><Text style={s.salir}>Perfil</Text></Pressable>}
      <Pressable onPress={onSalir}><Text style={s.salir}>Salir</Text></Pressable>
    </View>
  );

  // ── FUERA: la puerta. Recién entrado (o ya retirado): no se emite señal,
  // el mapa está vedado, el chat queda abierto. Salir a ruta es un gesto
  // deliberado — el mismo deslizar del SOS, para que no pase por accidente.
  if (presencia === 'fuera') {
    return (
      <View style={[s.pantalla, margen]}>
        <StatusBar style="light" />
        {cabecera}
        <View style={s.centro}>
          <Text style={[s.ladoEtiqueta, { color: C.brillante }]}>¿SALÍS A RUTA?</Text>
          <Text style={[s.instruccion, { marginTop: 14 }]}>
            Al salir, tu combi aparece en el mapa y empieza a emitir tu
            posición. Tu vuelta y tu brecha arrancan recién cuando pises el
            trazado — marcar desde tu casa no confunde a nadie.
          </Text>
          <Text style={[s.diagnostico, { marginTop: 18 }]}>
            Mientras tanto el chat queda abierto y no se emite nada.
          </Text>
        </View>
        <Deslizable texto="DESLIZÁ PARA SALIR A RUTA  →" textoBoton="IR"
          colorListo={C.verde} onDisparar={() => onPresencia('ruta')} />
        <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
      </View>
    );
  }

  // ── AUSENTE: comer, un repuesto, un descanso. Se sigue emitiendo (que
  // Despacho sepa dónde está la combi) pero fuera de la cadena de brechas.
  if (presencia === 'ausente') {
    return (
      <View style={[s.pantalla, margen]}>
        <StatusBar style="light" />
        {cabecera}
        <View style={s.centro}>
          <Text style={[s.ladoEtiqueta, { color: C.ambar }]}>AUSENTE</Text>
          <Text style={[s.instruccion, { marginTop: 14 }]}>
            Estás fuera de la cadena: nadie se mide contra vos y tu vuelta
            quedó descartada. Despacho te sigue viendo en el mapa, quieto.
            Si arrancás de nuevo, volvés a ruta solo. Pasadas 2 horas, te
            sacamos de ruta.
          </Text>
          <Pressable onPress={() => onPresencia('ruta')} style={[s.botonAncho, { backgroundColor: C.verde }]}>
            <Text style={s.botonAnchoTexto}>VOLVER A RUTA</Text>
          </Pressable>
          <Text style={s.diagnostico}>
            Al volver, entrás a la cadena cuando el GPS te vea sobre el trazado.
          </Text>
        </View>
        {tipificarSos && <TipoSos onElegir={onTipoSos} />}
        <SosDeslizable onDisparar={onSos} />
        <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
      </View>
    );
  }

  return (
    <View style={[s.pantalla, margen]}>
      <StatusBar style="light" />
      {cabecera}

      {/* El aviso se muestra HAYA O NO rol de GPS. Antes era `!reporta &&
          aviso`, y el de permisos quedaba oculto justo en el peor caso: el
          servidor te da el rol por el WebSocket (reporta=true) mientras el
          servicio de ubicación ni arrancó por falta de permiso — la única
          pista visible era la línea roja del servicio. */}
      {aviso && <Text style={s.avisoBarra}>{aviso}</Text>}

      {/* Declarado en ruta pero el GPS todavía no lo vio sobre el trazado:
          se dice, para que "no tengo brecha" no parezca una falla. */}
      {!confirmada && (
        <Text style={[s.avisoBarra, { color: C.ambar }]}>
          YENDO A LA RUTA — tu brecha y tu vuelta arrancan al pisar el trazado
        </Text>
      )}

      {/* Qué está haciendo el GPS. Está a la vista a propósito mientras se
          mide en la calle: "no aparece en el mapa" no distingue entre el GPS
          que no dispara, el envío que falla y el servidor que rechaza. */}
      {/* El estado del SERVICIO va primero. Sin él, "enviadas 0 · fallidas 0"
          no distingue entre "todavía no llegó la primera posición" y "el
          servicio ni siquiera está corriendo", y esa ambigüedad ya costó una
          sesión entera de diagnóstico. */}
      <Text style={[s.diagnostico, diag.servicio !== 'corriendo' && { color: C.rojo }]}>
        Servicio de GPS: {diag.servicio}
      </Text>
      <Text style={s.diagnostico}>
        GPS enviadas {diag.enviadas} · fallidas {diag.fallidas}
        {diag.enEspera > 0 ? ` · ${diag.enEspera} esperando` : ''}
        {diag.ultimoEnvio ? ` · último hace ${Math.round((Date.now() - diag.ultimoEnvio) / 1000)}s` : ' · todavía ninguna'}
      </Text>
      {/* Los motivos, con su cuenta. Es lo que dice DÓNDE está el problema:
          "sin red" es el teléfono, un HTTP 4xx es el servidor rechazando. */}
      {Object.keys(diag.motivos || {}).length > 0 && (
        <Text style={s.diagnostico}>
          {Object.entries(diag.motivos).map(([m, n]) => `${m} ×${n}`).join(' · ')}
        </Text>
      )}

      <View style={s.centro}>
        <View style={s.filaRotulo}>
          <Text style={[s.ladoEtiqueta, { color }]}>{p.etiqueta}</Text>
          <Text style={s.ladoUnidad}>{p.rotulo}</Text>
        </View>
        {/* Un lado sin número no dibuja dígitos: el guión en tipografía de
            titular se lee como un dato, y no lo es. El rótulo ya lo dice. */}
        {p.display && <Text style={[s.digitos, { color }]}>{p.display}</Text>}
        <Text style={s.instruccion}>{hud.instruccion}</Text>

        <View style={s.divisor} />

        <View style={s.filaRotulo}>
          <Text style={s.ladoEtiquetaSec}>{sec.etiqueta}</Text>
          <Text style={s.ladoUnidad}>{sec.rotulo}</Text>
        </View>
        {sec.display && (
          <Text style={[s.digitosSec, { color: colorEstado(C)[sec.estado] }]}>{sec.display}</Text>
        )}
      </View>

      {/* Los dos movimientos del turno, a un toque del pulgar: pausar
          (ausente) y terminar (salir de ruta, con confirmación de 2 toques). */}
      <View style={s.filaPresencia}>
        <Pressable onPress={() => onPresencia('ausente')} style={[s.botonPresencia, { borderColor: C.ambar }]}>
          <Text style={[s.botonPresenciaTexto, { color: C.ambar }]}>AUSENTE</Text>
        </Pressable>
        <Pressable onPress={() => {
          if (!confirmarSalida) { setConfirmarSalida(true); return; }
          setConfirmarSalida(false);
          onPresencia('fuera');
        }} style={[s.botonPresencia, confirmarSalida && { backgroundColor: C.rojo, borderColor: C.rojo }]}>
          <Text style={[s.botonPresenciaTexto, confirmarSalida && { color: '#fff' }]}>
            {confirmarSalida ? '¿SEGURO? TOCÁ DE NUEVO' : 'SALIR DE RUTA'}
          </Text>
        </Pressable>
      </View>

      {tipificarSos && <TipoSos onElegir={onTipoSos} />}
      <SosDeslizable onDisparar={onSos} />
      <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
    </View>
  );
}

// ¿Qué pasó? — aparece DESPUÉS de disparar el SOS, con la alerta ya
// enviada. En una emergencia real nadie navega un menú antes de pedir
// ayuda: deslizar manda, y esto es lo de después, si el chofer puede.
// "Falla mecánica", "accidente" y "policía" movilizan cosas distintas
// (una grúa, una ambulancia, otra llamada); sin tocar nada queda como SOS
// genérico y se va solo a los 5 minutos.
function TipoSos({ onElegir }) {
  const { s, C } = usarTema();
  return (
    <View style={s.tipoSosCaja}>
      <Text style={s.tipoSosTitulo}>ALERTA ENVIADA — ¿QUÉ PASÓ?</Text>
      <View style={s.filaTipoSos}>
        {Object.entries(TIPOS_SOS).map(([clave, etiqueta]) => (
          <Pressable key={clave} onPress={() => onElegir(clave)} style={s.botonTipoSos}>
            <Text style={s.botonTipoSosTexto}>{etiqueta.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => onElegir(null)} style={s.tipoSosCerrar}>
        <Text style={s.tipoSosCerrarTexto}>Cerrar — queda como SOS</Text>
      </Pressable>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// El perfil del conductor (PENDIENTES 3.5): quién soy, cómo me fue, mi
// alias y mi contraseña. Es un ESPEJO de lo que el gerente ya ve —mismas
// vueltas, mismas horas, misma vara— pedido a /perfil, que solo contesta
// lo del que pregunta. El alias se edita acá porque es cómo lo llaman en
// la ruta; el nombre no, porque con ese se liquidan las horas.
function Perfil({ sesion, marca, onCerrar }) {
  const { s, C } = usarTema();
  const margen = margenes(useSafeAreaInsets(), { conBarra: false });
  const [datos, setDatos] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [alias, setAlias] = React.useState('');
  const [claveActual, setClaveActual] = React.useState('');
  const [claveNueva, setClaveNueva] = React.useState('');
  const [aviso, setAviso] = React.useState(null);

  // Se recarga entero después de tocar un cobrador: el servidor es el que
  // sabe cuántos quedan y cuántas horas llevan, no esta pantalla.
  const cargar = React.useCallback(() => (
    fetch(SERVIDOR + '/perfil', { headers: { Authorization: 'Bearer ' + sesion.token } })
      .then(async r => {
        const cuerpo = await r.json();
        if (!r.ok) throw new Error(cuerpo.error || 'HTTP ' + r.status);
        setDatos(cuerpo);
        setAlias(cuerpo.persona.alias || '');
      })
      .catch(e => setError('No se pudo cargar: ' + String(e.message || e)))
  ), [sesion]);
  React.useEffect(() => { cargar(); }, [cargar]);

  const post = async (ruta, body, hecho) => {
    setAviso(null);
    try {
      const r = await fetch(SERVIDOR + ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sesion.token },
        body: JSON.stringify(body),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(cuerpo.error || 'No se pudo guardar'); return false; }
      setAviso(hecho);
      return true;
    } catch { setAviso('Sin conexión — probá de nuevo'); return false; }
  };

  const borrar = async (ruta, hecho) => {
    setAviso(null);
    try {
      const r = await fetch(SERVIDOR + ruta, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + sesion.token },
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(cuerpo.error || 'No se pudo'); return false; }
      setAviso(hecho);
      return true;
    } catch { setAviso('Sin conexión — probá de nuevo'); return false; }
  };

  // ── Los cobradores de la combi ──────────────────────────────
  // El chofer administra a los que ya van arriba: les cambia la clave y los
  // saca. El ALTA no está acá a propósito — crear una cuenta es dar acceso
  // al sistema y eso queda en Despacho o la gerencia.
  //
  // La baja pide SEGUNDO TOQUE, como salir de ruta: es una cuenta que deja
  // de existir, y un dedo en un pozo no puede borrarle el acceso a nadie.
  const [confirmarBaja, setConfirmarBaja] = React.useState(null);
  const [claveDe, setClaveDe] = React.useState(null);
  const [claveNuevaCob, setClaveNuevaCob] = React.useState('');

  // Segundos → lo que se lee: 14400 → "4h 00m", 130 → "2:10"
  const hm = (sec) => sec == null ? '—'
    : `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
  const mmss = (sec) => sec == null ? '—'
    : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  // ── El grabador de recorridos (3.4) ─────────────────────────
  // La grabación corre en la tarea de fondo (come de las mismas posiciones
  // que se mandan); acá solo se mira cada 2 s y se dan las órdenes.
  const [grabacion, setGrabacion] = React.useState(gps.diagnostico.grabacion);
  React.useEffect(() => {
    const t = setInterval(() => setGrabacion(
      gps.diagnostico.grabacion ? { ...gps.diagnostico.grabacion } : null), 2000);
    return () => clearInterval(t);
  }, []);
  const [mandandoGrabacion, setMandandoGrabacion] = React.useState(false);
  const terminarYMandar = async () => {
    setMandandoGrabacion(true);
    try {
      // Parar NO borra el archivo: si el envío falla, el botón reintenta
      // con lo grabado — una vuelta manejada no se pierde por mala señal.
      const puntos = await gps.pararGrabacion();
      if (puntos.length < 2) {
        setAviso('La grabación quedó vacía: no hubo recorrido');
        await gps.descartarGrabacion();
        return;
      }
      const fue = await post('/grabacion', {
        puntos,
        nombre: `Recorrido ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString().slice(0, 5)}`,
      }, `Recorrido enviado (${puntos.length} puntos) — se importa desde el trazador de Despacho`);
      if (fue) await gps.descartarGrabacion();
      else setAviso('No salió — la grabación quedó guardada. Probá ENVIAR de nuevo con señal.');
    } finally { setMandandoGrabacion(false); }
  };

  const m = datos?.metricas;
  const tarjetas = m ? [
    ['VUELTAS · 7 DÍAS', String(m.vueltas)],
    ['HOY', String(m.vueltasHoy)],
    // Las medias vueltas. Una VUELTA es el circuito entero (ida y retorno);
    // el que hizo la ida y no volvió no cerraba ninguna y su trabajo no
    // aparecía en ningún lado — quedaban las horas y nada que dijera qué
    // hizo con ellas. Ahora las mitades se cuentan por separado.
    ['IDAS · 7 DÍAS', String(m.idas ?? 0)],
    ['RETORNOS · 7 DÍAS', String(m.retornos ?? 0)],
    ['HORAS · 7 DÍAS', hm(m.horasSec)],
    ['HORAS HOY', hm(m.horasHoySec)],
    ['BRECHA PROM.', mmss(m.brechaProm)],
    // Sin vueltas con vara guardada no hay porcentaje que inventar
    ['EN OBJETIVO', m.cumplimiento == null ? '—' : `${m.cumplimiento} %`],
  ] : [];

  return (
    <Modal animationType="slide" onRequestClose={onCerrar}>
      <View style={[s.pantalla, margen]}>
        <View style={s.barra}>
          <Marca marca={marca} />
          <View style={{ flex: 1 }} />
          <Pressable onPress={onCerrar}><Text style={s.salir}>Cerrar</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
          {error && <Text style={s.avisoBarra}>{error}</Text>}
          {!datos && !error && <ActivityIndicator style={{ marginTop: 40 }} />}
          {datos && (<>
            <Text style={[s.ladoEtiqueta, { color: C.brillante, marginTop: 16 }]}>
              {(datos.persona.alias || datos.persona.name).toUpperCase()}
            </Text>
            <Text style={s.diagnostico}>
              {datos.persona.name}
              {datos.persona.role === 'collector' ? ' · cobrador' : ''}
              {datos.vehiculo.vehicleId ? ` · ${datos.vehiculo.vehicleId}` : ''}
              {datos.vehiculo.label ? ` (${datos.vehiculo.label})` : ''}
              {datos.ruta.name ? ` · ${datos.ruta.name}` : ''}
            </Text>

            {/* Cómo me fue: los mismos números que mira el gerente */}
            <View style={s.perfilGrilla}>
              {tarjetas.map(([etiqueta, valor]) => (
                <View key={etiqueta} style={s.perfilTarjeta}>
                  <Text style={s.perfilEtiqueta}>{etiqueta}</Text>
                  <Text style={s.perfilValor}>{valor}</Text>
                </View>
              ))}
            </View>
            {m && m.cumplimiento != null && (
              <Text style={s.diagnostico}>
                En objetivo: dentro del ±{Math.round((datos.toleranciaCumple || 0.15) * 100)} % de la
                vara que regía en cada vuelta ({m.juzgables} juzgable{m.juzgables === 1 ? '' : 's'}).
              </Text>
            )}
            {/* Una VUELTA es salir y volver. Las idas y los retornos son las
                mitades: si hiciste la ida y no volviste, la ida está contada
                igual. */}
            {m && (m.idas > 0 || m.retornos > 0) && m.idas !== m.retornos && (
              <Text style={s.diagnostico}>
                Una vuelta es el circuito entero. Las idas y los retornos se cuentan
                aparte: {m.idas} ida{m.idas === 1 ? '' : 's'} y {m.retornos} retorno
                {m.retornos === 1 ? '' : 's'} en 7 días.
              </Text>
            )}
            {/* Se le dice al chofer lo mismo que ve Despacho. Esconderlo sería
                la versión amable de mentir, y además le saca la posibilidad de
                explicarlo si hay algo que explicar.
                Se nombra el HECHO y las dos causas posibles, no una sola: la
                medición también se parte por quedarse sin señal, y acusar al
                chofer de haberse metido cuando estuvo en un cerro es la clase
                de error que se descubre cuando ya perdió la confianza. */}
            {m && m.parciales > 0 && (
              <Text style={s.diagnostico}>
                {m.parciales} vuelta{m.parciales === 1 ? '' : 's'} no se
                midi{m.parciales === 1 ? 'ó' : 'eron'} entera{m.parciales === 1 ? '' : 's'}: la
                medición arrancó con la ruta ya avanzada, sea porque entraste en el medio o
                porque estuviste sin señal un rato largo. No cuentan para el promedio ni
                para el objetivo.
              </Text>
            )}

            {aviso && <Text style={[s.avisoBarra, { marginTop: 14 }]}>{aviso}</Text>}

            {/* El alias: cómo te llaman en la ruta. Vacío = tu nombre. */}
            <View style={s.divisor} />
            <Text style={s.perfilSeccion}>ALIAS</Text>
            <Text style={s.diagnostico}>Como te llaman en la ruta. Vacío, se muestra tu nombre.</Text>
            <TextInput style={s.campo} value={alias} onChangeText={setAlias}
              placeholder={datos.persona.name} placeholderTextColor={C.tenue} maxLength={30} />
            <Pressable style={[s.botonAncho, { backgroundColor: C.verde, marginTop: 12 }]}
              onPress={async () => {
                const fue = await post('/perfil/alias', { alias }, 'Alias guardado — Despacho ya te ve así');
                if (fue) setDatos(d => ({ ...d, persona: { ...d.persona, alias: alias.trim() || null } }));
              }}>
              <Text style={s.botonAnchoTexto}>GUARDAR ALIAS</Text>
            </Pressable>

            {/* Los cobradores de la combi. Al chofer se los deja gestionar;
                al cobrador se le muestra con quién anda y nada más — los
                botones que el servidor le negaría no se dibujan. */}
            <View style={s.divisor} />
            <Text style={s.perfilSeccion}>
              {datos.puedeGestionar ? 'COBRADORES DE TU COMBI' : 'ARRIBA DE ESTA COMBI'}
            </Text>
            {!datos.puedeGestionar && datos.chofer && (
              <Text style={s.diagnostico}>
                Vas con {datos.chofer.alias || datos.chofer.name}. Tus horas son
                tuyas y se cuentan aparte de las de él.
              </Text>
            )}
            {datos.puedeGestionar && (
              <Text style={s.diagnostico}>
                Cada uno entra con SU usuario: así las horas de cada uno son
                suyas. Podés cambiarles la clave y sacarlos de tu combi.
                Para AGREGAR uno nuevo, pedíselo a Despacho o a la gerencia:
                el alta lleva el nombre real con el que se liquidan las horas.
              </Text>
            )}

            {(datos.cobradores || []).length === 0 && (
              <Text style={[s.diagnostico, { marginTop: 10 }]}>
                {datos.puedeGestionar
                  ? 'No hay ningún cobrador cargado en tu combi. Lo carga Despacho o la gerencia.'
                  : 'No hay otro cobrador cargado en esta combi.'}
              </Text>
            )}

            {(datos.cobradores || []).map(c => (
              <View key={c.unitId} style={s.cobradorFila}>
                <Text style={s.cobradorNombre}>
                  {c.alias || c.name}{c.enLinea ? ' · en línea' : ''}
                </Text>
                <Text style={s.cobradorDato}>
                  {c.name} · entra como {c.unitId} · {hm(c.horasSec)} en 7 días
                </Text>

                {datos.puedeGestionar && c.unitId !== datos.persona.unitId && (<>
                  <View style={s.cobradorBotones}>
                    <Pressable style={s.cobradorBoton}
                      onPress={() => { setClaveDe(claveDe === c.unitId ? null : c.unitId); setClaveNuevaCob(''); }}>
                      <Text style={[s.cobradorBotonTexto, { color: C.brillante }]}>CLAVE</Text>
                    </Pressable>
                    <Pressable style={s.cobradorBoton}
                      onPress={async () => {
                        if (confirmarBaja !== c.unitId) { setConfirmarBaja(c.unitId); return; }
                        setConfirmarBaja(null);
                        if (await borrar(`/perfil/cobradores/${encodeURIComponent(c.unitId)}`,
                                         `${c.alias || c.name} ya no va en tu combi`)) cargar();
                      }}>
                      <Text style={[s.cobradorBotonTexto, { color: C.rojo }]}>
                        {confirmarBaja === c.unitId ? '¿SEGURO? TOCÁ DE NUEVO' : 'DAR DE BAJA'}
                      </Text>
                    </Pressable>
                  </View>

                  {claveDe === c.unitId && (<>
                    <TextInput style={[s.campo, { marginTop: 10 }]}
                      value={claveNuevaCob} onChangeText={setClaveNuevaCob}
                      placeholder="Contraseña nueva (mínimo 6)" placeholderTextColor={C.tenue} secureTextEntry />
                    <Pressable style={[s.botonAncho, { backgroundColor: C.marca, marginTop: 10 }]}
                      onPress={async () => {
                        const fue = await post(`/perfil/cobradores/${encodeURIComponent(c.unitId)}/clave`,
                          { nueva: claveNuevaCob },
                          `Clave cambiada. ${c.alias || c.name} tiene que entrar de nuevo.`);
                        if (fue) { setClaveDe(null); setClaveNuevaCob(''); }
                      }}>
                      <Text style={[s.botonAnchoTexto, { color: '#fff' }]}>CAMBIAR SU CLAVE</Text>
                    </Pressable>
                  </>)}
                </>)}
              </View>
            ))}

            {/* La contraseña: con la actual en la mano */}
            <View style={s.divisor} />
            <Text style={s.perfilSeccion}>CAMBIAR CONTRASEÑA</Text>
            <TextInput style={s.campo} value={claveActual} onChangeText={setClaveActual}
              placeholder="Contraseña actual" placeholderTextColor={C.tenue} secureTextEntry />
            <TextInput style={[s.campo, { marginTop: 10 }]} value={claveNueva} onChangeText={setClaveNueva}
              placeholder="Contraseña nueva (mínimo 6)" placeholderTextColor={C.tenue} secureTextEntry />
            <Pressable style={[s.botonAncho, { backgroundColor: C.marca, marginTop: 12 }]}
              onPress={async () => {
                const fue = await post('/perfil/clave', { actual: claveActual, nueva: claveNueva },
                  'Contraseña cambiada. Esta sesión sigue abierta.');
                if (fue) { setClaveActual(''); setClaveNueva(''); }
              }}>
              <Text style={[s.botonAnchoTexto, { color: '#fff' }]}>CAMBIAR</Text>
            </Pressable>

            {/* El grabador de recorridos (3.4): manejar la vuelta y que el
                trazado salga de la calle, no del ojo sobre el mapa */}
            <View style={s.divisor} />
            <Text style={s.perfilSeccion}>GRABADOR DE RECORRIDO</Text>
            <Text style={s.diagnostico}>
              Con la salida a ruta activa, manejá la vuelta entera: se guarda
              un punto cada 30 metros (parar en un semáforo no ensucia). Al
              terminar se envía, y Despacho lo importa desde su trazador.
            </Text>
            {!grabacion && (
              <Pressable style={[s.botonAncho, {
                backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea, marginTop: 12,
              }]} onPress={() => gps.empezarGrabacion().then(() => setGrabacion({ puntos: 0, largoM: 0 }))}>
                <Text style={[s.botonAnchoTexto, { color: C.brillante }]}>GRABAR RECORRIDO</Text>
              </Pressable>
            )}
            {grabacion && (<>
              <Text style={[s.diagnostico, { marginTop: 12 }]}>
                {grabacion.parada ? 'Grabación parada (sin enviar)' : '● Grabando'}
                {` · ${grabacion.puntos} punto${grabacion.puntos === 1 ? '' : 's'}`}
                {` · ${((grabacion.largoM || 0) / 1000).toFixed(1)} km`}
              </Text>
              <Pressable disabled={mandandoGrabacion}
                style={[s.botonAncho, { backgroundColor: C.verde, marginTop: 10 }]}
                onPress={terminarYMandar}>
                <Text style={s.botonAnchoTexto}>
                  {mandandoGrabacion ? 'ENVIANDO…' : grabacion.parada ? 'ENVIAR' : 'TERMINAR Y ENVIAR'}
                </Text>
              </Pressable>
              <Pressable onPress={() => gps.descartarGrabacion().then(() => setGrabacion(null))}
                style={s.tipoSosCerrar}>
                <Text style={s.tipoSosCerrarTexto}>Descartar la grabación</Text>
              </Pressable>
            </>)}
          </>)}
        </ScrollView>
      </View>
    </Modal>
  );
}

// El deslizar genérico: la misma mecánica que el SOS (nadie te roba el dedo,
// hay que llegar casi al final) para el gesto de salir a ruta — deliberado,
// no un toque al pasar.
function Deslizable({ texto, textoBoton, colorListo, onDisparar }) {
  const { s } = usarTema();
  const [ancho, setAncho] = React.useState(0);
  const x = React.useRef(new Animated.Value(0)).current;
  const recorrido = Math.max(0, ancho - 78);

  const pan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      x.setValue(Math.max(0, Math.min(g.dx, recorrido)));
    },
    onPanResponderRelease: (_, g) => {
      if (recorrido > 0 && g.dx >= recorrido * 0.85) {
        Vibration.vibrate(120);
        Animated.timing(x, { toValue: recorrido, duration: 120, useNativeDriver: false }).start();
        onDisparar?.();
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  }), [recorrido]);

  return (
    <View style={s.sosPista} onLayout={e => setAncho(e.nativeEvent.layout.width)}>
      <Text style={s.sosTexto}>{texto}</Text>
      <Animated.View {...pan.panHandlers}
        style={[s.sosBoton, { backgroundColor: colorListo }, { transform: [{ translateX: x }] }]}>
        <Text style={s.sosBotonTexto}>{textoBoton}</Text>
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// El mapa: un Leaflet adentro de un WebView.
//
// NO es `react-native-maps`. Ese usa Google Maps y en Android **exige una
// clave de Google Cloud compilada en el APK** —cuenta, tarjeta, consola—, o
// sea un trámite antes de poder ver un solo punto y una app nueva para toda
// la flota si la clave rota. Leaflet usa las MISMAS tiles que los tres
// paneles web de este proyecto (la clave viene del servidor, con el login),
// así que la ruta se ve igual en el celular del chofer que en Despacho.
//
// Tres decisiones que sostienen el resto:
//
// 1. La página se arma UNA vez y después solo se le mandan datos por
//    `postMessage`. Recargarla en cada estado —cada 3 segundos— tiraría el
//    zoom y el desplazamiento que el chofer acaba de hacer con el dedo.
// 2. Solo se manda mientras el mapa está a la vista. Con la app en la ruta o
//    en el chat, empujar una vista cada 3 s es trabajo puro para nada, y esta
//    app se mide por batería.
// 3. El WebView se queda montado igual, sin recargar: volver al mapa y
//    esperar a que carguen Leaflet y las tiles de nuevo, cada vez, lo haría
//    inútil justo cuando se lo necesita rápido.
//
// Qué se dibuja está en `mapa.js`, que es JS puro y se prueba en Node. Acá
// solo se le pasa el papel.
function Mapa({ estado, geometria, yo, activo, pantalla, noLeidos, presencia, onIr }) {
  const { s, C, oscuro } = usarTema();
  const margen = margenes(useSafeAreaInsets(), { conBarra: true });
  const web = React.useRef(null);
  const [siguiendo, setSiguiendo] = React.useState(true);

  // ── El mapa arranca BLOQUEADO ───────────────────────────────
  //
  // Un WebView se queda con el dedo: mientras esté escuchando, arrastrar
  // sobre el mapa lo mueve a él y NO cambia de pantalla. O sea que el mapa se
  // volvía una trampa — se entraba y no se salía deslizando.
  //
  // Así que por defecto va una capa transparente encima: el dedo nunca llega
  // al WebView, el carrusel lo recibe, y deslizar funciona igual que en las
  // otras dos pantallas. Un toque levanta la capa y ahí sí el mapa se arrastra
  // y se hace zoom. Sale del prototipo viejo, donde ya estaba resuelto así.
  //
  // Y se vuelve a bloquear solo al salir de la pantalla: si quedara suelto, el
  // chofer volvería al mapa una hora después y el deslizamiento no le
  // respondería, sin ninguna pista de por qué.
  const [suelto, setSuelto] = React.useState(false);
  React.useEffect(() => { if (!activo) setSuelto(false); }, [activo]);

  // Bloquear es volver al automático. Si no, el mapa queda congelado donde el
  // chofer lo dejó y la combi se le va de la pantalla sin que él pueda
  // arrastrarlo — porque acaba de bloquearlo.
  const bloquear = React.useCallback(() => {
    setSuelto(false);
    mandar({ tipo: 'centrar', vista: vistaAhora() });
  }, [mandar, vistaAhora]);

  // Con el mapa suelto, el botón ATRÁS de Android bloquea el mapa — no saca
  // de la app. Es lo que la mano hace sola: "terminé de mirar, atrás". Este
  // manejador se registra recién al soltar el mapa, así que es más nuevo que
  // el de navegación de la app y Android le pregunta primero a él.
  React.useEffect(() => {
    if (!suelto || !activo) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      bloquear();
      return true;
    });
    return () => sub.remove();
  }, [suelto, activo, bloquear]);

  // La página NO depende del tema y se arma una sola vez. Los colores entran
  // después, por mensaje. Antes se armaba con la paleta del momento, así que
  // al pasar a modo noche —a las 18:30, en plena vuelta— cambiaba el `source`
  // y el WebView SE RECARGABA ENTERO: adiós al zoom y al desplazamiento que
  // el chofer tenía puestos, y a esperar las tiles de nuevo.
  const pagina = React.useMemo(() => mapa.html(), []);

  const mandar = React.useCallback((obj) => {
    try { web.current?.postMessage(JSON.stringify(obj)); } catch {}
  }, []);

  // Lo que le llega a la página ANTES de que termine de cargar se pierde: no
  // hay nadie escuchando todavía. Por eso ella avisa cuando está lista y
  // recién entonces se le manda todo. Sin este saludo, el mapa arrancaba con
  // los colores de día aunque fuera de noche.
  const [listo, setListo] = React.useState(false);
  // Fuera de ruta el WebView se DESMONTA. Si `listo` quedara en true, al
  // volver los mensajes saldrían hacia una página a medio cargar y se
  // perderían — el mismo bug del handshake que ya se pagó una vez.
  React.useEffect(() => { if (presencia === 'fuera') setListo(false); }, [presencia]);

  const vistaAhora = React.useCallback(
    () => mapa.vista(estado, yo, geometria), [estado, yo, geometria]);

  React.useEffect(() => {
    if (!listo) return;
    mandar({ tipo: 'tema', oscuro, colores: mapa.coloresDe(C) });
  }, [listo, oscuro, C, mandar]);

  // La clave de las tiles y las zonas con mapa propio vienen del login (el
  // servidor tiene la clave en una variable de entorno; en la app no hay
  // ninguna compilada). Con las zonas y el servidor, el WebView arma la
  // cascada: mapa propio adentro del bbox, proveedor solo de excepción.
  // Sin nada de esto el fondo queda liso — puntos y trazado se dibujan igual.
  const tilesKey = yo?.tilesKey || null;
  React.useEffect(() => {
    if (!listo || !tilesKey) return;
    mandar({ tipo: 'tiles', clave: tilesKey, zonas: yo?.tilesZonas || {}, servidor: SERVIDOR });
  }, [listo, tilesKey, mandar]);

  React.useEffect(() => {
    if (!listo || !activo) return;
    mandar({ tipo: 'vista', vista: vistaAhora() });
  }, [listo, activo, vistaAhora, mandar]);

  // Fuera de ruta el mapa está vedado: es el mapa DE LA RUTA, de los que
  // están trabajando. Además el WebView ni se monta — sin señal emitida no
  // hay nada que mirar, y las tiles gastan datos.
  if (presencia === 'fuera') {
    return (
      <View style={[s.pantalla, margen]}>
        <StatusBar style="light" />
        <View style={s.centro}>
          <Text style={s.ladoEtiquetaSec}>EL MAPA ES DE LA RUTA</Text>
          <Text style={[s.instruccion, { marginTop: 12 }]}>
            Salí a ruta para verlo. Desde acá podés chatear con el grupo y
            con Despacho mientras tanto.
          </Text>
        </View>
        <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
      </View>
    );
  }

  return (
    <View style={[s.pantalla, margen, { paddingLeft: 0, paddingRight: 0 }]}>
      <StatusBar style="light" />
      <View style={s.mapaCaja}>
        <WebView
          ref={web}
          source={{ html: pagina, baseUrl: 'https://localhost' }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: C.fondo }}
          javaScriptEnabled
          domStorageEnabled
          // Sin esto el WebView tira las tiles al perder el foco y hay que
          // bajarlas de nuevo cada vez que se vuelve al mapa.
          cacheEnabled
          // SIN androidLayerType="hardware", y es a propósito. Un WebView en
          // Android dibuja en su propia superficie nativa, y con layerType
          // hardware esa superficie NO sigue a tiempo el translateX del
          // carrusel (que corre en el hilo nativo): al deslizar quedaba un
          // rectángulo del color del fondo donde el mapa todavía no se había
          // re-pintado. Con el layerType por defecto, el WebView se compone
          // con la jerarquía y se mueve con ella.
          onMessage={(e) => {
            // Solo los mensajes que traen `seguir` tocan el botón: leer
            // cualquier mensaje como "el chofer movió el mapa" hacía aparecer
            // CENTRARME de la nada.
            try {
              const m = JSON.parse(e.nativeEvent.data);
              if (m.listo) setListo(true);
              if ('seguir' in m) setSiguiendo(!!m.seguir);
              // La página reporta cada 25 tiles de dónde salió cada una:
              // es la evidencia de que el proveedor es la excepción.
              if (m.estadisticaTiles) console.log('[tiles]', m.estadisticaTiles);
            } catch {}
          }}
          startInLoadingState
          renderLoading={() => <ActivityIndicator color={C.brillante} />}
        />
        {/* La capa que le saca el dedo al WebView. Va DESPUÉS del mapa y
            ANTES de los botones, así ella tapa el mapa pero los botones la
            tapan a ella. */}
        {!suelto && (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSuelto(true)}>
            <View style={s.pistaMapa} pointerEvents="none">
              <Text style={s.pistaMapaTexto}>TOCÁ PARA MOVER EL MAPA</Text>
            </View>
          </Pressable>
        )}

        {/* Con el mapa suelto, deslizar ya no cambia de pantalla: hay que
            devolverle el dedo al carrusel. El botón lo dice con todas las
            letras en vez de dejarlo adivinar. */}
        {suelto && (
          <Pressable style={s.soltar} onPress={bloquear}>
            <Text style={s.soltarTexto}>LISTO</Text>
          </Pressable>
        )}

        {/* Aparece cuando el chofer movió el mapa con el dedo. Sin esto,
            volver a encontrarse a uno mismo obliga a buscarse a ojo. */}
        {!siguiendo && (
          <Pressable style={s.centrar}
            onPress={() => mandar({ tipo: 'centrar', vista: vistaAhora() })}>
            <Text style={s.centrarTexto}>CENTRARME</Text>
          </Pressable>
        )}
      </View>
      <View style={{ paddingHorizontal: 22 }}>
        <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// El escudo de la cooperativa: su logo, o sus iniciales sobre su color.
//
// NUNCA un hueco. Con varias cooperativas en el mismo sistema, una pantalla
// sin marca no se distingue de la de al lado: el chofer no sabe si se
// equivocó de cuenta ni a quién reclamarle. Y un cuadro vacío se lee como que
// la app está rota, mientras que dos letras se leen como "todavía no subieron
// el logo" — que es la verdad, y funciona desde el primer día.
function Marca({ marca, tam = 26 }) {
  const { s, C } = usarTema();
  if (marca?.logo) {
    return <Image source={{ uri: marca.logo }} resizeMode="contain"
      style={[s.marca, { width: tam, height: tam, backgroundColor: '#fff' }]} />;
  }
  return (
    <View style={[s.marca, { width: tam, height: tam,
                             backgroundColor: marca?.color || C.marca }]}>
      <Text style={[s.marcaTexto, { fontSize: Math.round(tam * 0.42) }]}>
        {marca?.iniciales || '·'}
      </Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Día / noche / automático. El automático va primero porque es el que hay que
// preferir: el chofer no debería tener que acordarse justo cuando se está
// haciendo de noche y tiene las dos manos ocupadas. El manual existe porque
// un túnel, una tormenta o un parabrisas polarizado no los sabe el reloj.
function BotonTema() {
  const { s, modo, alternar } = usarTema();
  return (
    <Pressable onPress={alternar} hitSlop={10}>
      <Text style={s.chipTema}>{ETIQUETA[modo]}</Text>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════
// El botón de pánico. Se DESLIZA y no se toca: un botón de emergencia que
// se dispara con un roce es peor que no tenerlo — el celular va en un
// soporte, en una combi que se mueve, y un falso SOS que moviliza gente
// quema la confianza en el sistema entero.
function SosDeslizable({ onDisparar }) {
  const { s, C } = usarTema();
  const [ancho, setAncho] = React.useState(0);
  const [disparado, setDisparado] = React.useState(false);
  const x = React.useRef(new Animated.Value(0)).current;
  const recorrido = Math.max(0, ancho - 78);

  const pan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disparado,
    onMoveShouldSetPanResponder: () => !disparado,
    // Una vez que el dedo está en el botón, NADIE se lo lleva. Desde que la
    // pantalla también se desliza en horizontal para cambiar de pantalla,
    // esta línea es lo que impide que un pedido de ayuda a medio hacer se
    // convierta en un cambio de pantalla — o, peor, que el chofer crea que
    // pidió ayuda y no la haya pedido. Ver `gestos.js`.
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      x.setValue(Math.max(0, Math.min(g.dx, recorrido)));
    },
    onPanResponderRelease: (_, g) => {
      // Tiene que llegar casi al final. Un 85 % perdona el último tramo,
      // que es donde el dedo se frena solo, sin volverlo disparable de refilón.
      if (recorrido > 0 && g.dx >= recorrido * 0.85) {
        setDisparado(true);
        Vibration.vibrate(400);
        onDisparar?.();
        Animated.timing(x, { toValue: recorrido, duration: 120, useNativeDriver: false }).start();
        // Vuelve solo pasado un rato: que quede la marca de que se mandó,
        // pero que no quede trabado para siempre si hace falta repetirlo.
        setTimeout(() => {
          setDisparado(false);
          Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: false }).start();
        }, 6000);
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  }), [recorrido, disparado]);

  return (
    <View style={s.sosPista} onLayout={e => setAncho(e.nativeEvent.layout.width)}>
      <Text style={s.sosTexto}>
        {disparado ? 'ALERTA ENVIADA' : 'DESLIZÁ PARA SOS  →'}
      </Text>
      <Animated.View {...pan.panHandlers}
        style={[s.sosBoton, { transform: [{ translateX: x }] },
                disparado && { backgroundColor: C.verde }]}>
        <Text style={s.sosBotonTexto}>{disparado ? '✓' : 'SOS'}</Text>
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
function Barra({ pantalla, noLeidos, onIr }) {
  const { s, C } = usarTema();
  const total = (noLeidos?.grupo || 0) + (noLeidos?.directo || 0);
  // Acá está el bug que se midió: sin este margen, estos botones quedan
  // DEBAJO de los de Android y hay que insistir para tocarlos. Ver
  // `margenes.js` — un elemento que se toca necesita más aire que un texto.
  return (
    <View style={[s.barraAbajo, margenBarra(useSafeAreaInsets())]}>
      {/* El tema se cambia desde acá y no desde la pantalla de la brecha:
          esta barra está en las TRES, y si se hace de noche mientras el
          chofer mira el mapa tiene que poder apagarlo sin volver. */}
      <BotonTema />
      {[['mapa', 'MAPA', 0], ['ruta', 'RUTA', 0], ['chat', 'CHAT', total]].map(([id, texto, badge]) => (
        <Pressable key={id} onPress={() => onIr(id)} style={s.tab}>
          <Text style={[s.tabTexto, pantalla === id && { color: C.brillante }]}>{texto}</Text>
          {badge > 0 && <View style={s.badge}><Text style={s.badgeTexto}>{badge}</Text></View>}
        </Pressable>
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// El chat, con sus DOS canales. El grupo lo ven todos los de la ruta; el
// directo, solo este chofer y Despacho. Chofer ↔ chofer privado no existe y
// eso lo decide el servidor, no esta pantalla.
function Chat({ mensajes, canal, noLeidos, conectado, pantalla, onCanal, onEnviar, onVoz, onFoto, onIr }) {
  const { s, C } = usarTema();
  const [texto, setTexto] = React.useState('');
  const [verFoto, setVerFoto] = React.useState(null);
  const lista = React.useRef(null);
  const insets = useSafeAreaInsets();
  const margen = margenes(insets, { conBarra: true });
  const alto = useTeclado(insets.bottom);

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    onEnviar(t);
    setTexto('');
  };

  // `paddingBottom` y no `KeyboardAvoidingView`: en Android ese componente sin
  // `behavior` no hace NADA, y la parte que sí resolvía el sistema
  // —achicar la ventana— no ocurre con edge-to-edge. Ver `teclado.js`.
  return (
    <View style={[s.pantalla, margen, { paddingBottom: alto }]}>
      <StatusBar style="light" />

      <View style={s.canales}>
        {[['grupo', 'RUTA'], ['directo', 'DESPACHO']].map(([id, texto]) => (
          <Pressable key={id} onPress={() => onCanal(id)}
            style={[s.canal, canal === id && s.canalActivo]}>
            <Text style={[s.canalTexto, canal === id && { color: '#fff' }]}>{texto}</Text>
            {noLeidos?.[id] > 0 && canal !== id && (
              <View style={s.badge}><Text style={s.badgeTexto}>{noLeidos[id]}</Text></View>
            )}
          </Pressable>
        ))}
      </View>

      <FlatList
        ref={lista}
        style={{ flex: 1 }}
        data={mensajes}
        keyExtractor={m => m.id}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={s.vacio}>
            {canal === 'grupo'
              ? 'Todavía no hay mensajes en el canal de la ruta.'
              : 'Acá hablás solo con Despacho. Nadie más lo ve.'}
          </Text>
        }
        renderItem={({ item: m }) => (
          <View style={[s.burbuja,
            m.propio && s.burbujaPropia,
            m.tono === 'sos' && s.burbujaSos,
            m.tono === 'despacho' && s.burbujaDespacho]}>
            <Text style={s.burbujaQuien}>
              {m.quien}{m.unidad ? ` · ${m.unidad}` : ''} · {m.hora}
            </Text>
            {m.audio && <Reproducir uri={m.audio} etiqueta={m.texto} />}
            {m.imagen && (
              // Tocarla la abre entera: en la burbuja entra chica, y lo que
              // se manda —una chapa, un desperfecto— hay que poder mirarlo.
              <Pressable onPress={() => setVerFoto(m.imagen)}>
                <Image source={{ uri: m.imagen }} style={s.miniatura} resizeMode="cover" />
              </Pressable>
            )}
            {/* Una foto sin imagen ya expiró en el servidor: la burbuja se
                queda, con su pie, para que se sepa que existió. */}
            {m.tono === 'foto' && !m.imagen && <Text style={s.expirada}>Foto ya no disponible</Text>}
            {!m.audio && <Text style={s.burbujaTexto}>{m.texto}</Text>}
          </View>
        )}
      />

      <View style={s.escribir}>
        <TextInput
          style={s.campoChat}
          value={texto}
          onChangeText={setTexto}
          placeholder={canal === 'grupo' ? 'Mensaje a la ruta…' : 'Mensaje a Despacho…'}
          placeholderTextColor={C.tenue}
          multiline
          maxLength={500}
          onSubmitEditing={enviar}
        />
        {texto.trim()
          ? <Pressable onPress={enviar} disabled={!conectado}
              style={[s.enviar, !conectado && { opacity: 0.4 }]}>
              <Text style={s.enviarTexto}>➤</Text>
            </Pressable>
          : <>
              <Camara onListo={onFoto} habilitado={conectado} />
              <Grabar onListo={onVoz} habilitado={conectado} />
            </>}
      </View>
      {!conectado && <Text style={s.avisoBarra}>Sin conexión — lo que escribas no va a salir</Text>}

      <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />

      {/* El visor. A pantalla completa y con fondo negro: una foto de la
          calle en una burbuja de 200 px no sirve para decidir nada. */}
      <Modal visible={!!verFoto} transparent animationType="fade"
             onRequestClose={() => setVerFoto(null)}>
        <Pressable style={s.visor} onPress={() => setVerFoto(null)}>
          {verFoto && <Image source={{ uri: verFoto }} style={s.visorFoto} resizeMode="contain" />}
          <Text style={s.visorPie}>Tocá para cerrar</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

// Cuánto levantar la pantalla mientras está el teclado.
//
// Se escuchan los eventos `...DidShow` / `...DidHide` y NO los `...Will`: los
// `Will` solo existen en iOS, y acá el problema es de Android.
function useTeclado(insetAbajo) {
  const [alto, setAlto] = React.useState(0);
  const { alto: altoVentana } = useVentana();

  React.useEffect(() => {
    const abrir = Keyboard.addListener('keyboardDidShow', (e) => {
      setAlto(levantar(e?.endCoordinates?.height, { insetAbajo, altoVentana }));
    });
    const cerrar = Keyboard.addListener('keyboardDidHide', () => setAlto(0));
    return () => { abrir.remove(); cerrar.remove(); };
  }, [insetAbajo, altoVentana]);

  return alto;
}

// ═══════════════════════════════════════════════════════════════
// La foto. Un toque abre la cámara; mantener apretado abre la galería —para
// mandar algo que ya se sacó sin ocupar otro botón en una fila que ya está
// llena.
//
// Se achica ANTES de salir, en `foto.js`. Acá solo se avisa cuánto pesó: en
// una ruta con datos prepago eso no es un detalle de nerd, y es la diferencia
// entre que el chofer use esto o lo apague.
function Camara({ onListo, habilitado }) {
  const { s } = usarTema();
  const [ocupado, setOcupado] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);

  const correr = async (fn) => {
    if (ocupado || !habilitado) return;
    setOcupado(true); setAviso(null);
    try {
      const r = await fn();
      if (!r) return;                              // canceló
      if (r.error) { setAviso(r.error); return; }
      onListo?.(r.dataUrl);
      setAviso(comoTexto(r.bytes));
      setTimeout(() => setAviso(null), 3000);
    } catch (e) {
      setAviso('No se pudo usar la cámara');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <View>
      <Pressable onPress={() => correr(tomarFoto)} onLongPress={() => correr(elegirFoto)}
        disabled={!habilitado || ocupado}
        style={[s.camara, (!habilitado || ocupado) && { opacity: 0.4 }]}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.camaraTexto}>📷</Text>}
      </Pressable>
      {aviso && <Text style={s.camaraAviso}>{aviso}</Text>}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// Se graba MANTENIENDO APRETADO y se suelta para mandar, como en WhatsApp.
// No es imitación: el chofer tiene una mano en el volante, y mantener es un
// gesto que no pide precisión ni mirar la pantalla. Soltar sin llegar al
// segundo cancela, que es la salida para el toque sin querer.
function Grabar({ onListo, habilitado }) {
  const { s } = usarTema();
  const grabador = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [grabando, setGrabando] = React.useState(false);
  const [segundos, setSegundos] = React.useState(0);
  const [error, setError] = React.useState(null);
  const desdeRef = React.useRef(0);

  const soltar = React.useCallback(async (cancelar = false) => {
    setGrabando(false);
    const dur = Math.round((Date.now() - desdeRef.current) / 1000);
    try {
      await grabador.stop();
      // Menos de un segundo es un toque sin querer, no una nota.
      if (cancelar || dur < 1 || !grabador.uri) return;
      const motivo = onListo?.(await aDataUrl(grabador.uri), dur);
      if (motivo) setError(motivo === 'muy-larga' ? 'La nota pesa demasiado' : 'No se pudo enviar');
    } catch (e) { setError('No se pudo enviar'); }
  }, [grabador, onListo]);

  React.useEffect(() => {
    if (!grabando) return;
    const t = setInterval(() => {
      const s = Math.round((Date.now() - desdeRef.current) / 1000);
      setSegundos(s);
      if (s >= MAX_SEGUNDOS) soltar();   // se corta sola en el tope
    }, 500);
    return () => clearInterval(t);
  }, [grabando, soltar]);

  const empezar = async () => {
    setError(null);
    if (!habilitado) return;
    if (!(await pedirPermisoMicrofono())) { setError('Sin permiso de micrófono'); return; }
    try {
      await grabador.prepareToRecordAsync();
      grabador.record();
      desdeRef.current = Date.now();
      setSegundos(0);
      setGrabando(true);
      Vibration.vibrate(40);
    } catch (e) { setError('No se pudo grabar'); }
  };

  return (
    <View>
      {(grabando || error) && (
        <Text style={s.grabandoAviso}>
          {error || `● Grabando ${segundos}s — soltá para enviar`}
        </Text>
      )}
      <Pressable
        onPressIn={empezar}
        onPressOut={() => soltar(false)}
        disabled={!habilitado}
        style={[s.enviar, grabando && { backgroundColor: C.rojo },
                !habilitado && { opacity: 0.4 }]}>
        <Text style={s.enviarTexto}>{grabando ? '●' : '🎤'}</Text>
      </Pressable>
    </View>
  );
}

function Reproducir({ uri, etiqueta }) {
  const { s } = usarTema();
  const reproductor = useAudioPlayer({ uri });
  const [sonando, setSonando] = React.useState(false);
  return (
    <Pressable
      onPress={() => {
        if (sonando) { reproductor.pause(); setSonando(false); return; }
        reproductor.seekTo(0);
        reproductor.play();
        setSonando(true);
      }}
      style={s.reproducir}>
      <Text style={s.reproducirIcono}>{sonando ? '❚❚' : '▶'}</Text>
      <Text style={s.burbujaTexto}>{etiqueta}</Text>
    </Pressable>
  );
}

function crearEstilos(C) { return StyleSheet.create({
  // SIN padding: lo pone `margenes()` en cada pantalla, porque depende de
  // dónde terminan las barras de Android y eso cambia por teléfono. Un
  // número fijo acá fue lo que dejó el botón de CHAT debajo de los botones
  // del sistema. Ver `margenes.js`.
  pantalla: { flex: 1, backgroundColor: C.fondo },
  tituloChico: { fontFamily: 'monospace', fontSize: 12, letterSpacing: 2, color: C.cielo, textAlign: 'center' },
  subtitulo: { fontSize: 14, color: C.tenue, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  rotulo: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.5, color: C.cielo, marginTop: 14 },
  campo: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea, borderRadius: 10,
    color: C.blanco, fontSize: 18, padding: 14, marginTop: 6,
  },
  error: { color: C.rojo, fontSize: 13, fontWeight: '700', marginTop: 14 },
  boton: { backgroundColor: C.brillante, borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 26 },
  botonTexto: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 2 },
  pie: { color: C.tenue, fontSize: 11, textAlign: 'center', marginTop: 20, fontFamily: 'monospace' },

  barra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  salir: { color: C.tenue, fontSize: 14, fontWeight: '700' },
  avisoBarra: { color: C.ambar, fontSize: 13, marginTop: 10 },
  diagnostico: { color: C.tenue, fontSize: 11, fontFamily: 'monospace', marginTop: 8 },

  centro: { flex: 1, justifyContent: 'center' },
  filaRotulo: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  ladoEtiqueta: { fontSize: 19, fontWeight: '900', letterSpacing: 1 },
  ladoEtiquetaSec: { fontSize: 17, fontWeight: '900', color: '#A9C0D6' },
  ladoUnidad: { fontSize: 15, fontWeight: '700', color: C.tenue },
  digitos: { fontSize: 108, fontWeight: '900', letterSpacing: -5, lineHeight: 118 },
  digitosSec: { fontSize: 58, fontWeight: '900', letterSpacing: -2 },
  instruccion: { fontSize: 16, color: '#93AAC2', marginTop: 10, lineHeight: 24 },
  divisor: { height: 1, backgroundColor: C.linea, marginVertical: 24 },

  // ── SOS ──────────────────────────────────────────────────────
  sosPista: {
    height: 62, borderRadius: 16, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.linea,
    justifyContent: 'center', marginTop: 10, overflow: 'hidden',
  },
  sosTexto: {
    position: 'absolute', alignSelf: 'center',
    color: C.tenue, fontSize: 15, fontWeight: '700', letterSpacing: 1,
  },
  sosBoton: {
    width: 70, height: 54, margin: 4, borderRadius: 12,
    backgroundColor: C.rojo, alignItems: 'center', justifyContent: 'center',
  },
  sosBotonTexto: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  // El "¿qué pasó?" de después del SOS. Botones grandes: se tocan con el
  // pulgar, posiblemente arriba de la combi y con apuro.
  tipoSosCaja: {
    borderRadius: 16, borderWidth: 1, borderColor: C.rojo,
    backgroundColor: C.panel, padding: 12, marginTop: 10,
  },
  tipoSosTitulo: {
    color: C.rojo, fontSize: 13, fontWeight: '900', letterSpacing: 1,
    textAlign: 'center',
  },
  filaTipoSos: { flexDirection: 'row', gap: 8, marginTop: 10 },
  botonTipoSos: {
    flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: C.linea,
    backgroundColor: C.fondo, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, paddingVertical: 8,
  },
  botonTipoSosTexto: {
    color: C.brillante, fontSize: 12, fontWeight: '900', letterSpacing: 0.5,
    textAlign: 'center',
  },
  tipoSosCerrar: { alignSelf: 'center', marginTop: 10, padding: 4 },
  tipoSosCerrarTexto: { color: C.tenue, fontSize: 12 },

  // ── Perfil ───────────────────────────────────────────────────
  perfilGrilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  perfilTarjeta: {
    flexBasis: '30%', flexGrow: 1, borderRadius: 12, padding: 12,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea,
  },
  perfilEtiqueta: { color: C.tenue, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  perfilValor: { color: C.brillante, fontSize: 22, fontWeight: '900', marginTop: 4 },
  perfilSeccion: { color: C.tenue, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  // Un cobrador de la combi: quién es arriba, sus horas y sus botones abajo
  cobradorFila: {
    borderRadius: 12, padding: 12, marginTop: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea,
  },
  cobradorNombre: { color: C.brillante, fontSize: 15, fontWeight: '900' },
  cobradorDato: { color: C.tenue, fontSize: 12, marginTop: 3 },
  cobradorBotones: { flexDirection: 'row', gap: 8, marginTop: 10 },
  cobradorBoton: {
    flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.linea,
    backgroundColor: C.fondo, alignItems: 'center', justifyContent: 'center',
  },
  cobradorBotonTexto: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },

  // ── Presencia ────────────────────────────────────────────────
  filaPresencia: { flexDirection: 'row', gap: 10, marginTop: 12 },
  botonPresencia: {
    flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: C.linea,
    backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center',
  },
  botonPresenciaTexto: { color: C.tenue, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  botonAncho: {
    height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    marginTop: 26,
  },
  botonAnchoTexto: { color: '#08131F', fontSize: 17, fontWeight: '900', letterSpacing: 1.5 },

  // ── Mapa ─────────────────────────────────────────────────────
  mapaCaja: { flex: 1, overflow: 'hidden' },
  // La pista va ABAJO y no en el centro: en el centro tapa justo la zona
  // donde el chofer se está buscando a sí mismo.
  pistaMapa: {
    position: 'absolute', bottom: 16, alignSelf: 'center',
    backgroundColor: C.panel + 'E6', borderWidth: 1, borderColor: C.linea,
    borderRadius: 100, paddingVertical: 7, paddingHorizontal: 16,
  },
  pistaMapaTexto: {
    fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.5, color: C.cielo,
  },
  soltar: {
    position: 'absolute', top: 12, right: 16,
    backgroundColor: C.brillante, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  soltarTexto: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  centrar: {
    position: 'absolute', right: 16, bottom: 16,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  centrarTexto: { color: C.cielo, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },

  // ── Marca de la cooperativa ──────────────────────────────────
  marca: { borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  marcaTexto: { color: '#fff', fontWeight: '900', letterSpacing: 0.5 },

  // ── Entrar / tema ────────────────────────────────────────────
  campoConBoton: {
    flexDirection: 'row', alignItems: 'center', marginTop: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea, borderRadius: 10,
  },
  campoSinBorde: { flex: 1, marginTop: 0, borderWidth: 0, backgroundColor: 'transparent' },
  ojo: { paddingHorizontal: 14, paddingVertical: 14 },
  ojoTexto: { color: C.cielo, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  chipTema: {
    fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.5, color: C.tenue,
    borderWidth: 1, borderColor: C.linea, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },

  // ── Foto ─────────────────────────────────────────────────────
  camara: {
    width: 50, height: 50, borderRadius: 12, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.linea,
    alignItems: 'center', justifyContent: 'center',
  },
  camaraTexto: { fontSize: 22 },
  // Cuánto pesó. En una ruta con datos prepago no es un detalle de nerd.
  camaraAviso: {
    position: 'absolute', bottom: 54, right: 0, width: 120, textAlign: 'right',
    color: C.tenue, fontSize: 11,
  },
  miniatura: {
    width: 200, height: 150, borderRadius: 10, marginTop: 6,
    backgroundColor: C.fondo,
  },
  expirada: { color: C.tenue, fontSize: 13, fontStyle: 'italic', marginTop: 4 },
  visor: {
    flex: 1, backgroundColor: '#000000EE',
    alignItems: 'center', justifyContent: 'center',
  },
  visorFoto: { width: '100%', height: '85%' },
  visorPie: { color: C.tenue, fontSize: 13, marginTop: 10 },

  // ── Navegación ───────────────────────────────────────────────
  barraAbajo: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: C.linea,
    marginTop: 12, paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  tabTexto: { color: C.tenue, fontSize: 15, fontWeight: '900', letterSpacing: 2 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: C.brillante, alignItems: 'center', justifyContent: 'center',
  },
  badgeTexto: { color: '#fff', fontSize: 11, fontWeight: '900' },

  // ── Chat ─────────────────────────────────────────────────────
  canales: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  canal: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  canalActivo: { backgroundColor: C.brillante, borderColor: C.brillante },
  canalTexto: { color: C.tenue, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  vacio: { color: C.tenue, fontSize: 14, textAlign: 'center', marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
  burbuja: {
    backgroundColor: C.panel, borderRadius: 12, padding: 11,
    marginBottom: 8, maxWidth: '88%', alignSelf: 'flex-start',
  },
  burbujaPropia: { alignSelf: 'flex-end', backgroundColor: '#1D598F' },
  burbujaDespacho: { borderLeftWidth: 3, borderLeftColor: C.brillante },
  burbujaSos: { backgroundColor: '#4A0D1B', borderLeftWidth: 3, borderLeftColor: C.rojo },
  burbujaQuien: {
    fontFamily: 'monospace', fontSize: 10, letterSpacing: 1,
    color: C.cielo, marginBottom: 3,
  },
  burbujaTexto: { color: C.blanco, fontSize: 15, lineHeight: 21 },
  escribir: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  campoChat: {
    flex: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.linea,
    borderRadius: 12, color: C.blanco, fontSize: 16, padding: 12, maxHeight: 110,
  },
  enviar: {
    width: 50, height: 50, borderRadius: 12, backgroundColor: C.brillante,
    alignItems: 'center', justifyContent: 'center',
  },
  enviarTexto: { color: '#fff', fontSize: 20 },
  grabandoAviso: {
    color: C.ambar, fontSize: 12, fontWeight: '700',
    position: 'absolute', bottom: 56, right: 0, width: 220, textAlign: 'right',
  },
  reproducir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reproducirIcono: {
    color: '#fff', fontSize: 13, width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.brillante, textAlign: 'center', lineHeight: 30,
  },
}); }
