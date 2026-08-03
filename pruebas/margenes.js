// Los márgenes contra la barra del sistema (`app/margenes.js`).
//
// Existe por un bug medido en un teléfono de verdad: el botón de CHAT quedaba
// **debajo de los botones de Android** y había que insistir para entrar. La
// app dibuja edge-to-edge —desde Android 15 el sistema lo obliga—, así que el
// espacio de las barras hay que restarlo, y no hay un número que sirva para
// todos: cambia por teléfono y por cómo lo configuró cada chofer.
//
// El parque de teléfonos de una cooperativa no se elige. Acá están los casos
// que se va a encontrar, cada uno con los insets que reporta Android.
const RAIZ = require('path').join(__dirname, '..');
const { margenes, margenBarra, _limites } = require(RAIZ + '/app/margenes.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Lo que reporta cada configuración real.
const BOTONES  = { top: 24, bottom: 48, left: 0, right: 0 };  // navegación clásica
const GESTOS   = { top: 24, bottom: 24, left: 0, right: 0 };  // la barrita
const MUESCA   = { top: 50, bottom: 24, left: 0, right: 0 };  // cámara en isla
const HORIZONTAL = { top: 24, bottom: 16, left: 44, right: 0 }; // muesca de costado
const VIEJO    = { top: 0,  bottom: 0,  left: 0, right: 0 };  // Android sin insets

console.log('\nEL BUG QUE LO TRAJO: EL BOTÓN DEBAJO DE LOS BOTONES');
{
  // La regla, y es la única que importa de verdad: entre un elemento que se
  // TOCA y el área del sistema tiene que quedar aire. Si esto pasa, el botón
  // de CHAT vuelve a ser inalcanzable en cualquier teléfono con botones.
  for (const [nombre, insets] of [['botones', BOTONES], ['gestos', GESTOS], ['viejo', VIEJO]]) {
    const b = margenBarra(insets);
    ok(`con ${nombre}, la barra deja aire sobre el sistema`,
       b.paddingBottom >= insets.bottom + _limites.HOLGURA_TOCABLE, b);
  }

  // Y el caso concreto que se midió: 48dp de botones.
  ok('con botones de 48dp el tab NO queda pegado a ellos',
     margenBarra(BOTONES).paddingBottom >= 60, margenBarra(BOTONES));
}

console.log('\nCUANDO EL SISTEMA NO DICE NADA');
{
  // Android viejo reporta 0, pero el borde físico del vidrio existe igual, y
  // un botón contra el filo se toca mal — sobre todo con funda.
  const b = margenBarra(VIEJO);
  ok('sin insets igual queda un piso abajo', b.paddingBottom >= _limites.PISO_ABAJO, b);

  const m = margenes(VIEJO);
  ok('y arriba el título no queda bajo el reloj',
     m.paddingTop >= _limites.PISO_ARRIBA, m.paddingTop);
}

console.log('\nLA MUESCA');
{
  const m = margenes(MUESCA);
  ok('una muesca alta empuja el contenido hacia abajo',
     m.paddingTop > margenes(GESTOS).paddingTop, [m.paddingTop, margenes(GESTOS).paddingTop]);

  // En horizontal la muesca se va a un costado. Si no se mira `left`, el
  // texto queda partido por el recorte de la cámara.
  const h = margenes(HORIZONTAL);
  ok('en horizontal el costado de la muesca se respeta',
     h.paddingLeft >= HORIZONTAL.left, h.paddingLeft);
  ok('y el otro costado no se infla al pedo',
     h.paddingRight === _limites.BASE_LADOS, h.paddingRight);
}

console.log('\nDATOS ROTOS');
{
  // Pasó con fabricantes reportando mal al plegar o al girar: un inset
  // absurdo no puede comerse la pantalla del chofer.
  const absurdo = margenes({ top: 5000, bottom: 5000, left: 5000, right: 5000 });
  ok('un inset absurdo se recorta',
     absurdo.paddingTop <= _limites.TOPE + _limites.BASE_ARRIBA, absurdo.paddingTop);

  // Y los datos que no son números tampoco: undefined, null, NaN, negativos.
  for (const malo of [undefined, null, {}, { top: NaN, bottom: -30 }, { top: 'alto' }]) {
    const m = margenes(malo);
    const sano = Object.values(m).every(v => typeof v === 'number' && isFinite(v) && v >= 0);
    ok('no revienta con ' + JSON.stringify(malo), sano, m);
  }
}

console.log('\nLA PANTALLA QUE TERMINA EN LA BARRA');
{
  // Si la pantalla termina en la barra de navegación de la app, el aire de
  // abajo lo pone la barra. Sumar los dos deja la línea divisoria flotando a
  // media pantalla, que fue justo como se veía.
  const conBarra = margenes(BOTONES, { conBarra: true });
  ok('no pone su propio aire abajo', conBarra.paddingBottom === 0, conBarra.paddingBottom);

  const sinBarra = margenes(BOTONES);
  ok('pero sola sí lo pone', sinBarra.paddingBottom > 0, sinBarra.paddingBottom);

  // Y entre las dos tiene que quedar cubierto el sistema, sin importar cuál
  // se use: es la garantía de que ninguna pantalla queda por debajo.
  ok('las dos formas cubren la barra del sistema',
     Math.max(sinBarra.paddingBottom, margenBarra(BOTONES).paddingBottom) > BOTONES.bottom);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
