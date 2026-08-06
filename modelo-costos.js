#!/usr/bin/env node
// Modelo de carga y costos de COOP-R14 — acompaña a COSTOS.md.
//
//   node modelo-costos.js            → los tres escenarios (piloto / 500 / 2000)
//   node modelo-costos.js bench      → benchmark SQLite: escritura de 2000
//                                      unidades + lecturas de 20 paneles
//   node modelo-costos.js bench 8000 → benchmark forzando N unidades
//
// Todo parámetro vive en PARAMETROS/PRECIOS para que cambiar un supuesto sea
// tocar una línea. Los payloads NO son estimaciones: se midieron contra el
// servidor real levantado el 2026-08-05 (procedimiento en COSTOS.md).
//
// Hechos del código que gobiernan el modelo (verificados, con archivo:línea
// en COSTOS.md):
//  - NO hay polling HTTP: los paneles cargan al montar y al cambiar de
//    pestaña; todo lo vivo llega por WebSocket push.
//  - NO hay tabla de posiciones GPS: viven en un Map en memoria.
//  - El estado se emite POR RUTA cada STATE_INTERVAL_MS (3 s) a cada
//    cliente que mira esa ruta (choferes + panel). Un panel mira UNA ruta.
//  - La app nativa manda GPS por POST /gps cada 3 s (pantalla encendida) o
//    10 s (apagada), y CADA POST pasa por abrirTurno: 2 SELECT + 1 UPDATE
//    a shifts. Esa es la escritura dominante.

// ─── LO MEDIDO (bytes reales) ────────────────────────────────────────────
const MEDIDO = {
  wsGpsReq: 82,             // WS 'gps' (chofer web), cada 3 s
  stateBase: 310,           // sobre del estado…
  statePorUnidad: 455,      // …más esto por unidad en ruta (9410 B con 20)
  loginRes: 334,
  postGpsReq1: 81, postGpsRes: 59,   // POST /gps de 1 posición (lo normal)
  chatEcho: 202,            // rebote de un texto de 40 chars a cada miembro
  vozBytes: 27105,          // nota de voz de 12 s (opus→base64), rebotada
  panelCargaBytes: 13000,   // users+shifts+vueltas+routes al abrir pestañas
  htmlAppKB: 260,           // HTML+JS propio primera carga (sin librerías)
  libsKB: 450,              // React+ReactDOM+Babel+Leaflet+fuentes (1 vez)
  tileKB: 25,               // tile raster promedio
  tilesPrimeraCarga: 120,   // tiles que baja un chofer nuevo
};

// ─── PRECIOS PÚBLICOS (consultados 2026-08-05) ───────────────────────────
// Railway  https://railway.com/pricing   vCPU $20/mes · RAM $10/GB/mes ·
//          volumen $0.15/GB/mes · egress $0.05/GB  (fuentes secundarias
//          citan hasta $0.10/GB; se usa el oficial $0.05)
// Vercel   https://vercel.com/pricing    Pro $20/asiento/mes, 1 TB incluido;
//          Hobby prohíbe uso comercial
// Geoapify https://www.geoapify.com/pricing  free 3000 créditos/día
//          (12 000 tiles), API 10 $59/mes, API 25 $109/mes
const PRECIOS = {
  vcpuMes: 20, ramGBMes: 10, volumenGBMes: 0.15, egressGB: 0.05,
  vercelProMes: 20, geoapify: (tilesDia) =>
    tilesDia <= 12000 ? 0 : tilesDia <= 40000 ? 59 : 109,
};

