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

  // Compresión del WS, medida en la suite `compresion` contra el servidor
  // real (2026-08-24): 3658 B/estado sin comprimir → 368 B comprimido.
  // OJO A QUIÉN SE LE APLICA: `permessage-deflate` lo negocia el CLIENTE, y
  // sólo los navegadores lo ofrecen. La app nativa abre un WebSocket plano
  // (`app/protocolo/cliente.js:117`) y recibe `state` sin comprimir
  // (`:191`). Como los choferes son ~20 de las ~21 conexiones de una ruta,
  // el −90 % toca la fracción chica del egress, no la que domina.
  factorCompresion: 368 / 3658,
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

  // Para pasar el costo a la unidad en que se cobra. El tipo de cambio es un
  // SUPUESTO con fecha: si se mueve, se toca acá y todo el margen se recalcula.
  solesPorDolar: 3.75,        // aprox., 2026-08
};

// Lo que se COBRA. Sin esto el modelo dice cuánto sale y no si conviene, que
// es la pregunta de verdad.
const VENTA = {
  solesPorUnidadDia: 0.30,
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

  // ── EL SUPUESTO QUE MÁS PESA DE TODO EL MODELO ──────────────────────
  // Qué fracción del turno el chofer tiene la app ADELANTE con la pantalla
  // encendida. Gobierna el egress del estado, que es el 90 % del costo
  // variable, porque **bloquear la pantalla tira el WebSocket**: Android
  // suspende el JavaScript y el socket se cae (medido en un teléfono real,
  // `server/index.js:2231-2237`). Con la pantalla apagada el chofer no
  // recibe estado: sólo postea GPS y la brecha le vuelve en la respuesta
  // del mismo POST, que son 59 bytes contra ~3600.
  //
  // El modelo viejo asumía, sin decirlo, que las 20 combis de una ruta
  // mantenían WS las 16 horas. Eso es el caso PEOR, no el normal: el diseño
  // de la app es justamente que el chofer maneje con la pantalla apagada.
  // Manejar mirando el celular no es lo que queremos que hagan.
  //
  // 0,25 es un SUPUESTO (mira la app en paradas y semáforos). El número
  // bueno sale de la calle, y es lo primero que hay que medir en el piloto:
  // mueve el costo total más que cualquier otra palanca de este archivo.
  fraccionPantallaEncendida: 0.25,

  // Qué fracción de los tiles cae dentro de una zona del mapa propio y se
  // sirve desde nuestro servidor en vez de Geoapify. Un chofer trabaja
  // SIEMPRE sobre su ruta, así que si la ciudad está extraída la cobertura es
  // casi total; lo que se escapa es el que se aleja del área o hace zoom
  // afuera. **Vale 0 si `TILES_RELEASE_URL` no está configurada en el
  // despliegue**: sin zonas cargadas la cascada cae entera a Geoapify.
  coberturaMapaPropio: 0.9,     // SUPUESTO — verificar que el mapa propio esté desplegado
};

