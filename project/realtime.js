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
  let authFailed = false;

  // Callbacks — la app los registra para recibir actualizaciones
  const listeners = { state: [], status: [], chat: [], voice: [], sos: [], history: [], autherror: [], gpsrole: [], geometry: [] };

  // ¿Este celular es el que reporta la posición de la unidad? El servidor lo
  // decide (uno solo por vehículo: el chofer). El cobrador, o el chofer al
  // que relevaron, quedan en modo acompañante: reciben todo pero no mandan
  // posición — así la unidad no salta entre dos celulares y encima se
  // ahorran datos. Arranca en true por si el servidor es viejo y no lo dice.
  let reportaGps = true;

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
    return data;
  }

  // ─── CONEXIÓN ──────────────────────────────────────────────
  function connect({ token }) {
    authToken = token;
    authFailed = false;

    if (ws) ws.close();

    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('WebSocket conectado');
      emit('status', { connected: true });

      // Presentar el token de sesión al servidor
      send({ type: 'identify', token: authToken });

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
        } else if (msg.type === 'sos_alert') {
          emit('sos', msg);
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

  function disconnect() {
    clearTimeout(reconnectTimeout);
    stopGps();
    if (ws) ws.close();
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

  function startGps() {
    if (!navigator.geolocation) {
      console.warn('GPS no disponible en este dispositivo');
      // Mandar posición simulada para desarrollo en escritorio
      startSimulatedGps();
      return;
    }

    // En escritorio el permiso puede quedar "colgado" (prompt ignorado o
    // headless): watchPosition no dispara ni éxito ni error. Si en 12s no
    // hay primer fix, arranca el GPS simulado para que la demo siga viva.
    let gotFix = false;
    const fallback = setTimeout(() => {
      if (!gotFix) {
        console.warn('GPS sin respuesta en 12s — usando simulado');
        startSimulatedGps();
      }
    }, 12000);

    // Pedir permiso de GPS y empezar a rastrear
    navigator.geolocation.watchPosition(
      (pos) => {
        gotFix = true;
        clearTimeout(fallback);
        stopSimulatedGps(); // si la demo ya había arrancado, gana el GPS real
        lastPosition = pos;
      },
      (err) => {
        console.warn('Error GPS:', err.message);
        if (!gotFix) {
          clearTimeout(fallback);
          startSimulatedGps();
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

      const { latitude, longitude, speed } = lastPosition.coords;

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
      });
    }, 3000);
  }

  function stopGps() {
    if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
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

      send({
        type: 'gps',
        lat, lng,
        speed: 25 + Math.round(Math.random() * 15),
        routeProgress: simProgress,
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

  function sendChat(text) {
    send({ type: 'chat', text: String(text).slice(0, 500), timestamp: Date.now() });
  }

  // Nota de voz como data-URL base64 (webm/opus). El servidor la rebota
  // a todo el grupo y la guarda en el historial.
  function sendVoice(dataUrl, duration) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio')) return;
    send({ type: 'voice', data: dataUrl, duration, timestamp: Date.now() });
  }

  function sendSos() {
    const coords = lastPosition?.coords;
    send({
      type: 'sos',
      lat: coords ? coords.latitude : null,
      lng: coords ? coords.longitude : null,
      timestamp: Date.now(),
    });
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
    sendChat,
    sendVoice,
    sendSos,
    isConnected,
    isReportingGps,
    on: (event, fn) => { listeners[event] = [fn]; }, // reemplaza — un handler por evento
  };

})();
