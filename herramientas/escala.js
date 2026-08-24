// Banco de escala: cuánto tarda cada lectura, y sobre todo CÓMO CRECE.
//
//   node herramientas/escala.js              → 500 · 2000 · 5000 y el factor
//   node herramientas/escala.js 2000         → un solo tamaño
//   node herramientas/escala.js --carga 5000 → el daño real: cuánto se frena
//                                              la ingesta de GPS de la flota
//   node herramientas/escala.js 2000 --keep  → no borra la base
//
// LO QUE SE BUSCA NO ES "CONSULTAS LENTAS". Una consulta de 400 ms que crece
// lineal es sana: al triple de flota tarda el triple y se ve venir. Una de
// 40 ms que crece cuadrático te mata al triple de flota y NO se ve venir,
// porque hoy no molesta. **La forma de la curva importa más que el número.**
//
// Por eso el banco mide el mismo endpoint en tres tamaños y reporta:
//
//     factor = tiempo(5000) / tiempo(2000)
//
//     ~2,5×  lineal        — sano
//     ~6×    cuadrático    — bandera roja aunque hoy tarde poco
//     >10×   peor          — crítico
//
// POR QUÉ IMPORTA TANTO ACÁ. SQLite es sincrónico y vive en el mismo hilo que
// atiende los `POST /gps` de toda la flota. Una consulta lenta no es una
// pantalla que tarda: es **la ingesta de GPS de todos parada** mientras corre.
// Lo que ve el usuario es el mapa de la flota entera congelado porque alguien
// abrió una pestaña. Los ms de la consulta son el diagnóstico; el modo
// `--carga` mide el daño.
//
// NO TIENE ESQUEMA PROPIO, a propósito: arranca el servidor de verdad, lo deja
// crear tablas, migraciones e índices, y siembra encima. El `bench` de
// `modelo-costos.js` —que mide otra cosa, la escritura— sí se escribe las
// tablas a mano, y ya se separó del real.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const Database = require(path.join(RAIZ, 'server', 'node_modules', 'better-sqlite3'));

const ARGS = process.argv.slice(2);
const GUARDAR = ARGS.includes('--keep');
const CARGA = ARGS.includes('--carga');
const TAMANOS = ARGS.filter(a => /^\d+$/.test(a)).map(Number);
const SERIE = TAMANOS.length ? TAMANOS : (CARGA ? [5000] : [500, 2000, 5000]);

// La retención REAL que quedó configurada. No es la misma para todo, y usar
// un solo número daría una base que no se parece a la de producción.
const DIAS_HISTORIAL = 120;   // laps, legs, deviations (LAPS_DIAS)
const DIAS_TURNOS = 365;      // shifts (TURNOS_DIAS): con ellos se liquidan horas
const VUELTAS_POR_DIA = 8;
const UNIDADES_POR_RUTA = 40;
const EMPRESAS = 10;
const PUERTO = 3199;
const API = `http://localhost:${PUERTO}`;
// El panel del creador no se monta si la clave tiene menos de 12 caracteres.
const CLAVE_CREADOR = 'banco-de-escala-solo-local';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (n) => n.toLocaleString('es');
const UMBRAL_AVISO = 250;
const UMBRAL_GRAVE = 1000;

function arrancar(DB) {
  const srv = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PUERTO), DB_FILE: DB,
      DISPATCH_PASSWORD: 'escala99', MODO: 'demo',
      CREATOR_PASSWORD: CLAVE_CREADOR,
      // Sin emisión de estado en bucle: acá se mide la LECTURA del panel y un
      // broadcast cada 3 s metería ruido. En `--carga` se sube a propósito.
      STATE_INTERVAL_MS: CARGA ? '3000' : '60000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  srv.stderr.on('data', d => {
    const s = String(d);
    if (!/GEOAPIFY|clave se crea/.test(s)) process.stderr.write('[srv] ' + s);
  });
  return srv;
}

