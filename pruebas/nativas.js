// Las versiones de los módulos nativos de la app (`app/package.json`).
//
// Existe por un bug que costó un build entero y dejó la app sin abrir:
//
//     Failed resolution of: Lexpo/modules/kotlin/types/AnyTypeCache;
//       at expo.modules.asset.AssetModule.definition(AssetModule.kt:125)
//
// Nadie había puesto `expo-asset` en el package.json. Lo pedía `expo-audio`
// como peerDependency con el rango `*`, npm lo tomó al pie de la letra y bajó
// la ÚLTIMA — la del SDK 57 — al lado de un `expo-modules-core` del SDK 54.
// El autolinking de Android compila lo que encuentra, y el Kotlin del 57 le
// habla a una clase que en el 54 no existe.
//
// Lo caro es cuándo se entera uno: `npm install` no dice nada, el bundle de
// JavaScript arma bien, la compilación en la nube sale verde, y el error
// recién aparece cuando el APK ya está instalado en el teléfono. Veinte
// minutos de build por intento. Esto lo baja a un segundo.
//
// No hace falta teléfono ni red: se lee el lockfile, que es exactamente lo
// que va a terminar compilado.
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const pkg  = require(RAIZ + '/app/package.json');
const lock = require(RAIZ + '/app/package-lock.json');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Lo que Expo publica para el SDK 54. Sale de su propio índice, que es el
// mismo que consulta `npx expo install`:
//
//     curl https://api.expo.dev/v2/sdks/54.0.0/native-modules
//
// Si algún día se sube de SDK, se pide esa lista de nuevo y se pega acá. No
// se inventa un rango: adivinar el rango fue el error original.
const SDK = '54';
const ESPERADO = {
  'expo':              '~54.0.36',
  'expo-application':  '~7.0.8',
  'expo-asset':        '~12.0.13',
  'expo-audio':        '~1.1.1',
  'expo-battery':      '~10.0.8',
  'expo-dev-client':   '~6.0.21',
  'expo-file-system':  '~19.0.23',
  'expo-image-manipulator': '~14.0.8',
  'expo-image-picker': '~17.0.11',
  'expo-location':     '~19.0.8',
  'expo-secure-store': '~15.0.8',
  'expo-splash-screen': '~31.0.13',
  'expo-status-bar':   '~3.0.9',
  'expo-task-manager': '~14.0.9',
  // Actualizaciones sin reinstalar (PENDIENTES 0.11): del bundledNativeModules.json de expo@54.0.36
  'expo-updates':      '~29.0.19',
  'babel-preset-expo': '~54.0.12',
  'react-native-safe-area-context': '~5.6.0',
  'react-native-webview': '13.15.0',
};

const declarado = { ...pkg.dependencies, ...pkg.devDependencies };

// Todo lo que el lockfile realmente va a instalar, a cualquier profundidad:
// las versiones de adentro son las que compila el autolinking, no las de
// `dependencies`.
const instalado = {};
for (const ruta of Object.keys(lock.packages)) {
  const nombre = ruta.split('node_modules/').pop();
  const version = lock.packages[ruta].version;
  if (!nombre || !version) continue;
  (instalado[nombre] = instalado[nombre] || []).push(version);
}

console.log('\nLOS RANGOS DECLARADOS');
{
  for (const [nombre, rango] of Object.entries(ESPERADO)) {
    ok(`${nombre} pide ${rango}`, declarado[nombre] === rango, declarado[nombre]);
  }

  // `expo-asset` no lo importa nadie desde el código: está declarado a
  // propósito, para que el `*` de expo-audio no lo resuelva a la última.
  // Si alguien lo saca por "no se usa", vuelve el crash.
  ok('expo-asset sigue declarado aunque no se importe',
     declarado['expo-asset'] !== undefined, declarado['expo-asset']);
}

console.log('\nLO QUE SE VA A INSTALAR DE VERDAD');
{
  // Desde el SDK 55 Expo numera sus paquetes con el número del SDK (55.x,
  // 56.x, 57.x). Así que un `expo-*` con major >= 55 dentro de un proyecto
  // del SDK 54 es, sin más, de otro SDK. Es la forma barata de detectar
  // exactamente lo que pasó, sin tener que listar cada paquete a mano.
  const CORTE = 55;
  const intrusos = [];
  for (const [nombre, versiones] of Object.entries(instalado)) {
    if (!/^expo(-|$)/.test(nombre)) continue;
    for (const v of versiones) {
      const major = Number(v.split('.')[0]);
      if (major >= CORTE && String(major) !== SDK) intrusos.push(nombre + '@' + v);
    }
  }
  ok('ningún expo-* viene de otro SDK', intrusos.length === 0, intrusos);

  // Dos copias del mismo módulo nativo es autolinking ambiguo: compila una,
  // el JavaScript importa la otra.
  const duplicados = Object.entries(instalado)
    .filter(([n, vs]) => /^expo(-|$)/.test(n) && new Set(vs).size > 1)
    .map(([n, vs]) => n + ': ' + [...new Set(vs)].join(' + '));
  ok('ningún módulo nativo duplicado', duplicados.length === 0, duplicados);

  const core = instalado['expo-modules-core'];
  ok('expo-modules-core está y es uno solo', core && core.length >= 1 && new Set(core).size === 1, core);
}

console.log('\nEL LOCKFILE ACOMPAÑA AL PACKAGE.JSON');
{
  // El lockfile es lo que se commitea y lo que decide qué se compila. Si
  // quedó viejo, todo lo de arriba mide un árbol que ya no existe. Pasó:
  // el lockfile no tenía `expo-audio` cuando la app ya lo importaba.
  const faltantes = Object.keys(pkg.dependencies)
    .filter(n => !instalado[n]);
  ok('todo lo declarado está en el lockfile', faltantes.length === 0, faltantes);

  const raiz = lock.packages[''] || {};
  ok('y el lockfile guarda los mismos rangos',
     JSON.stringify(raiz.dependencies || {}) === JSON.stringify(pkg.dependencies),
     raiz.dependencies);
}

