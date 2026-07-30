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
// profiles = { unitId (persona) → { name, alias, role, routeId, vehicleId } }

const gpsOwner = new Map();
// gpsOwner = { vehicleId → websocket que reporta la posición de ese vehículo }
// Solo una conexión por vehículo: si el chofer y el cobrador reportaran
// los dos, la unidad saltaría entre los dos celulares.

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

// ─── RUTAS ───────────────────────────────────────────────────
// Cada ruta es un mundo aparte: sus unidades, sus brechas, su chat.
// Cada una define su objetivo de brecha y cuánto dura el recorrido,
// porque no son iguales entre rutas.
db.exec(`
  CREATE TABLE IF NOT EXISTS routes (
    routeId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    targetGapMin REAL NOT NULL DEFAULT 2,
    durationMin INTEGER NOT NULL DEFAULT 50,
    createdAt INTEGER NOT NULL
  )
`);

const DEFAULT_ROUTE = process.env.DEFAULT_ROUTE || 'R-14';

// Agrega una columna solo si falta: así las bases ya existentes migran
// solas sin perder nada.
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

if (db.prepare('SELECT COUNT(*) AS c FROM routes').get().c === 0) {
  db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(DEFAULT_ROUTE, 'Terminal Sur ↔ Huancané', 2, 50, Date.now());
  console.log(`Ruta inicial creada: ${DEFAULT_ROUTE}`);
}

function routeOf(routeId) {
  return db.prepare('SELECT * FROM routes WHERE routeId = ?').get(routeId) || null;
}

function allRoutes() {
  return db.prepare('SELECT * FROM routes ORDER BY routeId').all();
}

// ─── GEOMETRÍA DE LA RUTA ────────────────────────────────────
// El recorrido de cada ruta como una polilínea de puntos GPS, en orden.
// Antes el progreso era una proyección lineal entre dos puntos (Terminal Sur
// → Huancané): no seguía las calles, así que las brechas eran aproximaciones.
// Con la geometría real se proyecta la posición sobre el trazado y el
// progreso pasa a ser distancia recorrida sobre distancia total.
db.exec(`
  CREATE TABLE IF NOT EXISTS route_points (
    routeId TEXT NOT NULL,
    seq INTEGER NOT NULL,       -- orden del punto en el recorrido
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    PRIMARY KEY (routeId, seq)
  )
`);

// Metros entre dos puntos GPS. A escala de una ruta urbana alcanza con
// aplanar la Tierra: se corrige la longitud por el coseno de la latitud.
const METROS_POR_GRADO = 111_320;
function metrosEntre(aLat, aLng, bLat, bLng) {
  const kLng = Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  const dLat = (bLat - aLat) * METROS_POR_GRADO;
  const dLng = (bLng - aLng) * METROS_POR_GRADO * kLng;
  return Math.hypot(dLat, dLng);
}

// Geometrías en memoria: { routeId → { puntos, acumulado, largoM } }
// acumulado[i] = metros desde el inicio hasta el punto i, para no recalcular
// en cada posición GPS (llegan cada 3 s por unidad).
const geometrias = new Map();

function cargarGeometria(routeId) {
  const puntos = db.prepare('SELECT lat, lng FROM route_points WHERE routeId = ? ORDER BY seq').all(routeId);
  if (puntos.length < 2) { geometrias.delete(routeId); return null; }
  const acumulado = [0];
  for (let i = 1; i < puntos.length; i++) {
    acumulado[i] = acumulado[i - 1] +
      metrosEntre(puntos[i - 1].lat, puntos[i - 1].lng, puntos[i].lat, puntos[i].lng);
  }
  const geo = { puntos, acumulado, largoM: acumulado[acumulado.length - 1] };
  geometrias.set(routeId, geo);
  return geo;
}

function geometriaDe(routeId) {
  if (geometrias.has(routeId)) return geometrias.get(routeId);
  return cargarGeometria(routeId);
}

// Todas las geometrías se cargan al arrancar
for (const r of allRoutes()) cargarGeometria(r.routeId);

// Proyecta una posición sobre el recorrido.
// Devuelve { progreso 0..1, desvioM } o null si la ruta no tiene geometría.
// desvioM es a cuántos metros del trazado está la unidad: sirve para saber
// si se salió de la ruta (y para no ensuciar el progreso con un GPS malo).
function proyectarEnRuta(routeId, lat, lng) {
  const geo = geometriaDe(routeId);
  if (!geo) return null;
  const { puntos, acumulado, largoM } = geo;

  let mejor = { dist2: Infinity, metros: 0 };
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i], b = puntos[i + 1];
    // Se trabaja en metros locales para que el eje X no pese menos que el Y
    const kLng = Math.cos(a.lat * Math.PI / 180);
    const ax = 0, ay = 0;
    const bx = (b.lng - a.lng) * METROS_POR_GRADO * kLng;
    const by = (b.lat - a.lat) * METROS_POR_GRADO;
    const px = (lng - a.lng) * METROS_POR_GRADO * kLng;
    const py = (lat - a.lat) * METROS_POR_GRADO;

    const largo2 = bx * bx + by * by;
    // t = cuánto del segmento se recorrió, recortado a [0,1] para que la
    // proyección no se escape más allá de los extremos
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largo2));
    const cx = ax + t * bx, cy = ay + t * by;
    const dist2 = (px - cx) ** 2 + (py - cy) ** 2;
    if (dist2 < mejor.dist2) {
      mejor = { dist2, metros: acumulado[i] + t * Math.sqrt(largo2) };
    }
  }
  return {
    progreso: largoM > 0 ? Math.max(0, Math.min(1, mejor.metros / largoM)) : 0,
    desvioM: Math.sqrt(mejor.dist2),
  };
}

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

// Los mensajes viejos (de cuando había una sola ruta) pasan a la ruta inicial
if (addColumnIfMissing('messages', 'routeId', 'TEXT')) {
  db.prepare('UPDATE messages SET routeId = ? WHERE routeId IS NULL').run(DEFAULT_ROUTE);
  console.log('Historial migrado a la ruta ' + DEFAULT_ROUTE);
}

// De qué vehículo salió el mensaje, para que el historial diga lo mismo
// que se vio en vivo (antes de esto, unitId era a la vez persona y unidad)
if (addColumnIfMissing('messages', 'vehicleId', 'TEXT')) {
  db.prepare('UPDATE messages SET vehicleId = unitId WHERE vehicleId IS NULL').run();
}

