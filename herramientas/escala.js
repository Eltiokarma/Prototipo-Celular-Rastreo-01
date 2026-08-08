// Banco de escala del panel: cuánto tarda CADA lectura a tamaño de régimen.
//
//   node herramientas/escala.js            → 2000 unidades (lo que se despliega)
//   node herramientas/escala.js 20000      → el objetivo
//   node herramientas/escala.js 2000 --keep→ no borra la base, para inspeccionarla
//
// POR QUÉ EXISTE, y por qué no alcanzaba con el `bench` de `modelo-costos.js`.
//
// Aquel mide la ESCRITURA (cuánto del segundo se come el segundo de carga) y
// se arma un esquema propio a mano — que ya se separó del real: no tiene
// `legs`, ni `deviations`, ni las columnas de migración, ni los índices que
// el servidor crea al arrancar. Un banco con un esquema paralelo mide un
// sistema que no existe.
//
// Éste mide la LECTURA y no tiene esquema propio: **arranca el servidor de
// verdad**, deja que cree sus tablas, sus migraciones y sus índices, siembra
// encima con SQL y después pregunta por HTTP como preguntaría un despachador.
// Lo que sale es lo que va a tardar en producción, con el JSON armado y todo.
//
// Y la razón por la que estos números importan más de lo que parecen: SQLite
// es SINCRÓNICO y vive en el mismo hilo que atiende los POST /gps de toda la
// flota (`COSTOS.md` §3). Cada milisegundo de esta tabla es un milisegundo en
// el que NADIE reporta posición. Un endpoint de 10 s no es una pantalla lenta:
// es el mapa de 2000 combis congelado diez segundos porque alguien abrió una
// pestaña.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const Database = require(path.join(RAIZ, 'server', 'node_modules', 'better-sqlite3'));

