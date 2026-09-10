// realtime.js — conexión en tiempo real con el servidor
// Este archivo maneja todo lo relacionado con WebSockets y GPS.
// La app lo llama para conectarse, y este módulo se encarga del resto.

(function () {

  // URL del servidor — en desarrollo apunta a localhost,
  // en producción hay que cambiarla por la URL real del servidor desplegado.
  const SERVER_URL = window.REALTIME_SERVER_URL ||
    'wss://prototipo-celular-rastreo-01-production.up.railway.app';

  // El mismo servidor atiende HTTP (login) y WebSocket (tiempo real)
  const HTTP_URL = SERVER_URL.replace(/^ws/, 'http');

  // Estado de la conexión
  let ws = null;
  let gpsInterval = null;
  let reconnectTimeout = null;
  let authToken = null;
  let authUnitId = null;   // quién soy: para reconocer el eco de MI SOS
  // El GPS simulado sólo existe para la demo (el servidor en MODO=demo lo
  // dice en config.js, o `?demo=1` en la URL). En producción, sin fix no se
  // manda nada: antes un chofer con el permiso colgado metía una combi
  // fantasma en el mapa real (REVISION-2026-09-10.md, C4).
  const DEMO = !!window.MODO_DEMO || /[?&]demo=1/.test(location.search);
  let authFailed = false;

  // Callbacks — la app los registra para recibir actualizaciones
  const listeners = { state: [], status: [], chat: [], voice: [], sos: [], sostipo: [], history: [], autherror: [], gpsrole: [], geometry: [] };

  // ¿Este celular es el que reporta la posición de la unidad? El servidor lo
  // decide (uno solo por vehículo: el chofer). El cobrador, o el chofer al
  // que relevaron, quedan en modo acompañante: reciben todo pero no mandan
  // posición — así la unidad no salta entre dos celulares y encima se
  // ahorran datos. Arranca en true por si el servidor es viejo y no lo dice.
  let reportaGps = true;

  // La presencia declarada ('ruta' | 'ausente' | 'fuera'), igual que en la
  // app nativa. Se guarda acá para RE-DECLARARLA en cada reconexión: el
  // servidor la tiene en memoria, y un reinicio suyo (o un corte de señal)
  // no puede convertir a alguien que declaró en alguien que nunca declaró.
  let presenciaDeclarada = null;

  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  // ─── AUTENTICACIÓN ─────────────────────────────────────────
  // Devuelve { token, unitId, driverName, role, created } o lanza un
  // Error con .status (400/401/429) si el servidor rechazó el login.
  // Un error sin .status significa que no se pudo llegar al servidor.
  async function login(user, password) {
    const res = await fetch(HTTP_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Error de autenticación');
      err.status = res.status;
      throw err;
    }
    authUnitId = data.unitId || null;
    return data;
  }

  // ─── CONEXIÓN ──────────────────────────────────────────────
  function connect({ token }) {
    authToken = token;
    authFailed = false;

    // El socket que se reemplaza no puede hablar más. Sin esto, su onclose
    // agendaba OTRA reconexión —bucle de identificaciones cada 3 s— y sus
    // últimos mensajes pisaban el estado del socket nuevo: el cartel de
    // «otro chofer tomó la unidad» apareciendo en el propio login era esto.
    clearTimeout(reconnectTimeout);
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }

    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('WebSocket conectado');
      emit('status', { connected: true });

      // Presentar el token de sesión al servidor
      send({ type: 'identify', token: authToken });

      // Y re-declarar la presencia: la conexión nueva no hereda nada, y un
      // reinicio del servidor tampoco. Sin declarar (la puerta todavía no
      // se cruzó, o un cliente viejo), no se manda nada — el servidor trata
      // la ausencia de declaración como 'ruta', la compatibilidad de siempre.
      if (presenciaDeclarada) send({ type: 'presencia', estado: presenciaDeclarada });

      // Arrancar el envío de GPS
      startGps();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          emit('state', msg);
        } else if (msg.type === 'chat_msg') {
          emit('chat', msg);
        } else if (msg.type === 'voice_msg') {
          emit('voice', msg);
        } else if (msg.type === 'photo_msg') {
          emit('photo', msg);
        } else if (msg.type === 'sos_alert') {
          // El eco de MI disparo por el socket: es lo que confirma que salió
          if (msg.unitId && msg.unitId === authUnitId && ecoSos) { const r = ecoSos; ecoSos = null; r(msg); }
          emit('sos', msg);
        } else if (msg.type === 'sos_tipo') {
          // El tipo elegido después del disparo: actualiza el SOS ya
          // mostrado, no agrega otro.
          emit('sostipo', msg);
        } else if (msg.type === 'chat_history') {
          emit('history', msg.items || []);
        } else if (msg.type === 'route_geometry') {
          // El trazado real de la ruta. Llega una sola vez al conectar (y si
          // Despacho lo edita), nunca en cada estado: son varios KB.
          emit('geometry', msg);
        } else if (msg.type === 'gps_role') {
          reportaGps = msg.reporting !== false;
          emit('gpsrole', msg);
        } else if (msg.type === 'auth_error') {
          // Sesión inválida o expirada: no tiene sentido reintentar
          authFailed = true;
          emit('autherror', msg);
        }
      } catch (e) {
        console.error('Mensaje inválido del servidor', e);
      }
    };

    ws.onclose = () => {
      emit('status', { connected: false });
      stopGps();

      // Si el servidor rechazó la sesión, la app vuelve al login —
      // reconectar con el mismo token solo repetiría el rechazo
      if (authFailed) return;

      // Reconexión automática después de 3 segundos
      // Así si se corta la señal, la app se reconecta sola
      console.log('WebSocket desconectado — reconectando en 3s');
      reconnectTimeout = setTimeout(() => connect({ token: authToken }), 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error', err);
    };
  }

  // Cerrar sesión de verdad: revoca el token en el servidor (P5 de la
  // revisión del 8/9). Sin red, no importa: lo local se borra igual.
  function logout() {
    if (!authToken) return;
    try {
      fetch(HTTP_URL + '/auth/logout', {
        method: 'POST', keepalive: true,
        headers: { Authorization: 'Bearer ' + authToken },
      }).catch(() => {});
    } catch {}
  }

  function disconnect() {
    clearTimeout(reconnectTimeout);
    stopGps();
    // Mudo antes de cerrar, por la misma razón que en connect(): que un
    // socket moribundo no agende reconexiones ni emita eventos viejos.
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    ws = null;
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ─── GPS ───────────────────────────────────────────────────
  // Pide la posición al celular y la manda al servidor cada 3 segundos.

  let lastPosition = null;
  let simTimer = null;
  let watchId = null;        // el watchPosition vivo, para poder pararlo
  let fallbackTimer = null;  // el plazo del primer fix

  // Sin fix, la demo simula y la producción avisa (C4)
  function sinGps(motivo) {
    if (DEMO) { startSimulatedGps(); return; }
    console.warn('Sin GPS: ' + motivo);
    emit('gps', { ok: false, motivo });
  }

  function startGps() {
    // Corre en cada `onopen`: con la señal intermitente se reconecta cada
    // pocos segundos, y antes cada vez abría OTRO watchPosition de alta
    // precisión que nadie paraba —decenas en una hora, batería— (C9).
    if (watchId !== null || gpsInterval) return;
    if (!navigator.geolocation) {
      sinGps('este dispositivo no tiene GPS');
      return;
    }

    // En escritorio el permiso puede quedar "colgado" (prompt ignorado o
    // headless): watchPosition no dispara ni éxito ni error. Si en 12s no
    // hay primer fix, la demo sigue viva con el simulado; en producción se
    // dice «sin GPS».
    let gotFix = false;
    fallbackTimer = setTimeout(() => {
      if (!gotFix) sinGps('sin respuesta en 12 s');
    }, 12000);

    // Pedir permiso de GPS y empezar a rastrear
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        gotFix = true;
        clearTimeout(fallbackTimer);
        stopSimulatedGps(); // si la demo ya había arrancado, gana el GPS real
        if (!lastPosition) emit('gps', { ok: true });
        lastPosition = pos;
      },
      (err) => {
        console.warn('Error GPS:', err.message);
        if (!gotFix) {
          clearTimeout(fallbackTimer);
          sinGps(err.code === 1 ? 'permiso de ubicación denegado' : err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );

    // Mandar posición al servidor cada 3 segundos
    gpsInterval = setInterval(() => {
      if (!lastPosition) return;
      // En modo acompañante se sigue leyendo el GPS (el SOS necesita saber
      // dónde está esta persona) pero no se manda posición de la unidad.
      if (!reportaGps) return;

      const { latitude, longitude, speed, accuracy } = lastPosition.coords;

      // routeProgress: estimamos qué tan avanzado está en la ruta
      // usando la latitud (simplificación para Juliaca).
      // En producción esto se calcula contra los puntos reales de la ruta.
      const routeProgress = estimateProgress(latitude, longitude);

      send({
        type: 'gps',
        lat: latitude,
        lng: longitude,
        speed: speed ? Math.round(speed * 3.6) : 0, // m/s → km/h
        routeProgress,
        // Los metros de error del GPS, como manda la app nativa: con más de
        // 100 m el servidor no juzga desvío ni parada (TRUCOS, T11).
        ...(Number.isFinite(accuracy) && accuracy >= 0 ? { precision: Math.round(accuracy) } : {}),
      });
    }, 3000);
  }

  function stopGps() {
    if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
    if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch {} watchId = null; }
    clearTimeout(fallbackTimer);
    stopSimulatedGps();
  }

  // ─── GPS SIMULADO ──────────────────────────────────────────
  // Para cuando se abre en escritorio (sin GPS real).
  // Simula una combi moviéndose por la ruta.

  let simProgress = Math.random() * 0.6 + 0.2; // posición inicial aleatoria

  function startSimulatedGps() {
    if (simTimer) return;
    console.log('Usando GPS simulado (modo escritorio)');

    // Coordenadas de Juliaca — Terminal Sur
    const BASE_LAT = -15.502;
    const BASE_LNG = -70.133;

    simTimer = setInterval(() => {
      if (!reportaGps) return;
      simProgress += 0.004; // avanza por la ruta
      if (simProgress > 1) simProgress = 0; // vuelta completa

      // Convertir progreso en coordenadas aproximadas
      const lat = BASE_LAT + simProgress * 0.05;
      const lng = BASE_LNG + simProgress * 0.03;

      // Marcada como simulada, igual que la marca Android: el servidor la
      // anota y Despacho la ve como lo que es.
      send({
        type: 'gps',
        lat, lng,
        speed: 25 + Math.round(Math.random() * 15),
        routeProgress: simProgress,
        simulado: true,
      });
    }, 3000);
  }

  function stopSimulatedGps() {
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
  }

  // ─── ESTIMACIÓN DE PROGRESO EN RUTA ───────────────────────
  // Convierte coordenadas GPS a un número 0-1 en la ruta R-14.
  // 0 = Terminal Sur, 1 = Huancané.
  // Esta es una aproximación lineal — la versión real usaría
  // los puntos exactos del recorrido.

  const TERMINAL_SUR = { lat: -15.502, lng: -70.133 };
  const HUANCANE    = { lat: -15.457, lng: -70.103 };

  function estimateProgress(lat, lng) {
    const totalLat = HUANCANE.lat - TERMINAL_SUR.lat;
    const totalLng = HUANCANE.lng - TERMINAL_SUR.lng;
    const doneLat  = lat - TERMINAL_SUR.lat;
    const doneLng  = lng - TERMINAL_SUR.lng;
    const progress = (doneLat / totalLat + doneLng / totalLng) / 2;
    return Math.max(0, Math.min(1, progress));
  }

  // ─── API PÚBLICA ───────────────────────────────────────────
  // Lo que la app puede usar desde afuera.

  // ─── CHAT Y SOS ────────────────────────────────────────────
  // El servidor rebota estos mensajes a todos los conectados
  // (incluido el emisor), así el hilo queda igual para todo el grupo.

  // privado = va solo a Despacho (y a quien vaya en la misma combi), no al
  // grupo de la ruta. El servidor decide el destinatario: la propia unidad.
  function sendChat(text, privado) {
    send({
      type: 'chat', text: String(text).slice(0, 500),
      privado: !!privado, timestamp: Date.now(),
    });
  }

  // Nota de voz como data-URL base64 (webm/opus). El servidor la rebota
  // a todo el grupo y la guarda en el historial.
  function sendVoice(dataUrl, duration, privado) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio')) return;
    send({ type: 'voice', data: dataUrl, duration, privado: !!privado, timestamp: Date.now() });
  }

  // El SOS, con confirmación: devuelve { ok, via, sosId } y `ok` quiere decir
  // que LLEGÓ. Primero por HTTP (`POST /sos`, que contesta con la alerta y
  // su id — el socket no siempre está); si la red HTTP falla y el socket
  // está vivo, por el socket esperando el eco propio. Antes `send()`
  // descartaba en silencio sin socket y la pantalla decía «ALERTA ENVIADA»
  // igual (REVISION-2026-09-10.md, C3).
  let ecoSos = null;
  async function sendSos() {
    const coords = lastPosition?.coords;
    const cuerpo = {
      lat: coords ? coords.latitude : null,
      lng: coords ? coords.longitude : null,
      timestamp: Date.now(),
    };
    if (authToken) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(HTTP_URL + '/sos', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
          body: JSON.stringify(cuerpo),
        });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: true, via: 'http', sosId: data.sosId ?? data.alerta?.sosId ?? null };
        }
        // 429 (más de 5 por minuto) o un 4xx: el servidor dijo que no
        if (res.status >= 400 && res.status < 500) return { ok: false, via: 'http', error: res.status };
      } catch {}
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      const eco = new Promise((resolve) => {
        ecoSos = resolve;
        setTimeout(() => { if (ecoSos === resolve) { ecoSos = null; resolve(null); } }, 4000);
      });
      send({ type: 'sos', ...cuerpo });
      const m = await eco;
      if (m) return { ok: true, via: 'ws', sosId: m.sosId ?? null };
    }
    return { ok: false, via: null };
  }

  // Ponerle nombre al SOS YA disparado ('mecanica' | 'accidente' |
  // 'policia'). El id del disparo viene en el eco del sos_alert; solo el
  // que disparó puede — el servidor lo verifica igual.
  function sendSosTipo(sosId, tipo) {
    send({ type: 'sos_tipo', sosId, tipo });
  }

  // Declarar el estado: en ruta, ausente, fuera — el mismo protocolo que la
  // app nativa. Por el WebSocket si está vivo; si no, por HTTP: "salir de
  // ruta" tiene que funcionar hasta con mala señal. Declarar 'ruta' NO mete
  // a la unidad en la cadena de brechas: eso lo confirma el servidor cuando
  // el GPS pisa el trazado.
  function setPresencia(estado) {
    presenciaDeclarada = estado;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'presencia', estado })); return; } catch {}
    }
    if (authToken) {
      fetch(HTTP_URL + '/presencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
        body: JSON.stringify({ estado }),
      }).catch(() => {});
    }
  }

  // «Estoy en tráfico» / «ya no»: el mismo camino que la presencia, por el
  // socket si está vivo y por HTTP si no (C16: la web no podía avisarlo).
  function setTrafico(activo) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'trafico', activo: !!activo })); return; } catch {}
    }
    if (authToken) {
      fetch(HTTP_URL + '/trafico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
        body: JSON.stringify({ activo: !!activo }),
      }).catch(() => {});
    }
  }

  function isConnected() {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  function isReportingGps() {
    return reportaGps;
  }

  window.RealtimeClient = {
    login,
    connect,
    disconnect,
    logout,
    sendChat,
    sendVoice,
    sendSos,
    sendSosTipo,
    setPresencia,
    setTrafico,
    isConnected,
    isReportingGps,
    on: (event, fn) => { listeners[event] = [fn]; }, // reemplaza — un handler por evento
  };

})();