// ─── PARÁMETROS DE OPERACIÓN (los inventados van a "Supuestos a validar") ─
const P = {
  horasOperacionDia: 16,        // 5:00–21:00
  gpsPostCadaSeg: 4,            // nativa: 3 s pantalla encendida / 10 s apagada → mezcla
  stateCadaSeg: 3,              // STATE_INTERVAL_MS
  unidadesPorRuta: 20,
  vueltasPorUnidadDia: 8,       // server/index.js:1245
  chatPorUnidadHora: 1.5,       // SUPUESTO
  vozPorUnidadDia: 2,           // SUPUESTO
  fotosPorUnidadDia: 0.3,       // SUPUESTO
  desviosPorUnidadDia: 1,       // SUPUESTO
  reconexionesPorUnidadHora: 4, // SUPUESTO (cortes de señal)
  panelesPorCoop: 1.5,          // Despacho fijo + gerencia a ratos (SUPUESTO)
  cambiosDePestanaPorPanelHora: 6, // única carga HTTP de los paneles (SUPUESTO)
  choferesNuevosPorDia: 0.03,   // 3% reinstala/limpia caché (SUPUESTO)
  diasMes: 30,
  puntaFactor: 3,
};

const ESCENARIOS = [
  { nombre: 'Piloto actual', unidades: 20, coops: 1 },
  { nombre: '500 unidades / 5 coops', unidades: 500, coops: 5 },
  { nombre: '2000 unidades / 20 coops', unidades: 2000, coops: 20 },
];

const GB = 1024 ** 3;
const fmt = (n, d = 2) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: d });

