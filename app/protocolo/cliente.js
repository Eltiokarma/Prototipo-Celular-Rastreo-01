// Cliente del protocolo COOP-R14.
//
// JavaScript puro: no importa nada de React Native, de Expo ni del navegador.
// Eso es a propósito y es lo que lo hace probable — corre igual en Node (que
// es donde lo prueba `pruebas/cliente.js`, contra el servidor de verdad) y
// adentro de la app nativa, donde `fetch` y `WebSocket` ya existen.
//
// La única dependencia del entorno es la clase WebSocket, que se inyecta:
// en Node viene de `ws`, en React Native es la global.
//
// El contrato que habla está en PROTOCOLO.md, verificado contra una corrida
// real. Lo que este módulo agrega arriba del protocolo pelado son las cuatro
// cosas que, si cada pantalla las resuelve por su cuenta, se resuelven mal:
//
//   1. `gps_role` como estado vivo — quién puede reportar posición cambia solo
//   2. brechas que respetan el null en vez de taparlo con un valor de relleno
//   3. un freno de cadencia para no quemar el cupo del servidor
//   4. reconexión con espera creciente, para no vaciar la batería en un túnel

'use strict';

const CUPO_GPS_POR_MINUTO = 35;    // el servidor corta en 40; se deja margen
const RECONEXION_BASE_MS = 3000;   // igual que la app web
const RECONEXION_TOPE_MS = 30000;  // en un túnel largo, no cada 3 s para siempre

