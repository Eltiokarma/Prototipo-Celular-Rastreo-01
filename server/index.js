// Servidor COOP-R14 — tiempo real
// Recibe GPS de cada combi, calcula gaps, distribuye a todos.

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Compartido con las herramientas de consola (ver `base.js` y `empresa.js`)
const { openDatabase, hashPassword, verifyPassword, idLimpio } = require('./base');
const { montarPanelDelCreador } = require('./creador');
const marca = require('./marca');
const respaldo = require('./respaldo');

const app = express();
// El tope de cuerpo de `express.json()` viene en 100 kB, y eso era MÁS CHICO
// que lo que este servidor dice aceptar:
//
//   - el trazado de una ruta admite 2000 puntos por tramo, o sea ~148 kB con
//     los dos tramos. Cargar un recorrido real denso fallaba con un
//     PayloadTooLargeError crudo —un HTML de Express, no un JSON— antes de
//     llegar a ninguna de las validaciones lindas de más abajo;
//   - el logo de una cooperativa llega hasta ~195 kB.
//
// 1 MB deja las dos cosas holgadas y sigue siendo un tope. Lo pesado de
// verdad —audio y fotos— no pasa por acá: va por el WebSocket, que tiene sus
// propios límites y su cupo por minuto.
app.use(express.json({ limit: '1mb' }));

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
    kind TEXT NOT NULL,          -- 'chat' | 'voice' | 'photo' | 'sos'
    unitId TEXT,
    driverName TEXT,
    text TEXT,                   -- solo kind='chat'
    duration INTEGER,            -- segundos, solo kind='voice'
    data TEXT,                   -- data-URL base64: audio si kind='voice',
                                 -- imagen si kind='photo'
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

// `idLimpio` (arriba, desde base.js) limita los identificadores a un juego de
// caracteres seguro. Sin eso, alguien con cuenta de Despacho podía dar de alta
// una unidad llamada "<img onerror=...>" y ejecutar código en el navegador de
// los demás encargados — con su sesión abierta.

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

// ─── EMPRESAS ────────────────────────────────────────────────
// Un nivel arriba de las rutas: empresa → rutas → vehículos y personas.
// Hasta acá esto era "el sistema de la R-14". Con la empresa, una misma
// instalación atiende a varias cooperativas sin que ninguna vea a la otra:
// la empresa es el borde de TODO lo que se consulta.
//
// Y una regla dura, que es la que sostiene el aislamiento: toda cuenta
// pertenece a una empresa. No existe la cuenta sin empresa que ve todo. El
// nivel de arriba —el nuestro— vive fuera de la aplicación (ver
// `empresa.js` y la sección "Niveles de seguridad" del README), no es un rol
// más del mismo login. Si el panel que puede todo se abriera con una
// contraseña más, el nivel de arriba dejaría de existir.
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    companyId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ruc TEXT,                              -- para los papeles, opcional
    contacto TEXT,                         -- a quién llamar, opcional
    activa INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL
  )
`);

const DEFAULT_COMPANY = idLimpio(process.env.DEFAULT_COMPANY) || 'R14';

if (db.prepare('SELECT COUNT(*) AS c FROM companies').get().c === 0) {
  db.prepare('INSERT INTO companies (companyId, name, createdAt) VALUES (?, ?, ?)')
    .run(DEFAULT_COMPANY,
      String(process.env.DEFAULT_COMPANY_NAME || 'Cooperativa de Transportes Juliaca').slice(0, 80),
      Date.now());
  console.log(`Empresa inicial creada: ${DEFAULT_COMPANY}`);
}

function companyOf(companyId) {
  if (!companyId) return null;
  return db.prepare('SELECT * FROM companies WHERE companyId = ?').get(companyId) || null;
}

// A qué empresa se engancha lo que ya existía. Normalmente la inicial; si
// esa no está (una base vieja pudo haberla renombrado), la más antigua.
function empresaBase() {
  const c = companyOf(DEFAULT_COMPANY) ||
    db.prepare('SELECT * FROM companies ORDER BY createdAt LIMIT 1').get();
  return c ? c.companyId : DEFAULT_COMPANY;
}

// Le pone dueño a una tabla que antes no lo tenía. El relleno corre en cada
// arranque, no solo al crear la columna: una fila sin empresa quedaría
// invisible para todos los paneles, y eso se ve como datos perdidos.
function ligarAEmpresa(tabla, porRuta) {
  addColumnIfMissing(tabla, 'companyId', 'TEXT');
  let n = 0;
  // Lo que cuelga de una ruta hereda la empresa de esa ruta: es más fiel que
  // mandar todo a la empresa inicial, y en una base con varias ya cargadas es
  // la diferencia entre migrar bien y mezclarlas.
  if (porRuta) {
    n += db.prepare(`
      UPDATE ${tabla}
         SET companyId = (SELECT r.companyId FROM routes r WHERE r.routeId = ${tabla}.routeId)
       WHERE companyId IS NULL AND routeId IN (SELECT routeId FROM routes)
    `).run().changes;
  }
  n += db.prepare(`UPDATE ${tabla} SET companyId = ? WHERE companyId IS NULL`)
    .run(empresaBase()).changes;
  if (n) console.log(`${tabla}: ${n} fila(s) sin empresa`);
}

ligarAEmpresa('routes', false);

if (db.prepare('SELECT COUNT(*) AS c FROM routes').get().c === 0) {
  db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(DEFAULT_ROUTE, 'Terminal Sur ↔ Huancané', 2, 50, empresaBase(), Date.now());
  console.log(`Ruta inicial creada: ${DEFAULT_ROUTE}`);
}

function routeOf(routeId) {
  return db.prepare('SELECT * FROM routes WHERE routeId = ?').get(routeId) || null;
}

function allRoutes() {
  return db.prepare('SELECT * FROM routes ORDER BY routeId').all();
}

// Las rutas de UNA empresa. Es la que se usa en todo lo que mira un
// despachador: `allRoutes()` queda para lo interno del servidor.
function routesOfCompany(companyId) {
  if (!companyId) return [];
  return db.prepare('SELECT * FROM routes WHERE companyId = ? ORDER BY routeId').all(companyId);
}

// ¿Esta ruta es de esta empresa? La pregunta que se hace antes de dejar
// tocar cualquier cosa colgada de una ruta.
function rutaDeEmpresa(routeId, companyId) {
  if (!routeId || !companyId) return false;
  const r = routeOf(routeId);
  return !!r && r.companyId === companyId;
}

// ─── GEOMETRÍA DE LA RUTA (por tramos) ───────────────────────
// Una combi no recorre una línea: hace un CIRCUITO. Sale por un lado y
// vuelve por otro, y muchas veces la vuelta va por calles distintas (mano
// única) o por la misma calle en sentido contrario.
//
// Por eso el recorrido se guarda en dos tramos, IDA y VUELTA, cada uno con
// su propia polilínea. El progreso se mide dentro del tramo y después se
// convierte a una coordenada del circuito completo (0 = salida de la ida,
// 1 = fin de la vuelta), que es la que necesitan las brechas: dos combis se
// comparan sobre la misma rueda aunque una vaya de ida y la otra de vuelta.
//
// Una ruta puede tener solo IDA: ahí el circuito es ese tramo y funciona
// como antes.
// ─── VARIANTES DEL RECORRIDO ─────────────────────────────────
// Una ruta no siempre se maneja igual. Hay desvíos PROGRAMADOS —una obra que
// dura tres meses, el mercado de los domingos que cierra dos cuadras— donde
// el trazado real cambió y va a seguir cambiado un tiempo. Con un solo
// recorrido por ruta, eso obligaba a redibujarlo y a perder el original.
//
// Por eso una ruta tiene VARIANTES: cada una con su ida y su vuelta. Una
// está activa y es la que mide; las demás quedan guardadas para el día que
// haga falta. Activar otra recalcula progreso y brechas al instante, porque
// el cálculo vive en el servidor.
//
// Cuándo NO usar una variante: para un embotellamiento de dos horas no vale
// la pena — para eso está silenciar el desvío, que ya existe. La variante es
// para cuando el recorrido cambió de verdad.
db.exec(`
  CREATE TABLE IF NOT EXISTS route_variants (
    variantId INTEGER PRIMARY KEY AUTOINCREMENT,
    routeId TEXT NOT NULL,
    name TEXT NOT NULL,                -- "Recorrido normal", "Obra Circunvalación"
    activa INTEGER NOT NULL DEFAULT 0, -- una sola por ruta
    desde INTEGER,                     -- vigencia programada, opcional
    hasta INTEGER,
    createdAt INTEGER NOT NULL
  )
`);

const VARIANTE_BASE = 'Recorrido normal';

// Los puntos cuelgan de la VARIANTE, no de la ruta.
const CREAR_ROUTE_POINTS = `
  CREATE TABLE IF NOT EXISTS route_points (
    variantId INTEGER NOT NULL,
    leg TEXT NOT NULL DEFAULT 'ida',   -- 'ida' | 'vuelta'
    seq INTEGER NOT NULL,              -- orden del punto DENTRO del tramo
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    PRIMARY KEY (variantId, leg, seq)
  )
`;
db.exec(CREAR_ROUTE_POINTS);

// routeId → variantId de las rutas cuyo recorrido se acaba de migrar. Vacío
// en un arranque normal; se usa una sola vez, más abajo, para las vueltas.
let variantesMigradas = new Map();

// Historia de esta tabla, en tres versiones:
//   v1  (routeId, seq)             — el recorrido de una sola pieza
//   v2  (routeId, leg, seq)        — partido en ida y vuelta
//   v3  (variantId, leg, seq)      — colgando de la variante
// En SQLite cambiar una clave primaria significa rehacer la tabla, así que
// se detecta la versión por la clave real y se migra lo que haya: en v1 todo
// pasa a ser la ida, y en cualquier caso el recorrido que existía se
// convierte en la variante activa de su ruta.
{
  const info = db.prepare('PRAGMA table_info(route_points)').all();
  const clave = info.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name).join(',');
  if (clave !== 'variantId,leg,seq') {
    const tieneLeg = info.some(c => c.name === 'leg');
    db.exec('ALTER TABLE route_points RENAME TO route_points_viejo');

    // Cada ruta que tenía recorrido estrena su variante base, ya activa
    const conRecorrido = db.prepare('SELECT DISTINCT routeId FROM route_points_viejo').all();
    const insVar = db.prepare('INSERT INTO route_variants (routeId, name, activa, createdAt) VALUES (?, ?, 1, ?)');
    const deRuta = new Map();
    for (const r of conRecorrido) {
      deRuta.set(r.routeId, insVar.run(r.routeId, VARIANTE_BASE, Date.now()).lastInsertRowid);
    }

    db.exec(CREAR_ROUTE_POINTS);
    const insPunto = db.prepare('INSERT INTO route_points (variantId, leg, seq, lat, lng) VALUES (?, ?, ?, ?, ?)');
    const viejos = db.prepare(
      `SELECT routeId, ${tieneLeg ? 'leg' : "'ida' AS leg"}, seq, lat, lng FROM route_points_viejo`
    ).all();
    db.transaction(() => {
      for (const p of viejos) insPunto.run(deRuta.get(p.routeId), p.leg, p.seq, p.lat, p.lng);
    })();

    db.exec('DROP TABLE route_points_viejo');
    // Se guarda para más abajo: las vueltas ya guardadas de estas rutas se
    // midieron con este mismo trazado y hay que atarlas a su variante, pero
    // la tabla `laps` todavía no existe en este punto del arranque.
    variantesMigradas = deRuta;
    if (viejos.length) {
      console.log(`Recorridos migrados a variantes: ${deRuta.size} ruta(s), ${viejos.length} punto(s)`);
    }
  }
}

const TRAMOS = ['ida', 'vuelta'];

// La variante base de una ruta, creándola si todavía no tiene ninguna. Toda
// ruta tiene al menos una: así el trazador siempre sabe sobre qué dibujar.
function varianteBase(routeId) {
  const v = db.prepare('SELECT * FROM route_variants WHERE routeId = ? ORDER BY variantId LIMIT 1').get(routeId);
  if (v) return v;
  const id = db.prepare('INSERT INTO route_variants (routeId, name, activa, createdAt) VALUES (?, ?, 1, ?)')
    .run(routeId, VARIANTE_BASE, Date.now()).lastInsertRowid;
  return db.prepare('SELECT * FROM route_variants WHERE variantId = ?').get(id);
}

// La variante que está midiendo ahora mismo. Si por lo que fuera ninguna
// quedó activa, se activa la base: una ruta sin variante activa no mediría
// nada, y eso se vería como "el recorrido se borró solo".
function varianteActiva(routeId) {
  const v = db.prepare('SELECT * FROM route_variants WHERE routeId = ? AND activa = 1 ORDER BY variantId LIMIT 1')
    .get(routeId);
  if (v) return v;
  const base = varianteBase(routeId);
  db.prepare('UPDATE route_variants SET activa = 1 WHERE variantId = ?').run(base.variantId);
  return { ...base, activa: 1 };
}

function variantesDe(routeId) {
  return db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM route_points p WHERE p.variantId = v.variantId) AS puntos
    FROM route_variants v WHERE v.routeId = ? ORDER BY v.variantId
  `).all(routeId);
}

// Metros entre dos puntos GPS. A escala de una ruta urbana alcanza con
// aplanar la Tierra: se corrige la longitud por el coseno de la latitud.
const METROS_POR_GRADO = 111_320;
function metrosEntre(aLat, aLng, bLat, bLng) {
  const kLng = Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  const dLat = (bLat - aLat) * METROS_POR_GRADO;
  const dLng = (bLng - aLng) * METROS_POR_GRADO * kLng;
  return Math.hypot(dLat, dLng);
}

// Geometrías en memoria: { routeId → { ida, vuelta, largoTotalM } }
// Cada tramo es { puntos, acumulado, largoM }; acumulado[i] son los metros
// desde el inicio del tramo hasta el punto i, para no recalcularlo en cada
// posición GPS (llegan cada 3 s por unidad).
const geometrias = new Map();

function armarTramo(puntos) {
  if (puntos.length < 2) return null;
  const acumulado = [0];
  for (let i = 1; i < puntos.length; i++) {
    acumulado[i] = acumulado[i - 1] +
      metrosEntre(puntos[i - 1].lat, puntos[i - 1].lng, puntos[i].lat, puntos[i].lng);
  }
  return { puntos, acumulado, largoM: acumulado[acumulado.length - 1] };
}

// Los puntos que se leen son los de la variante ACTIVA: activar otra y
// recargar acá es todo lo que hace falta para que cambie el trazado con el
// que se miden progreso, brechas y desvíos de esa ruta.
function puntosDeVariante(variantId, leg) {
  return db.prepare(
    'SELECT lat, lng FROM route_points WHERE variantId = ? AND leg = ? ORDER BY seq'
  ).all(variantId, leg);
}

function cargarGeometria(routeId) {
  const variante = varianteActiva(routeId);
  const ida = armarTramo(puntosDeVariante(variante.variantId, 'ida'));
  const vuelta = armarTramo(puntosDeVariante(variante.variantId, 'vuelta'));
  if (!ida) { geometrias.delete(routeId); return null; }

  const geo = {
    ida, vuelta,
    largoTotalM: ida.largoM + (vuelta ? vuelta.largoM : 0),
    variantId: variante.variantId,
    varianteNombre: variante.name,
  };
  geometrias.set(routeId, geo);
  return geo;
}

function geometriaDe(routeId) {
  if (geometrias.has(routeId)) return geometrias.get(routeId);
  return cargarGeometria(routeId);
}

// Todas las geometrías se cargan al arrancar
for (const r of allRoutes()) cargarGeometria(r.routeId);

// Proyecta una posición sobre UN tramo.
// Devuelve { metros, desvioM, rumbo } — rumbo es la dirección del tramo en
// ese punto, en grados, que sirve para saber por cuál de los dos va la combi
// cuando ida y vuelta comparten la calle.
function proyectarEnTramo(tramo, lat, lng) {
  const { puntos, acumulado } = tramo;
  let mejor = { dist2: Infinity, metros: 0, rumbo: null };
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i], b = puntos[i + 1];
    // Se trabaja en metros locales para que el eje X no pese menos que el Y
    const kLng = Math.cos(a.lat * Math.PI / 180);
    const bx = (b.lng - a.lng) * METROS_POR_GRADO * kLng;
    const by = (b.lat - a.lat) * METROS_POR_GRADO;
    const px = (lng - a.lng) * METROS_POR_GRADO * kLng;
    const py = (lat - a.lat) * METROS_POR_GRADO;

    const largo2 = bx * bx + by * by;
    // t = cuánto del segmento se recorrió, recortado a [0,1] para que la
    // proyección no se escape más allá de los extremos
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largo2));
    const dist2 = (px - t * bx) ** 2 + (py - t * by) ** 2;
    if (dist2 < mejor.dist2) {
      mejor = {
        dist2,
        metros: acumulado[i] + t * Math.sqrt(largo2),
        rumbo: Math.atan2(bx, by) * 180 / Math.PI,
      };
    }
  }
  return { metros: mejor.metros, desvioM: Math.sqrt(mejor.dist2), rumbo: mejor.rumbo };
}

