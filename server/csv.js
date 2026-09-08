// Los CSV que bajan Despacho y el gerente, y que se abren en Excel.
//
// Dos defensas, y la segunda es la que importa:
//
//   1. Lo de siempre: comillas, punto y coma (el separador) y saltos de
//      línea van entre comillas, con la comilla doblada.
//   2. FÓRMULAS. Excel y LibreOffice evalúan cualquier celda que empiece con
//      `=`, `+`, `-` o `@` (y con tabulador o retorno de carro delante). El
//      alias lo escribe el propio chofer desde su app, y el nombre lo escribe
//      Despacho; un alias `=HYPERLINK("http://…";"ver")` o `=cmd|'/C calc'!A0`
//      se ejecutaba al abrir el informe de horas. Se antepone un apóstrofo,
//      que Excel entiende como "esto es texto".
//
//      Los NÚMEROS no se tocan: las coordenadas de Juliaca son negativas
//      (-15.49, -70.12) y un `'-15.49` en la columna de latitud es una
//      celda de texto que ya no se puede promediar ni ubicar. Un número
//      —el tipo `number`, o un texto que es sólo un número— no es una
//      fórmula: `-5` da -5 y nada más.
//
// Puro y con suite (`pruebas/csv.js`): es la clase de cosa que se rompe al
// "simplificar" y nadie nota hasta que alguien abre un informe.

'use strict';

const EMPIEZA_FORMULA = /^[=+\-@\t\r]/;
const ES_NUMERO = /^[+-]?\d+([.,]\d+)?$/;

function csvValor(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v !== 'number' && EMPIEZA_FORMULA.test(s) && !ES_NUMERO.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvLinea(campos) {
  return campos.map(csvValor).join(';');
}

module.exports = { csvValor, csvLinea };
