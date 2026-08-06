// Banco visual del MAPA en las cuatro pantallas.
//
// Fotografía la app del chofer (web), el panel de Despacho, el panel del
// creador y la página del WebView de la app nativa con el mapa dibujado, y
// FALLA SI EL LIENZO SALE VACÍO: la vara es que haya tiles efectivamente
// cargadas (no pedidas: cargadas) y, donde corresponde, algo dibujado
// encima. Un mapa en blanco no avisa — se descubre arriba de la combi.
//
// Las tiles del mapa propio salen del fixture (tiles-fixture/); las del
// proveedor las intercepta cdn.js con un PNG gris. Ninguna prueba depende
// de la red ni de una clave.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');
const mapaNativo = require(RAIZ + '/app/mapa.js');

const DB = S + '/mapa-shot.db';
const P = 3174;
const SALIDA = process.env.SALIDA || S + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// La vara del banco: tiles CARGADAS en el DOM (complete y con píxeles)
const tilesCargadas = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).length);

let servidor = null;
(async () => {
  for (let i = 0; i < 40; i++) {
    const vivo = await fetch(`http://localhost:${P}/ping`).then(() => true, () => false);
    if (!vivo) break;
    await sleep(250);
  }
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  fs.mkdirSync(SALIDA, { recursive: true });
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           CREATOR_PASSWORD: 'clave-larga-del-creador', CREATOR_PATH: '/creador',
           TILES_DIR: S + '/tiles-fixture', STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); break; } catch {}
  }

  const pedir = (ruta, opts = {}) =>
    fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
      .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  {
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const coop = require(RAIZ + '/server/cooperativas.js');
    const base = new Database(DB);
    coop.gerente(base, { companyId: 'R14', usuario: 'GER-SHOT', clave: 'gerenteshot1' });
    base.close();
  }
  const tg = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'GER-SHOT', password: 'gerenteshot1' }) })).body.token;
  await pedir('/admin/vehicles', { method: 'POST', headers: { Authorization: 'Bearer ' + tg },
    body: JSON.stringify({ vehicleId: 'M-12', label: 'Combi 12' }) });
  await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D.token },
    body: JSON.stringify({ unitId: 'M-12', name: 'Elmer Ccama', password: 'chofer1234' }) });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ── 1. LA APP DEL CHOFER (web) ─────────────────────────────
  console.log('\nEL MAPA DEL CHOFER (Prototipo.html)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 900 },
      permissions: ['geolocation'], geolocation: { latitude: -15.4904, longitude: -70.1333 },
    });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2000);
    await p.fill('input[type="text"]', 'M-12');
    await p.fill('input[type="password"]', 'chofer1234');
    await p.click('button:has-text("INGRESAR")');
    await p.waitForTimeout(2500);
    await p.click('button:has-text("SALIR A RUTA")');
    await p.waitForTimeout(1000);
    // El mapa es la página 2 del carrusel: se llega deslizando
    await p.mouse.move(360, 250); await p.mouse.down();
    for (let x = 360; x >= 40; x -= 40) { await p.mouse.move(x, 250); await p.waitForTimeout(30); }
    await p.mouse.up();
    await p.waitForTimeout(4000);
    const n = await tilesCargadas(p);
    ok('el mapa del chofer tiene tiles dibujadas', n > 0, n);
    ok('y el marcador del propio chofer está', (await p.locator('.leaflet-marker-icon').count()) > 0);
    await p.screenshot({ path: SALIDA + '/m1-chofer.png' });
    await ctx.close();
  }

  // ── 2. DESPACHO ────────────────────────────────────────────
  console.log('\nEL MAPA DE DESPACHO (despacho.html)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2000);
    await p.fill('input[type="password"]', 'despacho99');
    await p.click('button:has-text("INGRESAR")');
    await p.waitForTimeout(5000);
    const n = await tilesCargadas(p);
    ok('el mapa de Despacho tiene tiles dibujadas', n > 0, n);
    await p.screenshot({ path: SALIDA + '/m2-despacho.png' });
    await ctx.close();
  }

  // ── 3. EL CREADOR ──────────────────────────────────────────
  console.log('\nEL MAPA DEL CREADOR (pestaña RUTAS)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${P}/creador`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(1500);
    await p.fill('input[type="password"]', 'clave-larga-del-creador');
    await p.click('button:has-text("Entrar")');
    await p.waitForTimeout(2000);
    await p.click('button:has-text("RUTAS")');
    await p.waitForTimeout(1500);
    await p.locator('select').nth(0).selectOption('R14');
    await p.waitForTimeout(800);
    await p.locator('select').nth(1).selectOption('R-14');
    await p.waitForTimeout(4000);
    const n = await tilesCargadas(p);
    ok('el mapa del trazador tiene tiles dibujadas', n > 0, n);
    await p.screenshot({ path: SALIDA + '/m3-creador.png' });
    await ctx.close();
  }

  // ── 4. LA APP NATIVA (la página del WebView) ───────────────
  // La misma página que corre adentro del WebView del teléfono, con los
  // mensajes que la app le manda: tema, la clave/zonas/servidor y una vista
  // con unidades. Es el mapa que ve el chofer con la app instalada.
  console.log('\nEL MAPA DE LA APP NATIVA (WebView)');
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 800 } });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    await p.setContent(mapaNativo.html(), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    const manda = (obj) => p.evaluate((s) => window.postMessage(s, '*'), JSON.stringify(obj));
    await manda({ tipo: 'tiles', clave: 'clave-de-prueba',
                  zonas: JSON.parse(fs.readFileSync(S + '/tiles-fixture/zonas.json', 'utf8')),
                  servidor: `http://localhost:${P}` });
    await manda({ tipo: 'vista', vista: mapaNativo.vista(
      { units: [
        { unitId: 'M-12', vehicleId: 'M-12', lat: -15.4904, lng: -70.1333, driverName: 'Elmer' },
        { unitId: 'M-08', vehicleId: 'M-08', lat: -15.493, lng: -70.1360, driverName: 'Rufino' },
      ] },
      { unitId: 'M-12', vehicleId: 'M-12' },
      // Trazado corto (~700 m): el encuadre cae en z15-16, donde el fixture
      // SÍ tiene tiles — así se ve el mapa propio sirviendo, no el rescate
      { tramos: { ida: [[-15.4904, -70.1333], [-15.4930, -70.1360], [-15.4955, -70.1385]] } },
    ) });
    await p.waitForTimeout(4000);
    const n = await tilesCargadas(p);
    ok('el mapa del WebView tiene tiles dibujadas', n > 0, n);
    ok('las tiles en zona salieron del mapa PROPIO (no del proveedor)',
       await p.evaluate(() => [...document.querySelectorAll('.leaflet-tile')]
         .some(t => t.src.includes('/tiles/xyz/'))));
    ok('las unidades están dibujadas', (await p.locator('.u').count()) >= 2);
    ok('y el trazado también', (await p.locator('.leaflet-overlay-pane path').count()) > 0);
    await p.screenshot({ path: SALIDA + '/m4-nativa.png' });
    await ctx.close();
  }

  await browser.close();
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log('\ncapturas en ' + SALIDA);
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('EL BANCO SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
