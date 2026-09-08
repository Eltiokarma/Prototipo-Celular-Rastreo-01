// Los CSV de los informes (server/csv.js): que Excel no ejecute lo que
// escribió un chofer.
//
// Lo que se defiende: que un alias o un nombre que empiece con `=`, `+`, `-`
// o `@` llegue a la celda como texto y no como fórmula, sin romper lo de
// siempre (comillas, punto y coma, saltos de línea).
const RAIZ = require('path').join(__dirname, '..');
const { csvValor, csvLinea } = require(RAIZ + '/server/csv.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

console.log('\nLO DE SIEMPRE');
ok('un valor común sale tal cual', csvValor('Elmer Ccama') === 'Elmer Ccama');
ok('null y undefined son vacío', csvValor(null) === '' && csvValor(undefined) === '');
ok('un número sale como texto', csvValor(120) === '120');
ok('el separador obliga a comillas', csvValor('a;b') === '"a;b"');
ok('la comilla se dobla', csvValor('dijo "hola"') === '"dijo ""hola"""');
ok('el salto de línea obliga a comillas', csvValor('uno\ndos') === '"uno\ndos"');
ok('la línea une con punto y coma', csvLinea(['M-12', 'Elmer', 3]) === 'M-12;Elmer;3');

console.log('\nLAS FÓRMULAS NO SE EJECUTAN');
// El alias lo escribe el chofer desde la app; el nombre, Despacho. Los dos
// salen en los informes que el gerente abre en Excel.
for (const [caso, valor] of [
  ['=HYPERLINK', '=HYPERLINK("http://malo";"ver")'],
  ['=cmd', "=cmd|'/C calc'!A0"],
  ['+', '+1+1'],
  ['-', '-2+3'],
  ['@', '@SUM(A1)'],
]) {
  const v = csvValor(valor);
  ok(`${caso} sale como texto (apóstrofo adelante)`, v.startsWith("'") || v.startsWith("\"'"), v);
  ok(`  y no empieza por el carácter peligroso`, !/^[=+\-@]/.test(v.replace(/^"/, '')), v);
}
ok('un tabulador adelante también', csvValor('\t=1').startsWith("'"), csvValor('\t=1'));
ok('un retorno de carro adelante también', csvValor('\r=1').startsWith('"\''), csvValor('\r=1'));
ok('la fórmula con separador queda entre comillas Y con apóstrofo',
   csvValor('=1;2') === '"\'=1;2"', csvValor('=1;2'));
ok('un guion en el medio no cambia nada', csvValor('R-14') === 'R-14');
ok('un nombre con arroba en el medio tampoco', csvValor('juan@coop') === 'juan@coop');

console.log('\nLOS NÚMEROS SIGUEN SIENDO NÚMEROS');
// Las coordenadas de Juliaca son negativas. Con apóstrofo, la latitud sería
// texto y el gerente no podría ni promediarla ni ponerla en un mapa.
ok('una latitud negativa (número) sale tal cual', csvValor(-15.49) === '-15.49', csvValor(-15.49));
ok('y una longitud como texto también', csvValor('-70.12') === '-70.12', csvValor('-70.12'));
ok('un entero negativo como texto también', csvValor('-5') === '-5', csvValor('-5'));
ok('con coma decimal también', csvValor('-3,5') === '-3,5', csvValor('-3,5'));
ok('pero "-2+3" sí es fórmula', csvValor('-2+3') === "'-2+3", csvValor('-2+3'));
ok('y "-5 min" no es un número, pero tampoco ejecuta nada: queda con apóstrofo, y se acepta',
   csvValor('-5 min') === "'-5 min", csvValor('-5 min'));

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
