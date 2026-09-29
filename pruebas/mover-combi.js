// Pasar una combi de una ruta a otra de la misma cooperativa (la 18A y la
// 18B que rotan combis), contra el servidor de verdad.
//
// Lo que se defiende: que sólo el supervisor pueda hacerlo y sólo dentro de
// su cooperativa; que la gente asignada vaya con la combi; que si está
// andando salga de un mapa y entre al otro sin arrastrar la vuelta a medias;
// que el turno se corte y el siguiente quede en la ruta nueva; y que volver a
// la cadena en la ruta nueva no la acuse de haberse metido a mitad de ruta.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const { hashPassword } = require(RAIZ + '/server/base.js');
const fs = require('fs');

const DB = S + '/mover-combi-test.db';
const P = 3203;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
let salida = '';
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           MODO: 'demo', STATE_INTERVAL_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { salida += d; });
  servidor.stderr.on('data', d => { salida += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, token, opciones = {}) => fetch(API + ruta, {
  ...opciones,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, p) => pedir('/auth/login', null, { method: 'POST', body: JSON.stringify({ user: u, password: p }) })
  .then(r => r.body);
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });
const mover = (token, veh, routeId) => post(`/admin/vehicles/${veh}/ruta`, token, { routeId });

// Un socket que junta todo lo que le llega; con `mirar` pide ver otra ruta
const conectar = (token, mirar) => new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${P}`);
  const visto = [];
  ws.on('message', raw => { try { visto.push(JSON.parse(raw)); } catch {} });
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'identify', token }));
    setTimeout(() => {
      if (mirar) ws.send(JSON.stringify({ type: 'watch', routeId: mirar }));
      setTimeout(() => res({ ws, visto }), 300);
    }, 300);
  });
});
const ultimoEstado = (c, ruta) => [...c.visto].reverse().find(m => m.type === 'state' && m.routeId === ruta);
const enEstado = (c, ruta, veh) => !!(ultimoEstado(c, ruta)?.units || []).find(u => u.unitId === veh);

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const d = await login('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(API, DB);
  const base = new Database(DB);
  const empresa = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;

  // La 18B, de la misma cooperativa, con el mismo anillo como trazado
  coop.altaRuta(base, { companyId: empresa, routeId: 'R-18B', name: 'Ruta 18B' });
  const trazado = { tramos: { ida: Array.from({ length: 48 }, (_, i) => anillo(i / 48)), vuelta: [] } };
  for (const r of ['R-14', 'R-18B']) {
    await pedir(`/admin/routes/${r}/points`, d.token, { method: 'PUT', body: JSON.stringify(trazado) });
  }
  // Otra cooperativa con su combi y su ruta
  coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  base.prepare("INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES ('M-90', NULL, 'R-9', 'OTRA', ?)").run(Date.now());
  // Un Despacho ATADO a la R-14
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-14', 'Despacho 14', 'Despacho 14', 'dispatch', 'R-14', ?, ?, ?)`)
    .run(empresa, hashPassword('despacho14'), Date.now());

  // La combi M-01 en la R-14, con su chofer y su cobrador
  await post('/admin/users', HG, { unitId: 'M-01', name: 'Chofer Uno', personRole: 'driver', password: 'clave1234' });
  await post('/admin/users', HG, { unitId: 'C-01', name: 'Cobrador Uno', personRole: 'collector', vehicleId: 'M-01', password: 'clave1234' });
  ok('la combi arranca en la R-14', base.prepare("SELECT routeId FROM vehicles WHERE vehicleId = 'M-01'").get().routeId === 'R-14');

  const chofer = await login('M-01', 'clave1234');
  const cc = await conectar(chofer.token);
  const mira14 = await conectar(d.token, 'R-14');
  const mira18 = await conectar(d.token, 'R-18B');
  await post('/presencia', chofer.token, { estado: 'ruta' });
  let t0 = Date.now() - 60_000;
  const andar = async (ts) => {
    for (const t of ts) {
      await post('/gps', chofer.token, { presencia: 'ruta', posiciones: [{ ...anillo(t), speed: 25, timestamp: t0 }] });
      t0 += 2000;
    }
  };
  await andar([0.02, 0.06, 0.10, 0.14, 0.18, 0.22, 0.26]);
  await sleep(900);
  ok('andando, está en el mapa de la R-14', enEstado(mira14, 'R-14', 'M-01'));

  console.log('\nQUIÉN PUEDE');
  {
    const d14 = await login('DESP-14', 'despacho14');
    let r = await mover(d14.token, 'M-01', 'R-18B');
    ok('un Despacho atado a una ruta no mueve combis: 403', r.status === 403, r);
    r = await mover(d.token, 'M-90', 'R-18B');
    ok('una combi de otra cooperativa: 404, como inexistente', r.status === 404, r);
    r = await mover(d.token, 'M-01', 'R-9');
    ok('a una ruta de otra cooperativa: 404', r.status === 404, r);
    r = await mover(d.token, 'M-01', 'R-14');
    ok('a la misma ruta: no cambia nada', r.status === 200 && r.body.sinCambio === true, r.body);
  }

  console.log('\nLA COMBI PASA DE LA R-14 A LA R-18B, ANDANDO');
  {
    const r = await mover(d.token, 'M-01', 'R-18B');
    ok('el supervisor la mueve', r.status === 200 && r.body.enVivo === true && r.body.desde === 'R-14', r.body);
    ok('y dice quiénes fueron con ella', (r.body.personas || []).sort().join(',') === 'C-01,M-01', r.body.personas);
    await sleep(900);
    ok('la combi queda en la R-18B', base.prepare("SELECT routeId FROM vehicles WHERE vehicleId = 'M-01'").get().routeId === 'R-18B');
    const gente = base.prepare("SELECT unitId, routeId FROM users WHERE vehicleId = 'M-01' ORDER BY unitId").all();
    ok('su chofer y su cobrador también', gente.every(g => g.routeId === 'R-18B'), gente);
    ok('el mapa de la R-14 recibe que se fue', mira14.visto.some(m => m.type === 'unit_left' && m.unitId === 'M-01'));
    ok('y deja de mostrarla', !enEstado(mira14, 'R-14', 'M-01'));
    ok('el chofer recibe el trazado de la ruta nueva', cc.visto.some(m => m.type === 'route_geometry' && m.routeId === 'R-18B'));
    ok('y el hilo de la ruta nueva', cc.visto.some(m => m.type === 'chat_history' && m.routeId === 'R-18B'));
    ok('la vuelta a medias no se guardó con ninguna ruta',
       base.prepare("SELECT COUNT(*) c FROM laps WHERE unitId = 'M-01'").get().c === 0);
    ok('el cambio queda en la auditoría',
       !!base.prepare("SELECT 1 FROM audit WHERE action = 'mover_combi' AND target = 'M-01' AND detail = 'R-14 → R-18B'").get());

    // Sigue andando, ahora por la mitad del circuito de la 18B
    await andar([0.40, 0.44, 0.48, 0.52]);
    await sleep(900);
    ok('ahora está en el mapa de la R-18B', enEstado(mira18, 'R-18B', 'M-01'));
    ok('y vuelve a la cadena como reanudación, no como una entrada tardía',
       !base.prepare("SELECT 1 FROM audit WHERE action = 'entrada_tardia' AND target = 'M-01'").get());
    const turnos = base.prepare("SELECT routeId, endedAt FROM shifts WHERE personId = 'M-01' ORDER BY id").all();
    ok('el turno de la R-14 quedó cerrado y el que sigue es de la R-18B',
       turnos.length >= 2 && turnos[0].routeId === 'R-14' && turnos[0].endedAt !== null &&
       turnos[turnos.length - 1].routeId === 'R-18B' && turnos[turnos.length - 1].endedAt === null, turnos);
  }

  // La web del chofer guarda la sesión con la ruta del ingreso, y la puerta
  // («¿salís a ruta?») la muestra desde ahí: sin corregirla, el cobrador
  // vería la 18B al día siguiente de que su combi volvió a la 14.
  console.log('\nLA WEB DEL COBRADOR SE ENTERA');
  {
    const nombre = id => base.prepare('SELECT name FROM routes WHERE routeId = ?').get(id).name;
    const { chromium } = require('playwright-core');
    const interceptarHttps = require(S + '/cdn.js');
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const errores = [];
    try {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
      await interceptarHttps(ctx);
      const p = await ctx.newPage();
      p.on('pageerror', e => errores.push(e.message));
      await p.goto(`${API}/Prototipo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(2500);
      await p.fill('input[type="text"]', 'C-01');
      await p.fill('input[type="password"]', 'clave1234');
      await p.click('button:has-text("INGRESAR")');
      await p.waitForTimeout(2500);
      let puerta = await p.evaluate(() => document.body.innerText);
      ok('al entrar, la puerta dice la ruta de ahora (18B)', puerta.includes(nombre('R-18B')), nombre('R-18B'));
      await p.click('button:has-text("SALIR A RUTA")');
      await p.waitForTimeout(2500);

      const r = await mover(d.token, 'M-01', 'R-14');
      ok('el supervisor la devuelve a la R-14', r.status === 200, r.body);
      await p.waitForTimeout(2000);
      const guardada = await p.evaluate(() => JSON.parse(localStorage.getItem('r14_session') || 'null'));
      ok('la sesión guardada pasa a la R-14', guardada && guardada.routeId === 'R-14' && guardada.routeName === nombre('R-14'),
         guardada && { routeId: guardada.routeId, routeName: guardada.routeName });
      ok('sin perder el token', !!(guardada && guardada.token));

      // Al día siguiente: la página se abre de nuevo, sin presencia guardada
      await p.evaluate(() => localStorage.removeItem('r14_presencia'));
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2500);
      puerta = await p.evaluate(() => document.body.innerText);
      ok('y la puerta del día siguiente dice la 14, no la 18B',
         puerta.includes(nombre('R-14')) && !puerta.includes(nombre('R-18B')), puerta.slice(0, 200));
      ok('sin errores en la página', errores.length === 0, errores);
    } finally {
      await browser.close();
    }
  }

  for (const c of [cc, mira14, mira18]) { try { c.ws.close(); } catch {} }
  base.close();
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FALLA (excepción):', e.stack || e.message);
  if (servidor) servidor.kill();
  process.exit(1);
});
