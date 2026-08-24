// El rótulo del cuadro por unidad, mirado en un navegador de verdad.
//
// `periodo.js` prueba el SERVIDOR: que el corte se aplique a los datos y que
// diga qué período sirvió. Esta prueba mira la otra mitad, que es la que el
// dueño pidió cuidar: **que la pantalla no afirme un período que no es el que
// está mostrando**. Acotar una pantalla que sigue diciendo "acumulado" es peor
// que no acotarla — el despachador lee un total y está viendo una semana, y
// con estos números se habla con choferes.
//
// Va con navegador y no con una expresión regular sobre el HTML porque el
// rótulo se arma en tiempo de ejecución con el período que contestó el
// servidor: leer el archivo probaría la plantilla, no lo que se ve. Y de paso
// valida que el JSX compile — si estuviera roto, React no monta y no hay
// ningún botón que apretar.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/panel-periodo-test.db';
const P = 3196;
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

  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  // Sin esto la página se queda esperando el CDN y React no monta nunca.
  await interceptarHttps(ctx);
  const errores = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });

  await p.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  const inputs = await p.$$('input');
  await inputs[0].fill('DESPACHO');
  await p.fill('input[type="password"]', 'despacho99');
  await p.click('button:has-text("INGRESAR")');
  await p.waitForTimeout(3000);
  await p.click('button:has-text("Gestión")');
  await p.waitForTimeout(1200);
  await p.click('button:has-text("Vueltas")');
  await p.waitForTimeout(2500);

  // El rótulo se muestra en versalitas por CSS, y `innerText` devuelve el
  // texto ya transformado: las comparaciones van sin distinguir mayúsculas.
  const texto = () => p.evaluate(() => document.body.innerText);

  console.log('\nLA PANTALLA DICE QUÉ PERÍODO ESTÁ MOSTRANDO');
  {
    const t = await texto();
    ok('la pantalla monta', (await p.$$('button')).length > 3);
    ok('el encabezado nombra el período por defecto', /por unidad · últimos 7 días/i.test(t),
       t.split('\n').filter(l => /por unidad/i.test(l)));
    ok('y están las cuatro opciones', ['7 días', '30 días', '90 días', 'Todo'].every(b => t.includes(b)));
  }

  console.log('\nY NO QUEDÓ NINGÚN "ACUMULADO" AFIRMANDO LO QUE YA NO ES');
  {
    const t = await texto();
    // La palabra entera está prohibida en esta pantalla: mostraba todo el
    // historial y ahora muestra una semana.
    ok('no dice "acumulado" en ningún lado', !/acumulado/i.test(t),
       t.split('\n').filter(l => /acumulado/i.test(l)));
    // La columna decía "Total" cuando traía todo. Ahora dice "Vueltas": un
    // total de siete días no es un total.
    ok('la columna ya no se llama "Total"', !/\bTotal\b/.test(t),
       t.split('\n').filter(l => /\bTotal\b/.test(l)));
  }

  console.log('\nCAMBIAR EL PERÍODO CAMBIA EL RÓTULO, NO SÓLO LOS DATOS');
  {
    await p.click('button:has-text("90 días")');
    await p.waitForTimeout(2000);
    const t90 = await texto();
    ok('a 90 días el encabezado lo dice', /por unidad · últimos 90 días/i.test(t90),
       t90.split('\n').filter(l => /por unidad/i.test(l)));

    await p.click('button:has-text("Todo")');
    await p.waitForTimeout(2000);
    const tt = await texto();
    ok('con "Todo" dice que es todo el historial',
       /por unidad · todo el historial retenido/i.test(tt),
       tt.split('\n').filter(l => /por unidad/i.test(l)));
    ok('y ahí tampoco aparece la palabra "acumulado"', !/acumulado/i.test(tt));
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
