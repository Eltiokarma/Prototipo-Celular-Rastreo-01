const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const API = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

const entrar = async (user) => {
  const s = await login(user, 'clave1234');
  const ws = new WebSocket('ws://localhost:3001');
  await new Promise(r => ws.on('open', r));
  ws.on('message', () => {});
  ws.send(JSON.stringify({ type: 'identify', token: s.token }));
  await sleep(500);
  return ws;
};

(async () => {
  // Punto de partida limpio: las otras suites conectan choferes y dejan
  // turnos registrados. Sin esto, los totales de acá miden lo de ellas.
  const dbIni = new Database(process.env.DBFILE);
  dbIni.prepare('DELETE FROM shifts').run();
  dbIni.close();

  const tk = (await login('DESPACHO', 'despacho99')).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  const turnos = () => fetch(API + '/admin/shifts', { headers: H }).then(r => r.json());
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, process.env.DBFILE || process.env.DB_FILE) };
  const alta = (b) => fetch(API + '/admin/users', { method: 'POST', headers: HG, body: JSON.stringify(b) });
  await alta({ unitId: 'raul', name: 'Raúl Mamani', alias: 'El Chino', personRole: 'driver', password: 'clave1234' });
  await alta({ unitId: 'maria', name: 'María Quispe', personRole: 'collector', vehicleId: 'raul', password: 'clave1234' });

  const mios = (d) => d.turnos.filter(t => t.personId === 'raul' || t.personId === 'maria');
  let d = await turnos();
  ok('1. Arranca sin turnos', mios(d).length === 0, `${d.turnos.length} en total`);

  // El chofer sube a su unidad
  const chofer = await entrar('raul');
  d = await turnos();
  const t1 = mios(d)[0];
  ok('2. Subir a la unidad abre un turno', mios(d).length === 1 && t1.abierto === true,
     t1 && `${t1.alias || t1.name} en ${t1.vehicleId} · ${t1.role}`);

  // El cobrador sube a la misma
  const cobrador = await entrar('maria');
  d = await turnos();
  ok('3. El cobrador tiene el suyo, en la misma unidad',
     mios(d).length === 2 && d.turnos.some(t => t.personId === 'maria' && t.vehicleId === 'raul' && t.role === 'collector'));

  // Se corta la señal del chofer y vuelve enseguida: NO es un turno nuevo
  chofer.close();
  await sleep(1500);
  d = await turnos();
  const cerrado = d.turnos.find(t => t.personId === 'raul');
  ok('4. Al perder señal el turno queda cerrado', cerrado.abierto === false);

  const choferOtraVez = await entrar('raul');
  d = await turnos();
  const deRaul = d.turnos.filter(t => t.personId === 'raul');
  ok('5. Al volver retoma el MISMO turno, no abre otro',
     deRaul.length === 1 && deRaul[0].abierto === true, `${deRaul.length} turno(s)`);

  // El total por persona
  await sleep(1200);
  d = await turnos();
  const p = d.personas.find(x => x.personId === 'raul');
  ok('6. Suma las horas por persona', p && p.turnos === 1 && p.totalSec >= 2,
     p && `${p.alias} · ${p.totalSec}s · unidades: ${p.vehiculos.join(',')}`);

  // Un turno sigue abierto mientras la persona está arriba
  ok('7. El turno abierto cuenta el tiempo hasta ahora',
     d.turnos.find(t => t.personId === 'raul').duracionSec >= 2);

  // ── Reinicio del servidor con turnos abiertos
  const db = new Database(process.env.DBFILE);
  const antes = db.prepare(
    "SELECT COUNT(*) c FROM shifts WHERE endedAt IS NULL AND personId IN ('raul','maria')").get().c;
  ok('8. Hay turnos abiertos antes de reiniciar', antes === 2, antes + ' abiertos');
  choferOtraVez.close(); cobrador.close();
  db.close();
  console.log('   (el reinicio se prueba aparte)');
  process.exit(0);
})();