function crearCliente({ servidor, WebSocketImpl, ahora = () => Date.now() }) {
  if (!servidor) throw new Error('falta la URL del servidor');
  if (!WebSocketImpl) throw new Error('falta la implementación de WebSocket');

  const oyentes = new Map();
  const emitir = (evento, dato) => {
    for (const fn of oyentes.get(evento) || []) {
      try { fn(dato); } catch (e) { /* un oyente roto no tumba la conexión */ }
    }
  };

  let ws = null;
  let token = null;
  let sesion = null;
  let estado = null;        // último `state` recibido
  let geometria = null;
  let reportaGps = false;   // lo dice el servidor con `gps_role`
  let motivoGps = null;
  let conectado = false;
  let cerradoAdrede = false;
  let intentos = 0;
  let reintento = null;
  const enviosGps = [];     // marcas de tiempo, para el freno de cadencia

  // ─── Entrar ────────────────────────────────────────────────
  // Devuelve la sesión completa (token, unitId, vehicleId, routeId…). El
  // token dura 30 días: se guarda en el dispositivo y se reusa.
  async function entrar(usuario, password) {
    const r = await fetch(servidor + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: usuario, password }),
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(cuerpo.error || 'No se pudo entrar');
      e.status = r.status;         // 401 contraseña, 403 cooperativa suspendida
      throw e;
    }
    sesion = cuerpo;
    return cuerpo;
  }

  // ─── Conectar ──────────────────────────────────────────────
  //
  // Recibe la SESIÓN además del token, y no es opcional de verdad: casi todo
  // lo que este módulo ofrece depende de saber quién soy.
  //
  //   miBrecha()       busca `gaps[miVehiculo]`
  //   quienSoy()       decide qué mensaje del chat es propio
  //   miUnidad()       me encuentra en el estado, o sea en el mapa
  //
  // Antes la sesión solo se guardaba al entrar con usuario y contraseña. Pero
  // el token dura 30 días: **desde la segunda vez que se abre la app, se
  // entra con la sesión guardada y se llama `conectar(token)` a secas**, así
  // que `sesion` quedaba en null para toda la corrida. Y todo lo de arriba
  // fallaba en silencio:
  //
  //   - el HUD decía "sin nadie" siempre, hubiera o no combis al lado;
  //   - los mensajes propios del chat se veían como ajenos;
  //   - y en el mapa NINGUNA unidad era "yo", así que el chofer no se veía a
  //     sí mismo y CENTRARME no tenía a dónde ir.
  //
  // Ninguna de las tres da error. Por eso, si no viene la sesión, se avisa
  // por consola: es preferible una línea molesta a tres pantallas mintiendo.
  function conectar(tk, sesionGuardada) {
    token = tk || token;
    if (!token) throw new Error('hace falta un token para conectar');
    if (sesionGuardada) sesion = sesionGuardada;
    else if (!sesion) {
      console.warn('[protocolo] conectar() sin sesión: la brecha, el chat y el mapa no van a saber quién sos');
    }
    cerradoAdrede = false;
    abrir();
  }

  function abrir() {
    // El socket anterior queda mudo y cerrado ANTES de abrir el nuevo. Sin
    // esto, un reintento que corre mientras el viejo sigue medio vivo deja
    // DOS sockets de la misma app: se roban el rol de GPS entre sí, el
    // `reportaGps` compartido queda en false por el mensaje del perdedor, y
    // las posiciones salen por el socket que el servidor no escucha — la
    // unidad desaparece del mapa mientras el chat y el SOS andan perfectos.
    if (ws) {
      try {
        if (typeof ws.on === 'function') ws.removeAllListeners();
        else ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        ws.close();
      } catch {}
    }
    const url = servidor.replace(/^http/, 'ws');
    ws = new WebSocketImpl(url);

    const alAbrir = () => {
      // `identify` SIEMPRE primero: lo que se mande antes se ignora en
      // silencio, y es de los errores más difíciles de ver porque no da error.
      ws.send(JSON.stringify({ type: 'identify', token }));
      // La presencia declarada se repite en cada conexión: el servidor la
      // guarda en memoria y un reinicio suyo la olvidaría — el chofer que
      // marcó "en ruta" a las 6 no tiene por qué volver a marcarla a las 9.
      if (presenciaDeclarada && presenciaDeclarada !== 'fuera') {
        ws.send(JSON.stringify({ type: 'presencia', estado: presenciaDeclarada }));
      }
    };
    const alMensaje = (crudo) => {
      let m;
      try { m = JSON.parse(typeof crudo === 'string' ? crudo : crudo.toString()); }
      catch { return; }
      recibir(m);
    };
    const alCerrar = () => {
      conectado = false;
      // Al caerse la conexión ya no se reporta posición. Si no se apaga acá,
      // el servicio de fondo sigue creyendo que sí durante toda la caída.
      reportaGps = false;
      emitir('conexion', { conectado: false });
      if (!cerradoAdrede) programarReintento();
    };

    // `ws` de Node usa .on(); el WebSocket de React Native usa .onmessage.
    // Se soportan los dos para que este archivo no tenga ramas por plataforma
    // más allá de esta.
    if (typeof ws.on === 'function') {
      ws.on('open', alAbrir);
      ws.on('message', alMensaje);
      ws.on('close', alCerrar);
      ws.on('error', () => {});     // el cierre viene después y ahí se reintenta
    } else {
      ws.onopen = alAbrir;
      ws.onmessage = (e) => alMensaje(e.data);
      ws.onclose = alCerrar;
      ws.onerror = () => {};
    }
  }

  function programarReintento() {
    clearTimeout(reintento);
    // Espera creciente: 3, 6, 12, 24, y de ahí 30 s. Un celular en un túnel
    // reintentando cada 3 segundos durante media hora es batería tirada.
    const espera = Math.min(RECONEXION_BASE_MS * 2 ** intentos, RECONEXION_TOPE_MS);
    intentos++;
    reintento = setTimeout(abrir, espera);
    emitir('reintento', { enMs: espera, intento: intentos });
  }

  // ─── Lo que llega ──────────────────────────────────────────
  function recibir(m) {
    switch (m.type) {
      case 'auth_error':
        // El servidor cierra después de esto. No se reintenta: el token no
        // va a mejorar solo, y un gerente nunca va a poder entrar acá.
        cerradoAdrede = true;
        emitir('authError', m.error);
        break;

      case 'gps_role':
        // El dato más importante de todo el protocolo para la app nativa:
        // solo UNA conexión reporta la posición de cada vehículo, y cambia
        // sola cuando entra otro chofer (el relevo de turno). El servicio de
        // fondo tiene que mirar esto, no asumirlo.
        reportaGps = !!m.reporting;
        motivoGps = m.reason || null;
        emitir('rolGps', { reporta: reportaGps, motivo: motivoGps });
        break;

      case 'state':
        if (!conectado) {
          conectado = true;
          intentos = 0;                  // reconexión lograda: se reinicia la espera
          emitir('conexion', { conectado: true });
        }
        estado = m;
        emitir('estado', m);
        break;

      case 'route_geometry':
        // Los tramos llegan como pares [lat, lng]. Se normalizan a objetos
        // acá y no en cada pantalla: es la forma que usa el resto del sistema
        // (incluido el PUT que los guarda), y la asimetría ya confundió una vez.
        geometria = {
          routeId: m.routeId,
          largoM: m.largoM,
          variante: m.variante,
          tramos: Object.fromEntries(
            Object.entries(m.tramos || {}).map(([k, pts]) => [
              k, (pts || []).map(p => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p),
            ])
          ),
        };
        emitir('geometria', geometria);
        break;

      case 'chat_history': emitir('historial', m.items || []); break;
      case 'chat_msg':     emitir('chat', m); break;
      case 'voice_msg':    emitir('voz', m); break;
      case 'photo_msg':    emitir('foto', m); break;
      case 'sos_alert':
        // Si el SOS es MÍO, el id queda anotado: es el ancla con la que la
        // pantalla puede ponerle nombre a la emergencia YA enviada.
        if (sesion && m.unitId === sesion.unitId) miUltimoSos = m.sosId ?? null;
        emitir('sos', m);
        break;
      case 'sos_tipo':     emitir('sosTipo', m); break;
      case 'unit_joined':  emitir('unidadEntro', m.unitId); break;
      case 'unit_left':    emitir('unidadSalio', m.unitId); break;
      case 'routes':       emitir('rutas', m); break;
      default: break;
    }
  }

  // ─── Mi brecha ─────────────────────────────────────────────
  // Devuelve los dos lados. Hay TRES estados por lado, no dos, y confundir
  // los dos últimos es lo que hace que una pantalla mienta:
  //
  //   null                          no hay nadie de ese lado
  //   { tiempo, unidad }            hay alguien y sabemos a cuánto
  //   { tiempo: null, unidad, sinSenal: true }
  //                                 hay alguien y NO sabemos a cuánto
  //
  // El tercero es una unidad que dejó de reportar. Su última posición es de
  // hace minutos: medirse contra ella sería inventar. Pero tampoco se la
  // saca de la fila, porque entonces este lado pasaría a medirse contra la
  // que sigue —el doble de lejos— y la pantalla diría "apurá" hacia una
  // combi que el chofer tiene justo adelante. Está medido; ver PROTOCOLO.md.
  function lado(tiempo, unidad, sinSenal) {
    if (!unidad) return null;                       // no hay nadie
    if (sinSenal || !tiempo) return { tiempo: null, unidad, sinSenal: true };
    return { tiempo, unidad, sinSenal: false };
  }

  function miBrecha() {
    const vehiculo = sesion?.vehicleId || sesion?.unitId;
    const g = estado?.gaps?.[vehiculo];
    if (!g) return { adelante: null, atras: null, objetivoMin: estado?.targetGapMin ?? null };
    return {
      adelante: lado(g.toAhead, g.aheadUnit, g.aheadSinSenal),
      atras:    lado(g.toBehind, g.behindUnit, g.behindSinSenal),
      objetivoMin: estado?.targetGapMin ?? null,
    };
  }

  // Las otras unidades de la ruta (la mía no)
  function otrasUnidades() {
    const yo = sesion?.vehicleId || sesion?.unitId;
    return (estado?.units || []).filter(u => u.unitId !== yo);
  }

  function miUnidad() {
    const yo = sesion?.vehicleId || sesion?.unitId;
    return (estado?.units || []).find(u => u.unitId === yo) || null;
  }

  // ─── Lo que se manda ───────────────────────────────────────
  function enviar(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  // ─── Mandar posiciones por HTTP ────────────────────────────
  // El camino que usa el servicio de fondo. NO depende de que el WebSocket
  // esté vivo, y ese es todo el punto: se midió en un teléfono real que al
  // bloquear la pantalla Android suspende el JavaScript y el socket se cae,
  // aunque el servicio de ubicación siga corriendo. La combi quedaba muda.
  //
  // Acepta varias posiciones con su hora, así que también sirve para vaciar
  // el atraso juntado en una zona sin datos.
  async function subirPosiciones(posiciones) {
    if (!token || !posiciones?.length) return { ok: false, motivo: 'nada-que-mandar' };
    try {
      const r = await fetch(servidor + '/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ posiciones }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, status: r.status, motivo: cuerpo.error || 'rechazado' };
      return { ok: true, aceptadas: cuerpo.aceptadas || 0 };
    } catch (e) {
      // Sin datos. El que llama guarda en la cola y reintenta al volver.
      return { ok: false, motivo: 'sin-red' };
    }
  }

  // Devuelve por qué NO se mandó, o null si se mandó. Se devuelve el motivo
  // en vez de un booleano pelado porque las dos razones de rechazo son cosas
  // que el chofer tiene que poder ver en pantalla.
  function mandarGps({ lat, lng, speed = 0 }) {
    if (!reportaGps) return 'sin-rol';       // otro celular reporta esta unidad
    const t = ahora();
    while (enviosGps.length && t - enviosGps[0] > 60_000) enviosGps.shift();
    if (enviosGps.length >= CUPO_GPS_POR_MINUTO) return 'cupo';
    // El servidor calcula el progreso proyectando sobre el trazado: mandar
    // `routeProgress` desde acá no aporta y en una ruta con geometría se ignora.
    if (!enviar({ type: 'gps', lat, lng, speed })) return 'sin-conexion';
    enviosGps.push(t);
    return null;
  }

  // `privado` manda al canal con Despacho. Un chofer no puede elegir
  // destinatario: el servidor lo reemplaza por su propio vehículo igual.
  function mandarChat(texto, { privado = false } = {}) {
    const t = String(texto || '').trim();
    if (!t) return false;
    return enviar({ type: 'chat', text: t.slice(0, 500),
                    timestamp: ahora(), ...(privado ? { privado: true } : {}) });
  }

  // Nota de voz. Viaja como data-URL en base64 dentro del mismo WebSocket que
  // el texto, que es como lo espera el servidor. El tope de 2 MB es suyo y no
  // avisa: pasado eso descarta el mensaje **en silencio**, así que se corta
  // acá con margen y se devuelve el motivo.
  const TOPE_AUDIO = 1_900_000;
  function mandarVoz({ data, duration, privado = false }) {
    if (!data || !String(data).startsWith('data:audio')) return 'formato';
    if (String(data).length > TOPE_AUDIO) return 'muy-larga';
    const ok = enviar({
      type: 'voice', data, duration: Math.round(duration || 0),
      timestamp: ahora(), ...(privado ? { privado: true } : {}),
    });
    return ok ? null : 'sin-conexion';
  }

  // Foto. Mismo camino que la voz, con MENOS lugar: el tope del servidor para
  // imágenes es más chico que el del audio a propósito —una foto pesa mucho
  // más y el reparto lo pagan todos los que la reciben, no el que la manda—.
  // Ver `app/imagen.js`.
  const TOPE_IMAGEN = 1_150_000;
  function mandarFoto({ data, text = '', privado = false }) {
    if (!data || !String(data).startsWith('data:image')) return 'formato';
    if (String(data).length > TOPE_IMAGEN) return 'muy-pesada';
    const ok = enviar({
      type: 'photo', data, text: String(text || '').slice(0, 200),
      timestamp: ahora(), ...(privado ? { privado: true } : {}),
    });
    return ok ? null : 'sin-conexion';
  }

  // La marca de la cooperativa: nombre, logo, iniciales y color.
  //
  // Se pide aparte del login a propósito. Si viniera adentro, cada entrada
  // arrastraría ~100 kB de imagen —y el chofer entra con datos móviles—, y
  // además no habría forma de que Despacho cambie el logo y la app lo vea sin
  // volver a entrar. Acá el token dura 30 días: sería un mes de desfase.
  async function pedirMarca(token) {
    try {
      const r = await fetch(servidor + '/marca', {
        headers: { Authorization: 'Bearer ' + (token || sesion?.token || '') },
      });
      if (!r.ok) return null;
      const cuerpo = await r.json();
      return cuerpo?.marca || null;
    } catch {
      // Sin marca la app funciona igual. Es lo primero que se puede perder.
      return null;
    }
  }

  function mandarSos({ lat = null, lng = null } = {}) {
    return enviar({ type: 'sos', lat, lng, timestamp: ahora() });
  }

  // Ponerle nombre a la emergencia YA disparada. El deslizar mandó la alerta
  // sin preguntar nada; esto va después, cuando el chofer puede. El id del
  // disparo lo anotó `sos_alert` al rebotar — si no hay ninguno anotado, no
  // hay SOS propio que calificar.
  let miUltimoSos = null;
  function marcarTipoSos(tipo) {
    if (miUltimoSos == null) return 'sin-sos';
    return enviar({ type: 'sos_tipo', sosId: miUltimoSos, tipo }) ? null : 'sin-conexion';
  }

  function salir() {
    cerradoAdrede = true;
    clearTimeout(reintento);
    try { ws && ws.close(); } catch {}
    ws = null;
    conectado = false;
    reportaGps = false;
    miUltimoSos = null;   // el SOS calificable no sobrevive a la sesión
  }

  // Declarar el estado: en ruta, ausente, fuera. Por el WebSocket si está
  // vivo; si no, por HTTP — el botón "salir de ruta" tiene que funcionar
  // hasta con mala señal. Declarar 'ruta' NO mete a la unidad en la cadena:
  // eso lo confirma el servidor cuando el GPS pisa el trazado.
  let presenciaDeclarada = null;
  function marcarPresencia(estado) {
    presenciaDeclarada = estado;
    if (ws && conectado) {
      try { ws.send(JSON.stringify({ type: 'presencia', estado })); return; } catch {}
    }
    if (token) {
      fetch(servidor + '/presencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ estado }),
      }).catch(() => {});
    }
  }

  return {
    entrar, conectar, salir,
    mandarGps, subirPosiciones, mandarChat, mandarVoz, mandarFoto, mandarSos,
    marcarTipoSos, pedirMarca, marcarPresencia,
    miBrecha, otrasUnidades, miUnidad,
    on(evento, fn) {
      if (!oyentes.has(evento)) oyentes.set(evento, new Set());
      oyentes.get(evento).add(fn);
      return () => oyentes.get(evento).delete(fn);
    },
    // Estado de solo lectura, para que las pantallas no toqueteen lo de adentro
    get sesion() { return sesion; },
    get estado() { return estado; },
    get geometria() { return geometria; },
    get conectado() { return conectado; },
    get reportaGps() { return reportaGps; },
    get motivoGps() { return motivoGps; },
  };
}

module.exports = { crearCliente, CUPO_GPS_POR_MINUTO };