// Diferencia entre dos rumbos, siempre entre 0 y 180 grados
function difRumbo(a, b) {
  if (a === null || b === null) return null;
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Cuánto más cerca tiene que estar un tramo del otro para ganar por cercanía
// sola. Por debajo de eso se considera empate y decide el sentido de marcha.
const EMPATE_M = 25;

// Proyecta una posición sobre el recorrido completo.
// 'previo' es lo que se sabe de esa unidad: { tramo, rumbo } — el rumbo es
// hacia dónde venía yendo, que es lo que desempata cuando ida y vuelta van
// por la misma calle en sentidos opuestos.
// Devuelve { progreso 0..1 del CIRCUITO, tramo, progresoTramo, desvioM }
// o null si la ruta no tiene geometría.
function proyectarEnRuta(routeId, lat, lng, previo) {
  const geo = geometriaDe(routeId);
  if (!geo) return null;

  const candidatos = [{ leg: 'ida', tramo: geo.ida, p: proyectarEnTramo(geo.ida, lat, lng) }];
  if (geo.vuelta) {
    candidatos.push({ leg: 'vuelta', tramo: geo.vuelta, p: proyectarEnTramo(geo.vuelta, lat, lng) });
  }

  let elegido;
  if (candidatos.length === 1) {
    elegido = candidatos[0];
  } else {
    const [a, b] = candidatos.slice().sort((x, y) => x.p.desvioM - y.p.desvioM);
    if (b.p.desvioM - a.p.desvioM > EMPATE_M) {
      // Uno está claramente más cerca: son calles distintas
      elegido = a;
    } else if (previo && previo.rumbo !== null && previo.rumbo !== undefined) {
      // Empate: van por la misma calle. Gana el tramo cuyo sentido coincide
      // con hacia dónde se está moviendo la combi.
      const dA = difRumbo(previo.rumbo, a.p.rumbo);
      const dB = difRumbo(previo.rumbo, b.p.rumbo);
      elegido = (dB !== null && dA !== null && dB < dA) ? b : a;
    } else if (previo && previo.tramo) {
      // Sin rumbo (parada, o primer punto): se queda en el que venía
      elegido = candidatos.find(c => c.leg === previo.tramo) || a;
    } else {
      elegido = a;
    }
  }

  const progresoTramo = elegido.tramo.largoM > 0
    ? Math.max(0, Math.min(1, elegido.p.metros / elegido.tramo.largoM)) : 0;

  // Coordenada del circuito completo: la vuelta arranca donde termina la ida
  const recorridoM = elegido.leg === 'vuelta'
    ? geo.ida.largoM + elegido.p.metros
    : elegido.p.metros;
  const progreso = geo.largoTotalM > 0
    ? Math.max(0, Math.min(1, recorridoM / geo.largoTotalM)) : 0;

  return {
    progreso,
    tramo: elegido.leg,
    progresoTramo,
    desvioM: elegido.p.desvioM,
    rumbo: elegido.p.rumbo,
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

// Qué clase de emergencia fue el SOS. Se elige DESPUÉS de disparar —en una
// emergencia real nadie navega un menú, así que deslizar manda la alerta ya—
// y por eso vive como UPDATE sobre la fila que el disparo dejó: NULL es el
// SOS genérico, que es como nace cada uno y como queda si nadie eligió.
// "Falla mecánica", "accidente" y "policía" no movilizan lo mismo: uno pide
// una grúa, otro una ambulancia, el tercero es otra llamada.
addColumnIfMissing('messages', 'sosTipo', 'TEXT');
const SOS_TIPOS = { mecanica: 'Falla mecánica', accidente: 'Accidente', policia: 'Policía' };
// Cuánto tiempo después de disparar se puede elegir (o corregir) el tipo. La
// emergencia se atiende en minutos: pasado esto, cambiar el tipo ya no ayuda
// a nadie y solo edita la historia. Configurable para poder probarlo.
const SOS_TIPO_VENTANA_MS = Number(process.env.SOS_TIPO_VENTANA_MS || 15 * 60_000);

// El logo de la cooperativa, como data-URL. Va en la fila de la empresa y no
// en un archivo: son ~100 kB, se piden una vez por sesión, y guardarlos en
// disco obligaría a montar un volumen aparte y a resolver el respaldo de otra
// cosa más. En la base viajan con el resto y se respaldan con el resto.
addColumnIfMissing('companies', 'logo', 'TEXT');

const HISTORY_MAX = 200;   // mensajes que recibe un cliente al conectarse

// Cuánto historial de mensajes se guarda, y por qué NO es un tope de filas.
//
// Era uno solo y global: las últimas 1000 filas de toda la base. Con una ruta
// y seis combis alcanza. Con 40 rutas no: cada cliente recibe hasta 200
// mensajes DE SU RUTA al conectarse, así que 40 rutas necesitan 8000 filas
// solo para que nadie abra el chat vacío — y el tope era 1000. Peor todavía,
// en esta misma tabla viven los SOS: una tarde de chat activo borraba las
// emergencias del mes, que son justo lo que nadie puede perder. El informe de
// emergencias y el contador del gerente salían vacíos y no había forma de
// darse cuenta mirando la pantalla.
//
// En días significa lo mismo con seis combis que con dos mil. El SOS se
// guarda mucho más que la conversación porque no es lo mismo: un "¿espero en
// el paradero?" de hace dos meses no le importa a nadie, un accidente sí.
const CHAT_DIAS = Number(process.env.CHAT_DIAS || 30);
const SOS_DIAS = Number(process.env.SOS_DIAS || 365);
// Techo de filas como cinturón, nunca como el límite de todos los días: son
// filas de texto, así que medio millón son unas decenas de MB.
const MENSAJES_MAX_FILAS = Number(process.env.MENSAJES_MAX_FILAS || 500_000);
// Cuánto contenido pesado se conserva. Configurable por entorno solo para
// poder probarlo: con los valores de producción, una suite tendría que mandar
// 20 fotos, y el cupo por minuto (6) la frenaría antes — serían cuatro
// minutos de prueba para una comprobación. Mismo criterio que SIN_SENAL_MS.
const VOICE_KEEP = Number(process.env.VOICE_KEEP) || 30;  // notas que conservan su audio
const PHOTO_KEEP = Number(process.env.PHOTO_KEEP) || 20;  // fotos que conservan su imagen
                                                          // (menos: pesan más que un audio)

const insertStmt = db.prepare(`
  INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, toVehicleId, text, duration, data, lat, lng, timestamp)
  VALUES (@kind, @unitId, @driverName, @routeId, @vehicleId, @toVehicleId, @text, @duration, @data, @lat, @lng, @timestamp)
`);
// La conversación vieja se va; el SOS viejo se queda mucho más. Se poda cada
// 6 h junto con el resto del historial y NO en cada mensaje: a esta escala
// serían miles de recorridas de tabla por hora para borrar nada.
const pruneChatStmt = db.prepare(
  "DELETE FROM messages WHERE kind != 'sos' AND timestamp < @corte");
const pruneSosStmt = db.prepare(
  "DELETE FROM messages WHERE kind = 'sos' AND timestamp < @corte");
const pruneRowsStmt = db.prepare(`
  DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT @tope)
`);
// Lo pesado viejo suelta su contenido pero conserva la burbuja — el cliente
// la muestra como expirada, que es honesto: existió, ya no está.
//
// Se poda por tipo y NO en conjunto: una ráfaga de fotos no puede borrarle el
// audio a las notas de voz. Son dos presupuestos separados a propósito,
// porque una foto pesa varias veces lo que un audio y el que manda fotos no
// es necesariamente el que mandó la nota de voz que hace falta escuchar.
const pruneMediaStmt = db.prepare(`
  UPDATE messages SET data = NULL
  WHERE data IS NOT NULL AND kind = @kind
    AND id NOT IN (SELECT id FROM messages WHERE kind = @kind AND data IS NOT NULL ORDER BY id DESC LIMIT @conservar)
`);

// Devuelve el id de la fila guardada: el SOS lo necesita para que el tipo
// elegido después encuentre A QUÉ disparo pertenece. null si no se pudo.
function remember(item) {
  try {
    const info = insertStmt.run({ text: null, duration: null, data: null, lat: null, lng: null,
      vehicleId: null, toVehicleId: null, ...item });
    // Lo pesado sí se poda en el acto: una foto ocupa lugar de verdad y no
    // puede esperar seis horas. Las filas de texto se podan en la barrida.
    pruneMediaStmt.run({ kind: 'voice', conservar: VOICE_KEEP });
    pruneMediaStmt.run({ kind: 'photo', conservar: PHOTO_KEEP });
    return info.lastInsertRowid;
  } catch (e) {
    console.error('No se pudo guardar el mensaje:', e.message);
    return null;
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
           m.id AS sosId, m.sosTipo,
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
    -- 'driver'    maneja y su celular reporta la posición
    -- 'collector' va arriba, ve todo, no reporta posición
    -- 'dispatch'  opera el día: administra, chatea, atiende el SOS
    -- 'manager'   mira los números y nada más (ver *Panel del gerente*)
    role TEXT NOT NULL DEFAULT 'driver',
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

// A qué empresa pertenece cada persona. En users, la pareja empresa/ruta dice
// todo lo que hay que saber del alcance de una cuenta de despacho:
//   empresa + ruta   → despachador de esa ruta
//   empresa sin ruta → supervisor de esa empresa (todas sus rutas)
//   sin empresa      → nadie: la administración no lo deja pasar
ligarAEmpresa('users', true);

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

ligarAEmpresa('vehicles', true);

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
  const previos = db.prepare("SELECT unitId, driverName, routeId, companyId FROM users WHERE role = 'driver'").all();
  const insVeh = db.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const p of previos) {
      insVeh.run(p.unitId, null, p.routeId || DEFAULT_ROUTE, p.companyId || empresaBase(), Date.now());
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
    'SELECT unitId, driverName, name, alias, role, routeId, vehicleId, companyId FROM users WHERE unitId = ?'
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
// Mínimo al FIJAR una contraseña. El login no lo exige a propósito: las
// cuentas viejas con claves cortas tienen que poder entrar hasta que Despacho
// se las resetee, si no quedarían afuera de golpe.
const CLAVE_MINIMA = 6;

const DISPATCH_ID = 'DESPACHO';
if (process.env.DISPATCH_PASSWORD && process.env.DISPATCH_PASSWORD.length < 4) {
  // El login exige 4 caracteres: con una clave más corta la cuenta quedaría
  // creada pero imposible de usar. Mejor avisar y no tocar la que había.
  console.error('DISPATCH_PASSWORD tiene menos de 4 caracteres: el login la va a ' +
    'rechazar siempre. La cuenta DESPACHO queda como estaba — poné una clave más larga.');
} else if (process.env.DISPATCH_PASSWORD && process.env.DISPATCH_PASSWORD.length < CLAVE_MINIMA) {
  console.warn(`DISPATCH_PASSWORD es más corta que ${CLAVE_MINIMA} caracteres. ` +
    'Funciona, pero es la cuenta que administra a todos: conviene una más larga.');
} else if (process.env.DISPATCH_PASSWORD) {
  const hash = hashPassword(process.env.DISPATCH_PASSWORD);
  const exists = db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(DISPATCH_ID);
  if (exists) {
    db.prepare("UPDATE users SET passHash = ?, role = 'dispatch' WHERE unitId = ?").run(hash, DISPATCH_ID);
  } else {
    db.prepare('INSERT INTO users (unitId, driverName, name, role, companyId, passHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(DISPATCH_ID, 'Despacho', 'Despacho', 'dispatch', empresaBase(), hash, Date.now());
  }
  console.log('Cuenta DESPACHO lista (desde DISPATCH_PASSWORD)');
}

if (process.env.OPEN_REGISTRATION === '1') {
  console.warn('╔══════════════════════════════════════════════════════════╗');
  console.warn('║ OPEN_REGISTRATION=1: CUALQUIERA que sepa la URL puede    ║');
  console.warn('║ crear una unidad y entrar. Es solo para demostraciones.  ║');
  console.warn('║ En producción hay que sacar esta variable.               ║');
  console.warn('╚══════════════════════════════════════════════════════════╝');
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
ligarAEmpresa('audit', true);

// Cuántos movimientos se guardan POR EMPRESA. Antes el tope era global, y
// con varias cooperativas en el mismo servidor la más movida le borraba la
// auditoría a las demás: el registro de quién tocó qué es justamente lo que
// no puede depender de cuánto trabaja el vecino.
const AUDIT_POR_EMPRESA = 1000;

function audit(actor, action, target, detail, routeId, companyId) {
  try {
    // Casi ningún llamador conoce la empresa: se deduce de la ruta y, si no
    // hay ruta (un login, por ejemplo), de la cuenta que hizo la acción.
    const empresa = companyId
      || (routeId ? (routeOf(routeId)?.companyId || null) : null)
      || db.prepare('SELECT companyId FROM users WHERE unitId = ?').get(actor)?.companyId
      || null;
    db.prepare('INSERT INTO audit (actor, action, target, detail, routeId, companyId, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(actor, action, target || null, detail || null, routeId || null, empresa, Date.now());
    db.prepare(`
      DELETE FROM audit
       WHERE companyId IS @empresa
         AND id NOT IN (SELECT id FROM audit WHERE companyId IS @empresa ORDER BY id DESC LIMIT @tope)
    `).run({ empresa, tope: AUDIT_POR_EMPRESA });
  } catch (e) {
    console.error('No se pudo auditar:', e.message);
  }
}

// ─── VUELTAS ─────────────────────────────────────────────────
// Una vuelta = el progreso de ruta llega cerca del final (>0.8) y
// vuelve al inicio. Se guarda duración y velocidad promedio; con eso
// Despacho tiene historial y métricas por unidad para ordenar la rueda.

// ─── DESVÍO DE RUTA ──────────────────────────────────────────
// Con el recorrido cargado, el servidor sabe a cuántos metros del trazado va
// cada unidad. Convertir eso en un aviso útil es lo difícil, porque en una
// ciudad SIEMPRE hay desvíos: una obra, un desfile, un embotellamiento. Un
// sistema que grita en cada uno se apaga el primer día.
//
// Por eso está pensado como GESTIÓN y no como alarma:
//  - Solo se marca si el desvío se SOSTIENE (un salto de GPS no cuenta).
//  - El umbral es por ruta: no es lo mismo el centro que la salida a Huancané.
//  - Despacho puede silenciarlo un rato cuando el desvío es conocido.
//  - Al chofer NO se le dice nada: puede tener un motivo, y un cartel
//    acusándolo mientras maneja es peor que el problema.
//
// El umbral por defecto son 300 m, que en la traza de Juliaca son unas TRES
// CUADRAS. Un chofer puede tomarse un desvío de esa magnitud sin que sea un
// problema —esquivar un embotellamiento, una calle cortada— y marcarlo sería
// ruido. Recién más allá de eso deja de ser "el camino de siempre con una
// vuelta" y pasa a ser otro recorrido.
const DESVIO_DEFECTO_M = 300;
addColumnIfMissing('routes', 'desvioMaxM', `INTEGER NOT NULL DEFAULT ${DESVIO_DEFECTO_M}`);
addColumnIfMissing('routes', 'desvioMudoHasta', 'INTEGER');

// La primera versión traía 60 m, que es menos de una cuadra: cualquier desvío
// legítimo caía adentro. Las rutas que quedaron con ese valor pasan al nuevo
// por defecto; las que alguien haya ajustado a mano se respetan.
{
  const r = db.prepare('UPDATE routes SET desvioMaxM = ? WHERE desvioMaxM = 60').run(DESVIO_DEFECTO_M);
  if (r.changes) console.log(`Umbral de desvío actualizado a ${DESVIO_DEFECTO_M} m en ${r.changes} ruta(s)`);
}

// Cuántas posiciones seguidas hacen falta. Llegan cada 3 s, así que 10 son
// unos 30 segundos afuera: un salto de GPS no llega, doblar en la esquina
// equivocada sí.
const DESVIO_MUESTRAS = 10;
// Para volver alcanza con menos: si ya está de nuevo sobre el trazado, no
// tiene sentido seguir mostrándolo fuera.
const REGRESO_MUESTRAS = 4;

// Los desvíos que ya pasaron.
//
// Hasta ahora el desvío se detectaba y se gestionaba EN VIVO y se perdía: al
// día siguiente no había forma de contestar "¿cuántas veces se salió M-17 la
// semana pasada, y por cuánto tiempo?". El aviso servía para el momento y para
// nada más, y es justo la clase de dato que una cooperativa mira cuando tiene
// que hablar con un chofer: uno se sale una vez por una obra, otro se sale
// todos los días a la misma hora, y esas dos cosas se parecen mucho mientras
// se las mire de a una.
//
// Se guarda el episodio ENTERO, no cada posición: una fila por salida, con
// cuándo empezó, cuándo volvió, cuánto se alejó como máximo y si Despacho lo
// tenía silenciado en ese momento (un desvío silenciado sigue siendo un
// desvío; lo que cambia es que ya se sabía).
db.exec(`
  CREATE TABLE IF NOT EXISTS deviations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleId TEXT NOT NULL,
    routeId TEXT NOT NULL,
    startedAt INTEGER NOT NULL,
    endedAt INTEGER,             -- NULL mientras sigue afuera
    durationSec INTEGER,
    maxM INTEGER NOT NULL,
    umbralM INTEGER NOT NULL,    -- contra qué se lo midió: el umbral cambia
    silenciado INTEGER NOT NULL DEFAULT 0,
    cierre TEXT                  -- 'regreso' | 'corte' | 'trazado'
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_deviations_ruta ON deviations (routeId, startedAt)');

// Un desvío abierto al apagarse el servidor quedaría abierto para siempre y
// ensuciaría todos los informes con una duración que crece sola. Se los cierra
// al arrancar, marcados como lo que son: cortados, no terminados.
{
  const abiertos = db.prepare(
    "UPDATE deviations SET endedAt = startedAt, durationSec = 0, cierre = 'corte' WHERE endedAt IS NULL").run();
  if (abiertos.changes) {
    console.log(`${abiertos.changes} desvío(s) quedaron abiertos del arranque anterior: cerrados como cortados`);
  }
}

// { vehicleId → { fuera, seguidasFuera, seguidasDentro, desde, maxM, id } }
const desvios = new Map();

// Abre la fila del episodio y devuelve su id, para poder cerrarla después.
function abrirDesvio(vehicleId, routeId, maxM, umbralM, silenciado) {
  return db.prepare(
    'INSERT INTO deviations (vehicleId, routeId, startedAt, maxM, umbralM, silenciado) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(vehicleId, routeId, Date.now(), Math.round(maxM), umbralM, silenciado ? 1 : 0).lastInsertRowid;
}

// Cierra el episodio. `cierre` dice POR QUÉ dejó de estar abierto, que no es
// lo mismo en los tres casos: volvió al trazado, se quedó sin señal (o terminó
// el turno) mientras seguía afuera, o le cambiaron el trazado abajo — en ese
// último ni siquiera se puede afirmar que estuviera fuera de algo.
function cerrarDesvio(estado, cierre) {
  if (!estado || !estado.id) return;
  const ahora = Date.now();
  db.prepare('UPDATE deviations SET endedAt = ?, durationSec = ?, maxM = ?, cierre = ? WHERE id = ?')
    .run(ahora, Math.max(0, Math.round((ahora - estado.desde) / 1000)), estado.maxM, cierre, estado.id);
  estado.id = null;
}

// Todo camino por el que una unidad deja de ser evaluada tiene que cerrar su
// desvío abierto: si no, la fila queda creciendo y el informe del mes dice que
// una combi estuvo fuera de ruta cuatro días.
function olvidarDesvio(vehicleId, cierre) {
  const e = desvios.get(vehicleId);
  if (e && e.fuera) cerrarDesvio(e, cierre);
  desvios.delete(vehicleId);
}

function evaluarDesvio(vehicleId, routeId, desvioM) {
  const ruta = routeOf(routeId);
  // Sin geometría no hay nada que comparar
  if (desvioM === null || desvioM === undefined || !ruta) {
    // Se quedó sin con qué compararse. Si venía afuera, el episodio se cierra
    // acá: dejar la fila abierta la haría crecer hasta el fin de los tiempos.
    olvidarDesvio(vehicleId, 'corte');
    return null;
  }
  const umbral = ruta.desvioMaxM || DESVIO_DEFECTO_M;
  let e = desvios.get(vehicleId);
  if (!e) {
    e = { fuera: false, seguidasFuera: 0, seguidasDentro: 0, desde: null, maxM: 0, maxGuardado: 0 };
    desvios.set(vehicleId, e);
  }

  if (desvioM > umbral) {
    e.seguidasFuera++;
    e.seguidasDentro = 0;
    e.maxM = Math.max(e.maxM, Math.round(desvioM));
    if (!e.fuera && e.seguidasFuera >= DESVIO_MUESTRAS) {
      e.fuera = true;
      e.desde = Date.now();
      const mudo = ruta.desvioMudoHasta && ruta.desvioMudoHasta > Date.now();
      // Se guarda TAMBIÉN el silenciado. Silenciar es "ya lo sé, no me avises
      // más", no "esto no pasó": si no quedara registrado, la forma de que un
      // desvío no aparezca en el informe sería apretar el botón de silencio.
      e.id = abrirDesvio(vehicleId, routeId, e.maxM, umbral, mudo);
      e.maxGuardado = e.maxM;
      if (!mudo) {
        console.log(`Fuera de ruta: ${vehicleId} a ${Math.round(desvioM)} m del trazado`);
        audit('sistema', 'desvio', vehicleId, `${Math.round(desvioM)} m del trazado`, routeId);
      }
    } else if (e.fuera && e.id && e.maxM > e.maxGuardado) {
      // Mientras dura, el máximo puede seguir creciendo: si el servidor se cae
      // con el episodio abierto, la fila ya tiene el peor valor visto. Se
      // escribe SOLO cuando de verdad creció — si no, sería una escritura por
      // cada posición de cada unidad que esté afuera, que a 2000 unidades es
      // mucho disco para dejar el mismo número.
      db.prepare('UPDATE deviations SET maxM = ? WHERE id = ?').run(e.maxM, e.id);
      e.maxGuardado = e.maxM;
    }
  } else {
    e.seguidasDentro++;
    e.seguidasFuera = 0;
    if (e.fuera && e.seguidasDentro >= REGRESO_MUESTRAS) {
      const minutos = Math.round((Date.now() - e.desde) / 60000);
      console.log(`De vuelta en ruta: ${vehicleId} (estuvo ${minutos} min fuera)`);
      cerrarDesvio(e, 'regreso');
      e.fuera = false;
      e.desde = null;
      e.maxM = 0;
      e.maxGuardado = 0;
    }
  }
  return e;
}

// ¿Se muestra el desvío de esta ruta, o Despacho lo silenció?
function desvioSilenciado(routeId) {
  const ruta = routeOf(routeId);
  return !!(ruta && ruta.desvioMudoHasta && ruta.desvioMudoHasta > Date.now());
}

// ─── TURNOS ──────────────────────────────────────────────────
// Quién manejó qué unidad y cuánto tiempo. Se registra SOLO lo que el
// sistema ya ve solo: cuándo alguien entra a una unidad y cuándo se va.
// A propósito no es un sistema de recursos humanos — para las excepciones
// (se olvidó de salir, prestó el celular) hace falta corrección a mano, y
// eso es otra discusión.
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personId TEXT NOT NULL,      -- la PERSONA (su usuario)
    vehicleId TEXT NOT NULL,     -- la combi en la que anduvo
    routeId TEXT,
    role TEXT NOT NULL,          -- 'driver' | 'collector'
    startedAt INTEGER NOT NULL,
    lastSeenAt INTEGER NOT NULL, -- para cerrar bien si el servidor se cae
    endedAt INTEGER              -- NULL = todavía arriba
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_persona ON shifts (personId, startedAt)');

// Un corte de señal no es un turno nuevo. Si la misma persona vuelve a la
// misma unidad antes de esto, se retoma el turno que estaba en vez de
// partirlo en pedazos — en la ruta se pierde la señal todo el tiempo.
const RECONEXION_MS = 15 * 60_000;

// Al arrancar, los turnos que quedaron abiertos se cierran con la última
// señal que se les vio. Si el servidor se reinicia a mitad de turno, sin
// esto quedarían abiertos para siempre y las horas darían cualquier cosa.
{
  const abiertos = db.prepare('UPDATE shifts SET endedAt = lastSeenAt WHERE endedAt IS NULL').run();
  if (abiertos.changes) console.log(`Turnos cerrados al arrancar: ${abiertos.changes}`);
}

function abrirTurno(personId, vehicleId, routeId, role) {
  const ahora = Date.now();
  // ¿Venía de un corte de señal? Se retoma el turno anterior
  const previo = db.prepare(`
    SELECT id FROM shifts
    WHERE personId = ? AND vehicleId = ? AND endedAt IS NOT NULL AND endedAt > ?
    ORDER BY id DESC LIMIT 1
  `).get(personId, vehicleId, ahora - RECONEXION_MS);

  if (previo) {
    db.prepare('UPDATE shifts SET endedAt = NULL, lastSeenAt = ? WHERE id = ?').run(ahora, previo.id);
    return previo.id;
  }
  // ¿Ya tenía uno abierto? (dos celulares con la misma cuenta)
  const abierto = db.prepare(
    'SELECT id FROM shifts WHERE personId = ? AND endedAt IS NULL ORDER BY id DESC LIMIT 1'
  ).get(personId);
  if (abierto) {
    db.prepare('UPDATE shifts SET lastSeenAt = ? WHERE id = ?').run(ahora, abierto.id);
    return abierto.id;
  }
  const r = db.prepare(`
    INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(personId, vehicleId, routeId || null, role || 'driver', ahora, ahora);
  return r.lastInsertRowid;
}

function cerrarTurno(personId) {
  db.prepare('UPDATE shifts SET endedAt = ?, lastSeenAt = ? WHERE personId = ? AND endedAt IS NULL')
    .run(Date.now(), Date.now(), personId);
}

// Se marca que la persona sigue arriba. No en cada posición GPS (llegan cada
// 3 s): alcanza con una vez por minuto para que el cierre por reinicio no
// pierda más de un minuto.
const ultimaMarca = new Map();
function marcarVivo(personId) {
  const ahora = Date.now();
  if (ahora - (ultimaMarca.get(personId) || 0) < 60_000) return;
  ultimaMarca.set(personId, ahora);
  db.prepare('UPDATE shifts SET lastSeenAt = ? WHERE personId = ? AND endedAt IS NULL')
    .run(ahora, personId);
}

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

// Con qué variante del recorrido se midió cada vuelta. Sin esto, el promedio
// histórico mezclaría geometrías distintas: una variante más larga tarda más,
// y promediarla con la corta da un objetivo que no le sirve a ninguna.
addColumnIfMissing('laps', 'variantId', 'INTEGER');

// La brecha promedio que mantuvo la unidad DURANTE esa vuelta, en segundos.
//
// Es el único número que la cooperativa querría y que hasta ahora no se
// guardaba: cuántas vueltas hizo cada uno ya se sabía, pero no si las hizo
// bien. Y no se puede reconstruir mirando hacia atrás —la brecha se calcula
// en vivo, contra dónde están las otras unidades en ese instante, y esas
// posiciones no se guardan (serían millones de filas)—, así que empieza a
// existir el día que se enciende y nunca antes.
//
// Se mide contra la unidad de ADELANTE, que es la que el chofer regula: uno
// controla cuánto se despega del de adelante, no cuánto se le pega el de
// atrás. Queda NULL cuando no hubo con quién compararse.
addColumnIfMissing('laps', 'brechaProm', 'INTEGER');

// El objetivo de brecha que REGÍA cuando se cerró esta vuelta, en segundos.
//
// Sin esto, el cumplimiento se medía contra el objetivo de HOY. Con objetivo
// manual casi da igual —cambia cuando alguien lo cambia—, pero con objetivo
// automático el número se mueve solo: depende de cuántas unidades hay en ruta
// y de la vuelta promedio de ese día de la semana. Un lunes con 12 combis y un
// jueves con 6 no tienen el mismo objetivo, así que el informe de la semana
// pasada juzgaba las vueltas del lunes con la vara del jueves y nadie podía
// notarlo mirando la pantalla.
//
// Queda NULL en las vueltas viejas —el dato no existió cuando se cerraron y no
// hay forma de reconstruirlo— y esas se siguen juzgando contra el objetivo de
// hoy, que es lo único que hay. El informe dice cuántas son de cada clase en
// vez de mezclarlas en silencio.
addColumnIfMissing('laps', 'objetivoSec', 'INTEGER');

// Las vueltas que ya estaban guardadas cuando el recorrido pasó a colgar de
// una variante se midieron con ESE trazado: es el mismo, solo que ahora tiene
// un nombre. Se las ata a él, porque si no el objetivo automático de cada
// ruta arrancaría de cero el día del deploy tirando historial verdadero.
//
// Solo las de rutas que TENÍAN recorrido: las de una ruta sin trazado se
// midieron con la estimación del cliente y no son de ninguna variante.
if (variantesMigradas.size) {
  const marcar = db.prepare('UPDATE laps SET variantId = ? WHERE routeId = ? AND variantId IS NULL');
  let n = 0;
  db.transaction(() => {
    for (const [routeId, variantId] of variantesMigradas) n += marcar.run(variantId, routeId).changes;
  })();
  if (n) console.log(`${n} vuelta(s) atadas al recorrido con el que se midieron`);
  variantesMigradas = new Map();
}

// Todo lo que lee vueltas filtra u ordena por finishedAt: la pestaña del
// panel, los informes, el promedio del objetivo automático y la poda. Sin
// índice, cada carga de la pestaña recorría la tabla entera — a base de
// régimen (120 días de 2000 unidades) son 142 ms midiendo, y esos 142 ms
// bloquean el MISMO hilo que atiende los POST /gps de toda la flota
// (`COSTOS.md` §3). Con el índice: 33 ms. Cuesta unos MB de disco.
db.exec('CREATE INDEX IF NOT EXISTS idx_laps_cierre ON laps (finishedAt)');

// Cuánto historial se guarda, y por qué se mide en DÍAS y no en filas.
//
// Antes el tope era global y fijo: las últimas 2000 vueltas, borradas en cada
// cierre de vuelta. Con seis combis eso son meses de historial y funcionaba.
// Con 2000 unidades son **tres horas**: cada una cierra unas ocho vueltas por
// turno, o sea unas 16 000 por día, así que el informe de la semana pasada
// saldría vacío y el objetivo automático se quedaría sin promedio del que
// salir. Un tope en filas significa cosas distintas según el tamaño de la
// cooperativa, que es justo lo que un tope no debería hacer.
//
// En días significa lo mismo siempre. 120 cubre con margen los 90 que es el
// rango máximo que acepta un informe, y a 16 000 vueltas por día son ~2
// millones de filas de unos 100 bytes: unos 200 MB, que SQLite mueve sin
// despeinarse (`ESCALABILIDAD.md`). El techo de filas queda como cinturón por
// si alguna vez el reloj o la carga se van a un lugar raro — nunca como el
// límite que manda todos los días.
const LAPS_DIAS = Number(process.env.LAPS_DIAS || 120);
const LAPS_MAX_FILAS = Number(process.env.LAPS_MAX_FILAS || 3_000_000);
const DESVIOS_DIAS = Number(process.env.DESVIOS_DIAS || LAPS_DIAS);

// Podar es barato pero no gratis (recorre por fecha), y no hay ningún apuro:
// una fila de hace 120 días y 3 horas no molesta a nadie. Va cada 6 horas, y
// una vez al arrancar para que un servidor que estuvo apagado se ponga al día.
function podarHistorico() {
  const corte = Date.now() - LAPS_DIAS * 86400_000;
  const viejas = db.prepare('DELETE FROM laps WHERE finishedAt < ?').run(corte).changes;
  const sobrantes = db.prepare(
    'DELETE FROM laps WHERE id NOT IN (SELECT id FROM laps ORDER BY id DESC LIMIT ?)').run(LAPS_MAX_FILAS).changes;
  const desviosViejos = db.prepare(
    'DELETE FROM deviations WHERE startedAt < ?').run(Date.now() - DESVIOS_DIAS * 86400_000).changes;
  const chat = pruneChatStmt.run({ corte: Date.now() - CHAT_DIAS * 86400_000 }).changes;
  const sos = pruneSosStmt.run({ corte: Date.now() - SOS_DIAS * 86400_000 }).changes;
  const mensajesDeMas = pruneRowsStmt.run({ tope: MENSAJES_MAX_FILAS }).changes;
  if (viejas || sobrantes || desviosViejos || chat || sos || mensajesDeMas) {
    console.log(`Historial podado: ${viejas + sobrantes} vuelta(s), ${desviosViejos} desvío(s), ` +
      `${chat + mensajesDeMas} mensaje(s), ${sos} SOS` +
      (sobrantes ? ` — ${sobrantes} vuelta(s) por el techo de ${LAPS_MAX_FILAS} filas` : ''));
  }
}

podarHistorico();
setInterval(podarHistorico, 6 * 3600_000).unref();

// ¿El objetivo de brecha se calcula solo? Apagado por defecto: una ruta
// recién cargada no tiene historial y el número manual es el que vale.
addColumnIfMissing('routes', 'autoTarget', 'INTEGER NOT NULL DEFAULT 0');

addColumnIfMissing('laps', 'routeId', 'TEXT');
if (db.prepare('SELECT COUNT(*) AS c FROM laps WHERE routeId IS NULL').get().c > 0) {
  db.prepare('UPDATE laps SET routeId = ? WHERE routeId IS NULL').run(DEFAULT_ROUTE);
}

// ─── PRESENCIA ───────────────────────────────────────────────
// El chofer DECLARA su estado desde la app — salir a ruta, ausente (comer,
// un repuesto), fuera (terminó) — pero declarar no basta: entrar a la
// cadena de brechas y a la medición de vueltas exige CONFIRMACIÓN física,
// el GPS parado sobre el trazado. El caso que esto evita es real: Ignacio
// marca "en ruta" a las 5:30 desde su casa, y sin la confirmación su señal
// le movería las brechas a todos los que pasan cerca.
//
// Sin declaración (clientes viejos, la flota fantasma vieja, las suites) la
// unidad se comporta como siempre: en cadena desde la primera posición.
//
// vehicleId → { estado: 'ruta'|'ausente', enRuta: bool (confirmada) }
// Vive aparte de `units` a propósito: el olvido a los 3 min borra la unidad
// del mapa, pero la palabra del chofer sigue valiendo cuando reaparece.
const presencias = new Map();

function fijarPresencia(vehicleId, routeId, estado) {
  if (estado === 'fuera') {
    // Se va del mapa EN EL ACTO, no a los 3 minutos del olvido: lo pidió él.
    presencias.delete(vehicleId);
    lapState.delete(vehicleId);
    // Terminó el turno estando fuera del trazado: el episodio se cierra acá.
    // Dejarlo abierto lo haría durar hasta que alguien lo mire.
    olvidarDesvio(vehicleId, 'corte');
    const u = units.get(vehicleId);
    units.delete(vehicleId);
    // El mismo aviso que manda el olvido: los mapas que borran por evento
    // no tienen por qué esperar al próximo estado completo.
    if (u) broadcastToRoute(u.routeId, { type: 'unit_left', unitId: vehicleId });
    scheduleStateBroadcast((u && u.routeId) || routeId);
    return;
  }
  const previa = presencias.get(vehicleId);
  if (previa && previa.estado === estado) return;
  // Todo cambio de estado descarta la vuelta a medias y obliga a
  // RECONFIRMAR sobre el trazado: un almuerzo en el medio no es una vuelta,
  // y volver de ausente es volver a entrar a la ruta.
  presencias.set(vehicleId, { estado, enRuta: false });
  lapState.delete(vehicleId);
  const u = units.get(vehicleId);
  if (u) units.set(vehicleId, { ...u, presencia: estado, enRuta: false });
  scheduleStateBroadcast((u && u.routeId) || routeId);
}

const lapState = new Map();
// lapState = { vehicleId → { lapStart, speedSum, speedCount, samples,
//                          lastProgress, brechaSum, brechaCount } }

// `cuando` es la hora en que se tomó la posición. Con el atraso de un túnel
// llegando de golpe, medir con la hora de llegada inflaría la vuelta por todo
// lo que duró el corte.
function trackLap(unitId, routeId, progress, speed, cuando = Date.now()) {
  let st = lapState.get(unitId);
  if (!st) {
    lapState.set(unitId, {
      lapStart: cuando, speedSum: 0, speedCount: 0, samples: 0, lastProgress: progress,
      brechaSum: 0, brechaCount: 0,
    });
    return;
  }
  st.speedSum += speed;
  st.speedCount++;
  st.samples++;

  // Caída brusca del progreso habiendo llegado cerca del final, con un
  // mínimo de muestras: eso es una vuelta completa, no ruido de GPS.
  //
  // Con el recorrido cargado por tramos, el progreso recorre TODO el circuito
  // (ida + vuelta), así que una "vuelta" es lo que la cooperativa llama una
  // vuelta: salir y volver. Es también lo que corresponde para el objetivo
  // automático, porque la rueda que se reparte entre las combis es el
  // circuito entero.
  if (st.lastProgress - progress > 0.5 && st.lastProgress > 0.8 && st.samples >= 5) {
    const now = cuando;
    const durationSec = Math.round((now - st.lapStart) / 1000);
    const avgSpeed = st.speedCount ? Math.round(st.speedSum / st.speedCount) : 0;
    // Con qué trazado se midió esta vuelta. La ruta sin geometría no tiene
    // variante que valga: el progreso vino estimado por el cliente.
    const geo = routeId ? geometriaDe(routeId) : null;
    // Brecha promedio de la vuelta. Queda NULL si no hubo con quién
    // compararse —una unidad sola en la ruta, o la que iba primera todo el
    // tiempo— y así no cuenta ni a favor ni en contra de nadie.
    const brechaProm = st.brechaCount ? Math.round(st.brechaSum / st.brechaCount) : null;
    // Contra qué vara se corrió esta vuelta. Se toma ACÁ, al cerrarla, porque
    // es el único momento en que existe: con objetivo automático el número
    // cambia con las unidades que hay en ruta, y dentro de un mes nadie puede
    // reconstruir cuántas había este martes a las 7. Sin ruta no hay objetivo
    // que valga —el progreso vino estimado por el cliente—, y queda NULL.
    const objetivoSec = routeId ? Math.round(objetivoDe(routeId).min * 60) : null;
    db.prepare('INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(unitId, routeId || null, geo ? geo.variantId : null, st.lapStart, now, durationSec, avgSpeed, brechaProm, objetivoSec);
    console.log(`Vuelta completada: ${unitId} en ${Math.round(durationSec / 60)} min`);
    objetivoCache.delete(routeId);   // hay un dato nuevo: que se recalcule
    lapState.set(unitId, {
      lapStart: now, speedSum: 0, speedCount: 0, samples: 0, lastProgress: progress,
      brechaSum: 0, brechaCount: 0,
    });
    return;
  }
  st.lastProgress = progress;
}

// Intentos fallidos por unidad: 5 seguidos → bloqueo de 5 minutos
const loginAttempts = new Map();

// El bloqueo por cuenta no alcanza: alguien puede probar UNA contraseña
// contra muchas cuentas distintas y nunca dispararlo. Por eso se cuenta
// también por origen. Los dos viven en memoria y se limpian solos.
const intentosPorIp = new Map();
const IP_MAX_FALLOS = 30;        // en la ventana
const IP_VENTANA_MS = 600_000;   // 10 minutos
const IP_BLOQUEO_MS = 600_000;

function origenDe(req) {
  // Railway y cualquier proxy ponen la IP real acá; el socket vería la del proxy
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'desconocido';
}

function ipBloqueada(ip) {
  const e = intentosPorIp.get(ip);
  return !!(e && e.until > Date.now());
}

function anotarFalloIp(ip) {
  const ahora = Date.now();
  const e = intentosPorIp.get(ip);
  if (!e || ahora - e.desde > IP_VENTANA_MS) {
    intentosPorIp.set(ip, { fallos: 1, desde: ahora, until: 0 });
    return;
  }
  e.fallos++;
  if (e.fallos >= IP_MAX_FALLOS) {
    e.until = ahora + IP_BLOQUEO_MS;
    console.warn(`Origen bloqueado por intentos fallidos: ${ip}`);
  }
}

// Limpieza cada media hora, para que el Map no crezca sin fin
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, e] of intentosPorIp) {
    if (e.until < ahora && ahora - e.desde > IP_VENTANA_MS) intentosPorIp.delete(ip);
  }
}, 1_800_000);

app.post('/auth/login', (req, res) => {
  const unitId = idLimpio(req.body?.user);
  const password = String(req.body?.password || '');
  if (!unitId || password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'Completá usuario y contraseña (mínimo 4 caracteres)' });
  }

  const ip = origenDe(req);
  if (ipBloqueada(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos desde este dispositivo. Esperá 10 minutos.' });
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
      // Cuenta como fallo: si no, probar usuarios sale gratis y sirve para
      // averiguar cuáles existen.
      anotarFalloIp(ip);
      return res.status(403).json({ error: 'Unidad no registrada. Pedí el alta a Despacho.' });
    }
    const role = unitId === DISPATCH_ID ? 'dispatch' : 'driver';
    const driverName = role === 'dispatch' ? 'Despacho' : unitId;
    // El DESPACHO de arranque queda como supervisor (routeId null): ve
    // todas las rutas. Una unidad auto-registrada va a la ruta inicial.
    const routeId = role === 'dispatch' ? null : DEFAULT_ROUTE;
    // Un alta de arranque entra a la empresa inicial: es la única que existe
    // cuando esto corre. Las demás empresas se dan de alta desde afuera.
    const companyId = empresaBase();
    db.prepare('INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(unitId, driverName, driverName, role, routeId, companyId, hashPassword(password), Date.now());
    user = { unitId, driverName, name: driverName, role, routeId, companyId };
    created = true;
    console.log(`${role === 'dispatch' ? 'Despacho' : 'Unidad'} registrado: ${unitId}`);
  } else if (!verifyPassword(password, user.passHash)) {
    anotarFalloIp(ip);
    const count = (a?.count || 0) + 1;
    loginAttempts.set(unitId, { count, until: count >= 5 ? Date.now() + 300_000 : 0 });
    if (count >= 5) audit(unitId, 'login_bloqueado', null, '5 intentos fallidos', user.routeId);
    return res.status(401).json({ error: `Contraseña incorrecta · intento ${count} de 5` });
  }

  // La empresa desactivada corta el acceso de toda su gente de una vez. Se
  // chequea DESPUÉS de la contraseña a propósito: si no, probar usuarios
  // contra una empresa suspendida diría cuáles existen.
  const empresaDeLaCuenta = companyOf(user.companyId);
  if (empresaDeLaCuenta && !empresaDeLaCuenta.activa) {
    audit(user.unitId, 'login_empresa_inactiva', null, empresaDeLaCuenta.companyId, user.routeId, user.companyId);
    return res.status(403).json({ error: 'El acceso de esta cooperativa está suspendido.' });
  }

  loginAttempts.delete(unitId);
  const token = createSession(user.unitId);
  db.prepare('UPDATE users SET lastLogin = ? WHERE unitId = ?').run(Date.now(), user.unitId);
  audit(user.unitId, 'login', null, created ? 'primer registro' : null, user.routeId);
  const ruta = user.routeId ? routeOf(user.routeId) : null;
  const empresa = companyOf(user.companyId);
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
    // La empresa dueña de la cuenta: es lo que se ve arriba de todo en el
    // panel y en la app. Sin esto el chofer de otra cooperativa abriría una
    // pantalla que dice COOP-R14.
    companyId: user.companyId || null,
    companyName: empresa ? empresa.name : null,
    supervisor: (user.role === 'dispatch' || user.role === 'manager') && !user.routeId,
    // La clave de las tiles del mapa. Vive en la variable de entorno
    // GEOAPIFY_API_KEY y llega a la app nativa por acá: la app no puede leer
    // /config.js (no es una página) y la clave no puede ir compilada en el
    // APK — rotarla obligaría a repartir una app nueva a toda la flota.
    tilesKey: TILES_KEY || null,
    // Y las zonas con mapa propio, por la misma razón: el WebView del mapa
    // decide con esto qué tiles pedir acá y cuáles al proveedor.
    tilesZonas: zonasDisponibles(),
    created,
  });
});

// ─── POSICIONES POR HTTP ─────────────────────────────────────
// El camino que usa la app nativa con la pantalla apagada.
//
// Por qué existe: Android suspende el JavaScript cuando la app pasa a
// segundo plano, y con él se cae el WebSocket. El servicio de ubicación
// nativo sigue vivo —la notificación permanente sigue ahí— pero las
// posiciones no tienen por dónde salir. Se midió en un teléfono real: la
// unidad quedaba muda apenas se bloqueaba la pantalla.
//
// Un POST no necesita nada vivo del lado del cliente, así que la tarea de
// fondo puede mandar aunque la app esté dormida. Y como acepta VARIAS
// posiciones con su hora, sirve además para vaciar el atraso que se juntó en
// una zona sin datos — que era lo que `app/cola.js` no podía hacer.
const MAX_POSICIONES_POR_ENVIO = 200;
const ATRASO_MAXIMO_MS = 6 * 3600_000;   // 6 h: más viejo que eso no se mide

// La presencia por HTTP: el mismo camino robusto que POST /gps, para que la
// app pueda declarar aunque el WebSocket esté caído. 'fuera' acá también:
// es el botón "salir de ruta" y tiene que funcionar hasta con mala señal.
app.post('/presencia', (req, res) => {
  const auth = String(req.headers.authorization || '');
  const user = sessionUser(auth.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  // SOLO el chofer, la misma regla que POST /gps: la presencia es DE LA
  // UNIDAD, y la unidad la lleva el que maneja. Si el cobrador pudiera
  // declarar, cerrar su app borraría del mapa una combi en plena vuelta.
  if (user.role !== 'driver') {
    return res.status(403).json({ error: 'La presencia la declara el chofer' });
  }
  const estado = ['ruta', 'ausente', 'fuera'].includes(req.body?.estado) ? req.body.estado : null;
  if (!estado) return res.status(400).json({ error: 'Estado inválido: ruta, ausente o fuera' });
  const vehicleId = user.vehicleId || user.unitId;
  fijarPresencia(vehicleId, user.routeId || DEFAULT_ROUTE, estado);
  res.json({ ok: true, estado });
});

app.post('/gps', (req, res) => {
  const auth = String(req.headers.authorization || '');
  const user = sessionUser(auth.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });

  // Las mismas reglas que por WebSocket: solo el chofer reporta, el cobrador
  // nunca, y si otro chofer tomó la unidad manda el otro.
  if (user.role !== 'driver') return res.status(403).json({ error: 'Solo el chofer reporta posición' });
  const vehicleId = user.vehicleId || user.unitId;
  const duenoWs = gpsOwner.get(vehicleId);
  if (duenoWs && clients.get(duenoWs) && clients.get(duenoWs) !== user.unitId) {
    return res.status(409).json({ error: 'Otro chofer tomó esta unidad' });
  }

  // La presencia puede venir pegada a las posiciones: con la pantalla
  // apagada el WebSocket muere y este POST es el único canal, y así el
  // estado declarado sobrevive hasta a un reinicio del servidor. 'fuera'
  // no viaja por acá: para irse se deja de mandar (y está POST /presencia).
  if (req.body?.presencia === 'ruta' || req.body?.presencia === 'ausente') {
    fijarPresencia(vehicleId, user.routeId || DEFAULT_ROUTE, req.body.presencia);
  }

  const crudas = Array.isArray(req.body?.posiciones) ? req.body.posiciones : [];
  if (!crudas.length) return res.status(400).json({ error: 'Sin posiciones' });
  if (crudas.length > MAX_POSICIONES_POR_ENVIO) {
    return res.status(413).json({ error: `Máximo ${MAX_POSICIONES_POR_ENVIO} posiciones por envío` });
  }

  // Se ordenan por hora y se descartan las imposibles. Un reloj adelantado
  // mandaría posiciones del futuro y arruinaría la medición de la vuelta;
  // una demasiado vieja ya no le sirve a nadie.
  const ahora = Date.now();
  const buenas = crudas
    .filter(p => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    .map(p => ({
      lat: p.lat, lng: p.lng, speed: Number(p.speed) || 0,
      cuando: Number(p.timestamp) || ahora,
    }))
    .filter(p => p.cuando <= ahora + 120_000 && p.cuando >= ahora - ATRASO_MAXIMO_MS)
    .sort((a, b) => a.cuando - b.cuando);

  if (!buenas.length) return res.status(400).json({ error: 'Ninguna posición utilizable' });

  const prof = profiles.get(user.unitId) || {
    routeId: user.routeId, vehicleId, role: user.role,
    driverName: displayName(user), companyId: user.companyId,
  };
  // Se abre turno igual que al identificarse por WebSocket: si el chofer solo
  // reporta por HTTP (app en segundo plano toda la mañana) igual trabajó.
  abrirTurno(user.unitId, vehicleId, user.routeId || prof.routeId || DEFAULT_ROUTE, user.role);

  let routeId = null;
  for (const p of buenas) {
    routeId = anotarPosicion(vehicleId, user.unitId, prof, p, p.cuando);
  }
  res.json({ ok: true, aceptadas: buenas.length, descartadas: crudas.length - buenas.length, routeId });
});

// ─── ADMINISTRACIÓN (solo Despacho) ──────────────────────────
// Altas, resets de contraseña y bajas de unidades. Todo exige un token
// de sesión con rol dispatch en el header Authorization.

function requireDispatch(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = sessionUser(token);
  // Se distingue "no hay sesión" (401) de "esta sesión no alcanza" (403).
  // No es un detalle: el panel trata el 401 como sesión vencida y saca al
  // usuario al login, así que devolver 401 por falta de permisos echaría a
  // un despachador que simplemente pidió algo que no le corresponde.
  if (!user) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
  // El gerente y el administrador usan EL MISMO panel (Despacho): el
  // gerente es una cuenta de arriba con más permisos, no otro mundo. Lo que
  // distingue a cada uno se decide endpoint por endpoint con req.esGerente.
  if (user.role !== 'dispatch' && user.role !== 'manager') {
    return res.status(403).json({ error: 'Requiere una cuenta de Despacho o de gerencia' });
  }
  // Sin empresa no se administra nada. No es un caso teórico: es la puerta
  // que quedaría abierta si alguien creara una cuenta a mano en la base, y
  // dejarla cerrada es lo que mantiene el nivel de arriba fuera del login.
  if (!user.companyId || !companyOf(user.companyId)) {
    return res.status(403).json({ error: 'Esta cuenta no está asignada a ninguna empresa' });
  }
  req.dispatchUser = user;
  req.esGerente = user.role === 'manager';
  // Alcance del despachador. Dos bordes, y el de afuera manda:
  //   empresa → nunca se ve ni se toca nada de otra cooperativa
  //   ruta    → dentro de la empresa, un despachador de ruta ve solo la suya
  //             y el supervisor (dispatch sin ruta) ve todas las de su empresa
  req.empresa = user.companyId;
  req.scope = user.routeId || null;
  next();
}

// Solo el supervisor puede crear rutas o tocar otras rutas de su empresa
function requireSupervisor(req, res, next) {
  requireDispatch(req, res, () => {
    if (req.scope) {
      return res.status(403).json({ error: 'Requiere una cuenta supervisora (sin ruta asignada)' });
    }
    next();
  });
}

// Lo que separa al GERENTE del administrador del día: los ACTIVOS de la
// cooperativa. El admin opera lo que existe —gente, turnos, objetivo, el
// mapa—; el gerente decide QUÉ existe: los vehículos con su placa, los
// datos de la empresa, el logo. Es la diferencia entre manejar la flota y
// ser responsable de ella.
function requireGerente(req, res, next) {
  requireDispatch(req, res, () => {
    if (!req.esGerente) {
      return res.status(403).json({ error: 'Esto lo hace la cuenta de gerencia' });
    }
    next();
  });
}

// ¿Puede este despachador operar sobre esta ruta? Primero la empresa, después
// el alcance por ruta. Devuelve null si puede, o { error, msg } si no.
//
// La respuesta cuando la ruta es de otra empresa es la misma que cuando no
// existe: un 404. Distinguirlas serviría para averiguar qué rutas hay en las
// otras cooperativas probando códigos.
function vetoDeRuta(req, routeId) {
  if (!rutaDeEmpresa(routeId, req.empresa)) {
    return { error: 404, msg: 'Esa ruta no existe' };
  }
  if (req.scope && req.scope !== routeId) {
    return { error: 403, msg: 'Esa ruta no es tuya' };
  }
  return null;
}

// La ruta sobre la que va a operar: el supervisor puede elegir entre las de
// su empresa, un despachador de ruta siempre trabaja sobre la suya.
function rutaObjetivo(req) {
  if (req.scope) return req.scope;
  const pedida = String(req.body?.routeId || req.query?.routeId || '').trim();
  if (pedida && rutaDeEmpresa(pedida, req.empresa)) return pedida;
  const rs = routesOfCompany(req.empresa);
  return rs[0] ? rs[0].routeId : null;
}

// ─── LA MARCA DE LA COOPERATIVA ──────────────────────────────
//
// Suena a decoración y no lo es. Este sistema atiende a VARIAS cooperativas a
// la vez, y hasta ahora la única señal de a cuál pertenecía una pantalla era
// el nombre en un rincón. Un chofer que abre la app y ve la marca de otra
// cooperativa —o ninguna— no sabe si se equivocó de cuenta ni a quién
// reclamarle.
//
// Va en su propio endpoint y NO adentro del login por dos razones: se puede
// pedir de nuevo sin volver a entrar (Despacho lo cambia y las pantallas lo
// ven), y no infla cada login con ~100 kB de imagen.
app.get('/marca', (req, res) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = sessionUser(token);
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  const empresa = companyOf(user.companyId);
  res.json({ marca: marca.marcaDe(empresa) });
});

// Cambiarlo es cosa del GERENTE, no del chofer ni del administrador del
// día: el logo es la identidad de la empresa, un activo más.
//
// OJO: la cooperativa sale de LA SESIÓN y no del cuerpo. Si viniera en el
// cuerpo, cualquier cuenta podría pisarle el logo a la cooperativa de al
// lado mandando el id ajeno. Está cubierto en la suite `marca`.
app.put('/admin/company/logo', requireGerente, (req, res) => {
  const crudo = req.body?.logo;
  // Sacarlo tiene que ser posible: un logo mal subido no puede quedar pegado
  // hasta que alguien toque la base a mano.
  if (crudo === null || crudo === '') {
    db.prepare('UPDATE companies SET logo = NULL WHERE companyId = ?').run(req.empresa);
    return res.json({ ok: true, logo: null });
  }
  const logo = marca.logoValido(crudo);
  if (!logo) return res.status(400).json({ error: marca.motivoRechazo(crudo) });
  db.prepare('UPDATE companies SET logo = ? WHERE companyId = ?').run(logo, req.empresa);
  res.json({ ok: true, logo });
});

// ─── LA EMPRESA ──────────────────────────────────────────────
// Cada cooperativa ve y corrige SUS datos. Crear una empresa nueva no está
// acá a propósito: eso lo hace el nivel de arriba con `empresa.js`, desde el
// servidor. Si el alta de empresas fuera un endpoint más, cualquier cuenta
// de despacho comprometida podría fabricarse una cooperativa entera.
app.get('/admin/company', requireDispatch, (req, res) => {
  const c = companyOf(req.empresa);
  if (!c) return res.status(404).json({ error: 'Esa empresa no existe' });
  const rutas = routesOfCompany(req.empresa);
  res.json({
    empresa: {
      companyId: c.companyId, name: c.name, ruc: c.ruc, contacto: c.contacto,
      activa: !!c.activa, createdAt: c.createdAt,
    },
    // El tamaño de la cooperativa, que es lo que se mira al facturar
    resumen: {
      rutas: rutas.length,
      vehiculos: db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE companyId = ?').get(req.empresa).c,
      // Igual que en el nivel de arriba: personas es la gente de las combis;
      // Despacho y gerencia se cuentan aparte porque son otra cosa.
      personas: db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role NOT IN ('dispatch', 'manager')").get(req.empresa).c,
      despacho: db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role = 'dispatch'").get(req.empresa).c,
      gerencia: db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role = 'manager'").get(req.empresa).c,
      enLinea: Array.from(units.values()).filter(u => rutas.some(r => r.routeId === u.routeId)).length,
    },
    // Los datos de la empresa los corrige el gerente sin ruta acotada: son
    // de la cooperativa entera, no de una ruta ni del turno de hoy.
    puedeEditar: req.esGerente && !req.scope,
  });
});

// Corregir los datos de la propia empresa. El código (companyId) no se toca:
// cuelga de él todo lo demás, y renombrarlo sería mover la cooperativa entera.
app.post('/admin/company', requireGerente, (req, res) => {
  if (req.scope) {
    return res.status(403).json({ error: 'Los datos de la empresa los corrige la gerencia de toda la cooperativa' });
  }
  const c = companyOf(req.empresa);
  if (!c) return res.status(404).json({ error: 'Esa empresa no existe' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'El nombre de la cooperativa es obligatorio' });
  const ruc = String(req.body?.ruc || '').trim().slice(0, 20) || null;
  const contacto = String(req.body?.contacto || '').trim().slice(0, 80) || null;
  db.prepare('UPDATE companies SET name = ?, ruc = ?, contacto = ? WHERE companyId = ?')
    .run(name, ruc, contacto, req.empresa);
  audit(req.dispatchUser.unitId, 'editar_empresa', req.empresa, name, null, req.empresa);
  res.json({ ok: true, empresa: { companyId: c.companyId, name, ruc, contacto } });
});

// ─── RUTAS (alta y listado) ──────────────────────────────────
app.get('/admin/routes', requireDispatch, (req, res) => {
  const rutas = routesOfCompany(req.empresa)
    .filter(r => !req.scope || r.routeId === req.scope)
    .map(r => {
      const geo = geometriaDe(r.routeId);
      const objetivo = objetivoDe(r.routeId);
      return {
        ...r,
        objetivo,
        unidades: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'driver' AND routeId = ?").get(r.routeId).c,
        enLinea: Array.from(units.values()).filter(u => u.routeId === r.routeId).length,
        // Recorrido cargado: cuántos puntos por tramo y cuántos metros
        puntos: geo ? geo.ida.puntos.length + (geo.vuelta ? geo.vuelta.puntos.length : 0) : 0,
        tieneVuelta: !!(geo && geo.vuelta),
        largoM: geo ? Math.round(geo.largoTotalM) : 0,
        // Con qué variante está midiendo y cuáles tiene guardadas. La lista
        // va acá y no en un pedido aparte porque son dos o tres filas por
        // ruta: pedirlas por separado sería un viaje de más por nada.
        variante: varianteActiva(r.routeId).name,
        variantes: variantesDe(r.routeId).map(v => ({
          variantId: v.variantId, name: v.name, activa: !!v.activa,
          puntos: v.puntos, desde: v.desde, hasta: v.hasta,
        })),
      };
    });
  const empresa = companyOf(req.empresa);
  res.json({
    routes: rutas,
    supervisor: !req.scope,
    empresa: empresa ? { companyId: empresa.companyId, name: empresa.name } : null,
  });
});

// CREAR UNA RUTA NO ESTÁ ACÁ, y es a propósito.
//
// Antes Despacho podía crear rutas — quedó de cuando este era el único panel
// que existía. Con el nivel de arriba ya hecho quedaba incoherente: Despacho
// no puede crear una VARIANTE de un recorrido (eso es cartografía, la
// dibujamos nosotros) pero podía crear una ruta entera, que es un acto
// bastante más grande. Además la ruta es la unidad por la que se cuenta y se
// factura una cooperativa.
//
// Así que la línea quedó donde tiene sentido: **la estructura la definimos
// nosotros, la operación del día es de ellos.** Despacho administra a su
// gente, su flota, los objetivos, los turnos, los desvíos, los informes y
// elige con qué trazado se mide. Lo que no hace es inventarse rutas.
//
// El alta vive en el panel del creador (`creador.js`) y en la consola
// (`empresa.js`), las dos sobre la misma función: `cooperativas.altaRuta`.

// Objetivo de brecha: prenderlo/apagarlo y fijar el valor manual, que es a
// la vez el respaldo del automático (arranque en frío, o pocas vueltas).
app.post('/admin/routes/:routeId/target', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  const ruta = routeOf(routeId);

  const auto = req.body?.auto === undefined ? ruta.autoTarget : (req.body.auto ? 1 : 0);
  let manual = ruta.targetGapMin;
  if (req.body?.targetGapMin !== undefined) {
    const v = Number(req.body.targetGapMin);
    if (!Number.isFinite(v) || v < OBJETIVO_MIN || v > OBJETIVO_MAX) {
      return res.status(400).json({ error: `El objetivo manual va entre ${OBJETIVO_MIN} y ${OBJETIVO_MAX} minutos` });
    }
    manual = v;
  }

  db.prepare('UPDATE routes SET autoTarget = ?, targetGapMin = ? WHERE routeId = ?')
    .run(auto, manual, routeId);
  objetivoCache.delete(routeId);   // que se recalcule ya, sin esperar el minuto

  const vigente = objetivoDe(routeId);
  audit(req.dispatchUser.unitId, 'objetivo', routeId,
    auto ? `automático (vigente ${vigente.min} min)` : `manual ${manual} min`, routeId);
  scheduleStateBroadcast(routeId, true);
  res.json({ ok: true, auto: !!auto, targetGapMin: manual, vigente });
});

// ─── VARIANTES DEL RECORRIDO ─────────────────────────────────
// Despacho ELIGE entre las variantes cargadas; quién las crea es otra cosa
// (ver el panel del creador). Activar una es operación del día: se hace
// cuando empieza la obra y se deshace cuando termina.

// Todo lo que hay que rehacer cuando una ruta cambia de trazado.
function aplicarCambioDeVariante(routeId, nueva, anterior, quien, motivo) {
  geometrias.delete(routeId);
  cargarGeometria(routeId);

  // Las vueltas en curso se venían midiendo sobre el trazado anterior: su
  // progreso quedó corrido y la que se cierre ahora sería una mezcla de dos
  // geometrías. Se descartan y se arranca de nuevo — perder una vuelta es
  // mejor que guardar una medida que no significa nada.
  let descartadas = 0;
  for (const [vehicleId, unidad] of units) {
    if (unidad.routeId === routeId && lapState.delete(vehicleId)) descartadas++;
  }

  // El estado de desvío también: lo que estaba fuera con el trazado viejo
  // puede estar adentro del nuevo, y al revés. El episodio abierto se cierra
  // marcado como 'trazado' — de esos no se puede afirmar cuánto duró el
  // desvío, porque a mitad de camino cambió contra qué se lo medía.
  for (const [vehicleId, unidad] of units) {
    if (unidad.routeId === routeId) olvidarDesvio(vehicleId, 'trazado');
  }

  // El objetivo automático se recalcula solo con las vueltas de ESTA
  // variante, que al principio son cero: vuelve al valor manual hasta juntar
  // historial nuevo. Es lo correcto — un trazado más largo tarda más.
  objetivoCache.delete(routeId);

  const msg = mensajeGeometria(routeId);
  for (const [ws, mirando] of watching) {
    if (mirando === routeId && ws.readyState === 1) { try { ws.send(msg); } catch {} }
  }
  scheduleStateBroadcast(routeId, true);

  const detalle = `${anterior ? anterior.name + ' → ' : ''}${nueva.name}` +
    (descartadas ? ` · ${descartadas} vuelta(s) en curso descartada(s)` : '') +
    (motivo ? ` · ${motivo}` : '');
  audit(quien, 'variante', routeId, detalle, routeId);
  console.log(`Ruta ${routeId}: ahora mide con "${nueva.name}"`);
  return descartadas;
}

function activarVariante(routeId, variantId, quien, motivo) {
  const v = db.prepare('SELECT * FROM route_variants WHERE variantId = ? AND routeId = ?')
    .get(variantId, routeId);
  if (!v) return { error: 404, msg: 'Esa variante no existe' };
  const anterior = varianteActiva(routeId);
  if (anterior.variantId === v.variantId) return { ok: true, variante: v, sinCambios: true };

  db.transaction(() => {
    db.prepare('UPDATE route_variants SET activa = 0 WHERE routeId = ?').run(routeId);
    db.prepare('UPDATE route_variants SET activa = 1 WHERE variantId = ?').run(v.variantId);
  })();

  const descartadas = aplicarCambioDeVariante(routeId, v, anterior, quien, motivo);
  return { ok: true, variante: v, descartadas };
}

// La vigencia programada: una variante por obra tiene fecha de fin, y
// acordarse de desactivarla el día justo no es un plan. Se revisa cada
// minuto — no hace falta más fino, esto se mide en días.
//
// La regla es simple y se resuelve sola: si hay una variante vigente por
// fecha, esa manda; si la vigente se venció, vuelve la base. Nunca se apaga
// una ruta: si nada aplica, queda la variante base.
function revisarVigencias() {
  const ahora = Date.now();
  for (const ruta of allRoutes()) {
    const variantes = variantesDe(ruta.routeId);
    if (variantes.length < 2) continue;
    const activa = variantes.find(v => v.activa);

    // La programada que corresponde a hoy. Si hay varias solapadas gana la
    // más nueva: es la que se cargó sabiendo de las anteriores.
    const vigente = variantes
      .filter(v => (v.desde || v.hasta) &&
                   (!v.desde || v.desde <= ahora) &&
                   (!v.hasta || v.hasta > ahora))
      .sort((a, b) => b.variantId - a.variantId)[0];

    const destino = vigente || variantes.find(v => !v.desde && !v.hasta) || variantes[0];
    if (destino && activa && destino.variantId !== activa.variantId) {
      activarVariante(ruta.routeId, destino.variantId, 'sistema',
        vigente ? 'por vigencia programada' : 'venció la vigencia');
    }
  }
}
setInterval(revisarVigencias, 60_000);
// La primera revisión NO va acá sino al final, cuando el servidor ya
// escucha: activar una variante toca cachés y clientes que se definen más
// abajo en este archivo, y llamarla mientras el módulo todavía se está
// evaluando tumbaba el arranque.

app.get('/admin/routes/:routeId/variantes', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  varianteActiva(routeId);   // se asegura de que haya una, y de que esté activa
  res.json({ routeId, variantes: variantesDe(routeId) });
});