const UNIDADES = Number(process.argv[2]) || 2000;
const GUARDAR = process.argv.includes('--keep');
const DIAS = 120;                 // la retención real (LAPS_DIAS)
const VUELTAS_POR_DIA = 8;
const UNIDADES_POR_RUTA = 40;
const EMPRESAS = 10;
const PUERTO = 3199;
const API = `http://localhost:${PUERTO}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escala-r14-'));
const DB = path.join(dir, 'escala.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (n) => n.toLocaleString('es');

function arrancar() {
  const srv = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PUERTO), DB_FILE: DB,
      DISPATCH_PASSWORD: 'escala99',
      // Sin emisión de estado en bucle: acá se mide la LECTURA del panel, y
      // un broadcast cada 3 s metería ruido en la medición.
      STATE_INTERVAL_MS: '60000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  srv.stderr.on('data', d => {
    const s = String(d);
    if (!/GEOAPIFY|clave se crea/.test(s)) process.stderr.write('[srv] ' + s);
  });
  return srv;
}

async function esperar() {
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return true; } catch {}
  }
  throw new Error('el servidor no levantó');
}

// ── Sembrar ───────────────────────────────────────────────────────────
// Directo con SQL y en una transacción: dar de alta 20 000 choferes por la
// API tardaría más que el resto del banco junto, y lo que se mide acá es la
// lectura, no el alta.
function sembrar() {
  const db = new Database(DB);
  db.pragma('journal_mode = WAL');
  const ahora = Date.now();
  const rutas = Math.max(1, Math.round(UNIDADES / UNIDADES_POR_RUTA));

  const columnas = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  const tiene = (t, c) => columnas(t).includes(c);

  // La empresa 0 tiene que ser LA DEL DESPACHO que se crea al arrancar
  // (`DEFAULT_COMPANY`, "R14" por defecto). Sembrando diez cooperativas
  // inventadas, el panel contestaba con la suya —vacía— en 2 ms y el banco
  // daba todo en verde: se estaría midiendo el costo de no encontrar nada.
  // Las otras nueve existen igual, para que el borde por empresa tenga a
  // quién excluir y las subconsultas de ruta no queden triviales.
  const propia = (db.prepare("SELECT companyId FROM users WHERE role = 'dispatch' ORDER BY createdAt LIMIT 1").get() || {}).companyId;
  if (!propia) throw new Error('no hay cuenta de Despacho: ¿arrancó el servidor?');
  const empresaDe = (i) => (i % EMPRESAS === 0 ? propia : 'COOP-' + (i % EMPRESAS));

  const insEmpresa = db.prepare('INSERT OR IGNORE INTO companies (companyId, name) VALUES (?, ?)');
  const insRuta = db.prepare(
    'INSERT OR IGNORE INTO routes (routeId, name, companyId, targetGapMin, durationMin) VALUES (?, ?, ?, ?, ?)');
  const insVeh = db.prepare(
    'INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)');
  // `passHash` va con formato salt:hash (scrypt) — acá se siembra una cadena
  // inválida a propósito: estas cuentas nunca inician sesión, sólo existen
  // para que las consultas del panel tengan a quién contar.
  const insUser = db.prepare(`INSERT OR IGNORE INTO users
    (unitId, passHash, role, routeId, companyId, name, driverName, vehicleId, createdAt)
    VALUES (?, 'x:x', ?, ?, ?, ?, ?, ?, ?)`);
  const insLap = db.prepare(`INSERT INTO laps
    (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec, parcial, progresoInicial)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insLeg = tiene('legs', 'leg') ? db.prepare(`INSERT INTO legs
    (unitId, routeId, variantId, leg, startedAt, finishedAt, durationSec, parcial) VALUES (?,?,?,?,?,?,?,?)`) : null;
  const insTurno = db.prepare(`INSERT INTO shifts
    (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt) VALUES (?,?,?,?,?,?,?)`);
  const insDesvio = db.prepare(`INSERT INTO deviations
    (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre)
    VALUES (?,?,?,?,?,?,?,0,'regreso')`);
  // `messages` no lleva companyId: se acota por routeId, y el borde de
  // empresa lo pone la subconsulta de rutas. Se siembra como es, no como
  // uno se lo imagina — de eso se trata arrancar el servidor primero.
  const insMsg = db.prepare(`INSERT INTO messages
    (kind, unitId, driverName, text, routeId, vehicleId, timestamp) VALUES (?,?,?,?,?,?,?)`);
  const insAudit = db.prepare(
    'INSERT INTO audit (actor, action, target, detail, routeId, companyId, timestamp) VALUES (?,?,?,?,?,?,?)');

  process.stdout.write(`sembrando ${num(UNIDADES)} unidades · ${DIAS} días… `);
  const t0 = Date.now();
  db.transaction(() => {
    for (let e = 1; e < EMPRESAS; e++) insEmpresa.run('COOP-' + e, 'Cooperativa ' + e);
    for (let r = 0; r < rutas; r++) insRuta.run('R-' + r, 'Ruta ' + r, empresaDe(r), 2, 50);
  })();

  // De a tandas: una sola transacción con 20 000 unidades × 120 días × 8
  // vueltas son 19,2 M de INSERT y el WAL se va a las nubes.
  const TANDA = 250;
  for (let base = 0; base < UNIDADES; base += TANDA) {
    db.transaction(() => {
      for (let u = base; u < Math.min(base + TANDA, UNIDADES); u++) {
        const unitId = 'M-' + u;
        const routeId = 'R-' + (u % rutas);
        const empresa = empresaDe(u % rutas);
        insVeh.run(unitId, 'Placa ' + u, routeId, empresa, ahora);
        insUser.run(unitId, 'driver', routeId, empresa, 'Chofer ' + u, 'Chofer ' + u, unitId, ahora);
        // Un cobrador cada tres combis, que es lo que se ve en la calle
        if (u % 3 === 0) {
          insUser.run('C-' + u, 'collector', routeId, empresa, 'Cobrador ' + u, 'Cobrador ' + u, unitId, ahora);
        }
        for (let d = 0; d < DIAS; d++) {
          const dia = ahora - d * 86400_000;
          // Turnos: NUNCA se podan (ver el informe del banco), así que a los
          // 120 días son 120 filas por persona y siguen creciendo.
          insTurno.run(unitId, unitId, routeId, 'driver', dia - 8 * 3600_000, dia, dia);
          if (u % 3 === 0) insTurno.run('C-' + u, unitId, routeId, 'collector', dia - 8 * 3600_000, dia, dia);
          for (let v = 0; v < VUELTAS_POR_DIA; v++) {
            const fin = dia - v * 3600_000;
            const dur = 2400 + ((u + v) % 600);
            const parcial = (v === 0 && u % 20 === 0) ? 1 : 0;
            insLap.run(unitId, routeId, 1, fin - dur * 1000, fin, dur, 22,
                       300 + (u % 120), 300, parcial, parcial ? 0.5 : 0.01);
            if (insLeg) {
              insLeg.run(unitId, routeId, 1, 'ida', fin - dur * 1000, fin - dur * 500, Math.round(dur / 2), parcial);
              insLeg.run(unitId, routeId, 1, 'vuelta', fin - dur * 500, fin, Math.round(dur / 2), 0);
            }
          }
          // Un desvío cada diez días por unidad
          if (d % 10 === 0) insDesvio.run(unitId, routeId, dia, dia + 600_000, 600, 450, 300);
        }
      }
    })();
    if (base % 2000 === 0) process.stdout.write('.');
  }

  // Chat y auditoría: se podan por tiempo (30 y 365 días) y por tope, así que
  // se siembra lo que de verdad sobrevive, no más.
  db.transaction(() => {
    const chats = Math.min(UNIDADES * 20, 200_000);
    for (let i = 0; i < chats; i++) {
      const fin = ahora - Math.floor((i / chats) * 30 * 86400_000);
      const u = 'M-' + (i % UNIDADES);
      insMsg.run('chat', u, 'Chofer', 'mensaje ' + i, 'R-' + (i % rutas), u, fin);
    }
    // SOS: se retienen 365 días, así que son los que más lejos llegan
    for (let i = 0; i < Math.min(UNIDADES, 4000); i++) {
      const u = 'M-' + (i % UNIDADES);
      insMsg.run('sos', u, 'Chofer', null, 'R-' + (i % rutas), u,
                 ahora - Math.floor((i / Math.min(UNIDADES, 4000)) * 365 * 86400_000));
    }
    for (let e = 0; e < EMPRESAS; e++) {
      for (let i = 0; i < 1000; i++) {
        insAudit.run('M-' + i, 'login', null, null, 'R-' + e, empresaDe(e), ahora - i * 60_000);
      }
    }
  })();

  db.exec('ANALYZE');
  const mb = (fs.statSync(DB).size / 1e6).toFixed(0);
  console.log(` ${((Date.now() - t0) / 1000).toFixed(0)} s · ${mb} MB`);
  const cuenta = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  console.log(`   ${num(cuenta('laps'))} vueltas · ${num(cuenta('legs'))} tramos · ` +
    `${num(cuenta('shifts'))} turnos · ${num(cuenta('deviations'))} desvíos · ` +
    `${num(cuenta('messages'))} mensajes · ${num(cuenta('users'))} personas`);
  db.close();
  return { mb };
}

