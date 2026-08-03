// Levantar la pantalla cuando sale el teclado (`app/teclado.js`).
//
// El bug medido: en Android el campo de escribir quedaba DEBAJO del teclado y
// el chofer tipeaba a ciegas. `KeyboardAvoidingView` sin `behavior` no hace
// nada en Android —eso lo resolvía el sistema achicando la ventana—, pero con
// **edge-to-edge** la ventana ya no se achica: ocupa todo el vidrio siempre.
// Es el mismo tema que dejó el botón de CHAT bajo los botones del sistema.
//
// Lo que se prueba es la CUENTA, que es lo que se ve mal en un teléfono, se
// corrige a ojo, y queda mal en el otro.
const RAIZ = require('path').join(__dirname, '..');
const { alturaUtil, acotar, levantar } = require(RAIZ + '/app/teclado.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Medidas reales: un teclado de Android ronda los 300 px; la barra de
// navegación son 48 con botones y ~24 con gestos.
const TECLADO = 320, BOTONES = 48, GESTOS = 24, VENTANA = 800;

console.log('\nNO SE CUENTA DOS VECES LA BARRA DE ANDROID');
{
  // Android informa la altura del teclado DESDE EL BORDE DEL VIDRIO, o sea
  // que ya incluye la franja de la barra de navegación. Y esa franja la
  // pantalla ya la está pagando por `margenes.js`. Sumarlas deja un hueco del
  // alto de la barra entre el campo y el teclado: 48 px de aire raro.
  ok('con botones, se descuenta la barra',
     alturaUtil(TECLADO, BOTONES) === TECLADO - BOTONES, alturaUtil(TECLADO, BOTONES));
  ok('con gestos, se descuenta menos',
     alturaUtil(TECLADO, GESTOS) === TECLADO - GESTOS, alturaUtil(TECLADO, GESTOS));
  ok('y en un Android viejo, que reporta 0, se levanta todo',
     alturaUtil(TECLADO, 0) === TECLADO, alturaUtil(TECLADO, 0));

  // El de botones tiene que levantar MENOS que el de gestos: su barra ocupa
  // más, y esa parte ya estaba reservada.
  ok('el de botones levanta menos que el de gestos',
     alturaUtil(TECLADO, BOTONES) < alturaUtil(TECLADO, GESTOS));
}

console.log('\nSIN TECLADO NO SE TOCA NADA');
{
  ok('cerrado no levanta', alturaUtil(0, BOTONES) === 0);
  ok('ni con altura negativa', alturaUtil(-100, BOTONES) === 0);
  for (const malo of [null, undefined, NaN, 'alto', {}]) {
    ok('ni con ' + JSON.stringify(malo), alturaUtil(malo, BOTONES) === 0, alturaUtil(malo, BOTONES));
  }
}

console.log('\nNUNCA NEGATIVO');
{
  // Pasa de verdad: teclado flotante, o teclado dividido en una tablet, donde
  // el alto informado es menor que el inset. Un padding negativo en React
  // Native no "baja" el contenido: rompe el layout de formas raras.
  ok('un teclado más chico que la barra da 0',
     alturaUtil(30, BOTONES) === 0, alturaUtil(30, BOTONES));
  ok('e igual de alto que la barra, también', alturaUtil(BOTONES, BOTONES) === 0);
}

console.log('\nUN DATO ROTO NO SE LLEVA LA PANTALLA');
{
  // Si un teclado absurdo se aplicara tal cual, el chat entero se iría de la
  // pantalla y parecería que la app se colgó.
  ok('un teclado absurdo se acota a media pantalla',
     acotar(5000, VENTANA) === VENTANA / 2, acotar(5000, VENTANA));
  ok('uno normal pasa entero', acotar(TECLADO, VENTANA) === TECLADO);
  ok('sin saber la ventana, se respeta lo que hay',
     acotar(TECLADO, 0) === TECLADO, acotar(TECLADO, 0));
}

console.log('\nTODO JUNTO');
{
  const l = levantar(TECLADO, { insetAbajo: BOTONES, altoVentana: VENTANA });
  ok('el caso normal levanta lo que corresponde', l === TECLADO - BOTONES, l);
  ok('cerrado da cero', levantar(0, { insetAbajo: BOTONES, altoVentana: VENTANA }) === 0);
  ok('y sin opciones tampoco revienta', levantar(TECLADO) === TECLADO, levantar(TECLADO));
  for (const malo of [null, undefined, NaN]) {
    ok('ni con ' + JSON.stringify(malo), levantar(malo) === 0);
  }
  ok('siempre sale un número usable',
     [0, 10, 320, 5000, -1, NaN].every(v => {
       const r = levantar(v, { insetAbajo: BOTONES, altoVentana: VENTANA });
       return Number.isFinite(r) && r >= 0;
     }));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
