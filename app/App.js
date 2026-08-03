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
  FlatList, KeyboardAvoidingView, Platform, PanResponder, Animated, Vibration,
  Image, Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { crearCliente } from './protocolo/cliente';
import { construirHud, textoNotificacion } from './hud';
import { aMensaje, hilo, sinLeer } from './chat';
import { margenes, margenBarra } from './margenes';
import { deslizar, esHorizontal } from './gestos';
import { useAudioRecorder, useAudioPlayer, RecordingPresets,
         pedirPermisoMicrofono, aDataUrl, MAX_SEGUNDOS } from './voz';
import { tomarFoto, elegirFoto, comoTexto } from './foto';
import * as gps from './gps/servicio';

// Por defecto, el servidor que ya está en la nube: así la primera prueba en
// un teléfono no depende de la red de casa. Para pegarle a un servidor local
// hay que poner la IP de la máquina en la wifi — el celular NO resuelve
// "localhost", que para él es él mismo.
const SERVIDOR = process.env.EXPO_PUBLIC_SERVIDOR
  || 'https://prototipo-celular-rastreo-01-production.up.railway.app';

// La persona firma el mensaje; el vehículo define el canal privado. No son
// lo mismo y confundirlos rompe las dos cosas — ver PROTOCOLO.md.
const quienSoy = (c) => ({
  miPersona: c.sesion?.unitId || null,
  miVehiculo: c.sesion?.vehicleId || c.sesion?.unitId || null,
});

const C = {
  fondo: '#0A1A2E', panel: '#16304A', linea: '#234969',
  marca: '#2580CF', brillante: '#2E9DFF', cielo: '#71BCFF',
  tenue: '#5A7A99', blanco: '#F5F9FF',
  verde: '#3DD685', ambar: '#F5C542', rojo: '#FF4D6D',
};
const COLOR_ESTADO = { verde: C.verde, ambar: C.ambar, rojo: C.rojo, ninguno: C.tenue };

// `SafeAreaProvider` tiene que envolver TODO: es quien mide dónde terminan la
// barra de estado y la de navegación de Android, y sin él `useSafeAreaInsets`
// devuelve ceros. Con ceros el botón de CHAT vuelve a quedar debajo de los
// botones del sistema, que es el bug que se midió en un teléfono de verdad.
export default function App() {
  return (
    <SafeAreaProvider>
      <Aplicacion />
    </SafeAreaProvider>
  );
}

function Aplicacion() {
  const [sesion, setSesion] = React.useState(null);
  const [hud, setHud] = React.useState(() => construirHud(null));
  const [conectado, setConectado] = React.useState(false);
  const [reporta, setReporta] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);
  const [mensajes, setMensajes] = React.useState([]);
  const [pantalla, setPantalla] = React.useState('ruta');   // 'ruta' | 'chat'
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
      c.on('estado', () => setHud(construirHud(c.miBrecha()))),
      c.on('conexion', ({ conectado }) => setConectado(conectado)),
      c.on('rolGps', ({ reporta, motivo }) => { setReporta(reporta); setAviso(motivo); }),
      c.on('authError', (e) => { setAviso(e); setSesion(null); }),
      // El historial llega al identificarse y trae solo lo que a este chofer
      // le corresponde ver: el filtrado del privado lo hace el servidor.
      c.on('historial', (items) => setMensajes(items.map(m => aMensaje(m, quienSoy(c))))),
      c.on('chat', (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
      c.on('sos',  (m) => setMensajes(v => [...v, aMensaje(m, quienSoy(c))])),
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
    setSesion(s);
    // El servidor va al disco junto con la sesión porque la tarea de fondo
    // los lee de ahí: cuando Android la revive, no queda nada en memoria.
    await SecureStore.setItemAsync(gps.LLAVE_SERVIDOR, SERVIDOR);
    cliente.current.conectar(s.token);
    const permisos = await gps.pedirPermisos();
    if (!permisos.ok) { setAviso(`Falta el permiso de ubicación en ${permisos.cual}`); return; }
    await gps.arrancar({ textoNotificacion: 'Buscando tu posición…' });
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
  React.useEffect(() => {
    if (!sesion) return;
    let vivo = true;
    const mirar = async () => {
      const corriendo = await gps.estaCorriendo();
      if (!vivo) return;
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
  }, [sesion]);

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
    if (!sesion) return;
    const sub = AppState.addEventListener('change', (estado) => {
      const activo = estado === 'active';
      gps.cambiarCadencia(
        activo ? gps.CADENCIA_PANTALLA_ENCENDIDA : gps.CADENCIA_PANTALLA_APAGADA,
        textoRef.current,
      ).catch(() => {});
    });
    return () => sub.remove();
  }, [sesion]);

  // La notificación permanente lleva la brecha, pero solo se refresca cuando
  // la app pasa a segundo plano (arriba) — que es justo cuando el chofer va a
  // mirarla. Ponerla al día en vivo pide otro camino: una notificación
  // aparte con expo-notifications, para no tocar el servicio de ubicación.
  // Queda pendiente y anotado en el README.

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

  const comun = {
    conectado, aviso, diag, pantalla, noLeidos,
    onIr: irA,
    onSalir: async () => {
      await SecureStore.deleteItemAsync(gps.LLAVE_SESION);
      await gps.parar();
      cliente.current.salir();
      setSesion(null);
    },
  };

  if (pantalla === 'chat') {
    return <Chat {...comun}
      mensajes={hilo(mensajes, canal)}
      canal={canal}
      onCanal={(cual) => { setCanal(cual); marcarVisto(cual); }}
      onEnviar={(texto) => cliente.current.mandarChat(texto, { privado: canal === 'directo' })}
      onVoz={(data, duration) => cliente.current.mandarVoz({ data, duration, privado: canal === 'directo' })}
      onFoto={(data) => cliente.current.mandarFoto({ data, privado: canal === 'directo' })} />;
  }

  return <Ruta {...comun} hud={hud} reporta={reporta}
    onSos={() => cliente.current.mandarSos(ultimaPos.current)} />;
}