// Destinatario de un mensaje privado. Es un VEHÍCULO, no una persona: la
// conversación es "Despacho ↔ esa combi", así que la ven tanto el chofer como
// su cobrador. NULL = mensaje del grupo, lo ve toda la ruta.
addColumnIfMissing('messages', 'toVehicleId', 'TEXT');

const HISTORY_MAX = 200;   // mensajes que recibe un cliente al conectarse
const KEEP_ROWS = 1000;    // filas totales que retiene la base
const VOICE_KEEP = 30;     // notas de voz que conservan su audio

const insertStmt = db.prepare(`
  INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, toVehicleId, text, duration, data, lat, lng, timestamp)
  VALUES (@kind, @unitId, @driverName, @routeId, @vehicleId, @toVehicleId, @text, @duration, @data, @lat, @lng, @timestamp)
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
    insertStmt.run({ text: null, duration: null, data: null, lat: null, lng: null,
      vehicleId: null, toVehicleId: null, ...item });
    pruneRowsStmt.run();
    pruneVoiceStmt.run();
  } catch (e) {
    console.error('No se pudo guardar el mensaje:', e.message);
  }
}

// Historial de UNA ruta: un chofer nunca ve la conversación de otra
// Historial de la ruta. 'verPrivadosDe' decide qué conversación privada se
// incluye: para una combi, la suya; para Despacho, todas las de su ruta
// ('*'); sin eso, solo el grupo. Un chofer nunca ve lo privado de otro.
function recentHistory(routeId, verPrivadosDe = null) {
  // El rol sale de la tabla users (los mensajes viejos no lo guardan)
  return db.prepare(`
    SELECT m.kind, m.unitId, m.driverName, m.vehicleId, m.toVehicleId, m.text,
           m.duration, m.data, m.lat, m.lng, m.timestamp,
           COALESCE(u.role, 'driver') AS role
    FROM (
      SELECT * FROM messages
      WHERE routeId = @routeId
        AND (toVehicleId IS NULL
             OR @todos = 1
             OR toVehicleId = @propio)
      ORDER BY id DESC LIMIT ${HISTORY_MAX}
    ) m
    LEFT JOIN users u ON u.unitId = m.unitId
    ORDER BY m.id ASC
  `).all({
    routeId,
    todos: verPrivadosDe === '*' ? 1 : 0,
    propio: verPrivadosDe && verPrivadosDe !== '*' ? verPrivadosDe : '',
  });
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
addColumnIfMissing('users', 'lastLogin', 'INTEGER');

// Migración a multi-ruta. En users, routeId significa:
//   chofer      → la ruta en la que trabaja (obligatoria)
//   dispatch    → la ruta que administra, o NULL = supervisor de todas
if (addColumnIfMissing('users', 'routeId', 'TEXT')) {
  db.prepare("UPDATE users SET routeId = ? WHERE role = 'driver' AND routeId IS NULL")
    .run(DEFAULT_ROUTE);
  console.log('Choferes existentes asignados a la ruta ' + DEFAULT_ROUTE);
}

// ─── PERSONAS Y VEHÍCULOS ────────────────────────────────────
// Antes la cuenta ERA la unidad: el mismo `M-05` era el vehículo, el
// login y quien reportaba GPS. Con eso, si el chofer y el cobrador
// entraban con la misma clave, las dos conexiones reportaban posición
// para la misma unidad y se pisaban.
//
// Ahora se separan tres cosas:
//   users     → PERSONAS (chofer, cobrador, despacho) con su propia clave
//   vehicles  → los vehículos, que son los que aparecen en el mapa
//   vehicleId → a qué vehículo está asignada cada persona
//
// `users.unitId` sigue siendo el identificador de login para no invalidar
// las claves ya repartidas; lo que cambia es que ya no significa "el
// vehículo" sino "esta persona".

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    vehicleId TEXT PRIMARY KEY,
    label TEXT,                -- placa o nombre visible, opcional
    routeId TEXT,
    createdAt INTEGER NOT NULL
  )
`);

// name es OBLIGATORIO (el nombre real, para los registros de la empresa)
// y alias es OPCIONAL (como lo llaman en la ruta: "el Chino", "Pocho").
addColumnIfMissing('users', 'name', 'TEXT');
addColumnIfMissing('users', 'alias', 'TEXT');
// 'driver' | 'collector' | 'dispatch'
addColumnIfMissing('users', 'vehicleId', 'TEXT');

// Migración sin romper nada: cada cuenta existente era a la vez persona y
// vehículo, así que se crea el vehículo con su mismo código y la persona
// queda asignada ahí. Los choferes siguen entrando con la clave de antes.
if (db.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c === 0) {
  const previos = db.prepare("SELECT unitId, driverName, routeId FROM users WHERE role = 'driver'").all();
  const insVeh = db.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, createdAt) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const p of previos) {
      insVeh.run(p.unitId, null, p.routeId || DEFAULT_ROUTE, Date.now());
      db.prepare('UPDATE users SET vehicleId = ? WHERE unitId = ?').run(p.unitId, p.unitId);
    }
  })();
  if (previos.length) console.log(`Migrados ${previos.length} vehículos desde las cuentas existentes`);
}

// El nombre real: si no había, se usa lo que hubiera en driverName
db.prepare(`UPDATE users SET name = COALESCE(NULLIF(name, ''), NULLIF(driverName, ''), unitId)
            WHERE name IS NULL OR name = ''`).run();

// Cómo se muestra a una persona: el alias si lo tiene, el nombre si no
function displayName(p) {
  if (!p) return 'Conductor';
  return p.alias || p.name || p.driverName || p.unitId || 'Conductor';
}

