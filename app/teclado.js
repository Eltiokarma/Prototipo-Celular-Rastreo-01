// Cuánto hay que levantar la pantalla cuando sale el teclado.
//
// EL PROBLEMA. En Android, `KeyboardAvoidingView` con `behavior` sin definir
// —que es lo que había— no hace absolutamente nada: la parte de Android la
// resolvía el sistema con `adjustResize`, achicando la ventana de la app.
//
// Pero esta app dibuja **edge-to-edge** (`app.json`), y con eso la ventana ya
// no se achica: ocupa toda la pantalla siempre, teclado incluido. Así que el
// campo de escribir quedaba DEBAJO del teclado y el chofer tipeaba a ciegas.
// Es el mismo tema que dejó el botón de CHAT bajo los botones del sistema:
// edge-to-edge apaga los arreglos automáticos y hay que hacer las cuentas.
//
// LA CUENTA, que es lo único que vive acá. Android informa la altura del
// teclado **desde el borde de abajo del vidrio**, así que ya incluye la franja
// de la barra de navegación. Y esa franja YA la está pagando la pantalla, por
// `margenes.js`. Sumar las dos deja un hueco del alto de la barra entre el
// campo y el teclado — que en un teléfono con botones son 48 px de aire raro.
//
// JS puro y con prueba porque es exactamente el tipo de cuenta que se ve mal
// en un teléfono, se corrige a ojo, y queda mal en el otro.

'use strict';

// Cuánto levantar el contenido.
//
// `altoTeclado` es lo que informa el evento; `insetAbajo` es lo que la
// pantalla ya reservó para la barra de navegación.
function alturaUtil(altoTeclado, insetAbajo = 0) {
  const t = Number(altoTeclado);
  const i = Number(insetAbajo);
  if (!isFinite(t) || t <= 0) return 0;          // sin teclado, sin corrección
  const base = isFinite(i) && i > 0 ? i : 0;
  // Nunca negativo: hay teléfonos donde el teclado informa menos que el inset
  // (teclado flotante, teclado dividido en tablets).
  return Math.max(0, Math.round(t - base));
}

// Un teclado ridículamente alto es un dato roto, no un teclado. Si se aplicara
// tal cual, el chat entero se iría de la pantalla y parecería que la app se
// colgó. Se acota a la mitad de la altura de la ventana, que es más de lo que
// ocupa cualquier teclado real.
function acotar(altura, altoVentana) {
  const a = Number(altura), v = Number(altoVentana);
  if (!isFinite(a) || a <= 0) return 0;
  if (!isFinite(v) || v <= 0) return Math.round(a);
  return Math.min(Math.round(a), Math.round(v / 2));
}

// Todo junto, que es lo que usa la pantalla.
function levantar(altoTeclado, { insetAbajo = 0, altoVentana = 0 } = {}) {
  return acotar(alturaUtil(altoTeclado, insetAbajo), altoVentana);
}

module.exports = { alturaUtil, acotar, levantar };
