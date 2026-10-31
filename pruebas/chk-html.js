// Compila el <script type="text/babel"> de un .html con el mismo Babel que
// usa el navegador. Es la única forma de enterarse de un error de sintaxis
// sin abrir la página: el panel no tiene paso de compilación.
const Babel = require('@babel/standalone');
const fs = require('fs');
const zonaMuerta = require('./zona-muerta');
for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0, malo = false;
  while ((m = re.exec(html))) {
    n++;
    // Línea real dentro del .html, para que el número del error sirva
    const linea = html.slice(0, m.index).split('\n').length;
    try {
      const usos = [];
      Babel.transform(m[1], { presets: ['react'], filename: f, plugins: [zonaMuerta(usos, m[1])] });
      if (usos.length) {
        console.log(`FAIL ${f} (bloque ${n}, empieza en la línea ${linea}): usada antes de declararse\n    ${usos.join('\n    ')}`);
        malo = true;
      }
    } catch (e) {
      const cabeza = e.message.split('\n').slice(0, 4).join('\n    ');
      console.log(`FAIL ${f} (bloque ${n}, empieza en la línea ${linea})\n    ${cabeza}`);
      malo = true;
    }
  }
  if (!n) { console.log('SIN BLOQUE text/babel', f); malo = true; }
  if (!malo) console.log('OK  ', f, `(${n} bloque${n === 1 ? '' : 's'})`);
  if (malo) process.exitCode = 1;
}
