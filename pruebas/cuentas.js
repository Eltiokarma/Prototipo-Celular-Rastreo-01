// Las cuentas (auditoría del 11/11).
//
//   A. En la base se guarda la huella del token, no el token: un respaldo ya
//      no trae llaves vivas. Las sesiones de antes se migran y siguen andando.
//   B. Despacho no toca otra cuenta de Despacho; la gerencia sí.
//   C. El chofer que le cambia la clave al cobrador no puede leer el privado
//      personal que el cobrador tenía con Despacho.
//   D. «Cambiar mi contraseña» tiene freno: 5 intentos con la actual mal.
//   E. Cinco claves malas bloquean la cuenta DESDE ESE ORIGEN, no para todos.
//   F. Las claves generadas: dos palabras y cuatro números.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const crypto = require('crypto');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const fs = require('fs');

const DB = S + '/cuentas.db';
const P = 3252;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const huella = (t) => crypto.createHash('sha256').update(t).digest('hex');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };
const pedir = (ruta, o = {}) => fetch(API + ruta, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = (u, c, ip = '10.0.0.1') => pedir('/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': ip },
  body: JSON.stringify({ user: u, password: c }) });

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', TRUST_PROXY: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.salida = new Promise(r => servidor.on('exit', r));
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); return; } catch {} }
  throw new Error('el servidor no arrancó');
}

