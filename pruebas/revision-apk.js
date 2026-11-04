// Lo que encontró la revisión previa a la APK (31/10), en el servidor.
//
// Cuatro revisiones en paralelo (servidor nuevo, app nativa, web, operación)
// reprodujeron contra el servidor de verdad casi todo lo de acá. Cada caso es
// el escenario que lo rompía:
//
//   - un reinicio borraba la marca del relevado: Juan, desde su casa, le
//     volvía a sacar la combi a Pedro, que la estaba manejando;
//   - la marca vencía a las 6 h aunque el otro siguiera manejando;
//   - la salida automática del vigía (y la re-declaración de una reconexión)
//     relevaba al que manejaba;
//   - «fuera» dejaba el socket como el que reporta y una segunda conexión lo
//     heredaba;
//   - dos conexiones de la misma persona se robaban el GPS en cada posición;
//   - la combi cambiada por Despacho con la app cerrada no llegaba al teléfono;
//   - el Despacho de ruta nunca recibía la puerta, y la puerta contaba la
//     media hora desde la entrada y no desde que se perdió la app;
//   - un usuario reusado leía el privado personal del anterior;
//   - el comodín de la ruta le cambiaba la clave al cobrador de cualquier
//     combi y entraba como él;
//   - la sesión vencía a los 30 días aunque se usara;
//   - en producción, una base que no abre se reemplazaba por una vacía;
//   - Despacho con «personal» y sin persona escribía al grupo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const fs = require('fs');

const DB = S + '/revision-apk.db';
const P = 3181;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar(env = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      STATE_INTERVAL_MS: '300', RELEVO_MAX_MS: '60000', PUERTA_SIN_SOCKET_MS: '2500', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const parar = async () => { servidor.kill('SIGKILL'); await sleep(500); };
const pedir = (ruta, token, opts = {}) => fetch(`http://localhost:${P}${ruta}`, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });
const entrar = async (u, clave = 'clave12345') => (await post('/auth/login', null, { user: u, password: clave })).body.token;

