// realtime.js — conexión en tiempo real con el servidor
// Este archivo maneja todo lo relacionado con WebSockets y GPS.
// La app lo llama para conectarse, y este módulo se encarga del resto.

(function () {

  // URL del servidor — en desarrollo apunta a localhost,
  // en producción hay que cambiarla por la URL real del servidor desplegado.
  const SERVER_URL = window.REALTIME_SERVER_URL ||
    'wss://prototipo-celular-rastreo-01-production.up.railway.app';

  // Estado de la conexión
  let ws = null;
  let gpsInterval = null;
  let reconnectTimeout = null;
  let unitId = null;
  let driverName = null;

  // Callbacks — la app los registra para recibir actualizaciones
  const listeners = { state: [], status: [], chat: [], sos: [] };

  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  // ─── CONEXIÓN ──────────────────────────────────────────────
  function connect(id, name) {
    unitId = id;
    driverName = name;

    if (ws) ws.close();

    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('WebSocket conectado');
      emit('status', { connected: true });

      // Identificarse al servidor
      send({ type: 'identify', unitId, driverName });

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
        } else if (msg.type === 'sos_alert') {
          emit('sos', msg);
        }
      } catch (e) {
        console.error('Mensaje inválido del servidor', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket desconectado — reconectando en 3s');
      emit('status', { connected: false });
      stopGps();

      // Reconexión automática después de 3 segundos
      // Así si se corta la señal, la app se reconecta sola
      reconnectTimeout = setTimeout(() => connect(unitId, driverName), 3000);
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

  function startGps() {
    if (!navigator.geolocation) {
      console.warn('GPS no disponible en este dispositivo');
      // Mandar posición simulada para desarrollo en escritorio
      startSimulatedGps();
      return;
    }

    // Pedir permiso de GPS y empezar a rastrear
    navigator.geolocation.watchPosition(
      (pos) => { lastPosition = pos; },
      (err) => {
        console.warn('Error GPS:', err.message);
        startSimulatedGps();
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );

    // Mandar posición al servidor cada 3 segundos
    gpsInterval = setInterval(() => {
      if (!lastPosition) return;

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
  }

  // ─── GPS SIMULADO ──────────────────────────────────────────
  // Para cuando se abre en escritorio (sin GPS real).
  // Simula una combi moviéndose por la ruta.

  let simProgress = Math.random() * 0.6 + 0.2; // posición inicial aleatoria

  function startSimulatedGps() {
    console.log('Usando GPS simulado (modo escritorio)');

    // Coordenadas de Juliaca — Terminal Sur
    const BASE_LAT = -15.502;
    const BASE_LNG = -70.133;

    gpsInterval = setInterval(() => {
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

  window.RealtimeClient = {
    connect,
    disconnect,
    sendChat,
    sendSos,
    isConnected,
    on: (event, fn) => { listeners[event] = [fn]; }, // reemplaza — un handler por evento
  };

})();