// ── Medir ─────────────────────────────────────────────────────────────
const UMBRAL_AVISO = 250;   // ms: por encima de esto ya se siente en el GPS
const UMBRAL_GRAVE = 1000;

(async () => {
  console.log(`\nBANCO DE ESCALA DEL PANEL · ${num(UNIDADES)} unidades\n`);

  // Primer arranque: que el servidor cree el esquema, las migraciones y los
  // índices. Es la razón de ser de este banco — no hay esquema escrito acá.
  process.stdout.write('creando el esquema con el servidor real… ');
  let srv = arrancar();
  await esperar();
  srv.kill();
  await sleep(700);
  console.log('ok');

  const { mb } = sembrar();

  process.stdout.write('arrancando contra la base sembrada… ');
  srv = arrancar();
  await esperar();
  console.log('ok\n');

  try {
    const login = async (u, p) => (await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, password: p }),
    }).then(r => r.json()));

    const d = await login('DESPACHO', 'escala99');
    if (!d.token) throw new Error('no entró DESPACHO: ' + JSON.stringify(d));
    const empresaDespacho = d.companyId || 'COOP-0';
    const HD = { Authorization: 'Bearer ' + d.token };
    const tokenGer = await require(path.join(RAIZ, 'pruebas', 'gerente.js'))(API, DB, empresaDespacho);
    const HG = { Authorization: 'Bearer ' + tokenGer };

    const hasta = Date.now(), desde = hasta - 30 * 86400_000;
    const unaRuta = (new Database(DB, { readonly: true })
      .prepare('SELECT routeId FROM routes WHERE companyId = ? LIMIT 1').get(empresaDespacho) || {}).routeId;

    const casos = [
      ['GET  /admin/metrics', '/admin/metrics', HD],
      ['GET  /admin/vueltas', '/admin/vueltas', HD],
      ['GET  /admin/shifts', '/admin/shifts', HD],
      ['GET  /admin/users', '/admin/users', HD],
      ['GET  /admin/vehicles', '/admin/vehicles', HD],
      ['GET  /admin/routes', '/admin/routes', HD],
      ['GET  /admin/audit', '/admin/audit', HD],
      ['GET  /admin/company', '/admin/company', HD],
      ['GET  /admin/grabaciones', '/admin/grabaciones', HD],
      [`GET  /admin/routes/:r/points`, `/admin/routes/${unaRuta}/points`, HD],
      ['GET  /gerencia/resumen · 30 días', `/gerencia/resumen?desde=${desde}&hasta=${hasta}`, HG],
      ['GET  /gerencia/resumen · 90 días', `/gerencia/resumen?desde=${hasta - 90 * 86400_000}&hasta=${hasta}`, HG],
      ['CSV  informe vueltas · 30 días', `/admin/informe/vueltas.csv?desde=${desde}&hasta=${hasta}`, HD],
      ['CSV  informe tramos · 30 días', `/admin/informe/tramos.csv?desde=${desde}&hasta=${hasta}`, HD],
      ['CSV  informe horas · 30 días', `/admin/informe/horas.csv?desde=${desde}&hasta=${hasta}`, HD],
      ['CSV  informe desvios · 30 días', `/admin/informe/desvios.csv?desde=${desde}&hasta=${hasta}`, HD],
      ['CSV  informe sos · 30 días', `/admin/informe/sos.csv?desde=${desde}&hasta=${hasta}`, HD],
      ['CSV  informe actividad · 30 días', `/admin/informe/actividad.csv?desde=${desde}&hasta=${hasta}`, HD],
    ];

    const medir = async (ruta, headers) => {
      const t = [];
      for (let i = 0; i < 4; i++) {
        const a = process.hrtime.bigint();
        const r = await fetch(API + ruta, { headers });
        const cuerpo = await r.arrayBuffer();
        const ms = Number(process.hrtime.bigint() - a) / 1e6;
        if (i > 0) t.push(ms);                       // la primera calienta
        if (!r.ok) return { error: r.status };
        if (i === 3) return { ms: Math.min(...t), kb: cuerpo.byteLength / 1024 };
      }
    };

    console.log('endpoint                              tiempo      respuesta');
    console.log('─'.repeat(66));
    const malos = [];
    for (const [etq, ruta, headers] of casos) {
      const r = await medir(ruta, headers);
      if (r.error) { console.log(`${etq.padEnd(38)}  HTTP ${r.error}`); continue; }
      const marca = r.ms >= UMBRAL_GRAVE ? '  ‹‹ GRAVE' : r.ms >= UMBRAL_AVISO ? '  ‹ lento' : '';
      console.log(`${etq.padEnd(38)}${(r.ms.toFixed(0) + ' ms').padStart(9)}` +
        `${(r.kb.toFixed(0) + ' kB').padStart(12)}${marca}`);
      if (r.ms >= UMBRAL_AVISO) malos.push([etq, r.ms]);
    }
    console.log('─'.repeat(66));
    console.log(`base: ${mb} MB · umbral de aviso ${UMBRAL_AVISO} ms · grave ${UMBRAL_GRAVE} ms`);
    if (malos.length) {
      console.log(`\n${malos.length} lectura(s) por encima del umbral. Cada ms acá es un ms en el que`);
      console.log('la flota entera no reporta posición: SQLite es sincrónico y comparte hilo.');
    } else {
      console.log('\nTodas las lecturas por debajo del umbral.');
    }
  } finally {
    srv.kill();
    await sleep(300);
    if (GUARDAR) console.log(`\nbase guardada en ${DB}`);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
