// Fotos y audios por tiempo, por cooperativa, y la evidencia (PENDIENTES 0.8,
// 04/11).
//
// Se guardaban las 20 fotos y las 30 notas de voz más nuevas DEL SERVIDOR
// ENTERO: con varias cooperativas, la foto de un choque se borraba en horas
// por el chat de otra, y la política de privacidad promete 30 días. Ahora:
//
//   - el tope de lo pesado es POR COOPERATIVA: la otra no le borra nada;
//   - lo pesado suelta su contenido a los MEDIA_DIAS (30), no antes;
//   - Despacho marca un mensaje como EVIDENCIA, con motivo: no pierde su
//     contenido ni se borra con el chat; se va con el plazo del SOS (365);
//   - no se marca lo que ya expiró, ni sin motivo, ni lo de otra cooperativa,
//     y hay un techo por cooperativa;
//   - los otros paneles se enteran; el historial, la Actividad y el informe
//     de mensajes lo dicen;
//   - y en Chromium: marcar desde la burbuja del chat, que el otro panel lo
//     vea, y quitarlo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const coop = require(RAIZ + '/server/cooperativas.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/evidencia.db';
const P = 3209;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIA = 86400_000;
const foto = (n) => 'data:image/jpeg;base64,' + String(n).repeat(3000).slice(0, 3000);

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar(extra = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      PHOTO_KEEP: '2', VOICE_KEEP: '2', EVIDENCIA_MAX: '3', MEDIA_DIAS: '15', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  servidor.salida = new Promise(r => servidor.on('exit', r));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const parar = async () => { servidor.kill(); await servidor.salida; await sleep(300); };
const post = (ruta, token, cuerpo) => fetch(`http://localhost:${P}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(cuerpo),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await post('/auth/login', null, { user: u, password: c })).body.token;
async function socket(token, mirar) {
  const ws = new WebSocket(`ws://localhost:${P}`);
  ws.visto = [];
  ws.on('message', raw => ws.visto.push(JSON.parse(raw)));
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'identify', token }));
  if (mirar) ws.send(JSON.stringify({ type: 'watch', routeId: mirar }));
  await sleep(350);
  return ws;
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const D = await entrar('DESPACHO', 'despacho99');
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  let base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run('M-01', null, 'R-14', emp, Date.now());
  // La otra cooperativa, con su ruta, su combi, su Despacho y su chofer
  const otra = coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  if (otra.error) throw new Error(otra.error);
  base.prepare("INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES ('M-50', NULL, 'R-9', 'OTRA', ?)").run(Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, vehicleId, companyId, passHash, createdAt)
                VALUES ('otro', 'Otro Chofer', 'Otro Chofer', 'driver', 'R-9', 'M-50', 'OTRA', ?, ?)`).run(hashPassword('clave12345'), Date.now());
  const a = await post('/admin/users', HG, { unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' });
  if (a.status !== 200) throw new Error('alta: ' + JSON.stringify(a.body));
  const pedro = await socket(await entrar('pedro', 'clave12345'));
  const otroWs = await socket(await entrar('otro', 'clave12345'));
  const panel2 = await socket(await entrar('DESPACHO', 'despacho99'), 'R-14');
  const fotos = () => base.prepare("SELECT id, routeId, data IS NOT NULL AS viva, evidencia FROM messages WHERE kind = 'photo' ORDER BY id").all();
  const mandarFoto = async (ws, n) => { ws.send(JSON.stringify({ type: 'photo', data: foto(n), timestamp: Date.now() })); await sleep(250); };

  console.log('\nLA EVIDENCIA NO SE PODA');
  await mandarFoto(pedro, 1);
  const a1 = fotos()[0].id;
  const eco = pedro.visto.find(m => m.type === 'photo_msg');
  ok('la foto en vivo trae su id (para poder marcarla)', !!eco && eco.msgId === a1, eco && eco.msgId);
  let r = await post(`/admin/mensajes/${a1}/evidencia`, D, { marcar: true, motivo: 'no' });
  ok('sin motivo, no', r.status === 400 && /por qué es evidencia/.test(r.body.error), r.body);
  r = await post(`/admin/mensajes/${a1}/evidencia`, D, { marcar: true, motivo: 'Choque en la Av. Circunvalación, 07:40' });
  ok('Despacho la marca como evidencia', r.status === 200 && r.body.marcada === true && r.body.por === 'Despacho', r.body);
  await sleep(300);
  ok('el otro panel se entera', panel2.visto.some(m => m.type === 'evidencia' && m.msgId === a1 && m.marcada === true && /Circunvalación/.test(m.motivo)));
  ok('y queda en la Actividad', !!base.prepare("SELECT 1 FROM audit WHERE action = 'evidencia_marcada' AND detail LIKE '%Circunvalación%'").get());
  for (const n of [2, 3, 4]) await mandarFoto(pedro, n);
  let f = fotos();
  ok('con tope 2 por cooperativa: la marcada conserva su imagen aunque sea la más vieja',
     JSON.stringify(f.map(x => x.viva)) === '[1,0,1,1]' && f[0].evidencia === 1, f);

  console.log('\nEL TOPE ES POR COOPERATIVA');
  for (const n of [5, 6, 7]) await mandarFoto(otroWs, n);
  f = fotos();
  const deA = f.filter(x => x.routeId === 'R-14'), deB = f.filter(x => x.routeId === 'R-9');
  ok('las fotos de la otra cooperativa no le borran nada a ésta', JSON.stringify(deA.map(x => x.viva)) === '[1,0,1,1]', deA);
  ok('y la otra se poda a sí misma', JSON.stringify(deB.map(x => x.viva)) === '[0,1,1]', deB);

  console.log('\nLO QUE NO SE PUEDE MARCAR');
  r = await post(`/admin/mensajes/${deA[1].id}/evidencia`, D, { marcar: true, motivo: 'la que ya se fue' });
  ok('una foto que ya expiró: no queda qué guardar', r.status === 409 && /ya expiró/.test(r.body.error), r.body);
  r = await post(`/admin/mensajes/${deA[2].id}/evidencia`, await entrar('DESPACHO-2', 'clavelarga2'), { marcar: true, motivo: 'de otra cooperativa' });
  ok('el Despacho de otra cooperativa no la ve', r.status === 404, r.status);
  await post(`/admin/mensajes/${deA[2].id}/evidencia`, D, { marcar: true, motivo: 'Segunda foto del choque' });
  await post(`/admin/mensajes/${deA[3].id}/evidencia`, D, { marcar: true, motivo: 'Tercera foto del choque' });
  pedro.send(JSON.stringify({ type: 'chat', text: 'Me amenazó un pasajero', timestamp: Date.now() }));
  await sleep(300);
  const texto = base.prepare("SELECT id FROM messages WHERE kind = 'chat' ORDER BY id DESC LIMIT 1").get().id;
  r = await post(`/admin/mensajes/${texto}/evidencia`, D, { marcar: true, motivo: 'Amenaza de un pasajero' });
  ok('con el techo de la cooperativa lleno (3 en esta prueba), se dice', r.status === 409 && /el tope es 3/.test(r.body.error), r.body);
  r = await post(`/admin/mensajes/${deA[3].id}/evidencia`, D, { marcar: false });
  ok('desmarcar libera lugar', r.status === 200 && r.body.marcada === false &&
     !!base.prepare("SELECT 1 FROM audit WHERE action = 'evidencia_desmarcada'").get());
  r = await post(`/admin/mensajes/${texto}/evidencia`, D, { marcar: true, motivo: 'Amenaza de un pasajero' });
  ok('y un texto también puede ser evidencia', r.status === 200, r.body);

  console.log('\nLO DICEN EL HISTORIAL Y EL INFORME');
  const nuevo = await socket(D, 'R-14');
  const hist = [...nuevo.visto].reverse().find(m => m.type === 'chat_history');
  const h1 = hist && hist.items.find(i => i.msgId === a1);
  ok('el historial trae el id y la evidencia, con quién', !!h1 && h1.evidencia === 1 && h1.evidenciaPorNombre === 'Despacho' && /Circunvalación/.test(h1.evidenciaMotivo), h1 && { e: h1.evidencia, p: h1.evidenciaPorNombre });
  nuevo.close();
  const csv = await fetch(`http://localhost:${P}/admin/informe/mensajes.csv?desde=${Date.now() - DIA}`, { headers: { Authorization: 'Bearer ' + D } }).then(x => x.text());
  ok('el informe de mensajes tiene la columna Evidencia', /;Evidencia/.test(csv) && /sí · DESPACHO · Choque en la Av\. Circunvalación/.test(csv), csv.split('\r\n').slice(5, 7));

  console.log('\nPOR TIEMPO');
  const viejo = (kind, dias, data, evid) => base.prepare(`INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, text, data, timestamp, evidencia, evidenciaPor, evidenciaMotivo)
      VALUES (?, 'pedro', 'Pedro Mamani', 'R-14', 'M-01', ?, ?, ?, ?, ?, ?)`)
    .run(kind, kind === 'chat' ? `viejo ${dias}` : null, data, Date.now() - dias * DIA, evid ? 1 : null, evid ? 'DESPACHO' : null, evid ? 'prueba' : null).lastInsertRowid;
  // MEDIA_DIAS = 15 en esta prueba (de fábrica es 30, igual que el chat):
  // así se ve la burbuja que queda sin la imagen
  const v10 = viejo('photo', 10, foto(8), false);
  const v20 = viejo('photo', 20, foto(8), false);
  const v40 = viejo('photo', 40, foto(9), false);
  const v40e = viejo('photo', 40, foto(9), true);
  const c40 = viejo('chat', 40, null, false);
  const c40e = viejo('chat', 40, null, true);
  const c400e = viejo('chat', 400, null, true);
  base.close();
  for (const w of [pedro, otroWs, panel2]) w.close();
  await parar();
  // La barrida corre al arrancar. Y un presupuesto de historial chico (7 kB:
  // dos fotos de prueba) para ver lo que va aparte
  await arrancar({ EVIDENCIA_MAX: '10', HISTORIA_MEDIA_KB: '7' });
  base = new Database(DB);
  const fila = (id) => base.prepare('SELECT id, data IS NOT NULL AS viva FROM messages WHERE id = ?').get(id);
  ok('una foto de hace 10 días conserva su imagen (antes, se iba en horas)', fila(v10)?.viva === 1, fila(v10));
  ok('pasado MEDIA_DIAS suelta la imagen, pero la burbuja queda', fila(v20)?.viva === 0, fila(v20));
  ok('pasado el plazo del chat se va entera', !fila(v40));
  ok('la de hace 40 marcada como evidencia, no', fila(v40e)?.viva === 1, fila(v40e));
  ok('un texto de hace 40 días se borra con el chat', !fila(c40));
  ok('el mismo, marcado como evidencia, se queda', !!fila(c40e));
  ok('y la evidencia se va con el plazo del SOS (400 días)', !fila(c400e));

  console.log('\nEL HISTORIAL NO SE VUELVE PESADO');
  const D2 = await entrar('DESPACHO', 'despacho99');
  const conecta = await socket(D2, 'R-14');
  const items = [...conecta.visto].reverse().find(m => m.type === 'chat_history').items.filter(i => i.kind === 'photo');
  conecta.close();
  const conData = items.filter(i => i.data).map(i => i.msgId), aparte = items.filter(i => i.aparte).map(i => i.msgId);
  const vivas = base.prepare("SELECT id FROM messages WHERE kind = 'photo' AND routeId = 'R-14' AND data IS NOT NULL ORDER BY id").all().map(x => x.id);
  ok('entran las más nuevas hasta el presupuesto; las demás van aparte, sin contenido',
     JSON.stringify(conData) === JSON.stringify(vivas.slice(-2)) && JSON.stringify(aparte) === JSON.stringify(vivas.slice(0, -2)), { conData, aparte, vivas });
  const pedir = (id, t) => fetch(`http://localhost:${P}/admin/mensajes/${id}/contenido`, { headers: { Authorization: 'Bearer ' + t } });
  let rc = await pedir(aparte[0], D2);
  ok('Despacho la pide aparte', rc.status === 200 && /^data:image\/jpeg/.test((await rc.json()).data));
  rc = await pedir(aparte[0], await entrar('DESPACHO-2', 'clavelarga2'));
  ok('el de otra cooperativa, no', rc.status === 404, rc.status);
  rc = await pedir(fotos().find(x => x.routeId === 'R-14' && !x.viva).id, D2);
  ok('la que ya expiró lo dice', rc.status === 410, rc.status);

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
  const pedro2 = await socket(await entrar('pedro', 'clave12345'));
  await post(`/admin/mensajes/${texto}/evidencia`, D, { marcar: false });     // lugar para marcar desde la pantalla
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const abrir = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await interceptarHttps(ctx);
    const de = await ctx.newPage();
    de.on('pageerror', x => errores.push(x.message));
    await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await de.waitForTimeout(2500);
    await (await de.$$('input'))[0].fill('DESPACHO');
    await de.fill('input[type="password"]', 'despacho99');
    await de.click('button:has-text("INGRESAR")');
    await de.waitForTimeout(3000);
    return de;
  };
  const A = await abrir(), B = await abrir();
  pedro2.send(JSON.stringify({ type: 'chat', text: 'Se subió uno armado en el paradero', timestamp: Date.now() }));
  await A.waitForTimeout(1200);
  const idNuevo = base.prepare("SELECT id FROM messages WHERE kind = 'chat' ORDER BY id DESC LIMIT 1").get().id;
  ok('la burbuja de Despacho ofrece guardarlo como evidencia', !!(await A.$(`[data-marcar-evidencia="${idNuevo}"]`)));
  ok('la marcada de antes ya lo dice en la burbuja', /EVIDENCIA · Despacho: Choque en la Av\. Circunvalación/.test(await A.$eval(`[data-evidencia="${a1}"]`, x => x.innerText).catch(() => '')));
  await A.click(`[data-marcar-evidencia="${idNuevo}"]`);
  await A.fill(`[data-motivo-evidencia="${idNuevo}"]`, 'Pasajero armado, avisado a la policía');
  await A.click(`[data-guardar-evidencia="${idNuevo}"]`);
  const alerta = await A.waitForSelector('[role="alert"]', { timeout: 1500 }).then(x => x.innerText()).catch(() => null);
  if (alerta) console.log('  (la pantalla dijo: ' + alerta + ')');
  await A.waitForSelector(`[data-evidencia="${idNuevo}"]`, { timeout: 5000 }).catch(() => {});
  ok('marcado desde la pantalla, con el motivo', /Pasajero armado/.test(await A.$eval(`[data-evidencia="${idNuevo}"]`, x => x.innerText).catch(() => '')) &&
     base.prepare('SELECT evidencia FROM messages WHERE id = ?').get(idNuevo).evidencia === 1);
  ok('y el otro panel lo ve sin recargar', await B.waitForSelector(`[data-evidencia="${idNuevo}"]`, { timeout: 5000 }).then(() => true).catch(() => false));
  await A.click(`[data-evidencia="${idNuevo}"] button:has-text("quitar")`);
  await A.waitForTimeout(800);
  ok('quitarlo vuelve a ofrecer el botón', !!(await A.$(`[data-marcar-evidencia="${idNuevo}"]`)) &&
     base.prepare('SELECT evidencia FROM messages WHERE id = ?').get(idNuevo).evidencia === null);
  const cargar = await A.$(`[data-cargar="${aparte[0]}"]`);
  ok('la foto que vino aparte ofrece cargarla', !!cargar);
  if (cargar) await cargar.click();
  ok('y al tocarla se ve', await A.waitForSelector(`[data-evidencia="${aparte[0]}"], [data-marcar-evidencia="${aparte[0]}"]`, { timeout: 3000 })
     .then(() => A.$$eval('img', is => is.some(i => /^data:image\/jpeg/.test(i.src)))).catch(() => false) &&
     !(await A.$(`[data-cargar="${aparte[0]}"]`)));
  ok('ninguna página tiró errores', errores.length === 0, errores);

  await browser.close();
  pedro2.close();
  base.close();
  servidor.kill();
  await sleep(300);
  for (const x of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(x); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