function vehicleOf(vehicleId) {
  return db.prepare('SELECT * FROM vehicles WHERE vehicleId = ?').get(vehicleId) || null;
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
  return db.prepare(
    'SELECT unitId, driverName, name, alias, role, routeId, vehicleId FROM users WHERE unitId = ?'
  ).get(s.unitId) || null;
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
if (process.env.DISPATCH_PASSWORD && process.env.DISPATCH_PASSWORD.length < 4) {
  // El login exige 4 caracteres: con una clave más corta la cuenta quedaría
  // creada pero imposible de usar. Mejor avisar y no tocar la que había.
  console.error('DISPATCH_PASSWORD tiene menos de 4 caracteres: el login la va a ' +
    'rechazar siempre. La cuenta DESPACHO queda como estaba — poné una clave más larga.');
} else if (process.env.DISPATCH_PASSWORD) {
  const hash = hashPassword(process.env.DISPATCH_PASSWORD);
  const exists = db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(DISPATCH_ID);
  if (exists) {
    db.prepare("UPDATE users SET passHash = ?, role = 'dispatch' WHERE unitId = ?").run(hash, DISPATCH_ID);
  } else {
    db.prepare('INSERT INTO users (unitId, driverName, name, role, passHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(DISPATCH_ID, 'Despacho', 'Despacho', 'dispatch', hash, Date.now());
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

addColumnIfMissing('audit', 'routeId', 'TEXT');

function audit(actor, action, target, detail, routeId) {
  try {
    db.prepare('INSERT INTO audit (actor, action, target, detail, routeId, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(actor, action, target || null, detail || null, routeId || null, Date.now());
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
    unitId TEXT NOT NULL,      -- el VEHÍCULO (la vuelta es del vehículo,
                               -- no de la persona que iba manejando)
    startedAt INTEGER NOT NULL,
    finishedAt INTEGER NOT NULL,
    durationSec INTEGER NOT NULL,
    avgSpeed INTEGER NOT NULL
  )
`);

addColumnIfMissing('laps', 'routeId', 'TEXT');
if (db.prepare('SELECT COUNT(*) AS c FROM laps WHERE routeId IS NULL').get().c > 0) {
  db.prepare('UPDATE laps SET routeId = ? WHERE routeId IS NULL').run(DEFAULT_ROUTE);
}

const lapState = new Map();
// lapState = { vehicleId → { lapStart, speedSum, speedCount, samples, lastProgress } }

function trackLap(unitId, routeId, progress, speed) {
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
    db.prepare('INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed) VALUES (?, ?, ?, ?, ?, ?)')
      .run(unitId, routeId || null, st.lapStart, now, durationSec, avgSpeed);
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
    // El DESPACHO de arranque queda como supervisor (routeId null): ve
    // todas las rutas. Una unidad auto-registrada va a la ruta inicial.
    const routeId = role === 'dispatch' ? null : DEFAULT_ROUTE;
    db.prepare('INSERT INTO users (unitId, driverName, name, role, routeId, passHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(unitId, driverName, driverName, role, routeId, hashPassword(password), Date.now());
    user = { unitId, driverName, name: driverName, role, routeId };
    created = true;
    console.log(`${role === 'dispatch' ? 'Despacho' : 'Unidad'} registrado: ${unitId}`);
  } else if (!verifyPassword(password, user.passHash)) {
    const count = (a?.count || 0) + 1;
    loginAttempts.set(unitId, { count, until: count >= 5 ? Date.now() + 300_000 : 0 });
    if (count >= 5) audit(unitId, 'login_bloqueado', null, '5 intentos fallidos', user.routeId);
    return res.status(401).json({ error: `Contraseña incorrecta · intento ${count} de 5` });
  }

  loginAttempts.delete(unitId);
  const token = createSession(user.unitId);
  db.prepare('UPDATE users SET lastLogin = ? WHERE unitId = ?').run(Date.now(), user.unitId);
  audit(user.unitId, 'login', null, created ? 'primer registro' : null, user.routeId);
  const ruta = user.routeId ? routeOf(user.routeId) : null;
  res.json({
    token, unitId: user.unitId,
    // Cómo mostrarlo en pantalla: el alias si lo tiene, el nombre si no
    driverName: displayName(user),
    name: user.name || user.driverName || user.unitId,
    alias: user.alias || null,
    role: user.role,
    vehicleId: user.vehicleId || null,
    routeId: user.routeId || null,
    routeName: ruta ? ruta.name : null,
    supervisor: user.role === 'dispatch' && !user.routeId,
    created,
  });
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
  // Alcance del despachador: un supervisor (dispatch sin ruta) administra
  // todas; uno de ruta solo la suya. `scope` es null para el supervisor.
  req.scope = user.routeId || null;
  next();
}

// Solo el supervisor puede crear rutas o tocar otras rutas
function requireSupervisor(req, res, next) {
  requireDispatch(req, res, () => {
    if (req.scope) {
      return res.status(403).json({ error: 'Requiere una cuenta supervisora (sin ruta asignada)' });
    }
    next();
  });
}

// La ruta sobre la que va a operar: el supervisor puede elegirla, un
// despachador de ruta siempre trabaja sobre la suya.
function rutaObjetivo(req) {
  if (req.scope) return req.scope;
  const pedida = String(req.body?.routeId || req.query?.routeId || '').trim();
  if (pedida && routeOf(pedida)) return pedida;
  const rs = allRoutes();
  return rs[0] ? rs[0].routeId : DEFAULT_ROUTE;
}

// ─── RUTAS (alta y listado) ──────────────────────────────────
app.get('/admin/routes', requireDispatch, (req, res) => {
  const rutas = allRoutes()
    .filter(r => !req.scope || r.routeId === req.scope)
    .map(r => {
      const geo = geometriaDe(r.routeId);
      return {
        ...r,
        unidades: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'driver' AND routeId = ?").get(r.routeId).c,
        enLinea: Array.from(units.values()).filter(u => u.routeId === r.routeId).length,
        // Recorrido cargado: cuántos puntos y cuántos metros
        puntos: geo ? geo.puntos.length : 0,
        largoM: geo ? Math.round(geo.largoM) : 0,
      };
    });
  res.json({ routes: rutas, supervisor: !req.scope });
});

app.post('/admin/routes', requireSupervisor, (req, res) => {
  const routeId = String(req.body?.routeId || '').trim().slice(0, 24);
  const name = String(req.body?.name || '').trim().slice(0, 60) || routeId;
  const targetGapMin = Number(req.body?.targetGapMin);
  const durationMin = Number(req.body?.durationMin);
  if (!routeId) return res.status(400).json({ error: 'Falta el código de la ruta (ej. R-15)' });
  if (routeOf(routeId)) return res.status(409).json({ error: 'Esa ruta ya existe' });
  const gap = Number.isFinite(targetGapMin) && targetGapMin > 0 ? targetGapMin : 2;
  const dur = Number.isFinite(durationMin) && durationMin > 0 ? Math.round(durationMin) : 50;
  db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(routeId, name, gap, dur, Date.now());
  audit(req.dispatchUser.unitId, 'alta_ruta', routeId, `${name} · objetivo ${gap} min · ${dur} min de recorrido`, routeId);
  console.log(`Ruta creada: ${routeId} (${name})`);
  res.json({ ok: true, routeId });
});

// ─── RECORRIDO DE LA RUTA (puntos GPS) ───────────────────────
app.get('/admin/routes/:routeId/points', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  if (req.scope && req.scope !== routeId) {
    return res.status(403).json({ error: 'Esa ruta no es tuya' });
  }
  if (!routeOf(routeId)) return res.status(404).json({ error: 'Esa ruta no existe' });
  const puntos = db.prepare('SELECT lat, lng FROM route_points WHERE routeId = ? ORDER BY seq').all(routeId);
  const geo = geometriaDe(routeId);
  res.json({ routeId, points: puntos, largoM: geo ? Math.round(geo.largoM) : 0 });
});

// Guarda el recorrido completo de una vez: llega la lista entera de puntos y
// reemplaza la anterior. Es más simple y más seguro que editar punto por
// punto — el panel manda lo que quedó dibujado en el mapa.
app.put('/admin/routes/:routeId/points', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  if (req.scope && req.scope !== routeId) {
    return res.status(403).json({ error: 'Esa ruta no es tuya' });
  }
  if (!routeOf(routeId)) return res.status(404).json({ error: 'Esa ruta no existe' });

  const crudos = Array.isArray(req.body?.points) ? req.body.points : null;
  if (!crudos) return res.status(400).json({ error: 'Faltan los puntos del recorrido' });
  if (crudos.length > 2000) {
    return res.status(400).json({ error: 'Demasiados puntos: el tope es 2000' });
  }

  // Se validan uno por uno: un punto fuera de rango arruinaría el cálculo de
  // todas las brechas de la ruta, así que se rechaza el lote entero.
  const puntos = [];
  for (const p of crudos) {
    const lat = Number(p?.lat), lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Hay un punto con coordenadas inválidas' });
    }
    puntos.push({ lat, lng });
  }
  // Vaciar el recorrido es válido (vuelve a la estimación lineal), pero con
  // un solo punto no hay trazado posible.
  if (puntos.length === 1) {
    return res.status(400).json({ error: 'Un recorrido necesita al menos 2 puntos' });
  }

  const guardar = db.transaction(() => {
    db.prepare('DELETE FROM route_points WHERE routeId = ?').run(routeId);
    const ins = db.prepare('INSERT INTO route_points (routeId, seq, lat, lng) VALUES (?, ?, ?, ?)');
    puntos.forEach((p, i) => ins.run(routeId, i, p.lat, p.lng));
  });
  guardar();

  const geo = cargarGeometria(routeId);
  const largoKm = geo ? (geo.largoM / 1000).toFixed(2) : '0';
  audit(req.dispatchUser.unitId, 'recorrido', routeId,
    puntos.length ? `${puntos.length} puntos · ${largoKm} km` : 'recorrido borrado', routeId);
  console.log(`Recorrido de ${routeId}: ${puntos.length} puntos (${largoKm} km)`);

  // Los mapas de esa ruta reciben el trazado nuevo, y las brechas se
  // recalculan con él al instante
  const geoMsg = mensajeGeometria(routeId);
  for (const [ws, mirando] of watching) {
    if (mirando === routeId && ws.readyState === 1) {
      try { ws.send(geoMsg); } catch {}
    }
  }
  scheduleStateBroadcast(routeId, true);
  res.json({ ok: true, points: puntos.length, largoM: geo ? Math.round(geo.largoM) : 0 });
});

// ─── VEHÍCULOS ───────────────────────────────────────────────
app.get('/admin/vehicles', requireDispatch, (req, res) => {
  const vehiculos = db.prepare(`
    SELECT vehicleId, label, routeId, createdAt FROM vehicles
    WHERE @scope IS NULL OR routeId = @scope
    ORDER BY routeId, vehicleId
  `).all({ scope: req.scope }).map(v => ({
    ...v,
    enLinea: units.has(v.vehicleId),
    // Quién va arriba ahora mismo (chofer y/o cobrador)
    tripulacion: Array.from(clients.values())
      .map(id => profiles.get(id))
      .filter(p => p && p.vehicleId === v.vehicleId)
      .map(p => ({ nombre: p.driverName, rol: p.role })),
  }));
  res.json({ vehicles: vehiculos, supervisor: !req.scope });
});

app.post('/admin/vehicles', requireDispatch, (req, res) => {
  const vehicleId = String(req.body?.vehicleId || '').trim().slice(0, 24);
  const label = String(req.body?.label || '').trim().slice(0, 40) || null;
  const routeId = rutaObjetivo(req);
  if (!vehicleId) return res.status(400).json({ error: 'Falta el código del vehículo (ej. M-21)' });
  if (!routeOf(routeId)) return res.status(400).json({ error: 'Esa ruta no existe' });
  if (vehicleOf(vehicleId)) return res.status(409).json({ error: 'Ese vehículo ya existe' });
  db.prepare('INSERT INTO vehicles (vehicleId, label, routeId, createdAt) VALUES (?, ?, ?, ?)')
    .run(vehicleId, label, routeId, Date.now());
  audit(req.dispatchUser.unitId, 'alta_vehiculo', vehicleId, `ruta ${routeId}`, routeId);
  console.log(`Vehículo creado: ${vehicleId} en ${routeId}`);
  res.json({ ok: true, vehicleId, routeId });
});

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
  // Un despachador de ruta solo ve su gente (y las cuentas de despacho);
  // el supervisor ve todo.
  const users = db.prepare(`
    SELECT unitId, driverName, name, alias, role, routeId, vehicleId, createdAt, lastLogin FROM users
    WHERE @scope IS NULL OR routeId = @scope OR role = 'dispatch'
    ORDER BY CASE role WHEN 'dispatch' THEN 0 ELSE 1 END, routeId, vehicleId, unitId
  `).all({ scope: req.scope });
  res.json({
    users: users.map(u => ({ ...u, online: online.has(u.unitId) })),
    supervisor: !req.scope,
    scope: req.scope,
  });
});

// Alta de PERSONAS: el nombre real es obligatorio (queda en los registros
// de la empresa) y el alias es opcional (como la llaman en la ruta).
app.post('/admin/users', requireDispatch, (req, res) => {
  const unitId = String(req.body?.unitId || '').trim().slice(0, 24);
  const name = String(req.body?.name || req.body?.driverName || '').trim().slice(0, 60);
  const alias = String(req.body?.alias || '').trim().slice(0, 30) || null;
  const rolPedido = String(req.body?.personRole || 'driver');
  const role = rolPedido === 'collector' ? 'collector' : 'driver';
  const password = String(req.body?.password || '');
  const routeId = rutaObjetivo(req);
  const vehicleId = String(req.body?.vehicleId || '').trim().slice(0, 24) || null;

  if (!unitId) return res.status(400).json({ error: 'Falta el usuario con el que va a entrar' });
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'La contraseña necesita entre 4 y 64 caracteres' });
  }
  if (!routeOf(routeId)) return res.status(400).json({ error: 'Esa ruta no existe' });
  if (db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(unitId)) {
    return res.status(409).json({ error: 'Ya existe alguien con ese usuario' });
  }
  // El vehículo tiene que existir; si no se indica y es chofer, se crea uno
  // con su mismo código (el caso habitual: el chofer y su combi).
  let vehiculoFinal = vehicleId;
  if (vehiculoFinal) {
    const veh = vehicleOf(vehiculoFinal);
    if (!veh) return res.status(400).json({ error: `El vehículo ${vehiculoFinal} no existe` });
    if (req.scope && veh.routeId !== req.scope) {
      return res.status(403).json({ error: 'Ese vehículo pertenece a otra ruta' });
    }
  } else if (role === 'driver') {
    vehiculoFinal = unitId;
    if (!vehicleOf(vehiculoFinal)) {
      db.prepare('INSERT INTO vehicles (vehicleId, label, routeId, createdAt) VALUES (?, ?, ?, ?)')
        .run(vehiculoFinal, null, routeId, Date.now());
    }
  } else {
    return res.status(400).json({ error: 'Un cobrador necesita un vehículo asignado' });
  }

  db.prepare(`
    INSERT INTO users (unitId, driverName, name, alias, role, routeId, vehicleId, passHash, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(unitId, alias || name, name, alias, role, routeId, vehiculoFinal, hashPassword(password), Date.now());

  const quien = alias ? `${name} (${alias})` : name;
  audit(req.dispatchUser.unitId, 'alta', unitId,
    `${quien} · ${role === 'collector' ? 'cobrador' : 'chofer'} · ${vehiculoFinal} · ruta ${routeId}`, routeId);
  console.log(`Alta de ${role}: ${quien} en ${vehiculoFinal} (${routeId})`);
  res.json({ ok: true, unitId, routeId, vehicleId: vehiculoFinal, role });
});

// Un despachador de ruta solo puede administrar cuentas de SU ruta
function cuentaEnAlcance(req, unitId) {
  const u = db.prepare('SELECT unitId, role, routeId FROM users WHERE unitId = ?').get(unitId);
  if (!u) return { error: 404, msg: 'Esa unidad no existe' };
  if (req.scope && u.routeId !== req.scope) {
    return { error: 403, msg: 'Esa unidad pertenece a otra ruta' };
  }
  return { user: u };
}

// Corregir la identidad de alguien ya cargado: las cuentas que venían del
// modelo viejo quedaron con el código de la unidad como nombre, y un alias
// se pone o se saca sin dar de baja a nadie.
app.post('/admin/users/:unitId/identity', requireDispatch, (req, res) => {
  const unitId = String(req.params.unitId);
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const alias = String(req.body?.alias || '').trim().slice(0, 30) || null;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const chequeo = cuentaEnAlcance(req, unitId);
  if (chequeo.error) return res.status(chequeo.error).json({ error: chequeo.msg });
  // driverName es lo que se muestra: el alias si lo tiene, el nombre si no
  db.prepare('UPDATE users SET name = ?, alias = ?, driverName = ? WHERE unitId = ?')
    .run(name, alias, alias || name, unitId);

  // Al que está conectado se le actualiza el nombre en vivo, en su perfil y
  // en la unidad del mapa: si no, seguiría firmando el chat como antes.
  const prof = profiles.get(unitId);
  if (prof) {
    prof.name = name;
    prof.alias = alias;
    prof.driverName = alias || name;
    const veh = prof.vehicleId ? units.get(prof.vehicleId) : null;
    if (veh && prof.role === 'driver') {
      veh.driverName = alias || name;
      scheduleStateBroadcast(veh.routeId, true);
    }
  }
  audit(req.dispatchUser.unitId, 'editar_identidad', unitId,
    alias ? `${name} (${alias})` : name, chequeo.user.routeId);
  res.json({ ok: true, name, alias });
});

app.post('/admin/users/:unitId/password', requireDispatch, (req, res) => {
  const unitId = String(req.params.unitId);
  const password = String(req.body?.password || '');
  if (password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'La contraseña nueva necesita mínimo 4 caracteres' });
  }
  const chequeo = cuentaEnAlcance(req, unitId);
  if (chequeo.error) return res.status(chequeo.error).json({ error: chequeo.msg });
  db.prepare('UPDATE users SET passHash = ? WHERE unitId = ?').run(hashPassword(password), unitId);
  // Las sesiones viejas dejan de valer y la unidad conectada vuelve al login
  kickUnit(unitId, 'Despacho reseteó tu contraseña. Ingresá con la nueva.');
  audit(req.dispatchUser.unitId, 'reset_clave', unitId, null, chequeo.user.routeId);
  console.log(`Contraseña reseteada por Despacho: ${unitId}`);
  res.json({ ok: true });
});

app.delete('/admin/users/:unitId', requireDispatch, (req, res) => {
  const unitId = String(req.params.unitId);
  if (unitId === DISPATCH_ID) {
    return res.status(400).json({ error: 'La cuenta de Despacho no se puede eliminar' });
  }
  const chequeo = cuentaEnAlcance(req, unitId);
  if (chequeo.error) return res.status(chequeo.error).json({ error: chequeo.msg });
  db.prepare('DELETE FROM users WHERE unitId = ?').run(unitId);
  kickUnit(unitId, 'Tu acceso fue dado de baja por Despacho.');
  audit(req.dispatchUser.unitId, 'baja', unitId, null, chequeo.user.routeId);
  console.log(`Baja de unidad por Despacho: ${unitId}`);
  res.json({ ok: true });
});

// Últimos movimientos: logins, altas, resets, bajas y SOS
app.get('/admin/audit', requireDispatch, (req, res) => {
  const events = db.prepare(`
    SELECT actor, action, target, detail, routeId, timestamp FROM audit
    WHERE @scope IS NULL OR routeId = @scope
    ORDER BY id DESC LIMIT 100
  `).all({ scope: req.scope });
  res.json({ events });
});

// Métricas de vueltas por unidad: hoy, última, promedio, mejor, velocidad
app.get('/admin/metrics', requireDispatch, (req, res) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  // El supervisor puede pedir una ruta con ?routeId=; sin eso ve todas
  const filtro = req.scope || String(req.query?.routeId || '').trim() || null;
  const rows = db.prepare(`
    SELECT unitId, routeId,
      COUNT(*) AS lapsTotal,
      SUM(CASE WHEN finishedAt >= @dayStart THEN 1 ELSE 0 END) AS lapsToday,
      ROUND(AVG(durationSec)) AS avgSec,
      MIN(durationSec) AS bestSec,
      ROUND(AVG(avgSpeed)) AS avgSpeed,
      (SELECT durationSec FROM laps l2 WHERE l2.unitId = laps.unitId ORDER BY l2.id DESC LIMIT 1) AS lastSec,
      MAX(finishedAt) AS lastFinish
    FROM laps
    WHERE @filtro IS NULL OR routeId = @filtro
    GROUP BY unitId
    ORDER BY lapsToday DESC, lapsTotal DESC
  `).all({ dayStart: dayStart.getTime(), filtro });
  res.json({ metrics: rows, routeId: filtro });
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
      const vehicleId = user.vehicleId || (user.role === 'driver' ? user.unitId : null);
      profiles.set(user.unitId, {
        driverName: displayName(user),
        name: user.name || user.driverName || user.unitId,
        alias: user.alias || null,
        role: user.role || 'driver',
        routeId: user.routeId || null,
        vehicleId,
      });

      // Un chofer mira su ruta; un despachador de ruta, la que administra;
      // un supervisor (dispatch sin ruta) arranca en la primera y cambia
      // con el mensaje 'watch'.
      const rutas = allRoutes();
      const rutaInicial = user.routeId || (rutas[0] ? rutas[0].routeId : DEFAULT_ROUTE);
      watching.set(ws, rutaInicial);

      // Despacho observa y habla, pero NO va en un vehículo: no entra al
      // mapa ni al cálculo de brechas.
      if (user.role !== 'dispatch' && vehicleId) {
        const yaEstaba = units.has(vehicleId);
        const veh = vehicleOf(vehicleId);
        const previo = units.get(vehicleId);
        units.set(vehicleId, {
          ...(previo || { lat: null, lng: null, speed: 0, routeProgress: 0 }),
          unitId: vehicleId,
          label: veh?.label || null,
          // El nombre que se ve en el mapa es el del CHOFER: que el cobrador
          // se conecte no cambia quién maneja la unidad.
          driverName: user.role === 'driver'
            ? displayName(user)
            : (previo?.driverName || vehicleId),
          routeId: user.routeId || veh?.routeId || DEFAULT_ROUTE,
          timestamp: Date.now(),
        });

        // Solo UNA conexión reporta la posición de cada vehículo. El
        // cobrador nunca; entre choferes, manda el último que entra
        // (es el relevo de turno), y al anterior se le avisa.
        if (user.role === 'driver') {
          const anterior = gpsOwner.get(vehicleId);
          if (anterior && anterior !== ws && anterior.readyState === 1) {
            try {
              anterior.send(JSON.stringify({
                type: 'gps_role', reporting: false,
                reason: 'Otro chofer tomó la unidad. Seguís viendo todo, pero tu GPS ya no se usa.',
              }));
            } catch {}
          }
          gpsOwner.set(vehicleId, ws);
          ws.send(JSON.stringify({ type: 'gps_role', reporting: true }));
        } else {
          // Acompañante: ve todo, no aporta posición
          ws.send(JSON.stringify({ type: 'gps_role', reporting: false, reason: 'Modo acompañante' }));
        }

        if (!yaEstaba) {
          broadcastToRoute(rutaInicial, { type: 'unit_joined', unitId: vehicleId });
          scheduleStateBroadcast(rutaInicial, true); // se ve al instante
        }
      }
      const quien = `${displayName(user)}${vehicleId ? ' en ' + vehicleId : ''}`;
      console.log(`${user.role === 'dispatch' ? 'Despacho conectado' : `${user.role === 'collector' ? 'Cobrador' : 'Chofer'} identificado`}: ${quien} (${rutaInicial})`);

      // Recién ahora recibe el estado y la conversación en curso
      ws.send(JSON.stringify({ type: 'state', ...buildState(rutaInicial) }));
      // Qué conversación privada le corresponde ver: Despacho todas las de
      // su ruta, una combi la suya, nadie la de otro.
      const privados = user.role === 'dispatch' ? '*' : (vehicleId || null);
      ws.send(JSON.stringify({
        type: 'chat_history', routeId: rutaInicial,
        items: recentHistory(rutaInicial, privados),
      }));
      ws.send(mensajeGeometria(rutaInicial));
      // Los supervisores además reciben la lista de rutas para el selector
      if (esSupervisor(ws)) {
        ws.send(JSON.stringify({ type: 'routes', routes: rutas, watching: rutaInicial }));
      }
    }

    // TIPO: watch — un supervisor cambia de ruta en el panel
    if (msg.type === 'watch') {
      if (!esSupervisor(ws)) return;         // un chofer no elige ruta
      if (!routeOf(msg.routeId)) return;     // ruta inexistente
      watching.set(ws, msg.routeId);
      ws.send(JSON.stringify({ type: 'state', ...buildState(msg.routeId) }));
      // Solo un supervisor llega acá, y ve los privados de la ruta que mira
      ws.send(JSON.stringify({
        type: 'chat_history', routeId: msg.routeId,
        items: recentHistory(msg.routeId, '*'),
      }));
      ws.send(mensajeGeometria(msg.routeId));
    }

    // TIPO: posición GPS — llega cada ~3 segundos desde cada combi
    if (msg.type === 'gps') {
      const personId = clients.get(ws);
      if (!personId) return;
      const prof = profiles.get(personId);
      const vehicleId = prof?.vehicleId;
      if (!vehicleId) return;

      // Se acepta la posición SOLO del reportero designado del vehículo.
      // El celular del cobrador (o del chofer relevado) sigue conectado y
      // recibiendo todo, pero su GPS se ignora: así la unidad no salta.
      if (gpsOwner.get(vehicleId) !== ws) return;

      const unit = units.get(vehicleId) || {};
      const routeId = unit.routeId || prof.routeId || DEFAULT_ROUTE;

      // El progreso lo calcula EL SERVIDOR, que es donde vive la geometría:
      // así cargar o corregir el recorrido tiene efecto al instante, sin
      // actualizar la app de nadie. Si la ruta todavía no tiene trazado, se
      // usa el que estima el cliente (proyección lineal, como antes).
      const proy = proyectarEnRuta(routeId, msg.lat, msg.lng);
      const progreso = proy ? proy.progreso : (msg.routeProgress || 0);

      units.set(vehicleId, {
        ...unit,
        unitId: vehicleId,
        routeId,
        lat: msg.lat,
        lng: msg.lng,
        speed: msg.speed || 0,
        routeProgress: progreso,
        // A cuántos metros del trazado va. null si la ruta no tiene geometría.
        desvioM: proy ? Math.round(proy.desvioM) : null,
        timestamp: Date.now(),
      });

      // Detección de vuelta completa a partir del progreso (del vehículo)
      trackLap(vehicleId, routeId, progreso, msg.speed || 0);

      // Solo se recalcula y emite el estado de SU ruta
      scheduleStateBroadcast(routeId);
    }

    // La ruta a la que pertenece lo que este cliente emite: la del chofer,
    // o la que el supervisor está mirando en el panel.
    const rutaDelEmisor = () => {
      const unitId = clients.get(ws);
      const prof = unitId ? profiles.get(unitId) : null;
      return (prof && prof.routeId) || watching.get(ws) || DEFAULT_ROUTE;
    };

    // TIPO: SOS — el chofer desliza el botón de emergencia
    // Llega a su ruta y ADEMÁS a todos los supervisores, aunque estén
    // mirando otra: una emergencia tiene que escalar igual.
    if (msg.type === 'sos') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const prof = profiles.get(unitId) || {};
      const routeId = rutaDelEmisor();
      console.log(`🚨 SOS de ${unitId} (${routeId})`);
      const alert = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        vehicleId: prof.vehicleId || null,
        routeId,
        lat: msg.lat ?? null,
        lng: msg.lng ?? null,
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'sos', ...alert });
      audit(unitId, 'sos', null, alert.lat ? `${alert.lat.toFixed(4)}, ${alert.lng.toFixed(4)}` : null, routeId);
      broadcastToRoute(routeId, { type: 'sos_alert', ...alert });
      broadcastToSupervisors({ type: 'sos_alert', ...alert }, routeId);
    }

    // TIPO: chat — mensaje de texto entre choferes de la MISMA ruta
    // Limitamos a 500 caracteres para evitar abuso.
    if (msg.type === 'chat') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const prof = profiles.get(unitId) || {};
      const routeId = rutaDelEmisor();

      // ¿Privado? Despacho elige a qué unidad le escribe; una unidad solo
      // puede escribirle a Despacho, y eso es su propia conversación.
      // A propósito NO existe chofer ↔ chofer en privado: el canal entre
      // choferes es el grupo, y abrir mensajería privada entre cientos de
      // personas trae un problema de moderación que no queremos.
      let toVehicleId = null;
      if (prof.role === 'dispatch') {
        const destino = String(msg.to || '').trim();
        if (destino) {
          if (!units.has(destino) && !vehicleOf(destino)) return;  // unidad inexistente
          toVehicleId = destino;
        }
      } else if (msg.to || msg.privado) {
        toVehicleId = prof.vehicleId || null;
        if (!toVehicleId) return;
      }

      const entry = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        vehicleId: prof.vehicleId || null,
        toVehicleId,
        routeId,
        text: String(msg.text || '').slice(0, 500),
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'chat', ...entry });
      const payload = { type: 'chat_msg', role: prof.role || 'driver', ...entry };
      if (toVehicleId) {
        enviarPrivado(routeId, toVehicleId, payload);
        console.log(`Privado ${prof.role === 'dispatch' ? 'Despacho → ' + toVehicleId : toVehicleId + ' → Despacho'}`);
      } else {
        broadcastToRoute(routeId, payload);
      }
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
      const routeId = rutaDelEmisor();

      // Mismas reglas que el texto: Despacho elige unidad, una unidad solo
      // puede hablar con Despacho (su propia conversación).
      let toVehicleId = null;
      if (prof.role === 'dispatch') {
        const destino = String(msg.to || '').trim();
        if (destino) {
          if (!units.has(destino) && !vehicleOf(destino)) return;
          toVehicleId = destino;
        }
      } else if (msg.to || msg.privado) {
        toVehicleId = prof.vehicleId || null;
        if (!toVehicleId) return;
      }

      const entry = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        vehicleId: prof.vehicleId || null,
        toVehicleId,
        routeId,
        duration: Math.max(1, Math.min(120, Math.round(msg.duration || 0))),
        data,
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'voice', ...entry });
      const payload = { type: 'voice_msg', role: prof.role || 'driver', ...entry };
      if (toVehicleId) enviarPrivado(routeId, toVehicleId, payload);
      else broadcastToRoute(routeId, payload);
    }
  });

  // Cuando alguien se desconecta
  ws.on('close', () => {
    const personId = clients.get(ws);
    watching.delete(ws);
    if (!personId) return;
    const prof = profiles.get(personId);
    const vehicleId = prof?.vehicleId;
    clients.delete(ws);
    console.log(`Desconectado: ${prof ? prof.driverName : personId}`);
    if (!vehicleId) return;

    const routeId = units.get(vehicleId)?.routeId || prof?.routeId;

    // ¿Queda alguien más de este vehículo conectado? (chofer + cobrador)
    const otrosDelVehiculo = [];
    for (const [otroWs, otroId] of clients) {
      if (profiles.get(otroId)?.vehicleId === vehicleId && otroWs.readyState === 1) {
        otrosDelVehiculo.push({ ws: otroWs, prof: profiles.get(otroId) });
      }
    }

    // Si el que se fue tenía el mando del GPS, lo toma un chofer que siga
    // conectado; si no queda ninguno, el vehículo deja de reportar.
    if (gpsOwner.get(vehicleId) === ws) {
      gpsOwner.delete(vehicleId);
      const relevo = otrosDelVehiculo.find(o => o.prof.role === 'driver');
      if (relevo) {
        gpsOwner.set(vehicleId, relevo.ws);
        try { relevo.ws.send(JSON.stringify({ type: 'gps_role', reporting: true })); } catch {}
      }
    }

    // El vehículo sale del mapa solo cuando se va la ÚLTIMA persona
    if (otrosDelVehiculo.length === 0 && units.has(vehicleId)) {
      units.delete(vehicleId);
      broadcastToRoute(routeId, { type: 'unit_left', unitId: vehicleId });
      scheduleStateBroadcast(routeId, true);
    }
  });

  // El estado y el historial se mandan recién después de un identify
  // válido — una conexión sin autenticar no recibe nada.
});

