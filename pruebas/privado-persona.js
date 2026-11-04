// Dos privados: con la combi y con la persona (31/10).
//
// Con varias combis por persona el privado de combi quedó de los dos lados
// del borde: lo personal de Pedro lo leía su cobrador y el que manejara su
// combi después. Ahora hay dos hilos con Despacho:
//   combi    lo ven los que van arriba hoy y los que la manejen después;
//   persona  la sigue a cualquier combi y ruta, y no lo ve nadie más.
//
// Lo que se prueba: quién recibe cada uno en vivo (texto y voz), qué trae el
// historial de cada uno —el personal aunque haya cambiado de combi y de
// ruta—, y los bordes: Despacho de otra ruta o de otra cooperativa, y que a
// una cuenta de Despacho no se le escribe «en personal».
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const { hashPassword } = require(RAIZ + '/server/base.js');
const fs = require('fs');

const DB = S + '/privado-persona.db';
const P = 3177;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const pedir = (ruta, token, opts = {}) => fetch(`http://localhost:${P}${ruta}`, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const post = (ruta, token, cuerpo) => pedir(ruta, token, { method: 'POST', body: JSON.stringify(cuerpo) });
const entrar = async (u, clave = 'clave12345') => (await post('/auth/login', null, { user: u, password: clave })).body.token;

// Un socket que junta los mensajes y el último historial
async function conectar(token, mirar = null) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.msgs = []; ws.historial = null;
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'chat_msg' || m.type === 'voice_msg') ws.msgs.push(m);
    if (m.type === 'chat_history') ws.historial = m.items;
  });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  if (mirar) ws.send(JSON.stringify({ type: 'watch', routeId: mirar }));
  await sleep(400);
  return ws;
}
const decir = (ws, m) => ws.send(JSON.stringify({ type: 'chat', timestamp: Date.now(), ...m }));
const recibio = (ws, texto) => ws.msgs.some(m => m.text === texto);
const AUDIO = 'data:audio/webm;base64,' + Buffer.alloc(300, 1).toString('base64');

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const base = new Database(DB);
  const empresa = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  coop.altaRuta(base, { companyId: empresa, routeId: 'R-18B', name: 'Ruta 18B' });
  coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  const altaV = base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)');
  for (const [v, r] of [['M-01', 'R-14'], ['M-05', 'R-14'], ['M-21', 'R-18B']]) altaV.run(v, null, r, empresa, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-18B', 'Despacho 18B', 'Despacho 18B', 'dispatch', 'R-18B', ?, ?, ?)`)
    .run(empresa, hashPassword('despacho18'), Date.now());
  for (const [u, n, v, rol] of [['pedro', 'Pedro', 'M-01'], ['rosa', 'Rosa', 'M-01', 'collector'], ['juan', 'Juan', 'M-05']]) {
    const a = await post('/admin/users', HG, { unitId: u, name: n, vehicleId: v, password: 'clave12345', personRole: rol || 'driver' });
    if (a.status !== 200) throw new Error(`alta de ${u}: ${JSON.stringify(a.body)}`);
  }
  await post('/admin/users/pedro/combis', D, { combis: ['M-01', 'M-05', 'M-21'] });

  const tPedro = await entrar('pedro');
  const desp = await conectar(D, 'R-14');
  let pedro = await conectar(tPedro);
  const rosa = await conectar(await entrar('rosa'));
  const juan = await conectar(await entrar('juan'));
  const otra = await conectar(await entrar('DESPACHO-2', 'clavelarga2'));
  const d18 = await conectar(await entrar('DESP-18B', 'despacho18'));

  console.log('\nEL PRIVADO DE LA COMBI, COMO SIEMPRE');
  decir(desp, { text: 'M-01: esperá 2 min en el mercado', to: 'M-01' });
  await sleep(300);
  ok('lo reciben el chofer y el cobrador de M-01', recibio(pedro, 'M-01: esperá 2 min en el mercado') && recibio(rosa, 'M-01: esperá 2 min en el mercado'));
  ok('y no otra combi', !recibio(juan, 'M-01: esperá 2 min en el mercado'));

  console.log('\nEL PRIVADO PERSONAL');
  decir(desp, { text: 'Pedro, pasá por la oficina', toPerson: 'pedro' });
  await sleep(300);
  const llego = pedro.msgs.find(m => m.text === 'Pedro, pasá por la oficina');
  ok('lo recibe Pedro', !!llego);
  ok('marcado como personal (toPersonId, sin combi)', llego?.toPersonId === 'pedro' && !llego?.toVehicleId, llego);
  ok('NO lo recibe su cobradora, que va en la misma combi', !recibio(rosa, 'Pedro, pasá por la oficina'));
  ok('ni otro chofer', !recibio(juan, 'Pedro, pasá por la oficina'));
  ok('Despacho ve su propio mensaje (el eco)', recibio(desp, 'Pedro, pasá por la oficina'));
  decir(pedro, { text: 'Voy a las 18', personal: true });
  await sleep(300);
  const resp = desp.msgs.find(m => m.text === 'Voy a las 18');
  ok('Pedro contesta en personal: lo recibe Despacho, como personal de Pedro', resp?.toPersonId === 'pedro', resp);
  ok('y su cobradora no', !recibio(rosa, 'Voy a las 18'));
  pedro.send(JSON.stringify({ type: 'voice', data: AUDIO, duration: 3, personal: true, timestamp: Date.now() }));
  await sleep(300);
  ok('una nota de voz personal: la recibe Despacho y no la cobradora',
     desp.msgs.some(m => m.type === 'voice_msg' && m.toPersonId === 'pedro') && !rosa.msgs.some(m => m.type === 'voice_msg'));
  decir(rosa, { text: 'Soy Rosa, en personal', personal: true });
  await sleep(300);
  const deRosa = desp.msgs.find(m => m.text === 'Soy Rosa, en personal');
  ok('la cobradora también tiene el suyo (y es el SUYO, no el de Pedro)', deRosa?.toPersonId === 'rosa' && !recibio(pedro, 'Soy Rosa, en personal'), deRosa);
  // No se puede escribir «en personal» a nombre de otro: el servidor usa al emisor
  decir(juan, { text: 'Me hago pasar', personal: true, toPerson: 'pedro' });
  await sleep(300);
  ok('el personal de un chofer es siempre el suyo, aunque pida otro', !recibio(pedro, 'Me hago pasar') &&
     desp.msgs.find(m => m.text === 'Me hago pasar')?.toPersonId === 'juan');

  console.log('\nLOS BORDES');
  decir(otra, { text: 'De otra cooperativa', toPerson: 'pedro' });
  decir(d18, { text: 'De Despacho de la 18B', toPerson: 'pedro' });
  decir(desp, { text: 'A una cuenta de Despacho', toPerson: 'DESP-18B' });
  await sleep(400);
  ok('Despacho de otra cooperativa no le escribe a Pedro', !recibio(pedro, 'De otra cooperativa'));
  ok('ni el Despacho de otra ruta', !recibio(pedro, 'De Despacho de la 18B'));
  ok('a una cuenta de Despacho no se le escribe «en personal»', !recibio(d18, 'A una cuenta de Despacho'));
  ok('nada de eso quedó guardado', !base.prepare("SELECT 1 FROM messages WHERE text IN ('De otra cooperativa', 'De Despacho de la 18B', 'A una cuenta de Despacho')").get());

  console.log('\nLO SIGUE A OTRA COMBI');
  pedro.close();
  let r = await post('/combi', tPedro, { vehicleId: 'M-05' });
  ok('Pedro pasa a M-05', r.status === 200, r.body);
  pedro = await conectar(tPedro);
  decir(desp, { text: 'Pedro, ¿cómo va M-05?', toPerson: 'pedro' });
  await sleep(300);
  ok('el personal le llega en M-05', recibio(pedro, 'Pedro, ¿cómo va M-05?'));
  ok('y no a Juan, que también tiene M-05 de combi', !recibio(juan, 'Pedro, ¿cómo va M-05?'));
  const hPedro = pedro.historial.map(m => m.text);
  ok('su historial trae el personal de cuando estaba en M-01',
     ['Pedro, pasá por la oficina', 'Voy a las 18'].every(t => hPedro.includes(t)), hPedro);
  ok('y ya NO el privado de M-01 (es de la combi, no suyo)', !hPedro.includes('M-01: esperá 2 min en el mercado'));
  juan.close();
  const juan2 = await conectar(await entrar('juan'));
  const hJuan = juan2.historial.map(m => m.text);
  ok('el historial de Juan (M-05) no trae nada personal de Pedro', !hJuan.some(t => /Pedro|Voy a las 18/.test(t)), hJuan);
  rosa.close();
  const rosa2 = await conectar(await entrar('rosa'));
  const hRosa = rosa2.historial.map(m => m.text);
  ok('el de Rosa trae el privado de M-01 y el suyo, no el de Pedro',
     hRosa.includes('M-01: esperá 2 min en el mercado') && hRosa.includes('Soy Rosa, en personal') && !hRosa.includes('Pedro, pasá por la oficina'), hRosa);

  console.log('\nY A OTRA RUTA');
  pedro.close();
  r = await post('/combi', tPedro, { vehicleId: 'M-21' });
  ok('Pedro pasa a M-21, en la 18B', r.status === 200 && r.body.routeId === 'R-18B', r.body);
  pedro = await conectar(tPedro);
  ok('su historial en la 18B sigue trayendo su personal', pedro.historial.some(m => m.text === 'Pedro, pasá por la oficina'));
  decir(d18, { text: 'Bienvenido a la 18B', toPerson: 'pedro' });
  await sleep(300);
  ok('ahora sí le escribe el Despacho de la 18B', recibio(pedro, 'Bienvenido a la 18B'));
  desp.close();
  const desp2 = await conectar(D, 'R-14');
  await sleep(300);
  ok('Despacho (R-14) ve en su historial lo personal guardado en su ruta',
     (desp2.historial || []).some(m => m.text === 'Voy a las 18' && m.toPersonId === 'pedro'));

  console.log('\nEL INFORME');
  const fila = base.prepare("SELECT toPersonId, toVehicleId FROM messages WHERE text = 'Voy a las 18'").get();
  ok('se guarda como personal: toPersonId, sin combi', fila?.toPersonId === 'pedro' && fila?.toVehicleId === null, fila);

  for (const w of [pedro, rosa2, juan2, otra, d18, desp2]) w.close();
  base.close();
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
