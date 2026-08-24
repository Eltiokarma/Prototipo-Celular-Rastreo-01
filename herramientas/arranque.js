// Cuánto tarda el servidor en arrancar, y SOBRE TODO en qué se le va el tiempo.
//
//   node herramientas/escala.js 5000 --keep     → primero sembrá una base
//   node herramientas/arranque.js <base.db> …   → después medí el arranque
//
// POR QUÉ EXISTE. El arranque es tiempo con el sistema CAÍDO: después de cada
// despliegue o reinicio, nadie reporta y nadie ve el mapa. Se midió 5 s a 2000
// unidades y 55 s a 5000 — la flota creció 2,5× y el arranque 11×. Por la regla
// de este repo eso es una bandera roja, no un costo lineal: puede haber otro
// cuadrático escondido justo donde nadie lo buscó. Pero eran dos puntos y una
// causa desconocida, y **un número sin diagnóstico no se extrapola** (ya se
// pagó tres veces en este proyecto creerle a un número lindo).
//
// CÓMO MIDE. No toca `server/index.js`: se precarga con `node -r` e intercepta
// `better-sqlite3` antes de que el servidor lo requiera, cronometrando cada
// `prepare/run/get/all/exec/pragma` y la apertura de la base — que es donde se
// recupera el WAL y suele esconderse el tiempo que nadie atribuye a nada.
// Instrumentar de afuera importa: si la sonda viviera dentro del servidor,
// mediría un servidor que no es el que se despliega.
//
// El informe separa el tiempo en SQL del que no lo es. Esa resta es el dato:
// si el arranque son 55 s y el SQL son 3, el problema no está en las consultas.
'use strict';

const path = require('path');
const RAIZ = path.join(__dirname, '..');
const SERVER = path.join(RAIZ, 'server');

// ─── MODO SONDA ────────────────────────────────────────────────
// Activo cuando este archivo entra por `node -r`: ahí `require.main` es
// `server/index.js`, no éste.
if (require.main !== module) {
  const T0 = process.hrtime.bigint();
  const ahora = () => process.hrtime.bigint();
  const ms = (a, b) => Number(b - a) / 1e6;

  const acumulado = new Map();   // sql → { n, ms }
  let aperturaMs = 0;
  let preparaciones = 0;         // compilar una sentencia también cuesta

  const anotar = (sql, dur) => {
    const k = String(sql).replace(/\s+/g, ' ').trim();
    const e = acumulado.get(k) || { n: 0, ms: 0 };
    e.n++; e.ms += dur;
    acumulado.set(k, e);
  };

  // Se resuelve desde `server/`, que es donde el servidor lo tiene instalado.
  // Tiene que ser el MISMO módulo que va a requerir él, o parcheamos una copia
  // y medimos cero.
  const ID = require.resolve('better-sqlite3', { paths: [SERVER] });
  const Real = require(ID);

  const origExec = Real.prototype.exec;
  Real.prototype.exec = function (sql) {
    const t = ahora();
    try { return origExec.call(this, sql); }
    finally { anotar(sql, ms(t, ahora())); }
  };

  const origPragma = Real.prototype.pragma;
  Real.prototype.pragma = function (sql, ...resto) {
    const t = ahora();
    try { return origPragma.call(this, sql, ...resto); }
    finally { anotar('PRAGMA ' + sql, ms(t, ahora())); }
  };

  const origPrepare = Real.prototype.prepare;
  Real.prototype.prepare = function (sql) {
    const t = ahora();
    const st = origPrepare.call(this, sql);
    preparaciones += ms(t, ahora());
    // Se envuelve la instancia y no el prototipo: better-sqlite3 comparte el
    // prototipo entre todas las sentencias, y envolverlo apilaría una capa por
    // cada `prepare` — el propio instrumento se volvería el cuello de botella.
    for (const m of ['run', 'get', 'all', 'iterate']) {
      if (typeof st[m] !== 'function') continue;
      const orig = st[m].bind(st);
      st[m] = (...args) => {
        const t2 = ahora();
        try { return orig(...args); }
        finally { anotar(sql, ms(t2, ahora())); }
      };
    }
    return st;
  };

  // Abrir la base incluye recuperar el WAL. Puede ser el grueso del arranque y
  // no aparece en ninguna consulta, así que se cronometra aparte.
  class Sonda extends Real {
    constructor(...args) {
      const t = ahora();
      super(...args);
      aperturaMs += ms(t, ahora());
    }
  }
  require.cache[ID].exports = Sonda;

  const informe = () => {
    const total = ms(T0, ahora());
    const filas = [...acumulado.entries()]
      .map(([sql, e]) => ({ sql, ...e }))
      .sort((a, b) => b.ms - a.ms);
    const sqlMs = filas.reduce((s, f) => s + f.ms, 0) + aperturaMs + preparaciones;
    console.log('\n@@INFORME@@' + JSON.stringify({
      total, aperturaMs, preparaciones, sqlMs,
      top: filas.slice(0, 12),
    }));
    process.exit(0);
  };

  const http = require('http');
  const origListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', informe);
    return origListen.apply(this, args);
  };

  return;
}

// ─── MODO CORREDOR ─────────────────────────────────────────────
const fs = require('fs');
const { spawn } = require('child_process');

