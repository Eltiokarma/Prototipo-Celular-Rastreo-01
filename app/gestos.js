// Pasar de pantalla deslizando el dedo.
//
// La barra de abajo sigue estando: esto es el atajo, no el único camino. Un
// chofer maneja, y llegar a un botón chico pide mirar la pantalla; un
// deslizamiento no.
//
// Lo delicado no es el gesto, es CON QUIÉN COMPITE. En esta app hay dos cosas
// más que escuchan el dedo, y las dos importan más que navegar:
//
//   1. EL SOS. Se dispara deslizando, y es horizontal, igual que esto. Si la
//      pantalla le roba el gesto al SOS, el chofer cree que pidió ayuda y no
//      la pidió. Por eso el SOS gana siempre: es hijo del contenedor —en
//      React Native el hijo reclama primero— y además no suelta el gesto una
//      vez que lo tomó.
//   2. EL SCROLL DEL CHAT. Es vertical. Un dedo nunca se mueve recto, así que
//      "horizontal" no puede ser "dx distinto de cero": tiene que ser
//      claramente más horizontal que vertical, o leer los mensajes viejos se
//      vuelve una ruleta.
//
// JS puro y probado por eso mismo: los tres casos de arriba son fáciles de
// escribir y muy difíciles de verificar con el teléfono en la mano.

// El orden manda: 'ruta' está a la izquierda de 'chat'. Deslizar a la
// izquierda avanza, como pasar la hoja de un cuaderno.
const PANTALLAS = ['ruta', 'chat'];

// Menos que esto es un toque, o el temblor de una combi en pista de tierra.
// A 3800 m y en la ruta a Juliaca eso no es una hipótesis.
const UMBRAL = 48;

// Y tiene que ser MÁS DEL DOBLE de horizontal que vertical. Con 1:1 el scroll
// del chat se convertía en un cambio de pantalla cada dos por tres.
const PROPORCION = 2;

function esHorizontal(gesto) {
  const dx = Math.abs(gesto?.dx || 0);
  const dy = Math.abs(gesto?.dy || 0);
  return dx >= UMBRAL && dx > dy * PROPORCION;
}

// A qué pantalla va, o null si el gesto no alcanza o no hay a dónde ir.
//
// NO da la vuelta a propósito: desde 'ruta' deslizar a la derecha no lleva a
// 'chat'. Con dos pantallas, envolver significa que el mismo gesto en un
// sentido y en el otro terminan en el mismo lado, y eso se siente roto. Que
// se frene en el borde es la señal de que no hay nada más allá.
function deslizar(actual, gesto) {
  if (!esHorizontal(gesto)) return null;
  const i = PANTALLAS.indexOf(actual);
  if (i < 0) return null;
  const destino = i + (gesto.dx < 0 ? 1 : -1);
  if (destino < 0 || destino >= PANTALLAS.length) return null;
  return PANTALLAS[destino];
}

module.exports = { PANTALLAS, esHorizontal, deslizar, _limites: { UMBRAL, PROPORCION } };