// Que el puerto esté LIBRE antes de levantar nada, y que quede libre después.
//
// Sin esto el banco puede medir contra un servidor que no es el suyo: si una
// corrida anterior dejó uno colgado en 3199, el nuevo no se ata al puerto, se
// muere, y `esperar()` ve que "algo contesta" y sigue como si nada — midiendo
// código viejo, o una base ya borrada. Pasó, y los números salieron 2,3 veces
// peores sin ninguna razón real. Un banco que mide otra cosa es peor que no
// tener banco: da confianza falsa en las dos direcciones.
async function puertoLibre(quienLlama) {
  for (let i = 0; i < 40; i++) {
    try { await fetch(API + '/ping'); } catch { return; }   // no contesta nadie: libre
    await sleep(250);
  }
  throw new Error(`el puerto ${PUERTO} sigue ocupado por otro servidor (${quienLlama}). ` +
    'Cerralo antes de medir: `pkill -f server/index.js`.');
}

// Cuánto se le da al servidor para levantar. CINCO MINUTOS, y no es holgura
// de más: arrancar contra la base de 5000 unidades (2,0 GB, con 635 MB de WAL
// sin consolidar que el sembrado deja atrás) tarda MÁS DE UN MINUTO. Con el
// medio minuto que había antes, la etapa de 5000 no fallaba por lenta: fallaba
// siempre, y el barrido nunca llegaba a medirla.
//
// Devuelve los segundos que tardó, y quien llama los imprime. Un arranque
// largo no es ruido del banco: es el tiempo que el sistema real va a estar
// caído después de un despliegue o un reinicio, y conviene verlo.
const ESPERA_ARRANQUE_MS = 5 * 60_000;
async function esperar() {
  const t0 = Date.now();
  while (Date.now() - t0 < ESPERA_ARRANQUE_MS) {
    await sleep(250);
    try { await fetch(API + '/ping'); return (Date.now() - t0) / 1000; } catch {}
  }
  throw new Error(`el servidor no levantó en ${ESPERA_ARRANQUE_MS / 1000} s`);
}

