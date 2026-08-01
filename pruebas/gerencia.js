// El gerente MIRA y no toca. Esta suite prueba los dos lados de esa frase:
// que vea lo suyo, y que no pueda hacer nada más — ni administrar, ni entrar
// al tiempo real, ni asomarse a la cooperativa de al lado.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn, execFileSync } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/gerencia-test.db';
const P = 3131;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const cli = (...args) => execFileSync('node', [RAIZ + '/server/empresa.js', ...args],
  { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const pedir = (ruta, token, opts = {}) => fetch(API + ruta, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  // Dos cooperativas, cada una con su ruta, su despacho y su gerente
  cli('ruta', 'R14', 'R-99', 'Segunda ruta');
  cli('gerencia', 'R14', 'GER-EMPRESA', 'claveGerente1');            // toda la cooperativa
  cli('gerencia', 'R14', 'GER-RUTA', 'claveGerente2', '--ruta', 'R-14'); // solo R-14
  cli('alta', 'COOP-B', 'Cooperativa Beta', '--ruta', 'RB-1',
    '--despacho', 'DESP-B', '--clave', 'clavebeta12');
  cli('gerencia', 'COOP-B', 'GER-B', 'claveGerente3');

  // Una vuelta en cada ruta, para que haya algo que ver y algo que NO ver
  const db = new Database(DB);
  const vari = (r) => {
    const v = db.prepare('SELECT variantId FROM route_variants WHERE routeId = ? AND activa = 1').get(r);
    return v ? v.variantId : null;
  };
  const meter = (unit, ruta, brecha) => db.prepare(
    `INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm)
     VALUES (?, ?, ?, ?, ?, 3000, 22, ?)`
  ).run(unit, ruta, vari(ruta), Date.now() - 3000e3, Date.now() - 60e3, brecha);
  meter('M-01', 'R-14', 120);
  meter('M-02', 'R-14', 300);
  meter('N-01', 'R-99', 120);
  meter('B-01', 'RB-1', 120);
  db.close();

  console.log('\nLA PUERTA');
  const G = (await login('GER-EMPRESA', 'claveGerente1')).body;
  ok('el gerente entra y su rol lo dice', G.role === 'manager', G.role);
  ok('y trae su cooperativa', G.companyId === 'R14', G.companyId);
  ok('no queda marcado como supervisor de Despacho', !G.supervisor);

  const D = (await login('DESPACHO', 'despacho99')).body;

  console.log('\nMIRA LO SUYO');
  {
    const r = await pedir('/gerencia/resumen', G.token);
    ok('el resumen responde', r.status === 200, r.status);
    ok('con las dos rutas de su cooperativa', r.body.rutas.length === 2,
      r.body.rutas && r.body.rutas.map(x => x.routeId));
    ok('y las vueltas de las dos, no la de la otra cooperativa',
      r.body.totales.vueltas === 3, r.body.totales.vueltas);
    ok('el alcance dice que no está fijado a una ruta',
      r.body.alcance.routeId === null && r.body.alcance.fijo === false, r.body.alcance);
    ok('cada ruta viene con su objetivo, no con un promedio',
      r.body.rutas.every(x => typeof x.objetivoSec === 'number'), r.body.rutas);
    // M-01 en 2:00 contra objetivo 2:00 cumple; M-02 en 5:00 no
    ok('el cumplimiento sale de comparar cada vuelta con el objetivo de SU ruta',
      r.body.totales.cumplimiento === 67, r.body.totales.cumplimiento);
    ok('compara unidad por unidad', r.body.porUnidad.length === 3,
      r.body.porUnidad.map(u => u.unitId));
  }

  console.log('\nUN GERENTE DE RUTA NO VE LAS OTRAS RUTAS DE SU EMPRESA');
  {
    const GR = (await login('GER-RUTA', 'claveGerente2')).body;
    const r = await pedir('/gerencia/resumen', GR.token);
    ok('solo ve la suya', r.body.rutas.length === 1 && r.body.rutas[0].routeId === 'R-14',
      r.body.rutas.map(x => x.routeId));
    ok('y solo sus vueltas', r.body.totales.vueltas === 2, r.body.totales.vueltas);
    ok('la pantalla sabe que el alcance está fijado', r.body.alcance.fijo === true);
    // Pedir la otra ruta de su propia empresa no la abre: el alcance manda
    const otra = await pedir('/gerencia/resumen?routeId=R-99', GR.token);
    ok('pedir otra ruta de su empresa no se la muestra',
      otra.body.rutas.length === 1 && otra.body.rutas[0].routeId === 'R-14',
      otra.body.rutas.map(x => x.routeId));
  }

  console.log('\nNO VE LA COOPERATIVA DE AL LADO');
  {
    const ajena = await pedir('/gerencia/resumen?routeId=RB-1', G.token);
    ok('una ruta ajena se responde como inexistente, no vacía', ajena.status === 404, ajena.status);
    const GB = (await login('GER-B', 'claveGerente3')).body;
    const suyo = await pedir('/gerencia/resumen', GB.token);
    ok('el gerente de la otra ve la suya y nada más',
      suyo.body.totales.vueltas === 1 && suyo.body.rutas[0].routeId === 'RB-1',
      { vueltas: suyo.body.totales.vueltas, rutas: suyo.body.rutas.map(x => x.routeId) });
  }

  console.log('\nY NO TOCA NADA');
  {
    const rutas = [
      ['GET', '/admin/users'], ['GET', '/admin/routes'], ['GET', '/admin/vueltas'],
      ['GET', '/admin/metrics'], ['GET', '/admin/audit'], ['GET', '/admin/company'],
    ];
    for (const [m, ruta] of rutas) {
      const r = await pedir(ruta, G.token, { method: m });
      ok(`${ruta} le responde 403 y no 401`, r.status === 403, r.status);
    }
    const alta = await pedir('/admin/users', G.token, {
      method: 'POST', body: JSON.stringify({ unitId: 'X-99', name: 'Colado', password: 'clave1234' }),
    });
    ok('no puede dar de alta a nadie', alta.status === 403, alta.status);

    // Y al revés: el token de Despacho no sirve en gerencia
    const alReves = await pedir('/gerencia/resumen', D.token);
    ok('el token de Despacho no abre gerencia', alReves.status === 403, alReves.status);

    // Un token inventado no distingue: 401 y afuera
    const sinNada = await pedir('/gerencia/resumen', 'token-de-la-nada');
    ok('sin sesión válida es 401, no 403', sinNada.status === 401, sinNada.status);
  }

  console.log('\nNO ENTRA AL TIEMPO REAL');
  {
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    const respuesta = await new Promise((resolve) => {
      const reloj = setTimeout(() => resolve({ tipo: 'silencio' }), 3000);
      ws.on('message', (d) => {
        clearTimeout(reloj);
        resolve(JSON.parse(String(d)));
      });
      ws.send(JSON.stringify({ type: 'identify', token: G.token }));
    });
    ok('el WebSocket lo rechaza y le dice por qué',
      respuesta.type === 'auth_error' && /gerencia/i.test(respuesta.error || ''),
      respuesta);
    await sleep(300);
    ok('y le cierra la conexión', ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING,
      ws.readyState);
    try { ws.close(); } catch {}
  }

  console.log('\nDESPACHO LO VE PERO NO LO TOCA');
  {
    const lista = await pedir('/admin/users', D.token);
    const g = lista.body.users.find(u => u.unitId === 'GER-EMPRESA');
    ok('el gerente figura en la lista de personas', !!g, lista.body.users.map(u => u.unitId));
    ok('con su rol a la vista', g && g.role === 'manager', g && g.role);

    const clave = await pedir('/admin/users/GER-EMPRESA/password', D.token, {
      method: 'POST', body: JSON.stringify({ password: 'otraclave123' }),
    });
    ok('Despacho no le puede resetear la clave', clave.status === 403, clave.status);
    ok('y el error dice de dónde se maneja', /nivel de arriba/i.test(clave.body.error || ''), clave.body.error);

    const baja = await pedir('/admin/users/GER-EMPRESA', D.token, { method: 'DELETE' });
    ok('ni darlo de baja', baja.status === 403, baja.status);

    const identidad = await pedir('/admin/users/GER-EMPRESA/identity', D.token, {
      method: 'POST', body: JSON.stringify({ name: 'Colado' }),
    });
    ok('ni cambiarle el nombre', identidad.status === 403, identidad.status);

    // La clave vieja tiene que seguir funcionando después de los tres intentos
    const sigue = await login('GER-EMPRESA', 'claveGerente1');
    ok('y la cuenta sigue entrando con su clave de siempre', sigue.status === 200, sigue.status);
  }

  console.log('\nLOS CONTEOS NO LO MEZCLAN CON LOS CHOFERES');
  {
    const emp = await pedir('/admin/company', D.token);
    ok('personas cuenta la gente de las combis', emp.body.resumen.personas === 0, emp.body.resumen);
    ok('y gerencia va aparte', emp.body.resumen.gerencia === 2, emp.body.resumen.gerencia);
  }

  console.log('\nEL INFORME');
  {
    const csv = await fetch(`${API}/gerencia/informe/vueltas.csv?desde=${Date.now() - 86400e3}&hasta=${Date.now()}`,
      { headers: { Authorization: 'Bearer ' + G.token } }).then(r => r.text());
    ok('baja el mismo archivo que Despacho', /Informe de vueltas/.test(csv));
    ok('firmado por quien lo pidió', /GER-EMPRESA/.test(csv), csv.split('\r\n')[3]);
    ok('con el nombre de su cooperativa', /Cooperativa de Transportes Juliaca/.test(csv), csv.split('\r\n')[0]);
    const ajeno = await fetch(`${API}/gerencia/informe/vueltas.csv?routeId=RB-1`,
      { headers: { Authorization: 'Bearer ' + G.token } });
    ok('y no puede pedir el de otra cooperativa', ajeno.status === 404, ajeno.status);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
