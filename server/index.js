// Servidor COOP-R14 — tiempo real
// Recibe GPS de cada combi, calcula gaps, distribuye a todos.

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── CORS ────────────────────────────────────────────────────
// Permite que la app (en otro dominio) hable con este servidor.
// Sin esto, el navegador bloquea la conexión por seguridad.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ─── ESTADO GLOBAL ───────────────────────────────────────────
// Acá vivem todos los datos en tiempo real.
// En memoria por ahora — cuando el servidor se reinicia, se borran.
// Más adelante esto irá a una base de datos.

const units = new Map();
// units = { "V-247": { unitId, lat, lng, speed, timestamp, routeProgress }, ... }

const clients = new Map();
// clients = { websocket → unitId }

// ─── HISTORIAL DE CHAT ───────────────────────────────────────
// Los últimos mensajes (chat y SOS) se guardan para que quien se
// conecta vea la conversación en curso, no un hilo vacío.
// Se persisten a disco con un pequeño debounce; si el servidor se
// reinicia, el historial se recarga del archivo.
// (En Railway el disco es efímero: sobrevive reinicios del proceso,
// no redeploys. Cuando haga falta más, esto pasa a una base de datos.)

const HISTORY_FILE = process.env.HISTORY_FILE || path.join(__dirname, 'chat-history.json');
const HISTORY_MAX = 200;

let history = [];
try {
  history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(-HISTORY_MAX);
  console.log(`Historial cargado: ${history.length} mensajes`);
} catch {
  // primer arranque o archivo corrupto — se empieza de cero
}

let saveTimeout = null;
function remember(item) {
  history.push(item);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fs.writeFile(HISTORY_FILE, JSON.stringify(history), (err) => {
      if (err) console.error('No se pudo guardar el historial:', err.message);
    });
  }, 1000);
}

// ─── RUTA DE SALUD ───────────────────────────────────────────
// Si hacés GET /ping y responde "pong", el servidor está vivo.
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    message: 'pong',
    units: units.size,
    clients: clients.size,
    historyLength: history.length,
    time: new Date().toISOString(),
  });
});

// ─── SERVIDOR HTTP ───────────────────────────────────────────
// Express necesita un servidor HTTP para poder agregarle WebSockets arriba.
const server = http.createServer(app);

// ─── SERVIDOR WEBSOCKET ──────────────────────────────────────
// Acá empieza lo interesante.
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');

  // Cuando llega un mensaje de una combi
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignorar mensajes que no sean JSON válido
    }

    // TIPO: identificación — el chofer dice quién es al conectarse
    if (msg.type === 'identify') {
      clients.set(ws, msg.unitId);
      units.set(msg.unitId, {
        unitId: msg.unitId,
        driverName: msg.driverName || 'Conductor',
        lat: null,
        lng: null,
        speed: 0,
        routeProgress: 0,
        timestamp: Date.now(),
      });
      console.log(`Unidad identificada: ${msg.unitId}`);
      broadcast({ type: 'unit_joined', unitId: msg.unitId });
    }

    // TIPO: posición GPS — llega cada ~3 segundos desde cada combi
    if (msg.type === 'gps') {
      const unitId = clients.get(ws);
      if (!unitId) return;

      const unit = units.get(unitId) || {};
      units.set(unitId, {
        ...unit,
        unitId,
        lat: msg.lat,
        lng: msg.lng,
        speed: msg.speed || 0,
        routeProgress: msg.routeProgress || 0,
        timestamp: Date.now(),
      });

      // Cada vez que llega una posición, recalculamos los gaps
      // y mandamos el estado completo a todos
      const state = buildState();
      broadcast({ type: 'state', ...state });
    }

    // TIPO: SOS — el chofer desliza el botón de emergencia
    // El servidor reenvía a TODOS los conectados (incluido el emisor)
    // con el nombre del chofer que pidió ayuda y su última posición.
    if (msg.type === 'sos') {
      const unitId = clients.get(ws);
      const unit = units.get(unitId) || {};
      console.log(`🚨 SOS de ${unitId}`);
      const alert = {
        unitId,
        driverName: unit.driverName || 'Conductor',
        lat: msg.lat ?? null,
        lng: msg.lng ?? null,
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'sos', ...alert });
      broadcast({ type: 'sos_alert', ...alert });
    }

    // TIPO: chat — mensaje de texto entre choferes del grupo
    // Limitamos a 500 caracteres para evitar abuso.
    if (msg.type === 'chat') {
      const unitId = clients.get(ws);
      const unit = units.get(unitId) || {};
      const entry = {
        unitId,
        driverName: unit.driverName || 'Conductor',
        text: String(msg.text || '').slice(0, 500),
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'chat', ...entry });
      broadcast({ type: 'chat_msg', ...entry });
    }
  });

  // Cuando una combi se desconecta
  ws.on('close', () => {
    const unitId = clients.get(ws);
    if (unitId) {
      units.delete(unitId);
      clients.delete(ws);
      console.log(`Unidad desconectada: ${unitId}`);
      broadcast({ type: 'unit_left', unitId });
    }
  });

  // Mandar el estado actual apenas se conecta (para que no espere el primer GPS)
  const state = buildState();
  ws.send(JSON.stringify({ type: 'state', ...state }));

  // Y el historial de chat, para que vea la conversación en curso
  ws.send(JSON.stringify({ type: 'chat_history', items: history }));
});

