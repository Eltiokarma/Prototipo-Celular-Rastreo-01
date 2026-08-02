// La app del chofer. Corte vertical: entrar → brecha en vivo → GPS en
// segundo plano con la brecha en la notificación.
//
// Falta a propósito el mapa, el chat y el SOS. No es que se hayan olvidado:
// esto existe para contestar la única pregunta que ninguna pantalla contesta
// —si el celular aguanta un turno con el GPS prendido a 3800 m y si Android
// deja vivo el servicio— y para eso alcanza con esto. Lo demás es portar
// interfaz que ya funciona en la web.
//
// Lo que decide qué se ve NO está acá: está en `hud.js`, que es JavaScript
// puro y tiene su suite en `pruebas/hud.js`. Esta pantalla solo dibuja.

import React from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, AppState, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';

import { crearCliente } from './protocolo/cliente';
import { construirHud, textoNotificacion } from './hud';
import * as gps from './gps/servicio';

// Por defecto, el servidor que ya está en la nube: así la primera prueba en
// un teléfono no depende de la red de casa. Para pegarle a un servidor local
// hay que poner la IP de la máquina en la wifi — el celular NO resuelve
// "localhost", que para él es él mismo.
const SERVIDOR = process.env.EXPO_PUBLIC_SERVIDOR
  || 'https://prototipo-celular-rastreo-01-production.up.railway.app';

const C = {
  fondo: '#0A1A2E', panel: '#16304A', linea: '#234969',
  marca: '#2580CF', brillante: '#2E9DFF', cielo: '#71BCFF',
  tenue: '#5A7A99', blanco: '#F5F9FF',
  verde: '#3DD685', ambar: '#F5C542', rojo: '#FF4D6D',
};
const COLOR_ESTADO = { verde: C.verde, ambar: C.ambar, rojo: C.rojo, ninguno: C.tenue };

export default function App() {
  const [sesion, setSesion] = React.useState(null);
  const [hud, setHud] = React.useState(() => construirHud(null));
  const [conectado, setConectado] = React.useState(false);
  const [reporta, setReporta] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);
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
  const [diag, setDiag] = React.useState({ ...gps.diagnostico });
  React.useEffect(() => {
    if (!sesion) return;
    const t = setInterval(() => setDiag({ ...gps.diagnostico }), 2000);
    return () => clearInterval(t);
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
  // El texto va en un ref para que el oyente se suscriba UNA vez: si
  // dependiera del hud, se re-suscribiría con cada brecha nueva.
  const textoRef = React.useRef('Turno en curso');
  textoRef.current = textoNotificacion(hud, reporta);

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

  return <Ruta hud={hud} conectado={conectado} reporta={reporta} aviso={aviso}
    diag={diag}
    onSalir={async () => {
      await SecureStore.deleteItemAsync(gps.LLAVE_SESION);
      await gps.parar();
      cliente.current.salir();
      setSesion(null);
    }} />;
}

// ═══════════════════════════════════════════════════════════════
function Entrar({ servidor, aviso, onEntrar, clienteRef }) {
  const [usuario, setUsuario] = React.useState('');
  const [clave, setClave] = React.useState('');
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState(null);

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
    <View style={s.pantalla}>
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
function Ruta({ hud, conectado, reporta, aviso, diag, onSalir }) {
  const p = hud.principal, sec = hud.secundario;
  const color = COLOR_ESTADO[p.estado];

  return (
    <View style={s.pantalla}>
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
      <Text style={s.diagnostico}>
        GPS enviadas {diag.enviadas} · fallidas {diag.fallidas}
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
    </View>
  );
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.fondo, padding: 22, paddingTop: 56 },
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
});
