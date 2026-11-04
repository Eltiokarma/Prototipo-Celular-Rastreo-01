// DÍA / NOCHE / AUTO en la web del chofer (Prototipo.html).
//
// La nativa lo tenía desde siempre; la web sólo tenía el de día y no había
// forma de cambiarlo desde la pantalla. Lo que se prueba:
//
//   - de fábrica es DÍA (invariante de diseño: el sol de Juliaca);
//   - el botón cicla como la nativa, AUTO → DÍA → NOCHE, y se recuerda;
//   - AUTO sigue la hora con la regla de `app/tema.js` (noche desde las
//     18:30) y cambia SOLO, sin tocar nada, cuando se hace de noche;
//   - elegido a mano, el reloj no manda;
//   - el botón está también sobre el mapa y no cambia de pantalla al tocarlo.
//
// No hace falta servidor de verdad para nada de esto: se le corta el login y
// se entra en modo demo, con el reloj del navegador en la mano.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/tema-web.db';
const P = 3152;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Los fondos de cada juego de tokens (TEMAS.day.bg, TEMAS.night.bg)
const FONDO = { day: 'rgb(247, 250, 253)', night: 'rgb(3, 6, 10)' };

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();   // sólo sirve los archivos: el login se corta abajo

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    timezoneId: 'America/Lima', locale: 'es-PE',
  });
  await interceptarHttps(ctx);
  // Sin servidor que conteste el login, la pantalla ofrece el modo demo
  await ctx.route(/\/auth\/login/, r => r.abort('connectionrefused'));
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(e.message));
  // Un minuto y medio antes de que en Juliaca sea «de noche» para la regla
  await p.clock.install({ time: new Date('2026-06-15T18:28:30-05:00') });

  const chip = () => p.$eval('button[data-tema]', b => ({
    modo: b.dataset.tema, texto: b.innerText.trim(),
    fondo: getComputedStyle(b.parentElement).backgroundColor,
  }));
  const guardado = () => p.evaluate(() => localStorage.getItem('r14_modo'));
  const tocar = async () => { await p.click('button[data-tema]'); await p.waitForTimeout(250); };

  const entrar = async () => {
    await p.goto(`http://localhost:${P}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForSelector('input[type="password"]', { timeout: 30000 });
    await p.fill('input[type="text"]', 'DEMO-1');
    await p.fill('input[type="password"]', 'cualquiera');
    await p.click('button:has-text("INGRESAR")');
    await p.click('button:has-text("MODO DEMO")', { timeout: 10000 });
    await p.click('button:has-text("SALIR A RUTA")', { timeout: 10000 });
    await p.waitForSelector('button[data-tema]', { timeout: 10000 });
  };

  console.log('\nDE FÁBRICA Y A MANO');
  await entrar();
  let c = await chip();
  ok('de fábrica es DÍA', c.modo === 'day' && c.texto === 'DÍA', c);
  ok('con el fondo del tema de día', c.fondo === FONDO.day, c.fondo);

  const activa = () => p.$eval('button[aria-label="Brechas"] > div', d => d.offsetWidth);
  const antes = await activa();
  await tocar();
  c = await chip();
  ok('un toque pasa a NOCHE', c.modo === 'night' && c.texto === 'NOCHE', c);
  ok('y la pantalla se oscurece', c.fondo === FONDO.night, c.fondo);
  ok('se recuerda en el teléfono', (await guardado()) === 'night');
  ok('tocarlo no cambia de pantalla', (await activa()) === antes && antes === 24, { antes, despues: await activa() });

  console.log('\nAUTO SIGUE LA HORA');
  await tocar();
  c = await chip();
  ok('el siguiente es AUTO', c.modo === 'auto' && c.texto === 'AUTO', c);
  ok('a las 18:28 AUTO es de día', c.fondo === FONDO.day, c.fondo);
  ok('AUTO se recuerda', (await guardado()) === 'auto');
  // Pasan tres minutos sin que nadie toque nada: a las 18:31 es de noche
  await p.clock.fastForward('03:00');
  await p.waitForTimeout(300);
  c = await chip();
  ok('a las 18:31 se pone de noche solo', c.fondo === FONDO.night, c.fondo);
  ok('y el botón sigue diciendo AUTO', c.texto === 'AUTO', c.texto);

  console.log('\nAL VOLVER A ABRIR');
  // Antes de este cambio 'auto' no era un tema válido y se tiraba: la web
  // volvía a DÍA. El marco de la página lo pinta Root con el tema en uso.
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[type="password"]', { timeout: 30000 });
  await p.waitForTimeout(300);
  const marco = await p.evaluate(() => document.documentElement.style.getPropertyValue('--pag-bg'));
  ok('AUTO sobrevive al recargo (de noche, marco oscuro)', marco === '#0c0c0e', marco);
  await entrar();
  c = await chip();
  ok('y entra en AUTO, de noche', c.modo === 'auto' && c.fondo === FONDO.night, c);

  console.log('\nA MANO EL RELOJ NO MANDA');
  await tocar();
  c = await chip();
  ok('DÍA de noche es de día', c.modo === 'day' && c.fondo === FONDO.day, c);
  await p.clock.fastForward('02:00');
  await p.waitForTimeout(300);
  c = await chip();
  ok('y sigue de día al pasar los minutos', c.fondo === FONDO.day, c.fondo);

  console.log('\nSOBRE EL MAPA');
  await p.click('button[aria-label="Mapa"]');
  await p.waitForTimeout(800);
  const tapado = await p.$eval('button[data-tema]', b => {
    const r = b.querySelector('span').getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(e && b.contains(e));
  });
  ok('el botón se ve y se toca sobre el mapa', tapado === false);
  await tocar();
  c = await chip();
  ok('y desde ahí también cambia (NOCHE)', c.modo === 'night', c);

  ok('la página no tiró errores', errores.length === 0, errores);

  await browser.close();
  if (servidor) servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
