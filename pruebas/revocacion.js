// Los accesos revocados se quedan revocados (revisión del 15/11).
//
//   A. SEG-04: un login que estaba verificando la clave mientras Despacho
//      la cambiaba no puede terminar creando una sesión con la clave vieja.
//      Antes la fila se leía antes del scrypt y no se releía: la sesión
//      nacía DESPUÉS de que `kickUnit` borrara las demás, y valía.
//   B. SEG-05: volver a un respaldo no revive las sesiones que traía.
//      Antes la base se restauraba entera, con las sesiones de esa fecha,
//      y un teléfono robado o una clave reseteada después volvía a entrar.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const { restaurarAlArrancar } = require(RAIZ + '/server/restaurar.js');
const respaldo = require(RAIZ + '/server/respaldo.js');

const P = 3253;
const API = `http://localhost:${P}`;
const TMP = path.join(S, 'revocacion-tmp');
const DB = path.join(TMP, 'r14.db');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const pedir = (ruta, o = {}) => fetch(API + ruta, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
// Cada intento desde su propio origen: el freno por origen no es lo que se
// prueba acá.
const login = (u, c, ip) => pedir('/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': ip },
  body: JSON.stringify({ user: u, password: c }) });

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', TRUST_PROXY: '1',
           RESPALDO_CADA_H: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.salida = new Promise(r => servidor.on('exit', r));
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); return; } catch {} }
  throw new Error('el servidor no arrancó');
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  console.log('\nA. EL LOGIN QUE ESTABA EN CURSO CUANDO CAMBIÓ LA CLAVE');
  await arrancar();
  try {
    const D = (await login('DESPACHO', 'despacho99', '10.9.0.1')).body.token;
    const HD = { Authorization: 'Bearer ' + D };
    { const b = new Database(DB);
      const emp = b.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
      b.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
        .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
      b.close(); }
    const alta = await pedir('/admin/users', { method: 'POST', headers: HD,
      body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave-vieja-1' }) });
    if (alta.status !== 200) throw new Error('alta: ' + JSON.stringify(alta.body));

    // Varios logins con la clave buena a la vez: el scrypt va al pool de
    // libuv (4 hilos), así que mientras el reseteo entra quedan logins con la
    // fila vieja en la mano esperando su verificación. Es la ventana del bug.
    const N = 16;
    const enCurso = [];
    for (let i = 0; i < N; i++) enCurso.push(login('pedro', 'clave-vieja-1', `10.9.1.${i + 1}`));
    await sleep(5);
    const reseteo = await pedir('/admin/users/pedro/password', { method: 'POST', headers: HD,
      body: JSON.stringify({ password: 'clave-nueva-2' }) });
    ok('Despacho cambia la clave', reseteo.status === 200, reseteo.body);
    const r = await Promise.all(enCurso);
    const tokens = r.filter(x => x.status === 200).map(x => x.body.token);
    const rechazados = r.filter(x => x.status === 401).length;
    const vigentes = [];
    for (const t of tokens) {
      if ((await pedir('/perfil', { headers: { Authorization: 'Bearer ' + t } })).status === 200) vigentes.push(t);
    }
    ok('ningún login con la clave vieja deja una sesión que valga', vigentes.length === 0,
      { emitidas: tokens.length, siguenValiendo: vigentes.length, rechazados });
    // Sin esto la prueba podría pasar por no haber ejercitado la carrera
    ok('la carrera se dio: hubo logins verificando cuando cambió la clave', rechazados > 0,
      { emitidas: tokens.length, rechazados });
    const nueva = await login('pedro', 'clave-nueva-2', '10.9.2.1');
    ok('con la clave nueva entra', nueva.status === 200, nueva.status);
    const vieja = await login('pedro', 'clave-vieja-1', '10.9.2.2');
    ok('con la vieja ya no', vieja.status === 401, vieja.status);

    // Lo mismo con la BAJA: un login en curso no deja una sesión huérfana
    // que reviviría si alguien reusa el nombre.
    const alta2 = await pedir('/admin/users', { method: 'POST', headers: HD,
      body: JSON.stringify({ unitId: 'juana', name: 'Juana Quispe', vehicleId: 'M-01', password: 'clave-juana-1' }) });
    if (alta2.status !== 200) throw new Error('alta: ' + JSON.stringify(alta2.body));
    const enCurso2 = [];
    for (let i = 0; i < N; i++) enCurso2.push(login('juana', 'clave-juana-1', `10.9.3.${i + 1}`));
    await sleep(5);
    const baja = await pedir('/admin/users/juana', { method: 'DELETE', headers: HD });
    ok('Despacho da de baja la cuenta', baja.status === 200, baja.body);
    await Promise.all(enCurso2);
    const base = new Database(DB, { readonly: true });
    const huerfanas = base.prepare("SELECT COUNT(*) AS c FROM sessions WHERE unitId = 'juana'").get().c;
    base.close();
    ok('y ningún login en curso deja una sesión de la cuenta borrada', huerfanas === 0, huerfanas);
  } finally {
    servidor.kill(); await servidor.salida;
  }

  console.log('\nB. VOLVER A UN RESPALDO NO REVIVE SESIONES');
  {
    // Una base con una sesión viva y su respaldo, tomado en ese momento
    const vieja = path.join(TMP, 'b.db');
    const d = new Database(vieja);
    d.exec(`CREATE TABLE users (unitId TEXT PRIMARY KEY, passHash TEXT);
            CREATE TABLE routes (routeId TEXT); CREATE TABLE companies (companyId TEXT);
            CREATE TABLE sessions (token TEXT PRIMARY KEY, unitId TEXT, createdAt INTEGER, expiresAt INTEGER);`);
    d.prepare('INSERT INTO users VALUES (?, ?)').run('pedro', hashPassword('clave-vieja-1'));
    const robado = crypto.createHash('sha256').update('token-del-telefono-robado').digest('hex');
    d.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(robado, 'pedro', Date.now(), Date.now() + 30 * 86_400_000);
    const dir = respaldo.dirDe(vieja);
    fs.mkdirSync(dir, { recursive: true });
    const nombre = respaldo.nombreDe(new Date(Date.UTC(2026, 10, 1)));
    await d.backup(path.join(dir, nombre));
    // Después: le roban el teléfono y Despacho cierra sus sesiones
    d.prepare('DELETE FROM sessions').run();
    d.close();
    const log = [];
    const x = await restaurarAlArrancar({ dbFile: vieja, pedido: 'local:' + nombre, log: (l) => log.push(l) });
    ok('restaura', x && !x.repetido, x);
    const r = new Database(vieja, { readonly: true });
    const sesiones = r.prepare('SELECT COUNT(*) AS c FROM sessions').get().c;
    const usuarios = r.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    r.close();
    ok('la sesión que traía el respaldo no vuelve', sesiones === 0, sesiones);
    ok('el resto de la base sí', usuarios === 1, usuarios);
    ok('el log dice que todos vuelven a ingresar y qué hay que repetir',
      log.some(l => /Se cerraron las 1 sesiones/.test(l) && /repetí esos cambios/.test(l)), log);
    ok('la marca lo anota', x.marca && x.marca.sesionesCerradas === 1, x.marca);
    ok('no quedan archivos de trabajo sueltos', !fs.readdirSync(TMP).some(n => /restaurando/.test(n)), fs.readdirSync(TMP));
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FALLA  ' + (e && e.stack || e));
  try { servidor && servidor.kill(); } catch {}
  process.exit(1);
});
