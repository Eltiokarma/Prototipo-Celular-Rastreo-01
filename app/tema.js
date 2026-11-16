// Los colores, y cuándo cambian.
//
// (De día la app es clara desde el 16/11; ver DIA, abajo.)
//
// La app era oscura también de día, pero "oscura" no es "de noche". A las diez de la
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
// ─── DE DÍA, CLARA (auditoría de UI, A1, 16/11) ─────────────────────
// La app nativa era oscura también de día, con un azul noche. La web del
// chofer ya se había pasado a claro, con este argumento: el teléfono va en
// el parabrisas con sol directo a 3800 m, y una pantalla clara se lee mucho
// mejor que una oscura al mediodía. El repo tenía las dos respuestas a la
// misma pregunta; ahora tiene una. Son los valores del tema `day` de
// project/Prototipo.html, en los nombres de esta paleta (`blanco` es el
// texto principal, aunque de día sea azul marino). La brecha se lee en el
// verde, ámbar y rojo de estado; lo chico, en su tinta.
//
// Hay que probarla en la calle con distintos brillos de pantalla antes de
// darla por buena. Si se vuelve atrás, la oscura de antes es MAPA_DIA.
const DIA = {
  fondo: '#F7FAFD', panel: '#FFFFFF', linea: '#C3D4E4',
  marca: '#1668C4', brillante: '#1668C4', cielo: '#1668C4',
  tenue: '#496A86', blanco: '#0B2239',
  verde: '#1F8A4F', ambar: '#A67300', rojo: '#C2001D',
  verdeTexto: '#0B6B33', ambarTexto: '#6B4A00', rojoTexto: '#C2001D',
  ins: '#3D5C7A', secundario: '#3D5C7A',
  llenoVerde: '#0B6B33', llenoAmbar: '#6B4A00', llenoRojo: '#C2001D',
  sobreLleno: '#FFFFFF', sobreRojo: '#FFFFFF', sobreBrillante: '#FFFFFF',
  burbujaPropia: '#DCEBFB', burbujaSos: '#FFE1E7',
  borde: '#5A7591',
};

// El MAPA sigue oscuro de día (ver app/mapa.js: con un mapa claro de calles
// las combis había que buscarlas). Lleva los colores de la paleta oscura de
// antes, sólo los que el mapa usa.
const MAPA_DIA = {
  fondo: '#0A1A2E', panel: '#16304A', linea: '#234969',
  brillante: '#2E9DFF', tenue: '#8FA8C0', blanco: '#F5F9FF', ambar: '#F5C542',
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

// Los colores para el mapa, que es oscuro siempre
function paletaMapa(modo = 'auto', fecha = new Date()) {
  return esOscuro(modo, fecha) ? NOCHE : MAPA_DIA;
}

// El ciclo del botón. 'auto' primero porque es el que hay que preferir.
const MODOS = ['auto', 'dia', 'noche'];
function siguienteModo(modo) {
  const i = MODOS.indexOf(modo);
  return MODOS[(i < 0 ? 0 : i + 1) % MODOS.length];
}

const ETIQUETA = { auto: 'AUTO', dia: 'DÍA', noche: 'NOCHE' };

module.exports = {
  paleta, paletaMapa, esDeNoche, esOscuro, siguienteModo, MODOS, ETIQUETA, PALETAS, MAPA_DIA,
  _limites: { NOCHE_DESDE, NOCHE_HASTA },
};