const os = require('os');
const ARGS = process.argv.slice(2);
const SEMBRAR = ARGS.includes('--sembrar');
const SUELTOS = ARGS.filter(a => !a.startsWith('-'));

if (!SUELTOS.length) {
  console.error('uso: node herramientas/arranque.js --sembrar 500 2000 5000');
  console.error('     node herramientas/arranque.js <base.db> [otra.db …]');
  process.exit(1);
}

const num = n => n.toLocaleString('es');
const mb = f => { try { return (fs.statSync(f).size / 1048576); } catch { return 0; } };
const wal = f => mb(f + '-wal');

function medir(db) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-r', __filename, path.join(SERVER, 'index.js')], {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: '3211',
        DB_FILE: db,
        MODO: 'demo',                     // sin esto los guardias frenan el arranque
        DISPATCH_PASSWORD: 'sonda-arranque',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    p.stdout.on('data', d => { salida += d; });
    p.stderr.on('data', d => { salida += d; });
    p.on('exit', () => {
      const m = salida.match(/@@INFORME@@(.*)/);
      if (!m) return reject(new Error('el servidor no llegó a escuchar:\n' + salida.slice(-800)));
      resolve(JSON.parse(m[1]));
    });
  });
}

// Sembrar reusa el generador de `escala.js` en vez de tener el suyo: dos
// generadores que se van separando terminan midiendo bases distintas.
// El esquema lo crea el servidor de verdad —la primera medición contra el
// archivo vacío—, así que la base es la que el sistema realmente construye
// y no una que esta herramienta se imagina.
async function conSembrado(unidades) {
  const { sembrar } = require('./escala.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arranque-r14-'));
  const db = path.join(dir, `u${unidades}.db`);
  fs.writeFileSync(db, '');
  process.stdout.write(`   ${num(unidades)} unidades · creando esquema… `);
  const vacio = await medir(db);
  console.log(`${(vacio.total / 1000).toFixed(1)} s en vacío`);
  process.stdout.write('   sembrando… ');
  sembrar(db, unidades);
  return { db, vacio, unidades };
}

(async () => {
  const resultados = [];
  const lista = SEMBRAR
    ? await (async () => {
      const out = [];
      for (const n of SUELTOS.map(Number)) out.push(await conSembrado(n));
      return out;
    })()
    : SUELTOS.map(db => ({ db }));

  for (const { db, vacio, unidades } of lista) {
    if (!fs.existsSync(db)) { console.error(`no existe: ${db}`); process.exit(1); }
    const pesoAntes = mb(db), walAntes = wal(db);
    process.stdout.write(`midiendo ${path.basename(db)} (${pesoAntes.toFixed(0)} MB` +
      (walAntes > 1 ? `, WAL ${walAntes.toFixed(0)} MB` : '') + ')… ');
    const r = await medir(db);
    console.log(`${(r.total / 1000).toFixed(1)} s`);
    resultados.push({ db, pesoMB: pesoAntes, walMB: walAntes, vacio, unidades, ...r });
  }

  console.log('\n═══ EN QUÉ SE VA EL ARRANQUE ═══════════════════════════\n');
  for (const r of resultados) {
    const noSql = r.total - r.sqlMs;
    console.log(`── ${path.basename(r.db)}  ·  ${r.pesoMB.toFixed(0)} MB` +
      (r.walMB > 1 ? `  ·  WAL ${r.walMB.toFixed(0)} MB` : ''));
    console.log(`   TOTAL hasta escuchar     ${(r.total / 1000).toFixed(2)} s`);
    console.log(`   ├─ abrir la base (WAL)   ${r.aperturaMs.toFixed(0)} ms`);
    console.log(`   ├─ compilar sentencias   ${r.preparaciones.toFixed(0)} ms`);
    console.log(`   ├─ ejecutar SQL          ${(r.sqlMs - r.aperturaMs - r.preparaciones).toFixed(0)} ms`);
    console.log(`   └─ todo lo demás         ${noSql.toFixed(0)} ms   (arrancar Node, leer módulos…)`);
    console.log('\n   las 8 consultas más caras:');
    for (const t of r.top.slice(0, 8)) {
      if (t.ms < 1) continue;
      console.log(`   ${t.ms.toFixed(0).padStart(7)} ms  ×${String(t.n).padEnd(4)} ${t.sql.slice(0, 88)}`);
    }
    console.log('');
  }

  // Con dos tamaños se puede leer la forma, que es lo que se vino a buscar.
  if (resultados.length >= 2) {
    const [a, b] = [resultados[0], resultados[resultados.length - 1]];
    const fBase = b.pesoMB / a.pesoMB;
    const fArranque = b.total / a.total;
    console.log('═══ CÓMO CRECE ═════════════════════════════════════════\n');
    console.log(`   la base crece      ${fBase.toFixed(1)}×`);
    console.log(`   el arranque crece  ${fArranque.toFixed(1)}×`);
    const veredicto = fArranque <= fBase * 1.3 ? 'LINEAL o mejor — sano'
      : fArranque <= fBase * 2.5 ? 'peor que lineal — mirar'
        : 'MUY peor que lineal — bandera roja';
    console.log(`\n   ${veredicto}\n`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
