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
  const cuerpoArrancar = (servicio.match(/export async function arrancar[\s\S]*?\n}/) || [''])[0];
  ok('arrancar() decide por el SERVICIO, no por el registro de la tarea',
     /hasStartedLocationUpdatesAsync/.test(cuerpoArrancar), cuerpoArrancar.slice(0, 200));

  const cuerpoCadencia = (servicio.match(/export async function cambiarCadencia[\s\S]*?\n}/) || [''])[0];
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
     /gps\.limpiarSesion\(\)/.test(authErr) && /deleteItemAsync\(gps\.LLAVE_SESION\)/.test(authErr) && /gps\.parar\(\)/.test(authErr));
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

  // A5: la presencia se puede esperar
  ok('marcarPresencia devuelve una promesa y «fuera» reintenta por HTTP',
     /async function marcarPresencia/.test(cliente) && /estado === 'fuera' \? 3 : 1/.test(cliente));

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
  const splash = (config.expo.plugins || []).find(p => Array.isArray(p) && p[0] === 'expo-splash-screen');
  ok('la pantalla nativa de arranque es sólo el fondo, sin ícono',
     !!splash && !splash[1].image && splash[1].backgroundColor === '#0A1A2E', splash && splash[1]);
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
     /export async function notificarSinRol/.test(notif) && /MODO ACOMPAÑANTE/.test(notif) &&
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
  ok('y si no salió, la pantalla lo dice', /no pudo decir QUÉ pasó/.test(app));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
