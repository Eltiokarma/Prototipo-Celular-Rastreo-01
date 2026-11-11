// La base, el volumen y el disco lleno (auditoría del 11/11).
//
//   A. En producción el servidor no arranca sin DB_FILE ni con la carpeta
//      del volumen inexistente (antes creaba la carpeta y arrancaba con una
//      base vacía en el disco del contenedor, con /salud en 200).
//   B. /salud da problema (503) si la base está en el mismo disco que la
//      aplicación; en la demo es un aviso, y BASE_EN_DISCO_DE_APP lo permite.
//   C. El respaldo mira el disco antes de escribir: borra respaldos viejos
//      para hacer lugar y, si aun así no entra, no lo intenta.
//   D. Con el disco lleno de verdad (un tmpfs de 4 MB): el chofer que empieza
//      turno aparece en el mapa (antes 500), el SOS sale con id y se puede
//      marcar ATENDIDO, y el barrido sigue. Si el sistema no deja montar un
//      tmpfs, D se saltea y se dice.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execFileSync } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { crearSalud } = require(RAIZ + '/server/salud.js');
const respaldo = require(RAIZ + '/server/respaldo.js');

const P = 3247;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TMP = path.join(S, 'disco-tmp');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const limpiarCarpeta = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} };

function arrancarProduccion(env) {
  const r = spawnSync('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), MODO: '', DISPATCH_PASSWORD: '', ...env },
    encoding: 'utf8', timeout: 20000,
  });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  limpiarCarpeta(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  console.log('\nA. PRODUCCIÓN SIN VOLUMEN');
  let r = arrancarProduccion({ DB_FILE: '' });
  ok('sin DB_FILE no arranca', r.codigo === 1 && /falta DB_FILE/.test(r.salida), r.codigo);
  const sinMontar = path.join(TMP, 'volumen-que-no-existe', 'r14.db');
  r = arrancarProduccion({ DB_FILE: sinMontar });
  ok('con la carpeta del volumen inexistente no arranca', r.codigo === 1 && /el volumen no está montado/.test(r.salida), r.codigo);
  ok('y no la crea', !fs.existsSync(path.dirname(sinMontar)));

  console.log('\nB. /salud MIRA EN QUÉ DISCO ESTÁ LA BASE');
  const archivo = path.join(TMP, 'b.db');
  const db = new Database(archivo);
  const dirApp = TMP;   // mismo disco que la base, a propósito
  let sal = crearSalud({ db, dirApp, medirBucle: false }).chequear();
  ok('en producción, base en el disco de la app: problema', sal.problemas.includes('base_en_disco_de_app'), sal.problemas);
  sal = crearSalud({ db, dirApp, demo: true, medirBucle: false }).chequear();
  ok('en la demo es un aviso', sal.avisos.includes('base_en_disco_de_app') && !sal.problemas.includes('base_en_disco_de_app'));
  sal = crearSalud({ db, dirApp, permitirDiscoDeApp: true, medirBucle: false }).chequear();
  ok('BASE_EN_DISCO_DE_APP=1 lo permite', ![...sal.problemas, ...sal.avisos].includes('base_en_disco_de_app'));
  db.close();

  console.log('\nC. EL RESPALDO MIRA EL DISCO');
  const archivoR = path.join(TMP, 'r.db');
  const dbr = new Database(archivoR);
  dbr.exec('CREATE TABLE users (x); CREATE TABLE routes (x); CREATE TABLE companies (x);');
  const carpeta = path.join(TMP, 'respaldos');
  for (let i = 0; i < 3; i++) {
    const x = await respaldo.respaldar(dbr, Database, { dir: carpeta, cuando: new Date(Date.UTC(2026, 10, 1, i)) });
    if (!x.ok) throw new Error('respaldo de base: ' + x.motivo);
  }
  ok('hay tres respaldos', respaldo.listar(carpeta).length === 3);
  let x = await respaldo.respaldar(dbr, Database, { dir: carpeta, libreBytes: () => 1000 });
  ok('sin lugar: no lo intenta y lo dice', !x.ok && x.sinLugar && /no hay disco para el respaldo/.test(x.motivo), x.motivo);
  ok('antes borró los viejos para hacer lugar, pero dejó el último', respaldo.listar(carpeta).length === 1);
  x = await respaldo.respaldar(dbr, Database, { dir: carpeta, libreBytes: () => 10 * 1024 ** 3 });
  ok('con lugar, respalda', x.ok, x.motivo);
  dbr.close();

  console.log('\nD. EL DISCO LLENO DE VERDAD');
  const vol = path.join(TMP, 'vol');
  fs.mkdirSync(vol, { recursive: true });
  let montado = false;
  try { execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=4m', 'tmpfs', vol], { stdio: 'ignore' }); montado = true; } catch {}
  if (!montado) {
    console.log('  (no se pudo montar un tmpfs: se saltea D)');
  } else {
    let servidor = null;
    try {
      servidor = spawn('node', [RAIZ + '/server/index.js'], {
        env: { ...process.env, PORT: String(P), DB_FILE: path.join(vol, 'r14.db'), DISPATCH_PASSWORD: 'despacho99',
               MODO: 'demo', RESPALDO_CADA_H: '0', SIN_SENAL_MS: '2000', OLVIDAR_MS: '60000' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      servidor.stderr.on('data', () => {});
      for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
      const pedir = (ruta, o = {}) => fetch(API + ruta,
        { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
        .then(async q => ({ status: q.status, body: await q.json().catch(() => ({})) }));
      const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body.token;
      const base = new Database(path.join(vol, 'r14.db'));
      const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
      base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
        .run('M-01', 'Z1A-701', 'R-14', emp, Date.now());
      base.close();
      await pedir('/admin/users', { method: 'POST', headers: { Authorization: 'Bearer ' + D },
        body: JSON.stringify({ unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' }) });
      const T = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'pedro', password: 'clave12345' }) })).body.token;
      const panel = new WebSocket(`ws://localhost:${P}`);
      panel.visto = [];
      panel.on('message', m => { try { panel.visto.push(JSON.parse(m)); } catch {} });
      await new Promise(res => panel.on('open', res));
      panel.send(JSON.stringify({ type: 'identify', token: D }));
      await sleep(500);

      // Se llena el disco: un archivo que ocupa todo lo que queda
      const st = fs.statfsSync(vol);
      const libre = st.bavail * st.bsize;
      try { fs.writeFileSync(path.join(vol, 'relleno'), Buffer.alloc(Math.max(0, libre - 4096))); } catch {}
      try { fs.writeFileSync(path.join(vol, 'relleno2'), Buffer.alloc(8192)); } catch {}
      ok('el disco quedó lleno', fs.statfsSync(vol).bavail * fs.statfsSync(vol).bsize < 16384);

      const g = await pedir('/gps', { method: 'POST', headers: { Authorization: 'Bearer ' + T },
        body: JSON.stringify({ posiciones: [{ lat: -15.49, lng: -70.133, speed: 20, timestamp: Date.now() }], presencia: 'ruta' }) });
      ok('el chofer que empieza turno no recibe 500', g.status === 200, [g.status, g.body.error]);
      // Un observador nuevo recibe el estado al identificarse
      const obs = new WebSocket(`ws://localhost:${P}`);
      obs.visto = [];
      obs.on('message', m => { try { obs.visto.push(JSON.parse(m)); } catch {} });
      await new Promise(res => obs.on('open', res));
      obs.send(JSON.stringify({ type: 'identify', token: D }));
      await sleep(900);
      obs.close();
      const estado = obs.visto.filter(m => m.type === 'state').pop();
      ok('y aparece en el mapa', !!estado && (estado.units || []).some(u => u.unitId === 'M-01'),
        estado && (estado.units || []).map(u => u.unitId));

      const s = await pedir('/sos', { method: 'POST', headers: { Authorization: 'Bearer ' + T },
        body: JSON.stringify({ lat: -15.49, lng: -70.133, timestamp: Date.now() }) });
      const sosId = s.body.sosId ?? s.body.alerta?.sosId;
      ok('el SOS sale con id aunque no se pudo guardar', s.status === 200 && Number(sosId) < 0, s.body);
      await sleep(300);
      ok('el panel lo recibe con ese id', panel.visto.some(m => m.type === 'sos_alert' && m.sosId === sosId));
      panel.send(JSON.stringify({ type: 'sos_atender', sosId }));
      await sleep(600);
      ok('y se puede marcar ATENDIDO', panel.visto.some(m => m.type === 'sos_atendido' && m.sosId === sosId));

      // El barrido (cada 10 s) pasa a «sin señal» y quiere guardar el corte
      await sleep(12000);
      const t0 = Date.now();
      const ping = await fetch(API + '/ping').then(q => q.ok, () => false);
      ok('el barrido no tumbó nada: el servidor contesta', ping && Date.now() - t0 < 500);
      const salud = await fetch(API + '/salud').then(q => q.json(), () => null);
      ok('/salud dice que el disco se acabó', !!salud && [...(salud.problemas || [])].some(p => /disco_lleno|base_no_escribe|errores_de_base/.test(p)), salud && salud.problemas);
      panel.close();
    } finally {
      if (servidor) { servidor.kill(); await sleep(500); }
      try { execFileSync('umount', [vol], { stdio: 'ignore' }); } catch {}
    }
  }

  limpiarCarpeta(TMP);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { execFileSync('umount', [path.join(TMP, 'vol')], { stdio: 'ignore' }); } catch {}
  process.exit(1);
});
