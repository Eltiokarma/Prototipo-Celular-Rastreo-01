// Actualizar la app sin reinstalar (PENDIENTES 0.11, 04/11).
//
// Lo que se puede probar sin un teléfono:
//   - CUÁNDO se aplica una actualización: nunca en ruta, ni con el vigía de
//     la puerta contando, ni con un SOS sin salir; en la puerta sólo al
//     volver al frente; en la pantalla de entrada, siempre;
//   - la etiqueta de la actualización y la cabecera que la lleva;
//   - que la app esté cableada así (App.js, el servicio de GPS, app.json,
//     eas.json, package.json);
//   - LA GUARDIA DE LO NATIVO: una actualización sólo llega a las APK con la
//     misma `version` de app.json. Si cambia algo nativo (un módulo, un
//     permiso, un plugin) y la versión no sube, una actualización caería en
//     teléfonos que no tienen esa parte y la app se rompería. Esta prueba
//     guarda una foto de lo nativo (`app/nativo.json`) y falla si cambió sin
//     subir la versión. Después de subirla y compilar:
//         node pruebas/actualizacion.js --anotar
//   - el servidor anota qué actualización tiene cada teléfono y Despacho lo
//     muestra (Chromium).
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const fs = require('fs');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const appJson = JSON.parse(fs.readFileSync(RAIZ + '/app/app.json', 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(RAIZ + '/app/package.json', 'utf8'));
const eas = JSON.parse(fs.readFileSync(RAIZ + '/app/eas.json', 'utf8'));

// Lo nativo: lo que, si cambia, pide una APK nueva
const fotoNativa = () => ({
  version: appJson.version,
  dependencias: pkg.dependencies,
  plugins: appJson.plugins,
  permisos: (appJson.android || {}).permissions,
  paquete: (appJson.android || {}).package,
});
const NATIVO = RAIZ + '/app/nativo.json';

if (process.argv.includes('--anotar')) {
  fs.writeFileSync(NATIVO, JSON.stringify(fotoNativa(), null, 2) + '\n');
  console.log(`Anotado lo nativo de la versión ${appJson.version} en app/nativo.json`);
  process.exit(0);
}

const { spawn } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\nCUÁNDO SE APLICA');
  const { sePuedeAplicar, tocaPreguntar, PREGUNTAR_CADA_MS } = require(RAIZ + '/app/actualizacion.js');
  const base = { sesion: { unitId: 'pedro' }, presencia: 'fuera', vigiaContando: false, sosSinRed: null, alVolver: true };
  ok('en la puerta, al volver al frente: sí', sePuedeAplicar(base) === true);
  ok('en ruta: nunca', sePuedeAplicar({ ...base, presencia: 'ruta' }) === false);
  ok('ausente (bajó a comer, sigue con la vuelta): nunca', sePuedeAplicar({ ...base, presencia: 'ausente' }) === false);
  ok('con el vigía de la puerta contando (puede estar manejando): no', sePuedeAplicar({ ...base, vigiaContando: true }) === false);
  ok('con un SOS sin salir en pantalla: no', sePuedeAplicar({ ...base, sosSinRed: { en: 1 } }) === false);
  ok('en la puerta pero sin volver al frente (está usando la app): no', sePuedeAplicar({ ...base, alVolver: false }) === false);
  ok('en la pantalla de entrada: sí', sePuedeAplicar({ ...base, sesion: null, alVolver: false }) === true);
  ok('en la pantalla de entrada con un SOS sin salir: no', sePuedeAplicar({ ...base, sesion: null, sosSinRed: { en: 1 } }) === false);
  ok('pregunta al volver al frente cada media hora como mucho',
     tocaPreguntar(0, 1e9) === true && tocaPreguntar(1e9, 1e9 + PREGUNTAR_CADA_MS - 1) === false && tocaPreguntar(1e9, 1e9 + PREGUNTAR_CADA_MS) === true);

  console.log('\nLA ETIQUETA Y LA CABECERA');
  const { actualizacionDe, cabeceraDeApp } = require(RAIZ + '/app/version.js');
  const fecha = new Date(2026, 10, 4, 15, 30);
  ok('una actualización: la fecha en que se publicó', actualizacionDe({ isEnabled: true, isEmbeddedLaunch: false, createdAt: fecha }) === '20261104-1530');
  ok('el JavaScript que vino en la APK: nada', actualizacionDe({ isEnabled: true, isEmbeddedLaunch: true, createdAt: fecha }) === null);
  ok('sin el módulo (Expo Go): nada', actualizacionDe({ isEnabled: false }) === null && actualizacionDe(null) === null);
  ok('la cabecera la lleva después de un +',
     cabeceraDeApp({ version: '0.3.0', versionCode: 6, actualizacion: '20261104-1530' })['X-App-Version'] === '0.3.0/6+20261104-1530');
  ok('y sin actualización queda como antes', cabeceraDeApp({ version: '0.3.0', versionCode: 6, actualizacion: null })['X-App-Version'] === '0.3.0/6');

  console.log('\nLA APP ESTÁ CABLEADA ASÍ');
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  ok('App.js usa expo-updates, y no hace nada sin el módulo', /from 'expo-updates'/.test(app) && /if \(!Updates\.isEnabled\) return;/.test(app));
  ok('el único reinicio está detrás de sePuedeAplicar',
     (app.match(/Updates\.reloadAsync\(/g) || []).length === 1 && /sePuedeAplicar\([^)]*\)\) \{\s*await Updates\.reloadAsync\(\)/.test(app));
  ok('la etiqueta va en la entrada y en cada envío del GPS',
     /actualizacion: actualizacionDe\(Updates\)/.test(app) && /actualizacion: actualizacionDe\(Updates\)/.test(servicio));
  const u = appJson.updates || {};
  ok('app.json: baja de EAS con el id del proyecto', u.url === `https://u.expo.dev/${appJson.extra.eas.projectId}`, u.url);
  ok('app.json: el arranque no espera a la red (con mala señal no se cuelga)', u.fallbackToCacheTimeout === 0 && u.checkAutomatically === 'ON_LOAD', u);
  ok('app.json: la actualización se ata a la versión de la app', appJson.runtimeVersion && appJson.runtimeVersion.policy === 'appVersion', appJson.runtimeVersion);
  const canales = Object.fromEntries(Object.entries(eas.build).map(([k, v]) => [k, v.channel]));
  ok('eas.json: cada compilación tiene su canal, y hay uno de prueba',
     canales.apk === 'apk' && canales.production === 'produccion' && canales.prueba === 'prueba' && eas.build.prueba.extends === 'apk', canales);
  ok('package.json: expo-updates de la versión de Expo 54', /^~29\./.test(pkg.dependencies['expo-updates'] || ''), pkg.dependencies['expo-updates']);
  const bat = fs.readFileSync(RAIZ + '/publicar-arreglo.bat', 'utf8');
  ok('publicar-arreglo.bat existe y publica con la dirección del servidor de cada canal',
     /eas-cli update --channel/.test(bat) && /EXPO_PUBLIC_SERVIDOR/.test(bat) && /roll-back-to-embedded/.test(bat));

  console.log('\nLA GUARDIA DE LO NATIVO');
  const anotado = fs.existsSync(NATIVO) ? JSON.parse(fs.readFileSync(NATIVO, 'utf8')) : null;
  const ahora = fotoNativa();
  const mismoNativo = anotado && JSON.stringify({ ...anotado, version: null }) === JSON.stringify({ ...ahora, version: null });
  ok('hay una foto de lo nativo', !!anotado);
  if (anotado && anotado.version === ahora.version) {
    ok(`lo nativo no cambió desde la versión ${ahora.version} (si cambió: subí "version" en app/app.json, compilá una APK y anotá)`,
       mismoNativo,
       mismoNativo ? undefined : Object.keys(ahora).filter(k => JSON.stringify(ahora[k]) !== JSON.stringify(anotado[k])));
  } else if (anotado) {
    ok(`la versión pasó de ${anotado.version} a ${ahora.version}: anotá lo nativo nuevo con «node pruebas/actualizacion.js --anotar»`, false);
  }

  console.log('\nEL SERVIDOR Y DESPACHO');
  const DB = S + '/actualizacion.db', P = 3213;
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const srv = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const salida = new Promise(r => srv.on('exit', r));
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(`http://localhost:${P}/ping`); break; } catch {} }
  try {
    const post = (ruta, token, cuerpo, h = {}) => fetch(`http://localhost:${P}${ruta}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...h },
      body: JSON.stringify(cuerpo) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const HG = await require('./gerente.js')(`http://localhost:${P}`, DB);
    const b = new Database(DB);
    const emp = b.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
    b.prepare('INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?,?,?,?,?)').run('M-01', null, 'R-14', emp, Date.now());
    await post('/admin/users', HG, { unitId: 'pedro', name: 'Pedro Mamani', vehicleId: 'M-01', password: 'clave12345' });
    const fila = () => b.prepare("SELECT appVersion v, appVersionCode c, appActualizacion a FROM users WHERE unitId = 'pedro'").get();
    const l = await post('/auth/login', null, { user: 'pedro', password: 'clave12345', app: { version: '0.3.0', versionCode: 6, actualizacion: null } });
    ok('entra con la APK sola: sin actualización', fila().c === 6 && fila().a === null, fila());
    const perfil = (h) => fetch(`http://localhost:${P}/perfil?dias=1`, { headers: { Authorization: 'Bearer ' + l.body.token, ...h } });
    await perfil({ 'X-App-Version': '0.3.0/6+20261105-0900' });
    ok('toma una actualización: la anota con su primer pedido', fila().a === '20261105-0900', fila());
    await perfil({ 'X-App-Version': '0.3.0/6+cualquiera' });
    ok('una cabecera rara no pisa nada', fila().a === '20261105-0900', fila());
    await perfil({ 'X-App-Version': '0.3.0/6' });
    ok('si vuelve a la de la APK (se deshizo la actualización), se anota', fila().a === null, fila());
    await perfil({ 'X-App-Version': '0.3.0/6+20261105-0900' });
    const D = (await post('/auth/login', null, { user: 'DESPACHO', password: 'despacho99' })).body.token;
    const lista = await fetch(`http://localhost:${P}/admin/users`, { headers: { Authorization: 'Bearer ' + D } }).then(r => r.json());
    ok('Despacho la recibe en la lista de personas', lista.users.find(x => x.unitId === 'pedro')?.appActualizacion === '20261105-0900');

    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await require(S + '/cdn.js')(ctx);
    const de = await ctx.newPage();
    const errores = [];
    de.on('pageerror', x => errores.push(x.message));
    await de.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await de.waitForTimeout(2500);
    await (await de.$$('input'))[0].fill('DESPACHO');
    await de.fill('input[type="password"]', 'despacho99');
    await de.click('button:has-text("INGRESAR")');
    await de.waitForTimeout(3000);
    await de.click('button:has-text("Gestión")');
    await de.waitForTimeout(1500);
    const t = await de.evaluate(() => document.body.innerText);
    ok('en Personas se lee «app 6 · act. 05/11 09:00»', /app 6 · act\. 05\/11 09:00/.test(t));
    ok('sin errores en la página', errores.length === 0, errores);
    await browser.close();
    b.close();
  } finally {
    srv.kill(); await salida; await sleep(200);
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  }

  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA PRUEBA SE CAYÓ:', e.stack); process.exit(1); });
