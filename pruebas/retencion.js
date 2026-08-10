// Cuánto historial se guarda, y que el tamaño de la flota no lo decida.
//
// Los topes eran de FILAS y globales: las últimas 2000 vueltas y los últimos
// 1000 mensajes de toda la base. Con seis combis y una ruta eso es historial
// de meses y funcionaba bien. Con 2000 unidades es otra cosa:
//
//   - 2000 unidades cierran unas 16 000 vueltas por día, así que 2000 filas
//     cubrían **tres horas**: el informe de la semana pasada habría salido
//     vacío y el objetivo automático se habría quedado sin promedio.
//   - Cada cliente recibe hasta 200 mensajes DE SU RUTA al conectarse, así
//     que 40 rutas necesitan 8000 filas solo para que nadie abra el chat en
//     blanco — y el tope era 1000. Peor: **en esa misma tabla viven los SOS**,
//     y una tarde de chat activo borraba las emergencias del mes.
//
// Un tope en filas significa cosas distintas según el tamaño del cliente, que
// es justo lo que un tope no debería hacer. En días significa lo mismo
// siempre. Esta suite fija eso: qué sobrevive y qué no, con los cortes
// puestos a mano para no esperar cuatro meses.
//
// Se prueba con DOS arranques porque la poda corre al arrancar y cada 6 h: se
// siembra contra un servidor, se lo apaga, y el siguiente tiene que dejar la
// base como corresponde.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/retencion-test.db';
const P = 3161;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const dias = (n) => Date.now() - n * 86400_000;

async function arrancar() {
  const srv = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let salida = '';
  srv.stderr.on('data', d => { salida += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return srv; } catch {}
  }
  srv.kill();
  throw new Error('el servidor no arrancó: ' + salida.slice(0, 300));
}