// Reparto de un mensaje privado: los que van ARRIBA de ese vehículo (chofer y
// cobrador) y Despacho mirando esa ruta. Nadie más — ni los otros choferes.
function enviarPrivado(routeId, toVehicleId, payload) {
  const crudo = JSON.stringify(payload);
  for (const [ws, personId] of clients) {
    if (ws.readyState !== 1) continue;
    const prof = profiles.get(personId);
    if (!prof) continue;
    const esDeEsaCombi = prof.vehicleId === toVehicleId;
    const esDespachoDeLaRuta = prof.role === 'dispatch' && watching.get(ws) === routeId;
    if (esDeEsaCombi || esDespachoDeLaRuta) {
      try { ws.send(crudo); } catch {}
    }
  }
}

// El trazado se manda UNA vez (al conectar, al cambiar de ruta o cuando se
// edita), nunca dentro del estado: el estado sale cada 3 s y una ruta de 300
// puntos son ~7 KB — mandarlo ahí sería tirar por la borda el ahorro de datos.
function mensajeGeometria(routeId) {
  const geo = geometriaDe(routeId);
  return JSON.stringify({
    type: 'route_geometry',
    routeId,
    points: geo ? geo.puntos.map(p => [p.lat, p.lng]) : [],
    largoM: geo ? Math.round(geo.largoM) : 0,
  });
}

