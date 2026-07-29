// Servidor COOP-R14 — tiempo real
// Recibe GPS de cada combi, calcula gaps, distribuye a todos.

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ─── CORS ────────────────────────────────────────────────────
// Permite que la app (en otro dominio) hable con este servidor.
// Sin esto, el navegador bloquea la conexión por seguridad.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  // Preflight del navegador antes de un POST con JSON
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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

const profiles = new Map();
// profiles = { unitId → { driverName, role } } — llenado en el identify

// ─── HISTORIAL DE CHAT (SQLite) ──────────────────────────────
// Los últimos mensajes del grupo (texto, voz y SOS) se guardan en una
// base SQLite para que quien se conecta vea la conversación en curso.
// En Railway: montar un volumen y apuntar DB_FILE ahí (p. ej.
// DB_FILE=/data/r14.db) para que el historial sobreviva redeploys.

const Database = require('better-sqlite3');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'r14.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,          -- 'chat' | 'voice' | 'sos'
    unitId TEXT,
    driverName TEXT,
    text TEXT,                   -- solo kind='chat'
    duration INTEGER,            -- segundos, solo kind='voice'
    data TEXT,                   -- audio como data-URL base64, solo kind='voice'
    lat REAL, lng REAL,          -- solo kind='sos'
    timestamp INTEGER NOT NULL
  )
`);

// Migración única desde el chat-history.json de la versión anterior
const LEGACY_FILE = path.join(__dirname, 'chat-history.json');
if (db.prepare('SELECT COUNT(*) AS c FROM messages').get().c === 0 && fs.existsSync(LEGACY_FILE)) {
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const ins = db.prepare(`
      INSERT INTO messages (kind, unitId, driverName, text, duration, data, lat, lng, timestamp)
      VALUES (@kind, @unitId, @driverName, @text, @duration, @data, @lat, @lng, @timestamp)
    `);
    db.transaction(items => items.forEach(it => ins.run({
      text: null, duration: null, data: null, lat: null, lng: null, ...it,
    })))(old);
    fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.imported');
    console.log(`Migrados ${old.length} mensajes del JSON a SQLite`);
  } catch (e) {
    console.error('Migración del historial fallida:', e.message);
  }
}

const HISTORY_MAX = 200;   // mensajes que recibe un cliente al conectarse
const KEEP_ROWS = 1000;    // filas totales que retiene la base
const VOICE_KEEP = 30;     // notas de voz que conservan su audio

const insertStmt = db.prepare(`
  INSERT INTO messages (kind, unitId, driverName, text, duration, data, lat, lng, timestamp)
  VALUES (@kind, @unitId, @driverName, @text, @duration, @data, @lat, @lng, @timestamp)
`);
const pruneRowsStmt = db.prepare(`
  DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ${KEEP_ROWS})
`);
// Las notas de voz viejas sueltan su audio (pesa mucho) pero conservan
// la burbuja con su duración — el cliente las muestra como expiradas.
const pruneVoiceStmt = db.prepare(`
  UPDATE messages SET data = NULL
  WHERE kind = 'voice' AND data IS NOT NULL
    AND id NOT IN (SELECT id FROM messages WHERE kind = 'voice' AND data IS NOT NULL ORDER BY id DESC LIMIT ${VOICE_KEEP})
