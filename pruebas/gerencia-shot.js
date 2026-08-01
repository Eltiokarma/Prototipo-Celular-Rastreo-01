// Banco visual del panel del gerente. Siembra tres semanas de vueltas y
// turnos sintéticos —es la única forma de mirar una pantalla de tendencias
// sin esperar tres semanas— y saca capturas.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/gerencia.db';
const P = 3121;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALIDA = S + '/shots';

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
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
  fs.mkdirSync(SALIDA, { recursive: true });
  await arrancar();

  const cli = (...args) => execFileSync('node', [RAIZ + '/server/empresa.js', ...args],
    { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });
  cli('gerencia', 'R14', 'GERENTE-1', 'claveGerente1');

  const db = new Database(DB);
  db.prepare("UPDATE companies SET name = 'Señor de Huayllani' WHERE companyId = 'R14'").run();
  db.prepare("UPDATE routes SET name = 'Cerro Colorado ⇄ Centro', durationMin = 50, targetGapMin = 2, autoTarget = 0 WHERE routeId = 'R-14'").run();
  const variante = db.prepare("SELECT variantId FROM route_variants WHERE routeId = 'R-14'").get();

  const UNIDADES = [
    // [código, chofer, vueltas/día, brecha típica (s), dispersión]
    ['M-08', 'Rufino Quispe', 7, 120, 12],
    ['M-12', 'Elmer Ccama', 6, 128, 20],
    ['M-03', 'Julia Mamani', 6, 95, 35],   // tiende a pegarse: cumple menos
    ['M-17', 'Wilber Apaza', 5, 118, 15],
    ['M-05', 'Nilda Arapa', 7, 145, 25],   // tiende a rezagarse
  ];
  for (const [u, nombre] of UNIDADES) {
    db.prepare(`INSERT OR IGNORE INTO users (unitId, driverName, name, role, routeId, companyId, vehicleId, passHash, createdAt)
                VALUES (?, ?, ?, 'driver', 'R-14', 'R14', ?, 'x:y', ?)`)
      .run(u, nombre, nombre, u, Date.now());
    db.prepare(`INSERT OR IGNORE INTO vehicles (vehicleId, routeId, companyId, createdAt)
                VALUES (?, 'R-14', 'R14', ?)`).run(u, Date.now());
  }

  // Ruido reproducible: sin Math.random, así dos corridas dan el mismo dibujo
  let semilla = 7;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const insVuelta = db.prepare(`INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm)
                                VALUES (?, 'R-14', ?, ?, ?, ?, ?, ?)`);
  const insTurno = db.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt)
                               VALUES (?, ?, 'R-14', 'driver', ?, ?, ?)`);
  db.transaction(() => {
    for (let d = 20; d >= 0; d--) {
      const dia = hoy.getTime() - d * 86400e3;
      const domingo = new Date(dia).getDay() === 0;
      if (domingo) continue;              // un día sin servicio: hueco real, no un cero
      for (const [u, , porDia, brecha, disp] of UNIDADES) {
        const entrada = dia + 6 * 3600e3 + Math.floor(azar() * 1800e3);
        const salida = entrada + (7 + azar() * 3) * 3600e3;
        insTurno.run(u, u, entrada, salida, salida);
        const cuantas = porDia + (azar() < 0.3 ? -1 : 0);
        for (let v = 0; v < cuantas; v++) {
          const fin = entrada + (v + 1) * 3000e3 + Math.floor(azar() * 600e3);
          const dur = 2700 + Math.floor(azar() * 900);
          insVuelta.run(u, variante ? variante.variantId : null, fin - dur * 1000, fin, dur,
            20 + Math.floor(azar() * 8),
            Math.max(20, Math.round(brecha + (azar() - 0.5) * disp * 2)));
        }
      }
    }
  })();
  db.close();

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const abrir = async (ancho, alto) => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2 });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
    await p.goto(`http://localhost:${P}/gerencia.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);
    return p;
  };

  const p = await abrir(1280, 1100);
  await p.screenshot({ path: SALIDA + '/g0-puerta.png' });
  const inputs = await p.$$('input');
  await inputs[0].fill('GERENTE-1');
  await p.fill('input[type="password"]', 'claveGerente1');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: SALIDA + '/g1-resumen.png', fullPage: true });

  await p.click('button:has-text("Ver tabla")');
  await p.waitForTimeout(800);
  await p.screenshot({ path: SALIDA + '/g2-tabla.png' });

  const cel = await abrir(412, 1400);
  const ci = await cel.$$('input');
  await ci[0].fill('GERENTE-1');
  await cel.fill('input[type="password"]', 'claveGerente1');
  await cel.click('button:has-text("Entrar")');
  await cel.waitForTimeout(3000);
  await cel.screenshot({ path: SALIDA + '/g3-celular.png' });

  console.log('capturas en', SALIDA);
  console.log('errores de la página:', errores.length ? errores : 'ninguno');
  await browser.close();
  if (servidor) servidor.kill();
  await sleep(400);
  process.exit(errores.length ? 1 : 0);
})().catch(e => {
  console.error('EL BANCO SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
