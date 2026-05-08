// Servidor COOP-R14 — tiempo real
// Recibe GPS de cada combi, calcula gaps, distribuye a todos.

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

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

// ─── RUTA DE SALUD ───────────────────────────────────────────
// Si hacés GET /ping y responde "pong", el servidor está vivo.
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    message: 'pong',
    units: units.size,
    clients: clients.size,
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

// ─── ARRANCAR ────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor COOP-R14 corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
});
