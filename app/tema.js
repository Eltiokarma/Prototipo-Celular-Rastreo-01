// Los colores, y cuándo cambian.
//
// La app ya era oscura, pero "oscura" no es "de noche". A las diez de la
// noche, en la cabina de una combi, una pantalla azul brillante a 30 cm de la
// cara hace dos cosas malas: encandila, y arruina la visión nocturna del
// chofer durante varios segundos después de mirarla. Eso último es lo caro —
// es tiempo manejando con los ojos todavía adaptándose.
//
// Por eso el modo noche no es "el mismo diseño más oscuro". Es:
//
//   - menos luminancia en todo, sobre todo en los fondos;
//   - MENOS AZUL. El azul es lo que más dilata la pupila y lo que más tarda
//     en soltar la vista. Es la misma razón por la que los tableros de los
//     autos son ámbar o rojos y no celestes;
//   - los estados —verde, ámbar, rojo— se conservan reconocibles, porque son
//     información y no decoración. Se bajan, no se cambian de tono.
//
// Es JS puro para poder probar la regla horaria y que los colores existan
// todos en los dos modos: una clave que falte en una paleta es una pantalla
// con un hueco negro, y eso se ve recién en el teléfono y de noche.

'use strict';

// Juliaca está a 15° de latitud sur. Tan cerca del ecuador el día casi no
// cambia con la estación: amanece entre 5:20 y 6:00 y anochece entre 18:00 y
// 18:40 TODO EL AÑO. Por eso alcanza con una regla horaria y no hace falta
// calcular la posición del sol ni pedir otra librería.
const NOCHE_DESDE = 18.5;   // 18:30
const NOCHE_HASTA = 5.5;    // 05:30

function esDeNoche(fecha = new Date()) {
  const d = fecha instanceof Date && !isNaN(fecha) ? fecha : new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= NOCHE_DESDE || h < NOCHE_HASTA;
}

// Los papeles, además de los colores base (auditoría de UI, A2 y A3):
//   tenue           texto secundario. Era #5A7A99: 3,0:1 sobre los paneles.
//   verdeTexto…     verde, ámbar y rojo escritos como TEXTO chico.
//   ins, secundario la instrucción bajo la brecha y el rótulo del otro lado.
//   llenoVerde…     verde, ámbar y rojo como FONDO lleno de un botón o aviso,
//   sobreLleno      con lo que va escrito encima (sobreRojo, aparte: de noche
//   sobreRojo       el blanco es lo único que se lee sobre el rojo apagado).
//   sobreBrillante  lo escrito sobre el botón principal. Era blanco: 2,84:1
//                   de día y 2,42 de noche.
//   burbujaPropia,  las burbujas del chat que estaban escritas a mano y no
//   burbujaSos      cambiaban de noche (la propia seguía azul brillante).
//   borde           el contorno de un control: 3:1 contra el fondo. `linea`
//                   queda para divisores, que no tienen que distinguirse.
// Todos los pares los mide pruebas/contraste.js.
const DIA = {
  fondo: '#0A1A2E', panel: '#16304A', linea: '#234969',
  marca: '#2580CF', brillante: '#2E9DFF', cielo: '#71BCFF',
  tenue: '#8FA8C0', blanco: '#F5F9FF',
  verde: '#3DD685', ambar: '#F5C542', rojo: '#FF4D6D',
  verdeTexto: '#3DD685', ambarTexto: '#F5C542', rojoTexto: '#FF7A90',
  ins: '#93AAC2', secundario: '#A9C0D6',
  llenoVerde: '#3DD685', llenoAmbar: '#F5C542', llenoRojo: '#FF4D6D',
  sobreLleno: '#0A1A2E', sobreRojo: '#0A1A2E', sobreBrillante: '#0A1A2E',
  burbujaPropia: '#1D598F', burbujaSos: '#4A0D1B',
  borde: '#6F8FAE',
};

// Casi negro, y lo poco que brilla tira a ámbar. El texto principal no es
// blanco: un blanco puro sobre negro es el peor contraste posible de noche
// —deslumbra en el borde de cada letra—, así que va un gris cálido.
const NOCHE = {
  fondo: '#05080C', panel: '#0E141B', linea: '#1C2731',
  marca: '#8A6A2E', brillante: '#D89B3C', cielo: '#B98A45',
  tenue: '#968776', blanco: '#D8CFC2',
  verde: '#4E8F62', ambar: '#B98A2E', rojo: '#B34A54',
  verdeTexto: '#5FA373', ambarTexto: '#B98A2E', rojoTexto: '#D9737C',
  ins: '#B3A797', secundario: '#C2B6A6',
  llenoVerde: '#4E8F62', llenoAmbar: '#B98A2E', llenoRojo: '#B34A54',
  sobreLleno: '#05080C', sobreRojo: '#FFFFFF', sobreBrillante: '#05080C',
  burbujaPropia: '#2A2418', burbujaSos: '#3A1418',
  borde: '#6E6152',
};

const PALETAS = { dia: DIA, noche: NOCHE };

// `modo` puede ser 'dia', 'noche' o 'auto'. El automático es el que va por
// defecto: el chofer no debería tener que acordarse de cambiarlo justo
// cuando se está haciendo de noche y tiene las dos manos ocupadas. Pero el
// manual existe porque un túnel, un día de tormenta o un parabrisas polarizado
// no los sabe el reloj.
function paleta(modo = 'auto', fecha = new Date()) {
  if (modo === 'dia' || modo === 'noche') return PALETAS[modo];
  return esDeNoche(fecha) ? NOCHE : DIA;
}

function esOscuro(modo = 'auto', fecha = new Date()) {
  return paleta(modo, fecha) === NOCHE;
}

// El ciclo del botón. 'auto' primero porque es el que hay que preferir.
const MODOS = ['auto', 'dia', 'noche'];
function siguienteModo(modo) {
  const i = MODOS.indexOf(modo);
  return MODOS[(i < 0 ? 0 : i + 1) % MODOS.length];
}

const ETIQUETA = { auto: 'AUTO', dia: 'DÍA', noche: 'NOCHE' };

module.exports = {
  paleta, esDeNoche, esOscuro, siguienteModo, MODOS, ETIQUETA, PALETAS,
  _limites: { NOCHE_DESDE, NOCHE_HASTA },
};
