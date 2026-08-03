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

// El orden manda. Deslizar a la izquierda avanza, como pasar la hoja de un
// cuaderno.
//
// RUTA va EN EL MEDIO a propósito: es la pantalla de trabajo, la que está
// abierta el 95 % del turno, y desde ahí las otras dos quedan a un solo
// deslizamiento cada una. Con ruta en una punta, el chat quedaba a dos.
const PANTALLAS = ['mapa', 'ruta', 'chat'];
const INICIAL = 'ruta';

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

// ── Que el deslizamiento se sienta, y no dé un salto ──────────
//
// La primera versión cambiaba de pantalla de golpe al soltar el dedo: se
// sentía tosco porque no había nada que seguir al dedo. Un deslizamiento se
// siente bien cuando la pantalla se mueve CON el dedo mientras dura, y se
// termina de acomodar sola al soltar. Estas dos funciones son esa cuenta.

// Cuánto resiste el borde. Al principio o al final no hay a dónde ir, pero
// frenar en seco se siente roto —parece que la app se colgó—. Se deja mover
// un tercio: alcanza para que el dedo entienda que ahí se termina.
const RESISTENCIA = 3;

// Un dedo rápido cuenta aunque recorra poco: en una combi que se mueve, el
// gesto largo y prolijo no existe. Es px/ms.
const VELOCIDAD_MINIMA = 0.35;

// Cuánto se corrió el carrusel, en píxeles, mientras el dedo está apoyado.
function desplazamiento(indice, dx, ancho) {
  const i = Number(indice) || 0;
  const a = Number(ancho) || 0;
  const d = Number(dx) || 0;
  const base = -i * a;
  const enElBorde = (i === 0 && d > 0) || (i === PANTALLAS.length - 1 && d < 0);
  return base + (enElBorde ? d / RESISTENCIA : d);
}

// A qué pantalla se acomoda al soltar.
//
// Se mira la distancia O la velocidad, no las dos juntas: pedir las dos deja
// afuera el gesto lento pero largo (dedo apoyado, sin apuro) y el rápido pero
// corto (un flick), que son los dos que la gente hace de verdad.
// `gesto` se lee con `?.` y NO se desestructura con valores por defecto: el
// valor por defecto de una desestructuración solo tapa `undefined`, no `null`.
// Con `null` reventaba, y `null` es exactamente lo que llega cuando un gesto
// se cancela — que en un teléfono en un soporte, en una combi, pasa seguido.
function indiceDestino(indice, gesto, ancho = 0) {
  const i = Number(indice) || 0;
  const a = Number(ancho) || 0;
  const d = Number(gesto?.dx) || 0;
  const v = Number(gesto?.vx) || 0;

  // Medio ancho de pantalla, o un envión claro.
  const suficiente = (a > 0 && Math.abs(d) > a / 2) || Math.abs(v) > VELOCIDAD_MINIMA;
  if (!suficiente) return i;                 // vuelve a donde estaba

  // El sentido lo manda la velocidad si la hubo: un flick hacia atrás con el
  // dedo ya pasado de la mitad tiene que volver, no seguir.
  const haciaAdelante = Math.abs(v) > VELOCIDAD_MINIMA ? v < 0 : d < 0;
  const destino = i + (haciaAdelante ? 1 : -1);
  return Math.max(0, Math.min(PANTALLAS.length - 1, destino));
}

module.exports = {
  PANTALLAS, INICIAL, esHorizontal, desplazamiento, indiceDestino,
  _limites: { UMBRAL, PROPORCION, RESISTENCIA, VELOCIDAD_MINIMA },
};
