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

// better-sqlite3 es un módulo NATIVO: si el binario no coincide con el
// Node que corre (versión, arquitectura o libc), el proceso muere con
// "Segmentation fault" sin dejar mensaje — un crash-loop mudo. Antes de
// cargarlo de verdad lo probamos en un proceso hijo: así un módulo roto
// se convierte en un aviso claro en vez de tumbar el servidor.
function probeNativeSqlite() {
  try {
    require('child_process').execFileSync(
      process.execPath, ['-e', "require('better-sqlite3')"],
      { cwd: __dirname, stdio: 'ignore', timeout: 20000 }
    );
    return null;
  } catch (e) {
    if (e.signal) return `el módulo nativo murió con ${e.signal} (Node ${process.version})`;
    return `no se pudo cargar el módulo nativo (Node ${process.version})`;
  }
}

// Abre la base con red de seguridad: si la ruta configurada no sirve
// (volumen sin montar, permisos), cae a una ruta local y, en última
// instancia, a memoria — el sistema sigue en pie aunque sin persistir.
function openDatabase(Database) {
  const candidates = [];
  if (process.env.DB_FILE) candidates.push(process.env.DB_FILE);
  candidates.push(path.join(__dirname, 'r14.db'));
  candidates.push(':memory:');

  for (const file of candidates) {
    try {
      if (file !== ':memory:') {
        // Solo se crea el directorio si falta: con el volumen ya montado
        // no hace falta tocar nada.
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
      const database = new Database(file);
      // WAL es más rápido, pero algunos volúmenes montados no lo soportan:
      // si falla, se sigue con el journal por defecto en vez de morir.
      try {
        database.pragma('journal_mode = WAL');
      } catch {
        console.warn('WAL no disponible en este disco — journal por defecto');
      }
      if (file === ':memory:') {
        console.warn('⚠ Base en MEMORIA: los datos se pierden al reiniciar.');
      } else {
        console.log('Base de datos:', file);
      }
      return database;
    } catch (e) {
      console.error(`No se pudo abrir la base en ${file}: ${e.message}`);
    }
  }
  return null;
}

const nativeProblem = probeNativeSqlite();

if (nativeProblem) {
  // Sin base no hay logins ni historial: en vez de reiniciar en bucle,
  // el servidor queda en pie explicando el problema.
  console.error('BASE DE DATOS NO DISPONIBLE:', nativeProblem);
  console.error('Suele ser un desajuste de versión de Node: better-sqlite3 requiere Node 22.');
  app.get('/ping', (req, res) => {
    res.status(503).json({ status: 'degradado', error: 'base de datos no disponible', detail: nativeProblem });
  });
  app.use((req, res) => {
    res.status(503).type('html').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>COOP-R14 — base de datos no disponible</title>
<style>body{margin:0;padding:32px 20px;background:#03060a;color:#EAF4FF;
font-family:system-ui,sans-serif;line-height:1.6}.b{max-width:560px;margin:0 auto}
h1{font-size:20px;margin:0 0 12px}code{background:#10161d;border:1px solid #232b36;
border-radius:6px;padding:2px 6px;font-size:14px}.d{color:#8FA8C0;font-size:14px}</style>
<div class="b">
  <h1>Base de datos no disponible</h1>
  <p class="d">${nativeProblem}</p>
  <p>El componente de base de datos no pudo cargarse, así que el servidor no
     puede autenticar ni guardar historial. El servicio quedó en pie para
     poder diagnosticarlo en vez de reiniciarse en bucle.</p>
  <p><strong>Causa habitual:</strong> la versión de Node del deploy no es la 22.
     Verificar que <code>engines</code> y <code>.nvmrc</code> pidan Node 22 y
     volver a desplegar con caché limpia.</p>
</div>`);
  });
  const degraded = http.createServer(app);
  degraded.listen(process.env.PORT || 3001, () => {
    console.error(`Servidor DEGRADADO en puerto ${process.env.PORT || 3001}`);
  });
  return;
}

const Database = require('better-sqlite3');
const db = openDatabase(Database);
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

// Migración: última conexión de cada cuenta, para que Despacho vea de un
// vistazo quién nunca entró (típico de un alta con la clave mal dictada).
if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'lastLogin')) {
  db.exec('ALTER TABLE users ADD COLUMN lastLogin INTEGER');
}

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

// ─── AUDITORÍA ───────────────────────────────────────────────
// Quién hizo qué y cuándo: logins, altas, resets, bajas y SOS.
// Es la visibilidad del nivel de arriba: Despacho administra claves,
// y este registro deja constancia de cada uso de ese poder.

db.exec(`
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,       -- quién lo hizo
    action TEXT NOT NULL,      -- login | login_bloqueado | alta | reset_clave | baja | sos
    target TEXT,               -- sobre quién (si aplica)
    detail TEXT,
    timestamp INTEGER NOT NULL
  )
`);

function audit(actor, action, target, detail) {
  try {
    db.prepare('INSERT INTO audit (actor, action, target, detail, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(actor, action, target || null, detail || null, Date.now());
    db.prepare('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 1000)').run();
  } catch (e) {
    console.error('No se pudo auditar:', e.message);
  }
}

// ─── VUELTAS ─────────────────────────────────────────────────
// Una vuelta = el progreso de ruta llega cerca del final (>0.8) y
// vuelve al inicio. Se guarda duración y velocidad promedio; con eso
// Despacho tiene historial y métricas por unidad para ordenar la rueda.

db.exec(`
  CREATE TABLE IF NOT EXISTS laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unitId TEXT NOT NULL,
    startedAt INTEGER NOT NULL,
    finishedAt INTEGER NOT NULL,
    durationSec INTEGER NOT NULL,
    avgSpeed INTEGER NOT NULL
  )
`);

const lapState = new Map();
// lapState = { unitId → { lapStart, speedSum, speedCount, samples, lastProgress } }

function trackLap(unitId, progress, speed) {
  let st = lapState.get(unitId);
  if (!st) {
    lapState.set(unitId, {
      lapStart: Date.now(), speedSum: 0, speedCount: 0, samples: 0, lastProgress: progress,
    });
    return;
  }
  st.speedSum += speed;
  st.speedCount++;
  st.samples++;

  // Caída brusca del progreso habiendo llegado cerca del final, con un
  // mínimo de muestras: eso es una vuelta completa, no ruido de GPS.
  if (st.lastProgress - progress > 0.5 && st.lastProgress > 0.8 && st.samples >= 5) {
    const now = Date.now();
    const durationSec = Math.round((now - st.lapStart) / 1000);
    const avgSpeed = st.speedCount ? Math.round(st.speedSum / st.speedCount) : 0;
    db.prepare('INSERT INTO laps (unitId, startedAt, finishedAt, durationSec, avgSpeed) VALUES (?, ?, ?, ?, ?)')
      .run(unitId, st.lapStart, now, durationSec, avgSpeed);
    db.prepare('DELETE FROM laps WHERE id NOT IN (SELECT id FROM laps ORDER BY id DESC LIMIT 2000)').run();
    console.log(`Vuelta completada: ${unitId} en ${Math.round(durationSec / 60)} min`);
    lapState.set(unitId, {
      lapStart: now, speedSum: 0, speedCount: 0, samples: 0, lastProgress: progress,
    });
    return;
  }
  st.lastProgress = progress;
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
    if (count >= 5) audit(unitId, 'login_bloqueado', null, '5 intentos fallidos');
    return res.status(401).json({ error: `Contraseña incorrecta · intento ${count} de 5` });
  }

  loginAttempts.delete(unitId);
  const token = createSession(user.unitId);
  db.prepare('UPDATE users SET lastLogin = ? WHERE unitId = ?').run(Date.now(), user.unitId);
  audit(user.unitId, 'login', null, created ? 'primer registro' : null);
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
    SELECT unitId, driverName, role, createdAt, lastLogin FROM users
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
  audit(req.dispatchUser.unitId, 'alta', unitId, driverName !== unitId ? driverName : null);
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
  audit(req.dispatchUser.unitId, 'reset_clave', unitId);
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
  audit(req.dispatchUser.unitId, 'baja', unitId);
  console.log(`Baja de unidad por Despacho: ${unitId}`);
  res.json({ ok: true });
});

// Últimos movimientos: logins, altas, resets, bajas y SOS
app.get('/admin/audit', requireDispatch, (req, res) => {
  const events = db.prepare(
    'SELECT actor, action, target, detail, timestamp FROM audit ORDER BY id DESC LIMIT 100'
  ).all();
  res.json({ events });
});

// Métricas de vueltas por unidad: hoy, última, promedio, mejor, velocidad
app.get('/admin/metrics', requireDispatch, (req, res) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const rows = db.prepare(`
    SELECT unitId,
      COUNT(*) AS lapsTotal,
      SUM(CASE WHEN finishedAt >= @dayStart THEN 1 ELSE 0 END) AS lapsToday,
      ROUND(AVG(durationSec)) AS avgSec,
      MIN(durationSec) AS bestSec,
      ROUND(AVG(avgSpeed)) AS avgSpeed,
      (SELECT durationSec FROM laps l2 WHERE l2.unitId = laps.unitId ORDER BY l2.id DESC LIMIT 1) AS lastSec,
      MAX(finishedAt) AS lastFinish
    FROM laps
    GROUP BY unitId
    ORDER BY lapsToday DESC, lapsTotal DESC
  `).all({ dayStart: dayStart.getTime() });
  res.json({ metrics: rows });
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

// ─── APP WEB ─────────────────────────────────────────────────
// El mismo servidor sirve la app del chofer y el panel de Despacho:
// una sola URL pública para todo (Railway ya da HTTPS). Se busca la
// carpeta project/ en las ubicaciones posibles según cómo se despliegue.
function resolveProjectDir() {
  const candidates = [
    path.join(__dirname, '..', 'project'), // repo completo (lo normal)
    path.join(__dirname, 'project'),        // project/ copiada dentro de server/
    path.join(process.cwd(), 'project'),    // arrancado desde la raíz
  ];
  return candidates.find(dir => fs.existsSync(path.join(dir, 'Prototipo.html'))) || null;
}

const PROJECT_DIR = resolveProjectDir();

if (PROJECT_DIR) {
  // Cuando la app se sirve desde acá, habla con este mismo origen.
  // En hosting estático separado este archivo da 404 y la app cae al
  // default de realtime.js — nada se rompe.
  app.get('/config.js', (req, res) => {
    res.type('application/javascript').send(
      "// Generado por el servidor: el tiempo real vive en este mismo origen\n" +
      "window.REALTIME_SERVER_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;\n"
    );
  });
  app.use(express.static(PROJECT_DIR));
  console.log('Sirviendo la app web desde', PROJECT_DIR);
} else {
  // El deploy no incluye la carpeta project/ — pasa cuando el Root
  // Directory del servicio apunta a server/ en vez de la raíz del repo.
  // En vez del "Cannot GET /" pelado de Express, la página explica qué
  // ajustar: el error se diagnostica solo.
  console.warn('Carpeta project/ no encontrada — solo API/WebSocket.');
  console.warn('En Railway: dejar Root Directory vacío (raíz del repo).');
  app.get('/', (req, res) => {
    res.status(503).type('html').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>COOP-R14 — falta la app web</title>
<style>
  body { margin:0; padding:32px 20px; background:#03060a; color:#EAF4FF;
         font-family: system-ui, sans-serif; line-height:1.6; }
  .box { max-width:560px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#8FA8C0; font-size:14px; margin-bottom:24px; }
  ol { padding-left:22px; } li { margin-bottom:10px; }
  code { background:#10161d; border:1px solid #232b36; border-radius:6px;
         padding:2px 6px; font-size:14px; }
  .ok { color:#39FF14; } .warn { color:#FFD400; }
</style>
<div class="box">
  <h1>El servidor está vivo, falta la app web</h1>
  <div class="sub">API y tiempo real: <span class="ok">funcionando</span> ·
    Archivos de la app: <span class="warn">no encontrados en este deploy</span></div>
  <p>Este deploy no incluye la carpeta <code>project/</code>, así que no hay
     pantallas que servir. Pasa cuando el servicio se construye desde
     <code>server/</code> en vez de la raíz del repositorio.</p>
  <p><strong>Cómo arreglarlo en Railway:</strong></p>
  <ol>
    <li>Abrí el servicio → pestaña <strong>Settings</strong>.</li>
    <li>En <strong>Source</strong>, dejá <strong>Root Directory</strong> vacío.</li>
    <li>Borrá cualquier <em>Custom Start Command</em> escrito a mano.</li>
    <li>Volvé a desplegar (<strong>Redeploy</strong>).</li>
  </ol>
  <p class="sub">Verificación rápida: <code>/ping</code> responde ahora mismo;
     cuando esto quede bien, <code>/</code> mostrará el login del chofer y
     <code>/despacho.html</code> el panel de Despacho.</p>
</div>`);
  });
}

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

      // Detección de vuelta completa a partir del progreso
      trackLap(unitId, msg.routeProgress || 0, msg.speed || 0);

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
      audit(unitId, 'sos', null, alert.lat ? `${alert.lat.toFixed(4)}, ${alert.lng.toFixed(4)}` : null);
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
      lapState.delete(unitId); // la vuelta a medias no cuenta
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
