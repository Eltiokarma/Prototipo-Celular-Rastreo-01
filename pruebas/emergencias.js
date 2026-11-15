// Las emergencias y el GPS en vivo (revisión del 15/11, grupo 2).
//
//   A. SOS-01: la posición del SOS dice de dónde salió ('telefono', 'combi'
//      o ninguna), y la de la combi sólo se usa si hay señal de que la
//      persona va en ella (la maneja, o es su cobrador con la combi en
//      servicio). Antes, desde la puerta, un chofer al que otro le manejaba
//      la combi pedía ayuda y Despacho la mandaba adonde estaba la combi.
//   B. SOS-02: el SOS que la base no pudo guardar (queda en memoria, id
//      negativo) se puede calificar, y el panel que se conecta lo ve con su
//      tipo. Antes era un 404.
//   C. SOS-02, app nativa: si el eco del primer SOS se perdió, el reintento
//      vuelve como REPETIDO y no emitía 'sos': el «¿qué pasó?» no se abría.
//      Ahora `mandarSos` dice si es repetido y si ya tiene tipo.
//   D. GPS-01: por el socket, la posición se registra con la hora en que el
//      aparato la tomó (`edadMs`), no con la de llegada. Una posición
//      congelada reenviada cada 3 s pasa a «sin señal» en vez de verse en vivo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { crearCliente } = require(RAIZ + '/app/protocolo/cliente.js');

const DB = S + '/emergencias.db';
const P = 3254;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasta = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const pedir = (ruta, o = {}) => fetch(API + ruta,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: c }) })).body.token;
const sos = (token, cuerpo = {}) => pedir('/sos', { method: 'POST', headers: { Authorization: 'Bearer ' + token },
  body: JSON.stringify({ lat: null, lng: null, timestamp: Date.now(), ...cuerpo }) });