const ESCENARIOS = [
  { nombre: 'Piloto actual', unidades: 20, coops: 1 },
  { nombre: '500 unidades / 5 coops', unidades: 500, coops: 5 },
  { nombre: '2000 unidades / 20 coops', unidades: 2000, coops: 20 },
  // El margen que hay que garantizar: el objetivo es llegar a 2000 con techo
  // para 5000 sin rediseñar.
  { nombre: '5000 unidades / 50 coops', unidades: 5000, coops: 50 },
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

  // El estado se emite por ruta, pero NO todos lo reciben ni todos lo reciben
  // igual. Dos correcciones sobre el modelo original, las dos verificadas en
  // el código y las dos en la misma dirección (el costo real es menor):
  //
  //  1. Los choferes sólo reciben estado mientras tienen la app adelante:
  //     con la pantalla bloqueada el WebSocket se cae y la brecha les vuelve
  //     en la respuesta del POST /gps (59 B). Ver `fraccionPantallaEncendida`.
  //  2. Los que reciben comprimen o no según QUIÉN son: el navegador negocia
  //     `permessage-deflate` (−90 %), la app nativa no lo ofrece y recibe el
  //     estado entero.
  //
  // Los paneles son navegador y están todo el turno: comprimen y no se van.
  const emisionesDia = rutas * (horasSeg / P.stateCadaSeg);
  const choferesConectados = P.unidadesPorRuta * P.fraccionPantallaEncendida;
  const panelesPorRuta = paneles / rutas;
  const egressDia = {
    // Choferes: app nativa, SIN comprimir, sólo con la pantalla encendida.
    wsStateChoferes: emisionesDia * stateBytes * choferesConectados,
    // Paneles: navegador, CON compresión, todo el turno.
    wsStatePaneles: emisionesDia * stateBytes * MEDIDO.factorCompresion * panelesPorRuta,
    chatYVoz: u * P.chatPorUnidadHora * P.horasOperacionDia * MEDIDO.chatEcho * P.unidadesPorRuta +
              u * P.vozPorUnidadDia * MEDIDO.vozBytes * P.unidadesPorRuta,
    gpsRespuestas: (horasSeg / P.gpsPostCadaSeg) * u * MEDIDO.postGpsRes,
    paneles: paneles * P.cambiosDePestanaPorPanelHora * P.horasOperacionDia * MEDIDO.panelCargaBytes,
    logins: (u * P.reconexionesPorUnidadHora * P.horasOperacionDia) * MEDIDO.loginRes,
    appPrimerasCargas: u * P.choferesNuevosPorDia * (MEDIDO.htmlAppKB + MEDIDO.libsKB) * 1024,
  };
  const egressMesGB = Object.fromEntries(
    Object.entries(egressDia).map(([k, v]) => [k, v * P.diasMes / GB]));

  // Lo que le cuesta al CHOFER (datos móviles, no dinero nuestro): el estado
  // de su ruta durante un turno de 8 h + su GPS.
  // Sólo recibe estado mientras la pantalla está encendida; el resto del
  // turno paga nada más su GPS. Con el modelo viejo (WS las 8 h) el número
  // salía ~4× más alto, y es el que se usó para decir "89 MB por turno".
  const choferMBturno = (8 * 3600 / P.stateCadaSeg * stateBytes * P.fraccionPantallaEncendida +
                         8 * 3600 / P.gpsPostCadaSeg * (MEDIDO.postGpsReq1 + 350)) / 1024 ** 2;

  // ── MAPAS: la cascada de tres niveles ────────────────────────────────
  // Los tiles NO salen todos de Geoapify. `project/Prototipo.html:278`
  // (`CapaCascada`) los busca en este orden:
  //
  //   1. caché del service worker — cache-first, sin expiración, tope 600
  //      tiles. Es lo que hace que un chofer que repite la misma ruta todos
  //      los días baje el mapa UNA vez. No cuesta nada a nadie.
  //   2. mapa propio, servido por NUESTRO servidor (`/tiles/xyz/{zona}/…`),
  //      para los tiles que caen dentro de una zona extraída. Sale gratis de
  //      cuota pero se paga como egress propio.
  //   3. Geoapify, sólo para lo que queda afuera de toda zona.
  //
  // O sea que el rubro depende de si el mapa propio está DESPLEGADO: si
  // `TILES_RELEASE_URL` no está configurada no hay zonas, `zonaDeTile()`
  // devuelve null para todo y la cascada cae entera al nivel 3. Ése es el
  // interruptor que mueve este renglón, y es de configuración, no de código.
  const tilesFrescosDia = u * P.choferesNuevosPorDia * MEDIDO.tilesPrimeraCarga +
                          u * 0.10 * 30;   // el resto lo sirve el caché del teléfono
  const tilesDia = tilesFrescosDia * (1 - P.coberturaMapaPropio);
  const tilesPropiosDia = tilesFrescosDia * P.coberturaMapaPropio;
  // Los tiles propios no pagan cuota pero sí egress nuestro.
  const egressTilesGB = tilesPropiosDia * MEDIDO.tileKB * 1024 * P.diasMes / GB;
  // El mapa propio cambia de bolsillo, no desaparece: sale de la cuota de
  // Geoapify y entra como egress nuestro. Por eso se suma acá y no se olvida.
  egressMesGB.tilesPropios = egressTilesGB;
  const egressTotalGB = Object.values(egressMesGB).reduce((a, b) => a + b, 0);

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

  // ── LA UNIDAD EN QUE SE COBRA ──────────────────────────────────────
  // El costo en dólares al mes no se compara con nada; el precio es en soles
  // por unidad por día. Traducirlo es lo que convierte este archivo en una
  // decisión de negocio y no en una tabla de infraestructura.
  const costoSolesUnidadDia = (total * PRECIOS.solesPorDolar) / u / P.diasMes;
  const margenSolesUnidadDia = VENTA.solesPorUnidadDia - costoSolesUnidadDia;
  const margenPct = margenSolesUnidadDia / VENTA.solesPorUnidadDia * 100;
  const ingresoMes = VENTA.solesPorUnidadDia * u * P.diasMes;
  // Por rubro, en céntimos por unidad por día: dice DÓNDE se va el costo en
  // la misma unidad en la que se cobra, que es la única forma de saber si una
  // palanca vale la pena.
  const costoPorRubro = Object.fromEntries(Object.entries(costo).map(
    ([k, v]) => [k, v * PRECIOS.solesPorDolar / u / P.diasMes]));

  return { esc, rutas, paneles, rps, rpsTotal, wps, wpsTotal, brutoDiaMB,
           establesGB, egressMesGB, egressTotalGB, choferMBturno, tilesDia,
           volumenGB, costo, total, fijo,
           costoSolesUnidadDia, margenSolesUnidadDia, margenPct, ingresoMes,
           costoPorRubro };
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
  // ── EL MARGEN: la tabla que decide si el negocio cierra ──────────────
  const R = ESCENARIOS.map(modelo);
  // Los montos van con decimales FIJOS: `fmt` se come los ceros finales y
  // "S/ 0.3" al lado de "S/ 0.228" se lee mal justo en la tabla que decide.
  const sol = (n, d = 3) => 'S/ ' + n.toFixed(d);
  const pct = (n) => n.toFixed(1) + ' %';
  const caja = (texto) => {
    const ancho = 70;
    console.log('\n\n╔' + '═'.repeat(ancho) + '╗');
    console.log('║  ' + texto.padEnd(ancho - 2) + '║');
    console.log('╚' + '═'.repeat(ancho) + '╝\n');
  };
  caja(`MARGEN — se cobra ${sol(VENTA.solesPorUnidadDia, 2)} por unidad por día`);
  console.log(`   escenario        ingreso/mes      costo/mes    costo u./día    MARGEN`);
  console.log(`   ` + '─'.repeat(70));
  for (const r of R) {
    console.log('   ' + String(r.esc.unidades).padStart(5) + ' u.  ' +
      ('S/ ' + fmt(r.ingresoMes, 0)).padStart(14) +
      ('$' + fmt(r.total, 0)).padStart(14) +
      sol(r.costoSolesUnidadDia).padStart(15) +
      pct(r.margenPct).padStart(11));
  }

  const g = R[R.length - 1];
  console.log(`\n   Dónde se va el costo a ${g.esc.unidades} unidades (céntimos por unidad por día):`);
  for (const [k, v] of Object.entries(g.costoPorRubro).sort((a, b) => b[1] - a[1])) {
    if (v * 100 < 0.05) continue;
    console.log(`     ${k.padEnd(10)} ${fmt(v * 100, 2).padStart(6)} cts` +
      `   ${'█'.repeat(Math.max(1, Math.round(v / g.costoSolesUnidadDia * 30)))}`);
  }

  // El supuesto que más pesa, mostrado como rango en vez de como un número
  // solo: es más honesto y es lo que hay que salir a medir al piloto.
  console.log(`\n   SENSIBILIDAD al supuesto que más pesa (fracción del turno con`);
  console.log(`   la pantalla encendida — hoy asumido ${fmt(P.fraccionPantallaEncendida * 100, 0)} %):\n`);
  const guardado = P.fraccionPantallaEncendida;
  for (const f of [0.10, 0.25, 0.50, 1.00]) {
    P.fraccionPantallaEncendida = f;
    const m = modelo(ESCENARIOS[ESCENARIOS.length - 1]);
    console.log(`     ${fmt(f * 100, 0).padStart(3)} % encendida →  costo ${sol(m.costoSolesUnidadDia)}/u./día` +
      `   margen ${pct(m.margenPct).padStart(7)}` +
      (m.margenPct < 0 ? '   ← PIERDE PLATA' : ''));
  }
  P.fraccionPantallaEncendida = guardado;

  // El otro interruptor: el mapa propio no es código, es configuración del
  // despliegue. Si `TILES_RELEASE_URL` no está puesta, la cascada cae entera
  // a Geoapify y ese renglón deja de ser cero.
  console.log(`\n   EL MAPA PROPIO (¿está \`TILES_RELEASE_URL\` puesta en producción?):\n`);
  const guardadoMapa = P.coberturaMapaPropio;
  for (const [cob, etq] of [[0, 'sin desplegar — todo a Geoapify'], [0.9, 'desplegado (supuesto actual)']]) {
    P.coberturaMapaPropio = cob;
    const m = modelo(ESCENARIOS[ESCENARIOS.length - 1]);
    console.log(`     ${etq.padEnd(34)} Geoapify $${fmt(m.costo.terceros, 0).padStart(3)}/mes` +
      `   ${fmt(m.tilesDia, 0).padStart(7)} tiles/día` +
      `   margen ${pct(m.margenPct)}`);
  }
  P.coberturaMapaPropio = guardadoMapa;

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
