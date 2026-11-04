// Bajar todo lo de una persona (PENDIENTES 0.14, 04/11): los derechos de
// acceso y de portabilidad de la Ley 29733.
//
// Lo que se defiende:
//   - el ZIP se abre con cualquier programa (se lee con Python, no con el
//     lector propio) y trae el LÉEME y cada CSV;
//   - lo de la combi entra SÓLO mientras ella la manejaba: la vuelta de la
//     misma combi con otro chofer no es suya;
//   - sus mensajes y los privados que le mandaron, sí; lo que escribió otro
//     en el grupo, no; su foto sale idéntica, y la que ya expiró se dice;
//   - la contraseña no sale, ni siquiera su huella;
//   - otra cooperativa no la puede bajar, y bajarla queda en la Actividad;
//   - y en Chromium: Editar → «Bajar todos sus datos (ZIP)» descarga el archivo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB = S + '/datos-persona.db';
const P = 3215;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Lee un ZIP con Python: si lo abre un programa ajeno, lo abre Excel/Windows
function abrirZip(buf) {
  const f = path.join(os.tmpdir(), `datos-persona-${process.pid}.zip`);
  fs.writeFileSync(f, buf);
  const salida = execFileSync('python3', ['-I', '-c', `
import zipfile, json, sys, base64
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({ i.filename: base64.b64encode(z.read(i.filename)).decode() for i in z.infolist() }))
`, f], { maxBuffer: 50 * 1024 * 1024 }).toString();
  fs.unlinkSync(f);
  const crudo = JSON.parse(salida);
  return {
    nombres: Object.keys(crudo),
    bytes: (n) => crudo[n] ? Buffer.from(crudo[n], 'base64') : null,
    texto: (n) => crudo[n] ? Buffer.from(crudo[n], 'base64').toString('utf8').replace(/^﻿/, '') : null,
  };
}

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', MEMORIA: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const post = (ruta, token, cuerpo) => fetch(API + ruta, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(cuerpo) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const D = (await post('/auth/login', null, { user: 'DESPACHO', password: 'despacho99' })).body.token;
  const HG = await require('./gerente.js')(API, DB);
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const v of ['M-01', 'M-02']) base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run(v, null, 'R-14', emp, Date.now());
  coop.alta(base, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9', despacho: 'DESPACHO-2', clave: 'clavelarga2' });
  await post('/admin/users', HG, { unitId: 'pedro', name: 'Pedro Mamani Quispe', alias: 'Peter', vehicleId: 'M-01', password: 'clave12345' });
  await post('/admin/users', HG, { unitId: 'juan', name: 'Juan Apaza', vehicleId: 'M-02', password: 'clave12345' });
  await post('/auth/login', null, { user: 'pedro', password: 'clave12345' });

  // Pedro manejó M-01 de hace 5 h a hace 3 h; Juan, la MISMA combi, de hace 2 h a hace 1 h
  const H = 3600_000, ahora = Date.now();
  const turno = base.prepare('INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  turno.run('pedro', 'M-01', 'R-14', 'driver', ahora - 5 * H, ahora - 3 * H, ahora - 3 * H);
  turno.run('juan', 'M-01', 'R-14', 'driver', ahora - 2 * H, ahora - 1 * H, ahora - 1 * H);
  const vuelta = base.prepare('INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, parcial) VALUES (?, ?, ?, ?, ?, ?, 0)');
  vuelta.run('M-01', 'R-14', ahora - 4.5 * H, ahora - 3.7 * H, 2880, 21);     // de Pedro
  vuelta.run('M-01', 'R-14', ahora - 1.9 * H, ahora - 1.1 * H, 2880, 19);     // de Juan
  base.prepare("INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, cierre) VALUES ('M-01', 'R-14', ?, ?, 300, 420, 300, 'regreso')").run(ahora - 4 * H, ahora - 4 * H + 300_000);
  base.prepare("INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, cierre) VALUES ('M-01', 'R-14', ?, ?, 300, 999, 300, 'regreso')").run(ahora - 1.5 * H, ahora - 1.5 * H + 300_000);
  const FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 250, 251, 0xff, 0xd9]);
  const msj = base.prepare(`INSERT INTO messages (kind, unitId, driverName, routeId, vehicleId, toPersonId, text, duration, data, timestamp)
                            VALUES (?, ?, ?, 'R-14', ?, ?, ?, ?, ?, ?)`);
  msj.run('chat', 'pedro', 'Peter', 'M-01', null, 'Llegando al paradero de la UANCV', null, null, ahora - 4 * H);
  const idFoto = msj.run('photo', 'pedro', 'Peter', 'M-01', null, 'Llanta baja', null, 'data:image/jpeg;base64,' + FOTO.toString('base64'), ahora - 4 * H).lastInsertRowid;
  msj.run('voice', 'pedro', 'Peter', 'M-01', null, null, 4, null, ahora - 4 * H);           // ya expiró
  msj.run('chat', 'DESPACHO', 'Despacho', null, 'pedro', 'Pedro, pasá por la oficina', null, null, ahora - 3.5 * H);
  msj.run('chat', 'juan', 'Juan Apaza', 'M-02', null, 'Mensaje de Juan en el grupo', null, null, ahora - 2 * H);
  msj.run('chat', 'DESPACHO', 'Despacho', null, 'juan', 'Privado para Juan', null, null, ahora - 2 * H);
  base.prepare(`INSERT INTO recordings (personId, companyId, routeId, nombre, puntos, cantidad, largoM, createdAt)
                VALUES ('pedro', ?, 'R-14', 'Desvío por la feria', '[{"lat":-15.49,"lng":-70.13}]', 1, 0, ?)`).run(emp, ahora - 4 * H);

  console.log('\nEL ARCHIVO');
  const r = await fetch(`${API}/admin/users/pedro/datos.zip`, { headers: { Authorization: 'Bearer ' + D } });
  ok('se descarga como ZIP, con su nombre', r.status === 200 && r.headers.get('content-type') === 'application/zip' &&
     /filename="datos-pedro-\d{4}-\d{2}-\d{2}\.zip"/.test(r.headers.get('content-disposition')), r.headers.get('content-disposition'));
  const z = abrirZip(Buffer.from(await r.arrayBuffer()));
  ok('lo abre un programa ajeno (Python), y trae el LÉEME y los CSV',
     ['LEEME.txt', 'persona.csv', 'turnos.csv', 'mensajes.csv', 'vueltas.csv', 'desvios.csv', 'actividad.csv', 'grabaciones.csv'].every(n => z.nombres.includes(n)),
     z.nombres);
  const leeme = z.texto('LEEME.txt');
  ok('el LÉEME dice de quién es, quién lo generó y qué NO está', /PEDRO MAMANI QUISPE \(usuario pedro\)/.test(leeme) &&
     /Generado el .* por DESPACHO/.test(leeme) && /La contraseña: se guarda de forma irreversible/.test(leeme));

  console.log('\nLO QUE ES SUYO, Y NADA MÁS');
  const vueltas = z.texto('vueltas.csv').trim().split('\r\n');
  ok('de las dos vueltas de M-01, sólo la de cuando la manejaba él', vueltas.length === 2 && /;21;sí$/.test(vueltas[1]), vueltas);
  const desvios = z.texto('desvios.csv');
  ok('lo mismo con los desvíos', /;420;300;regreso/.test(desvios) && !/999/.test(desvios));
  const mensajes = z.texto('mensajes.csv');
  ok('sus mensajes, y el privado que le mandó Despacho', /UANCV/.test(mensajes) && /pasá por la oficina/.test(mensajes));
  ok('lo de Juan, no: ni lo del grupo ni su privado', !/Mensaje de Juan/.test(mensajes) && !/Privado para Juan/.test(mensajes));
  const nombreFoto = z.nombres.find(n => n.startsWith('fotos/'));
  ok('su foto, idéntica byte por byte', !!nombreFoto && nombreFoto.endsWith(`-${idFoto}.jpg`) && z.bytes(nombreFoto).equals(FOTO), nombreFoto);
  ok('y la nota de voz que ya expiró se dice, no se inventa', /nota de voz;[^\r\n]*ya no se conserva/.test(mensajes));
  ok('su grabación de recorrido, con los puntos', /Desvío por la feria/.test(z.texto('grabaciones.csv')) && z.nombres.some(n => /^grabaciones\/\d+\.json$/.test(n)));
  ok('sus turnos', /M-01;R-14;chofer/.test(z.texto('turnos.csv')) && !/;juan;/.test(z.texto('turnos.csv')));
  const persona = z.texto('persona.csv');
  const huella = base.prepare("SELECT passHash FROM users WHERE unitId = 'pedro'").get().passHash;
  ok('la contraseña no sale, ni su huella', !persona.includes(huella) && !z.nombres.some(n => z.texto(n) && z.texto(n).includes(huella.split(':')[1])));
  ok('la actividad trae su ingreso', /;pedro;login;/.test(z.texto('actividad.csv')));

  console.log('\nQUIÉN PUEDE');
  const D2 = (await post('/auth/login', null, { user: 'DESPACHO-2', password: 'clavelarga2' })).body.token;
  const otra = await fetch(`${API}/admin/users/pedro/datos.zip`, { headers: { Authorization: 'Bearer ' + D2 } });
  ok('el Despacho de otra cooperativa, no', otra.status === 404, otra.status);
  const sin = await fetch(`${API}/admin/users/pedro/datos.zip`);
  ok('sin sesión, no', sin.status === 401, sin.status);
  const ev = base.prepare("SELECT actor, detail, clase FROM audit WHERE action = 'datos_exportados' AND target = 'pedro'").get();
  ok('bajarlo queda en la Actividad, como gestión', !!ev && ev.actor === 'DESPACHO' && ev.clase === 'gestion' && /1 fotos, 0 audios/.test(ev.detail), ev);

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await interceptarHttps(ctx);
  const de = await ctx.newPage();
  const errores = [];
  de.on('pageerror', x => errores.push(x.message));
  await de.goto(`${API}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(3000);
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1500);
  // El «Editar» de la fila de pedro
  const fila = await de.$(`xpath=//span[normalize-space(text())='pedro']/ancestor::div[.//button[normalize-space(.)='Editar']][1]`);
  await (await fila.$('button:has-text("Editar")')).click();
  const boton = await de.waitForSelector('[data-bajar-datos="pedro"]', { timeout: 5000 }).catch(() => null);
  ok('al abrir Editar está «Bajar todos sus datos (ZIP)»', !!boton && /Bajar todos sus datos/.test(await boton.innerText()));
  const [descarga] = await Promise.all([de.waitForEvent('download', { timeout: 10000 }).catch(() => null), boton && boton.click()]);
  let bytes = 0;
  if (descarga) { const f = await descarga.path(); bytes = fs.statSync(f).size; }
  ok('y descarga el ZIP', !!descarga && descarga.suggestedFilename() === 'datos-pedro.zip' && bytes > 500, descarga && [descarga.suggestedFilename(), bytes]);
  ok('sin errores en la página', errores.length === 0, errores);
  await browser.close();

  base.close();
  servidor.kill(); await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA PRUEBA SE CAYÓ:', e.stack); try { servidor && servidor.kill(); } catch {} process.exit(1); });