// ── Sembrar ───────────────────────────────────────────────────────────
function sembrar(DB, UNIDADES) {
  const db = new Database(DB);
  db.pragma('journal_mode = WAL');
  const ahora = Date.now();
  const rutas = Math.max(1, Math.round(UNIDADES / UNIDADES_POR_RUTA));
  const tiene = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name).includes(c);

  // La empresa 0 tiene que ser LA DEL DESPACHO que se crea al arrancar. Con
  // diez cooperativas inventadas el panel contestaba con la suya —vacía— en
  // 2 ms y el banco daba todo en verde: se estaría midiendo el costo de no
  // encontrar nada. Las otras nueve existen para que el borde por empresa
  // tenga a quién excluir.
  const propia = (db.prepare("SELECT companyId FROM users WHERE role = 'dispatch' ORDER BY createdAt LIMIT 1").get() || {}).companyId;
  if (!propia) throw new Error('no hay cuenta de Despacho: ¿arrancó el servidor?');
  const empresaDe = (i) => (i % EMPRESAS === 0 ? propia : 'COOP-' + (i % EMPRESAS));

  // OJO CON `INSERT OR IGNORE`: se traga los errores de restricción, no sólo
  // los choques de clave. `routes.createdAt` es NOT NULL sin valor por
  // defecto, así que olvidarlo hacía que NINGUNA ruta entrara — en silencio, y
  // el banco medía una empresa con una sola ruta creyendo que tenía decenas.
  // Se pone `createdAt` en todas, y al final se verifican los conteos.
  const insEmpresa = db.prepare('INSERT OR IGNORE INTO companies (companyId, name, activa, createdAt) VALUES (?, ?, 1, ?)');
  const insRuta = db.prepare('INSERT OR IGNORE INTO routes (routeId, name, companyId, targetGapMin, durationMin, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
  const insVeh = db.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)');
  // `passHash` va con formato salt:hash (scrypt). Acá se siembra una cadena
  // inválida a propósito: estas cuentas nunca inician sesión, sólo existen
  // para que las consultas del panel tengan a quién contar. Las que SÍ entran
  // (el modo --carga) se dan de alta por la API.
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
  const insMsg = db.prepare(`INSERT INTO messages
    (kind, unitId, driverName, text, routeId, vehicleId, timestamp) VALUES (?,?,?,?,?,?,?)`);
  const insAudit = db.prepare('INSERT INTO audit (actor, action, target, detail, routeId, companyId, timestamp) VALUES (?,?,?,?,?,?,?)');

  process.stdout.write(`   sembrando ${num(UNIDADES)} unidades… `);
  const t0 = Date.now();
  db.transaction(() => {
    for (let e = 1; e < EMPRESAS; e++) insEmpresa.run('COOP-' + e, 'Cooperativa ' + e, ahora);
    for (let r = 0; r < rutas; r++) insRuta.run('R-' + r, 'Ruta ' + r, empresaDe(r), 2, 50, ahora);
  })();

  // De a tandas: 5000 unidades × 120 días × 8 vueltas son millones de INSERT
  // y una sola transacción manda el WAL a las nubes.
  const TANDA = 200;
  for (let base = 0; base < UNIDADES; base += TANDA) {
    db.transaction(() => {
      for (let u = base; u < Math.min(base + TANDA, UNIDADES); u++) {
        const unitId = 'M-' + u;
        const routeId = 'R-' + (u % rutas);
        const empresa = empresaDe(u % rutas);
        insVeh.run(unitId, 'Placa ' + u, routeId, empresa, ahora);
        insUser.run(unitId, 'driver', routeId, empresa, 'Chofer ' + u, 'Chofer ' + u, unitId, ahora);
        const conCobrador = u % 3 === 0;
        if (conCobrador) insUser.run('C-' + u, 'collector', routeId, empresa, 'Cobrador ' + u, 'Cobrador ' + u, unitId, ahora);

        // TURNOS: 365 días, que es su retención real y no la del resto.
        for (let d = 0; d < DIAS_TURNOS; d++) {
          const dia = ahora - d * 86400_000;
          insTurno.run(unitId, unitId, routeId, 'driver', dia - 8 * 3600_000, dia, dia);
          if (conCobrador) insTurno.run('C-' + u, unitId, routeId, 'collector', dia - 8 * 3600_000, dia, dia);
        }
        // VUELTAS, TRAMOS Y DESVÍOS: 120 días.
        for (let d = 0; d < DIAS_HISTORIAL; d++) {
          const dia = ahora - d * 86400_000;
          for (let v = 0; v < VUELTAS_POR_DIA; v++) {
            const fin = dia - v * 3600_000;
            const dur = 2400 + ((u + v) % 600);
            const parcial = (v === 0 && u % 20 === 0) ? 1 : 0;
            insLap.run(unitId, routeId, 1, fin - dur * 1000, fin, dur, 22, 300 + (u % 120), 300, parcial, parcial ? 0.5 : 0.01);
            if (insLeg) {
              insLeg.run(unitId, routeId, 1, 'ida', fin - dur * 1000, fin - dur * 500, Math.round(dur / 2), parcial);
              insLeg.run(unitId, routeId, 1, 'vuelta', fin - dur * 500, fin, Math.round(dur / 2), 0);
            }
          }
          if (d % 10 === 0) insDesvio.run(unitId, routeId, dia, dia + 600_000, 600, 450, 300);
        }
      }
    })();
    if (base % 1000 === 0) process.stdout.write('.');
  }

  // Chat y auditoría: se podan por tiempo (30 y 365 días) y por tope, así que
  // se siembra lo que de verdad sobrevive, no más.
  db.transaction(() => {
    const chats = Math.min(UNIDADES * 20, 200_000);
    for (let i = 0; i < chats; i++) {
      const u = 'M-' + (i % UNIDADES);
      insMsg.run('chat', u, 'Chofer', 'mensaje ' + i, 'R-' + (i % rutas), u, ahora - Math.floor((i / chats) * 30 * 86400_000));
    }
    const sos = Math.min(UNIDADES, 4000);
    for (let i = 0; i < sos; i++) {
      const u = 'M-' + (i % UNIDADES);
      insMsg.run('sos', u, 'Chofer', null, 'R-' + (i % rutas), u, ahora - Math.floor((i / sos) * 365 * 86400_000));
    }
    for (let e = 0; e < EMPRESAS; e++) {
      for (let i = 0; i < 1000; i++) insAudit.run('M-' + i, 'login', null, null, 'R-' + e, empresaDe(e), ahora - i * 60_000);
    }
  })();

  db.exec('ANALYZE');
  const mb = Math.round(fs.statSync(DB).size / 1e6);
  const cuenta = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  // Verificar lo sembrado, y no de adorno: un banco que mide sobre una base
  // más chica de lo que cree da números tranquilizadores y falsos. Ya pasó.
  const esperado = { routes: rutas, vehicles: UNIDADES, users: UNIDADES };
  for (const [tabla, minimo] of Object.entries(esperado)) {
    if (cuenta(tabla) < minimo) {
      throw new Error(`sembrado incompleto: ${tabla} tiene ${cuenta(tabla)} filas y se esperaban ` +
        `al menos ${minimo}. Alguna columna NOT NULL sin valor y un INSERT OR IGNORE tapándolo.`);
    }
  }
  console.log(` ${((Date.now() - t0) / 1000).toFixed(0)} s · ${num(mb)} MB`);
  console.log(`   ${num(cuenta('laps'))} vueltas · ${num(cuenta('legs'))} tramos · ${num(cuenta('shifts'))} turnos · ` +
    `${num(cuenta('users'))} personas · ${num(cuenta('routes'))} rutas`);
  db.close();
  return { mb };
}

