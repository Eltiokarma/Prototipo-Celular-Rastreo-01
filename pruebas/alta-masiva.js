// Alta de muchas personas desde una planilla (PENDIENTES 0.7, 04/11).
//
// Cargar 40 choferes era de a uno. Ahora se sube la planilla que ya tienen:
//
//   - el lector (`server/planilla.js`) con archivos DE VERDAD, hechos por
//     LibreOffice y por openpyxl (en `pruebas/planillas/`): CSV en UTF-8 y en
//     el Windows-1252 del Excel viejo, .xlsx, .ods, el texto pegado de una
//     planilla, y el .xls viejo, que se reconoce y se explica;
//   - revisar no guarda nada y dice fila por fila qué pasa; crear guarda las
//     buenas y devuelve las claves (las dadas o las generadas), que sirven
//     para entrar;
//   - cada fila pasa por las MISMAS reglas que el alta de a uno (combi que no
//     existe, de otra ruta), y la combi es obligatoria (no se crean combis
//     con el nombre de una persona);
//   - sin usuario se arma uno con el nombre, y subir dos veces la misma
//     planilla no duplica a nadie;
//   - y la pantalla de Despacho, en Chromium: subir el .xlsx, revisar,
//     crear, y bajar las claves.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { hashPassword } = require(RAIZ + '/server/base.js');
const { leerPlanilla } = require(RAIZ + '/server/planilla.js');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/alta-masiva.db';
const P = 3207;
const PL = (n) => path.join(S, 'planillas', n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const post = (ruta, token, cuerpo) => fetch(`http://localhost:${P}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(cuerpo),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = async (u, c) => (await post('/auth/login', null, { user: u, password: c })).body.token;
const importar = (token, archivo, confirmar = false, extra = {}) => post('/admin/users/importar', token,
  { archivo: fs.readFileSync(PL(archivo)).toString('base64'), nombre: archivo, confirmar, ...extra });

(async () => {
  console.log('\nEL LECTOR, CON ARCHIVOS DE VERDAD');
  const esperado = JSON.stringify([
    ['Usuario', 'Nombre y apellidos', 'Alias', 'Rol', 'Combi', 'Contraseña'],
    ['pedro.m', 'Pedro Mamani Quispe', 'Peter', 'Chofer', 'M-01', ''],
    ['', 'Ñusta Ccama Huanca', '', 'Cobradora', 'M-01', 'clave-nusta-1'],
    ['juan', 'Juan Pérez', '', 'conductor', 'M-02', ''],
    ['rosa', 'Rosa Ticona', 'Rosita', 'cobrador', 'M-99', ''],
    ['DESPACHO', 'Alguien', '', 'chofer', 'M-01', ''],
  ]);
  const leer = (n) => leerPlanilla({ bytes: fs.readFileSync(PL(n)), nombre: n });
  const rellenar = (filas) => JSON.stringify(filas.map(f => Array.from({ length: 6 }, (_, i) => f[i] ?? '')));
  ok('CSV con punto y coma, en UTF-8', JSON.stringify(leer('choferes.csv')) === esperado);
  ok('CSV del Excel viejo (Windows-1252): la Ñ y las tildes bien', JSON.stringify(leer('choferes-excel-viejo.csv')) === esperado);
  ok('.xlsx (LibreOffice)', rellenar(leer('choferes.xlsx')) === esperado, leer('choferes.xlsx'));
  ok('.ods (LibreOffice, Google Sheets)', rellenar(leer('choferes.ods')) === esperado, leer('choferes.ods'));
  const opx = leer('openpyxl.xlsx');
  ok('.xlsx de otro programa: números, comillas, &, sólo la primera hoja, sin filas vacías',
     JSON.stringify(opx) === JSON.stringify([['usuario', 'nombre', 'rol', 'vehiculo'], ['1234', 'Número Uno', 'chofer', 'M-01'], ['luz', 'Luz "La Rápida" & Cía', 'cobrador', 'M-01']]), opx);
  let e = null; try { leer('choferes.xls'); } catch (x) { e = x.message; }
  ok('el .xls viejo se reconoce y se explica', /formato viejo de Excel \(\.xls\).*protegida con contraseña.*\.xlsx/.test(e || ''), e);
  ok('lo pegado de una planilla (tabulaciones)', JSON.stringify(leerPlanilla({ texto: 'Nombre\tRol\r\nAna Ccama\tchofer\r\n' })) === '[["Nombre","Rol"],["Ana Ccama","chofer"]]');

  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();
  const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
  const D = await entrar('DESPACHO', 'despacho99');
  const base = new Database(DB);
  const emp = base.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  base.prepare('INSERT OR IGNORE INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?,?,?,?,?,?)')
    .run('R-20', 'Juliaca – Puno', 5, 90, emp, Date.now());
  for (const v of ['M-01', 'M-02']) base.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run(v, null, 'R-14', emp, Date.now());
  base.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                VALUES ('DESP-20', 'Despacho 20', 'Despacho 20', 'dispatch', 'R-20', ?, ?, ?)`).run(emp, hashPassword('despacho-ruta'), Date.now());
  const personas = () => base.prepare("SELECT unitId FROM users WHERE role IN ('driver','collector') ORDER BY unitId").all().map(u => u.unitId);

  console.log('\nREVISAR NO GUARDA NADA');
  let r = await importar(HG, 'choferes.xlsx');
  ok('dice fila por fila: 3 se crean, 2 no', r.status === 200 && r.body.buenas === 3 && r.body.conError === 2, r.body.buenas);
  const fila = (n) => r.body.filas.find(f => f.fila === n);
  ok('la combi que no existe, con la misma regla que el alta de a uno', /El vehículo M-99 no existe/.test(fila(5).motivo), fila(5));
  ok('un usuario ya tomado', /ya está tomado/.test(fila(6).motivo), fila(6));
  ok('sin usuario se arma uno con el nombre, sin tildes', fila(3).usuario === 'nusta.ccama' && fila(3).usuarioGenerado === true, fila(3));
  ok('«Cobradora» y «conductor» se entienden', fila(3).rol === 'collector' && fila(4).rol === 'driver');
  ok('las columnas reconocidas, como estaban escritas', r.body.columnas.nombre === 'Nombre y apellidos' && r.body.columnas.clave === 'Contraseña', r.body.columnas);
  ok('y no guardó nada', personas().length === 0, personas());
  ok('ni muestra claves al revisar', !r.body.filas.some(f => f.clave));

  console.log('\nCREAR');
  r = await importar(HG, 'choferes.xlsx', true);
  ok('crea las buenas y salta las otras', r.body.buenas === 3 && JSON.stringify(personas()) === '["juan","nusta.ccama","pedro.m"]', personas());
  const pedro = r.body.filas.find(f => f.usuario === 'pedro.m');
  ok('con las claves, una vez: la generada y la de la planilla', /^[a-z]+-[a-z]+-\d{4}$/.test(pedro.clave) &&
     r.body.filas.find(f => f.usuario === 'nusta.ccama').clave === 'clave-nusta-1', r.body.filas.map(f => f.clave));
  ok('y sirven para entrar', !!(await entrar('pedro.m', pedro.clave)) && !!(await entrar('nusta.ccama', 'clave-nusta-1')));
  ok('quedan en su combi, habilitadas', base.prepare("SELECT vehicleId FROM habilitaciones WHERE personId = 'nusta.ccama'").get()?.vehicleId === 'M-01');
  ok('la Actividad: un alta por persona y el resumen',
     base.prepare("SELECT COUNT(*) n FROM audit WHERE action = 'alta'").get().n === 3 &&
     !!base.prepare("SELECT 1 FROM audit WHERE action = 'alta_masiva' AND detail LIKE '3 persona(s)%2 con error%'").get());

  console.log('\nSUBIRLA DOS VECES NO DUPLICA');
  r = await importar(HG, 'choferes.csv', true);
  ok('ninguna se crea de nuevo', r.body.buenas === 0 && personas().length === 3, personas());
  ok('la que no tenía usuario: «ya hay alguien con ese nombre»', /Ya hay alguien con ese nombre \(usuario nusta\.ccama\)/.test(r.body.filas.find(f => f.fila === 3).motivo), r.body.filas.find(f => f.fila === 3));

  console.log('\nLAS MISMAS REGLAS QUE DE A UNO');
  const pegado = (t, tok = D, confirmar = false) => post('/admin/users/importar', tok, { texto: t, confirmar });
  r = await pegado('Nombre\tRol\nCarlos Sin Combi\tchofer', HG);
  ok('sin combi, ni la gerencia: no se inventan combis con nombres de personas', /Falta la combi/.test(r.body.filas[0].motivo), r.body.filas[0]);
  r = await pegado('Nombre\tRol\tCombi\nTito Ruta Ajena\tchofer\tM-01', await entrar('DESP-20', 'despacho-ruta'));
  ok('el Despacho de otra ruta no sube gente a una combi ajena', /pertenece a otra ruta/.test(r.body.filas[0].motivo), r.body.filas[0]);
  r = await pegado('Nombre\tRol\tCombi\nAna\tmecánico\tM-01\nAna Ccama\tchofer\tM-01\nAna Ccama\tchofer\tM-02');
  ok('un rol que no existe se dice', /No sé qué rol es «mecánico»/.test(r.body.filas[0].motivo), r.body.filas[0]);
  ok('el mismo nombre dos veces en la planilla: la segunda no', r.body.filas[1].ok === true && /Ya hay alguien con ese nombre/.test(r.body.filas[2].motivo), r.body.filas.slice(1));

  console.log('\nLO QUE NO SE PUEDE LEER');
  r = await post('/admin/users/importar', D, { archivo: fs.readFileSync(PL('choferes.xls')).toString('base64'), nombre: 'choferes.xls' });
  ok('el .xls viejo: 400 con cómo guardarlo', r.status === 400 && /guardala como/.test(r.body.error), r.body);
  r = await pegado('pedro\tchofer\tM-01');
  ok('sin fila de títulos, se dice qué poner', r.status === 400 && /primera fila tiene que decir/.test(r.body.error), r.body);
  r = await pegado('Nombre\n' + Array.from({ length: 501 }, (_, i) => 'Persona ' + i).join('\n'));
  ok('más de 500 personas: que la partan', r.status === 400 && /tope por planilla es 500/.test(r.body.error), r.body);

  console.log('\nEN LA PANTALLA DE DESPACHO (Chromium)');
  // Para la pantalla, una planilla nueva (las de arriba ya están cargadas)
  const nueva = path.join(S, 'planillas', '_nuevas.csv');
  fs.writeFileSync(nueva, 'Nombre;Rol;Combi;Alias\nRaúl Condori Mamani;chofer;M-02;Rulo\nElsa Yupanqui;cobrador;M-02;\nSin Combi Nadie;chofer;;\n');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errores = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await interceptarHttps(ctx);
  const de = await ctx.newPage();
  de.on('pageerror', x => errores.push(x.message));
  await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await de.waitForTimeout(2500);
  await (await de.$$('input'))[0].fill('DESPACHO');
  await de.fill('input[type="password"]', 'despacho99');
  await de.click('button:has-text("INGRESAR")');
  await de.waitForTimeout(2500);
  await de.click('button:has-text("Gestión")');
  await de.waitForTimeout(1200);
  await de.click('[data-abrir-planilla]');
  const ejemplo = await de.$eval('[data-carga-masiva] a[download]', a => a.href);
  const resp = await fetch(ejemplo);
  ok('la planilla de ejemplo se baja y se lee', resp.ok && JSON.stringify(leerPlanilla({ bytes: Buffer.from(await resp.arrayBuffer()), nombre: 'x.xlsx' })[0]) ===
     '["Usuario","Nombre y apellidos","Alias","Rol","Combi","Clave"]');
  await de.setInputFiles('[data-planilla-archivo]', nueva);
  await de.waitForTimeout(300);
  await de.click('[data-planilla-revisar]');
  await de.waitForSelector('[data-fila-planilla="4"]', { timeout: 8000 }).catch(() => {});
  const f2 = await de.$eval('[data-fila-planilla="2"]', x => x.innerText).catch(() => '');
  const f4 = await de.$eval('[data-fila-planilla="4"]', x => x.innerText).catch(() => '');
  ok('revisar: Raúl se crea con usuario armado', /raul\.condori/.test(f2) && /\(armado\)/.test(f2) && /se crea/.test(f2), f2);
  ok('y la fila sin combi dice que falta', /Falta la combi/.test(f4), f4);
  ok('el botón dice cuántas', /Crear 2 personas/.test(await de.$eval('[data-planilla-crear]', x => x.innerText)));
  await de.click('[data-planilla-crear]');
  await de.waitForSelector('[data-planilla-claves]', { timeout: 8000 });
  ok('creadas', personas().includes('raul.condori') && personas().includes('elsa.yupanqui'), personas());
  const [descarga] = await Promise.all([de.waitForEvent('download'), de.click('[data-planilla-claves]')]);
  const csv = fs.readFileSync(await descarga.path(), 'utf8');
  const clave = (csv.split('\r\n').find(l => l.includes('raul.condori')) || '').split(';')[4]?.replace(/"/g, '');
  ok('las claves se bajan en un CSV que abre Excel (con BOM, ;)', csv.startsWith('﻿"Usuario";"Nombre"') && /raul\.condori/.test(csv), csv.slice(0, 80));
  ok('y la clave del CSV sirve para entrar', !!(await entrar('raul.condori', clave)), clave);
  ok('la página no tiró errores', errores.length === 0, errores);

  await browser.close();
  try { fs.unlinkSync(nueva); } catch {}
  base.close();
  servidor.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
