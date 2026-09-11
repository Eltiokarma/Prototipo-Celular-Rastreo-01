// Dónde se traba la ruta y dónde se corta la señal, en un navegador de verdad
// (REVISION-2026-09-10.md, E9).
//
// `/admin/paradas`, `/admin/huecos` y `/admin/anomalias` existían, estaban
// probados —traen lat/lng/progreso/tramo/kmh— y NINGUNA pantalla los pedía:
// un `grep` en los `.html` daba cero. La pregunta para la que se creó la
// tabla `paradas` («dónde y a qué hora se traba esta ruta») no se podía
// contestar sin abrir la base a mano.
//
// Lo que esta suite defiende:
//
//   - que la pantalla exista y PIDA los tres endpoints;
//   - que agrupe por punto del circuito y no muestre puntos sueltos: dos
//     combis nunca frenan en el mismo metro, y el patrón está en la franja;
//   - que cuente las paradas MEDIDAS, no sólo las que el chofer avisó (E10);
//   - y que distinga el corte que trajo después sus posiciones del que no
//     —la antena contra el teléfono apagado—, porque son dos problemas de dos
//     dueños distintos.
//
// Va con navegador y no con una expresión regular sobre el HTML porque todo
// esto se arma en tiempo de ejecución con lo que contesta el servidor: leer
// el archivo probaría la plantilla, no lo que se ve.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/trabas-test.db';
const P = 3200;
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

  // Un día sembrado a mano, anclado a la medianoche de hoy y comprimido a
  // minutos —igual que `numeros`— para que la suite no dependa de la hora a
  // la que se corra. «Las 8» son las 00:08.
  const medianoche = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const hoy = (h) => medianoche + h * 60_000;
  const w = new Database(DB);
  const companyId = w.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  const parada = w.prepare(`INSERT INTO paradas (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, lat, lng, progreso, tramo, confirmado, medida, cierre)
                            VALUES (?, 'R-14', ?, ?, ?, ?, -15.49, -70.13, ?, ?, ?, 1, 'movio')`);
  // TRES combis distintas trabadas en la misma franja del circuito (42–44 %
  // de la ida): eso es la ruta, no una combi. Sólo una lo avisó.
  parada.run('M-01', companyId, hoy(8), hoy(8) + 300_000, 300, 0.42, 'ida', 1);
  parada.run('M-02', companyId, hoy(9), hoy(9) + 420_000, 420, 0.43, 'ida', 0);
  parada.run('M-03', companyId, hoy(9), hoy(9) + 600_000, 600, 0.44, 'ida', 0);
  // Y una sola combi trabada en otra franja, más corta
  parada.run('M-01', companyId, hoy(14), hoy(14) + 200_000, 200, 0.80, 'vuelta', 0);
  // Una parada que el servidor NO midió (sólo el aviso del chofer): no cuenta
  // como lugar donde se traba la ruta.
  w.prepare(`INSERT INTO paradas (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, lat, lng, progreso, tramo, confirmado, medida, cierre)
             VALUES ('M-09', 'R-14', ?, ?, ?, 120, -15.49, -70.13, 0.10, 'ida', 1, 0, 'chofer')`)
    .run(companyId, hoy(11), hoy(11) + 120_000);
  // Dos cortes de señal en la misma franja (68–70 %), uno de ellos sin traer
  // después las posiciones que faltaban.
  const hueco = w.prepare(`INSERT INTO huecos (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, latDesde, lngDesde, progresoDesde, metros, kmh, presencia, recuperadas, cierre)
                           VALUES (?, 'R-14', ?, ?, ?, ?, -15.49, -70.13, ?, 300, 20, 'ruta', ?, 'volvio')`);
  hueco.run('M-01', companyId, hoy(10), hoy(10) + 180_000, 180, 0.68, 1);
  hueco.run('M-02', companyId, hoy(12), hoy(12) + 240_000, 240, 0.69, 0);
  const anomalia = w.prepare(`INSERT INTO anomalias (vehicleId, routeId, companyId, tipo, cuando, valor, detalle, lat, lng)
                              VALUES ('M-01', 'R-14', ?, ?, ?, ?, ?, -15.49, -70.13)`);
  anomalia.run(companyId, 'salto', hoy(13), 900, 'saltó 900 m en 3 s');
  // Una con slug de dos palabras, que es donde se ve si la pantalla traduce
  // o escupe lo que vino: `ausente_en_marcha` no es castellano.
  anomalia.run(companyId, 'ausente_en_marcha', hoy(15), 400, 'se movió 400 m estando ausente');
  w.close();

  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await interceptarHttps(ctx);
  const errores = [];
  const pedidos = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  p.on('request', r => pedidos.push(r.url()));

  await p.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const inputs = await p.$$('input');
  await inputs[0].fill('DESPACHO');
  await p.fill('input[type="password"]', 'despacho99');
  await p.click('button:has-text("INGRESAR")');
  await p.waitForTimeout(3000);
  await p.click('button:has-text("Gestión")');
  await p.waitForTimeout(1200);
  await p.click('button:has-text("Dónde se traba")');
  await p.waitForTimeout(2500);

  const texto = () => p.evaluate(() => document.body.innerText);

  console.log('\nLA PANTALLA EXISTE Y PIDE LOS TRES ENDPOINTS');
  {
    const t = await texto();
    ok('la pantalla monta', (await p.$$('button')).length > 3);
    for (const e of ['paradas', 'huecos', 'anomalias']) {
      ok(`pide /admin/${e}`, pedidos.some(u => u.includes(`/admin/${e}?dias=`)),
         pedidos.filter(u => u.includes('/admin/')).slice(-6));
    }
    ok('dice de qué se trata sin nombrar a ningún chofer', /Dónde se para/i.test(t), t.slice(0, 200));
  }

  console.log('\nAGRUPA POR PUNTO DEL CIRCUITO: EL PATRÓN, NO EL PUNTO SUELTO');
  {
    const t = await texto();
    // Las tres paradas de 42, 43 y 44 % caen en la franja 40–45 %, con tres
    // combis distintas: eso es lo que hace que sea la ruta y no una combi.
    ok('las tres paradas de tres combis caen en UNA franja', /40 – 45 %/.test(t),
       t.split('\n').filter(l => /%/.test(l)).slice(0, 8));
    const fila = await p.evaluate(() => {
      const div = Array.from(document.querySelectorAll('div'))
        .find(d => d.children.length === 6 && d.children[1]?.innerText?.includes('40 – 45'));
      return div ? Array.from(div.children).map(c => c.innerText.trim()) : null;
    });
    ok('con sus veces, su tiempo y CUÁNTAS COMBIS distintas',
       fila && fila[2] === '3' && fila[4] === '3' && fila[3] === '22′', fila);
    ok('y cuántas de esas paradas avisó el chofer', fila && fila[5] === '1 de 3', fila);
    // La franja de la vuelta (80 %) está, con una sola combi
    ok('la franja de una sola combi también aparece, dicho que es una sola', /80 – 85 %/.test(t));
  }

  console.log('\nLAS PARADAS MEDIDAS, NO SÓLO LAS QUE EL CHOFER AVISÓ');
  {
    const t = await texto();
    // Cuatro medidas (tres avisadas o no en la franja + una en la vuelta).
    // La quinta fila de `paradas` es un aviso del chofer SIN parada medida:
    // no es un lugar donde se traba la ruta y no entra.
    ok('el encabezado cuenta las 4 medidas y deja afuera el aviso sin parada',
       /Dónde se para · 4 parada\(s\) medidas/i.test(t),
       t.split('\n').filter(l => /Dónde se para/.test(l)));
    ok('y la franja del aviso sin parada medida NO aparece', !/10 – 15 %/.test(t));
  }

  console.log('\nA QUÉ HORA, Y DÓNDE SE CORTA LA SEÑAL');
  {
    const t = await texto();
    ok('hay un corte por hora del día', /A qué hora/i.test(t));
    ok('y la franja donde se corta la señal, con sus dos cortes',
       /Dónde se corta la señal · 2 corte\(s\)/i.test(t) && /65 – 70 %/.test(t),
       t.split('\n').filter(l => /corta la señal|65 –/.test(l)));
    // El corte que no trajo después las posiciones que faltaban es de otro
    // dueño: no es la antena, es el teléfono apagado o la app muerta.
    const fila = await p.evaluate(() => {
      const div = Array.from(document.querySelectorAll('div'))
        .find(d => d.children.length === 5 && d.children[0]?.innerText?.includes('65 – 70'));
      return div ? Array.from(div.children).map(c => c.innerText.trim()) : null;
    });
    ok('y dice cuántos de esos cortes no trajeron sus posiciones después',
       fila && fila[1] === '2' && fila[4] === '1', fila);
  }

  console.log('\nY LAS ANOMALÍAS, EN CASTELLANO');
  {
    const t = await texto();
    ok('la anomalía aparece dicha en castellano, no como slug',
       /salto imposible/i.test(t) && /ausente y en marcha/i.test(t) && !/ausente_en_marcha/i.test(t),
       t.split('\n').filter(l => /salto|ausente/i.test(l)));
    ok('con su detalle', /saltó 900 m en 3 s/.test(t));
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