// ── Preparar un tamaño: base sembrada + servidor arriba ────────────────
async function preparar(UNIDADES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escala-r14-'));
  const DB = path.join(dir, 'escala.db');
  console.log(`\n══ ${num(UNIDADES)} unidades ═══════════════════════════════════`);
  await puertoLibre('antes de empezar');
  process.stdout.write('   creando el esquema con el servidor real… ');
  let srv = arrancar(DB);
  await esperar();
  srv.kill();
  // Esperar a que SUELTE el puerto, no un rato fijo: si el siguiente arranca
  // antes, no se ata y el banco termina midiendo contra el que quedó vivo.
  await puertoLibre('el del esquema no se apagó');
  console.log('ok');
  const { mb } = sembrar(DB, UNIDADES);
  process.stdout.write('   arrancando contra la base sembrada… ');
  srv = arrancar(DB);
  // Si NO levanta hay que matarlo igual. Sin este try, `esperar()` tiraba con
  // el proceso vivo y nadie lo bajaba: seguía atado al 3199 después de que el
  // banco terminara, y la corrida SIGUIENTE medía contra él —código viejo,
  // base borrada—. Ése fue el origen real de la tanda de números falsos; el
  // guardia de puerto sólo la detectaba, esto la evita.
  let arranqueSeg;
  try {
    arranqueSeg = await esperar();
  } catch (e) {
    srv.kill();
    await puertoLibre('el que no llegó a levantar').catch(() => {});
    throw e;
  }
  console.log(`ok (${arranqueSeg.toFixed(0)} s en arrancar)`);
  return { dir, DB, srv, mb };
}

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(r => r.json());

async function credenciales(DB) {
  const d = await login('DESPACHO', 'escala99');
  if (!d.token) throw new Error('no entró DESPACHO: ' + JSON.stringify(d));
  const empresa = d.companyId;
  const HD = { Authorization: 'Bearer ' + d.token };
  const HG = { Authorization: 'Bearer ' + await require(path.join(RAIZ, 'pruebas', 'gerente.js'))(API, DB, empresa) };
  // El panel del creador tiene su propia puerta y su propio token.
  const c = await fetch(API + '/creador/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: CLAVE_CREADOR }),
  }).then(r => r.json()).catch(() => ({}));
  const HC = c.token ? { Authorization: 'Bearer ' + c.token } : null;
  return { empresa, HD, HG, HC };
}