// ═══════════════════════════════════════════════════════════════
// Pasar de pantalla deslizando el dedo. La barra de abajo sigue estando: esto
// es el atajo, no el único camino.
//
// Se usa `onMoveShouldSetPanResponder` y NO la versión `...Capture`, y esa
// diferencia de una palabra es la que protege al SOS: sin capturar, el hijo
// reclama el gesto primero. El SOS es hijo de esta pantalla, también se
// desliza en horizontal, y si esta capa se lo robara el chofer creería que
// pidió ayuda sin haberla pedido. Ver `gestos.js`.
function useDeslizar(pantalla, onIr) {
  return React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,   // un toque no es asunto de esta capa
    onMoveShouldSetPanResponder: (_, g) => esHorizontal(g),
    onPanResponderRelease: (_, g) => {
      const destino = deslizar(pantalla, g);
      if (destino) onIr(destino);
    },
  }), [pantalla, onIr]);
}

// ═══════════════════════════════════════════════════════════════
function Entrar({ servidor, aviso, onEntrar, clienteRef }) {
  const [usuario, setUsuario] = React.useState('');
  const [clave, setClave] = React.useState('');
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
      <TextInput style={s.campo} value={clave} onChangeText={setClave}
        secureTextEntry placeholderTextColor={C.tenue} />

      {(error || aviso) && <Text style={s.error}>{error || aviso}</Text>}

      <Pressable style={[s.boton, cargando && { opacity: 0.6 }]} onPress={enviar} disabled={cargando}>
        {cargando ? <ActivityIndicator color="#fff" /> : <Text style={s.botonTexto}>INGRESAR</Text>}
      </Pressable>
      <Text style={s.pie}>{servidor}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
function Ruta({ hud, conectado, reporta, aviso, diag, pantalla, noLeidos, onIr, onSalir, onSos }) {
  const p = hud.principal, sec = hud.secundario;
  const color = COLOR_ESTADO[p.estado];
  // La pantalla termina en la barra de navegación de la app: el aire de abajo
  // lo pone ella, no ésta. Sumar los dos deja la línea divisoria flotando.
  const margen = margenes(useSafeAreaInsets(), { conBarra: true });
  const pan = useDeslizar(pantalla, onIr);

  return (
    <View style={[s.pantalla, margen]} {...pan.panHandlers}>
      <StatusBar style="light" />
      <View style={s.barra}>
        <Text style={[s.chip, { color: conectado ? C.verde : C.ambar }]}>
          {conectado ? '● EN VIVO' : '○ SIN CONEXIÓN'}
        </Text>
        <Pressable onPress={onSalir}><Text style={s.salir}>Salir</Text></Pressable>
      </View>

      {!reporta && aviso && <Text style={s.avisoBarra}>{aviso}</Text>}

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
          <Text style={[s.digitosSec, { color: COLOR_ESTADO[sec.estado] }]}>{sec.display}</Text>
        )}
      </View>

      <SosDeslizable onDisparar={onSos} />
      <Barra pantalla={pantalla} noLeidos={noLeidos} onIr={onIr} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// El botón de pánico. Se DESLIZA y no se toca: un botón de emergencia que
// se dispara con un roce es peor que no tenerlo — el celular va en un
// soporte, en una combi que se mueve, y un falso SOS que moviliza gente
// quema la confianza en el sistema entero.
function SosDeslizable({ onDisparar }) {
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
  const total = (noLeidos?.grupo || 0) + (noLeidos?.directo || 0);
  // Acá está el bug que se midió: sin este margen, estos botones quedan
  // DEBAJO de los de Android y hay que insistir para tocarlos. Ver
  // `margenes.js` — un elemento que se toca necesita más aire que un texto.
  return (
    <View style={[s.barraAbajo, margenBarra(useSafeAreaInsets())]}>
      {[['ruta', 'RUTA', 0], ['chat', 'CHAT', total]].map(([id, texto, badge]) => (
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
  const [texto, setTexto] = React.useState('');
  const [verFoto, setVerFoto] = React.useState(null);
  const lista = React.useRef(null);
  const margen = margenes(useSafeAreaInsets(), { conBarra: true });
  const pan = useDeslizar(pantalla, onIr);

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    onEnviar(t);
    setTexto('');
  };

  return (
    <KeyboardAvoidingView style={[s.pantalla, margen]} {...pan.panHandlers}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
    </KeyboardAvoidingView>
  );
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

const s = StyleSheet.create({
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
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.linea,
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
});