// Las dos comprobaciones de acá abajo son del mismo tipo, y es el tipo más
// caro que tiene esta app: APIs que compilan, arrancan, y fallan **en
// silencio y en la calle**. No hay stack trace, no hay pantalla roja; hay una
// combi que no aparece en el mapa. Se chequean leyendo el código porque no
// hay otra forma de verlas sin un teléfono y un turno entero.
console.log('\nLA API QUE SE USA');
{
  const fs = require('fs');

  // 1) En el SDK 54 `expo-file-system` cambió de API y dejó las funciones
  //    viejas como stubs que TIPAN BIEN y revientan al ejecutarse. No falla
  //    al compilar ni al abrir: falla la primera vez que un chofer manda una
  //    nota de voz.
  const voz = fs.readFileSync(RAIZ + '/app/voz.js', 'utf8');
  ok('voz.js no usa la API vieja de expo-file-system',
     !/readAsStringAsync|writeAsStringAsync|getInfoAsync/.test(voz)
     || /expo-file-system\/legacy/.test(voz));
  ok('y saca el base64 con la API nueva', /new File\([^)]*\)\.base64\(\)/.test(voz));

  // 2) Y la peor de todas, medida en un teléfono: `arrancar` preguntaba
  //    `isTaskRegisteredAsync` —¿existe el REGISTRO?— en vez de
  //    `hasStartedLocationUpdatesAsync` —¿el servicio está CORRIENDO?—.
  //
  //    El registro lo guarda Android y sobrevive a que el servicio muera: a
  //    una reinstalación del APK, a que Xiaomi mate la app, a un reinicio.
  //    Con un registro huérfano dando vueltas, `arrancar` volvía enseguida
  //    sin arrancar nada. La app se veía perfecta —entraba, chateaba,
  //    mandaba fotos y SOS— y el GPS, que es el punto de todo esto, no
  //    existía: "enviadas 0 · fallidas 0", ni un error.
  //
  //    Y lo dispara el caso más común de todos: instalar una versión nueva.
  //    O sea que le iba a pasar a cada chofer en cada actualización.
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const cuerpoArrancar = (servicio.match(/async function arrancarAhora[\s\S]*?\n}/) || [''])[0];
  ok('arrancar() decide por el SERVICIO, no por el registro de la tarea',
     /hasStartedLocationUpdatesAsync/.test(cuerpoArrancar), cuerpoArrancar.slice(0, 200));

  const cuerpoCadencia = (servicio.match(/async function cambiarCadenciaAhora[\s\S]*?\n}/) || [''])[0];
  ok('cambiarCadencia() también', /hasStartedLocationUpdatesAsync/.test(cuerpoCadencia));

  // 3) Un servicio sin sesión sostenida se apaga SOLO. Pasó: quedó un
  //    servicio huérfano girando para nadie ("sin sesión guardada" ×38),
  //    llenando la cola y quemando batería con la sesión ya borrada.
  ok('la tarea se apaga sola si no hay sesión sostenida',
     /SIN_SESION_TOPE/.test(servicio) && /detenido: sin sesión/.test(servicio));

  // 3bis) Ningún hook puede vivir DESPUÉS de un return condicional. Pasó en
  //    un teléfono real: el useEffect del botón atrás quedó abajo del
  //    `if (!sesion) return <Entrar/>`, así que el componente rendía 22
  //    hooks sin sesión y 23 con sesión — y React corta con "Rendered more
  //    hooks than during the previous render" JUSTO AL ENTRAR. Compila bien,
  //    el chequeo de sintaxis no lo ve, y explota en la primera pantalla.
  {
    const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
    const componentes = app.split(/\n(?=function [A-Z]|export default function )/);
    const infractores = [];
    for (const comp of componentes) {
      const m = comp.match(/^(?:export default )?function (\w+)/);
      if (!m) continue;
      // Un return temprano a nivel del componente (indentación 2) seguido,
      // más abajo, de una llamada a hook.
      const rets = [...comp.matchAll(/\n  if \([^\n]*\) return/g)].map(x => x.index);
      const hooks = [...comp.matchAll(/React\.use\w+\(|useSafeAreaInsets\(|usarTema\(|useVentana\(|useTeclado\(/g)]
        .map(x => x.index);
      if (rets.some(r => hooks.some(h => h > r))) infractores.push(m[1]);
    }
    ok('ningún componente llama hooks después de un return temprano',
       infractores.length === 0, infractores);
  }

  // 4) Y cada posición cuenta como fallida UNA vez aunque se reintente
  //    veinte: sin esto, la misma cola esperando red daba "fallidas 3901"
  //    al lado de "enviadas 568" — un número de catástrofe para un túnel.
  ok('las fallidas no se recuentan en cada reintento',
     /yaContadas/.test(servicio) && /WeakSet/.test(servicio));

  // Y que la pantalla pueda preguntarlo, para que "0 y 0" deje de ser
  // ambiguo entre "todavía ninguna" y "el servicio no existe".
  ok('el servicio expone si está corriendo',
     /export async function estaCorriendo/.test(servicio));
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  ok('y la pantalla lo vigila y lo rearranca',
     /estaCorriendo\(\)/.test(app) && /gps\.arrancar/.test(app));
}

console.log('\nLOS PERMISOS, AL ENTRAR (pruebas en teléfono, 27/11)');
{
  const fs = require('fs');
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const notif = fs.readFileSync(RAIZ + '/app/notificacion.js', 'utf8');
  const efecto = (app.split('const pedidoAlEntrar = React.useRef(null);')[1] || '').split('}, [sesion?.unitId]);')[0];
  ok('al entrar, una vez por persona, se piden ubicación y notificaciones',
     /pedidoAlEntrar\.current === sesion\.unitId\) return;/.test(efecto)
     && /if \(chofer\) await gps\.pedirPermisos\(\)/.test(efecto)
     && /await pedirPermisoNotificaciones\(\)/.test(efecto));
  ok('al cobrador no se le pide la ubicación (no la manda)', /const chofer = sesion\.role !== 'collector';/.test(efecto));
  ok('con la batería optimizada, un aviso que lleva al ajuste',
     /Battery\.isBatteryOptimizationEnabledAsync\(\)/.test(efecto) && /Alert\.alert\(/.test(efecto) && /onPress: abrirOptimizacionDeBateria/.test(efecto));
  ok('salir a ruta los sigue revisando, sin apilar diálogos (una sola pregunta a la vez)',
     /if \(!pidiendoPermisos\) pidiendoPermisos = pedirPermisosAhora\(\)\.finally/.test(servicio) && /const permisos = await gps\.pedirPermisos\(\);/.test(app));
  ok('notificaciones: pedirlo ya, una sola vez', /export async function pedirPermiso\(\) \{\n  miradoEn = 0;\n  await preparar\(\);/.test(notif) && /permiso\.canAskAgain && !preguntado/.test(notif));
}

console.log('\nLA TANDA 4 DE LA REVISIÓN DEL 8/9, POR LECTURA');
{
  // Lo que no se puede probar en Node porque vive en la pantalla o en el
  // servicio nativo: que las líneas estén, y en el orden que importa.
  const fs = require('fs');
  const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const cliente = fs.readFileSync(RAIZ + '/app/protocolo/cliente.js', 'utf8');
  const config = JSON.parse(fs.readFileSync(RAIZ + '/app/app.json', 'utf8'));

  // A1: el SOS dice la verdad
  const sos = (app.match(/function SosDeslizable[\s\S]*?\n}\n/) || [''])[0];
  ok('el SOS tiene cuatro fases: listo, enviando, enviada, fallo',
     /'enviando'/.test(sos) && /'enviada'/.test(sos) && /'fallo'/.test(sos) && /ENVIANDO…/.test(sos) && /NO SALIÓ/.test(sos));
  ok('y «enviada» sale del resultado de onDisparar, no del deslizar',
     /\.then\(\(r\) => \{[\s\S]*?r && r\.ok/.test(sos));
  ok('el cliente espera el eco propio y cae a POST /sos', /esperarEcoSos\(SOS_ECO_MS\)/.test(cliente) && /pedirHttp\('\/sos'/.test(cliente));

  // A2/A3: salir y auth_error limpian de verdad
  ok('el servicio expone limpiarSesion()', /export function limpiarSesion\(\)[\s\S]*?pendientes = \[\];/.test(servicio));
  const onSalir = (app.match(/onSalir: async \(\) => \{([\s\S]*?)\n    \},/) || ['', ''])[1];
  ok('«Salir» espera el «fuera», limpia la sesión del servicio y la cierra en el servidor',
     /await cliente\.current\.marcarPresencia\('fuera'\)/.test(onSalir) && /gps\.limpiarSesion\(\)/.test(onSalir) &&
     /cerrarSesion\(\)/.test(onSalir));
  const authErr = (app.match(/c\.on\('authError', async \(e\) => \{([\s\S]*?)\}\),/) || ['', ''])[1];
  ok('auth_error para el GPS, limpia y borra la sesión del disco',
     /gps\.limpiarSesion\(\)/.test(authErr) && /guardarClave\(gps\.LLAVE_SESION, null\)/.test(authErr) && /gps\.parar\(\)/.test(authErr));
  ok('la tarea se apaga sola con 401 sostenidos y borra la sesión',
     /RECHAZOS_TOPE/.test(servicio) && /sesionRechazada = true/.test(servicio) && /detenido: sesión rechazada/.test(servicio));
  ok('y con 403/409 sostenidos, sin borrarla', /detenidoPor = cuerpo\.error/.test(servicio) && /detenido: sin rol de GPS/.test(servicio));
  ok('lo que estaba en vuelo al salir no vuelve a la cola', /guardarSiSigue/.test(servicio) && /generacion\+\+/.test(servicio));
  ok('y salir DE RUTA vacía la cola (lo de antes del «fuera» no se manda)',
     /export function vaciarCola\(\)/.test(servicio) && /gps\.vaciarCola\(\)/.test(app));
  ok('la pantalla lee los dos flags', /sesionRechazada/.test(app) && /detenidoPor/.test(app));

  // A4: la puerta del cobrador
  ok('el cobrador no tiene el deslizable de salir a ruta', /rol === 'collector' \? \(/.test(app) && /rol: sesion\?\.role/.test(app));
  ok('ni retoma el GPS al abrir', /s\.role === 'collector'\) \{ setPresencia\('fuera'\); return; \}/.test(app));
  // Y no queda encerrado en la puerta: ve el HUD y el mapa de su combi, de
  // acompañante, sin los botones del turno (revisión del manual, 17/11)
  ok('y antes de las brechas, lo que le pasa a su combi (fuera, ausente, yendo, sin señal)', /avisoDeMiCombi\(estadoDeMiCombi\(estado, sesion\.vehicleId\)\)/.test(app) && /\{acompanante && avisoCombi && !hud\.viejo \? \(/.test(app));
  ok('AUSENTE espera 5 s con DESHACER, como en la web', /const DESHACER_AUSENTE_MS = 5000;/.test(app) && /onPress=\{\(\) => setAusenteEn\(Date\.now\(\)\)\}/.test(app) && /onPress=\{\(\) => setAusenteEn\(null\)\}/.test(app) && /setAusenteEn\(null\); onPresencia\('ausente'\);/.test(app));
  ok('el cobrador ve las brechas y el mapa, sin los botones del turno', /const acompanante = rol === 'collector';\n  if \(presencia === 'fuera' && !acompanante\)/.test(app) && /if \(presencia === 'fuera' && rol !== 'collector'\)/.test(app) && /\{!acompanante && \(<>\n      <Pressable onPress=\{\(\) => onTrafico/.test(app) && /ACOMPAÑANTE · la posición de la combi la manda el teléfono del chofer/.test(app));

  // A5: la presencia se puede esperar
  // Y desde la revisión previa a la APK, «ruta» también: con un intento,
  // sin señal en la puerta Despacho no se enteraba hasta reconectar
  ok('marcarPresencia devuelve una promesa y reintenta por HTTP (también «ruta»)',
     /async function marcarPresencia/.test(cliente) && /declararPorHttp\('\/presencia', cuerpo, 3,/.test(cliente));
  ok('la re-declaración al reconectar viaja marcada (no es un relevo)',
     /redeclara: true/.test(cliente) && /presenciaEntregada/.test(cliente) && /retomada: true/.test(app));

  // A6: un solo tope de foto, con motivo en pantalla
  ok('un solo tope de foto (el de imagen.js)', /const TOPE_IMAGEN = MAX_DATAURL;/.test(cliente) && /require\('\.\.\/imagen\.js'\)/.test(cliente));
  ok('y la pantalla dice por qué no salió', /La foto pesa demasiado/.test(app) && /Sin conexión: la foto no salió/.test(app));

  // A14, A15, A17
  ok('app.json: allowBackup=false (grabacion.json no va al backup de Google)', config.expo.android.allowBackup === false);
  ok('el reintento del socket sobrevive a un `new WebSocket` que revienta', /try \{ abrir\(\); \} catch \{ programarReintento\(\); \}/.test(cliente));
  ok('la presentación no espera para siempre a SecureStore', /Promise\.race\(\[\s*SecureStore\.getItemAsync\(gps\.LLAVE_SESION\)/.test(app));
  ok('el APK es otro: versionCode subió', config.expo.android.versionCode >= 3, config.expo.android.versionCode);

  // 10/9: una sola pantalla de arranque. La nativa es sólo el fondo (sin
  // `image`): con el ícono encima se veían dos —el cuadrado azul con el logo
  // y después la presentación con el nombre—, y la cooperativa eligió la
  // segunda. Y el flag de GPS simulado de Android viaja en cada posición.
  //
  // Pero «sin `image`» ya no compila (17/11): con el SDK 54 el tema nativo
  // apunta SIEMPRE a @drawable/splashscreen_logo, y sin imagen ese recurso no
  // se genera → «Android resource linking failed» en processReleaseResources,
  // ya en la nube de Expo y a los 6 minutos. Se le da una imagen TRANSPARENTE:
  // el recurso existe y la pantalla sigue siendo sólo el fondo.
  const splash = (config.expo.plugins || []).find(p => Array.isArray(p) && p[0] === 'expo-splash-screen');
  ok('la pantalla nativa de arranque es sólo el fondo #0A1A2E',
     !!splash && splash[1].backgroundColor === '#0A1A2E', splash && splash[1]);
  ok('…y tiene `image` (sin ella el build de Android no encuentra splashscreen_logo)',
     !!splash && typeof splash[1].image === 'string', splash && splash[1]);
  // La imagen tiene que ser transparente entera, si no aparece el ícono que la
  // cooperativa no quiso. Se lee el PNG a mano: sin filtros ni colores, con
  // todo en cero, los datos descomprimidos son todos ceros.
  const transparente = (() => {
    try {
      const png = fs.readFileSync(path.join(RAIZ, 'app', splash[1].image));
      const tipoColor = png[25];
      const idat = [];
      for (let i = 8; i < png.length;) {
        const largo = png.readUInt32BE(i), tipo = png.toString('ascii', i + 4, i + 8);
        if (tipo === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + largo));
        i += 12 + largo;
      }
      const datos = require('zlib').inflateSync(Buffer.concat(idat));
      return tipoColor === 6 && datos.length > 0 && datos.every(b => b === 0);
    } catch { return false; }
  })();
  ok('…y esa imagen es transparente entera (la pantalla sigue sin ícono)', transparente);
  ok('la presentación sigue con el nombre y «Control de ruta»', /MICROS TEMPO/.test(app) && /Control de ruta/.test(app));
  ok('otro APK más: versionCode 4 o más', config.expo.android.versionCode >= 4, config.expo.android.versionCode);
  ok('la tarea manda `simulado: true` cuando Android marca la posición como falsa', /l\.mocked === true \? \{ simulado: true \}/.test(servicio));

  // TRUCOS paso 2 (T11): la precisión viaja con cada posición, y es otro APK
  ok('la tarea manda `precision` (los metros de error de `accuracy`)', /precision: Math\.round\(l\.coords\.accuracy\)/.test(servicio));
  // Revisión del 10/9, tanda 2 (C2, C13, C5): el relevado se apaga al leer
  // `gpsRole: false`, se cuentan las aceptadas, y el reloj adelantado se dice
  ok('el servicio se apaga cuando el servidor contesta `gpsRole: false`', /if \(cuerpo\.gpsRole === false\) \{/.test(servicio) && /Location\.stopLocationUpdatesAsync\(TAREA_GPS\)/.test(servicio));
  ok('enviadas son las ACEPTADAS por el servidor, y las no usadas se cuentan aparte', /diagnostico\.enviadas \+= Number\.isFinite\(cuerpo\.aceptadas\)/.test(servicio) && /diagnostico\.rechazadas \+= \(cuerpo\.yaVistas \|\| 0\)/.test(servicio));
  ok('y el reloj adelantado llega a la pantalla', /cuerpo\.reloj === 'adelantado'/.test(servicio) && /relojAdelantadoSec/.test(app) && /fecha y hora automáticas/.test(app));
  ok('otro APK más: versionCode 5 o más', config.expo.android.versionCode >= 5, config.expo.android.versionCode);
  // La de la revisión previa a la APK (31/10). Con `appVersionSource:
  // remote` el código lo lleva EAS: sin `autoIncrement` en el perfil `apk`
  // dos APK salían con el mismo número y el aviso de «hay una nueva» no
  // podía distinguirlas.
  const eas = JSON.parse(fs.readFileSync(RAIZ + '/app/eas.json', 'utf8'));
  // 0.3.0 o más: la 0.3.1 (17/11) es la misma APK con la imagen de arranque
  // transparente que el SDK 54 exige para compilar.
  const vNum = String(config.expo.version).split('.').map(Number);
  const desde030 = vNum[0] > 0 || vNum[1] > 3 || (vNum[1] === 3 && vNum[2] >= 0);
  ok('la APK de la revisión: 0.3.0 o más / 6 o más', desde030 && config.expo.android.versionCode >= 6, [config.expo.version, config.expo.android.versionCode]);
  ok('y el perfil apk sube el código solo', eas.build.apk.autoIncrement === true);
  // «Despacho vio tu SOS» (31/10): el cliente lo emite y la pantalla de ruta
  // lo muestra en las tres vistas (puerta, ruta y ausente), hasta tocarlo
  // La salud del teléfono (PENDIENTES 0.4): viaja con las posiciones, sin
  // esperar al módulo nativo (con la pantalla apagada no hay timer que corte)
  ok('la batería y el ahorro de batería viajan con las posiciones',
     /import \* as Battery from 'expo-battery'/.test(servicio) && /telefono: saludDelTelefono\(\)/.test(servicio) &&
     /isBatteryOptimizationEnabledAsync/.test(servicio) && !/await Battery\./.test(servicio));
  // El SOS sin internet (PENDIENTES 0.5): el panel para llamar o mandar un
  // SMS a la central, con el teléfono de la sesión guardada
  ok('si el SOS no sale, el panel para llamar o mandar SMS a la central',
     /function SosSinRed\(/.test(app) && /tel:\$\{central\}/.test(app) && /sms:\$\{central\}\?body=/.test(app) &&
     /else setSosSinRed\(/.test(app) && (app.match(/<SosSinRed fallo=/g) || []).length === 3 &&
     /central=\{sesion\?\.central/.test(app));
  ok('«Despacho vio tu SOS» llega a la pantalla',
     /case 'sos_atendido':/.test(cliente) && /emitir\('sosAtendido', m\)/.test(cliente) &&
     /DESPACHO VIO TU SOS/.test(app) && (app.match(/<SosVisto visto=/g) || []).length === 3);

  // ── Tanda 7 de la revisión del 10/9, por lectura ──────────────────────
  const notif = fs.readFileSync(RAIZ + '/app/notificacion.js', 'utf8');

  // C14: la segunda implementación de POST /gps en el cliente, borrada
  ok('no quedó una segunda implementación de POST /gps en el cliente',
     !/function subirPosiciones/.test(cliente) && !/subirPosiciones,/.test(cliente));

  // C18/P12: `app/cola.js` era una TERCERA cola, muerta y con la cabecera
  // mintiendo («el servidor no acepta posiciones viejas», que sí acepta).
  ok('`app/cola.js` no existe: la cola vive en envio.js + `pendientes`',
     !fs.existsSync(RAIZ + '/app/cola.js') && /mezclarCola\(pendientes, posiciones, TOPE_PENDIENTES\)/.test(servicio));

  // C21: el pedido de grabación de Despacho no se da por cumplido cuando el
  // chofer aprieta PARAR, sino cuando la grabación llega o se descarta.
  ok('«grabando» incluye la grabación parada y todavía sin enviar',
     /grabando: flagGrabando === '1' \|\| archivoGrabacion\?\.exists === true/.test(servicio) &&
     /FileSystem\.getInfoAsync\(ARCHIVO_GRABACION\(\)\)/.test(servicio));

  // C22: al chofer relevado no se le borra la notificación y ya: se le dice
  ok('el relevado ve «modo acompañante» en la notificación, no un vacío',
     /export function notificarSinRol/.test(notif) && /MODO ACOMPAÑANTE/.test(notif) &&
     /notificarSinRol\(cuerpo\.motivo\)/.test(servicio));
  ok('y la reemplaza, no suma una segunda (mismo identificador y canal)',
     /identifier: ID,[\s\S]{0,400}?MODO ACOMPAÑANTE|MODO ACOMPAÑANTE[\s\S]{0,400}?identifier: ID/.test(notif) ||
     /notificarSinRol[\s\S]*?identifier: ID/.test(notif));

  // C20: los ceros sin explicación de dos aparatos del mismo chofer
  ok('el motivo de «no se usó ninguna» llega a la pantalla',
     /diagnostico\.motivoNoUsadas = cuerpo\.motivo \|\| null/.test(servicio) && /diag\.motivoNoUsadas/.test(app));

  // C10: el chat y la voz dejan de perderse en silencio, y el cupo se dice
  ok('la pantalla dice por qué no salió el texto y la nota de voz',
     /el mensaje no salió/.test(app) && /la nota no salió/.test(app));
  ok('y el cupo por minuto del servidor se muestra', /c\.on\('cupo'/.test(app) && /CUPO_ES/.test(app));

  // P10: el perfil sin conexión no es «no se pudo cargar» y nada más
  ok('sin conexión el perfil sigue dando el grabador y un reintento',
     /const bloqueGrabador = /.test(app) && /\{!datos && error && \(<>/.test(app) && /REINTENTAR/.test(app));
  // P11: cerrar todas las sesiones existe en la pantalla
  ok('«cerrar todas mis sesiones» existe y pide dos toques',
     /CERRAR TODAS MIS SESIONES/.test(app) && /todas: true/.test(app) && /confirmarCerrarTodo/.test(app));
  // P13: la grabación sin enviar vive sólo en ese teléfono, y se dice
  ok('la pantalla avisa que la grabación sin enviar vive sólo en el teléfono',
     /vive SOLO en este teléfono/.test(app));

  // C8: el tipo de SOS sale por HTTP con el socket caído
  ok('el tipo de SOS cae a POST /sos/:id/tipo', /pedirHttp\(`\/sos\/\$\{miUltimoSos\}\/tipo`/.test(cliente));
  ok('y si no salió, la pantalla lo dice', /SOS ENVIADO\. El tipo no salió/.test(app));

  // ── Repaso del 21/9 ─────────────────────────────────────────────────
  // Un socket abierto no es un socket vivo: el tipo espera su eco, y si el
  // disparo ya tuvo que salir por HTTP no se insiste con el socket.
  ok('el tipo de SOS espera el eco por el socket y cae a HTTP sin él',
     /esperarEcoTipo\(SOS_TIPO_ECO_MS\)/.test(cliente) && /viaUltimoSos !== 'http' && enviar\(/.test(cliente));
  // La grabación parada y sin enviar sobrevive al reinicio del proceso
  // también en la pantalla, no sólo en el disco.
  ok('la grabación parada se hidrata desde el disco al arrancar',
     /export async function hidratarGrabacionGuardada/.test(servicio) &&
     /hidratarGrabacionGuardada\(\)\.catch/.test(servicio));
  // Y la notificación de «modo acompañante» se va cuando el rol vuelve.
  ok('la notificación de relevo se borra cuando vuelve el rol de GPS',
     /if \(reporta\) \{ gps\.diagnostico\.detenidoPor = null; limpiarSiSinRol\(\)/.test(app));
  // Y SÓLO esa: el rol vuelve en cada reconexión y la brecha no se borra
  ok('limpiarSiSinRol sólo borra si lo puesto es «modo acompañante»',
     /export async function limpiarSiSinRol\(\) \{\s*if \(ultimo !== 'MODO ACOMPAÑANTE'\) return;/.test(notif));
}

console.log('\nLA APK NO ESCRIBE COLORES A MANO (auditoría de UI, A3)');
{
  // Un color escrito a mano no cambia de noche: la burbuja propia seguía azul
  // brillante en la cabina. Quedan tres, y son a propósito: el fondo blanco
  // del logo de la cooperativa, el texto sobre su color de marca y el negro
  // del visor de fotos.
  const app = require('fs').readFileSync(RAIZ + '/app/App.js', 'utf8');
  const sueltos = [...app.matchAll(/'#[0-9A-Fa-f]{3,8}'|"#[0-9A-Fa-f]{3,8}"/g)].map(x => x[0]);
  const permitidos = ["'#fff'", "'#fff'", "'#000000EE'"];
  ok('sólo quedan los tres colores fijos a propósito', JSON.stringify(sueltos.sort()) === JSON.stringify(permitidos.sort()), sueltos);
  // A4: rótulos de 10 px en mono con tracking, en la pantalla del parabrisas
  const chicos = [...app.matchAll(/fontSize: (\d+(?:\.\d+)?)/g)].map(x => Number(x[1])).filter(n => n < 12);
  ok('ningún texto de la APK baja de 12 px (A4)', chicos.length === 0, chicos);
  // A5: el diagnóstico del GPS arriba de la ruta, sólo si hay algo que avisar
  const fuente = (app.match(/function hayProblemaDeGps\([\s\S]*?\n\}/) || [''])[0];
  ok('A5 · el criterio existe y se usa arriba de la ruta', !!fuente && /\{!acompanante && hayProblemaDeGps\(diag\) && <DiagnosticoGps diag=\{diag\} \/>\}/.test(app));
  const hay = new Function(fuente + '\nreturn hayProblemaDeGps;')();
  const T = 1_700_000_000_000, bien = { servicio: 'corriendo', enEspera: 0, ultimoEnvio: T - 3000 };
  ok('A5 · todo andando: no se muestra nada', hay(bien, T) === false);
  ok('A5 · el servicio parado se muestra', hay({ ...bien, servicio: 'detenido' }, T) === true);
  ok('A5 · posiciones esperando, también', hay({ ...bien, enEspera: 4 }, T) === true);
  ok('A5 · nada salió en el último minuto, también', hay({ ...bien, ultimoEnvio: T - 90_000 }, T) === true);
  ok('A5 · un envío colgado, también', hay({ ...bien, enVueloDesde: T - 30_000 }, T) === true);
  ok('A5 · y la batería optimizada', hay({ ...bien, bateriaOptimizada: true }, T) === true);
  ok('A5 · completo en Perfil', /<Text style=\{s\.perfilSeccion\}>EL GPS<\/Text>\s*<DiagnosticoGps diag=\{diag\} \/>/.test(app));
  // A6: la app no consultaba «quitar animaciones»
  ok('A6 · con «quitar animaciones» el carrusel no se desliza', /AccessibilityInfo\.isReduceMotionEnabled\(\)/.test(app) && /if \(menosRef\.current\) \{ x\.setValue\(destino\); return; \}/.test(app) && !/Animated\.spring\(x, \{\s*toValue: -/.test(app));
}

console.log('\nEL PERMISO DE NOTIFICACIONES, DADO DESPUÉS (segunda revisión, 17/11)');
const pruebaNotif = (async () => {
  // notificacion.js de verdad, con un Android simulado: el permiso empieza
  // negado y después se da desde Ajustes. Antes quedaba `sinPermiso = true`
  // para siempre y no salía ni la brecha ni el aviso de GPS detenido.
  const fuente = require('fs').readFileSync(RAIZ + '/app/notificacion.js', 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export (async function|function|const)/gm, '$1');
  const hud = require(RAIZ + '/app/hud.js');
  let concedido = false, pedidos = 0;
  const programadas = [];
  const Notifications = {
    AndroidImportance: { LOW: 2, HIGH: 4 },
    setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ granted: concedido, canAskAgain: true }),
    requestPermissionsAsync: async () => { pedidos++; return { granted: concedido, canAskAgain: true }; },
    scheduleNotificationAsync: async (n) => { programadas.push(n.identifier); },
    cancelScheduledNotificationAsync: async () => {}, dismissNotificationAsync: async () => {},
  };
  let reloj = 1_700_000_000_000;
  const DateFalso = class extends Date { static now() { return reloj; } };
  const m = new Function('Notifications', 'avisoDesdeRespuesta', 'avisoSinSenal', 'Date',
    fuente + '\nreturn { notificarSinSenal, vigilarSilencio, remirarPermiso };')(Notifications, hud.avisoDesdeRespuesta, hud.avisoSinSenal, DateFalso);
  await m.notificarSinSenal(reloj - 120_000, reloj);
  ok('negado: no se programa nada, y se pregunta una sola vez', programadas.length === 0 && pedidos === 1, { programadas, pedidos });
  concedido = true;                                   // lo da desde Ajustes
  reloj += 5_000;
  await m.notificarSinSenal(reloj - 300_000, reloj);
  ok('dentro del minuto no se vuelve a mirar (no se insiste)', programadas.length === 0);
  m.remirarPermiso();                                  // la app vuelve a primer plano
  await m.notificarSinSenal(reloj - 400_000, reloj);
  ok('al volver a primer plano, ya sale la notificación', programadas.length === 1, programadas);
  await m.vigilarSilencio(reloj);
  ok('y el aviso de GPS detenido también se programa', programadas.length === 2, programadas);
  ok('nunca se le volvió a PEDIR al usuario', pedidos === 1, pedidos);
  // Concedido → revocado → concedido, con la app viva (tercera revisión)
  concedido = false; m.remirarPermiso();          // lo quita desde Ajustes y vuelve
  const antes = programadas.length;
  reloj += 61_000;
  await m.notificarSinSenal(reloj - 600_000, reloj);
  ok('revocado: deja de programar (ya no queda «preparado» para siempre)', programadas.length === antes, programadas);
  concedido = true; m.remirarPermiso();           // lo vuelve a dar
  reloj += 1_000;
  await m.notificarSinSenal(reloj - 600_000, reloj);
  ok('concedido otra vez: vuelve a salir', programadas.length === antes + 1, programadas);
  ok('y en todo esto se le pidió una sola vez', pedidos === 1, pedidos);
})();

const pruebaVigia = (async () => {
  console.log('\nEL AVISO DE GPS DETENIDO, APAGADO A MITAD (cuarta revisión, 17/11)');
  // vigilarSilencio esperando el canal → se apaga el vigía → termina la
  // espera vieja: antes volvía a programar «gps-silencio»
  const fuente = require('fs').readFileSync(RAIZ + '/app/notificacion.js', 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export (async function|function|const)/gm, '$1');
  const hud = require(RAIZ + '/app/hud.js');
  const vivas = new Set();
  let soltarCanal = null;
  const Notifications = {
    AndroidImportance: { LOW: 2, HIGH: 4 },
    setNotificationHandler() {},
    setNotificationChannelAsync: (id) => id === 'gps-detenido' && !soltarCanal ? new Promise(res => { soltarCanal = res; }) : Promise.resolve(),
    getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async (n) => { vivas.add(n.identifier); },
    cancelScheduledNotificationAsync: async (id) => { vivas.delete(id); },
    dismissNotificationAsync: async () => {},
  };
  const m = new Function('Notifications', 'avisoDesdeRespuesta', 'avisoSinSenal',
    fuente + '\nreturn { vigilarSilencio, apagarVigiaDeSilencio };')(Notifications, hud.avisoDesdeRespuesta, hud.avisoSinSenal);
  const p = m.vigilarSilencio(Date.now());
  for (let i = 0; i < 10 && !soltarCanal; i++) await new Promise(res => setTimeout(res, 0));
  const apagado = m.apagarVigiaDeSilencio(); // sale de ruta mientras se programaba
  soltarCanal(); await p; await apagado;
  ok('apagado a mitad: el aviso no se vuelve a programar', !vivas.has('gps-silencio'), [...vivas]);
  await m.vigilarSilencio(Date.now() + 120_000);
  ok('y el vigía sigue funcionando después', vivas.has('gps-silencio'), [...vivas]);
  // Quinta revisión: la limpieza de un vigía viejo borraba el NUEVO
  { soltarCanal = null; let soltar2 = null;
    Notifications.setNotificationChannelAsync = (id) => id === 'gps-detenido' && !soltar2 ? new Promise(res => { soltar2 = res; }) : Promise.resolve();
    await m.apagarVigiaDeSilencio();
    const vieja = m.vigilarSilencio(Date.now() + 300_000);    // pendiente del canal
    for (let i = 0; i < 10 && !soltar2; i++) await new Promise(res => setTimeout(res, 0));
    const apagado2 = m.apagarVigiaDeSilencio();
    const nueva = m.vigilarSilencio(Date.now() + 400_000);    // vigilancia nueva
    soltar2(); await vieja; await apagado2; await nueva;
    ok('la vigilancia vieja no borra el aviso de la nueva', vivas.has('gps-silencio'), [...vivas]); }
})();

const pruebaBrecha = (async () => {
  console.log('\nLA BRECHA EN LA BANDEJA, LIMPIADA A MITAD (quinta revisión, 17/11)');
  const fuente = require('fs').readFileSync(RAIZ + '/app/notificacion.js', 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export (async function|function|const)/gm, '$1');
  const hud = require(RAIZ + '/app/hud.js');
  const vivas = new Set();
  let soltarPermiso = null;
  const Notifications = {
    AndroidImportance: { LOW: 2, HIGH: 4 },
    setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
    getPermissionsAsync: () => (soltarPermiso === null ? new Promise(res => { soltarPermiso = () => res({ granted: true, canAskAgain: true }); }) : Promise.resolve({ granted: true, canAskAgain: true })),
    requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async (n) => { vivas.add(n.identifier + ':' + n.content.title); },
    cancelScheduledNotificationAsync: async () => {},
    dismissNotificationAsync: async (id) => { for (const v of [...vivas]) if (v.startsWith(id + ':')) vivas.delete(v); },
  };
  const m = new Function('Notifications', 'avisoDesdeRespuesta', 'avisoSinSenal',
    fuente + '\nreturn { notificarSinSenal, notificarSinRol, limpiarNotificacion };')(Notifications, hud.avisoDesdeRespuesta, hud.avisoSinSenal);
  const T = Date.now();
  const p = m.notificarSinSenal(T - 200_000, T);             // espera el permiso…
  for (let i = 0; i < 10 && !soltarPermiso; i++) await new Promise(res => setTimeout(res, 0));
  const l = m.limpiarNotificacion();                         // …sale de ruta
  soltarPermiso(); await p; await l;
  ok('limpiada a mitad: la brecha vieja no vuelve a la bandeja', ![...vivas].some(v => v.startsWith('brecha-viva:')), [...vivas]);
  await m.notificarSinSenal(T - 200_000, T);
  ok('y el título viejo no quedó guardado: la próxima sí sale', [...vivas].some(v => v.startsWith('brecha-viva:SIN SEÑAL')), [...vivas]);
  const r = m.notificarSinRol('otro chofer'); const l2 = m.limpiarNotificacion();
  await r; await l2;
  ok('«modo acompañante» pedido antes de limpiar tampoco reaparece', ![...vivas].some(v => v.includes('MODO ACOMPAÑANTE')), [...vivas]);
  // Sexta revisión: una limpieza vieja esperando su fila no apaga la
  // vigilancia NUEVA, y el aviso de grabación va por la misma fila
  { const vivas2 = new Set();
    let soltarDismiss = null, soltarPerm = null;
    const N2 = {
      AndroidImportance: { LOW: 2, HIGH: 4 },
      setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
      getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      requestPermissionsAsync: async () => ({ granted: true }),
      scheduleNotificationAsync: async (n) => { vivas2.add(n.identifier); },
      cancelScheduledNotificationAsync: async (id) => { vivas2.delete(id); },
      dismissNotificationAsync: (id) => (id === 'brecha-viva' && !soltarDismiss ? new Promise(res => { soltarDismiss = () => { vivas2.delete(id); res(); }; }) : (vivas2.delete(id), Promise.resolve())),
    };
    const m2 = new Function('Notifications', 'avisoDesdeRespuesta', 'avisoSinSenal',
      fuente + '\nreturn { vigilarSilencio, limpiarNotificacion, notificarGrabacionPedida };')(N2, hud.avisoDesdeRespuesta, hud.avisoSinSenal);
    const l = m2.limpiarNotificacion();              // limpieza del turno anterior, esperando su fila
    for (let i = 0; i < 10 && !soltarDismiss; i++) await new Promise(res => setTimeout(res, 0));
    const v = m2.vigilarSilencio(Date.now() + 900_000);   // vigilancia del turno nuevo
    soltarDismiss(); await l; await v;
    ok('una limpieza vieja no apaga la vigilancia nueva', vivas2.has('gps-silencio'), [...vivas2]);
    N2.getPermissionsAsync = () => new Promise(res => { soltarPerm = () => res({ granted: true, canAskAgain: true }); });
    const g = m2.notificarGrabacionPedida();         // «Despacho pidió grabar», esperando…
    const l2 = m2.limpiarNotificacion();             // …y sale de ruta
    for (let i = 0; i < 10 && !soltarPerm; i++) await new Promise(res => setTimeout(res, 0));
    if (soltarPerm) soltarPerm();
    await g; await l2;
    ok('el aviso de grabación pedido antes de limpiar no aparece después', !vivas2.has('grabacion-pedida'), [...vivas2]); }
})();

const pruebaCliente = (async () => {
  console.log('\nEL CLIENTE: UNA RESPUESTA DE LA SESIÓN ANTERIOR (quinta revisión, 17/11)');
  const { crearCliente } = require(RAIZ + '/app/protocolo/cliente.js');
  class WsFalso { constructor() { this.readyState = 0; } send() {} close() {} }
  let soltar = null;
  const fetchViejo = global.fetch;
  global.fetch = () => new Promise(res => { soltar = (cuerpo) => res({ ok: true, status: 200, json: async () => cuerpo }); });
  try {
    const c = crearCliente({ servidor: 'http://x', WebSocketImpl: WsFalso });
    c.conectar('tokA', { unitId: 'ana', vehicleId: 'M-01', routeId: 'R-14' });
    const p = c.elegirCombi('M-07');                         // A elige combi…
    await new Promise(res => setTimeout(res, 0));
    c.salir();                                               // …sale…
    c.conectar('tokB', { unitId: 'beto', vehicleId: 'M-02', routeId: 'R-14' });   // …entra B
    soltar({ vehicleId: 'M-07', routeId: 'R-14', routeName: '18A' });
    await p;
    ok('la combi que eligió A no se le pone a la sesión de B', c.sesion && c.sesion.unitId === 'beto' && c.sesion.vehicleId === 'M-02', c.sesion);
    c.salir();
  } finally { global.fetch = fetchViejo; }
  const appTexto = require('fs').readFileSync(RAIZ + '/app/App.js', 'utf8');
  // Sexta revisión: la limpieza del authError y el vigilante
  ok('la limpieza del authError se corta si entró otra sesión (no le borra el token ni le para el GPS)',
     /const mia = \(\) => generacion\.current === gen;[\s\S]{0,400}guardarClave\(gps\.LLAVE_PRESENCIA, null\); \} catch \{\}\n\s*if \(!mia\(\)\) return;\n\s*try \{ await guardarClave\(gps\.LLAVE_SESION, null\); \} catch \{\}\n\s*if \(!mia\(\)\) return;\n\s*try \{ await gps\.parar\(\); \} catch \{\}/.test(appTexto));
  ok('el vigilante mira el relevo DESPUÉS de preguntar si el GPS corre',
     /const corriendo = await gps\.estaCorriendo\(\);\n\s*if \(!vivo \|\| saliendo\.current\) return;[\s\S]{0,300}if \(gps\.diagnostico\.detenidoPor \|\| gps\.diagnostico\.sesionRechazada\) return;\n\s*if \(!corriendo\)/.test(appTexto));
  ok('y en la pantalla, misCombis, elegirCombi y la marca miran la sesión que preguntó',
     /if \(generacion\.current !== gen \|\| cerrando\.current\) return;\n      setCombis/.test(appTexto) &&
     /if \(generacion\.current !== gen \|\| cerrando\.current\) return null;\n      alCambiarDeCombi/.test(appTexto) &&
     /if \(!m \|\| !vigenteSesion\(\)\) return;/.test(appTexto));
})();

const pruebaPresencia = (async () => {
  console.log('\nPRESENCIA, PERMISOS Y CIERRE DE SESIÓN (tercera revisión, 17/11)');
  // El cambiarPresencia de verdad, con todo lo de afuera simulado: el
  // AUSENTE que vencía mientras «Salir» esperaba al servidor arrancaba el
  // GPS de una sesión que se cerraba, y salir a ruta declaraba «ruta» antes
  // de saber si había permisos.
  const app = require('fs').readFileSync(RAIZ + '/app/App.js', 'utf8');
  const fuente = app.slice(app.indexOf('  const cerrando = React.useRef(false);'), app.indexOf("  // ── El vigía de la puerta (opción C, 30/10)"));
  const armar = () => {
    const r = { log: [], permisoOk: true, esperarPermiso: null };
    const React = { useRef: (v) => ({ current: v }), useEffect: () => {} };
    const gps = {
      LLAVE_PRESENCIA: 'p', diagnostico: {},
      pedirPermisos: () => { r.log.push('permisos'); return r.esperarPermiso ? r.esperarPermiso : Promise.resolve(r.permisoOk ? { ok: true } : { ok: false, cual: 'segundo plano' }); },
      arrancar: async () => { r.log.push('arrancar'); }, parar: async () => { r.log.push('parar'); }, vaciarCola: () => {},
    };
    const env = {
      React, gps, sesion: { unitId: 'pedro' }, reporta: true, textoRef: { current: '' }, saliendo: { current: false },
      setPresencia: (v) => r.log.push('presencia:' + v), setAviso: (v) => r.log.push('aviso:' + (v ? 'si' : 'no')),
      SecureStore: { setItemAsync: async () => {} }, limpiarNotificacion: async () => {},
      cliente: { current: { marcarPresencia: (v) => r.log.push('declara:' + v) } },
    };
    const entrar = app.slice(app.indexOf('  const entrarConSesion = async (s, genDada) => {'), app.indexOf('  // ── El vigía de la puerta (opción C, 30/10)') > 0 ? app.indexOf('\n  };\n', app.indexOf('  const entrarConSesion = async (s, genDada) => {')) + 5 : 0);
    Object.assign(env, {
      setSesion: () => {}, guardarCentral: () => {}, SERVIDOR: 'x', setMarca: () => {},
    });
    env.SecureStore.getItemAsync = async () => r.guardada || null;
    env.SecureStore.deleteItemAsync = async () => {};
    env.cliente.current.conectar = () => {}; env.cliente.current.pedirMarca = () => new Promise(() => {});
    const f = new Function(...Object.keys(env), fuente + entrar + '\nreturn { cerrando, cambiarPresencia, entrarConSesion, empezarSesion, terminarSesion, guardarClave };')(...Object.values(env));
    return { ...f, r };
  };
  { const { cambiarPresencia, r } = armar(); r.permisoOk = false;
    await cambiarPresencia('ruta');
    ok('sin permisos no se declara «ruta» ni se cambia la pantalla', !r.log.some(x => x.startsWith('declara') || x.startsWith('presencia')) && r.log.includes('aviso:si'), r.log); }
  { const { cambiarPresencia, r } = armar();
    await cambiarPresencia('ruta');
    ok('con permisos: primero los permisos, después declarar y arrancar', r.log.join(',') === 'permisos,aviso:no,presencia:ruta,declara:ruta,arrancar', r.log); }
  { const { cambiarPresencia, cerrando, r } = armar();
    cerrando.current = true;   // «Salir» ya empezó
    await cambiarPresencia('ausente');
    ok('con la sesión cerrándose, AUSENTE no hace nada', r.log.length === 0, r.log); }
  { const { cambiarPresencia, cerrando, r } = armar();
    let soltar; r.esperarPermiso = new Promise(res => { soltar = res; });
    const p = cambiarPresencia('ausente');          // vence AUSENTE: se declara y pide permisos
    await new Promise(res => setTimeout(res, 0));
    cerrando.current = true;                        // mientras, «Salir»
    soltar({ ok: true }); await p;
    ok('AUSENTE ya empezado no arranca el GPS si la sesión se cerró en el medio', !r.log.includes('arrancar'), r.log); }
  { const { cambiarPresencia, r } = armar();
    let soltar; r.esperarPermiso = new Promise(res => { soltar = res; });
    const p1 = cambiarPresencia('ruta');
    r.esperarPermiso = null;
    await cambiarPresencia('fuera');                // llega otro cambio antes
    soltar({ ok: true }); await p1;
    ok('un cambio viejo se corta si llegó uno más nuevo', !r.log.includes('declara:ruta') && r.log.includes('declara:fuera'), r.log); }
  // H11 y H12 (pruebas en teléfono): el GPS se para ANTES de declarar
  // «fuera». Al revés, un lote de la tarea de fondo tomado en ese hueco
  // devolvía la combi al mapa con la sesión ya cerrada.
  { const { cambiarPresencia, r } = armar();
    await cambiarPresencia('fuera');
    ok('SALIR DE RUTA: primero se para el GPS, después se declara «fuera»',
       r.log.indexOf('parar') >= 0 && r.log.indexOf('parar') < r.log.indexOf('declara:fuera'), r.log); }
  { // H8 y H9: el servicio que Android da por corriendo y no da lecturas
    const { servicioMudo: m, MUDO_MS, REARRANQUE_CADA_MS } = require(RAIZ + '/app/vigilante.js');
    const base = { corriendo: true, primerPlano: true, desde: 0 };
    const t = 10 * 60_000;
    ok('un minuto sin lecturas, con la app adelante: mudo', m({ ...base, ahora: t, ultimaLectura: t - MUDO_MS }) === true);
    ok('con una lectura reciente: no', m({ ...base, ahora: t, ultimaLectura: t - 5000 }) === false);
    ok('recién empezada la salida (sin lecturas todavía): no', m({ ...base, ahora: t, desde: t - 20_000 }) === false);
    ok('con la app atrás no se juzga (Android espacia las lecturas)', m({ ...base, primerPlano: false, ahora: t, ultimaLectura: 0 }) === false);
    ok('si Android dice que NO corre, es el otro camino (rearrancar sin parar)', m({ ...base, corriendo: false, ahora: t }) === false);
    ok('rearrancado hace poco: no se insiste', m({ ...base, ahora: t, ultimaLectura: 0, ultimoRearranque: t - REARRANQUE_CADA_MS + 1000 }) === false);
    ok('y pasado el plazo, si sigue mudo, otra vez', m({ ...base, ahora: t, ultimaLectura: 0, ultimoRearranque: t - REARRANQUE_CADA_MS }) === true);
    ok('el vigilante lo usa: rearranca A LA FUERZA el servicio mudo (no parar + arrancar, que preguntaban a Android)',
       /servicioMudo\(\{[\s\S]{0,300}\}\)\) \{[\s\S]{0,2500}\} else \{\s*console\.warn\('\[gps\] mudo: se rearranca'\);\s*gps\.rearrancar\(/.test(app));
    ok('si ya se había rearrancado y sigue mudo, se lo dice al chofer (sin recargar el JavaScript)',
       /if \(repetido\) \{[\s\S]{0,120}setAviso\('El GPS no está dando tu ubicación/.test(app) && !/Updates\.reloadAsync\(/.test(app));
    ok('y cada lectura que llega lo anota', /cuandoLlegueUnaPosicion\(\(p\) => \{[\s\S]{0,120}ultimaLectura\.current = Date\.now\(\);/.test(app));
  }
  { // H19 y H24: un solo texto para la sesión que dejó de valer
    const i = app.indexOf("const SESION_YA_NO_VALE");
    const f = new Function(app.slice(i, app.indexOf('\nfunction ElegirCombi', i)) + '\nreturn { avisoDeSesionCerrada, SESION_YA_NO_VALE };')();
    const iguales = ['Sesión inválida o expirada', 'Sesión cerrada', 'Tu sesión terminó. Vuelve a entrar.', '', null]
      .map(f.avisoDeSesionCerrada);
    ok('los textos del servidor para la sesión cerrada salen como uno solo',
       iguales.every(t => t === f.SESION_YA_NO_VALE), iguales);
    ok('lo que no es de la sesión pasa como viene',
       f.avisoDeSesionCerrada('Tu cooperativa todavía no tiene ninguna ruta cargada') === 'Tu cooperativa todavía no tiene ninguna ruta cargada');
    ok('el authError usa ese texto', /setAviso\(avisoDeSesionCerrada\(e\)\)/.test(app));
  }
  ok('Salir (cerrar sesión): el GPS se para antes del «fuera»',
     /onSalir: async \(\) => \{[\s\S]*?await gps\.parar\(\);[\s\S]*?marcarPresencia\('fuera'\)/.test(app) &&
     !/onSalir: async \(\) => \{[\s\S]*?marcarPresencia\('fuera'\)[\s\S]*?await gps\.parar\(\);[\s\S]*?\n    \},/.test(app));
  // Cuarta revisión: la sesión tiene GENERACIÓN
  { const { entrarConSesion, terminarSesion, r } = armar();
    r.guardada = 'ruta';
    let soltar; r.esperarPermiso = new Promise(res => { soltar = res; });
    const p = entrarConSesion({ token: 't', role: 'driver' });   // retoma el turno: espera permisos
    await new Promise(res => setTimeout(res, 0));
    terminarSesion();                                              // llega authError
    soltar({ ok: true }); await p;
    ok('retomar el turno se corta si la sesión terminó mientras Android preguntaba', !r.log.includes('declara:ruta') && !r.log.includes('arrancar'), r.log); }
  { const { cambiarPresencia, terminarSesion, empezarSesion, r } = armar();
    empezarSesion();
    let soltar; r.esperarPermiso = new Promise(res => { soltar = res; });
    const p = cambiarPresencia('ruta');                            // pendiente de la sesión vieja
    await new Promise(res => setTimeout(res, 0));
    terminarSesion(); empezarSesion();                             // salió y entró otra vez
    soltar({ ok: true }); await p;
    ok('algo pendiente de la sesión anterior no vale en la siguiente', !r.log.includes('declara:ruta') && !r.log.includes('arrancar'), r.log); }
  { const { cambiarPresencia, terminarSesion, r } = armar();
    terminarSesion();                                              // «Salir» empezó…
    // …y llega una actualización de la central (antes: efecto [sesion] → cerrando = false)
    await cambiarPresencia('ausente');
    ok('una actualización de la sesión no reabre el cierre', r.log.length === 0, r.log); }
  // Séptima revisión: la sesión guardada se escribe en FILA
  { const { guardarClave } = armar();
    const disco = {}; const soltar = [];
    // El disco simulado, con la PRIMERA operación diferida (el borrado de A ya empezado)
    let primera = true;
    const SecureStoreLento = {
      setItemAsync: (k, v) => new Promise(res => { const f = () => { disco[k] = v; res(); }; if (primera) { primera = false; soltar.push(f); } else f(); }),
      deleteItemAsync: (k) => new Promise(res => { const f = () => { delete disco[k]; res(); }; if (primera) { primera = false; soltar.push(f); } else f(); }),
    };
    const fuenteFila = app.slice(app.indexOf('  const filaClaves = React.useRef(Promise.resolve());'), app.indexOf('  const cambiarPresencia = async (nueva, motivo) => {'));
    const g = new Function('React', 'SecureStore', fuenteFila + '\nreturn guardarClave;')({ useRef: (v) => ({ current: v }) }, SecureStoreLento);
    const borradoA = g('sesion', null);                       // A empezó a borrar (y tarda)
    await new Promise(res => setTimeout(res, 0));
    const guardadoB = g('sesion', '{"usuario":"beto"}');      // B entra y guarda
    await new Promise(res => setTimeout(res, 0));
    soltar.forEach(f => f()); await borradoA; await guardadoB;
    ok('el borrado de A que ya empezó no se lleva la sesión guardada de B', disco.sesion === '{"usuario":"beto"}', disco); }
  ok('al entrar, la sesión es dueña ANTES de guardarse',
     /onEntrar=\{async \(s\) => \{[\s\S]{0,300}const gen = empezarSesion\(\);\n\s*await guardarClave\(gps\.LLAVE_SESION/.test(app) && /entrarConSesion\(s, gen\)/.test(app) && /const gen = genDada \?\? empezarSesion\(\);/.test(app));
  ok('ninguna escritura de la sesión o la presencia guardadas por fuera de la fila',
     !/SecureStore\.(setItemAsync|deleteItemAsync)\(gps\.LLAVE_(SESION|PRESENCIA)/.test(app));
})();

const pruebaPermisos = (async () => {
  console.log('\nLOS PERMISOS: UNA SOLA PREGUNTA A LA VEZ (27/11)');
  // El código real de servicio.js, con el diálogo de Android simulado y
  // abierto hasta que la prueba lo suelta: al entrar ya se está preguntando
  // y el chofer desliza SALIR A RUTA.
  const srv = require('fs').readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const bloque = srv.slice(srv.indexOf('let pidiendoPermisos = null;'), srv.indexOf('// OJO CON LA PREGUNTA QUE SE HACE ACÁ.')).replace(/^export /gm, '');
  const armar = (respuesta) => {
    // `soltar` contesta TODOS los diálogos abiertos: con dos, la prueba
    // falla por la cuenta en vez de quedarse colgada esperando al primero
    const abiertos = [];
    const r = { frente: 0, fondo: 0, soltar: () => { while (abiertos.length) abiertos.shift()({ status: respuesta }); } };
    const Location = {
      requestForegroundPermissionsAsync: () => { r.frente++; return new Promise(res => { abiertos.push(res); }); },
      requestBackgroundPermissionsAsync: async () => { r.fondo++; return { status: respuesta }; },
    };
    const { pedirPermisos } = new Function('Location', bloque + '\nreturn { pedirPermisos };')(Location);
    return { pedirPermisos, r };
  };
  { const { pedirPermisos, r } = armar('granted');
    const alEntrar = pedirPermisos(); const alSalir = pedirPermisos();
    await new Promise(res => setTimeout(res, 0)); r.soltar();
    const [a, b] = await Promise.all([alEntrar, alSalir]);
    ok('entrar y deslizar a la vez: un solo diálogo, y los dos reciben la respuesta', r.frente === 1 && r.fondo === 1 && a.ok && b.ok, { r, a, b }); }
  { const { pedirPermisos, r } = armar('denied');
    const p1 = pedirPermisos(); await new Promise(res => setTimeout(res, 0)); r.soltar(); await p1;
    const p2 = pedirPermisos(); await new Promise(res => setTimeout(res, 0)); r.soltar(); const b = await p2;
    ok('negado al entrar: al deslizar se vuelve a preguntar (la respuesta no queda pegada)', r.frente === 2 && b.ok === false && b.cual === 'primer plano', { r, b }); }
})();

const pruebaFilaGps = (async () => {
  console.log('\nEL GPS: ARRANCAR Y PARAR EN FILA (cuarta revisión, 17/11)');
  // La fila real de servicio.js con Location y TaskManager simulados, y las
  // respuestas nativas DIFERIDAS: un arrancar que ya empezó terminaba
  // después del parar y dejaba el servicio «corriendo».
  const srv = require('fs').readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const bloqueReal = srv.slice(srv.indexOf('// ── Arrancar, parar y cambiar la cadencia, en FILA'), srv.indexOf('// Para mirarlo desde la pantalla sin adivinar.'))
    .replace(/^export /gm, '');
  let bloque = bloqueReal;
  const armar = () => {
    const r = { log: [], corriendo: false, soltar: [] };
    const diferido = (nombre, efecto) => () => new Promise(res => { r.soltar.push(() => { r.log.push(nombre); if (efecto) efecto(); res(); }); });
    const Location = {
      Accuracy: { High: 4 },
      hasStartedLocationUpdatesAsync: async () => r.corriendo,
      startLocationUpdatesAsync: diferido('start', () => { r.corriendo = true; }),
      stopLocationUpdatesAsync: diferido('stop', () => { r.corriendo = false; }),
    };
    const TaskManager = { isTaskRegisteredAsync: async () => false, unregisterTaskAsync: async () => {} };
    const diagnostico = {};
    const f = new Function('Location', 'TaskManager', 'diagnostico', 'TAREA_GPS', 'CADENCIA_PANTALLA_ENCENDIDA', 'hidratarGrabacionGuardada', 'limpiarNotificacion',
      'let generacion = 0;\n' + bloque + '\nreturn { arrancar, parar, rearrancar, cambiarCadencia, pararDesdeLaTarea, nuevaSesion: () => { generacion++; } };')(Location, TaskManager, diagnostico, 't', 3000, async () => {}, async () => {});
    const vaciar = async () => { for (let i = 0; i < 50; i++) { await new Promise(res => setTimeout(res, 0)); while (r.soltar.length) r.soltar.shift()(); } };
    return { ...f, r, diagnostico, vaciar, Location };
  };
  { const { arrancar, parar, r, diagnostico, vaciar } = armar();
    const a = arrancar();                 // empieza a arrancar…
    await new Promise(res => setTimeout(res, 0));
    const p = parar();                    // …y le piden parar antes de que termine
    await vaciar(); await a; await p;
    ok('arrancar empezado y después parar: queda DETENIDO', r.corriendo === false && diagnostico.servicio === 'detenido', { log: r.log, diag: diagnostico.servicio }); }
  { const { arrancar, parar, r, vaciar } = armar();
    const p = parar(); const a = arrancar();          // parar y enseguida arrancar: gana el último
    await vaciar(); await p; await a;
    ok('parar y después arrancar: queda corriendo (el último pedido manda)', r.corriendo === true, r.log); }
  { const { parar, cambiarCadencia, r, vaciar } = armar();
    r.corriendo = true;
    const c = cambiarCadencia(10000, 'x'); const p = parar();
    await vaciar(); await c; await p;
    ok('una cadencia pedida antes de parar no rearranca el servicio', r.corriendo === false && !r.log.includes('start'), r.log); }
  // Quinta revisión: las paradas de la TAREA (relevo, sesión rechazada…)
  // también van por la fila
  { const { cambiarCadencia, pararDesdeLaTarea, r, diagnostico, vaciar } = armar();
    r.corriendo = true;
    const c = cambiarCadencia(10000, 'x');            // espera una respuesta nativa…
    await new Promise(res => setTimeout(res, 0));
    const p = pararDesdeLaTarea('detenido: sin rol de GPS');   // …y llega el relevo
    await vaciar(); await c; await p;
    ok('relevo con una cadencia en vuelo: queda detenido, con el motivo', r.corriendo === false && diagnostico.servicio === 'detenido: sin rol de GPS', { log: r.log, diag: diagnostico.servicio }); }
  // Sexta revisión: una parada decidida DESPUÉS de esperar al servidor, con
  // la sesión ya cambiada, no es de nadie
  { const { pararDesdeLaTarea, nuevaSesion, r, vaciar } = armar();
    r.corriendo = true;                       // el GPS de la sesión NUEVA
    nuevaSesion();                            // A se cerró, B arrancó…
    const p = pararDesdeLaTarea('detenido: ausente mucho tiempo', 0);   // …y responde el POST viejo de A
    await vaciar(); await p;
    ok('una parada de la sesión anterior no detiene el GPS de la siguiente', r.corriendo === true && !r.log.includes('stop'), r.log); }
  { const srvTexto = require('fs').readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
    ok('las seis paradas de la tarea llevan la generación de su sesión', (srvTexto.match(/await pararDesdeLaTarea\('[^']+', gen\);/g) || []).length === 6);
    // Séptima revisión: después de CADA espera, ningún efecto si la sesión cambió
    ok('ausente mucho tiempo: después del POST, nada si la sesión cambió', /body: JSON\.stringify\(\{ estado: 'fuera' \}\),\n\s*\}, control\);\n\s*\} catch \{\}\n\s*if \(!mia\(\)\) return;\n\s*diagnostico\.servicio = 'detenido: ausente mucho tiempo';/.test(srvTexto));
    ok('volvió solo: después del POST, nada si la sesión cambió', /\} catch \{\}\n\s*if \(!mia\(\)\) return;\n\s*diagnostico\.servicio = 'detenido: volvió a ruta solo y nunca pisó el trazado';/.test(srvTexto));
    ok('la respuesta de error de otra sesión tampoco se aplica (ni borra la sesión guardada)', /\} else \{\n\s*\/\/ Lo mismo que con el 200: la respuesta de otra sesión no se aplica\n\s*if \(!mia\(\)\) return;/.test(srvTexto)); }
  // Ronda 3 en teléfono (H8 y H9): «corriendo» con nada enviado
  { const { arrancar, rearrancar, r, diagnostico, vaciar } = armar();
    r.corriendo = true;                       // Android dice que corre (el registro), pero no da nada
    const a = arrancar(); await vaciar(); await a;
    ok('arrancar con Android diciendo «ya corre» no hace nada (por eso no alcanzaba)', !r.log.includes('start'), r.log);
    const re = rearrancar({ textoNotificacion: 'x' }); await vaciar(); await re;
    ok('rearrancar A LA FUERZA para y arranca aunque Android diga que corre',
       r.log.join(',') === 'stop,start' && diagnostico.servicio === 'corriendo' && diagnostico.rearranques === 1, { log: r.log, diag: diagnostico }); }
  { const { rearrancar, parar, r, vaciar } = armar();
    r.corriendo = true;
    const re = rearrancar({}); const p = parar();       // rearrancar y enseguida salir de ruta
    await vaciar(); await re; await p;
    ok('un rearranque pedido antes de parar no deja el GPS prendido', r.corriendo === false && !r.log.includes('start'), r.log); }
  { const { rearrancar, r, diagnostico, vaciar, Location } = armar();
    r.corriendo = true;
    Location.stopLocationUpdatesAsync = async () => { throw new Error('servicio no encontrado'); };
    const re = rearrancar({}); await vaciar(); await re;
    ok('si parar falla, rearrancar arranca igual y deja el error a la vista',
       r.log.includes('start') && /parar: servicio no encontrado/.test(diagnostico.errorServicio || ''), { log: r.log, err: diagnostico.errorServicio }); }
  { // Una llamada nativa que no vuelve nunca no bloquea la fila para siempre
    bloque = bloqueReal.replace('const PLAZO_FILA_MS = 20_000;', 'const PLAZO_FILA_MS = 60;');
    const { arrancar, parar, r, diagnostico, Location } = armar();
    bloque = bloqueReal;
    Location.startLocationUpdatesAsync = () => new Promise(() => {});   // colgado
    const a = arrancar(); a.catch(() => {});
    await new Promise(res => setTimeout(res, 0));          // el arranque ya empezó y quedó colgado
    const p = parar();
    await new Promise(res => setTimeout(res, 150));
    while (r.soltar.length) r.soltar.shift()();
    let paro = false; await Promise.race([p.then(() => { paro = true; }), new Promise(res => setTimeout(res, 100))]);
    ok('un arranque colgado no deja colgado al parar de después (la fila tiene plazo)', paro && /no respondió/.test(diagnostico.errorServicio || ''), { paro, err: diagnostico.errorServicio });
    ok('el plazo de verdad es de 20 s', /const PLAZO_FILA_MS = 20_000;/.test(bloqueReal)); }
  // Ronda 4 en teléfono (H8 y H9, la causa): expo-location rechaza el
  // arranque con la notificación fija si cree que la app está atrás
  const conAtras = (r, Location) => {
    r.atras = true; r.opciones = [];
    Location.startLocationUpdatesAsync = async (_t, o) => {
      r.opciones.push(!!o.foregroundService);
      if (o.foregroundService && r.atras) {
        throw new Error("Call to function 'ExpoLocation.startLocationUpdatesAsync' has been rejected. → Caused by: Couldn't start the foreground service. Foreground service cannot be started when the application is in the background");
      }
      r.corriendo = true;
    };
  };
  { const { rearrancar, r, diagnostico, vaciar, Location } = armar();
    conAtras(r, Location);
    const re = rearrancar({ textoNotificacion: 'x' }); await vaciar(); await re;
    ok('rechazado «por estar atrás», arranca SIN la notificación fija en vez de quedar mudo',
       r.corriendo === true && r.opciones.join(',') === 'true,false' && diagnostico.sinPrimerPlano === true && diagnostico.servicio === 'corriendo',
       { opciones: r.opciones, diag: diagnostico });
    r.atras = false;                              // la app pasó por atrás y volvió
    const re2 = rearrancar({ textoNotificacion: 'x' }); await vaciar(); await re2;
    ok('y al volver al frente, el rearranque vuelve a la notificación fija',
       r.opciones.slice(-1)[0] === true && diagnostico.sinPrimerPlano === false, { opciones: r.opciones, sin: diagnostico.sinPrimerPlano }); }
  { const { arrancar, r, diagnostico, vaciar, Location } = armar();
    conAtras(r, Location);
    Location.startLocationUpdatesAsync = ((orig) => async (t, o) => {
      if (!o.foregroundService) throw new Error('Background location permission not granted');
      return orig(t, o);
    })(Location.startLocationUpdatesAsync);
    const a = arrancar({}); a.catch(() => {}); await vaciar(); await a.catch(() => {});
    ok('sin el permiso «todo el tiempo» el segundo intento también falla, y ese error queda a la vista',
       r.corriendo === false && /Background location/.test(diagnostico.errorServicio || ''), diagnostico.errorServicio); }
  { const { cambiarCadencia, r, diagnostico, vaciar, Location } = armar();
    r.corriendo = true;
    conAtras(r, Location);
    const c = cambiarCadencia(10000, 'x'); await vaciar(); await c;
    ok('bajar la cadencia con la pantalla apagada (la app ya atrás) no deja un error del servicio',
       !diagnostico.errorServicio && r.corriendo === true, diagnostico.errorServicio); }
  { const { cambiarCadencia, r, diagnostico, vaciar, Location } = armar();
    r.corriendo = true; diagnostico.sinPrimerPlano = true;
    conAtras(r, Location);
    const c = cambiarCadencia(3000, 'x'); await vaciar(); await c;
    ok('sin la notificación fija, cambiar la cadencia no se intenta', r.opciones.length === 0, r.opciones); }
  { const app = require('fs').readFileSync(RAIZ + '/app/App.js', 'utf8');
    ok('con VER prendido, el campo sigue siendo de contraseña: el teclado nunca recibe la clave como texto común',
       /value=\{clave\} onChangeText=\{setClave\}\s*secureTextEntry autoCapitalize/.test(app) && !/secureTextEntry=\{!verClave\}/.test(app));
    ok('y la clave se ve en una línea aparte', /\{verClave && \(\s*<Text style=\{s\.claveVista\}/.test(app));
    ok('al volver al frente con el GPS sin notificación fija, se rearranca',
       /if \(activo && gps\.diagnostico\.sinPrimerPlano\) \{\s*gps\.rearrancar\(/.test(app));
    ok('y se le dice al chofer qué hacer mientras tanto',
       /gps\.diagnostico\.sinPrimerPlano && !avisadoSinPrimerPlano\.current[\s\S]{0,200}Toca el botón de inicio de Android/.test(app)); }
  { const srvTexto = require('fs').readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
    ok('la tarea cuenta lo que Android le entrega, antes de filtrar', /diagnostico\.lecturas \+= data\.locations\.length;/.test(srvTexto) && /diagnostico\.repetidas \+= crudas\.length - posiciones\.length;/.test(srvTexto)); }
  { const srvTexto = require('fs').readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
    ok('la tarea ya no detiene el GPS por fuera de la fila', !/try \{ await Location\.stopLocationUpdatesAsync\(TAREA_GPS\); \} catch \{\}/.test(srvTexto) && (srvTexto.match(/await pararDesdeLaTarea\('/g) || []).length === 6); }
})();

const pruebaTarea = (async () => {
  console.log('\nLA TAREA DE FONDO DE VERDAD: UNA CORRIDA VIEJA (octava revisión, 17/11)');
  // servicio.js ENTERO, con lo de Expo simulado y un servidor (XHR) y un
  // disco diferidos. A espera algo → sale A (limpiarSesion) → termina lo de A.
  const RA = RAIZ + '/app/';
  const fuente = require('fs').readFileSync(RA + 'gps/servicio.js', 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export (async function|function|const|let)/gm, '$1');
  const armar = () => {
    const r = { tarea: null, xhr: null, disco: { sesion: JSON.stringify({ token: 'tA' }), servidor: 'http://x', presencia: 'ruta' },
                lecturaPresencia: null, diferirPresencia: false, brechas: 0, sinSenal: 0, grabaciones: 0 };
    const SecureStore = {
      getItemAsync: (k) => (k === 'presencia' && r.diferirPresencia
        ? new Promise(res => { r.lecturaPresencia = () => res(r.disco[k] ?? null); })
        : Promise.resolve(r.disco[k] ?? null)),
      setItemAsync: async (k, v) => { r.disco[k] = v; }, deleteItemAsync: async (k) => { delete r.disco[k]; },
    };
    class XHR { open() {} setRequestHeader() {} send() { r.xhr = this; } abort() {} }
    const env = {
      Location: { Accuracy: { High: 4 }, hasStartedLocationUpdatesAsync: async () => true, startLocationUpdatesAsync: async () => {}, stopLocationUpdatesAsync: async () => {} },
      TaskManager: { defineTask: (n, fn) => { r.tarea = fn; }, isTaskRegisteredAsync: async () => true, unregisterTaskAsync: async () => {} },
      SecureStore,
      FileSystem: { documentDirectory: 'file:///', getInfoAsync: async () => ({ exists: false }), writeAsStringAsync: async () => {}, readAsStringAsync: async () => '', deleteAsync: async () => {} },
      Application: { nativeApplicationVersion: '0.3.0', nativeBuildVersion: '6' },
      Battery: { getBatteryLevelAsync: async () => 0.8, getBatteryStateAsync: async () => 1, isBatteryOptimizationEnabledAsync: async () => false, BatteryState: { CHARGING: 2, FULL: 3 } },
      crearVigia: require(RA + 'ausencia.js').crearVigia,
      ...require(RA + 'envio.js'), crearPedidor: require(RA + 'pedido.js').crearPedidor,
      notificarBrecha: async () => { r.brechas++; }, notificarSinSenal: async () => { r.sinSenal++; },
      notificarGrabacionPedida: async () => { r.grabaciones++; }, notificarSinRol: async () => {}, limpiarNotificacion: async () => {}, vigilarSilencio: async () => {},
      crearGrabador: require(RA + 'grabador.js').crearGrabador,
      ...require(RA + 'version.js'),
      Updates: { updateId: null, createdAt: null, isEmbeddedLaunch: true },
      XMLHttpRequest: XHR,
    };
    const m = new Function(...Object.keys(env), fuente + '\nreturn { limpiarSesion, diagnostico };')(...Object.values(env));
    return { ...m, r };
  };
  const tic = () => new Promise(res => setTimeout(res, 0));
  const hasta = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await tic(); };
  const pos = () => ({ data: { locations: [{ coords: { latitude: -15.49, longitude: -70.13, speed: 5, accuracy: 8 }, timestamp: Date.now() }] } });
  const responder = (xhr, cuerpo) => { xhr.status = 200; xhr.responseText = JSON.stringify(cuerpo); xhr.onload(); };
  const cuerpoOk = { brecha: { toAhead: '05:00', aheadUnit: 'M-02' }, grabar: true };
  // Control: sin cambio de sesión, la brecha SÍ se publica
  { const { r } = armar();
    const corrida = r.tarea(pos()); await hasta(() => r.xhr); responder(r.xhr, cuerpoOk); await corrida; await tic();
    ok('control: misma sesión, la brecha se publica', r.brechas === 1, r); }
  // 1 · éxito: A espera leer la presencia → sale A → termina la lectura
  { const { limpiarSesion, r } = armar();
    const corrida = r.tarea(pos()); await hasta(() => r.xhr);
    r.diferirPresencia = true; responder(r.xhr, cuerpoOk);
    await hasta(() => r.lecturaPresencia);
    limpiarSesion();                                  // sale A, entra B
    r.lecturaPresencia(); await corrida; await tic();
    ok('respuesta vieja: ni brecha ni pedido de grabación para la sesión siguiente', r.brechas === 0 && r.grabaciones === 0, { brechas: r.brechas, grab: r.grabaciones }); }
  // Control: sin cambio de sesión, la falla de red SÍ pone «SIN SEÑAL»
  { const { r, diagnostico } = armar();
    const corrida = r.tarea(pos()); await hasta(() => r.xhr); r.xhr.onerror(); await corrida; await tic();
    ok('control: misma sesión, sin red se anota y sale «SIN SEÑAL»', r.sinSenal === 1 && diagnostico.ultimoError === 'sin red', { s: r.sinSenal, e: diagnostico.ultimoError }); }
  // 2 · excepción de red: envío de A pendiente → sale A → falla el envío
  { const { limpiarSesion, r, diagnostico } = armar();
    const corrida = r.tarea(pos()); await hasta(() => r.xhr);
    limpiarSesion();                                  // sale A, entra B
    r.xhr.onerror(); await corrida; await tic();
    ok('falla vieja: ni «sin red» en el diagnóstico ni «SIN SEÑAL» en la bandeja de B', r.sinSenal === 0 && diagnostico.ultimoError === null, { s: r.sinSenal, e: diagnostico.ultimoError }); }
})();

Promise.all([pruebaPermisos.catch(e => { ok('la prueba de los permisos corrió', false, e.stack); }), pruebaNotif.catch(e => { ok('la prueba de notificaciones corrió', false, e.stack); }), pruebaPresencia.catch(e => { ok('la prueba de presencia corrió', false, e.stack); }), pruebaFilaGps.catch(e => { ok('la prueba de la fila del GPS corrió', false, e.stack); }), pruebaVigia.catch(e => { ok('la prueba del vigía corrió', false, e.stack); }), pruebaBrecha.catch(e => { ok('la prueba de la brecha corrió', false, e.stack); }), pruebaCliente.catch(e => { ok('la prueba del cliente corrió', false, e.stack); }), pruebaTarea.catch(e => { ok('la prueba de la tarea corrió', false, e.stack); })]).then(() => {
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
});
