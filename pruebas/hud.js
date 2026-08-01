// La lógica de la pantalla del chofer (`app/hud.js`).
//
// Esta suite no necesita servidor: `hud.js` es una función pura de las
// brechas a lo que se ve. Es la única parte de la app nativa que se puede
// probar sin un teléfono, y es justo donde estuvieron todos los bugs de esta
// pantalla. Cada caso de acá corresponde a algo que salió mal de verdad.
const RAIZ = require('path').join(__dirname, '..');
const { construirHud, textoNotificacion } = require(RAIZ + '/app/hud.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const conBrecha = (adelante, atras, objetivoMin = 2) => construirHud({ adelante, atras, objetivoMin });
const unidad = (tiempo, u) => ({ tiempo, unidad: u, sinSenal: false });
const callada = (u) => ({ tiempo: null, unidad: u, sinSenal: true });

console.log('\nLOS TRES ESTADOS DE UN LADO');
{
  const h = conBrecha(unidad('02:24', 'M-08'), null);
  ok('con alguien adelante, se muestra el tiempo y quién es',
     h.adelante.display === '2:24' && h.adelante.rotulo === '+1 · M-08', h.adelante);
  ok('sin nadie atrás, se dice "sin nadie"',
     h.atras.vacio && !h.atras.sinSenal && h.atras.rotulo === 'sin nadie', h.atras);
  ok('y no se inventa un tiempo para ese lado', h.atras.display === null, h.atras.display);
}
{
  const h = conBrecha(callada('M-08'), null);
  ok('con alguien sin señal, se lo nombra y se dice por qué',
     h.adelante.sinSenal && h.adelante.rotulo === 'M-08 · sin señal', h.adelante);
  ok('sin tiempo, porque es lo que no se sabe', h.adelante.display === null);
  ok('"sin señal" y "sin nadie" NO dan el mismo rótulo',
     h.adelante.rotulo !== h.atras.rotulo, [h.adelante.rotulo, h.atras.rotulo]);
}

console.log('\nQUÉ SE LE DICE AL CHOFER');
ok('con la brecha en el objetivo, que mantenga',
   /Mantené el ritmo/.test(conBrecha(unidad('02:00', 'M-08'), null).instruccion));
ok('con la de adelante escapándose, que apure',
   /Apurá/.test(conBrecha(unidad('03:30', 'M-08'), null).instruccion),
   conBrecha(unidad('03:30', 'M-08'), null).instruccion);
ok('con la de adelante encima, que afloje',
   /Aflojá/.test(conBrecha(unidad('00:50', 'M-08'), null).instruccion),
   conBrecha(unidad('00:50', 'M-08'), null).instruccion);
// El de atrás se lee al revés: brecha chica = te vienen pisando = apurá.
ok('con la de atrás pisándole los talones, que apure',
   /Apurá/.test(conBrecha(null, unidad('00:50', 'M-21')).instruccion),
   conBrecha(null, unidad('00:50', 'M-21')).instruccion);
ok('solo en la ruta, se lo dice y no inventa una referencia',
   /única unidad/.test(conBrecha(null, null).instruccion));

// Lo que motivó todo el trabajo del "sin señal": esta instrucción NO puede
// ser una orden de ritmo, porque no hay contra qué medirla.
{
  const h = conBrecha(callada('M-08'), null);
  ok('con el de adelante sin señal, se avisa en vez de mandar a apurar',
     /sin señal/.test(h.instruccion) && !/Apurá|Aflojá/.test(h.instruccion), h.instruccion);
  ok('y NO se le dice que está solo teniendo a alguien adelante',
     !/única unidad/.test(h.instruccion), h.instruccion);
}

console.log('\nCUÁL ES EL DÍGITO GRANDE');
ok('el lado más desviado del objetivo manda',
   conBrecha(unidad('02:05', 'M-08'), unidad('04:00', 'M-21')).principal.etiqueta === 'ATRÁS');
ok('un lado sin número nunca es el principal',
   conBrecha(unidad('03:30', 'M-08'), null).principal.etiqueta === 'ADELANTE');
ok('entre dos lados sin número, manda el que tiene a alguien sin señal',
   conBrecha(null, callada('M-21')).principal.etiqueta === 'ATRÁS',
   conBrecha(null, callada('M-21')).principal);

console.log('\nLOS COLORES');
ok('dentro del 15 % del objetivo, verde', conBrecha(unidad('02:10', 'M-08'), null).estado === 'verde');
ok('hasta el 30 %, ámbar', conBrecha(unidad('02:30', 'M-08'), null).estado === 'ambar');
ok('más allá, rojo', conBrecha(unidad('03:30', 'M-08'), null).estado === 'rojo');
ok('un lado sin dato no tiene color de alarma',
   conBrecha(callada('M-08'), null).estado === 'ninguno');

console.log('\nLA NOTIFICACIÓN PERMANENTE');
// Android obliga a mostrarla para correr el GPS en segundo plano: que diga
// la brecha es gratis, y es lo que el chofer ve sin desbloquear.
ok('lleva la brecha y contra quién',
   /M-08/.test(textoNotificacion(conBrecha(unidad('02:24', 'M-08'), null), true)) &&
   /2:24/.test(textoNotificacion(conBrecha(unidad('02:24', 'M-08'), null), true)),
   textoNotificacion(conBrecha(unidad('02:24', 'M-08'), null), true));
ok('avisa cuando el de adelante está sin señal',
   /sin señal/.test(textoNotificacion(conBrecha(callada('M-08'), null), true)),
   textoNotificacion(conBrecha(callada('M-08'), null), true));
ok('y el acompañante sabe que su GPS no se usa',
   /acompañante/.test(textoNotificacion(conBrecha(unidad('02:00', 'M-08'), null), false)),
   textoNotificacion(conBrecha(unidad('02:00', 'M-08'), null), false));

console.log('\nBORDES');
ok('sin brechas todavía, no revienta',
   construirHud(undefined).principal.vacio === true);
ok('sin objetivo, tampoco', construirHud({ adelante: unidad('02:00', 'M-08'), atras: null }).estado === 'ninguno');

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