async function socket(token) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => { try { ws.visto.push(JSON.parse(raw)); } catch {} });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(500);
  return ws;
}
const C1 = { lat: -15.4900, lng: -70.1330 };

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
           STATE_INTERVAL_MS: '400', SIN_SENAL_MS: '2000', OLVIDAR_MS: '120000', RESPALDO_CADA_H: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02']) {
    base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)')
      .run(v, 'Z1A-7' + v.slice(-2), 'R-14', emp, Date.now());
  }
  for (const [u, rol, v] of [['luis', 'driver', 'M-01'], ['pedro', 'driver', 'M-01'], ['rosa', 'collector', 'M-01'],
                             ['juan', 'driver', 'M-02'], ['ana', 'driver', 'M-02'], ['mario', 'driver', 'M-02']]) {
    const a = await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: u, vehicleId: v, personRole: rol, password: 'clave12345' }) });
    if (a.status !== 200) throw new Error('alta ' + u + ': ' + JSON.stringify(a.body));
  }
  const T = {};
  for (const u of ['luis', 'pedro', 'rosa', 'juan', 'ana', 'mario']) T[u] = await entrar(u, 'clave12345');
  const panel = await socket(D);

  console.log('\nA. DE DÓNDE SALE LA POSICIÓN DEL SOS');
  // Luis maneja M-01: manda posición y toma el mando
  const luis = await socket(T.luis);
  luis.send(JSON.stringify({ type: 'gps', ...C1, speed: 20, edadMs: 0 }));
  await sleep(600);
  let r = await sos(T.pedro);
  ok('el chofer que NO maneja su combi (desde la puerta): sin posición, no la de la combi',
    r.status === 200 && r.body.lat == null && r.body.posicionDe == null, r.body);
  r = await sos(T.luis);
  ok('el que la maneja, sin GPS propio: la de la combi, dicho', r.body.lat === C1.lat && r.body.posicionDe === 'combi', r.body);
  r = await sos(T.rosa);
  ok('el cobrador con la combi en servicio: la de la combi, dicho', r.body.lat === C1.lat && r.body.posicionDe === 'combi', r.body);
  r = await sos(T.juan, { lat: -15.48, lng: -70.12 });
  ok('con GPS propio: la del teléfono, dicho', r.body.lat === -15.48 && r.body.posicionDe === 'telefono', r.body);
  const alertaPanel = panel.visto.filter(m => m.type === 'sos_alert').find(m => m.unitId === 'luis');
  ok('al panel le llega con el origen', alertaPanel && alertaPanel.posicionDe === 'combi', alertaPanel);
  const panel2 = await socket(D);
  const abiertos = (panel2.visto.find(m => m.type === 'sos_abiertos') || {}).items || [];
  const origen = Object.fromEntries(abiertos.map(x => [x.unitId, x.posicionDe ?? null]));
  ok('y el panel que se conecta después también lo ve', origen.luis === 'combi' && origen.rosa === 'combi' &&
    origen.juan === 'telefono' && origen.pedro === null, origen);
  panel2.close();

  console.log('\nB. EL SOS QUE LA BASE NO PUDO GUARDAR SE PUEDE CALIFICAR');
  base.exec(`CREATE TRIGGER sin_lugar BEFORE INSERT ON messages WHEN NEW.kind = 'sos'
             BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;`);
  r = await sos(T.ana, { lat: -15.47, lng: -70.11 });
  ok('sale igual, con id de memoria', r.status === 200 && r.body.sosId < 0, r.body);
  const enMemoria = r.body.sosId;
  const t = await pedir(`/sos/${enMemoria}/tipo`, { method: 'POST', headers: { Authorization: 'Bearer ' + T.ana },
    body: JSON.stringify({ tipo: 'mecanica' }) });
  ok('ponerle el tipo responde que sí (antes: 404)', t.status === 200 && t.body.tipo === 'mecanica', t);
  await sleep(300);
  ok('el panel recibe el tipo', panel.visto.some(m => m.type === 'sos_tipo' && m.sosId === enMemoria && m.tipo === 'mecanica'));
  const ajeno = await pedir(`/sos/${enMemoria}/tipo`, { method: 'POST', headers: { Authorization: 'Bearer ' + T.juan },
    body: JSON.stringify({ tipo: 'policia' }) });
  ok('otro no le pone el tipo', ajeno.status === 404, ajeno);
  const panel3 = await socket(D);
  const deAna = ((panel3.visto.find(m => m.type === 'sos_abiertos') || {}).items || []).find(x => x.sosId === enMemoria);
  ok('el panel que se conecta lo ve con su tipo', deAna && deAna.sosTipo === 'mecanica', deAna);
  panel3.close();
  base.exec('DROP TRIGGER sin_lugar');

  console.log('\nC. APP NATIVA: EL REINTENTO CUYO PRIMER ECO SE PERDIÓ');
  // El primer intento llegó al servidor, pero la app no se enteró
  const primero = await sos(T.mario, { lat: -15.46, lng: -70.10 });
  const c = crearCliente({ servidor: API, WebSocketImpl: WebSocket });
  const sesion = await c.entrar('mario', 'clave12345');
  const emitidos = [];
  c.on('sos', (m) => emitidos.push(m));
  c.conectar(sesion.token);
  await hasta(() => c.conectado);
  let m = await c.mandarSos({ lat: -15.46, lng: -70.10 });
  ok('el reintento confirma con el MISMO id y dice que es repetido',
    m.ok && m.sosId === primero.body.sosId && m.repetido === true, m);
  ok('y que todavía no tiene tipo (la pantalla abre el «¿qué pasó?»)', m.sosTipo == null, m);
  ok('el repetido no suma otra burbuja', emitidos.length === 0, emitidos.length);
  ok('el tipo sale', (await c.marcarTipoSos('policia')) === null);
  m = await c.mandarSos({ lat: -15.46, lng: -70.10 });
  ok('otro reintento ya dice el tipo (no se vuelve a preguntar)', m.ok && m.repetido === true && m.sosTipo === 'policia', m);
  c.salir();

  console.log('\nD. LA POSICIÓN CONGELADA DE LA WEB');
  const estadoDe = (v) => {
    const s = panel.visto.filter(x => x.type === 'state').pop();
    return s && (s.units || []).find(u => u.unitId === v);
  };
  ok('M-01 en vivo', await hasta(() => estadoDe('M-01') && estadoDe('M-01').sinSenal === false), estadoDe('M-01'));
  // El GPS del navegador dejó de dar posiciones: la web reenvía la última,
  // ahora diciendo cuánto hace que la tomó
  const desde = Date.now();
  const repetir = setInterval(() => {
    try { luis.send(JSON.stringify({ type: 'gps', ...C1, speed: 0, edadMs: 40_000 + (Date.now() - desde) })); } catch {}
  }, 1000);
  await sleep(1500);
  const u1 = estadoDe('M-01');
  ok('se registra con la hora en que se tomó, no con la de llegada',
    u1 && u1.timestamp <= Date.now() - 39_000, u1 && { hace: Date.now() - u1.timestamp });
  ok('y pasa a «sin señal» aunque se la siga reenviando', await hasta(() => estadoDe('M-01')?.sinSenal === true, 15000),
    estadoDe('M-01'));
  clearInterval(repetir);
  // Que llegue lo que estaba en vuelo y el estado siguiente, antes de medir
  await sleep(1500);
  const antes = estadoDe('M-01').timestamp;
  luis.send(JSON.stringify({ type: 'gps', ...C1, speed: 0, edadMs: 10 * 60_000 }));
  await sleep(1200);
  ok('una de más de 5 min no se registra', estadoDe('M-01').timestamp === antes);
  luis.send(JSON.stringify({ type: 'gps', lat: C1.lat + 0.0005, lng: C1.lng, speed: 18, edadMs: 300 }));
  ok('con una posición nueva vuelve a estar en vivo', await hasta(() => estadoDe('M-01')?.sinSenal === false));
  r = await (async () => {
    // La posición de respaldo del SOS: con la combi «sin señal», no se usa
    luis.send(JSON.stringify({ type: 'gps', ...C1, speed: 0, edadMs: 50_000 }));
    await hasta(() => estadoDe('M-01')?.sinSenal === true, 15000);
    panel.send(JSON.stringify({ type: 'sos_atender', sosId: (await sos(T.luis)).body.sosId }));
    await sleep(400);
    return sos(T.luis);
  })();
  ok('y una posición vieja no se usa de respaldo para el SOS', r.body.lat == null && r.body.posicionDe == null, r.body);
  // Una web vieja en caché no manda edadMs: la hora de llegada, como antes
  luis.send(JSON.stringify({ type: 'gps', ...C1, speed: 0 }));
  ok('sin edadMs (web vieja), como antes: en vivo', await hasta(() => estadoDe('M-01')?.sinSenal === false));

  console.log('\nLAS PANTALLAS (leídas)');
  const web = fs.readFileSync(RAIZ + '/project/realtime.js', 'utf8');
  ok('la web manda la edad de la posición', /edadMs,/.test(web) && /Date\.now\(\) - \(lastPosition\.timestamp/.test(web));
  ok('la web no repite la velocidad de una posición vieja', /if \(edadMs > GPS_REFRESCAR_MS\) kmh = 0;/.test(web));
  ok('el tipo sale con el token del disparo', /const tk = authToken \|\| tokenDelSos;/.test(web));
  const despacho = fs.readFileSync(RAIZ + '/project/despacho.html', 'utf8');
  ok('Despacho actualiza los SOS que ya tenía al reconectar', /\{ \.\.\.x, \.\.\.porId\.get\(x\.sosId\) \}/.test(despacho));
  ok('y dice si la posición es de la combi o no hay', /POSICIÓN DE LA COMBI, NO DEL TELÉFONO/.test(despacho) && /SIN POSICIÓN/.test(despacho));
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  ok('la app abre el selector con un repetido sin tipo', /r\.repetido && r\.sosId != null && !r\.sosTipo/.test(app));
  ok('y si el tipo no sale, lo vuelve a abrir con el aviso', /setTipoSosFallo\(true\);\s*setTipificarSos\(true\);/.test(app));

  luis.close(); panel.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