(async () => {
  borrarBase();
  await arrancar();
  const D = (await login('DESPACHO', 'despacho99')).body.token;
  const HD = { Authorization: 'Bearer ' + D };
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  let base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
    .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('supA', 'Supervisor A', 'Supervisor A', 'dispatch', NULL, ?, ?, ?)`).run(emp, hashPassword('supervisor1'), Date.now());

  console.log('\nA. EL TOKEN NO SE GUARDA');
  ok('en la base no está el token', !base.prepare('SELECT 1 FROM sessions WHERE token = ?').get(D));
  ok('está su huella', !!base.prepare('SELECT 1 FROM sessions WHERE token = ?').get(huella(D)));
  const r0 = await pedir('/admin/users', { headers: { Authorization: 'Bearer ' + huella(D) } });
  ok('la huella sacada de un respaldo no abre nada', r0.status === 401, r0.status);
  ok('el token sí', (await pedir('/admin/users', { headers: HD })).status === 200);
  // Una sesión de antes (en texto plano), y el servidor se reinicia
  const viejo = crypto.randomBytes(24).toString('hex');
  base.prepare('INSERT INTO sessions (token, unitId, createdAt, expiresAt) VALUES (?, ?, ?, ?)')
    .run(viejo, 'DESPACHO', Date.now(), Date.now() + 86_400_000);
  base.close();
  servidor.kill(); await servidor.salida; await sleep(300);
  await arrancar();
  base = new Database(DB);
  ok('al arrancar, la sesión vieja pasa a huella', !base.prepare('SELECT 1 FROM sessions WHERE token = ?').get(viejo) &&
    !!base.prepare('SELECT 1 FROM sessions WHERE token = ?').get(huella(viejo)));
  ok('y el teléfono que la tenía sigue entrando', (await pedir('/admin/users', { headers: { Authorization: 'Bearer ' + viejo } })).status === 200);

  console.log('\nB. DESPACHO NO TOCA OTRA CUENTA DE DESPACHO');
  const tSup = (await login('supA', 'supervisor1')).body.token;
  const HS = { Authorization: 'Bearer ' + tSup };
  let r = await pedir('/admin/users/DESPACHO/password', { method: 'POST', headers: HS, body: JSON.stringify({ password: 'robada12345' }) });
  ok('un supervisor no le cambia la clave a DESPACHO', r.status === 403, r.body);
  r = await pedir('/admin/users/DESPACHO', { method: 'DELETE', headers: HS });
  ok('ni la da de baja', r.status >= 400 && !!base.prepare("SELECT 1 FROM users WHERE unitId = 'DESPACHO'").get(), r.body);
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('supB', 'Supervisor B', 'Supervisor B', 'dispatch', NULL, ?, ?, ?)`).run(emp, hashPassword('supervisor2'), Date.now());
  r = await pedir('/admin/users/supB', { method: 'DELETE', headers: HS });
  ok('ni da de baja a otro supervisor', r.status === 403 && !!base.prepare("SELECT 1 FROM users WHERE unitId = 'supB'").get(), r.body);
  r = await pedir('/admin/users/supA/password', { method: 'POST', headers: HS, body: JSON.stringify({ password: 'otraclave123' }) });
  ok('ni la suya por esta puerta (para eso está su perfil)', r.status === 403, r.body);
  r = await pedir('/admin/users/supA/password', { method: 'POST', headers: HG, body: JSON.stringify({ password: 'nuevaclave123' }) });
  ok('la gerencia sí', r.status === 200, r.body);

  console.log('\nC. EL CHOFER Y EL PRIVADO DE SU COBRADOR');
  for (const [u, rol] of [['pedro', 'driver'], ['rosa', 'collector']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: u, vehicleId: 'M-01', password: 'clave12345', personRole: rol }) });
    if (a.status !== 200) throw new Error('alta ' + u + ': ' + JSON.stringify(a.body));
  }
  const desp = new WebSocket(`ws://localhost:${P}`);
  await new Promise(res => desp.on('open', res));
  desp.send(JSON.stringify({ type: 'identify', token: D }));
  await sleep(500);
  desp.send(JSON.stringify({ type: 'chat', timestamp: Date.now(), text: 'Rosa, contame lo de Pedro', toPerson: 'rosa' }));
  await sleep(500);
  desp.close();
  const historialDe = async (token) => {
    const w = new WebSocket(`ws://localhost:${P}`);
    const vistos = [];
    w.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'chat_history') vistos.push(...(m.items || [])); });
    await new Promise(res => w.on('open', res));
    w.send(JSON.stringify({ type: 'identify', token }));
    await sleep(800);
    w.close();
    return vistos;
  };
  const antes = await historialDe((await login('rosa', 'clave12345')).body.token);
  ok('Rosa ve su privado con Despacho', antes.some(m => m.text === 'Rosa, contame lo de Pedro'));
  const tPedro = (await login('pedro', 'clave12345')).body.token;
  r = await pedir('/perfil/cobradores/rosa/clave', { method: 'POST', headers: { Authorization: 'Bearer ' + tPedro },
    body: JSON.stringify({ nueva: 'pedroentra1' }) });
  ok('Pedro le cambia la clave (sigue pudiendo)', r.status === 200, r.body);
  const despues = await historialDe((await login('rosa', 'pedroentra1')).body.token);
  ok('entrando como Rosa, el privado de antes ya no se ve', !despues.some(m => m.text === 'Rosa, contame lo de Pedro'));

  console.log('\nD. CAMBIAR MI CONTRASEÑA, CON FRENO');
  const HP = { Authorization: 'Bearer ' + tPedro };
  const codigos = [];
  for (let i = 0; i < 7; i++) {
    codigos.push((await pedir('/perfil/clave', { method: 'POST', headers: { ...HP, 'X-Forwarded-For': '10.9.9.9' },
      body: JSON.stringify({ actual: 'noesesta' + i, nueva: 'nuevaclave99' }) })).status);
  }
  ok('cinco 403 y después 429', codigos.slice(0, 5).every(c => c === 403) && codigos.slice(5).every(c => c === 429), codigos);

  console.log('\nE. EL BLOQUEO ES POR ORIGEN');
  for (let i = 0; i < 5; i++) await login('DESPACHO', 'malmalmal' + i, '203.0.113.7');
  r = await login('DESPACHO', 'despacho99', '203.0.113.7');
  ok('desde el origen que probó: bloqueado', r.status === 429, r.status);
  r = await login('DESPACHO', 'despacho99', '198.51.100.20');
  ok('desde otra PC, Despacho entra igual', r.status === 200, r.status);

  console.log('\nF. LAS CLAVES GENERADAS');
  r = await pedir('/admin/users/importar', { method: 'POST', headers: HG,
    body: JSON.stringify({ texto: 'Nombre\tCombi\nJuan Quispe\tM-01', confirmar: true }) });
  const clave = (r.body.filas || []).map(f => f.clave).find(Boolean);
  ok('dos palabras y cuatro números', /^[a-z]+-[a-z]+-\d{4}$/.test(clave || ''), clave || r.body);
  // Una fila OCULTA del Excel (la gente que la cooperativa escondió porque ya
  // no está) no se importa; queda vacía para no correr los números de fila
  const { leerXlsx } = require(RAIZ + '/server/planilla.js');
  const filasOcultas = leerXlsx(fs.readFileSync(S + '/planillas/fila-oculta.xlsx'));
  ok('la planilla con una fila oculta: esa fila no entra', filasOcultas.length === 4 &&
    filasOcultas[2].length === 0 && filasOcultas[3][0] === 'Caro', filasOcultas);
  const html = fs.readFileSync(RAIZ + '/project/despacho.html', 'utf8');
  ok('Despacho sugiere con el azar del navegador, no Math.random',
    /const suggestPassword = \(\) => \{[\s\S]{0,1200}crypto\.getRandomValues/.test(html));

  base.close();
  servidor.kill();
  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
