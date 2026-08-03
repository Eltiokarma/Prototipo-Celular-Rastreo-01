// Pasar de pantalla deslizando (`app/gestos.js`).
//
// Lo que defiende no es que el gesto funcione: es que NO se dispare cuando el
// dedo estaba haciendo otra cosa. En esta app hay dos gestos que valen más
// que navegar, y los dos se pisan con éste:
//
//   el SOS       también se desliza, también es horizontal, y un falso SOS
//                moviliza gente y quema la confianza en el sistema entero
//   el chat      se scrollea vertical, y un dedo nunca baja recto
//
// Un chofer no va a reportar "el swipe tiene mal el umbral": va a decir que
// la app hace cosas raras. Acá se fija el número.
const RAIZ = require('path').join(__dirname, '..');
const { deslizar, esHorizontal, PANTALLAS, _limites } = require(RAIZ + '/app/gestos.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

console.log('\nIR Y VOLVER');
{
  ok('desde la ruta, deslizando a la izquierda se abre el chat',
     deslizar('ruta', { dx: -120, dy: 5 }) === 'chat', deslizar('ruta', { dx: -120, dy: 5 }));
  ok('y desde el chat, a la derecha se vuelve a la ruta',
     deslizar('chat', { dx: 120, dy: 5 }) === 'ruta', deslizar('chat', { dx: 120, dy: 5 }));
}

console.log('\nLOS BORDES NO DAN LA VUELTA');
{
  // Con dos pantallas, envolver hace que el mismo gesto en los dos sentidos
  // termine en el mismo lado. Frenar en el borde es lo que le dice al dedo
  // que no hay nada más allá.
  ok('en la ruta, a la derecha no pasa nada', deslizar('ruta', { dx: 150, dy: 0 }) === null);
  ok('en el chat, a la izquierda tampoco', deslizar('chat', { dx: -150, dy: 0 }) === null);
  ok('una pantalla que no existe no navega', deslizar('mapa', { dx: -150, dy: 0 }) === null);
}

console.log('\nEL SCROLL DEL CHAT NO SE ROBA');
{
  // Leer los mensajes viejos es un arrastre vertical largo. Si eso cambia de
  // pantalla, el chat es inusable.
  ok('un scroll vertical no navega', deslizar('ruta', { dx: 10, dy: -300 }) === null);
  ok('ni uno vertical con algo de deriva', deslizar('ruta', { dx: -60, dy: -200 }) === null,
     deslizar('ruta', { dx: -60, dy: -200 }));
  // 45 grados es ambiguo: ante la duda, gana quien ya estaba scrolleando.
  ok('a 45 grados gana el scroll', deslizar('ruta', { dx: -100, dy: -100 }) === null);
}

console.log('\nLA COMBI SE MUEVE');
{
  // El celular va en un soporte, en pista de tierra y a 3800 m. Un toque con
  // temblor no puede cambiar de pantalla.
  ok('un toque no navega', deslizar('ruta', { dx: 0, dy: 0 }) === null);
  ok('un temblor chico tampoco', deslizar('ruta', { dx: -18, dy: 4 }) === null);
  ok('pero un deslizamiento decidido sí',
     deslizar('ruta', { dx: -(_limites.UMBRAL + 1), dy: 2 }) === 'chat');
  ok('y justo en el umbral también',
     deslizar('ruta', { dx: -_limites.UMBRAL, dy: 0 }) === 'chat');
}

console.log('\nQUÉ GESTO SE RECLAMA');
{
  // `esHorizontal` es lo que decide si el contenedor le pide el dedo al
  // sistema. Cuanto menos reclame, menos posibilidad de pisar al SOS.
  ok('no reclama un gesto vertical', esHorizontal({ dx: 5, dy: 200 }) === false);
  ok('no reclama un gesto corto', esHorizontal({ dx: 20, dy: 0 }) === false);
  ok('sí reclama uno horizontal y largo', esHorizontal({ dx: -200, dy: 10 }) === true);
  ok('sin datos no reclama nada', esHorizontal(undefined) === false && esHorizontal({}) === false);
}

console.log('\nBORDES');
{
  ok('las pantallas están en orden', PANTALLAS.join(',') === 'ruta,chat', PANTALLAS);
  for (const malo of [undefined, null, {}, { dx: NaN, dy: NaN }]) {
    ok('no revienta con ' + JSON.stringify(malo), deslizar('ruta', malo) === null);
  }
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