function modelo(esc) {
  const u = esc.unidades;
  const rutas = Math.ceil(u / P.unidadesPorRuta);
  const paneles = Math.round(esc.coops * P.panelesPorCoop);
  const horasSeg = P.horasOperacionDia * 3600;

  // ── requests/s promedio (horario de operación) ──
  const rps = {
    gpsPost: u / P.gpsPostCadaSeg,                      // POST /gps (nativa)
    stateEmisiones: rutas / P.stateCadaSeg,             // armados de estado (interno)
    panelCargas: paneles * P.cambiosDePestanaPorPanelHora * 4 / 3600,
    logins: (u * P.reconexionesPorUnidadHora) / 3600,
    chat: (u * P.chatPorUnidadHora) / 3600,
  };
  const rpsTotal = rps.gpsPost + rps.panelCargas + rps.logins + rps.chat;

  // ── escrituras/s a SQLite ──
  // abrirTurno en CADA POST /gps: la rama normal hace 1 UPDATE (lastSeenAt).
  // El resto: vueltas, chat (INSERT + 2 UPDATE de poda de media), audit
  // (INSERT + DELETE), turnos nuevos, desvíos.
  const wps = {
    abrirTurnoUpdate: u / P.gpsPostCadaSeg,
    laps: (u * P.vueltasPorUnidadDia) / horasSeg,
    mensajes: (u * P.chatPorUnidadHora) / 3600 * 3,     // P7+P8: 1 INSERT + 2 UPDATE
    voz: (u * P.vozPorUnidadDia) / horasSeg * 3,
    audit: (u * P.reconexionesPorUnidadHora) / 3600 * 2, // P9: INSERT + DELETE
    desvios: (u * P.desviosPorUnidadDia) / horasSeg * 2,
  };
  const wpsTotal = Object.values(wps).reduce((a, b) => a + b, 0);

  // ── crecimiento de la base (bruto) y estado estable con retención ──
  const fila = { lap: 120, chat: 260, voz: 27500, foto: 900000 * 4 / 3, desvio: 160, shift: 130, audit: 200 };
  const brutoDiaMB = (
    u * P.vueltasPorUnidadDia * fila.lap +
    u * P.chatPorUnidadHora * P.horasOperacionDia * fila.chat +
    u * P.vozPorUnidadDia * fila.voz +
    u * P.fotosPorUnidadDia * fila.foto * 0.02 +   // solo 20 fotos conservan data
    u * P.desviosPorUnidadDia * fila.desvio +
    u * 1.5 * fila.shift
  ) / 1024 ** 2;
  const establesGB = (
    u * P.vueltasPorUnidadDia * fila.lap * 120 +            // LAPS_DIAS
    u * P.chatPorUnidadHora * P.horasOperacionDia * fila.chat * 30 + // CHAT_DIAS
    30 * fila.voz + 20 * fila.foto +                        // VOICE/PHOTO_KEEP (global)
    u * P.desviosPorUnidadDia * fila.desvio * 120 +
    u * 1.5 * fila.shift * 365 +                            // shifts no se podan hoy
    esc.coops * 1000 * fila.audit                           // AUDIT_POR_EMPRESA
  ) / GB;

  // ── egress mensual del backend (GB) ──
  const stateBytes = MEDIDO.stateBase + P.unidadesPorRuta * MEDIDO.statePorUnidad;
  const clientesPorRuta = P.unidadesPorRuta + paneles / rutas;
  const egressDia = {
    wsState: rutas * (horasSeg / P.stateCadaSeg) * stateBytes * clientesPorRuta,
    chatYVoz: u * P.chatPorUnidadHora * P.horasOperacionDia * MEDIDO.chatEcho * P.unidadesPorRuta +
              u * P.vozPorUnidadDia * MEDIDO.vozBytes * P.unidadesPorRuta,
    gpsRespuestas: (horasSeg / P.gpsPostCadaSeg) * u * MEDIDO.postGpsRes,
    paneles: paneles * P.cambiosDePestanaPorPanelHora * P.horasOperacionDia * MEDIDO.panelCargaBytes,
    logins: (u * P.reconexionesPorUnidadHora * P.horasOperacionDia) * MEDIDO.loginRes,
    appPrimerasCargas: u * P.choferesNuevosPorDia * (MEDIDO.htmlAppKB + MEDIDO.libsKB) * 1024,
  };
  const egressMesGB = Object.fromEntries(
    Object.entries(egressDia).map(([k, v]) => [k, v * P.diasMes / GB]));
  const egressTotalGB = Object.values(egressMesGB).reduce((a, b) => a + b, 0);

  // Lo que le cuesta al CHOFER (datos móviles, no dinero nuestro): el estado
  // de su ruta durante un turno de 8 h + su GPS.
  const choferMBturno = (8 * 3600 / P.stateCadaSeg * stateBytes +
                         8 * 3600 / P.gpsPostCadaSeg * (MEDIDO.postGpsReq1 + 350)) / 1024 ** 2;

  // ── tiles Geoapify (cuota de terceros, no egress nuestro) ──
  const tilesDia = u * P.choferesNuevosPorDia * MEDIDO.tilesPrimeraCarga + u * 0.10 * 30;

  // ── cómputo presupuestado (el bench muestra que SQLite sobra; el techo
  //    es CPU de JSON+WS y margen de punta) ──
  const vcpu = u <= 100 ? 0.5 : u <= 600 ? 1 : 2;
  const ramGB = vcpu;
  const volumenGB = Math.max(1, Math.ceil(establesGB * 1.5));  // + respaldos rotados

  const costo = {
    vcpu: vcpu * PRECIOS.vcpuMes,
    ram: ramGB * PRECIOS.ramGBMes,
    volumen: volumenGB * PRECIOS.volumenGBMes,
    egress: egressTotalGB * PRECIOS.egressGB,
    vercel: PRECIOS.vercelProMes,
    terceros: PRECIOS.geoapify(tilesDia),
  };
  const total = Object.values(costo).reduce((a, b) => a + b, 0);
  const fijo = costo.vcpu + costo.ram + costo.vercel;
  return { esc, rutas, paneles, rps, rpsTotal, wps, wpsTotal, brutoDiaMB,
           establesGB, egressMesGB, egressTotalGB, choferMBturno, tilesDia,
           volumenGB, costo, total, fijo };
}

