// El WebSocket de estado: cuánto CPU cuesta armar y emitir, y CÓMO CRECE.
//
//   node herramientas/emision.js            → 500 · 2000 · 5000 y el factor
//   node herramientas/emision.js 5000        → un solo tamaño
//
// POR QUÉ EXISTE. `COSTOS.md` marca la emisión de estado por WebSocket como el
// cuello de botella REAL del sistema, y hasta ahora sólo se midieron sus BYTES
// (egress). Falta el CPU: `buildState` corre en el mismo hilo que atiende los
// `POST /gps`, así que el tiempo que tarda en armar el estado es tiempo que la
// flota no reporta — igual que una consulta lenta.
//
// QUÉ MIDE, Y QUÉ NO. Montar 5000 conexiones reales acá pondría al generador a
// competir por CPU con el servidor: mediría el banco, no el sistema. En vez de
// eso, aísla los dos costos de `buildState` que CRECEN con la flota, copiados
// tal cual del server (`server/index.js:5701` y `:5745`):
//
//   1. el barrido de unidades por ruta — `units` es un Map plano, así que
//      armar el estado de UNA ruta recorre TODAS las unidades. Por ciclo se
//      arma cada ruta → rutas × unidades. Ésa es la forma que puede ser
//      cuadrática, y es lo que este banco existe para confirmar o descartar.
//   2. la cuenta de flota — `db.prepare('SELECT COUNT(*)…').get()` compila y
//      ejecuta SQLite en CADA emisión, sin cachear.
//
// Lo que NO mide —`calculateGaps` y el `JSON.stringify`— es por unidad DE LA
// RUTA (~40), no por unidad de la flota: crece lineal y no mueve la forma. Se
// reporta el stringify de una ruta aparte, para mostrar que no es el driver.
//
// Cada costo se mide en su forma actual Y en la propuesta, sobre los mismos
// datos y en el mismo proceso, para que la velocidad de la máquina se cancele.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require(path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'));

const ARGS = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const SERIE = ARGS.length ? ARGS : [500, 2000, 5000];
const UNIDADES_POR_RUTA = 40;               // igual que escala.js
const INTERVALO_MS = 3000;                  // STATE_INTERVAL_MS de producción
const num = n => n.toLocaleString('es');

// Un objeto unit con la forma real (server/index.js:5848). Los campos que
// `buildState` toca —routeId, lat, routeProgress, enRuta, presencia, sinSenal—
// tienen valores realistas; el resto rellena para que el stringify pese lo que
// pesa de verdad.
function unidadFalsa(i, routeId) {
  return {
    unitId: 'M-' + i, routeId,
    lat: -15.49 + Math.random() * 0.02, lng: -70.13 + Math.random() * 0.02,
    speed: 20, routeProgress: Math.random(),
    tramo: 'ida', progresoTramo: Math.random(), rumbo: Math.random() * 360,
    desvioM: 0, fueraDeRuta: false, fueraDesde: null,
    sinSenal: Math.random() < 0.05, sinSenalDesde: null,
    presencia: 'ruta', enRuta: true, entroEn: null,
    timestamp: Date.now(), oidoEn: Date.now(), vehicleId: 'M-' + i,
    driverName: 'Chofer ' + i, personId: 'M-' + i,
  };
}

function armar(unidades) {
  const rutas = Math.max(1, Math.round(unidades / UNIDADES_POR_RUTA));
  const units = new Map();
  for (let i = 0; i < unidades; i++) {
    const r = 'R-' + (i % rutas);
    units.set('M-' + i, unidadFalsa(i, r));
  }
  const listaRutas = Array.from({ length: rutas }, (_, k) => 'R-' + k);

  // vehicles, para la cuenta de flota. Con su índice, como en producción.
  const db = new Database(path.join(os.tmpdir(), `emis-${unidades}-${process.pid}.db`));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE vehicles (unitId TEXT PRIMARY KEY, routeId TEXT)');
  db.exec('CREATE INDEX idx_vehicles_ruta ON vehicles (routeId)');
  const ins = db.prepare('INSERT INTO vehicles (unitId, routeId) VALUES (?, ?)');
  db.transaction(() => {
    for (let i = 0; i < unidades; i++) ins.run('M-' + i, 'R-' + (i % rutas));
  })();
  return { units, listaRutas, db };
}

// Cronometra `fn` corriéndola varias veces; devuelve el mejor tiempo (el menos
// contaminado por el GC o el scheduler).
function cron(fn, veces = 5) {
  let mejor = Infinity;
  for (let k = 0; k < veces; k++) {
    const t = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms < mejor) mejor = ms;
  }
  return mejor;
}

// ── LOS DOS COSTOS, EN SUS DOS FORMAS ──────────────────────────

// 1a. Barrido plano: exactamente server/index.js:5701-5703, una vez por ruta.
function cicloBarridoPlano(units, listaRutas) {
  for (const routeId of listaRutas) {
    const all = Array.from(units.values())
      .filter(u => u.routeId === routeId && u.lat !== null)
      .sort((a, b) => b.routeProgress - a.routeProgress);
    all.length;  // usar el resultado para que no lo optimice de más
  }
}