// ─── CONSTRUIR ESTADO ────────────────────────────────────────
// Toma todas las posiciones y calcula quién va adelante/atrás de quién.
// routeProgress es un número 0-1 que indica qué tan avanzado está en la ruta.
// 0 = terminal sur, 1 = Huancané.

function buildState() {
  const all = Array.from(units.values())
    .filter(u => u.lat !== null) // solo unidades con GPS activo
    .sort((a, b) => b.routeProgress - a.routeProgress); // ordenar por posición en ruta

  return {
    units: all,
    gaps: calculateGaps(all),
    totalOnRoute: all.length,
    timestamp: Date.now(),
  };
}

// ─── CALCULAR GAPS ───────────────────────────────────────────
// Dado el orden en la ruta, calcula cuántos minutos separa cada par de unidades.
// La fórmula es una aproximación: diferencia de progreso * duración total de la ruta.
// La ruta R-14 dura ~50 minutos de punta a punta.

const ROUTE_DURATION_MIN = 50;

function calculateGaps(sortedUnits) {
  const gaps = {};
  for (let i = 0; i < sortedUnits.length; i++) {
    const current = sortedUnits[i];
    const ahead = sortedUnits[i - 1]; // la que va adelante (más progreso)
    const behind = sortedUnits[i + 1]; // la que viene atrás (menos progreso)

    const gapToAhead = ahead
      ? (ahead.routeProgress - current.routeProgress) * ROUTE_DURATION_MIN
      : null;

    const gapToBehind = behind
      ? (current.routeProgress - behind.routeProgress) * ROUTE_DURATION_MIN
      : null;

    gaps[current.unitId] = {
      toAhead: gapToAhead !== null ? formatMinutes(gapToAhead) : null,
      toBehind: gapToBehind !== null ? formatMinutes(gapToBehind) : null,
      aheadUnit: ahead?.unitId || null,
      behindUnit: behind?.unitId || null,
    };
  }
  return gaps;
}

// Convierte 2.25 minutos → "02:15"
function formatMinutes(mins) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── BROADCAST ───────────────────────────────────────────────
// Manda un mensaje a TODOS los clientes conectados.
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(msg);
    }
  });
}

// ─── LIMPIAR UNIDADES INACTIVAS ──────────────────────────────
// Si una unidad no manda GPS en más de 30 segundos, la sacamos.
// Evita que fantasmas queden en el mapa después de que alguien cierra la app.
setInterval(() => {
  const cutoff = Date.now() - 30_000;
  for (const [unitId, unit] of units) {
    if (unit.timestamp < cutoff) {
      units.delete(unitId);
      console.log(`Unidad eliminada por inactividad: ${unitId}`);
      broadcast({ type: 'unit_left', unitId });
    }
  }
}, 10_000);

// ─── ARRANCAR ────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor COOP-R14 corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
});
