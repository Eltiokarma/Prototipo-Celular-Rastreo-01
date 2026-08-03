// Dónde termina la pantalla de verdad.
//
// El bug que lo trajo: el botón de CHAT quedaba debajo de los botones de
// Android y era casi imposible tocarlo. No era un margen mal puesto — era que
// la app no sabía que esos botones existen.
//
// `app.json` tiene `edgeToEdgeEnabled: true`, o sea que la app dibuja **por
// debajo** de la barra de estado y de la de navegación. Y desde Android 15 eso
// ya no es opcional: el sistema lo fuerza. Así que el espacio que ocupan hay
// que pedirlo y restarlo, y no se puede adivinar con un número fijo porque
// cambia por teléfono y hasta por cómo lo configuró el chofer:
//
//   navegación por botones     abajo ~48dp
//   navegación por gestos      abajo ~16-24dp
//   Android viejo (sin insets) abajo 0, pero el borde físico sigue estando
//   muesca / cámara en isla    arriba de 24 a 50+
//   en horizontal              la muesca se va a un costado
//
// Esto es JS puro justamente para poder probar esos casos sin tener los cinco
// teléfonos en la mano. `react-native-safe-area-context` da los números; acá
// se decide qué hacer con ellos.

// El aire que ya tenía el diseño, cuando no hay nada del sistema estorbando.
const BASE_LADOS = 22;
const BASE_ARRIBA = 18;
const BASE_ABAJO = 12;

// Un elemento QUE SE TOCA necesita más aire que un texto: el pulgar es ancho
// y el borde de la pantalla en un celular con funda no se alcanza igual.
// Estos 12dp son la diferencia entre "se toca" y "se toca al tercer intento".
const HOLGURA_TOCABLE = 12;

// Aunque el sistema diga 0 —Android viejo, o un emulador— el borde físico
// existe y un botón pegado al filo se toca mal. Nunca menos que esto.
const PISO_ABAJO = 16;

// La barra de estado nunca mide menos que esto, y hubo teléfonos que
// reportaron 0 estando en pantalla completa. El título no puede quedar
// tapado por el reloj.
const PISO_ARRIBA = 24;

// Un inset absurdo se ignora: hay fabricantes que reportan mal en horizontal
// o al plegar, y no vale la pena que un dato roto se coma media pantalla.
const TOPE = 80;

const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(v, TOPE) : 0);

// `insets` es lo que devuelve `useSafeAreaInsets()`.
//
// `conBarra` dice si esta pantalla termina en la barra de navegación de la
// app. Si termina, el aire de abajo lo pone la barra —no la pantalla— para
// que la línea divisoria llegue al borde y no quede flotando.
function margenes(insets, { conBarra = false } = {}) {
  const arriba = Math.max(num(insets?.top), PISO_ARRIBA);
  const abajo = num(insets?.bottom);

  return {
    paddingTop: arriba + BASE_ARRIBA,
    paddingBottom: conBarra ? 0 : Math.max(abajo, PISO_ABAJO) + BASE_ABAJO,
    paddingLeft: num(insets?.left) + BASE_LADOS,
    paddingRight: num(insets?.right) + BASE_LADOS,
  };
}

// El aire de abajo de la barra de navegación de la app: es lo único que
// separa un botón de los botones del sistema.
function margenBarra(insets) {
  return { paddingBottom: Math.max(num(insets?.bottom), PISO_ABAJO) + HOLGURA_TOCABLE };
}

module.exports = {
  margenes, margenBarra,
  _limites: { BASE_LADOS, BASE_ARRIBA, BASE_ABAJO, HOLGURA_TOCABLE, PISO_ABAJO, PISO_ARRIBA, TOPE },
};
