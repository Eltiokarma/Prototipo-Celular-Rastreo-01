#!/usr/bin/env node
// Alta y baja de cooperativas — herramienta de consola.
//
// POR QUÉ NO ES UNA PANTALLA. Dar de alta una empresa es el único poder que
// está por encima de todas las cooperativas: quien puede crear una puede
// crearse una cuenta de supervisor y mirar lo que quiera. Si eso fuera un
// endpoint más, alcanzaría con robar una contraseña de Despacho para tenerlo.
// Acá la barrera no es una contraseña: es el acceso al servidor. Para correr
// esto hay que estar adentro de la máquina donde vive la base.
//
// Cuando exista el panel del creador (ver PENDIENTES.md), va a ser una
// pantalla encima de esto mismo, con su propia credencial y su propia
// barrera fuera de la aplicación. No un rol más del login de siempre.
//
// Uso:
//   node server/empresa.js listar
//   node server/empresa.js alta COOP-15 "Cooperativa Santa Rosa" \
//        --ruc 20123456789 --contacto "Juan Pérez 951..." \
//        --ruta R-15 --nombre-ruta "Plaza ↔ Salida Cusco" \
//        --despacho DESPACHO-15 --clave unaclavelarga
//   node server/empresa.js despacho COOP-15 DESPACHO-15 otraclavelarga
//   node server/empresa.js desactivar COOP-15
//   node server/empresa.js activar COOP-15
//
// La base es la misma que usa el servidor: se respeta DB_FILE.

const path = require('path');
const { openDatabase, hashPassword, idLimpio } = require('./base');

// El mismo mínimo que exige el panel al fijar una contraseña
const CLAVE_MINIMA = 6;

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  salir('No se pudo cargar better-sqlite3. Corré `npm install` dentro de server/ con Node 22.');
}

// Sin memoria: una herramienta que escribe en una base que se evapora es
// peor que una que no arranca.
const db = openDatabase(Database, { silencioso: true, sinMemoria: true });
if (!db) salir('No se pudo abrir la base de datos. Revisá DB_FILE.');

// El esquema lo crea el servidor al arrancar. Duplicarlo acá sería tener dos
// versiones de la verdad y que se separen con el tiempo.
const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
if (!tablas.includes('companies')) {
  salir('Esta base todavía no tiene la tabla de empresas.\n' +
        'Arrancá el servidor una vez (npm start) para que cree el esquema, y volvé a intentar.');
}

// ─── ARGUMENTOS ──────────────────────────────────────────────
// Separa las opciones (--algo valor) de los argumentos sueltos
function parsear(argv) {
  const sueltos = [];
  const ops = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const clave = argv[i].slice(2);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) salir(`Falta el valor de --${clave}`);
      ops[clave] = valor;
      i++;
    } else {
      sueltos.push(argv[i]);
    }
  }
  return { sueltos, ops };
}

const { sueltos, ops } = parsear(process.argv.slice(2));
const comando = sueltos[0];

// ─── COMANDOS ────────────────────────────────────────────────

function listar() {
  const empresas = db.prepare('SELECT * FROM companies ORDER BY createdAt').all();
  if (!empresas.length) {
    console.log('No hay ninguna empresa cargada.');
    return;
  }
  for (const e of empresas) {
    const rutas = db.prepare('SELECT routeId FROM routes WHERE companyId = ? ORDER BY routeId')
      .all(e.companyId).map(r => r.routeId);
    const personas = db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role <> 'dispatch'")
      .get(e.companyId).c;
    const despacho = db.prepare("SELECT unitId, routeId FROM users WHERE companyId = ? AND role = 'dispatch' ORDER BY unitId")
      .all(e.companyId);
    const vehiculos = db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE companyId = ?').get(e.companyId).c;
    console.log('');
    console.log(`${e.companyId}  ${e.name}${e.activa ? '' : '   [SUSPENDIDA]'}`);
    if (e.ruc) console.log(`  RUC       ${e.ruc}`);
    if (e.contacto) console.log(`  Contacto  ${e.contacto}`);
    console.log(`  Rutas     ${rutas.length ? rutas.join(', ') : '— ninguna (nadie va a poder conectarse)'}`);
    console.log(`  Flota     ${vehiculos} vehículo(s) · ${personas} persona(s)`);
    console.log(`  Despacho  ${despacho.length
      ? despacho.map(d => d.routeId ? `${d.unitId} (ruta ${d.routeId})` : `${d.unitId} (supervisor)`).join(', ')
      : '— ninguna cuenta'}`);
  }
  console.log('');
}