// ─── CONSTRUIR ESTADO ────────────────────────────────────────
// Toma todas las posiciones y calcula quién va adelante/atrás de quién.
// routeProgress es un número 0-1 que indica qué tan avanzado está en la ruta.
// 0 = terminal sur, 1 = Huancané.

// El estado es SIEMPRE de una ruta: las unidades de otras rutas no
// aparecen ni entran en el cálculo de brechas. Sin esto, un chofer vería
// "su" brecha contra una combi de otro recorrido.
function buildState(routeId) {
  const ruta = routeOf(routeId);
  const all = Array.from(units.values())
    .filter(u => u.routeId === routeId && u.lat !== null) // solo su ruta, con GPS
    .sort((a, b) => b.routeProgress - a.routeProgress);    // ordenadas por avance

  return {
    routeId,
    routeName: ruta ? ruta.name : routeId,
    targetGapMin: ruta ? ruta.targetGapMin : 2,
    units: all,
    gaps: calculateGaps(all, ruta ? ruta.durationMin : 50),
    totalOnRoute: all.length,
    timestamp: Date.now(),
  };
}

// ─── CALCULAR GAPS ───────────────────────────────────────────
// Dado el orden en la ruta, calcula cuántos minutos separa cada par de
// unidades. La fórmula es una aproximación: diferencia de progreso por la
// duración del recorrido, que cada ruta define por su cuenta.