// 1b. Con índice por ruta: el Map se agrupa una vez y cada ruta lee sólo lo
// suyo. Es el arreglo candidato.
function agrupar(units) {
  const porRuta = new Map();
  for (const u of units.values()) {
    if (u.lat === null) continue;
    let a = porRuta.get(u.routeId);
    if (!a) { a = []; porRuta.set(u.routeId, a); }
    a.push(u);
  }
  return porRuta;
}
function cicloBarridoIndexado(units, listaRutas) {
  const porRuta = agrupar(units);            // el costo de mantener el índice
  for (const routeId of listaRutas) {
    const all = (porRuta.get(routeId) || []).slice()
      .sort((a, b) => b.routeProgress - a.routeProgress);
    all.length;
  }
}

// 2a. Cuenta de flota sin cachear: server/index.js:5745, una vez por ruta.
function cicloCuentaSinCache(db, listaRutas) {
  for (const routeId of listaRutas) {
    db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE routeId = ?').get(routeId).c;
  }
}
// 2b. Con la sentencia compilada una sola vez.
function cicloCuentaCacheada(stmt, listaRutas) {
  for (const routeId of listaRutas) stmt.get(routeId).c;
}

// ── CORRER ─────────────────────────────────────────────────────
const filas = [];
for (const unidades of SERIE) {
  const rutas = Math.max(1, Math.round(unidades / UNIDADES_POR_RUTA));
  process.stdout.write(`armando ${num(unidades)} unidades / ${rutas} rutas… `);
  const { units, listaRutas, db } = armar(unidades);
  const stmt = db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE routeId = ?');

  const barridoPlano = cron(() => cicloBarridoPlano(units, listaRutas));
  const barridoIdx = cron(() => cicloBarridoIndexado(units, listaRutas));
  const cuentaSin = cron(() => cicloCuentaSinCache(db, listaRutas));
  const cuentaCache = cron(() => cicloCuentaCacheada(stmt, listaRutas));

  // El stringify de UNA ruta (~40 unidades), para mostrar que es chico.
  const unaRuta = Array.from(units.values()).filter(u => u.routeId === 'R-0');
  const strUnaRuta = cron(() => JSON.stringify({ type: 'state', units: unaRuta }), 20);

  db.close();
  try { fs.rmSync(db.name, { force: true }); fs.rmSync(db.name + '-wal', { force: true }); fs.rmSync(db.name + '-shm', { force: true }); } catch {}

  const cicloHoy = barridoPlano + cuentaSin;
  const cicloFix = barridoIdx + cuentaCache;
  filas.push({ unidades, rutas, barridoPlano, barridoIdx, cuentaSin, cuentaCache, cicloHoy, cicloFix, strUnaRuta });
  console.log(`ciclo hoy ${cicloHoy.toFixed(1)} ms · con arreglo ${cicloFix.toFixed(1)} ms`);
}

// ── INFORME ────────────────────────────────────────────────────
const ms = x => x.toFixed(1).padStart(8);
console.log('\n═══ CPU POR CICLO DE EMISIÓN (armar el estado de TODAS las rutas una vez) ═══\n');
console.log('   Un ciclo = lo que corre cada ' + (INTERVALO_MS / 1000) + ' s si todas las rutas tuvieron GPS.\n');
console.log('   unidades   rutas │ barrido hoy   barrido idx │ cuenta hoy  cuenta cache │  CICLO hoy   CICLO fix');
console.log('   ' + '─'.repeat(88));
for (const f of filas) {
  console.log('   ' + num(f.unidades).padStart(7) + num(f.rutas).padStart(8) + ' │' +
    ms(f.barridoPlano) + ms(f.barridoIdx) + '  │' + ms(f.cuentaSin) + ms(f.cuentaCache) +
    '  │' + ms(f.cicloHoy) + ms(f.cicloFix));
}

if (filas.length >= 2) {
  const a = filas.find(f => f.unidades === 2000) || filas[0];
  const b = filas.find(f => f.unidades === 5000) || filas[filas.length - 1];
  const fFlota = b.unidades / a.unidades;
  console.log('\n═══ CÓMO CRECE (de ' + num(a.unidades) + ' a ' + num(b.unidades) + ' unidades: la flota crece ' + fFlota.toFixed(1) + '×) ═══\n');
  const linea = (etq, va, vb) => {
    const factor = va > 0.01 ? vb / va : 0;
    const forma = factor <= fFlota * 1.3 ? 'lineal' : factor <= fFlota * 2.2 ? 'peor que lineal' : 'CUADRÁTICO';
    console.log('   ' + etq.padEnd(24) + va.toFixed(1).padStart(8) + ' → ' + vb.toFixed(1).padStart(8) + ' ms   ' +
      factor.toFixed(1) + '×   ' + forma);
  };
  linea('barrido hoy', a.barridoPlano, b.barridoPlano);
  linea('barrido con índice', a.barridoIdx, b.barridoIdx);
  linea('cuenta hoy', a.cuentaSin, b.cuentaSin);
  linea('cuenta cacheada', a.cuentaCache, b.cuentaCache);
  console.log('   ' + '─'.repeat(60));
  linea('CICLO hoy', a.cicloHoy, b.cicloHoy);
  linea('CICLO con arreglos', a.cicloFix, b.cicloFix);
  console.log('\n   stringify de UNA ruta (~40 u.): ' + a.strUnaRuta.toFixed(2) + ' → ' + b.strUnaRuta.toFixed(2) +
    ' ms — por unidad de la ruta, no de la flota: no mueve la forma.');
}
console.log('');