function alta() {
  const companyId = idLimpio(sueltos[1]);
  const name = String(sueltos[2] || '').trim().slice(0, 80);
  if (!companyId) salir('Falta el código de la empresa, o tiene caracteres no permitidos.\n' +
                        'Se admiten letras, números, punto, guion y guion bajo (hasta 24).');
  if (!name) salir('Falta el nombre de la cooperativa. Va entre comillas.');
  if (db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(companyId)) {
    salir(`Ya existe una empresa con el código ${companyId}.`);
  }

  const ruta = ops.ruta ? idLimpio(ops.ruta) : null;
  if (ops.ruta && !ruta) salir('El código de la ruta tiene caracteres no permitidos.');
  if (ruta && db.prepare('SELECT routeId FROM routes WHERE routeId = ?').get(ruta)) {
    // Los códigos de ruta son únicos en todo el servidor: si no, una consulta
    // por routeId no sabría de qué cooperativa está hablando.
    salir(`El código de ruta ${ruta} ya está tomado por otra empresa.`);
  }

  const usuario = ops.despacho ? idLimpio(ops.despacho) : null;
  if (ops.despacho && !usuario) salir('El usuario de despacho tiene caracteres no permitidos.');
  const clave = ops.clave || null;
  if (usuario && (!clave || clave.length < CLAVE_MINIMA)) {
    salir(`La cuenta de despacho necesita --clave de al menos ${CLAVE_MINIMA} caracteres.`);
  }
  if (usuario && db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(usuario)) {
    salir(`El usuario ${usuario} ya está tomado.`);
  }

  const ahora = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO companies (companyId, name, ruc, contacto, activa, createdAt) VALUES (?, ?, ?, ?, 1, ?)')
      .run(companyId, name, ops.ruc || null, ops.contacto || null, ahora);

    if (ruta) {
      db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ruta, String(ops['nombre-ruta'] || ruta).slice(0, 60), 2, 50, companyId, ahora);
    }

    if (usuario) {
      // Supervisor de la empresa: sin routeId, ve todas las rutas de SU
      // cooperativa (y solo las de ella).
      db.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                  VALUES (?, ?, ?, 'dispatch', NULL, ?, ?, ?)`)
        .run(usuario, 'Despacho', 'Despacho', companyId, hashPassword(clave), ahora);
    }
  })();

  console.log(`Empresa creada: ${companyId} — ${name}`);
  if (ruta) console.log(`  Ruta inicial: ${ruta}`);
  else console.log('  Sin rutas: hasta que tenga una, nadie de esta empresa va a poder conectarse.');
  if (usuario) console.log(`  Supervisor:   ${usuario}`);
  else console.log('  Sin cuenta de despacho: creala con `empresa.js despacho`.');
}

function despacho() {
  const companyId = idLimpio(sueltos[1]);
  const usuario = idLimpio(sueltos[2]);
  const clave = sueltos[3];
  if (!companyId || !usuario || !clave) {
    salir('Uso: node server/empresa.js despacho <empresa> <usuario> <clave>');
  }
  if (clave.length < CLAVE_MINIMA) salir(`La clave necesita al menos ${CLAVE_MINIMA} caracteres.`);
  if (!db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(companyId)) {
    salir(`No existe la empresa ${companyId}.`);
  }

  const existente = db.prepare('SELECT unitId, companyId FROM users WHERE unitId = ?').get(usuario);
  if (existente && existente.companyId !== companyId) {
    // Mover una cuenta de una cooperativa a otra se le parece demasiado a un
    // error de tipeo. Que se dé de baja y se cree de nuevo, a la vista.
    salir(`El usuario ${usuario} ya existe y pertenece a ${existente.companyId}. Elegí otro código.`);
  }

  if (existente) {
    db.prepare("UPDATE users SET passHash = ?, role = 'dispatch', routeId = NULL WHERE unitId = ?")
      .run(hashPassword(clave), usuario);
    // Las sesiones abiertas con la clave vieja dejan de valer
    db.prepare('DELETE FROM sessions WHERE unitId = ?').run(usuario);
    console.log(`Clave restablecida para ${usuario} (supervisor de ${companyId}).`);
  } else {
    db.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES (?, ?, ?, 'dispatch', NULL, ?, ?, ?)`)
      .run(usuario, 'Despacho', 'Despacho', companyId, hashPassword(clave), Date.now());
    console.log(`Supervisor creado: ${usuario} en ${companyId}.`);
  }
}

function activar(valor) {
  const companyId = idLimpio(sueltos[1]);
  if (!companyId) salir('Falta el código de la empresa.');
  const e = db.prepare('SELECT * FROM companies WHERE companyId = ?').get(companyId);
  if (!e) salir(`No existe la empresa ${companyId}.`);
  db.prepare('UPDATE companies SET activa = ? WHERE companyId = ?').run(valor ? 1 : 0, companyId);
  if (!valor) {
    // Suspender sin cortar las sesiones abiertas dejaría a la cooperativa
    // trabajando hasta que a cada uno se le venza el token: 30 días.
    const n = db.prepare('DELETE FROM sessions WHERE unitId IN (SELECT unitId FROM users WHERE companyId = ?)')
      .run(companyId).changes;
    console.log(`${e.name} suspendida. ${n} sesión(es) cerrada(s).`);
  } else {
    console.log(`${e.name} habilitada de nuevo.`);
  }
}

function ayuda() {
  console.log(`
Cooperativas — alta y administración desde el servidor

  listar
  alta <empresa> "<nombre>" [--ruc N] [--contacto texto]
                            [--ruta CODIGO] [--nombre-ruta "texto"]
                            [--despacho USUARIO --clave CLAVE]
  despacho <empresa> <usuario> <clave>
  desactivar <empresa>
  activar <empresa>

Base: ${process.env.DB_FILE || path.join(__dirname, 'r14.db')}
`);
}

switch (comando) {
  case 'listar': listar(); break;
  case 'alta': alta(); break;
  case 'despacho': despacho(); break;
  case 'activar': activar(true); break;
  case 'desactivar': activar(false); break;
  default: ayuda(); if (comando) process.exitCode = 1;
}