function calculateGaps(sortedUnits, durationMin) {
  const gaps = {};
  for (let i = 0; i < sortedUnits.length; i++) {
    const current = sortedUnits[i];
    const ahead = sortedUnits[i - 1]; // la que va adelante (más progreso)
    const behind = sortedUnits[i + 1]; // la que viene atrás (menos progreso)

    const gapToAhead = ahead
      ? (ahead.routeProgress - current.routeProgress) * durationMin
      : null;

    const gapToBehind = behind
      ? (current.routeProgress - behind.routeProgress) * durationMin
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
// Qué ruta está mirando cada conexión. Un chofer mira la suya siempre; un
// supervisor puede cambiarla desde el panel (mensaje 'watch').
const watching = new Map();   // websocket → routeId

function esSupervisor(ws) {
  const unitId = clients.get(ws);
  const prof = unitId ? profiles.get(unitId) : null;
  return !!prof && prof.role === 'dispatch' && !prof.routeId;
}

// Manda un mensaje solo a quienes están mirando esa ruta
function broadcastToRoute(routeId, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && watching.get(client) === routeId) {
      client.send(msg);
    }
  });
}

// Manda un mensaje a todos los supervisores, sin importar qué ruta miran.
// Se usa para los SOS: una emergencia tiene que escalar igual.
function broadcastToSupervisors(data, exceptRoute) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && esSupervisor(client) && watching.get(client) !== exceptRoute) {
      client.send(msg);
    }
  });
}