// Elegir con cuál se mide. Es lo único que Despacho decide sobre variantes:
// crearlas y dibujarlas es cartografía, no operación del día.
app.post('/admin/routes/:routeId/variantes/:variantId/activar', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  const r = activarVariante(routeId, Number(req.params.variantId), req.dispatchUser.unitId);
  if (r.error) return res.status(r.error).json({ error: r.msg });
  res.json({ ok: true, variante: r.variante, descartadas: r.descartadas || 0 });
});

// ─── RECORRIDO DE LA RUTA (puntos GPS) ───────────────────────
// Los puntos son de UNA variante. Sin `?variantId=` se trabaja sobre la
// activa, que es lo que hacía antes de que existieran las variantes.
function varianteObjetivo(req, routeId) {
  const pedida = Number(req.query?.variantId ?? req.body?.variantId);
  if (!Number.isFinite(pedida)) return varianteActiva(routeId);
  return db.prepare('SELECT * FROM route_variants WHERE variantId = ? AND routeId = ?')
    .get(pedida, routeId) || null;
}

app.get('/admin/routes/:routeId/points', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  const variante = varianteObjetivo(req, routeId);
  if (!variante) return res.status(404).json({ error: 'Esa variante no existe' });

  const ida = puntosDeVariante(variante.variantId, 'ida');
  const vuelta = puntosDeVariante(variante.variantId, 'vuelta');
  // El largo se calcula sobre lo pedido, que puede no ser la variante activa
  const tIda = armarTramo(ida), tVuelta = armarTramo(vuelta);
  res.json({
    routeId,
    variante: { variantId: variante.variantId, name: variante.name, activa: !!variante.activa },
    tramos: { ida, vuelta },
    largoM: tIda ? Math.round(tIda.largoM + (tVuelta ? tVuelta.largoM : 0)) : 0,
  });
});

