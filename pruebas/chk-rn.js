// Sintaxis de los archivos de la app nativa.
//
// `node -c` no sirve: usan JSX e `import`, que Node no parsea. Y las suites
// de `app/` solo cargan los módulos puros (`hud`, `cola`, `cliente`), así que
// un error de tipeo en `App.js` o en el servicio de GPS no aparecería hasta
// tener el teléfono en la mano. Esto lo adelanta con el mismo Babel que ya
// usan los paneles web.
const path = require('path');
const fs = require('fs');
const babel = require(path.join(__dirname, 'node_modules/@babel/standalone'));

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'app/App.js',
  'app/index.js',
  'app/hud.js',
  'app/chat.js',
  'app/cola.js',
  'app/tema.js',
  'app/margenes.js',
  'app/gestos.js',
  'app/imagen.js',
  'app/mapa.js',
  'app/teclado.js',
  'app/babel.config.js',
  'app/voz.js',
  'app/foto.js',
  'app/notificacion.js',
  'app/grabador.js',
  'app/gps/servicio.js',
  'app/protocolo/cliente.js',
];

let malos = 0;
for (const rel of ARCHIVOS) {
  const abs = path.isAbsolute(rel) ? rel : path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) { malos++; console.log('FALTA ' + rel); continue; }
  try {
    babel.transform(fs.readFileSync(abs, 'utf8'), {
      presets: ['react'], filename: abs, sourceType: 'unambiguous',
    });
    console.log('OK    ' + rel);
  } catch (e) {
    malos++;
    console.log('ERROR ' + rel + '\n      ' + e.message.split('\n')[0]);
  }
}
process.exit(malos ? 1 : 0);
