// Lo que el servidor mandaba y ninguna pantalla mostraba (REVISION-2026-09-10.md,
// E16), mirado en un navegador de verdad.
//
// Y de paso la otra mitad de E12, que también es de pantalla: Turnos pintaba
// sólo `hhmm(startedAt)`, así que «esta semana» eran hasta 500 filas que
// decían «08:12» sin decir de qué día.
//
// `/gerencia/resumen` ya viajaba con la lista de SOS (con persona y tipo), la
// de salidas del recorrido, las rutas con su objetivo, y la duración promedio,
// la mejor y la velocidad de cada unidad. Nada de eso se dibujaba: el gerente
// veía cuántas vueltas hizo cada combi y no cuánto tarda, y «hubo tres SOS»
// era un número sin nombres. Y en Vueltas, `lastFinish` —cuándo cerró su
// última vuelta cada combi— se convertía en la DURACIÓN de esa vuelta, que no
// contesta «¿desde cuándo esta combi no trabaja?».
//
// Va con navegador porque todo esto se arma en tiempo de ejecución: leer el
// HTML probaría la plantilla, no lo que se ve.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/numeros-ui-test.db';
const P = 3198;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined && c !== true ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null, browser = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(`http://localhost:${P}/ping`); break; } catch {} }
  execFileSync('node', [RAIZ + '/server/empresa.js', 'gerencia', 'R14', 'GERENTE-1', 'claveGerente1'],
    { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });

  // Anclado a la medianoche de hoy y comprimido a minutos, como `numeros`:
  // así la suite no depende de la hora a la que se corra.
  const medianoche = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const hoy = (h) => medianoche + h * 60_000;
  const w = new Database(DB);
  const companyId = w.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  w.prepare("UPDATE routes SET durationMin = 50, targetGapMin = 6, autoTarget = 0 WHERE routeId = 'R-14'").run();
  // Tres vueltas de la misma combi, de distinta duración: promedio 40 min,
  // mejor 30, velocidad promedio 20 km/h.
  const vuelta = w.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, parcial, objetivoSec)
                            VALUES ('M-01', 'R-14', ?, ?, ?, ?, 360, 0, 360)`);
  vuelta.run(hoy(8), hoy(9), 1800, 24);
  vuelta.run(hoy(10), hoy(11), 2400, 20);
  vuelta.run(hoy(12), hoy(13), 3000, 16);
  const turno = w.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt)
                           VALUES (?, ?, 'R-14', ?, ?, ?, ?)`);
  turno.run('M-01', 'M-01', 'driver', hoy(7), hoy(14), hoy(14));
  // Para la lista de Turnos: uno de anteayer y uno que CRUZA la medianoche.
  // Éstos van con horas de verdad —no comprimidas— porque lo que se mira es
  // justamente de qué día es cada fila.
  const H = 3600_000, DIA = 86400_000;
  turno.run('M-02', 'M-02', 'collector', medianoche - DIA + 22 * H, medianoche + 1 * H, medianoche + 1 * H);
  turno.run('M-03', 'M-03', 'driver', medianoche - 3 * DIA + 9 * H, medianoche - 3 * DIA + 15 * H, medianoche - 3 * DIA + 15 * H);
  // Acciones de auditoría de las que se mostraban como slug crudo (E17)
  const anotar = w.prepare(`INSERT INTO audit (actor, action, target, detail, timestamp, routeId, companyId)
                            VALUES (?, ?, ?, ?, ?, 'R-14', ?)`);
  anotar.run('sistema', 'entrada_tardia', 'M-01', 'entró al 40 %', hoy(15), companyId);
  anotar.run('sistema', 'gps_sospechoso', 'M-01', 'clavado en el trazado', hoy(16), companyId);
  anotar.run('M-01', 'cerrar_todo', 'M-01', '3 sesión(es)', hoy(17), companyId);
  anotar.run('GERENTE-1', 'objetivo', 'R-14', 'a mano: 6 min', hoy(18), companyId);

  // Un SOS con tipo y otro sin: el genérico es como nace cada uno y no se le
  // inventa una causa.
  const sos = w.prepare(`INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, sosTipo, lat, lng, timestamp)
                         VALUES ('sos', 'M-01', 'Rufino Quispe', 'R-14', 'M-01', ?, -15.49, -70.13, ?)`);
  sos.run('mecanica', hoy(9));
  sos.run(null, hoy(11));
  // Dos salidas del recorrido: una de verdad y una SILENCIADA por Despacho,
  // que no cuenta como salida y tiene que verse distinta (E7).
  const desvio = w.prepare(`INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre)
                            VALUES ('M-01', 'R-14', ?, ?, ?, ?, 300, ?, ?)`);
  desvio.run(hoy(9), hoy(9) + 240_000, 240, 480, 0, 'regreso');
  desvio.run(hoy(12), hoy(12) + 120_000, 120, 350, 1, 'regreso');
  w.close();

  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await interceptarHttps(ctx);
  const errores = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });

  await p.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const inputs = await p.$$('input');
  await inputs[0].fill('GERENTE-1');
  await p.fill('input[type="password"]', 'claveGerente1');
  await p.click('button:has-text("INGRESAR")');
  await p.waitForTimeout(3500);
  await p.click('button:has-text("Gestión")');
  await p.waitForTimeout(1200);
  await p.click('button:has-text("Números")');
  await p.waitForTimeout(3000);

  const texto = () => p.evaluate(() => document.body.innerText);

  console.log('\nCUÁNTO TARDA, NO SÓLO CUÁNTAS HIZO');
  {
    const t = await texto();
    ok('la pantalla monta con el cuadro por unidad', /M-01/.test(t));
    ok('hay columna de duración y de velocidad',
       /Duración/i.test(t) && /Vel\. prom\./i.test(t),
       t.split('\n').filter(l => /Duración|Vel\./.test(l)));
    ok('con el promedio de la combi (40:00)', /40:00/.test(t), t.split('\n').filter(l => /:00/.test(l)).slice(0, 6));
    ok('y su MEJOR vuelta al lado (30:00)', /mejor 30:00/i.test(t), t.split('\n').filter(l => /mejor/i.test(l)));
    ok('y la velocidad promedio en km/h', /20 km\/h/.test(t), t.split('\n').filter(l => /km\/h/.test(l)));
  }

  console.log('\nCONTRA QUÉ SE MIDIÓ');
  {
    const t = await texto();
    ok('las rutas del período, con su objetivo', /Contra qué se midió/i.test(t) && /6:00/.test(t),
       t.split('\n').filter(l => /Contra qué|6:00/i.test(l)));
    ok('y de dónde sale ese objetivo', /fijado a mano/i.test(t), t.split('\n').filter(l => /mano/i.test(l)));
  }

  console.log('\nLAS EMERGENCIAS, CON NOMBRE Y CON QUÉ PASÓ');
  {
    const t = await texto();
    ok('están las dos emergencias del período', /Emergencias · 2/i.test(t),
       t.split('\n').filter(l => /Emergencias/i.test(l)));
    ok('con quién la mandó', /Rufino Quispe/.test(t));
    ok('y qué pasó en la que lo dijo', /Falla mecánica/i.test(t));
    ok('la que no eligió tipo NO se inventa una causa', /SOS sin detallar/i.test(t));
  }

  console.log('\nLAS SALIDAS DEL RECORRIDO, UNA POR UNA');
  {
    const t = await texto();
    ok('están las dos, contadas', /Salidas del recorrido · 2/i.test(t),
       t.split('\n').filter(l => /Salidas del recorrido/i.test(l)));
    ok('con cuánto se alejó la de verdad', /480 m/.test(t));
    // Silenciar es «ya lo sé»: no es una salida que contarle al chofer, y en
    // los totales sigue contando UNA sola (E7).
    ok('la silenciada se ve y se dice que lo está', /silenciada por despacho/i.test(t));
    ok('y el total de salidas sigue diciendo 1, no 2',
       await p.evaluate(() => {
         // La tarjeta es { número, rótulo }, en ese orden
         const el = Array.from(document.querySelectorAll('div'))
           .find(d => d.children.length === 2 && /^Salidas del recorrido$/i.test(d.children[1]?.innerText?.trim() || ''));
         return el ? el.children[0].innerText.trim() : null;
       }) === '1');
  }

  console.log('\nY EN VUELTAS, DESDE CUÁNDO NO TRABAJA CADA COMBI');
  {
    await p.click('button:has-text("Vueltas")');
    await p.waitForTimeout(3000);
    const t = await texto();
    // `lastFinish` se tiraba: la columna «Última» decía sólo cuánto duró.
    ok('la última vuelta dice CUÁNDO fue, no sólo cuánto duró',
       /hoy \d{2}:\d{2}/i.test(t), t.split('\n').filter(l => /hoy /i.test(l)).slice(0, 5));
  }

  console.log('\nY EN TURNOS, DE QUÉ DÍA ES CADA FILA');
  {
    await p.click('button:has-text("Turnos")');
    await p.waitForTimeout(1500);
    await p.click('button:has-text("Esta semana")');
    await p.waitForTimeout(2000);
    const t = await texto();
    const dia = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const anteayer = new Date(medianoche - 3 * 86400_000);
    ok('hay un rótulo por día, y el de hoy dice HOY', new RegExp(`HOY · ${dia(medianoche)}`).test(t),
       t.split('\n').filter(l => /HOY|AYER|\d\d\/\d\d/.test(l)).slice(0, 6));
    ok('el de ayer dice AYER', new RegExp(`AYER · ${dia(medianoche - 86400_000)}`).test(t));
    ok('y el de más atrás dice qué día de la semana fue',
       new RegExp(`${DIAS[anteayer.getDay()]} ${dia(anteayer.getTime())}`).test(t),
       t.split('\n').filter(l => /LUN|MAR|MIÉ|JUE|VIE|SÁB|DOM/.test(l)));
    // El turno que empieza a las 22:00 y cierra a la 01:00 va bajo el rótulo
    // del día en que EMPEZÓ: sin la marca, «22:00 → 01:00» se lee como un
    // turno de veintitrés horas.
    ok('el turno que cruza la medianoche lo dice con «+1»', /01:00 \+1/.test(t),
       t.split('\n').filter(l => /01:00/.test(l)));
    ok('y sus horas siguen siendo 3, no 23', /3 h 00 min/.test(t),
       t.split('\n').filter(l => / h \d\d min/.test(l)));
  }

  console.log('\nY EN ACTIVIDAD, EN CASTELLANO Y NO EN SLUG');
  // Revisión del 10/9, E17. De las 29 acciones que el servidor anota, el mapa
  // de la pantalla cubría 11: las otras 18 se leían como `entrada_tardia` o
  // `gps_sospechoso`, que es el nombre de la columna en la base y no algo que
  // alguien pueda leer en una reunión.
  {
    await p.click('button:has-text("Actividad")');
    await p.waitForTimeout(2500);
    const t = await texto();
    for (const [slug, dicho] of [
      ['entrada_tardia', 'entró a la ruta empezada'],
      ['gps_sospechoso', 'mandó GPS con firma de simulador'],
      ['cerrar_todo', 'cerró todas sus sesiones'],
      ['objetivo', 'cambió el objetivo de brecha'],
    ]) {
      // El slug crudo no puede aparecer. Se mira sólo en los que tienen
      // guión bajo: «objetivo» es también una palabra del texto en castellano.
      ok(`«${slug}» se lee como «${dicho}»`,
         t.includes(dicho) && (!slug.includes('_') || !t.includes(slug)),
         t.split('\n').filter(l => l.includes(slug)).slice(0, 2));
    }
  }

  console.log('\nY LOS INFORMES AVISAN ANTES DE RECORTAR EL RANGO');
  // Revisión del 10/9, E19. El servidor recorta a 90 días y lo dice en la
  // primera línea del archivo — recién cuando ya se bajó. La pantalla no
  // decía nada: se elegían seis meses y salía un CSV de tres.
  {
    await p.click('button:has-text("Informes")');
    await p.waitForTimeout(2000);
    const antes = await texto();
    ok('con el rango por defecto no avisa nada', !/período máximo son 90 días: el informe/i.test(antes));
    const fechas = await p.$$('input[type="date"]');
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    await fechas[0].fill(iso(Date.now() - 200 * 86400e3));
    await fechas[1].fill(iso(Date.now()));
    await p.waitForTimeout(800);
    const t = await texto();
    ok('con doscientos días, la pantalla lo dice ANTES de bajar nada',
       /período máximo son 90 días/i.test(t) && /no con los 20[01]\./i.test(t),
       t.split('\n').filter(l => /90 días/i.test(l)));
  }

  ok('la página no tiró ningún error', errores.length === 0, errores.slice(0, 4));

  console.log(fallas ? `\n=== ${fallas} FALLA(S) ===` : '\n=== TODO OK ===');
  await browser.close();
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(async (e) => {
  console.error('FALLA (excepción):', e.message);
  if (browser) await browser.close().catch(() => {});
  if (servidor) servidor.kill();
  process.exit(1);
});