`);

function remember(item) {
  try {
    insertStmt.run({ text: null, duration: null, data: null, lat: null, lng: null, ...item });
    pruneRowsStmt.run();
    pruneVoiceStmt.run();
  } catch (e) {
    console.error('No se pudo guardar el mensaje:', e.message);
  }
}

function recentHistory() {
  // El rol sale de la tabla users (los mensajes viejos no lo guardan)
  return db.prepare(`
    SELECT m.kind, m.unitId, m.driverName, m.text, m.duration, m.data,
           m.lat, m.lng, m.timestamp, COALESCE(u.role, 'driver') AS role
    FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ${HISTORY_MAX}) m
    LEFT JOIN users u ON u.unitId = m.unitId
    ORDER BY m.id ASC
  `).all();
}

function historyCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
}

// ─── USUARIOS Y SESIONES ─────────────────────────────────────
// Registro "en el primer uso": la primera vez que una unidad entra,
// esa contraseña queda registrada; después siempre se exige la misma.
// Cuando exista el panel de Despacho, la administración de usuarios
// (altas, resets de contraseña, roles) pasa ahí.

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    unitId TEXT PRIMARY KEY,
    driverName TEXT,
    role TEXT NOT NULL DEFAULT 'driver',   -- 'driver' | 'dispatch'
    passHash TEXT NOT NULL,                -- formato salt:hash (scrypt)
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    unitId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  );
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

const SESSION_DAYS = 30;

function createSession(unitId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, unitId, createdAt, expiresAt) VALUES (?, ?, ?, ?)')
    .run(token, unitId, Date.now(), Date.now() + SESSION_DAYS * 86_400_000);
  return token;
}

// Devuelve el usuario dueño de un token vigente, o null
function sessionUser(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const s = db.prepare('SELECT unitId FROM sessions WHERE token = ? AND expiresAt > ?')
    .get(token, Date.now());
  if (!s) return null;
  return db.prepare('SELECT unitId, driverName, role FROM users WHERE unitId = ?').get(s.unitId) || null;
}

// Limpieza de sesiones vencidas una vez por hora
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(Date.now());
}, 3_600_000);

// ─── CUENTA DE DESPACHO ──────────────────────────────────────
// El nombre DESPACHO está reservado y siempre lleva rol 'dispatch'.
// En producción conviene fijar la clave por entorno: con
// DISPATCH_PASSWORD seteada, la cuenta se crea o actualiza al arrancar.
// Sin la variable, rige el registro en el primer uso como para
// cualquier unidad.
const DISPATCH_ID = 'DESPACHO';
if (process.env.DISPATCH_PASSWORD) {
  const hash = hashPassword(process.env.DISPATCH_PASSWORD);
  const exists = db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(DISPATCH_ID);
  if (exists) {
    db.prepare("UPDATE users SET passHash = ?, role = 'dispatch' WHERE unitId = ?").run(hash, DISPATCH_ID);
  } else {
    db.prepare('INSERT INTO users (unitId, driverName, role, passHash, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(DISPATCH_ID, 'Despacho', 'dispatch', hash, Date.now());
  }
  console.log('Cuenta DESPACHO lista (desde DISPATCH_PASSWORD)');
}

// Intentos fallidos por unidad: 5 seguidos → bloqueo de 5 minutos
const loginAttempts = new Map();

app.post('/auth/login', (req, res) => {
  const unitId = String(req.body?.user || '').trim().slice(0, 24);
  const password = String(req.body?.password || '');
  if (!unitId || password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'Completá usuario y contraseña (mínimo 4 caracteres)' });
  }

  const a = loginAttempts.get(unitId);
  if (a && a.until > Date.now()) {
    return res.status(429).json({ error: 'Demasiados intentos. Esperá 5 minutos.' });
  }

  let user = db.prepare('SELECT * FROM users WHERE unitId = ?').get(unitId);
  let created = false;
  if (!user) {
    // El alta de choferes es tarea de Despacho (panel → Unidades).
    // Solo se auto-registran: DESPACHO (bootstrap del sistema) y, para
    // demos sin administración, cualquier unidad si OPEN_REGISTRATION=1.
    const openReg = process.env.OPEN_REGISTRATION === '1';
    if (unitId !== DISPATCH_ID && !openReg) {
      return res.status(403).json({ error: 'Unidad no registrada. Pedí el alta a Despacho.' });
    }
    const role = unitId === DISPATCH_ID ? 'dispatch' : 'driver';
    const driverName = role === 'dispatch' ? 'Despacho' : unitId;
    db.prepare('INSERT INTO users (unitId, driverName, role, passHash, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(unitId, driverName, role, hashPassword(password), Date.now());
    user = { unitId, driverName, role };
    created = true;
    console.log(`${role === 'dispatch' ? 'Despacho' : 'Unidad'} registrado: ${unitId}`);
  } else if (!verifyPassword(password, user.passHash)) {
    const count = (a?.count || 0) + 1;
    loginAttempts.set(unitId, { count, until: count >= 5 ? Date.now() + 300_000 : 0 });
    return res.status(401).json({ error: `Contraseña incorrecta · intento ${count} de 5` });
  }

  loginAttempts.delete(unitId);
  const token = createSession(user.unitId);
  res.json({ token, unitId: user.unitId, driverName: user.driverName, role: user.role, created });
});

// ─── ADMINISTRACIÓN (solo Despacho) ──────────────────────────
// Altas, resets de contraseña y bajas de unidades. Todo exige un token
// de sesión con rol dispatch en el header Authorization.

function requireDispatch(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = sessionUser(token);
  if (!user || user.role !== 'dispatch') {
    return res.status(401).json({ error: 'Requiere sesión de Despacho' });
  }
  req.dispatchUser = user;
  next();
}

// Cierra en vivo las conexiones de una unidad (clave reseteada o baja)
function kickUnit(unitId, reason) {
  db.prepare('DELETE FROM sessions WHERE unitId = ?').run(unitId);
  for (const [ws, id] of clients) {
    if (id === unitId) {
      try {
        ws.send(JSON.stringify({ type: 'auth_error', error: reason }));
        ws.close();
      } catch {}
    }
  }
}

app.get('/admin/users', requireDispatch, (req, res) => {
  const online = new Set(clients.values());
  const users = db.prepare(`
    SELECT unitId, driverName, role, createdAt FROM users
    ORDER BY CASE role WHEN 'dispatch' THEN 0 ELSE 1 END, unitId
  `).all();
  res.json({ users: users.map(u => ({ ...u, online: online.has(u.unitId) })) });
});

app.post('/admin/users', requireDispatch, (req, res) => {
  const unitId = String(req.body?.unitId || '').trim().slice(0, 24);
  const driverName = String(req.body?.driverName || '').trim().slice(0, 40) || unitId;
  const password = String(req.body?.password || '');
  if (!unitId || password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'Completá unidad y contraseña (mínimo 4 caracteres)' });
  }
  if (db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(unitId)) {
    return res.status(409).json({ error: 'Esa unidad ya existe' });
  }
  db.prepare('INSERT INTO users (unitId, driverName, role, passHash, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(unitId, driverName, 'driver', hashPassword(password), Date.now());
  console.log(`Alta de unidad por Despacho: ${unitId}`);
  res.json({ ok: true, unitId });
});

app.post('/admin/users/:unitId/password', requireDispatch, (req, res) => {
  const unitId = String(req.params.unitId);
  const password = String(req.body?.password || '');
  if (password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'La contraseña nueva necesita mínimo 4 caracteres' });
  }
  if (!db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(unitId)) {
    return res.status(404).json({ error: 'Esa unidad no existe' });
  }
  db.prepare('UPDATE users SET passHash = ? WHERE unitId = ?').run(hashPassword(password), unitId);
  // Las sesiones viejas dejan de valer y la unidad conectada vuelve al login
  kickUnit(unitId, 'Despacho reseteó tu contraseña. Ingresá con la nueva.');
  console.log(`Contraseña reseteada por Despacho: ${unitId}`);
  res.json({ ok: true });
});

app.delete('/admin/users/:unitId', requireDispatch, (req, res) => {
  const unitId = String(req.params.unitId);
  if (unitId === DISPATCH_ID) {
    return res.status(400).json({ error: 'La cuenta de Despacho no se puede eliminar' });
  }
  if (!db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(unitId)) {
    return res.status(404).json({ error: 'Esa unidad no existe' });
  }
  db.prepare('DELETE FROM users WHERE unitId = ?').run(unitId);
  kickUnit(unitId, 'Tu acceso fue dado de baja por Despacho.');
  console.log(`Baja de unidad por Despacho: ${unitId}`);
  res.json({ ok: true });
});

// ─── RUTA DE SALUD ───────────────────────────────────────────
// Si hacés GET /ping y responde "pong", el servidor está vivo.
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    message: 'pong',
    units: units.size,
    clients: clients.size,
    historyLength: historyCount(),
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

    // TIPO: identificación — el cliente presenta su token de sesión.
    // Sin token válido no hay estado, ni historial, ni chat.
    if (msg.type === 'identify') {
      const user = sessionUser(msg.token);
      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Sesión inválida o expirada' }));
        ws.close();
        return;
      }
      clients.set(ws, user.unitId);
      profiles.set(user.unitId, { driverName: user.driverName || 'Conductor', role: user.role || 'driver' });

      // Despacho observa y habla, pero NO es una unidad en ruta:
      // no entra al mapa de units ni al cálculo de brechas
      if (user.role !== 'dispatch') {
        units.set(user.unitId, {
          unitId: user.unitId,
          driverName: user.driverName || 'Conductor',
          lat: null,
          lng: null,
          speed: 0,
          routeProgress: 0,
          timestamp: Date.now(),
        });
        broadcast({ type: 'unit_joined', unitId: user.unitId });
      }
      console.log(`${user.role === 'dispatch' ? 'Despacho conectado' : 'Unidad identificada'}: ${user.unitId}`);

      // Recién ahora recibe el estado y la conversación en curso
      ws.send(JSON.stringify({ type: 'state', ...buildState() }));
      ws.send(JSON.stringify({ type: 'chat_history', items: recentHistory() }));
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
      if (!unitId) return;
      const prof = profiles.get(unitId) || {};
      console.log(`🚨 SOS de ${unitId}`);
      const alert = {
        unitId,
        driverName: prof.driverName || 'Conductor',
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
      if (!unitId) return;
      const prof = profiles.get(unitId) || {};
      const entry = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        text: String(msg.text || '').slice(0, 500),
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'chat', ...entry });
      broadcast({ type: 'chat_msg', role: prof.role || 'driver', ...entry });
    }

    // TIPO: voz — nota de voz grabada en el celular
    // Llega como data-URL base64 (webm/opus). Tope ~1.5 MB de audio
    // (unos 60s) para que el broadcast no se vuelva pesado.
    if (msg.type === 'voice') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const data = typeof msg.data === 'string'
        && msg.data.startsWith('data:audio')
        && msg.data.length <= 2_000_000
        ? msg.data : null;
      if (!data) return; // audio inválido o demasiado grande — se descarta
      const prof = profiles.get(unitId) || {};
      const entry = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        duration: Math.max(1, Math.min(120, Math.round(msg.duration || 0))),
        data,
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'voice', ...entry });
      broadcast({ type: 'voice_msg', role: prof.role || 'driver', ...entry });
    }
  });

  // Cuando una combi se desconecta
  ws.on('close', () => {
    const unitId = clients.get(ws);
    if (unitId) {
      clients.delete(ws);
      console.log(`Desconectado: ${unitId}`);
      // Solo las unidades en ruta salen del mapa; Despacho no estaba en él
      if (units.has(unitId)) {
        units.delete(unitId);
        broadcast({ type: 'unit_left', unitId });
      }
    }
  });

  // El estado y el historial se mandan recién después de un identify
  // válido — una conexión sin autenticar no recibe nada.
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