async function conectar(token, mirar = null) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => ws.visto.push(JSON.parse(raw)));
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  if (mirar) ws.send(JSON.stringify({ type: 'watch', routeId: mirar }));
  await sleep(350);
  return ws;
}
const mandar = (ws, m) => ws.send(JSON.stringify(m));
const rol = (ws) => [...ws.visto].reverse().find(m => m.type === 'gps_role') || null;
const CALLE = { lat: -15.4900, lng: -70.1330 }, CASA = { lat: -15.5200, lng: -70.1600 };
const turnos = () => { const d = new Database(DB, { readonly: true });
  const r = d.prepare('SELECT personId FROM shifts WHERE endedAt IS NULL ORDER BY personId').all().map(t => t.personId); d.close(); return r; };

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const base = new Database(DB);
  const empresa = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  const altaV = base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)');
  for (const v of ['M-01', 'M-02', 'M-05', 'M-07']) altaV.run(v, null, 'R-14', empresa, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-14', 'Despacho 14', 'Despacho 14', 'dispatch', 'R-14', ?, ?, ?)`)
    .run(empresa, hashPassword('despacho14'), Date.now());
  base.close();
  for (const [u, n, v, rolP] of [['juan', 'Juan', 'M-01'], ['pedro', 'Pedro', 'M-01'], ['ana', 'Ana', 'M-02'],
    ['luz', 'Luz', 'M-05'], ['rosa', 'Rosa', 'M-07', 'collector'], ['tito', 'Tito', 'M-02']]) {
    const a = await post('/admin/users', HG, { unitId: u, name: n, vehicleId: v, password: 'clave12345', personRole: rolP || 'driver' });
    if (a.status !== 200) throw new Error(`alta de ${u}: ${JSON.stringify(a.body)}`);
  }
  const tJuan = await entrar('juan'), tPedro = await entrar('pedro');

  console.log('\nEL RELEVO SOBREVIVE A UN REINICIO');
  let juan = await conectar(tJuan);
  mandar(juan, { type: 'presencia', estado: 'ruta' });
  let pedro = await conectar(tPedro);
  await sleep(200);
  mandar(pedro, { type: 'presencia', estado: 'ruta' });     // el relevo
  await sleep(300);
  juan.close(); pedro.close();
  await parar();
  await arrancar();
  // Pedro reconecta primero y manda; después Juan abre la app en su casa
  pedro = await conectar(tPedro);
  mandar(pedro, { type: 'presencia', estado: 'ruta', redeclara: true });
  mandar(pedro, { type: 'gps', ...CALLE, speed: 20 });
  await sleep(300);
  juan = await conectar(tJuan);
  mandar(juan, { type: 'presencia', estado: 'ruta', redeclara: true });
  mandar(juan, { type: 'gps', ...CASA, speed: 0 });
  await sleep(400);
  ok('después del reinicio, Juan sigue sin poder recuperarla', rol(juan)?.reporting === false && rol(juan)?.relevado === true, rol(juan));
  ok('y Pedro la sigue manejando', rol(pedro)?.reporting === true && turnos().includes('pedro') && !turnos().includes('juan'), turnos());
  // Y aunque Juan llegue PRIMERO (la app vieja, sin `redeclara`)
  juan.close(); pedro.close();
  await parar();
  await arrancar();
  juan = await conectar(tJuan);
  mandar(juan, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('ni llegando primero después del reinicio (APK vieja, sin redeclara)', rol(juan)?.reporting === false, rol(juan));
  pedro = await conectar(tPedro);
  mandar(pedro, { type: 'presencia', estado: 'ruta' });
  mandar(pedro, { type: 'gps', ...CALLE, speed: 20 });
  await sleep(300);

  console.log('\nLA MARCA NO VENCE MIENTRAS EL OTRO MANEJA');
  // Ahora con RELEVO_MAX_MS = 3 s: la marca de Juan ya pasó ese tiempo, y
  // aun así se carga al arrancar porque Pedro todavía puede estar manejando
  juan.close(); pedro.close();
  await parar();
  await arrancar({ RELEVO_MAX_MS: '3000' });
  pedro = await conectar(tPedro);
  mandar(pedro, { type: 'presencia', estado: 'ruta', redeclara: true });
  mandar(pedro, { type: 'gps', ...CALLE, speed: 20 });
  await sleep(300);
  for (let i = 0; i < 8; i++) { mandar(pedro, { type: 'gps', ...CALLE, speed: 20 }); await sleep(500); }
  juan = await conectar(tJuan);
  mandar(juan, { type: 'presencia', estado: 'ruta' });
  await sleep(300);
  ok('pasadas las «6 h» con Pedro manejando, Juan sigue sin poder', rol(juan)?.reporting === false && rol(pedro)?.reporting === true);

  console.log('\nLA SALIDA AUTOMÁTICA NO RELEVA');
  const tAna = await entrar('ana'), tTito = await entrar('tito');
  const ana = await conectar(tAna);
  mandar(ana, { type: 'presencia', estado: 'ruta' });
  mandar(ana, { type: 'gps', ...CALLE, speed: 20 });
  const tito = await conectar(tTito);
  mandar(tito, { type: 'presencia', estado: 'ruta', motivo: 'auto' });   // Tito va de pasajero en M-02
  await sleep(300);
  ok('el vigía de Tito no le saca la combi a Ana', rol(ana)?.reporting === true && rol(tito)?.reporting === false, rol(tito));
  ok('y se le dice quién la maneja', /Ana está manejando esta combi/.test(rol(tito)?.reason || ''), rol(tito)?.reason);
  let r = await post('/presencia', tTito, { estado: 'ruta', motivo: 'auto' });
  ok('por HTTP, igual', r.body.ignorada === true && r.body.gpsRole === false, r.body);
  mandar(tito, { type: 'presencia', estado: 'ruta', redeclara: true });
  await sleep(200);
  ok('ni la re-declaración de una reconexión', rol(ana)?.reporting === true && !turnos().includes('tito'), turnos());
  mandar(tito, { type: 'presencia', estado: 'ruta' });                    // SALIR A RUTA de verdad: relevo
  await sleep(300);
  ok('SALIR A RUTA tocado a mano sí es un relevo', rol(tito)?.reporting === true && rol(ana)?.reporting === false);
  ok('y el aviso del relevo dice cómo volver', /SALIR DE RUTA y después SALIR A RUTA/.test(rol(ana)?.reason || '') && rol(ana)?.relevado === true, rol(ana));

  console.log('\nFUERA SUELTA EL SOCKET');
  const tLuz = await entrar('luz');
  const luz1 = await conectar(tLuz);
  mandar(luz1, { type: 'presencia', estado: 'ruta' });
  mandar(luz1, { type: 'gps', ...CALLE, speed: 20 });
  await sleep(200);
  mandar(luz1, { type: 'presencia', estado: 'fuera' });
  await sleep(200);
  const luz2 = await conectar(tLuz);
  luz1.close();
  await sleep(500);
  ok('al cerrarse la conexión vieja, la nueva NO hereda un mando que ya no hay', !luz2.visto.some(m => m.type === 'gps_role' && m.reporting === true), luz2.visto.filter(m => m.type === 'gps_role'));
  r = await pedir('/mis-combis', tLuz);
  ok('y Luz no figura en ruta (puede cambiar de combi)', r.body.enRuta === false, r.body);
  luz2.close();

  console.log('\nDOS CONEXIONES DE LA MISMA PERSONA');
  const tablet = pedro;                                   // Pedro maneja M-01 por la tablet
  const tel = await conectar(tPedro);                    // y se identifica el teléfono
  await sleep(200);
  for (let i = 0; i < 4; i++) {
    mandar(tablet, { type: 'gps', ...CASA, speed: 0 });
    mandar(tel, { type: 'gps', lat: CALLE.lat + i * 0.0002, lng: CALLE.lng, speed: 20 });
    await sleep(250);
  }
  const rolesTablet = tablet.visto.filter(m => m.type === 'gps_role');
  ok('la tablet no le saca el GPS al teléfono en cada posición', rolesTablet.slice(-1)[0]?.reporting === false &&
     rolesTablet.filter(m => m.reporting === true).length <= 2, rolesTablet.map(m => m.reporting));
  tablet.close();

  console.log('\nLA COMBI DE HOY LLEGA AL CONECTAR');
  mandar(tel, { type: 'presencia', estado: 'fuera' });   // terminó y cerró la app
  await sleep(200);
  tel.close();
  await sleep(300);
  r = await post('/admin/users/pedro/combis', D, { combis: ['M-01', 'M-05'], actual: 'M-05' });
  if (r.status !== 200) console.log('   (Despacho no pudo cambiarla:', r.status, JSON.stringify(r.body) + ')');
  const pedro2 = await conectar(tPedro);
  const combi = pedro2.visto.find(m => m.type === 'combi');
  ok('con la app cerrada Despacho le cambió la combi: al conectar se la dice', combi?.vehicleId === 'M-05', combi);
  pedro2.close();

  console.log('\nLA PUERTA');
  const d14 = await conectar(await entrar('DESP-14', 'despacho14'), 'R-14');
  const tRosa = await entrar('rosa');
  await sleep(200);
  const tJuan2 = await entrar('juan');                  // vuelve a entrar con la clave: queda en la puerta
  const juanPuerta = await conectar(tJuan2);
  await sleep(1300);
  const puertaDe = (ws) => [...ws.visto].reverse().find(m => m.type === 'puerta');
  ok('el Despacho de ruta también recibe la puerta', (puertaDe(d14)?.items || []).some(i => i.personId === 'juan'), puertaDe(d14));
  await sleep(3000);                                      // más que PUERTA_SIN_SOCKET_MS conectado
  juanPuerta.close();
  await sleep(1300);
  mandar(d14, { type: 'watch', routeId: 'R-14' });         // la lista de ahora, no la última avisada
  await sleep(300);
  ok('al perder la app sigue figurando (la media hora cuenta desde ahí)', (puertaDe(d14)?.items || []).some(i => i.personId === 'juan'));

  console.log('\nLA BAJA SE LLEVA EL PRIVADO PERSONAL');
  const desp = await conectar(D, 'R-14');
  mandar(desp, { type: 'chat', text: 'Ana, te descontamos por el choque', toPerson: 'ana', timestamp: Date.now() });
  mandar(desp, { type: 'chat', text: 'Esto iba en privado', personal: true, timestamp: Date.now() });
  await sleep(300);
  ok('Despacho con «personal» y sin persona no le escribe al grupo', !juan.visto.some(m => m.text === 'Esto iba en privado'));
  await pedir('/admin/users/ana', D, { method: 'DELETE' });
  await post('/admin/users', HG, { unitId: 'ana', name: 'Ana Nueva', vehicleId: 'M-02', password: 'clave12345' });
  const ana2 = await conectar(await entrar('ana'));
  ok('la nueva «ana» no lee lo que Despacho le escribió a la anterior',
     !ana2.visto.some(m => m.type === 'chat_history' && m.items.some(i => /descontamos/.test(i.text || ''))));
  ana2.close();

  console.log('\nLOS COBRADORES LOS MANEJA SU CHOFER, NO EL COMODÍN');
  await post('/admin/users/luz/combis', D, { combis: ['M-05'], todaLaRuta: true });
  r = await post('/combi', tLuz, { vehicleId: 'M-07' });
  ok('Luz, comodín, elige M-07 (la de Rosa)', r.status === 200, r.body);
  r = await post('/perfil/cobradores/rosa/clave', tLuz, { nueva: 'robada12345' });
  ok('pero no le puede cambiar la clave a Rosa', r.status === 404, r.body);
  ok('y Rosa sigue entrando con la suya', !!(await entrar('rosa')));
  await post('/admin/users/luz/combis', D, { combis: ['M-05', 'M-07'], todaLaRuta: false, actual: 'M-07' });
  r = await post('/perfil/cobradores/rosa/clave', tLuz, { nueva: 'nueva12345' });
  ok('habilitada a mano en M-07, sí (es una de sus choferes)', r.status === 200, r.body);

  console.log('\nLA SESIÓN SE RENUEVA CON EL USO');
  const b2 = new Database(DB);
  b2.prepare('UPDATE sessions SET expiresAt = ? WHERE token = ?').run(Date.now() + 86_400_000, tPedro);
  await pedir('/mis-combis', tPedro);
  const exp = b2.prepare('SELECT expiresAt FROM sessions WHERE token = ?').get(tPedro).expiresAt;
  ok('a una que se usa y le queda un día, vuelve a valer 30', exp - Date.now() > 29 * 86_400_000, Math.round((exp - Date.now()) / 86_400_000));
  b2.close();

  console.log('\nEL POST /gps PONE EL NOMBRE DEL QUE MANEJA');
  const cob = await conectar(tRosa);                      // la cobradora crea la unidad M-07 (sin chofer)
  await sleep(200);
  r = await post('/gps', tLuz, { presencia: 'ruta', posiciones: [{ ...CALLE, speed: 18, timestamp: Date.now() }] });
  await sleep(500);
  const estado = [...desp.visto].reverse().find(m => m.type === 'state');
  const m07 = (estado?.units || []).find(u => u.unitId === 'M-07');
  ok('la combi tomada por HTTP lleva el nombre y el id del chofer', m07?.driverName === 'Luz' && m07?.choferId === 'luz', m07 && { driverName: m07.driverName, choferId: m07.choferId });
  cob.close();

  for (const w of [juan, d14, desp]) { try { w.close(); } catch {} }
  await parar();

  console.log('\nEN PRODUCCIÓN, LA BASE CONFIGURADA O NADA');
  const prod = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P + 1), DB_FILE: S + '/revision-apk.js/r14.db', DISPATCH_PASSWORD: 'una-clave-larga-de-produccion-9', MODO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  prod.stdout.on('data', d => { salida += d; }); prod.stderr.on('data', d => { salida += d; });
  const codigo = await new Promise(r => { prod.on('exit', r); setTimeout(() => { prod.kill(); r('sigue'); }, 8000); });
  ok('no arranca con otra base: sale con 1 y dice por qué', codigo === 1 && /No se pudo abrir la base configurada/.test(salida), { codigo, salida: salida.split('\n').slice(-3) });

  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
