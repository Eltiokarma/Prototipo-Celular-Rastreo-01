// Mete Leaflet adentro del bundle de la app nativa.
//
// El WebView del mapa (`app/mapa.js`) bajaba Leaflet de unpkg. Eso significa
// que **la primera vez que se abre el mapa hace falta internet**, y la primera
// vez suele ser en la calle, con el celular recién instalado y la señal que
// hay en Juliaca. Sin esos dos archivos el mapa queda en blanco y no dice por
// qué: `L` no existe y el script de adentro se corta en la primera línea.
//
// Un WebView de React Native no puede leer archivos del repo en tiempo de
// ejecución —lo que existe es lo que Metro empaquetó—, así que Leaflet tiene
// que viajar como JavaScript. Esto lo convierte: lee los mismos archivos que
// ya sirve el panel del creador (`server/vendor/leaflet/`, la copia única) y
// escribe `app/vendor/leaflet.js` con las dos fuentes como cadenas.
//
// Se corre a mano y SOLO al subir la versión de Leaflet:
//
//     node herramientas/vendor-leaflet.js
//
// El archivo generado se commitea. La suite `mapa` verifica que siga
// coincidiendo con `server/vendor/leaflet/`, así que si alguien actualiza la
// copia del servidor y se olvida de correr esto, la regresión se pone roja en
// vez de dejar la app con una versión vieja adentro.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ORIGEN = path.join(RAIZ, 'server', 'vendor', 'leaflet');
const DESTINO = path.join(RAIZ, 'app', 'vendor', 'leaflet.js');
const VERSION = '1.9.4';

// La huella deja el vínculo escrito: la suite compara este número contra los
// archivos de `server/vendor/leaflet/` y no contra su propia idea de Leaflet.
function huella(js, css) {
  return crypto.createHash('sha256').update(js).update(css).digest('hex').slice(0, 16);
}

function generar() {
  const js = fs.readFileSync(path.join(ORIGEN, 'leaflet.js'), 'utf8');
  const css = fs.readFileSync(path.join(ORIGEN, 'leaflet.css'), 'utf8');

  const cuerpo = `// GENERADO por herramientas/vendor-leaflet.js — no editar a mano.
//
// Leaflet ${VERSION} como texto, para que el WebView del mapa lo tenga adentro
// del APK y no dependa de que unpkg conteste. La copia de la que sale es
// server/vendor/leaflet/, la misma que sirve el panel del creador: hay una
// sola versión de Leaflet en el repositorio, no dos que se van separando.
//
// Para regenerarlo después de subir la versión:  node herramientas/vendor-leaflet.js
'use strict';

module.exports = {
  version: ${JSON.stringify(VERSION)},
  huella: ${JSON.stringify(huella(js, css))},
  css: ${JSON.stringify(css)},
  js: ${JSON.stringify(js)},
};
`;

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, cuerpo);
  const kb = n => Math.round(n / 1024) + ' kB';
  console.log(`Leaflet ${VERSION} incrustado en app/vendor/leaflet.js`);
  console.log(`  js  ${kb(js.length)}   css ${kb(css.length)}   archivo ${kb(cuerpo.length)}`);
  console.log(`  huella ${huella(js, css)}`);
}

module.exports = { huella, ORIGEN, DESTINO, VERSION };

if (require.main === module) generar();
