// Las tres pantallas se dibujan SIN internet afuera del servidor (revisión
// del 15/11, DIS-05).
//
// React, ReactDOM y Babel venían sólo de unpkg: en una primera visita, o con
// la caché borrada, si el CDN no contestaba la pantalla quedaba vacía —ni el
// SOS del chofer ni los de Despacho— con el servidor de la cooperativa
// andando perfecto. Esta suite abre la app del chofer, Despacho y el panel
// del creador en un navegador de verdad con unpkg y Google Fonts BLOQUEADOS,
// y sin caché: tienen que dibujarse igual.
//
// Y si no se dibuja (las librerías tampoco llegan del servidor), la app del
// chofer no puede quedar en blanco: dice que no cargó y ofrece llamar a la
// central que el teléfono recuerda.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const DB = S + '/sin-cdn.db';
const P = 3255;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           CREATOR_PASSWORD: 'creador-de-prueba-123', RESPALDO_CADA_H: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const nueva = async ({ bloquearVendor = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: 'block' });
    const pedidosAfuera = [];
    await ctx.route(/^https?:\/\/(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => {
      pedidosAfuera.push(r.request().url()); return r.abort();
    });
    if (bloquearVendor) await ctx.route(/\/vendor\/react\//, (r) => r.abort());
    const pg = await ctx.newPage();
    const errores = [];
    pg.on('pageerror', e => errores.push(e.message));
    return { ctx, pg, errores, pedidosAfuera };
  };

  console.log('\nCON unpkg BLOQUEADO');
  for (const [ruta, nombre, listo] of [
    ['/Prototipo.html', 'la app del chofer', 'input[type="password"]'],
    ['/despacho.html', 'Despacho', 'input[type="password"]'],
    ['/creador', 'el panel del creador', 'input[type="password"]'],
  ]) {
    const { ctx, pg, errores, pedidosAfuera } = await nueva();
    await pg.goto(API + ruta, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const dibujo = await pg.waitForSelector(listo, { timeout: 30000 }).then(() => true, () => false);
    ok(`${nombre} se dibuja`, dibujo, errores);
    ok(`${nombre} no fue a buscar React ni Babel afuera`,
       !pedidosAfuera.some(u => /unpkg\.com\/(react|react-dom|@babel)/.test(u)), pedidosAfuera);
    await ctx.close();
  }

  console.log('\nSI NI EL SERVIDOR LAS ENTREGA, LA APP DEL CHOFER NO QUEDA EN BLANCO');
  {
    const { ctx, pg } = await nueva({ bloquearVendor: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('r14_central', '951234567'); } catch {} });
    await pg.goto(API + '/Prototipo.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const aviso = await pg.waitForSelector('[data-sin-librerias]', { timeout: 20000 }).then(() => true, () => false);
    ok('dice que la app no cargó', aviso && /La app no pudo cargar/.test(await pg.evaluate(() => document.body.innerText)));
    const enlace = await pg.$eval('[data-sin-librerias] a', a => a.getAttribute('href')).catch(() => null);
    ok('y ofrece llamar a la central que recuerda', enlace === 'tel:951234567', enlace);
    await ctx.close();
  }

  await browser.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