async function apagar(srv) {
  srv.kill();
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    try { await fetch(`http://localhost:${P}/ping`); } catch { return; }
  }
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

  // Primer arranque: crea el esquema. Después se siembra a mano, porque para
  // tener una vuelta de hace cuatro meses no hay forma de esperar.
  let srv = await arrancar();
  await apagar(srv);

  {
    const b = new Database(DB);
    const vuelta = b.prepare(
      `INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm)
       VALUES (?, 'R-14', ?, ?, 3000, 22, 120)`);
    vuelta.run('M-VIEJA', dias(200), dias(200));
    vuelta.run('M-LIMITE', dias(119), dias(119));   // justo adentro de los 120
    vuelta.run('M-NUEVA', dias(3), dias(3));

    const msg = b.prepare(
      `INSERT INTO messages (kind, unitId, driverName, routeId, text, timestamp)
       VALUES (?, 'M-01', 'Alguien', 'R-14', ?, ?)`);
    msg.run('chat', 'charla de hace dos meses', dias(60));
    msg.run('chat', 'charla de ayer', dias(1));
    msg.run('sos', 'emergencia de hace tres meses', dias(90));
    msg.run('sos', 'emergencia de hace dos años', dias(730));

    const desvio = b.prepare(
      `INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, cierre)
       VALUES (?, 'R-14', ?, ?, 600, 400, 300, 'regreso')`);
    desvio.run('M-VIEJA', dias(200), dias(200));
    desvio.run('M-NUEVA', dias(5), dias(5));

    // Los TURNOS eran la única tabla de historial sin poda: crecían para
    // siempre y nadie lo veía, porque su lectura filtra por fecha y sale
    // rápida igual. Se guardan MÁS que las vueltas —un año— porque con
    // ellos se liquidan horas, y un reclamo por una liquidación llega
    // bastante después que una discusión por una vuelta.
    const turno = b.prepare(
      `INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt)
       VALUES (?, ?, 'R-14', 'driver', ?, ?, ?)`);
    turno.run('P-VIEJO', 'M-01', dias(400), dias(400), dias(400));
    turno.run('P-LIMITE', 'M-01', dias(360), dias(360), dias(360));
    turno.run('P-NUEVO', 'M-01', dias(2), dias(2), dias(2));
    // Uno ABIERTO y reciente: alguien que está arriba de la combi ahora.
    // La poda sólo toca los cerrados, así que su turno en curso sobrevive.
    //
    // (Uno abierto y VIEJO no se prueba acá porque no llega: el arranque
    // cierra todos los turnos abiertos antes de que la poda corra, así que
    // para cuando ésta mira ya tiene fecha de fin. La guarda de
    // `endedAt IS NOT NULL` es para la poda de las 6 h con el servidor en
    // marcha, que es cuando de verdad hay gente arriba.)
    b.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt)
               VALUES ('P-ABIERTO', 'M-01', 'R-14', 'driver', ?, ?, NULL)`)
      .run(dias(0), dias(0));
    b.close();
  }

  // Segundo arranque: acá poda
  srv = await arrancar();
  await apagar(srv);

  const b = new Database(DB, { readonly: true });
  const vueltas = b.prepare('SELECT unitId FROM laps ORDER BY unitId').all().map(x => x.unitId);
  const mensajes = b.prepare('SELECT kind, text FROM messages ORDER BY timestamp').all();
  const desvios = b.prepare('SELECT vehicleId FROM deviations').all().map(x => x.vehicleId);
  const turnos = b.prepare('SELECT personId FROM shifts').all().map(x => x.personId);
  b.close();

  console.log('\nLAS VUELTAS SE GUARDAN POR TIEMPO, NO POR CANTIDAD');
  {
    // 120 días cubren con margen los 90 que es el rango máximo de un informe.
    ok('la vuelta de hace 200 días se fue', !vueltas.includes('M-VIEJA'), vueltas);
    ok('la de hace 119 se queda — el corte son 120, no "las últimas N"',
       vueltas.includes('M-LIMITE'), vueltas);
    ok('y la reciente por supuesto', vueltas.includes('M-NUEVA'), vueltas);
  }

  console.log('\nEL SOS NO ES UN MENSAJE MÁS');
  {
    // Los dos viven en la misma tabla, y con un tope único de filas una tarde
    // de chat activo borraba las emergencias del mes. Un "¿espero en el
    // paradero?" de hace dos meses no le importa a nadie; un accidente sí.
    const textos = mensajes.map(m => m.text);
    ok('la charla de hace dos meses se fue', !textos.includes('charla de hace dos meses'), textos);
    ok('la de ayer se queda', textos.includes('charla de ayer'), textos);
    ok('el SOS de hace tres meses SIGUE ahí, aunque el chat de ese día no',
       textos.includes('emergencia de hace tres meses'), textos);
    ok('y el de hace dos años ya no', !textos.includes('emergencia de hace dos años'), textos);

    // Lo que esto defiende de verdad: que el informe de emergencias y el
    // contador del gerente —90 días— tengan de dónde salir.
    const sosEnNoventaDias = mensajes.filter(m => m.kind === 'sos').length;
    ok('queda SOS para el informe de 90 días', sosEnNoventaDias >= 1, sosEnNoventaDias);
  }

  console.log('\nLOS DESVÍOS SIGUEN LA MISMA REGLA');
  {
    ok('el de hace 200 días se fue', !desvios.includes('M-VIEJA'), desvios);
    ok('el de hace 5 se queda', desvios.includes('M-NUEVA'), desvios);
  }

  console.log('\nLOS TURNOS TAMBIÉN, PERO CON SU PROPIO PLAZO');
  {
    // Eran la ÚNICA tabla de historial sin poda. Con ellos se liquidan
    // horas, así que se guardan un año y no 120 días.
    ok('el turno de hace 400 días se fue', !turnos.includes('P-VIEJO'), turnos);
    ok('el de hace 360 se queda — el corte es un año, no 120 días',
       turnos.includes('P-LIMITE'), turnos);
    ok('y el reciente por supuesto', turnos.includes('P-NUEVO'), turnos);
    // El que sigue arriba de la combi conserva su turno en curso: la poda
    // sólo toca los cerrados, para no partirle las horas del día.
    ok('el turno EN CURSO no se toca', turnos.includes('P-ABIERTO'), turnos);
  }

  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  process.exit(1);
});