function listaDeCasos({ empresa, HD, HG, HC }, DB) {
  const hasta = Date.now(), d30 = hasta - 30 * 86400_000, d90 = hasta - 90 * 86400_000;
  const b = new Database(DB, { readonly: true });
  const unaRuta = (b.prepare('SELECT routeId FROM routes WHERE companyId = ? LIMIT 1').get(empresa) || {}).routeId;
  b.close();
  const casos = [
    // etiqueta, ruta, headers, cada cuánto se llama
    // Las dos puntas del selector de período: lo que paga el que abre la
    // pestaña, y lo que paga el que pide todo el historial a propósito. La
    // segunda es la consulta que ANTES se cobraba en cada apertura.
    ['/admin/metrics 7d', '/admin/metrics', HD, 'al abrir la pestaña'],
    ['/admin/metrics todo', '/admin/metrics?todo=1', HD, 'elección expresa, ocasional'],
    ['/admin/vueltas', '/admin/vueltas', HD, 'al abrir la pestaña'],
    ['/admin/shifts', '/admin/shifts', HD, 'al abrir la pestaña'],
    ['/admin/routes', '/admin/routes', HD, 'al abrir Gestión (muy seguido)'],
    ['/admin/users', '/admin/users', HD, 'al abrir Personas'],
    ['/admin/vehicles', '/admin/vehicles', HD, 'al abrir Vehículos'],
    ['/admin/company', '/admin/company', HD, 'al abrir Empresa'],
    ['/admin/audit', '/admin/audit', HD, 'al abrir Actividad'],
    ['/admin/grabaciones', '/admin/grabaciones', HD, 'al abrir el trazador'],
    ['/admin/routes/:r/points', `/admin/routes/${unaRuta}/points`, HD, 'al abrir el trazador'],
    ['/gerencia/resumen 30d', `/gerencia/resumen?desde=${d30}&hasta=${hasta}`, HG, 'al abrir Números'],
    ['/gerencia/resumen 90d', `/gerencia/resumen?desde=${d90}&hasta=${hasta}`, HG, 'al abrir Números'],
    ['CSV vueltas 30d', `/admin/informe/vueltas.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
    ['CSV tramos 30d', `/admin/informe/tramos.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
    ['CSV horas 30d', `/admin/informe/horas.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
    ['CSV desvios 30d', `/admin/informe/desvios.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
    ['CSV sos 30d', `/admin/informe/sos.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
    ['CSV actividad 30d', `/admin/informe/actividad.csv?desde=${d30}&hasta=${hasta}`, HD, 'a pedido'],
  ];
  if (HC) casos.push(
    ['creador /empresas', '/creador/empresas', HC, 'al abrir el panel de arriba'],
    ['creador /sistema', '/creador/sistema', HC, 'al abrir SISTEMA'],
    ['creador /actividad', '/creador/actividad', HC, 'al abrir ACTIVIDAD'],
  );
  return casos;
}

const medirRuta = async (ruta, headers) => {
  const t = [];
  for (let i = 0; i < 4; i++) {
    const a = process.hrtime.bigint();
    const r = await fetch(API + ruta, { headers });
    const cuerpo = await r.arrayBuffer();
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    if (i > 0) t.push(ms);
    if (i === 3) return { ms: Math.min(...t), kb: cuerpo.byteLength / 1024, status: r.status };
  }
};

// ── FASE 3: el daño real ──────────────────────────────────────────────
// Medir consultas en aislamiento dice cuánto tarda una pantalla. Lo que le
// importa al dueño es OTRA cosa: cuántos segundos deja de entrar el GPS de
// toda la flota mientras esa pantalla se arma. Como SQLite es sincrónico y
// comparte hilo, la respuesta no se deduce — se mide poniendo las dos cosas
// a la vez.
async function pruebaDeCarga(DB, { empresa, HD, HG, HC }) {
  console.log('\n\nEL DAÑO REAL: ¿CUÁNTO SE FRENA LA INGESTA DE GPS?\n');
  const CHOFERES = 12;
  const sesiones = [];
  for (let i = 0; i < CHOFERES; i++) {
    const u = `CARGA-${i}`;
    await fetch(API + '/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...HG },
      body: JSON.stringify({ unitId: u, name: 'Carga ' + i, personRole: 'driver', password: 'cargacarga1' }),
    });
    const s = await login(u, 'cargacarga1');
    if (s.token) sesiones.push(s.token);
  }
  if (!sesiones.length) throw new Error('no se pudo crear ningún chofer de carga');
  console.log(`   ${sesiones.length} choferes reales reportando sin parar…`);

  let corriendo = true;
  const latencias = [];
  const bombear = async (token) => {
    while (corriendo) {
      const a = process.hrtime.bigint();
      try {
        await fetch(API + '/gps', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ posiciones: [{ lat: -15.49 + Math.random() * 0.01, lng: -70.13, speed: 20, timestamp: Date.now() }] }),
        });
      } catch {}
      latencias.push({ t: Date.now(), ms: Number(process.hrtime.bigint() - a) / 1e6 });
    }
  };
  const bombas = sesiones.map(bombear);

  const percentil = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };

  await sleep(4000);                       // calentar
  latencias.length = 0;
  await sleep(4000);                       // línea de base limpia
  const base = latencias.map(x => x.ms);
  console.log(`   línea de base del POST /gps: p50 ${percentil(base, 0.5).toFixed(0)} ms · ` +
    `p95 ${percentil(base, 0.95).toFixed(0)} ms · máx ${Math.max(...base).toFixed(0)} ms`);

  const pesados = listaDeCasos({ empresa, HD, HG, HC }, DB)
    .filter(([e]) => /metrics|resumen 90d|CSV tramos|creador \/empresas|admin\/routes$/.test(e));
  const filas = [];
  for (const [etq, ruta, headers] of pesados) {
    latencias.length = 0;
    const t0 = Date.now();
    const r = await fetch(API + ruta, { headers });
    await r.arrayBuffer();
    const dur = Date.now() - t0;
    await sleep(300);
    const durante = latencias.filter(x => x.t >= t0).map(x => x.ms);
    const pico = durante.length ? Math.max(...durante) : 0;
    filas.push([etq, dur, pico]);
    console.log(`   ${etq.padEnd(26)} tardó ${String(dur).padStart(6)} ms · ` +
      `el GPS esperó hasta ${pico.toFixed(0).padStart(6)} ms`);
  }
  corriendo = false;
  await Promise.all(bombas).catch(() => {});
  return filas;
}

// El sembrado sirve a cualquier herramienta que necesite una base del tamaño
// real —`arranque.js` mide el arranque contra ella—, y duplicarlo sería tener
// dos generadores que se van separando: el día que uno gane una columna y el
// otro no, las dos herramientas miden bases distintas y nadie se entera.
// Por eso se exporta, y el banco de abajo sólo corre si se lo invoca directo.
module.exports = { sembrar, UNIDADES_POR_RUTA };

if (require.main !== module) return;

// ── Correr ────────────────────────────────────────────────────────────
(async () => {
  const resultados = new Map();   // etiqueta → { tamaño → ms }
  const frecuencias = new Map();
  const bases = new Map();
  let cargaFilas = null;

  for (const UNIDADES of SERIE) {
    const { dir, DB, srv, mb } = await preparar(UNIDADES);
    bases.set(UNIDADES, mb);
    try {
      const cred = await credenciales(DB);
      if (!cred.HC) console.log('   (aviso: el panel del creador no contestó — se mide sin él)');
      const casos = listaDeCasos(cred, DB);
      console.log('');
      console.log('   endpoint                      tiempo     respuesta');
      console.log('   ' + '─'.repeat(56));
      for (const [etq, ruta, headers, frec] of casos) {
        const r = await medirRuta(ruta, headers);
        frecuencias.set(etq, frec);
        if (!resultados.has(etq)) resultados.set(etq, new Map());
        if (r.status >= 400) { console.log(`   ${etq.padEnd(28)}  HTTP ${r.status}`); continue; }
        resultados.get(etq).set(UNIDADES, r.ms);
        const marca = r.ms >= UMBRAL_GRAVE ? ' ‹‹ GRAVE' : r.ms >= UMBRAL_AVISO ? ' ‹ lento' : '';
        console.log(`   ${etq.padEnd(28)}${(r.ms.toFixed(0) + ' ms').padStart(9)}` +
          `${(r.kb.toFixed(0) + ' kB').padStart(11)}${marca}`);
      }
      if (CARGA) cargaFilas = await pruebaDeCarga(DB, cred);
    } finally {
      srv.kill();
      // Igual que arriba: el próximo tamaño no arranca hasta que éste soltó.
      await puertoLibre('el del tamaño anterior no se apagó');
      if (GUARDAR) console.log(`\n   base guardada en ${DB}`);
      else fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── La tabla que importa: el factor de crecimiento ──────────────────
  if (SERIE.length > 1) {
    const [chico, medio, grande] = [SERIE[0], SERIE[SERIE.length - 2], SERIE[SERIE.length - 1]];
    console.log('\n\nCÓMO CRECE CADA UNA (lo que importa no es el ms, es la curva)\n');
    console.log(`   endpoint                    ${String(chico).padStart(7)}${String(medio).padStart(9)}${String(grande).padStart(9)}   factor  forma`);
    console.log('   ' + '─'.repeat(76));
    const filas = [];
    for (const [etq, porTam] of resultados) {
      const a = porTam.get(medio), b = porTam.get(grande);
      if (!a || !b) continue;
      const factor = b / Math.max(a, 0.5);
      // La referencia es el crecimiento de la flota entre los dos tamaños:
      // si crece igual que la flota, es lineal.
      const lineal = grande / medio;
      const forma = factor >= lineal * 3.5 ? 'PEOR QUE CUADRÁTICO'
        : factor >= lineal * 1.9 ? 'CUADRÁTICO'
        : factor >= lineal * 1.25 ? 'peor que lineal'
        : 'lineal';
      filas.push({ etq, chico: porTam.get(chico), medio: a, grande: b, factor, forma });
    }
    // Ordenado por riesgo: la forma primero, el tamaño después
    const peso = (f) => ({ 'PEOR QUE CUADRÁTICO': 3, 'CUADRÁTICO': 2, 'peor que lineal': 1, 'lineal': 0 }[f]);
    filas.sort((x, y) => peso(y.forma) - peso(x.forma) || y.grande - x.grande);
    for (const f of filas) {
      console.log(`   ${f.etq.padEnd(26)}${(f.chico ? f.chico.toFixed(0) : '—').padStart(7)}` +
        `${f.medio.toFixed(0).padStart(9)}${f.grande.toFixed(0).padStart(9)}` +
        `${(f.factor.toFixed(1) + '×').padStart(9)}  ${f.forma}`);
    }
    console.log('   ' + '─'.repeat(76));
    console.log(`   la flota crece ${(grande / medio).toFixed(1)}× entre esos dos tamaños: ese factor ES lo lineal`);
    console.log('   tamaño de la base:  ' + SERIE.map(u => `${num(u)}→${num(bases.get(u))} MB`).join('  ·  '));
    const rojas = filas.filter(f => peso(f.forma) >= 2);
    if (rojas.length) {
      console.log(`\n   ${rojas.length} bandera(s) roja(s): ${rojas.map(f => f.etq).join(', ')}`);
      console.log('   Crecen peor que la flota. Hoy pueden no molestar; al triple de');
      console.log('   unidades sí, y no se ve venir mirando el ms de hoy.');
    } else {
      console.log('\n   Ninguna crece peor que la flota.');
    }
  }

  if (cargaFilas) {
    console.log('\n   El daño: el peor caso frena la ingesta de GPS de TODA la flota');
    console.log(`   durante ${Math.max(...cargaFilas.map(f => f[2])).toFixed(0)} ms.`);
  }
  process.exit(0);
})().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