// Guarda el recorrido completo de una vez: llega la lista entera de puntos y
// reemplaza la anterior. Es más simple y más seguro que editar punto por
// punto — el panel manda lo que quedó dibujado en el mapa.
// Guardar el recorrido de una variante, DE PUNTA A PUNTA: validación,
// escritura transaccional, recarga de la geometría viva y aviso a los mapas.
// Es una función y no código del handler porque la usan DOS niveles — el
// panel de Despacho y el del creador — y dos copias de esto es una que se
// queda atrás justo en lo que recalcula todas las brechas de una ruta.
//
// Devuelve { error, status } o el resultado. `quien` es solo para el diario.
function guardarRecorrido(routeId, variante, cuerpoCrudo, quien) {
  // Llegan los dos tramos. Se acepta también una lista suelta, que se toma
  // como la ida (así no se rompe nada que mande el formato viejo).
  const cuerpo = Array.isArray(cuerpoCrudo?.points)
    ? { ida: cuerpoCrudo.points, vuelta: [] }
    : (cuerpoCrudo?.tramos || null);
  if (!cuerpo) return { error: 'Faltan los puntos del recorrido', status: 400 };

  const limpios = {};
  for (const leg of TRAMOS) {
    const crudos = Array.isArray(cuerpo[leg]) ? cuerpo[leg] : [];
    if (crudos.length > 2000) {
      return { error: `Demasiados puntos en la ${leg}: el tope es 2000`, status: 400 };
    }
    // Se validan uno por uno: un punto fuera de rango arruinaría el cálculo
    // de todas las brechas de la ruta, así que se rechaza el lote entero.
    const puntos = [];
    for (const p of crudos) {
      const lat = Number(p?.lat), lng = Number(p?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { error: `Hay un punto con coordenadas inválidas en la ${leg}`, status: 400 };
      }
      puntos.push({ lat, lng });
    }
    if (puntos.length === 1) {
      return { error: `La ${leg} necesita al menos 2 puntos`, status: 400 };
    }
    limpios[leg] = puntos;
  }
  // Una vuelta sin ida no tiene sentido: el circuito arranca por la ida
  if (!limpios.ida.length && limpios.vuelta.length) {
    return { error: 'No se puede cargar la vuelta sin la ida', status: 400 };
  }

  const guardar = db.transaction(() => {
    db.prepare('DELETE FROM route_points WHERE variantId = ?').run(variante.variantId);
    const ins = db.prepare('INSERT INTO route_points (variantId, leg, seq, lat, lng) VALUES (?, ?, ?, ?, ?)');
    for (const leg of TRAMOS) limpios[leg].forEach((p, i) => ins.run(variante.variantId, leg, i, p.lat, p.lng));
  });
  guardar();

  // Solo se recarga y se avisa si se tocó la variante con la que se está
  // midiendo. Dibujar una variante guardada no tiene por qué mover el mapa
  // de nadie ni recalcular ninguna brecha — ese es medio el punto.
  const esLaActiva = !!variante.activa;
  const tIda = armarTramo(limpios.ida), tVuelta = armarTramo(limpios.vuelta);
  const largoM = tIda ? Math.round(tIda.largoM + (tVuelta ? tVuelta.largoM : 0)) : 0;

  if (esLaActiva) cargarGeometria(routeId);

  const detalle = `${variante.name}: ` + (tIda
    ? `ida ${limpios.ida.length} pts${limpios.vuelta.length ? ` · vuelta ${limpios.vuelta.length} pts` : ''} · ${(largoM / 1000).toFixed(2)} km`
    : 'recorrido borrado');
  audit(quien, 'recorrido', routeId, detalle, routeId);
  console.log(`Recorrido de ${routeId} — ${detalle}`);

  if (esLaActiva) {
    // Los mapas de esa ruta reciben el trazado nuevo, y las brechas se
    // recalculan con él al instante
    const geoMsg = mensajeGeometria(routeId);
    for (const [ws, mirando] of watching) {
      if (mirando === routeId && ws.readyState === 1) {
        try { ws.send(geoMsg); } catch {}
      }
    }
    scheduleStateBroadcast(routeId, true);
  }

  return {
    ok: true,
    variante: { variantId: variante.variantId, name: variante.name, activa: esLaActiva },
    puntos: { ida: limpios.ida.length, vuelta: limpios.vuelta.length },
    largoM,
  };
}

app.put('/admin/routes/:routeId/points', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  const variante = varianteObjetivo(req, routeId);
  if (!variante) return res.status(404).json({ error: 'Esa variante no existe' });

  const r = guardarRecorrido(routeId, variante, req.body, req.dispatchUser.unitId);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json(r);
});