function imprimir() {
  for (const e of ESCENARIOS) {
    const r = modelo(e);
    console.log(`\n═══ ${r.esc.nombre} — ${r.esc.unidades} unidades · ${r.esc.coops} coop(s) · ${r.rutas} ruta(s) · ${r.paneles} panel(es) ═══`);
    console.log(`  req/s: ${fmt(r.rpsTotal, 1)} promedio · ${fmt(r.rpsTotal * P.puntaFactor, 1)} en punta (3x)`);
    console.log(`    POST /gps: ${fmt(r.rps.gpsPost, 1)}/s · logins: ${fmt(r.rps.logins, 2)}/s · chat: ${fmt(r.rps.chat, 2)}/s · paneles: ${fmt(r.rps.panelCargas, 3)}/s`);
    console.log(`  escrituras SQLite/s: ${fmt(r.wpsTotal, 1)} promedio · ${fmt(r.wpsTotal * P.puntaFactor, 1)} en punta`);
    console.log(`    abrirTurno (1 UPDATE por POST /gps): ${fmt(r.wps.abrirTurnoUpdate, 1)}/s ← la dominante`);
    console.log(`    vueltas: ${fmt(r.wps.laps, 2)}/s · mensajes(×3): ${fmt(r.wps.mensajes, 2)}/s · audit(×2): ${fmt(r.wps.audit, 2)}/s`);
    console.log(`  base: +${fmt(r.brutoDiaMB * P.diasMes / 1024, 2)} GB/mes bruto · régimen con retención ≈ ${fmt(r.establesGB, 2)} GB · volumen presupuestado ${r.volumenGB} GB`);
    console.log(`  egress/mes: ${fmt(r.egressTotalGB, 1)} GB`);
    for (const [k, v] of Object.entries(r.egressMesGB)) console.log(`    ${k}: ${fmt(v, 2)} GB`);
    console.log(`  datos móviles del chofer: ~${fmt(r.choferMBturno, 0)} MB por turno de 8 h (estado + GPS, sin tiles)`);
    console.log(`  tiles Geoapify: ~${fmt(r.tilesDia, 0)}/día (free hasta 12 000/día)`);
    console.log(`  COSTO/MES: $${fmt(r.total, 0)}`);
    console.log(`    vCPU $${fmt(r.costo.vcpu, 0)} · RAM $${fmt(r.costo.ram, 0)} · volumen $${fmt(r.costo.volumen, 2)} · egress $${fmt(r.costo.egress, 2)} · Vercel $${fmt(r.costo.vercel, 0)} · Geoapify $${fmt(r.costo.terceros, 0)}`);
    console.log(`    fijo $${fmt(r.fijo, 0)} (${fmt(r.fijo / r.total * 100, 0)}%) · variable $${fmt(r.total - r.fijo, 0)} (${fmt((1 - r.fijo / r.total) * 100, 0)}%)`);
  }
  const b2000 = modelo({ unidades: 2000, coops: 20 });
  const mas100 = modelo({ unidades: 2100, coops: 21 });
  const coopMarginal = mas100.total - b2000.total;
  console.log(`\n═══ MARGINALES (sobre 2000/20) ═══`);
  console.log(`  cooperativa de 100 unidades más (con su panel): $${fmt(coopMarginal, 2)}/mes`);
  console.log(`  unidad más (promedio dentro de esa coop): $${fmt(coopMarginal / 100, 3)}/mes`);
  console.log(`  (una unidad que INAUGURA ruta cuesta más que una que se suma a`);
  console.log(`   una existente: el estado de la ruta se emite entero a cada uno)`);
}

