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
// Todo lo de app.json que va a la parte nativa (la revisión integral del
// 04/11 vio que faltaban `newArchEnabled`, `scheme` y el resto de `android`)
// Los parches a módulos nativos (`app/patches`, aplicados por patch-package al
// instalar) también son nativos: cambian lo que compila la APK. Van por su
// huella, para que cambiar uno sin subir la versión frene la publicación.
const parchesNativos = () => {
  const dir = RAIZ + '/app/patches';
  if (!fs.existsSync(dir)) return {};
  const crypto = require('crypto');
  return Object.fromEntries(fs.readdirSync(dir).filter(n => n.endsWith('.patch')).sort()
    // Sin los \r: Git para Windows suele bajar los archivos con CRLF, y la
    // huella no puede cambiar por eso (la guardia frenaría publicar-arreglo)
    .map(n => [n, crypto.createHash('sha256').update(fs.readFileSync(dir + '/' + n, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)]));
};
const fotoNativa = () => ({
  version: appJson.version,
  // El nombre bajo el ícono lo pone Android desde la APK (H4, 27/11)
  nombre: appJson.name,
  dependencias: pkg.dependencies,
  parches: parchesNativos(),
  // Qué módulos se compilan desde la fuente y no se toman ya compilados
  // (ver más abajo, «el parche se compila»): cambia lo que lleva la APK.
  autolinking: pkg.expo && pkg.expo.autolinking ? pkg.expo.autolinking : null,
  plugins: appJson.plugins,
  android: appJson.android,
  newArchEnabled: appJson.newArchEnabled ?? null,
  scheme: appJson.scheme ?? null,
  ios: appJson.ios ?? null,
});
const NATIVO = RAIZ + '/app/nativo.json';

// Sólo la guardia, para `publicar-arreglo.bat`: sale con 1 si cambió algo
// nativo sin subir la versión (y entonces NO se publica)
if (process.argv.includes('--guardia')) {
  const anotado = fs.existsSync(NATIVO) ? JSON.parse(fs.readFileSync(NATIVO, 'utf8')) : null;
  const ahora = fotoNativa();
  if (!anotado) { console.log('Falta app/nativo.json: corre «node pruebas/actualizacion.js --anotar» después de compilar la APK.'); process.exit(1); }
  if (anotado.version !== ahora.version) {
    console.log(`La versión es ${ahora.version} pero lo nativo anotado es de la ${anotado.version}: compila la APK nueva y anota (node pruebas/actualizacion.js --anotar).`);
    process.exit(1);
  }
  const cambio = Object.keys(ahora).filter(k => JSON.stringify(ahora[k]) !== JSON.stringify(anotado[k]));
  if (cambio.length) {
    console.log(`Cambió algo NATIVO (${cambio.join(', ')}) y la versión sigue en ${ahora.version}.`);
    console.log('Un arreglo publicado así caería en teléfonos que no tienen esa parte y la app se rompería.');
    console.log('Sube "version" en app/app.json, compila una APK nueva con compilar-app.bat y anota lo nativo.');
    process.exit(1);
  }
  console.log(`Lo nativo no cambió desde la versión ${ahora.version}: se puede publicar.`);
  process.exit(0);
}

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
  // Nunca se recarga la app abierta: Updates.reloadAsync deja al servicio de
  // tareas de Expo con el contexto muerto y el próximo arranque del GPS
  // revienta (26/11, CAMBIOS 38). La actualización bajada se aplica en el
  // próximo arranque en frío.
  ok('la app nunca se recarga sola (la actualización se aplica en el próximo arranque en frío)',
     !/Updates\.reloadAsync\(/.test(app) && /Updates\.fetchUpdateAsync\(\)/.test(app));
  // El GPS mudo (H8 y H9) y el GPS que no arranca después de recargar:
  // dos errores de expo-task-manager 14.0.9, parchados desde la APK 0.3.2
  // (CAMBIOS 38 y 39) y compilados de verdad desde la 0.3.3 (CAMBIOS 40).
  const parche = fs.existsSync(RAIZ + '/app/patches/expo-task-manager+14.0.9.patch')
    ? fs.readFileSync(RAIZ + '/app/patches/expo-task-manager+14.0.9.patch', 'utf8') : '';
  ok('el parche de expo-task-manager está, para la versión instalada',
     !!parche && /"expo-task-manager": "~14\.0\.9"/.test(JSON.stringify(pkg.dependencies, null, 1)));
  ok('el parche guarda el contexto de la APLICACIÓN en el TaskService (no el del primer JavaScript)',
     /\+\s*Context appContext = context\.getApplicationContext\(\);/.test(parche) && /\+\s*mContextRef = new WeakReference<>\(appContext != null \? appContext : context\);/.test(parche));
  ok('y anota la pantalla siempre en la tabla principal',
     /-\s*boolean isHeadless = isStartedByHeadlessLoader\(appScopeKey\);/.test(parche) && /\+\s*Map<String, WeakReference<TaskManagerInterface>> taskManagers = sTaskManagers;/.test(parche));
  ok('patch-package lo aplica al instalar (también en la nube de EAS)',
     pkg.scripts && pkg.scripts.postinstall === 'patch-package' && !!(pkg.devDependencies && pkg.devDependencies['patch-package']));
  // Expo 54 trae casi todos sus módulos YA COMPILADOS (`local-maven-repo`
  // dentro de cada paquete) y la APK enlaza eso, no el código de
  // node_modules. Un parche a un módulo así no llega a la APK si el módulo no
  // se pide «desde la fuente»: pasó con la 0.3.2, que llevaba el parche en el
  // disco y el error en el teléfono (logcat del 27/11, CAMBIOS 40).
  const desdeLaFuente = (((pkg.expo || {}).autolinking || {}).android || {}).buildFromSource || [];
  const seCompila = (nombre) => desdeLaFuente.some(re => new RegExp(`^(?:${re})$`).test(nombre));
  const parchados = fs.existsSync(RAIZ + '/app/patches')
    ? fs.readdirSync(RAIZ + '/app/patches').filter(n => n.endsWith('.patch')).map(n => n.replace(/\+[^+]+\.patch$/, '').replace(/^@/, '').replace(/\W+/g, '-'))
    : [];
  ok('cada módulo parchado se compila desde la fuente (si no, la APK lleva el ya compilado, sin el parche)',
     parchados.length > 0 && parchados.every(seCompila), { parchados, desdeLaFuente });
  // expo-task-manager pide `project(':unimodules-app-loader')`: compilado
  // desde la fuente, ese proyecto tiene que existir, y sólo existe si
  // también se compila desde la fuente.
  ok('y su cargador (unimodules-app-loader) también, que expo-task-manager lo pide como proyecto',
     !seCompila('expo-task-manager') || seCompila('unimodules-app-loader'), desdeLaFuente);
  // H33: con la pantalla apagada el GPS seguía a 3 s, porque expo-location
  // rechazaba con la app atrás TODO pedido con la notificación fija, también
  // el que sólo cambia la cadencia de una tarea que ya corre (CAMBIOS 42).
  const parcheUbicacion = fs.existsSync(RAIZ + '/app/patches/expo-location+19.0.8.patch')
    ? fs.readFileSync(RAIZ + '/app/patches/expo-location+19.0.8.patch', 'utf8') : '';
  ok('el parche de expo-location está, para la versión instalada',
     !!parcheUbicacion && /"expo-location": "~19\.0\.8"/.test(JSON.stringify(pkg.dependencies, null, 1)));
  ok('y deja cambiar las opciones de una tarea que ya corre con la app atrás (arrancar una nueva sigue prohibido)',
     /\+\s*val yaCorre = mTaskManager\.taskHasConsumerOfClass\(taskName, LocationTaskConsumer::class\.java\)/.test(parcheUbicacion)
     && /\+\s*if \(!AppForegroundedSingleton\.alFrente\(\) && options\.foregroundService != null && !yaCorre\) \{/.test(parcheUbicacion)
     && /\+\s*Log\.i\("ExpoLocation", "COOP-R14: opciones de/.test(parcheUbicacion));
  // H35: al relanzar la app, la marca de expo-location queda en «atrás» y
  // la tarea restaurada corre sin la notificación fija
  ok('y si su marca dice «atrás», le pregunta a Android (sólo IMPORTANCE_FOREGROUND cuenta como adelante)',
     /\+\s*fun alFrente\(\): Boolean \{/.test(parcheUbicacion)
     && /\+\s*return info\.importance == ActivityManager\.RunningAppProcessInfo\.IMPORTANCE_FOREGROUND/.test(parcheUbicacion)
     && /\+\s*if \(!AppForegroundedSingleton\.alFrente\(\)\) \{\n\s*Log\.w\(TAG, "Foreground location task cannot be started/.test(parcheUbicacion)
     && /\+\s*if \(!AppForegroundedSingleton\.alFrente\(\) && options\.foregroundService != null && !yaCorre\) \{/.test(parcheUbicacion));
  ok('el parche deja un rastro en el logcat («COOP-R14 parche activo») para comprobar con adb que la APK lo trae',
     /\+\s*Log\.i\(TAG, "COOP-R14 parche activo/.test(parche));
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
  ok('y no publica sin pasar la guardia de lo nativo', /actualizacion\.js --guardia/.test(bat) && /--guardia[\s\S]*errorlevel 1[\s\S]*eas-cli update --channel/.test(bat));
  ok('el primer chequeo al arrancar no aplica en la puerta (sólo al volver al frente)', /mirar\(false\);/.test(app));
  ok('la vuelta atrás cuenta como pendiente', /isRollBackToEmbedded/.test(app));

  console.log('\nLA GUARDIA DE LO NATIVO');
  const anotado = fs.existsSync(NATIVO) ? JSON.parse(fs.readFileSync(NATIVO, 'utf8')) : null;
  const ahora = fotoNativa();
  const mismoNativo = anotado && JSON.stringify({ ...anotado, version: null }) === JSON.stringify({ ...ahora, version: null });
  ok('hay una foto de lo nativo', !!anotado);
  if (anotado && anotado.version === ahora.version) {
    ok(`lo nativo no cambió desde la versión ${ahora.version} (si cambió: sube "version" en app/app.json, compila una APK y anota)`,
       mismoNativo,
       mismoNativo ? undefined : Object.keys(ahora).filter(k => JSON.stringify(ahora[k]) !== JSON.stringify(anotado[k])));
  } else if (anotado) {
    ok(`la versión pasó de ${anotado.version} a ${ahora.version}: anota lo nativo nuevo con «node pruebas/actualizacion.js --anotar»`, false);
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