// ─── VEHÍCULOS ───────────────────────────────────────────────
app.get('/admin/vehicles', requireDispatch, (req, res) => {
  const vehiculos = db.prepare(`
    SELECT vehicleId, label, routeId, createdAt FROM vehicles
    WHERE companyId = @empresa
      AND (@scope IS NULL OR routeId = @scope)
    ORDER BY routeId, vehicleId
  `).all({ empresa: req.empresa, scope: req.scope }).map(v => ({
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

// El vehículo es un ACTIVO: placa, permiso de ruta, seguro. Lo da de alta
// el gerente; el administrador del día asigna gente a los que existen.
app.post('/admin/vehicles', requireGerente, (req, res) => {
  const vehicleId = idLimpio(req.body?.vehicleId);
  if (req.body?.vehicleId && !vehicleId) {
    return res.status(400).json({ error: 'El código del vehículo solo admite letras, números, punto, guion y guion bajo' });
  }
  const label = String(req.body?.label || '').trim().slice(0, 40) || null;
  const routeId = rutaObjetivo(req);
  if (!vehicleId) return res.status(400).json({ error: 'Falta el código del vehículo (ej. M-21)' });
  if (!routeId) return res.status(400).json({ error: 'La empresa todavía no tiene ninguna ruta' });
  // Igual que con las rutas: el código de vehículo es único en el servidor
  if (vehicleOf(vehicleId)) return res.status(409).json({ error: 'Ese código de vehículo ya está tomado' });
  db.prepare('INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(vehicleId, label, routeId, req.empresa, Date.now());
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
  // Un despachador de ruta solo ve su gente (y las cuentas de despacho de su
  // empresa); el supervisor ve toda su empresa. Nadie ve la de al lado.
  //
  // Ojo con la excepción de las cuentas de despacho: antes era
  // `OR role = 'dispatch'` a secas, y así escrita mostraría los despachadores
  // de TODAS las cooperativas. Va dentro del filtro de empresa.
  // Los gerentes se listan aunque Despacho no los pueda tocar: que la gente
  // de la cooperativa que mira los números esté a la vista es parte de que se
  // sepa quién mira. Esconderlos sería peor que mostrarlos sin botones.
  const users = db.prepare(`
    SELECT unitId, driverName, name, alias, role, routeId, vehicleId, createdAt, lastLogin FROM users
    WHERE companyId = @empresa
      AND (@scope IS NULL OR routeId = @scope OR role IN ('dispatch', 'manager'))
    ORDER BY CASE role WHEN 'dispatch' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
             routeId, vehicleId, unitId
  `).all({ empresa: req.empresa, scope: req.scope });
  res.json({
    users: users.map(u => ({ ...u, online: online.has(u.unitId) })),
    supervisor: !req.scope,
    scope: req.scope,
  });
});

// Alta de PERSONAS: el nombre real es obligatorio (queda en los registros
// de la empresa) y el alias es opcional (como la llaman en la ruta).
app.post('/admin/users', requireDispatch, (req, res) => {
  const unitId = idLimpio(req.body?.unitId);
  if (req.body?.unitId && !unitId) {
    return res.status(400).json({ error: 'El usuario solo admite letras, números, punto, guion y guion bajo' });
  }
  const name = String(req.body?.name || req.body?.driverName || '').trim().slice(0, 60);
  const alias = String(req.body?.alias || '').trim().slice(0, 30) || null;
  const rolPedido = String(req.body?.personRole || 'driver');
  const role = rolPedido === 'collector' ? 'collector' : 'driver';
  const password = String(req.body?.password || '');
  const routeId = rutaObjetivo(req);
  const vehicleId = req.body?.vehicleId ? idLimpio(req.body.vehicleId) : null;
  if (req.body?.vehicleId && !vehicleId) {
    return res.status(400).json({ error: 'El código del vehículo no es válido' });
  }

  if (!unitId) return res.status(400).json({ error: 'Falta el usuario con el que va a entrar' });
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (password.length < CLAVE_MINIMA || password.length > 64) {
    return res.status(400).json({ error: `La contraseña necesita entre ${CLAVE_MINIMA} y 64 caracteres` });
  }
  if (!routeId) return res.status(400).json({ error: 'La empresa todavía no tiene ninguna ruta' });
  if (db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(unitId)) {
    return res.status(409).json({ error: 'Ese usuario ya está tomado' });
  }
  // El vehículo tiene que existir; si no se indica y es chofer, se crea uno
  // con su mismo código (el caso habitual: el chofer y su combi).
  let vehiculoFinal = vehicleId;
  if (vehiculoFinal) {
    const veh = vehicleOf(vehiculoFinal);
    // Un vehículo de otra empresa se responde igual que uno inexistente: si
    // no, este formulario sirve para averiguar las flotas de las demás.
    if (!veh || veh.companyId !== req.empresa) {
      return res.status(400).json({ error: `El vehículo ${vehiculoFinal} no existe` });
    }
    if (req.scope && veh.routeId !== req.scope) {
      return res.status(403).json({ error: 'Ese vehículo pertenece a otra ruta' });
    }
  } else if (role === 'driver') {
    vehiculoFinal = unitId;
    if (!vehicleOf(vehiculoFinal)) {
      // Crear el vehículo al vuelo es crear un ACTIVO, y eso es del gerente.
      // El admin da de alta a la persona y la sube a un vehículo que exista.
      if (!req.esGerente) {
        return res.status(403).json({
          error: `No existe el vehículo ${vehiculoFinal}. Los vehículos (con su placa) los da de alta la cuenta de gerencia; elegí uno existente o pedile el alta.`,
        });
      }
      db.prepare('INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)')
        .run(vehiculoFinal, null, routeId, req.empresa, Date.now());
    }
  } else {
    return res.status(400).json({ error: 'Un cobrador necesita un vehículo asignado' });
  }

  db.prepare(`
    INSERT INTO users (unitId, driverName, name, alias, role, routeId, vehicleId, companyId, passHash, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(unitId, alias || name, name, alias, role, routeId, vehiculoFinal, req.empresa, hashPassword(password), Date.now());

  const quien = alias ? `${name} (${alias})` : name;
  audit(req.dispatchUser.unitId, 'alta', unitId,
    `${quien} · ${role === 'collector' ? 'cobrador' : 'chofer'} · ${vehiculoFinal} · ruta ${routeId}`, routeId);
  console.log(`Alta de ${role}: ${quien} en ${vehiculoFinal} (${routeId})`);
  res.json({ ok: true, unitId, routeId, vehicleId: vehiculoFinal, role });
});

// Un despachador de ruta solo puede administrar cuentas de SU ruta
function cuentaEnAlcance(req, unitId) {
  const u = db.prepare('SELECT unitId, role, routeId, companyId FROM users WHERE unitId = ?').get(unitId);
  // Una cuenta de otra empresa se responde como inexistente. Distinguirlas
  // convertiría estos endpoints en un buscador de usuarios ajenos.
  if (!u || u.companyId !== req.empresa) return { error: 404, msg: 'Esa unidad no existe' };
  if (req.scope && u.routeId !== req.scope) {
    return { error: 403, msg: 'Esa unidad pertenece a otra ruta' };
  }
  // Despacho NO toca a un gerente. El panel del gerente mide, entre otras
  // cosas, qué tan bien se está corriendo la ruta — o sea, el trabajo de
  // Despacho. Si Despacho pudiera resetearle la clave o darlo de baja, esa
  // medición no valdría nada. Las cuentas de gerente las maneja el nivel de
  // arriba, igual que las de Despacho las maneja el creador.
  if (u.role === 'manager') {
    return { error: 403, msg: 'Las cuentas de gerencia se manejan desde el nivel de arriba' };
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
  if (password.length < CLAVE_MINIMA || password.length > 64) {
    return res.status(400).json({ error: `La contraseña nueva necesita mínimo ${CLAVE_MINIMA} caracteres` });
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
    WHERE companyId = @empresa
      AND (@scope IS NULL OR routeId = @scope)
    ORDER BY id DESC LIMIT 100
  `).all({ empresa: req.empresa, scope: req.scope });
  res.json({ events });
});

// Gestión del desvío de una ruta: a partir de cuántos metros se considera
// fuera, y silenciarlo un rato cuando el desvío es conocido (una obra, un
// desfile, un embotellamiento que ya está avisado).
app.post('/admin/routes/:routeId/desvio', requireDispatch, (req, res) => {
  const routeId = String(req.params.routeId);
  const veto = vetoDeRuta(req, routeId);
  if (veto) return res.status(veto.error).json({ error: veto.msg });
  const ruta = routeOf(routeId);

  let umbral = ruta.desvioMaxM || DESVIO_DEFECTO_M;
  if (req.body?.umbralM !== undefined) {
    const v = Number(req.body.umbralM);
    // Menos de 50 m (media cuadra) es ruido de GPS; más de 1500 m ya no
    // detecta nada. Entre esos dos hay margen para una ruta de centro
    // apretada y para un tramo de carretera abierta.
    if (!Number.isFinite(v) || v < 50 || v > 1500) {
      return res.status(400).json({ error: 'El umbral va entre 50 y 1500 metros' });
    }
    umbral = Math.round(v);
  }

  let mudoHasta = ruta.desvioMudoHasta || null;
  if (req.body?.silenciarMin !== undefined) {
    const m = Number(req.body.silenciarMin);
    if (!Number.isFinite(m) || m < 0 || m > 720) {
      return res.status(400).json({ error: 'Se puede silenciar hasta 12 horas' });
    }
    mudoHasta = m > 0 ? Date.now() + m * 60_000 : null;
  }

  db.prepare('UPDATE routes SET desvioMaxM = ?, desvioMudoHasta = ? WHERE routeId = ?')
    .run(umbral, mudoHasta, routeId);
  audit(req.dispatchUser.unitId, 'desvio_config', routeId,
    `umbral ${umbral} m` + (mudoHasta ? ` · silenciado hasta ${new Date(mudoHasta).toLocaleTimeString('es-PE')}` : ' · sin silenciar'),
    routeId);
  scheduleStateBroadcast(routeId, true);
  res.json({ ok: true, umbralM: umbral, mudoHasta });
});

// ─── INFORMES ────────────────────────────────────────────────
// CSV para que la cooperativa se lleve los números a una planilla. Se elige
// CSV y no PDF a propósito: se abre en Excel, se puede sumar y filtrar, y no
// necesita ninguna librería en el servidor.
//
// Cada informe empieza con una línea que dice CON QUÉ SE MIDIÓ. Es la parte
// más importante: un informe de brechas sacado de una ruta sin recorrido
// cargado da números que parecen precisos y no lo son, y eso es peor que no
// tener informe.

// Escapa un valor para CSV: comillas dobles y separador punto y coma, que es
// lo que espera el Excel en español (con coma parte mal los decimales).
function csvValor(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLinea(campos) {
  return campos.map(csvValor).join(';');
}

function fechaHora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function duracionHm(sec) {
  if (sec === null || sec === undefined) return '';
  // Se redondea a minutos PRIMERO y después se parte en horas: al revés,
  // 4 h 59 min 59 s salía como "4:60".
  const min = Math.round(sec / 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// Rango pedido, con tope de 90 días para que un informe no se lleve la base
function rangoDe(req) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let desde = Number(req.query?.desde);
  let hasta = Number(req.query?.hasta);
  if (!Number.isFinite(desde)) desde = hoy.getTime();
  if (!Number.isFinite(hasta)) hasta = Date.now();
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  const TOPE = 90 * 86400_000;
  if (hasta - desde > TOPE) desde = hasta - TOPE;
  return { desde, hasta };
}

// Todo informe se limita a las rutas de la empresa que lo pide. Va como
// subconsulta y no como join para no multiplicar filas. Las tablas de datos
// (vueltas, turnos, mensajes) no guardan la empresa: la heredan de su ruta,
// que es la única fuente de verdad de a quién pertenece cada cosa.
const RUTAS_DE_LA_EMPRESA = '(SELECT routeId FROM routes WHERE companyId = @empresa)';

const INFORMES = {
  // Vueltas por unidad: cuántas, cuánto tardaron, a qué velocidad
  vueltas: (filtro) => {
    const filas = db.prepare(`
      SELECT unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec
      FROM laps
      WHERE finishedAt BETWEEN @desde AND @hasta
        AND routeId IN ${RUTAS_DE_LA_EMPRESA}
        AND (@ruta IS NULL OR routeId = @ruta)
      ORDER BY finishedAt
    `).all(filtro);
    return {
      nombre: 'vueltas',
      // El objetivo va AL LADO de la brecha: sin él, la columna "Brecha
      // promedio" es un número sin vara. Y tiene que ser el de esa vuelta y no
      // el de hoy, porque el que abre el CSV el mes que viene no tiene forma
      // de saber cuál regía ese martes.
      cabecera: ['Unidad', 'Ruta', 'Inicio', 'Fin', 'Duración (h:mm)', 'Minutos',
        'Velocidad media (km/h)', 'Brecha promedio (m:ss)', 'Objetivo de esa vuelta (m:ss)'],
      filas: filas.map(l => [
        l.unitId, l.routeId, fechaHora(l.startedAt), fechaHora(l.finishedAt),
        duracionHm(l.durationSec), Math.round(l.durationSec / 60), l.avgSpeed,
        // Vacío en las vueltas anteriores a que esto existiera, y en las que
        // no tuvieron con quién compararse. Vacío es más honesto que un cero.
        l.brechaProm === null ? '' : formatMinutes(l.brechaProm / 60),
        l.objetivoSec ? formatMinutes(l.objetivoSec / 60) : '',
      ]),
    };
  },

  // Horas por persona, salidas de los turnos
  horas: (filtro) => {
    const filas = db.prepare(`
      SELECT s.personId, s.vehicleId, s.routeId, s.role, s.startedAt, s.endedAt, s.lastSeenAt,
             u.name, u.alias
      FROM shifts s
      LEFT JOIN users u ON u.unitId = s.personId
      WHERE s.startedAt BETWEEN @desde AND @hasta
        AND s.routeId IN ${RUTAS_DE_LA_EMPRESA}
        AND (@ruta IS NULL OR s.routeId = @ruta)
      ORDER BY s.startedAt
    `).all(filtro);
    const ahora = Date.now();
    return {
      nombre: 'horas',
      cabecera: ['Persona', 'Nombre', 'Alias', 'Rol', 'Unidad', 'Ruta', 'Entrada', 'Salida', 'Horas (h:mm)', 'Abierto'],
      filas: filas.map(t => [
        t.personId, t.name, t.alias,
        t.role === 'collector' ? 'cobrador' : 'chofer',
        t.vehicleId, t.routeId,
        fechaHora(t.startedAt), fechaHora(t.endedAt),
        duracionHm(Math.round(((t.endedAt || ahora) - t.startedAt) / 1000)),
        t.endedAt ? 'no' : 'sí',
      ]),
    };
  },

  // Emergencias
  sos: (filtro) => {
    const filas = db.prepare(`
      SELECT unitId, driverName, vehicleId, routeId, lat, lng, sosTipo, timestamp
      FROM messages
      WHERE kind = 'sos' AND timestamp BETWEEN @desde AND @hasta
        AND routeId IN ${RUTAS_DE_LA_EMPRESA}
        AND (@ruta IS NULL OR routeId = @ruta)
      ORDER BY timestamp
    `).all(filtro);
    return {
      nombre: 'sos',
      // El tipo lo eligió el chofer DESPUÉS de disparar; sin elegir queda
      // "SOS" a secas. Con la columna, el informe deja de ser una lista
      // plana: tres fallas mecánicas y un accidente son conversaciones
      // distintas en la reunión.
      cabecera: ['Cuándo', 'Quién', 'Usuario', 'Unidad', 'Ruta', 'Tipo', 'Latitud', 'Longitud'],
      filas: filas.map(m => [
        fechaHora(m.timestamp), m.driverName, m.unitId, m.vehicleId, m.routeId,
        SOS_TIPOS[m.sosTipo] || 'SOS',
        m.lat ?? '', m.lng ?? '',
      ]),
    };
  },

  // Salidas del recorrido. Una fila por episodio, no por posición: lo que se
  // quiere contestar es "cuántas veces y por cuánto tiempo", no "dónde estuvo
  // cada tres segundos".
  desvios: (filtro) => {
    const filas = db.prepare(`
      SELECT vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre
      FROM deviations
      WHERE startedAt BETWEEN @desde AND @hasta
        AND routeId IN ${RUTAS_DE_LA_EMPRESA}
        AND (@ruta IS NULL OR routeId = @ruta)
      ORDER BY startedAt
    `).all(filtro);
    // Cada columna dice contra qué se midió: el umbral es por ruta y se puede
    // cambiar, así que "estuvo a 340 m" no significa lo mismo en dos rutas.
    const COMO_TERMINO = {
      regreso: 'volvió al recorrido',
      corte: 'dejó de reportar',
      trazado: 'le cambiaron el trazado',
    };
    return {
      nombre: 'desvios',
      cabecera: ['Unidad', 'Ruta', 'Salió', 'Volvió', 'Duración (h:mm)', 'Minutos',
        'Máxima distancia (m)', 'Umbral de la ruta (m)', 'Cómo terminó', 'Estaba silenciado'],
      filas: filas.map(d => [
        d.vehicleId, d.routeId, fechaHora(d.startedAt),
        d.endedAt ? fechaHora(d.endedAt) : '',
        d.durationSec === null ? '' : duracionHm(d.durationSec),
        d.durationSec === null ? '' : Math.round(d.durationSec / 60),
        d.maxM, d.umbralM,
        COMO_TERMINO[d.cierre] || (d.endedAt ? d.cierre : 'sigue fuera'),
        d.silenciado ? 'sí' : 'no',
      ]),
    };
  },

  // Quién hizo qué en la administración. La auditoría sí guarda la empresa:
  // hay movimientos que no cuelgan de ninguna ruta, como un login.
  actividad: (filtro) => {
    const filas = db.prepare(`
      SELECT actor, action, target, detail, routeId, timestamp
      FROM audit
      WHERE timestamp BETWEEN @desde AND @hasta
        AND companyId = @empresa
        AND (@ruta IS NULL OR routeId = @ruta)
      ORDER BY timestamp
    `).all(filtro);
    return {
      nombre: 'actividad',
      cabecera: ['Cuándo', 'Quién', 'Qué hizo', 'Sobre', 'Detalle', 'Ruta'],
      filas: filas.map(e => [
        fechaHora(e.timestamp), e.actor, e.action, e.target, e.detail, e.routeId,
      ]),
    };
  },
};

// Un informe es el mismo archivo lo pida Despacho o lo pida el gerente: los
// dos miran la misma cooperativa con el mismo borde de ruta, y lo único que
// cambia es quién firma el "Generado por". Escrito dos veces, los dos lados
// se habrían separado con el tiempo — y son justamente los que no pueden.
function servirInforme(req, res, { tipo, empresa, scope, quien }) {
  const armar = INFORMES[tipo];
  if (!armar) return res.status(404).json({ error: 'Ese informe no existe' });

  const rango = rangoDe(req);
  const pedida = idLimpio(req.query?.routeId);
  // Pedir una ruta ajena no devuelve un informe vacío: devuelve que no existe
  if (pedida && !rutaDeEmpresa(pedida, empresa)) {
    return res.status(404).json({ error: 'Esa ruta no existe' });
  }
  const rutaDelInforme = scope || pedida || null;
  const informe = armar({ ...rango, empresa, ruta: rutaDelInforme });

  // La primera línea dice con qué se midió: sin esto, alguien puede tomar por
  // exacto un número que es una estimación.
  const geo = rutaDelInforme ? geometriaDe(rutaDelInforme) : null;
  const base = !rutaDelInforme
    ? 'varias rutas: la precisión depende de cada una'
    : geo
      ? `ruta ${rutaDelInforme} con recorrido cargado (${(geo.largoTotalM / 1000).toFixed(2)} km${geo.vuelta ? ', ida y vuelta' : ', solo ida'})`
      : `ruta ${rutaDelInforme} SIN recorrido cargado: las vueltas y brechas son estimaciones, no medidas`;

  // El informe sale con el nombre de SU cooperativa, no con el de la R-14:
  // es un papel que se lleva a una reunión y tiene que decir de quién es.
  const emp = companyOf(empresa);
  const lineas = [
    csvLinea([emp ? emp.name : empresa, `Informe de ${informe.nombre}`]),
    csvLinea(['Período', `${fechaHora(rango.desde)} a ${fechaHora(rango.hasta)}`]),
    csvLinea(['Medido sobre', base]),
    csvLinea(['Generado', fechaHora(Date.now()), 'por', quien]),
    '',
    csvLinea(informe.cabecera),
    ...informe.filas.map(csvLinea),
  ];

  const archivo = `${empresa.toLowerCase()}-${informe.nombre}-${new Date(rango.desde).toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  // BOM para que Excel abra bien las tildes
  res.send('\ufeff' + lineas.join('\r\n'));
}

app.get('/admin/informe/:tipo.csv', requireDispatch, (req, res) => {
  servirInforme(req, res, {
    tipo: String(req.params.tipo),
    empresa: req.empresa,
    scope: req.scope,
    quien: req.dispatchUser.unitId,
  });
});

// Turnos: quién anduvo en qué unidad y cuánto. Por defecto los de hoy.
app.get('/admin/shifts', requireDispatch, (req, res) => {
  const desde = Number(req.query?.desde);
  const inicio = Number.isFinite(desde) ? desde : (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  })();

  const filas = db.prepare(`
    SELECT s.id, s.personId, s.vehicleId, s.routeId, s.role,
           s.startedAt, s.endedAt, s.lastSeenAt,
           u.name, u.alias
    FROM shifts s
    LEFT JOIN users u ON u.unitId = s.personId
    WHERE s.startedAt >= @inicio
      AND s.routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@scope IS NULL OR s.routeId = @scope)
    ORDER BY s.startedAt DESC
    LIMIT 500
  `).all({ inicio, empresa: req.empresa, scope: req.scope });

  const ahora = Date.now();
  const turnos = filas.map(t => ({
    ...t,
    abierto: t.endedAt === null,
    // Lo que lleva arriba: si sigue conectado, hasta ahora
    duracionSec: Math.max(0, Math.round(((t.endedAt || ahora) - t.startedAt) / 1000)),
  }));

  // Total por persona, que es el número que le interesa a la cooperativa
  const porPersona = {};
  for (const t of turnos) {
    const k = t.personId;
    if (!porPersona[k]) {
      porPersona[k] = {
        personId: k, name: t.name, alias: t.alias, role: t.role,
        turnos: 0, totalSec: 0, vehiculos: new Set(),
      };
    }
    porPersona[k].turnos++;
    porPersona[k].totalSec += t.duracionSec;
    porPersona[k].vehiculos.add(t.vehicleId);
  }

  res.json({
    desde: inicio,
    turnos,
    personas: Object.values(porPersona)
      .map(p => ({ ...p, vehiculos: Array.from(p.vehiculos) }))
      .sort((a, b) => b.totalSec - a.totalSec),
  });
});

// Las vueltas cerradas, una por una, con la brecha que mantuvo cada una.
// Es lo que mide si la rueda funciona: cuántas vueltas dio cada unidad ya se
// sabía, pero no si las dio bien.
app.get('/admin/vueltas', requireDispatch, (req, res) => {
  const pedida = idLimpio(req.query?.routeId);
  if (pedida && !rutaDeEmpresa(pedida, req.empresa)) {
    return res.status(404).json({ error: 'Esa ruta no existe' });
  }
  const ruta = req.scope || pedida || null;
  const desde = Number(req.query?.desde);
  const inicio = Number.isFinite(desde) ? desde : (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  })();

  // `objetivoSec` viaja por vuelta: el de la ruta viene aparte en la respuesta
  // pero es el de AHORA, y con objetivo automático puede haber cambiado dentro
  // del mismo día — la lista es de las últimas 24 h, más que suficiente para
  // que se mueva. Cada fila se pinta contra la vara con la que se corrió.
  const filas = db.prepare(`
    SELECT id, unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec
    FROM laps
    WHERE finishedAt >= @inicio
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
    ORDER BY finishedAt DESC LIMIT 300
  `).all({ inicio, empresa: req.empresa, ruta });

  // Los promedios se sacan solo de las vueltas que TIENEN el dato: mezclar
  // las viejas (sin brecha guardada) como si fueran cero daría un número
  // bonito y falso.
  const conBrecha = filas.filter(l => l.brechaProm !== null);
  const promedio = (lista, campo) => lista.length
    ? Math.round(lista.reduce((a, l) => a + l[campo], 0) / lista.length)
    : null;

  // La vuelta de ayer, para poder comparar contra hoy
  const finAyer = inicio;
  const inicioAyer = inicio - 86400_000;
  const ayer = db.prepare(`
    SELECT durationSec FROM laps
    WHERE finishedAt >= @inicioAyer AND finishedAt < @finAyer
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
  `).all({ inicioAyer, finAyer, empresa: req.empresa, ruta });

  const objetivo = ruta ? objetivoDe(ruta) : null;
  // "Pelotón" es lo que el sistema existe para evitar: dos unidades pegadas.
  // Se cuenta contra la MITAD del objetivo, no contra un minuto fijo: en una
  // ruta con objetivo de 8 minutos, 1 minuto de brecha es un pelotón; en una
  // de 2 minutos, no.
  const umbralPeloton = objetivo ? (objetivo.min * 60) / 2 : null;

  res.json({
    desde: inicio,
    routeId: ruta,
    objetivoSec: objetivo ? Math.round(objetivo.min * 60) : null,
    vueltas: filas,
    resumen: {
      cerradas: filas.length,
      unidades: new Set(filas.map(l => l.unitId)).size,
      duracionProm: promedio(filas, 'durationSec'),
      duracionPromAyer: promedio(ayer, 'durationSec'),
      brechaProm: promedio(conBrecha, 'brechaProm'),
      // Cuántas de las que tienen dato se hicieron pegadas a la de adelante
      enPeloton: umbralPeloton === null ? null
        : conBrecha.filter(l => l.brechaProm < umbralPeloton).length,
      umbralPelotonSec: umbralPeloton === null ? null : Math.round(umbralPeloton),
      // Cuántas todavía no tienen el dato: si son muchas, los promedios de
      // arriba se calcularon sobre pocas y hay que decirlo.
      sinBrecha: filas.length - conBrecha.length,
    },
  });
});

// Métricas de vueltas por unidad: hoy, última, promedio, mejor, velocidad
app.get('/admin/metrics', requireDispatch, (req, res) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  // El supervisor puede pedir una ruta de SU empresa con ?routeId=; sin eso
  // ve todas las suyas.
  const pedida = String(req.query?.routeId || '').trim();
  if (pedida && !rutaDeEmpresa(pedida, req.empresa)) {
    return res.status(404).json({ error: 'Esa ruta no existe' });
  }
  const filtro = req.scope || pedida || null;
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
    WHERE routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@filtro IS NULL OR routeId = @filtro)
    GROUP BY unitId
    ORDER BY lapsToday DESC, lapsTotal DESC
  `).all({ dayStart: dayStart.getTime(), empresa: req.empresa, filtro });
  res.json({ metrics: rows, routeId: filtro });
});

// ─── GERENCIA (solo lectura) ─────────────────────────────────
// Despacho OPERA el día; el gerente MIRA. Son dos oficios distintos y por eso
// son dos paneles distintos: acá no hay altas, ni bajas, ni chat, ni mapa
// operativo. Solo números de un período, y los informes para llevarlos a una
// reunión.
//
// Todo lo que sigue es GET. No hay un solo endpoint que escriba: es la
// propiedad que hace que darle una cuenta a alguien de la cooperativa no
// tenga consecuencias sobre la operación.

function requireManager(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = sessionUser(token);
  // Misma distinción que en Despacho: 401 es "no hay sesión" y saca al
  // usuario al login; 403 es "esta sesión no alcanza" y no lo echa.
  if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  if (user.role !== 'manager') {
    return res.status(403).json({ error: 'Requiere una cuenta de gerencia' });
  }
  if (!user.companyId || !companyOf(user.companyId)) {
    return res.status(403).json({ error: 'Esta cuenta no está asignada a ninguna empresa' });
  }
  req.gerente = user;
  req.empresa = user.companyId;
  // Mismo borde de dos capas que Despacho: la empresa nunca se cruza, y
  // adentro un gerente de ruta ve solo la suya.
  req.scope = user.routeId || null;
  next();
}

// Una vuelta "cumple" si su brecha quedó dentro del 15 % del objetivo — la
// misma tolerancia que pinta de verde el panel de Despacho, para que los dos
// paneles no digan cosas distintas del mismo día.
//
// Cada vuelta se juzga contra el objetivo que REGÍA cuando se cerró
// (`laps.objetivoSec`). Antes se juzgaba contra el de hoy, que con objetivo
// automático puede ser otro: el número depende de cuántas unidades hay en
// ruta, así que un lunes con 12 combis y un jueves con 6 no tienen la misma
// vara. Las vueltas anteriores a que esto existiera no lo tienen guardado y no
// hay forma de reconstruirlo; ésas caen al objetivo de hoy y se CUENTAN
// aparte, para que la pantalla pueda decirlo en vez de mezclarlas callada.
const TOLERANCIA_CUMPLE = 0.15;

app.get('/gerencia/resumen', requireManager, (req, res) => {
  const rango = rangoDe(req);
  const pedida = idLimpio(req.query?.routeId);
  if (pedida && !rutaDeEmpresa(pedida, req.empresa)) {
    return res.status(404).json({ error: 'Esa ruta no existe' });
  }
  const ruta = req.scope || pedida || null;
  const filtro = { ...rango, empresa: req.empresa, ruta };

  // Las rutas que el gerente puede mirar, con su objetivo. El objetivo es por
  // ruta: un gerente de empresa mira varias a la vez y cada vuelta se juzga
  // contra el objetivo de SU ruta, no contra un promedio de objetivos.
  const rutas = routesOfCompany(req.empresa)
    .filter(r => !ruta || r.routeId === ruta)
    .map(r => {
      const o = objetivoDe(r.routeId);
      return {
        routeId: r.routeId, name: r.name,
        objetivoSec: Math.round(o.min * 60), objetivoModo: o.modo,
        durationMin: r.durationMin,
      };
    });
  const objetivoDeRuta = new Map(rutas.map(r => [r.routeId, r.objetivoSec]));

  const vueltas = db.prepare(`
    SELECT unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec
    FROM laps
    WHERE finishedAt BETWEEN @desde AND @hasta
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
    ORDER BY finishedAt
  `).all(filtro);

  // Contra qué se juzga cada vuelta: el objetivo que regía cuando se cerró y,
  // solo si esa vuelta es anterior a que lo guardáramos, el de hoy.
  const varaDe = (l) => l.objetivoSec || objetivoDeRuta.get(l.routeId) || null;

  // Cumple / no cumple, vuelta por vuelta. `null` cuando no hay con qué
  // juzgarla: sin brecha guardada, o sin objetivo para su ruta.
  const juzgar = (l) => {
    const obj = varaDe(l);
    if (l.brechaProm === null || !obj) return null;
    return Math.abs(l.brechaProm - obj) / obj <= TOLERANCIA_CUMPLE;
  };
  const prom = (lista, campo) => lista.length
    ? Math.round(lista.reduce((a, x) => a + x[campo], 0) / lista.length) : null;
  const porcentaje = (juzgadas) => {
    const con = juzgadas.filter(v => v !== null);
    return con.length ? Math.round((con.filter(Boolean).length / con.length) * 100) : null;
  };

  const conBrecha = vueltas.filter(l => l.brechaProm !== null);

  // Tendencia: un punto por día del rango que tenga vueltas. Sin rellenar los
  // días vacíos con ceros — un feriado sin servicio no es un día de cero
  // cumplimiento, es un día sin datos, y la diferencia importa.
  const dias = new Map();
  for (const l of vueltas) {
    const d = new Date(l.finishedAt);
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!dias.has(clave)) dias.set(clave, []);
    dias.get(clave).push(l);
  }
  const porDia = Array.from(dias.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([dia, ls]) => ({
      dia,
      vueltas: ls.length,
      unidades: new Set(ls.map(l => l.unitId)).size,
      duracionProm: prom(ls, 'durationSec'),
      brechaProm: prom(ls.filter(l => l.brechaProm !== null), 'brechaProm'),
      cumplimiento: porcentaje(ls.map(juzgar)),
    }));

  // Horas por unidad, de los turnos. Van acá y no en una consulta aparte
  // porque la comparación entre unidades no se lee sin ellas: veinte vueltas
  // en cuatro horas y veinte en diez no son lo mismo.
  const turnos = db.prepare(`
    SELECT vehicleId, startedAt, endedAt, lastSeenAt FROM shifts
    WHERE startedAt BETWEEN @desde AND @hasta
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
  `).all(filtro);
  const ahora = Date.now();
  const horasDe = new Map();
  for (const t of turnos) {
    const sec = Math.max(0, Math.round(((t.endedAt || t.lastSeenAt || ahora) - t.startedAt) / 1000));
    horasDe.set(t.vehicleId, (horasDe.get(t.vehicleId) || 0) + sec);
  }

  // Salidas del recorrido del período. Es lo que le faltaba a este cuadro:
  // hasta ahora el desvío se veía en vivo y se perdía, así que el gerente
  // podía saber cuántas vueltas dio cada unidad pero no cuántas veces se
  // salió. Un desvío aislado es una obra; el mismo desvío todos los días es
  // otra cosa, y sin el histórico las dos se ven igual.
  const desviosPeriodo = db.prepare(`
    SELECT vehicleId, routeId, startedAt, endedAt, durationSec, maxM, silenciado, cierre
    FROM deviations
    WHERE startedAt BETWEEN @desde AND @hasta
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
    ORDER BY startedAt DESC
  `).all(filtro);
  const desviosDe = new Map();
  for (const d of desviosPeriodo) {
    if (!desviosDe.has(d.vehicleId)) desviosDe.set(d.vehicleId, { veces: 0, segundos: 0, maxM: 0 });
    const x = desviosDe.get(d.vehicleId);
    x.veces++;
    // Los cortados (dejó de reportar) cuentan como salida pero su duración no
    // se sabe: sumarla como cero es más honesto que inventar hasta cuándo.
    x.segundos += d.durationSec || 0;
    x.maxM = Math.max(x.maxM, d.maxM);
  }

  const unidades = new Map();
  for (const l of vueltas) {
    if (!unidades.has(l.unitId)) unidades.set(l.unitId, []);
    unidades.get(l.unitId).push(l);
  }
  const porUnidad = Array.from(unidades.entries()).map(([unitId, ls]) => {
    const conB = ls.filter(l => l.brechaProm !== null);
    return {
      unitId,
      routeId: ls[0].routeId,
      vueltas: ls.length,
      duracionProm: prom(ls, 'durationSec'),
      duracionMejor: Math.min(...ls.map(l => l.durationSec)),
      velocidadProm: prom(ls, 'avgSpeed'),
      brechaProm: prom(conB, 'brechaProm'),
      cumplimiento: porcentaje(ls.map(juzgar)),
      sinBrecha: ls.length - conB.length,
      horasSec: horasDe.get(unitId) || 0,
      desvios: (desviosDe.get(unitId) || { veces: 0 }).veces,
      desvioSec: (desviosDe.get(unitId) || { segundos: 0 }).segundos,
    };
  }).sort((a, b) => b.vueltas - a.vueltas);

  // Horas por persona: lo mismo que ve Despacho en TURNOS, agregado al rango
  const personas = db.prepare(`
    SELECT s.personId, s.role, s.vehicleId, s.startedAt, s.endedAt, s.lastSeenAt,
           u.name, u.alias
    FROM shifts s
    LEFT JOIN users u ON u.unitId = s.personId
    WHERE s.startedAt BETWEEN @desde AND @hasta
      AND s.routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR s.routeId = @ruta)
  `).all(filtro);
  const porPersona = new Map();
  for (const t of personas) {
    if (!porPersona.has(t.personId)) {
      porPersona.set(t.personId, {
        personId: t.personId, name: t.name, alias: t.alias, role: t.role,
        turnos: 0, horasSec: 0, unidades: new Set(),
      });
    }
    const p = porPersona.get(t.personId);
    p.turnos++;
    p.horasSec += Math.max(0, Math.round(((t.endedAt || t.lastSeenAt || ahora) - t.startedAt) / 1000));
    if (t.vehicleId) p.unidades.add(t.vehicleId);
  }


  // Emergencias del período. Se cuentan y se listan: en una reunión "hubo tres
  // SOS" abre una conversación que "hubo SOS" no abre.
  const sos = db.prepare(`
    SELECT unitId, driverName, vehicleId, routeId, sosTipo, timestamp FROM messages
    WHERE kind = 'sos' AND timestamp BETWEEN @desde AND @hasta
      AND routeId IN ${RUTAS_DE_LA_EMPRESA}
      AND (@ruta IS NULL OR routeId = @ruta)
    ORDER BY timestamp DESC LIMIT 50
  `).all(filtro);

  const empresa = companyOf(req.empresa);
  res.json({
    empresa: { companyId: req.empresa, name: empresa ? empresa.name : req.empresa },
    // El alcance se declara: un gerente de ruta tiene que saber que lo que ve
    // es su ruta y no la cooperativa entera.
    alcance: { routeId: ruta, fijo: !!req.scope },
    rango: { ...rango, dias: Math.max(1, Math.round((rango.hasta - rango.desde) / 86400_000)) },
    rutas,
    totales: {
      vueltas: vueltas.length,
      unidades: unidades.size,
      personas: porPersona.size,
      duracionProm: prom(vueltas, 'durationSec'),
      brechaProm: prom(conBrecha, 'brechaProm'),
      cumplimiento: porcentaje(vueltas.map(juzgar)),
      sinBrecha: vueltas.length - conBrecha.length,
      horasSec: Array.from(horasDe.values()).reduce((a, x) => a + x, 0),
      sos: sos.length,
      // Cuántas de las vueltas juzgadas se midieron contra el objetivo de SU
      // momento y cuántas contra el de hoy porque son anteriores a que se
      // guardara. Mientras `conObjetivoViejo` no sea cero el número de
      // cumplimiento tiene una parte medida con la vara equivocada, y la
      // pantalla tiene que poder decirlo. Con el tiempo llega solo a cero.
      conObjetivoPropio: vueltas.filter(l => l.brechaProm !== null && l.objetivoSec).length,
      conObjetivoViejo: vueltas.filter(l => l.brechaProm !== null && !l.objetivoSec).length,
      desvios: desviosPeriodo.length,
      desvioSec: desviosPeriodo.reduce((a, d) => a + (d.durationSec || 0), 0),
    },
    porDia,
    porUnidad,
    porPersona: Array.from(porPersona.values())
      .map(p => ({ ...p, unidades: Array.from(p.unidades) }))
      .sort((a, b) => b.horasSec - a.horasSec),
    sos,
    // Los últimos, con nombre y apellido: el número suelto dice que hubo
    // catorce salidas, y la lista dice cuáles y de quién.
    desvios: desviosPeriodo.slice(0, 50),
    toleranciaCumple: TOLERANCIA_CUMPLE,
  });
});

// El mismo archivo que baja Despacho, firmado por quien lo pidió
app.get('/gerencia/informe/:tipo.csv', requireManager, (req, res) => {
  servirInforme(req, res, {
    tipo: String(req.params.tipo),
    empresa: req.empresa,
    scope: req.scope,
    quien: req.gerente.unitId,
  });
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

// ─── PANEL DEL CREADOR ───────────────────────────────────────
// El nivel de arriba de todas las cooperativas. Vive en `creador.js`, en su
// propio archivo, para que toda su superficie se pueda leer de una sentada.
//
// Se monta ANTES de los estáticos a propósito: así ninguna ruta suya puede
// quedar tapada por un archivo de project/ que se llame igual.
//
// Si CREATOR_PASSWORD no está en el entorno, esto devuelve null y las rutas
// del creador NO SE REGISTRAN: no dan 401 ni 403, no existen. El panel
// apagado es indistinguible de un servidor que nunca lo tuvo.
montarPanelDelCreador(app, {
  db,
  audit,
  origenDe,
  dbFile: db.memory ? null : db.name,
  routeOf,
  // Renombrar una variante cambia lo que viaja en el mensaje de geometría
  recargarGeometria: (routeId) => { geometrias.delete(routeId); cargarGeometria(routeId); },
  // El trazador del creador guarda por la MISMA función que el de Despacho:
  // validación, transacción, recarga y broadcast, una sola vez escritos.
  guardarRecorrido,
  puntosDeVariante,
  // Crea la variante base si la ruta no tiene ninguna: sin esto, una ruta
  // recién dada de alta no tendría sobre qué dibujar.
  varianteActiva,
  estadoVivo: () => ({ unidades: units.size, conexiones: clients.size }),
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

// Leaflet lo sirve ESTE servidor, no un CDN. Ya pasó en producción con el
// panel del creador: unpkg no entregó leaflet.js y elegir una ruta dejaba la
// página en blanco, sin un solo error visible — el mapa se inicializaba con
// `L` sin existir. El panel del creador se resolvió sirviéndose el suyo; esto
// es lo mismo para Despacho y para la app web del chofer, que seguían
// colgadas del CDN. Son 160 kB de la MISMA copia (server/vendor/leaflet/):
// una sola versión de Leaflet en el repositorio.
//
// Se sirve fuera del `if (PROJECT_DIR)` a propósito: si algún día el HTML se
// publica en un hosting estático aparte, esta URL sigue existiendo acá y las
// páginas la encuentran igual (tienen, además, una caída al CDN por las
// dudas). Se cachea un día: es código público de Leaflet, no datos de nadie.
// ─── TILES DEL MAPA ──────────────────────────────────────────
// La clave de Geoapify (el proveedor del fondo del mapa) vive ACÁ, en una
// variable de entorno, y las pantallas la reciben en el momento: /config.js
// para las web, la respuesta del login para la app nativa. Nunca va escrita
// en el código ni al repositorio — rotarla es cambiar la variable en Railway
// y redesplegar, sin tocar una línea.
//
// Por qué se fue CARTO: su CDN de tiles es solo para clientes enterprise y
// proyectos sin fines de lucro. Una cooperativa que cobra pasaje es uso
// comercial: estábamos fuera de licencia, y un corte llegaría sin aviso y a
// las 2000 unidades a la vez.
const TILES_KEY = String(process.env.GEOAPIFY_API_KEY || '').trim();
if (!TILES_KEY) {
  console.warn('GEOAPIFY_API_KEY no está configurada — el fondo del mapa va a salir gris.');
  console.warn('La clave se crea gratis en https://myprojects.geoapify.com y se pone como variable de entorno.');
}

// ─── MAPA PROPIO (PMTiles raster por zona) ───────────────────
// Los archivos .pmtiles del área de operación (Juliaca hoy; cada ciudad
// nueva es un archivo más). Los genera herramientas/mapa-propio/extraer.js
// y viven donde diga TILES_DIR — en Railway, dentro del volumen, al lado de
// la base. Se sirven con soporte de Range (el cliente pide pedazos, no el
// archivo entero) y caché agresiva: el archivo es INMUTABLE — actualizar el
// mapa es subir un archivo nuevo, no pisar este.
// Dónde viven: TILES_DIR manda; si no, junto a la base (en Railway eso es
// el volumen: DB_FILE=/data/r14.db → /data/tiles); en desarrollo, la salida
// del extractor si existe. La carpeta se crea: la descarga de abajo escribe.
const TILES_DIR = (() => {
  if (process.env.TILES_DIR) return process.env.TILES_DIR;
  const salidaDev = path.join(__dirname, '..', 'herramientas', 'mapa-propio', 'salida');
  if (fs.existsSync(path.join(salidaDev, 'zonas.json'))) return salidaDev;
  return path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, 'r14.db')), 'tiles');
})();
try { fs.mkdirSync(TILES_DIR, { recursive: true }); } catch {}
console.log('Mapa propio:', TILES_DIR);

// ── Descarga al arrancar (los .pmtiles NO viajan en el repositorio) ──
// Pesan cientos de MB: viven como assets de un Release de GitHub y cada
// servidor se los baja UNA vez a su volumen. TILES_RELEASE_URL apunta a la
// carpeta de descargas del release, p. ej.:
//   https://github.com/Eltiokarma/Prototipo-Celular-Rastreo-01/releases/download/mapa-2026-08
// Mientras bajan (o si la variable falta), /tiles/zonas.json anuncia solo
// lo que ya está en disco y las pantallas siguen con el proveedor: el mapa
// nunca queda en blanco por esto.
async function bajarMapaPropio() {
  const base = String(process.env.TILES_RELEASE_URL || '').replace(/\/+$/, '');
  if (!base) { console.log('TILES_RELEASE_URL sin configurar — mapa propio solo si ya está en disco.'); return; }
  const aDisco = async (nombre, validar, guardarComo) => {
    const destino = path.join(TILES_DIR, guardarComo || nombre);
    const res = await fetch(base + '/' + nombre, { redirect: 'follow' });
    if (!res.ok) throw new Error(nombre + ': HTTP ' + res.status);
    const cuerpo = Buffer.from(await res.arrayBuffer());
    if (validar && !validar(cuerpo)) throw new Error(nombre + ': contenido inválido');
    // A un temporal y recién entonces al nombre real: un corte a mitad de
    // descarga no puede dejar un archivo trunco con nombre bueno.
    fs.writeFileSync(destino + '.tmp', cuerpo);
    fs.renameSync(destino + '.tmp', destino);
    return cuerpo;
  };
  for (let intento = 1; intento <= 5; intento++) {
    try {
      const zonas = JSON.parse((await aDisco('zonas.json', b => b[0] === 0x7b, 'zonas.json.nuevo')).toString());
      let bajados = 0;
      for (const z of Object.values(zonas)) {
        for (const archivo of Object.values(z.archivos || {})) {
          if (fs.existsSync(path.join(TILES_DIR, archivo))) continue;
          console.log('bajando', archivo, '…');
          await aDisco(archivo, b => b.slice(0, 7).toString('latin1') === 'PMTiles');
          lectorPmtiles.cerrar(path.join(TILES_DIR, archivo));
          bajados++;
        }
      }
      // El índice se publica al final: nunca anuncia archivos que no están
      fs.renameSync(path.join(TILES_DIR, 'zonas.json.nuevo'), path.join(TILES_DIR, 'zonas.json'));
      console.log(bajados ? `Mapa propio: ${bajados} archivo(s) bajados del release.` : 'Mapa propio: al día.');
      return;
    } catch (e) {
      console.warn(`Mapa propio: descarga falló (${e.message}) — reintento ${intento}/5`);
      await new Promise(r => setTimeout(r, 15000 * intento));
    }
  }
  console.warn('Mapa propio: no se pudo bajar; las pantallas siguen con el proveedor.');
}

// CORS: la app nativa vive en un WebView con otro origen, y un pedido con
// Range dispara preflight. Sin esto, el mapa propio solo serviría a la web.
function corsDeTiles(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'range,if-match,if-none-match');
  res.setHeader('Access-Control-Expose-Headers', 'content-range,accept-ranges,content-length,etag');
}
app.options('/tiles/:archivo', (req, res) => { corsDeTiles(res); res.sendStatus(204); });

// El índice: qué zonas hay y con qué bbox. La cascada del cliente decide
// con esto si una tile sale de acá o del proveedor. Solo anuncia zonas
// cuyos archivos están DE VERDAD en el disco: prometer una zona a medio
// bajar sería un mapa entero de 404 en cadena.
function zonasDisponibles() {
  const idx = path.join(TILES_DIR, 'zonas.json');
  if (!fs.existsSync(idx)) return {};
  let zonas;
  try { zonas = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch { return {}; }
  for (const [id, z] of Object.entries(zonas)) {
    const ok = Object.values(z.archivos || {}).every(a => fs.existsSync(path.join(TILES_DIR, a)));
    if (!ok) delete zonas[id];
  }
  return zonas;
}
app.get('/tiles/zonas.json', (req, res) => {
  corsDeTiles(res);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(zonasDisponibles());
});

app.get('/tiles/:archivo', (req, res) => {
  // Solo nombres sanos y solo .pmtiles: esta ruta no es un file server
  const archivo = String(req.params.archivo || '');
  if (!/^[a-z0-9-]+\.pmtiles$/.test(archivo) || !TILES_DIR) return res.sendStatus(404);
  corsDeTiles(res);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // sendFile maneja Range y ETag solo; con esto el navegador pide los
  // pedacitos que necesita y no vuelve a pedir los que ya tiene.
  res.sendFile(path.join(TILES_DIR, archivo), (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

// La tile suelta: /tiles/xyz/juliaca/claro/15/10000/17812.png → un PNG de
// unos 3-8 KB. Es lo que piden las pantallas con un L.tileLayer común — el
// celular NUNCA baja el archivo grande, solo las tiles que mira, y el
// service worker las guarda como cualquier otra. El lector (server/
// pmtiles.js) tiene el índice en memoria; encontrar una tile no toca la red.
//
// 404 cuando la tile no está (fuera del bbox, zoom fuera de rango, archivo
// todavía no descargado): la cascada del cliente lo toma como "probá con el
// proveedor". Caché de 30 días, no un año: el mapa se re-extrae cada tanto
// (OSM cambia despacio) y las tiles conservan su URL.
const lectorPmtiles = require('./pmtiles');
app.get('/tiles/xyz/:zona/:estilo/:z/:x/:y.png', (req, res) => {
  corsDeTiles(res);
  if (!TILES_DIR) return res.sendStatus(404);
  const { zona, estilo } = req.params;
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  if (!/^[a-z0-9-]+$/.test(zona) || !/^(claro|oscuro)$/.test(estilo) ||
      !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
      z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return res.sendStatus(404);
  }
  const ruta = path.join(TILES_DIR, `${zona}-${estilo}.pmtiles`);
  if (!fs.existsSync(ruta)) return res.sendStatus(404);
  try {
    const png = lectorPmtiles.abrir(ruta).tile(z, x, y);
    if (!png) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.type('image/png').send(png);
  } catch (e) {
    console.error('tile rota', zona, estilo, z, x, y, e.message);
    res.sendStatus(500);
  }
});

const VENDOR_LEAFLET = path.join(__dirname, 'vendor', 'leaflet');
for (const [archivo, tipo] of [['leaflet.js', 'application/javascript'], ['leaflet.css', 'text/css']]) {
  app.get('/vendor/leaflet/' + archivo, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type(tipo).sendFile(path.join(VENDOR_LEAFLET, archivo));
  });
}

// Cuando la app se sirve desde acá, habla con este mismo origen.
// En hosting estático separado este archivo da 404 y la app cae al
// default de realtime.js — nada se rompe.
//
// Registrado FUERA del `if (PROJECT_DIR)`, como Leaflet: el panel del
// creador también lo carga (necesita la clave de las tiles) y existe aunque
// el deploy no incluya la carpeta project/.
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(
    "// Generado por el servidor: el tiempo real vive en este mismo origen\n" +
    "window.REALTIME_SERVER_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;\n" +
    "// La clave de las tiles del mapa (variable de entorno GEOAPIFY_API_KEY)\n" +
    `window.TILES_KEY = ${JSON.stringify(TILES_KEY)};\n` +
    "// Zonas con mapa PROPIO: adentro de estos bbox las tiles salen de este\n" +
    "// servidor y el proveedor queda de excepción. Vacío = todo al proveedor.\n" +
    `window.TILES_ZONAS = ${JSON.stringify(zonasDisponibles())};\n`
  );
});

if (PROJECT_DIR) {
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
//
// Con compresión negociada (permessage-deflate). El estado que cada ruta
// emite cada 3 s es la cuenta más grande del sistema entero —el 88 % del
// costo a 2000 unidades es egress, y de eso el 90 % es ESTE mensaje
// (`COSTOS.md` §4)— y es JSON repetitivo: 17 campos con los mismos nombres
// por cada unidad. Deflate con contexto entre mensajes lo achica ~10×,
// porque cada estado se parece muchísimo al anterior. Del otro lado del
// mismo caño está el chofer: sus ~89 MB de datos móviles por turno bajan a
// una fracción sin tocar una línea de los clientes.
//
// La negociación la hace cada cliente solo: los navegadores la ofrecen
// siempre (paneles y app web), y el WebSocket de la app nativa (OkHttp) no
// la ofrece — esa conexión sigue sin comprimir, exactamente como hasta hoy.
// Por eso no hay caso "cliente viejo": quien no ofrece, no comprime.
//
// Los números de la configuración son memoria por conexión, y a 2000
// conexiones eso multiplica: la ventana de 2^12 = 4 KB por dirección (los
// 32 KB por defecto serían ~64 MB solo de ventanas) alcanza de sobra porque
// lo que se repite —los nombres de campo y el estado anterior— cabe en
// mucho menos. `level: 1` porque el JSON repetitivo se comprime casi igual
// en nivel 1 que en 6, a una fracción del CPU (667 envíos/s en punta salen
// del mismo hilo que todo lo demás). `threshold: 512` deja pasar sin
// comprimir lo que no paga el viaje (un chat pesa 202 B).
// El contexto entre mensajes —que `ws` conserva por defecto salvo que el
// cliente pida lo contrario— es de donde sale casi todo el ahorro: cada
// estado se comprime contra el anterior. Eso mantiene un par de streams
// zlib vivos por conexión (~50-100 KB): a 2000 conexiones son ~100-200 MB,
// contemplados en los 2 GB presupuestados para ese escenario.
const wss = new WebSocketServer({
  server,
  perMessageDeflate: {
    threshold: 512,
    serverMaxWindowBits: 12,
    zlibDeflateOptions: { level: 1, memLevel: 6 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    concurrencyLimit: 10,
  },
});

// Tope de mensajes por conexión. Una sesión válida podía mandar miles de
// mensajes por segundo: cada chat se guarda en la base y se reparte a toda
// la ruta, y una nota de voz pesa hasta 1,5 MB — un solo cliente descompuesto
// (o malicioso) le quemaba los datos a todos. El GPS tiene su propio ritmo,
// más alto, porque llega cada 3 s por diseño.
const CUPO = {
  gps:   { max: 40, ventanaMs: 60_000 },   // llega cada 3 s: 20/min es lo normal
  chat:  { max: 30, ventanaMs: 60_000 },
  voice: { max: 10, ventanaMs: 60_000 },
  photo: { max: 6,  ventanaMs: 60_000 },   // pesa más que un audio, y se manda menos
  sos:   { max: 6,  ventanaMs: 60_000 },
  otro:  { max: 60, ventanaMs: 60_000 },
};
const cupos = new WeakMap();

function dentroDelCupo(ws, tipo) {
  const regla = CUPO[tipo] || CUPO.otro;
  let porTipo = cupos.get(ws);
  if (!porTipo) { porTipo = {}; cupos.set(ws, porTipo); }
  const ahora = Date.now();
  const e = porTipo[tipo];
  if (!e || ahora - e.desde > regla.ventanaMs) {
    porTipo[tipo] = { n: 1, desde: ahora, avisado: false };
    return true;
  }
  e.n++;
  if (e.n > regla.max) {
    if (!e.avisado) {
      e.avisado = true;
      console.warn(`Cupo excedido (${tipo}) por ${clients.get(ws) || 'sin identificar'}`);
    }
    return false;
  }
  return true;
}

wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');

  // Cuando llega un mensaje de una combi
  ws.on('message', (raw) => {
    // Un mensaje descomunal ni se intenta parsear
    if (raw.length > 2_100_000) return;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignorar mensajes que no sean JSON válido
    }

    if (!dentroDelCupo(ws, msg.type)) return;

    // TIPO: identificación — el cliente presenta su token de sesión.
    // Sin token válido no hay estado, ni historial, ni chat.
    if (msg.type === 'identify') {
      const user = sessionUser(msg.token);
      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Sesión inválida o expirada' }));
        ws.close();
        return;
      }
      // El gerente entra al tiempo real IGUAL que Despacho: desde la fusión
      // de los dos paneles usa la misma pantalla, con más permisos. Antes se
      // lo rechazaba acá y se lo mandaba a gerencia.html; ese panel ya no
      // existe como puerta aparte.
      clients.set(ws, user.unitId);
      const vehicleId = user.vehicleId || (user.role === 'driver' ? user.unitId : null);
      profiles.set(user.unitId, {
        driverName: displayName(user),
        name: user.name || user.driverName || user.unitId,
        alias: user.alias || null,
        role: user.role || 'driver',
        routeId: user.routeId || null,
        companyId: user.companyId || null,
        vehicleId,
      });

      // Un chofer mira su ruta; un despachador de ruta, la que administra;
      // un supervisor (dispatch sin ruta) arranca en la primera DE SU EMPRESA
      // y cambia con el mensaje 'watch'. Antes arrancaba en la primera del
      // servidor, que con varias cooperativas es la de otro.
      const rutas = routesOfCompany(user.companyId);
      const rutaInicial = user.routeId || (rutas[0] ? rutas[0].routeId : null);
      if (!rutaInicial) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Tu cooperativa todavía no tiene ninguna ruta cargada' }));
        ws.close();
        return;
      }
      watching.set(ws, rutaInicial);

      // Despacho y gerencia observan y hablan, pero NO van en un vehículo:
      // no entran al mapa ni al cálculo de brechas.
      if (user.role !== 'dispatch' && user.role !== 'manager' && vehicleId) {
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
            // ¿De verdad es OTRO chofer, o es la misma persona que volvió
            // —una reconexión por corte de señal, otra pestaña—? El cartel
            // de relevo asusta, y salía en cada reconexión propia: al
            // socket viejo de la misma persona se le dice la verdad.
            const mismaPersona = clients.get(anterior) === user.unitId;
            try {
              anterior.send(JSON.stringify({
                type: 'gps_role', reporting: false,
                reason: mismaPersona
                  ? 'Tu sesión siguió en otro dispositivo o pestaña; esta dejó de reportar el GPS.'
                  : 'Otro chofer tomó la unidad. Seguís viendo todo, pero tu GPS ya no se usa.',
              }));
            } catch {}
            // El relevo real queda en el log: es la pista para el mapa
            // vacío con chat vivo — el GPS del relegado se descarta mudo.
            if (!mismaPersona) {
              console.log(`GPS de ${vehicleId}: lo toma ${user.unitId}, relevó a ${clients.get(anterior) || '¿?'}`);
            }
          }
          gpsOwner.set(vehicleId, ws);
          ws.send(JSON.stringify({ type: 'gps_role', reporting: true }));
        } else {
          // Acompañante: ve todo, no aporta posición
          ws.send(JSON.stringify({ type: 'gps_role', reporting: false, reason: 'Modo acompañante' }));
        }

        // Queda registrado que esta persona subió a esta unidad
        abrirTurno(user.unitId, vehicleId, user.routeId || veh?.routeId || rutaInicial, user.role);

        if (!yaEstaba) {
          broadcastToRoute(rutaInicial, { type: 'unit_joined', unitId: vehicleId });
          scheduleStateBroadcast(rutaInicial, true); // se ve al instante
        }
      }
      const quien = `${displayName(user)}${vehicleId ? ' en ' + vehicleId : ''}`;
      console.log(`${user.role === 'dispatch' ? 'Despacho conectado' : user.role === 'manager' ? 'Gerencia conectada' : `${user.role === 'collector' ? 'Cobrador' : 'Chofer'} identificado`}: ${quien} (${rutaInicial})`);

      // Recién ahora recibe el estado y la conversación en curso
      ws.send(JSON.stringify({ type: 'state', ...buildState(rutaInicial) }));
      // Qué conversación privada le corresponde ver: Despacho todas las de
      // su ruta, una combi la suya, nadie la de otro.
      const privados = (user.role === 'dispatch' || user.role === 'manager') ? '*' : (vehicleId || null);
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
      // Y solo entre las rutas de su propia cooperativa: sin este chequeo,
      // un supervisor podía pedir el código de una ruta ajena y quedarse
      // mirando el mapa y el chat de otra empresa.
      const prof = profiles.get(clients.get(ws));
      if (!rutaDeEmpresa(msg.routeId, prof?.companyId)) return;
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

      anotarPosicion(vehicleId, personId, prof, {
        lat: msg.lat, lng: msg.lng, speed: msg.speed,
        routeProgress: msg.routeProgress,
      });
    }

    // TIPO: presencia — el chofer declara su estado desde la app.
    // 'ruta' no lo mete a la cadena: eso lo hace el GPS al pisar el trazado.
    if (msg.type === 'presencia') {
      const personId = clients.get(ws);
      const prof = personId ? profiles.get(personId) : null;
      const vehicleId = prof?.vehicleId;
      const estado = ['ruta', 'ausente', 'fuera'].includes(msg.estado) ? msg.estado : null;
      // SOLO el chofer, la misma regla que el GPS. Si valiera la palabra del
      // cobrador, cerrar SU app mandaría 'fuera' y borraría del mapa una
      // combi que sigue manejando otro — descartándole la vuelta en curso.
      if (vehicleId && estado && prof.role === 'driver') {
        fijarPresencia(vehicleId, prof.routeId || DEFAULT_ROUTE, estado);
      }
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
      // El id viaja en la alerta: es el ancla para que el tipo elegido
      // después (sos_tipo) encuentre este disparo y no otro.
      const sosId = remember({ kind: 'sos', ...alert });
      audit(unitId, 'sos', null, alert.lat ? `${alert.lat.toFixed(4)}, ${alert.lng.toFixed(4)}` : null, routeId);
      broadcastToRoute(routeId, { type: 'sos_alert', sosId, ...alert });
      broadcastToSupervisors({ type: 'sos_alert', sosId, ...alert }, routeId);
    }

    // TIPO: sos_tipo — el chofer le pone nombre a la emergencia YA ENVIADA.
    // Deslizar sigue siendo lo primero y lo único obligatorio: la alerta ya
    // salió, ya sonó en Despacho, ya quedó guardada. Esto la califica
    // ("falla mecánica", "accidente", "policía") para que quien moviliza
    // sepa si busca una grúa, una ambulancia o hace otra llamada. Sin
    // elegir, queda como SOS genérico — que es mejor que un menú antes de
    // pedir ayuda.
    if (msg.type === 'sos_tipo') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      if (!SOS_TIPOS[msg.tipo]) return;        // tipo inventado: se ignora
      const fila = db.prepare(
        "SELECT id, unitId, routeId, vehicleId, timestamp FROM messages WHERE id = ? AND kind = 'sos'")
        .get(Number(msg.sosId) || -1);
      if (!fila) return;
      // Solo quien disparó puede calificar SU emergencia. Sin este borde,
      // cualquiera de la ruta podía reescribir la emergencia de otro.
      if (fila.unitId !== unitId) return;
      // Y solo mientras la emergencia está viva. Después es editar historia.
      if (Date.now() - fila.timestamp > SOS_TIPO_VENTANA_MS) return;
      db.prepare('UPDATE messages SET sosTipo = ? WHERE id = ?').run(msg.tipo, fila.id);
      console.log(`🚨 SOS de ${unitId}: ${SOS_TIPOS[msg.tipo]}`);
      const aviso = { type: 'sos_tipo', sosId: fila.id, unitId,
                      vehicleId: fila.vehicleId, routeId: fila.routeId, tipo: msg.tipo };
      broadcastToRoute(fila.routeId, aviso);
      broadcastToSupervisors(aviso, fila.routeId);
    }

    // TIPO: chat — mensaje de texto entre choferes de la MISMA ruta
    // Limitamos a 500 caracteres para evitar abuso.
    if (msg.type === 'chat') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const prof = profiles.get(unitId) || {};
      const routeId = rutaDelEmisor();

      const destino = destinoPrivado(prof, msg);
      if (!destino) return;
      const { toVehicleId } = destino;

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
    // Llega como data-URL base64 (webm/opus desde la web, m4a/aac desde
    // Android). Tope ~1,5 MB de audio (unos 60s) para que el broadcast no se
    // vuelva pesado.
    if (msg.type === 'voice') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const data = medioValido(msg.data, 'data:audio', MAX_AUDIO);
      if (!data) return; // audio inválido o demasiado grande — se descarta
      const prof = profiles.get(unitId) || {};
      const routeId = rutaDelEmisor();

      const destino = destinoPrivado(prof, msg);
      if (!destino) return;
      const { toVehicleId } = destino;

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

    // TIPO: foto — una imagen sacada desde el celular
    //
    // Misma cañería que la voz, con dos diferencias que importan:
    //
    //   - El tope es MÁS CHICO que el del audio, no más grande. Una foto de
    //     celular sale de 3 a 8 MB, y mandarla entera le quema los datos a
    //     toda la ruta: el que la manda paga una vez, los que la reciben
    //     pagan cada uno. El cliente la achica antes de mandarla; este tope
    //     es la red por si algún cliente no lo hace.
    //   - No hay `duration`. Lo que se guarda es el pie de foto, si lo tiene.
    if (msg.type === 'photo') {
      const unitId = clients.get(ws);
      if (!unitId) return;
      const data = medioValido(msg.data, 'data:image', MAX_IMAGEN);
      if (!data) return;
      const prof = profiles.get(unitId) || {};
      const routeId = rutaDelEmisor();

      const destino = destinoPrivado(prof, msg);
      if (!destino) return;
      const { toVehicleId } = destino;

      const entry = {
        unitId,
        driverName: prof.driverName || 'Conductor',
        vehicleId: prof.vehicleId || null,
        toVehicleId,
        routeId,
        text: String(msg.text || '').slice(0, 200),   // pie de foto, opcional
        data,
        timestamp: msg.timestamp || Date.now(),
      };
      remember({ kind: 'photo', ...entry });
      const payload = { type: 'photo_msg', role: prof.role || 'driver', ...entry };
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

    // Se cierra el turno. Si vuelve en los próximos minutos —un túnel, una
    // zona sin señal— se retoma este mismo en vez de abrir otro.
    cerrarTurno(personId);

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

    // Cuando se va la ÚLTIMA persona del vehículo, la unidad NO se borra: se
    // marca sin señal, igual que si hubiera dejado de mandar GPS con el
    // socket abierto. Los dos casos son el mismo hecho —dejamos de saber
    // dónde está— y este es además el más común de los dos: con la pantalla
    // apagada el celular duerme la radio y la conexión se cae, no se queda
    // abierta y muda.
    //
    // Borrar acá era lo que dejaba sin efecto todo el mecanismo: la de atrás
    // pasaba a medirse contra la que sigue y recibía "apurá" hacia una combi
    // que tenía justo adelante.
    //
    // El precio es que un chofer que termina el turno queda tres minutos en
    // gris. Es el precio correcto: desde el servidor, terminar el turno y
    // entrar a un túnel son indistinguibles, y equivocarse hacia "no sé
    // dónde está" es mucho más barato que equivocarse hacia "no existe".
    if (otrosDelVehiculo.length === 0 && units.has(vehicleId)) {
      const u = units.get(vehicleId);
      if (!u.sinSenal) units.set(vehicleId, { ...u, sinSenal: true, sinSenalDesde: u.timestamp });
      scheduleStateBroadcast(routeId, true);
    }
  });

  // El estado y el historial se mandan recién después de un identify
  // válido — una conexión sin autenticar no recibe nada.
});

// Topes de lo que viaja incrustado en el mensaje, en caracteres del data-URL
// (el base64 infla ~4/3, así que el archivo real es como un 75 % de esto).
//
// La imagen tiene MENOS lugar que el audio, y no es un descuido: una foto de
// celular sale de 3 a 8 MB, y en un canal donde el que manda paga una vez y
// los que reciben pagan cada uno, lo caro es el reparto. El cliente la achica
// antes; esto es la red por si algún cliente no lo hace.
const MAX_AUDIO = 2_000_000;
const MAX_IMAGEN = 1_200_000;

const medioValido = (data, prefijo, tope) =>
  (typeof data === 'string' && data.startsWith(prefijo) && data.length <= tope) ? data : null;

// A quién va este mensaje, si es que va a alguien en particular.
//
// La regla: Despacho elige a qué unidad le escribe; una unidad solo puede
// escribirle a Despacho, y eso es su propia conversación. A propósito NO
// existe chofer ↔ chofer en privado — el canal entre choferes es el grupo, y
// abrir mensajería privada entre cientos de personas trae un problema de
// moderación que no queremos.
//
// Está acá afuera porque la usan el texto, la voz y la foto. Eran tres copias
// de la MISMA regla de seguridad, y tres copias es una que se queda atrás:
// alcanza con que un tipo nuevo se olvide de validar el destino para que un
// privado termine en el grupo. Las suites `privado` y `seguridad` la cubren.
//
// Devuelve null cuando hay que descartar el mensaje, o `{ toVehicleId }` con
// null adentro si es para el grupo.
function destinoPrivado(prof, msg) {
  if (prof.role === 'dispatch' || prof.role === 'manager') {
    const destino = idLimpio(msg.to);
    if (!destino) return { toVehicleId: null };
    if (!units.has(destino) && !vehicleOf(destino)) return null;  // unidad inexistente
    return { toVehicleId: destino };
  }
  if (msg.to || msg.privado) {
    const propio = prof.vehicleId || null;
    if (!propio) return null;
    return { toVehicleId: propio };
  }
  return { toVehicleId: null };
}

// Reparto de un mensaje privado: los que van ARRIBA de ese vehículo (chofer y
// cobrador) y Despacho mirando esa ruta. Nadie más — ni los otros choferes.
function enviarPrivado(routeId, toVehicleId, payload) {
  const crudo = JSON.stringify(payload);
  for (const [ws, personId] of clients) {
    if (ws.readyState !== 1) continue;
    const prof = profiles.get(personId);
    if (!prof) continue;
    const esDeEsaCombi = prof.vehicleId === toVehicleId;
    const esDespachoDeLaRuta = (prof.role === 'dispatch' || prof.role === 'manager') && watching.get(ws) === routeId;
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
  const dibujar = (t) => (t ? t.puntos.map(p => [p.lat, p.lng]) : []);
  return JSON.stringify({
    type: 'route_geometry',
    routeId,
    tramos: { ida: dibujar(geo && geo.ida), vuelta: dibujar(geo && geo.vuelta) },
    largoM: geo ? Math.round(geo.largoTotalM) : 0,
    // Con qué trazado se está midiendo. Cuando hay un desvío programado, el
    // chofer tiene que poder ver que la línea del mapa cambió a propósito y
    // no pensar que el sistema se equivocó.
    variante: geo ? geo.varianteNombre : null,
  });
}

// ─── CONSTRUIR ESTADO ────────────────────────────────────────
// Toma todas las posiciones y calcula quién va adelante/atrás de quién.
// routeProgress es un número 0-1 que indica qué tan avanzado está en la ruta.
// 0 = terminal sur, 1 = Huancané.

// ─── OBJETIVO DE BRECHA AUTOMÁTICO ───────────────────────────
// La matemática de la rueda: si la vuelta dura 60 minutos y hay 12 unidades
// repartidas, la separación natural entre una y otra es 60/12 = 5 minutos.
// El sistema ya tiene los dos datos (historial de vueltas y unidades en
// ruta), así que puede calcular el objetivo en vez de que se cargue a mano.
//
// Tres cuidados, que son lo que hace la diferencia entre útil y molesto:
//  1. ARRANQUE EN FRÍO: sin vueltas suficientes NO se inventa nada, se usa
//     el valor manual de la ruta.
//  2. QUE NO PARPADEE: el objetivo tiñe los colores del HUD del chofer. Se
//     recalcula como máximo cada minuto y solo se mueve si el cambio es
//     apreciable.
//  3. TOPES: por más raro que venga el historial, el objetivo queda dentro
//     de un rango con sentido para una combi urbana.
const MIN_VUELTAS = 3;          // menos que esto no es un promedio, es una anécdota
const VUELTAS_MUESTRA = 30;     // se miran las últimas, no toda la historia
const RECALCULO_MS = 60_000;    // cada cuánto se recalcula, como mucho
const CAMBIO_MINIMO = 0.1;      // 6 segundos: menos que esto no se mueve
const OBJETIVO_MIN = 0.5;       // 30 s
const OBJETIVO_MAX = 30;        // 30 min

// { routeId → { min, modo, vueltas, unidades, dia, calculadoEn } }
const objetivoCache = new Map();

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Promedio de vuelta en segundos. Primero se busca el del MISMO día de la
// semana (el tráfico de un domingo no es el de un lunes); si ese día todavía
// no juntó vueltas suficientes, se cae al promedio general.
function promedioVuelta(routeId, diaSemana) {
  // Solo las vueltas medidas con el trazado que está midiendo AHORA. Si la
  // ruta cambió de variante, las de la anterior no sirven: una variante más
  // larga tarda más, y mezclarlas da un objetivo que no le sirve a ninguna.
  // Cuando la ruta no tiene geometría, se usan las vueltas sin variante, que
  // son las que se midieron con la estimación del cliente — también entre sí.
  const geo = geometriaDe(routeId);
  const variante = geo ? geo.variantId : null;
  const mismaVariante = variante === null ? 'variantId IS NULL' : 'variantId = @variante';

  const delDia = db.prepare(`
    SELECT durationSec FROM laps
    WHERE routeId = @routeId AND ${mismaVariante}
      AND CAST(strftime('%w', finishedAt / 1000, 'unixepoch', 'localtime') AS INTEGER) = @dia
    ORDER BY id DESC LIMIT ${VUELTAS_MUESTRA}
  `).all({ routeId, dia: diaSemana, variante });

  if (delDia.length >= MIN_VUELTAS) {
    return { sec: delDia.reduce((a, l) => a + l.durationSec, 0) / delDia.length,
             vueltas: delDia.length, porDia: true };
  }

  const todas = db.prepare(`
    SELECT durationSec FROM laps WHERE routeId = @routeId AND ${mismaVariante}
    ORDER BY id DESC LIMIT ${VUELTAS_MUESTRA}
  `).all({ routeId, variante });

  if (todas.length >= MIN_VUELTAS) {
    return { sec: todas.reduce((a, l) => a + l.durationSec, 0) / todas.length,
             vueltas: todas.length, porDia: false };
  }
  return null;
}

// El objetivo vigente de una ruta y de dónde salió, para poder mostrarlo.
function objetivoDe(routeId) {
  const ruta = routeOf(routeId);
  const manual = ruta ? ruta.targetGapMin : 2;
  if (!ruta || !ruta.autoTarget) {
    return { min: manual, modo: 'manual', motivo: null, vueltas: 0, unidades: 0, dia: null };
  }

  const previo = objetivoCache.get(routeId);
  if (previo && Date.now() - previo.calculadoEn < RECALCULO_MS) return previo;

  // Las que perdieron señal NO cuentan acá, aunque sigan dibujadas en el
  // mapa. El objetivo es la vuelta dividida por las unidades: contar una de
  // más lo ACHICA, y un objetivo más chico le dice a todos que se peguen más
  // — justo la dirección peligrosa. Si además esa unidad terminó el turno y
  // se fue a su casa, estaríamos apretando a los que quedan por un fantasma.
  // Sin contarla el objetivo queda algo más grande de lo ideal mientras dura
  // el corte, que es el error barato. Vuelve a contar apenas reaparece.
  const unidades = Array.from(units.values())
    .filter(u => u.routeId === routeId && u.lat !== null && !u.sinSenal &&
                 u.enRuta !== false && u.presencia !== 'ausente').length;
  const diaSemana = new Date().getDay();
  const prom = promedioVuelta(routeId, diaSemana);

  let resultado;
  if (!prom || unidades < 1) {
    // Arranque en frío: el manual manda, y se dice QUÉ falta — no es lo mismo
    // no tener historial que no tener ninguna combi en ruta ahora mismo.
    resultado = {
      min: manual, modo: 'esperando',
      motivo: !prom ? 'vueltas' : 'unidades',
      vueltas: prom ? prom.vueltas : 0,
      unidades, dia: null,
    };
  } else {
    const crudo = (prom.sec / 60) / unidades;
    let min = Math.max(OBJETIVO_MIN, Math.min(OBJETIVO_MAX, crudo));
    min = Math.round(min * 10) / 10;
    // Suavizado: si el valor nuevo casi no cambia, se queda el de antes para
    // que los colores del HUD no bailen
    if (previo && previo.modo === 'auto' && Math.abs(previo.min - min) < CAMBIO_MINIMO) {
      min = previo.min;
    }
    resultado = {
      min, modo: 'auto', motivo: null, vueltas: prom.vueltas, unidades,
      dia: prom.porDia ? DIAS[diaSemana] : null,
    };
  }
  resultado.calculadoEn = Date.now();
  objetivoCache.set(routeId, resultado);
  return resultado;
}

// El estado es SIEMPRE de una ruta: las unidades de otras rutas no
// aparecen ni entran en el cálculo de brechas. Sin esto, un chofer vería
// "su" brecha contra una combi de otro recorrido.
// Suma una muestra de brecha a la vuelta que la unidad está haciendo ahora.
// Si no hay vuelta abierta (recién conectada) no hay dónde acumular, y se
// descarta: la vuelta a medias no se guarda igual.
function anotarBrecha(vehicleId, minutosAdelante) {
  const st = lapState.get(vehicleId);
  if (!st) return;
  st.brechaSum += minutosAdelante * 60;
  st.brechaCount++;
}

// `acumular` distingue la emisión con cadencia —que es la que representa el
// paso del tiempo— de las que se arman para contestarle a alguien que se
// acaba de conectar.
function buildState(routeId, acumular) {
  const ruta = routeOf(routeId);
  const all = Array.from(units.values())
    .filter(u => u.routeId === routeId && u.lat !== null) // solo su ruta, con GPS
    .sort((a, b) => b.routeProgress - a.routeProgress);    // ordenadas por avance

  // La CADENA de brechas es solo de las confirmadas en ruta. Las que van
  // yendo (declararon y todavía no pisaron el trazado) y las ausentes se
  // dibujan igual —Despacho tiene que verlas— pero no ocupan lugar en la
  // fila: el que pasa cerca de la casa de Ignacio no se mide contra él.
  // Es distinto de sinSenal, que SÍ ocupa su lugar: esa combi está en la
  // calle trabajando y solo se calló; estas dos nunca entraron o se bajaron.
  const enCadena = all.filter(u => u.enRuta !== false && u.presencia !== 'ausente');

  const objetivo = objetivoDe(routeId);
  const ruta2 = routeOf(routeId);
  return {
    routeId,
    // Gestión del desvío: umbral vigente y hasta cuándo está silenciado
    desvio: {
      umbralM: ruta2 ? (ruta2.desvioMaxM || DESVIO_DEFECTO_M) : DESVIO_DEFECTO_M,
      mudoHasta: ruta2 && ruta2.desvioMudoHasta > Date.now() ? ruta2.desvioMudoHasta : null,
    },
    routeName: ruta ? ruta.name : routeId,
    targetGapMin: objetivo.min,
    // De dónde sale ese número, para que el panel lo pueda explicar
    objetivo: {
      modo: objetivo.modo, motivo: objetivo.motivo || null,
      vueltas: objetivo.vueltas, unidades: objetivo.unidades, dia: objetivo.dia,
      manual: ruta ? ruta.targetGapMin : 2,
    },
    units: all,
    gaps: calculateGaps(enCadena, ruta ? ruta.durationMin : 50, acumular ? anotarBrecha : null),
    // `totalOnRoute` cuenta la cadena: las confirmadas en ruta, incluidas
    // las que perdieron señal (la combi está en la calle igual, y sacarla
    // haría parpadear el "N en ruta" en cada túnel). Las que van yendo y
    // las ausentes van aparte, para que el panel lo diga sin adivinar.
    totalOnRoute: enCadena.length,
    sinSenal: enCadena.filter(u => u.sinSenal).length,
    yendo: all.filter(u => u.presencia === 'ruta' && u.enRuta === false).length,
    ausentes: all.filter(u => u.presencia === 'ausente').length,
    timestamp: Date.now(),
  };
}

// ─── ANOTAR UNA POSICIÓN ─────────────────────────────────────
// Una sola puerta para las posiciones, sin importar por dónde entraron.
// Antes esto vivía adentro del handler del WebSocket, y ahí se descubrió el
// problema: cuando Android manda la app atrás suspende el JavaScript y el
// WebSocket se cae, aunque el servicio de ubicación siga corriendo. La combi
// seguía sabiendo dónde estaba y no tenía por dónde decirlo.
//
// `cuando` es la hora en que se TOMÓ la posición, no la de llegada. Por
// WebSocket son casi lo mismo; por HTTP puede venir un atraso entero después
// de un túnel, y usar la hora de llegada haría que la unidad se
// teletransporte y que las vueltas se midan mal.
function anotarPosicion(vehicleId, personId, prof, pos, cuando = Date.now()) {
  const unit = units.get(vehicleId) || {};
  const routeId = unit.routeId || prof.routeId || DEFAULT_ROUTE;

  // El progreso lo calcula EL SERVIDOR, que es donde vive la geometría: así
  // cargar o corregir el recorrido tiene efecto al instante, sin actualizar
  // la app de nadie. Si la ruta todavía no tiene trazado, se usa el que
  // estima el cliente (proyección lineal, como antes).
  // Hacia dónde venía yendo: es lo que desempata entre ida y vuelta cuando
  // las dos pasan por la misma calle en sentidos opuestos.
  const rumboReal = (unit.lat != null && unit.lng != null &&
                     metrosEntre(unit.lat, unit.lng, pos.lat, pos.lng) > 8)
    ? Math.atan2(
        (pos.lng - unit.lng) * METROS_POR_GRADO * Math.cos(unit.lat * Math.PI / 180),
        (pos.lat - unit.lat) * METROS_POR_GRADO
      ) * 180 / Math.PI
    : (unit.rumbo ?? null);

  const proy = proyectarEnRuta(routeId, pos.lat, pos.lng, {
    tramo: unit.tramo || null, rumbo: rumboReal,
  });
  const progreso = proy ? proy.progreso : (pos.routeProgress || 0);

  // ¿Se salió del recorrido? Solo cuenta si se sostiene (ver arriba)
  const desvio = evaluarDesvio(vehicleId, routeId, proy ? proy.desvioM : null);

  // La confirmación de presencia: declaró "en ruta" y esta posición cayó
  // SOBRE el trazado (mismo umbral que el desvío) → entra a la cadena.
  // Una vez adentro se queda: el desvío sostenido ya tiene su propia
  // alarma, y desconfirmar por cada semáforo haría bailar las brechas.
  const decl = presencias.get(vehicleId) || null;
  let enRuta = decl ? decl.enRuta : true;
  if (decl && decl.estado === 'ruta' && !enRuta) {
    const umbral = (routeOf(routeId) || {}).desvioMaxM || DESVIO_DEFECTO_M;
    // Sin geometría cargada no hay contra qué confirmar: vale la palabra.
    if (!proy || proy.desvioM <= umbral) {
      enRuta = true;
      decl.enRuta = true;
      console.log(`Presencia: ${vehicleId} pisó el trazado — entra a la cadena de brechas`);
    }
  }

  units.set(vehicleId, {
    ...unit,
    unitId: vehicleId,
    routeId,
    lat: pos.lat,
    lng: pos.lng,
    speed: pos.speed || 0,
    routeProgress: progreso,
    // En qué tramo del circuito va y cuánto lleva de ese tramo
    tramo: proy ? proy.tramo : null,
    progresoTramo: proy ? proy.progresoTramo : null,
    rumbo: rumboReal,
    // A cuántos metros del trazado va. null si la ruta no tiene geometría.
    desvioM: proy ? Math.round(proy.desvioM) : null,
    // Va por afuera del recorrido, sostenido. Viaja como un booleano dentro
    // del estado que ya se emite: no hace falta mensaje aparte.
    fueraDeRuta: !!(desvio && desvio.fuera),
    fueraDesde: desvio && desvio.fuera ? desvio.desde : null,
    // Volvió la señal. Se limpia explícitamente porque el spread de arriba
    // arrastra el `sinSenal` de la vuelta anterior, y una unidad que
    // reapareció seguiría dibujada en gris para siempre.
    sinSenal: false,
    sinSenalDesde: null,
    // La presencia declarada y si ya está confirmada sobre el trazado.
    // Sin declaración: 'ruta' confirmada, como fue siempre.
    presencia: decl ? decl.estado : 'ruta',
    enRuta,
    timestamp: cuando,
  });

  // Detección de vuelta completa a partir del progreso (del vehículo).
  // SOLO para las confirmadas en ruta: el viaje de la casa a la ruta no es
  // una vuelta, y el almuerzo estacionado cerca del terminal tampoco.
  if (enRuta && (!decl || decl.estado === 'ruta')) {
    trackLap(vehicleId, routeId, progreso, pos.speed || 0, cuando);
  }

  // Y que la persona sigue arriba, para poder cerrar bien el turno si el
  // servidor se reinicia
  marcarVivo(personId);

  // Solo se recalcula y emite el estado de SU ruta
  scheduleStateBroadcast(routeId);
  return routeId;
}

// ─── CALCULAR GAPS ───────────────────────────────────────────
// Dado el orden en la ruta, calcula cuántos minutos separa cada par de
// unidades. La fórmula es una aproximación: diferencia de progreso por la
// duración del recorrido, que cada ruta define por su cuenta.

// `anotar` es opcional y recibe (vehicleId, minutosHastaElDeAdelante). Sirve
// para ir juntando la brecha promedio de la vuelta en curso. Se pasa SOLO en
// la emisión de estado con cadencia, no cada vez que alguien se conecta: si
// no, una ruta con veinte choferes reconectando ensuciaría el promedio.
function calculateGaps(sortedUnits, durationMin, anotar) {
  const gaps = {};
  for (let i = 0; i < sortedUnits.length; i++) {
    const current = sortedUnits[i];
    const ahead = sortedUnits[i - 1]; // la que va adelante (más progreso)
    const behind = sortedUnits[i + 1]; // la que viene atrás (menos progreso)

    // Una unidad sin señal SIGUE OCUPANDO SU LUGAR en la fila, pero su
    // posición es vieja y no se puede medir contra ella. Las dos cosas
    // importan y por eso no alcanza con sacarla del arreglo:
    //   - si se la saca, el de atrás se mide contra la que sigue, ve el
    //     doble de brecha y recibe "apurá" hacia una combi que no ve;
    //   - si se la mide igual, el número es de hace minutos y miente.
    // Queda `aheadUnit` con nombre y `toAhead` en null: hay alguien
    // adelante, no sabemos a cuánto. Es un estado distinto de "no hay nadie",
    // donde las dos cosas van en null.
    const gapToAhead = ahead && !ahead.sinSenal
      ? (ahead.routeProgress - current.routeProgress) * durationMin
      : null;

    // El número crudo se queda en el servidor. Mandarlo en el estado sería
    // ~18 bytes por unidad cada 3 segundos: con 20 unidades, varios MB de
    // datos móviles por turno y por celular para algo que el cliente no usa.
    if (anotar && gapToAhead !== null) anotar(current.unitId, gapToAhead);

    const gapToBehind = behind && !behind.sinSenal
      ? (current.routeProgress - behind.routeProgress) * durationMin
      : null;

    gaps[current.unitId] = {
      toAhead: gapToAhead !== null ? formatMinutes(gapToAhead) : null,
      toBehind: gapToBehind !== null ? formatMinutes(gapToBehind) : null,
      aheadUnit: ahead?.unitId || null,
      behindUnit: behind?.unitId || null,
      // Por qué el tiempo viene vacío teniendo a alguien al lado. Sin esto,
      // la pantalla no puede distinguir "no hay nadie" de "hay alguien y no
      // sabemos dónde", que para el chofer son cosas muy distintas.
      aheadSinSenal: !!(ahead && ahead.sinSenal),
      behindSinSenal: !!(behind && behind.sinSenal),
    };
  }
  return gaps;
}

// Convierte 2.25 minutos → "02:15"
function formatMinutes(mins) {
  // Se redondea a segundos ANTES de partir en minutos y segundos. Al revés
  // —que es como estaba— 2,999 min daba m=2 y s=redondeo(59,94)=60, o sea
  // "02:60": una hora que no existe, en el dígito gigante del chofer. Pasa
  // en el 0,8 % de los valores, que con la brecha actualizándose cada 3 s
  // son varias veces por turno.
  const total = Math.round(mins * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── BROADCAST ───────────────────────────────────────────────
// Qué ruta está mirando cada conexión. Un chofer mira la suya siempre; un
// supervisor puede cambiarla desde el panel (mensaje 'watch').
const watching = new Map();   // websocket → routeId

function esSupervisor(ws) {
  const unitId = clients.get(ws);
  const prof = unitId ? profiles.get(unitId) : null;
  return !!prof && (prof.role === 'dispatch' || prof.role === 'manager') && !prof.routeId;
}

// De qué empresa es la conexión
function empresaDe(ws) {
  const unitId = clients.get(ws);
  const prof = unitId ? profiles.get(unitId) : null;
  return prof ? prof.companyId || null : null;
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
  // Escala dentro de la cooperativa, no más allá: el supervisor de la empresa
  // de al lado no tiene nada que hacer con una emergencia que no es suya, y
  // vería la ubicación exacta de una unidad ajena.
  const empresa = exceptRoute ? (routeOf(exceptRoute)?.companyId || null) : null;
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && esSupervisor(client) &&
        empresaDe(client) === empresa && watching.get(client) !== exceptRoute) {
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
  // Con `true`: esta pasada es la que cuenta para la brecha promedio
  broadcastToRoute(routeId, { type: 'state', ...buildState(routeId, true) });
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

// ─── UNIDADES QUE DEJAN DE REPORTAR ──────────────────────────
// Antes esto era una sola cosa: a los 30 segundos sin GPS, borrar. Se midió
// lo que provocaba y era peor que un fantasma en el mapa. Con la unidad
// borrada, la de atrás pasa a medirse contra la que sigue —el doble de
// lejos—, ve una brecha enorme y la pantalla le dice "apurá" hacia una combi
// que tiene justo adelante y que ya no ve. El sistema producía el pelotón
// que existe para evitar.
//
// Ahora son dos etapas:
//
//   30 s → SIN SEÑAL. Sigue en la fila, con su última posición conocida y
//          marcada como vieja. Nadie recibe una instrucción calculada contra
//          ella, pero tampoco desaparece de la cuenta: el de atrás sigue
//          sabiendo que hay alguien adelante.
//    3 min → OLVIDADA. Recién acá se borra y se descarta la vuelta en curso.
//
// Los dos plazos se pueden mover sin tocar código, porque el número bueno
// sale de la calle: tres minutos aguanta una llamada o un semáforo largo, y
// es poco como para no mostrar una posición ya falsa.
const SIN_SENAL_MS = Number(process.env.SIN_SENAL_MS || 30_000);
const OLVIDAR_MS   = Number(process.env.OLVIDAR_MS   || 180_000);

setInterval(() => {
  const ahora = Date.now();
  const rutasAfectadas = new Set();
  for (const [unitId, unit] of units) {
    const callada = ahora - unit.timestamp;

    if (callada > OLVIDAR_MS) {
      units.delete(unitId);
      lapState.delete(unitId); // la vuelta a medias no cuenta
      // Y el desvío abierto se cierra: de una unidad que dejó de reportar no
      // se puede decir que "siguió fuera de ruta" — no se sabe dónde está.
      olvidarDesvio(unitId, 'corte');
      // Y la CONFIRMACIÓN se pierde con el olvido: si mató la app sin
      // "salir de ruta" y reaparece mañana desde su casa, tiene que volver
      // a pisar el trazado — no entrar a la cadena por un true de ayer.
      const decl = presencias.get(unitId);
      if (decl) decl.enRuta = false;
      console.log(`Unidad olvidada tras ${Math.round(callada / 1000)} s sin señal: ${unitId}`);
      broadcastToRoute(unit.routeId, { type: 'unit_left', unitId });
      rutasAfectadas.add(unit.routeId);
      continue;
    }

    // Entra en "sin señal". Se marca una sola vez: sin este chequeo se
    // reemitiría el estado cada diez segundos durante los tres minutos.
    if (callada > SIN_SENAL_MS && !unit.sinSenal) {
      units.set(unitId, { ...unit, sinSenal: true, sinSenalDesde: unit.timestamp });
      console.log(`Unidad sin señal: ${unitId}`);
      rutasAfectadas.add(unit.routeId);
    }
  }
  // Sin este envío, si todas dejan de reportar el mapa queda congelado
  rutasAfectadas.forEach(r => scheduleStateBroadcast(r, true));
}, 10_000);

// ─── RESPALDO AUTOMÁTICO ─────────────────────────────────────
// Uno cada RESPALDO_CADA_H horas (6 por defecto) en `respaldos/` junto a la
// base, verificado y con rotación. Ver server/respaldo.js — y bajarse uno
// desde el panel del creador de vez en cuando ES el respaldo fuera del
// servidor.
respaldo.programar(db, Database);

// ─── ARRANCAR ────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor COOP-R14 corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  // Si el servidor estuvo apagado el día que empezaba o vencía una obra, la
  // vigencia programada se aplica al encenderlo y no un minuto después.
  revisarVigencias();
  // El mapa propio se baja del release DESPUÉS de estar escuchando: servir
  // ya, completarse en el fondo. Si falla, el proveedor cubre todo.
  bajarMapaPropio().catch(e => console.warn('Mapa propio:', e.message));
});