// ─── CADENCIA DEL ESTADO ─────────────────────────────────────
// Antes cada posición GPS disparaba el estado completo a todos: con 20
// unidades eran 6 envíos por segundo a cada celular, casi todos
// repitiendo datos que no habían cambiado (~840 MB por turno medidos).
// Ahora las posiciones se acumulan y se emiten como máximo una vez cada
// STATE_INTERVAL_MS, y por separado para cada ruta.
const STATE_INTERVAL_MS = Number(process.env.STATE_INTERVAL_MS || 3000);
const stateTimers = new Map();  // routeId → timeout
const lastStateAt = new Map();  // routeId → cuándo se emitió por última vez

function flushState(routeId) {
  clearTimeout(stateTimers.get(routeId));
  stateTimers.delete(routeId);
  lastStateAt.set(routeId, Date.now());
  broadcastToRoute(routeId, { type: 'state', ...buildState(routeId) });
}

// Agenda el envío del estado de UNA ruta respetando la cadencia. Con
// `immediate` se emite ya (altas y bajas, que no conviene demorar).
function scheduleStateBroadcast(routeId, immediate = false) {
  if (!routeId) return;
  if (immediate) { flushState(routeId); return; }
  if (stateTimers.has(routeId)) return; // ya hay uno agendado para esta ruta
  const espera = Math.max(0, STATE_INTERVAL_MS - (Date.now() - (lastStateAt.get(routeId) || 0)));
  stateTimers.set(routeId, setTimeout(() => flushState(routeId), espera));
}

// ─── LIMPIAR UNIDADES INACTIVAS ──────────────────────────────
// Si una unidad no manda GPS en más de 30 segundos, la sacamos.
// Evita que fantasmas queden en el mapa después de que alguien cierra la app.
setInterval(() => {
  const cutoff = Date.now() - 30_000;
  const rutasAfectadas = new Set();
  for (const [unitId, unit] of units) {
    if (unit.timestamp < cutoff) {
      units.delete(unitId);
      lapState.delete(unitId); // la vuelta a medias no cuenta
      console.log(`Unidad eliminada por inactividad: ${unitId}`);
      broadcastToRoute(unit.routeId, { type: 'unit_left', unitId });
      rutasAfectadas.add(unit.routeId);
    }
  }
  // Sin este envío, si todas dejan de reportar el mapa queda congelado
  rutasAfectadas.forEach(r => scheduleStateBroadcast(r, true));
}, 10_000);

// ─── ARRANCAR ────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor COOP-R14 corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
});