// ─── BENCHMARK ───────────────────────────────────────────────────────────
// El servidor real es UN proceso Node con better-sqlite3 SINCRÓNICO: las
// escrituras de las 2000 unidades y las lecturas de los 20 paneles se
// intercalan en el mismo hilo. La pregunta correcta no es "¿aguanta N
// transacciones concurrentes?" sino "¿cuánto del segundo se come el segundo
// de carga?" — cuando se acerca al 100%, ahí se rompe.
function bench(unidades = 2000) {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const Database = require(path.join(__dirname, 'server', 'node_modules', 'better-sqlite3'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-r14-'));
  const db = new Database(path.join(dir, 'bench.db'));
  try { db.pragma('journal_mode = WAL'); } catch {}
  console.log(`motor: better-sqlite3 · journal_mode=${db.pragma('journal_mode', { simple: true })} · ${unidades} unidades + 20 paneles`);

  db.exec(`
    CREATE TABLE shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, personId TEXT, vehicleId TEXT,
      routeId TEXT, role TEXT, startedAt INTEGER, lastSeenAt INTEGER, endedAt INTEGER);
    CREATE TABLE laps (id INTEGER PRIMARY KEY AUTOINCREMENT, unitId TEXT NOT NULL, routeId TEXT,
      startedAt INTEGER NOT NULL, finishedAt INTEGER NOT NULL, durationSec INTEGER NOT NULL,
      avgSpeed INTEGER NOT NULL, variantId INTEGER, brechaProm INTEGER, objetivoSec INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, unitId TEXT,
      driverName TEXT, text TEXT, duration INTEGER, data TEXT, lat REAL, lng REAL,
      routeId TEXT, companyId TEXT, privado INTEGER, timestamp INTEGER NOT NULL);
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT,
      target TEXT, detail TEXT, routeId TEXT, companyId TEXT, timestamp INTEGER);
  `);

  // La base al tamaño de régimen: 120 días de vueltas (tope LAPS_MAX_FILAS)
  const vueltas = Math.min(unidades * 8 * 120, 3_000_000);
  process.stdout.write(`poblando ${fmt(vueltas, 0)} vueltas de régimen… `);
  const insLap = db.prepare('INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec) VALUES (?,?,?,?,?,?,?,?)');
  const ahora = Date.now();
  let t0 = Date.now();
  db.transaction(() => {
    for (let i = 0; i < vueltas; i++) {
      const fin = ahora - Math.floor(Math.random() * 120 * 86400_000);
      insLap.run('M-' + (i % unidades), 'R-' + (i % Math.ceil(unidades / 20)), fin - 2700_000, fin, 2700, 24, 300 + (i % 300), 480);
    }
    for (let i = 0; i < unidades; i++) {
      db.prepare('INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt) VALUES (?,?,?,?,?,?)')
        .run('M-' + i, 'M-' + i, 'R-' + (i % Math.ceil(unidades / 20)), 'driver', ahora, ahora);
    }
  })();
  // Los índices que tiene la base real (server/index.js:991 y :1117), y solo
  // esos: laps NO tiene índice por finishedAt — igual que producción.
  db.exec('CREATE INDEX idx_shifts_persona ON shifts (personId, startedAt)');
  console.log(`${fmt((Date.now() - t0) / 1000, 1)} s · ${fmt(fs.statSync(path.join(dir, 'bench.db')).size / 1024 ** 2, 0)} MB en disco`);

  const updVivo = db.prepare('UPDATE shifts SET lastSeenAt = ? WHERE personId = ? AND endedAt IS NULL');
  const selPrevio = db.prepare('SELECT id FROM shifts WHERE personId = ? AND vehicleId = ? AND endedAt IS NOT NULL AND endedAt > ? ORDER BY id DESC LIMIT 1');
  const selAbierto = db.prepare('SELECT id FROM shifts WHERE personId = ? AND endedAt IS NULL ORDER BY id DESC LIMIT 1');
  const insChat = db.prepare("INSERT INTO messages (kind, unitId, text, timestamp) VALUES ('chat', ?, ?, ?)");
  const podaMedia = db.prepare("UPDATE messages SET data = NULL WHERE kind = 'voice' AND data IS NOT NULL AND id NOT IN (SELECT id FROM messages WHERE kind = 'voice' ORDER BY id DESC LIMIT 30)");
  const insAudit = db.prepare("INSERT INTO audit (actor, action, timestamp) VALUES (?, 'login', ?)");
  const podaAudit = db.prepare('DELETE FROM audit WHERE companyId IS NULL AND id NOT IN (SELECT id FROM audit WHERE companyId IS NULL ORDER BY id DESC LIMIT 1000)');
  const qVueltas = db.prepare('SELECT id, unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec FROM laps WHERE finishedAt >= ? ORDER BY finishedAt DESC LIMIT 300');
  const qAyer = db.prepare('SELECT durationSec FROM laps WHERE finishedAt >= ? AND finishedAt < ?');
  const qTurnos = db.prepare('SELECT * FROM shifts WHERE endedAt IS NULL LIMIT 500');

  // UN segundo de operación con `unidades` × factor, partido en dos: la
  // ESCRITURA sostenida (GPS y compañía) y las LECTURAS de panel (que en la
  // base real, sin índice por finishedAt, barren la tabla laps entera).
  const escrituraSeg = (factor) => {
    const n = Math.round(unidades * factor);
    const posts = Math.ceil(n / 4);            // POST /gps cada ~4 s
    const chats = Math.ceil(n * 1.5 / 3600) || 1;
    const logins = Math.ceil(n * 4 / 3600) || 1;
    const vueltasSeg = Math.ceil(n * 8 / (16 * 3600)) || 1;
    const t = process.hrtime.bigint();
    for (let i = 0; i < posts; i++) {          // abrirTurno por POST /gps
      const quien = 'M-' + (i % unidades);
      selPrevio.get(quien, quien, Date.now() - 300000);
      selAbierto.get(quien);
      updVivo.run(Date.now(), quien);
    }
    for (let i = 0; i < vueltasSeg; i++) insLap.run('M-' + (i % unidades), 'R-1', Date.now() - 2700_000, Date.now(), 2700, 24, 310, 480);
    for (let i = 0; i < chats; i++) { insChat.run('M-' + (i % unidades), 'Nos vemos en el paradero de la 14', Date.now()); podaMedia.run(); podaMedia.run(); }
    for (let i = 0; i < logins; i++) { insAudit.run('M-' + (i % unidades), Date.now()); podaAudit.run(); }
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  const lecturaPanel = () => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const t = process.hrtime.bigint();
    qVueltas.all(hoy.getTime());
    qAyer.all(hoy.getTime() - 86400_000, hoy.getTime());
    qTurnos.all();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };

  const mediana = (fn, veces = 5) => {
    const m = []; for (let s = 0; s < veces; s++) m.push(fn());
    return m.sort((a, b) => a - b)[Math.floor(veces / 2)];
  };

  console.log('\nESCRITURA sostenida — cuánto del segundo se come un segundo de carga:');
  for (const [nombre, factor] of [['1x  (promedio)', 1], ['3x  (punta)', 3], ['10x', 10], ['30x', 30], ['100x', 100]]) {
    const ms = mediana(() => escrituraSeg(factor));
    console.log(`  ${nombre} ≈ ${fmt(unidades * factor, 0)} unidades: ${fmt(ms, 1)} ms (${fmt(ms / 10, 1)}% del segundo)`);
  }
  console.log('\nLECTURA de panel (abrir la pestaña de vueltas, base de régimen):');
  const sinIdx = mediana(lecturaPanel);
  console.log(`  sin índice en laps(finishedAt) — como producción hoy: ${fmt(sinIdx, 1)} ms por carga`);
  db.exec('CREATE INDEX idx_laps_fin ON laps (finishedAt)');
  const conIdx = mediana(lecturaPanel);
  console.log(`  con el índice: ${fmt(conIdx, 1)} ms por carga (${fmt(sinIdx / conIdx, 0)}x)`);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

if (process.argv[2] === 'bench') bench(Number(process.argv[3]) || 2000);
else imprimir();
