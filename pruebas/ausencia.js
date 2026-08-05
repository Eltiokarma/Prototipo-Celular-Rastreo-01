// El vigía de la ausencia (app/ausencia.js): los dos olvidos humanos.
//
// Lo que se defiende: que el que arranca después de almorzar VUELVA a ruta
// solo, que el que se fue a su casa ausente no emita toda la noche, y que
// un salto de GPS de alguien sentado comiendo NO lo devuelva a ruta.
const RAIZ = require('path').join(__dirname, '..');
const { crearVigia, RADIO_VOLVER_M, TOPE_AUSENTE_MS, SEGUIDAS } = require(RAIZ + '/app/ausencia.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un restaurante en Juliaca y el reloj en la mano
const R = { lat: -15.4930, lng: -70.1330 };
const T0 = 1_000_000_000;
const min = (n) => n * 60_000;

console.log('\nALMORZAR NO ES MOVERSE');
{
  const v = crearVigia();
  ok('la primera posición ancla y no dice nada', v.posicion(R.lat, R.lng, T0) === null);
  // Media hora de zigzag de GPS parado: ±30 m alrededor del restaurante
  let accion = null;
  for (let i = 1; i <= 10; i++) {
    accion = v.posicion(R.lat + (i % 2 ? 0.00025 : -0.00025), R.lng, T0 + min(3 * i));
  }
  ok('media hora quieto, con zigzag de GPS, no dispara nada', accion === null, accion);
  ok('y la pantalla sabe hace cuánto', v.haceCuanto(T0 + min(30)) === min(30));
}

console.log('\nARRANCÓ DE NUEVO: VUELVE SOLO');
{
  const v = crearVigia();
  v.posicion(R.lat, R.lng, T0);
  // Se aleja: 400 m y después 700 m — dos seguidas fuera del radio
  const a1 = v.posicion(R.lat + 0.0036, R.lng, T0 + min(31));
  const a2 = v.posicion(R.lat + 0.0063, R.lng, T0 + min(31.2));
  ok('una sola posición lejos todavía no alcanza', a1 === null, a1);
  ok(`la ${SEGUIDAS}ª seguida lejos = está manejando: VOLVER`, a2 === 'volver', a2);
}

console.log('\nUN SALTO DE GPS NO ES ARRANCAR');
{
  const v = crearVigia();
  v.posicion(R.lat, R.lng, T0);
  // Rebote de edificio: una posición a 500 m… y la siguiente de vuelta al plato
  const salto = v.posicion(R.lat + 0.0045, R.lng, T0 + min(10));
  const devuelta = v.posicion(R.lat, R.lng, T0 + min(10.2));
  const otraVez = v.posicion(R.lat + 0.0045, R.lng, T0 + min(20));
  ok('el salto solo no dispara', salto === null && devuelta === null, [salto, devuelta]);
  ok('y el contador se reinició: el segundo salto suelto tampoco', otraVez === null, otraVez);
}

console.log('\nDOS HORAS YA NO ES UN ALMUERZO');
{
  const v = crearVigia();
  v.posicion(R.lat, R.lng, T0);
  const casi = v.posicion(R.lat, R.lng, T0 + TOPE_AUSENTE_MS - min(1));
  const pasado = v.posicion(R.lat, R.lng, T0 + TOPE_AUSENTE_MS + min(1));
  ok('a los 119 minutos sigue siendo un almuerzo', casi === null, casi);
  ok('pasado el tope: FUERA', pasado === 'fuera', pasado);

  // Y el tope manda aunque se esté moviendo: irse manejando a otra ciudad
  // ausente 3 horas no es "volver a ruta".
  const v2 = crearVigia();
  v2.posicion(R.lat, R.lng, T0);
  v2.posicion(R.lat + 0.01, R.lng, T0 + TOPE_AUSENTE_MS + min(5));
  const lejosYtarde = v2.posicion(R.lat + 0.02, R.lng, T0 + TOPE_AUSENTE_MS + min(6));
  ok('pasado el tope, moverse ya no es volver', lejosYtarde === 'fuera', lejosYtarde);
}

console.log('\nLOS NÚMEROS SON LOS QUE SE PROMETEN');
{
  ok('el radio aguanta un restaurante y no una vuelta', RADIO_VOLVER_M === 300, RADIO_VOLVER_M);
  ok('el tope son 2 horas', TOPE_AUSENTE_MS === 2 * 60 * 60 * 1000, TOPE_AUSENTE_MS);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
process.exit(fallas === 0 ? 0 : 1);
