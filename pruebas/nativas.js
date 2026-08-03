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
  'expo-asset':        '~12.0.13',
  'expo-audio':        '~1.1.1',
  'expo-dev-client':   '~6.0.21',
  'expo-file-system':  '~19.0.23',
  'expo-image-manipulator': '~14.0.8',
  'expo-image-picker': '~17.0.11',
  'expo-location':     '~19.0.8',
  'expo-secure-store': '~15.0.8',
  'expo-status-bar':   '~3.0.9',
  'expo-task-manager': '~14.0.9',
  'babel-preset-expo': '~54.0.12',
  'react-native-safe-area-context': '~5.6.0',
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

console.log('\nLA API QUE SE USA');
{
  // En el SDK 54 `expo-file-system` cambió de API y dejó las funciones
  // viejas como stubs que TIPAN BIEN y revientan al ejecutarse. O sea que
  // no falla al compilar ni al abrir: falla la primera vez que un chofer
  // manda una nota de voz. Por eso se chequea acá y no en el teléfono.
  const fs = require('fs');
  const voz = fs.readFileSync(RAIZ + '/app/voz.js', 'utf8');
  ok('voz.js no usa la API vieja de expo-file-system',
     !/readAsStringAsync|writeAsStringAsync|getInfoAsync/.test(voz)
     || /expo-file-system\/legacy/.test(voz));
  ok('y saca el base64 con la API nueva', /new File\([^)]*\)\.base64\(\)/.test(voz));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
