#!/usr/bin/env node
// Alta y baja de cooperativas — herramienta de consola.
//
// Es la MISMA capa que usa el panel del creador (ver `cooperativas.js`): las
// dos puertas comparten las operaciones y las validaciones. Lo que cambia es
// la barrera de entrada — acá, tener consola en el servidor.
//
// Sigue existiendo aunque el panel esté hecho, y conviene que exista: es la
// salida cuando el panel no se puede abrir (clave del creador perdida, deploy
// a medias, base a mano). El panel es comodidad; esto es el piso.
//
// Uso:
//   node server/empresa.js listar
//   node server/empresa.js alta COOP-15 "Cooperativa Santa Rosa" \
//        --ruc 20123456789 --contacto "Juan Pérez 951..." \
//        --ruta R-15 --nombre-ruta "Plaza ↔ Salida Cusco" \
//        --despacho DESPACHO-15 --clave unaclavelarga
//   node server/empresa.js despacho COOP-15 DESPACHO-15 otraclavelarga
//   node server/empresa.js gerencia COOP-15 GERENTE-15 otraclavelarga [--ruta R-15]
//   node server/empresa.js desactivar COOP-15
//   node server/empresa.js activar COOP-15
//
// La base es la misma que usa el servidor: se respeta DB_FILE.

const path = require('path');
const { openDatabase } = require('./base');
const coop = require('./cooperativas');

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

// Toda operación devuelve { error } o { ok }: acá el error es una línea roja
function hacer(resultado) {
  if (resultado.error) salir(resultado.error);
  return resultado;
}

// ─── COMANDOS ────────────────────────────────────────────────

function listar() {
  const empresas = coop.listar(db);
  if (!empresas.length) {
    console.log('No hay ninguna empresa cargada.');
    return;
  }
  for (const e of empresas) {
    console.log('');
    console.log(`${e.companyId}  ${e.name}${e.activa ? '' : '   [SUSPENDIDA]'}`);
    if (e.ruc) console.log(`  RUC       ${e.ruc}`);
    if (e.contacto) console.log(`  Contacto  ${e.contacto}`);
    console.log(`  Rutas     ${e.rutas.length
      ? e.rutas.map(r => r.routeId).join(', ')
      : '— ninguna (nadie va a poder conectarse)'}`);
    console.log(`  Flota     ${e.vehiculos} vehículo(s) · ${e.personas} persona(s)`);
    console.log(`  Despacho  ${e.despacho.length
      ? e.despacho.map(d => d.routeId ? `${d.unitId} (ruta ${d.routeId})` : `${d.unitId} (supervisor)`).join(', ')
      : '— ninguna cuenta'}`);
    console.log(`  Gerencia  ${e.gerencia.length
      ? e.gerencia.map(g => g.routeId ? `${g.unitId} (ruta ${g.routeId})` : `${g.unitId} (toda la cooperativa)`).join(', ')
      : '— ninguna cuenta'}`);
  }
  console.log('');
}

function alta() {
  const r = hacer(coop.alta(db, {
    companyId: sueltos[1],
    name: sueltos[2],
    ruc: ops.ruc,
    contacto: ops.contacto,
    ruta: ops.ruta,
    nombreRuta: ops['nombre-ruta'],
    despacho: ops.despacho,
    clave: ops.clave,
  }));
  console.log(`Empresa creada: ${r.companyId} — ${r.name}`);
  if (r.ruta) console.log(`  Ruta inicial: ${r.ruta}`);
  else console.log('  Sin rutas: hasta que tenga una, nadie de esta empresa va a poder conectarse.');
  if (r.usuario) console.log(`  Supervisor:   ${r.usuario}`);
  else console.log('  Sin cuenta de despacho: creala con `empresa.js despacho`.');
}

function despacho() {
  if (!sueltos[1] || !sueltos[2] || !sueltos[3]) {
    salir('Uso: node server/empresa.js despacho <empresa> <usuario> <clave>');
  }
  const r = hacer(coop.supervisor(db, {
    companyId: sueltos[1], usuario: sueltos[2], clave: sueltos[3],
  }));
  console.log(r.creado
    ? `Supervisor creado: ${r.usuario} en ${r.companyId}.`
    : `Clave restablecida para ${r.usuario} (supervisor de ${r.companyId}).`);
}

function gerencia() {
  if (!sueltos[1] || !sueltos[2] || !sueltos[3]) {
    salir('Uso: node server/empresa.js gerencia <empresa> <usuario> <clave> [--ruta CODIGO]');
  }
  const r = hacer(coop.gerente(db, {
    companyId: sueltos[1], usuario: sueltos[2], clave: sueltos[3], routeId: ops.ruta,
  }));
  const alcance = r.routeId ? `ruta ${r.routeId}` : 'toda la cooperativa';
  console.log(r.creado
    ? `Gerente creado: ${r.usuario} en ${r.companyId} (${alcance}).`
    : `Clave restablecida para ${r.usuario} (gerente de ${r.companyId}, ${alcance}).`);
  console.log('  Entra por gerencia.html. No administra nada y no ve el tiempo real.');
}

function ruta() {
  if (!sueltos[1] || !sueltos[2]) {
    salir('Uso: node server/empresa.js ruta <empresa> <codigo> ["nombre"]');
  }
  const r = hacer(coop.altaRuta(db, {
    companyId: sueltos[1], routeId: sueltos[2], name: sueltos[3],
    targetGapMin: ops.brecha, durationMin: ops.duracion,
  }));
  console.log(`Ruta ${r.routeId} creada en ${r.companyId}.`);
}

function estado(activa) {
  const r = hacer(coop.estado(db, { companyId: sueltos[1], activa }));
  console.log(activa
    ? `${r.name} habilitada de nuevo.`
    : `${r.name} suspendida. ${r.sesiones} sesión(es) cerrada(s).`);
}

function ayuda() {
  console.log(`
Cooperativas — alta y administración desde el servidor

  listar
  alta <empresa> "<nombre>" [--ruc N] [--contacto texto]
                            [--ruta CODIGO] [--nombre-ruta "texto"]
                            [--despacho USUARIO --clave CLAVE]
  despacho <empresa> <usuario> <clave>
  gerencia <empresa> <usuario> <clave> [--ruta CODIGO]
  ruta <empresa> <codigo> ["nombre"] [--brecha min] [--duracion min]
  desactivar <empresa>
  activar <empresa>

Base: ${process.env.DB_FILE || path.join(__dirname, 'r14.db')}
`);
}

switch (comando) {
  case 'listar': listar(); break;
  case 'alta': alta(); break;
  case 'despacho': despacho(); break;
  case 'gerencia': gerencia(); break;
  case 'ruta': ruta(); break;
  case 'activar': estado(true); break;
  case 'desactivar': estado(false); break;
  default: ayuda(); if (comando) process.exitCode = 1;
}
