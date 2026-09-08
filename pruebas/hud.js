// La lógica de la pantalla del chofer (`app/hud.js`).
//
// Esta suite no necesita servidor: `hud.js` es una función pura de las
// brechas a lo que se ve. Es la única parte de la app nativa que se puede
// probar sin un teléfono, y es justo donde estuvieron todos los bugs de esta
// pantalla. Cada caso de acá corresponde a algo que salió mal de verdad.
const RAIZ = require('path').join(__dirname, '..');
const { construirHud, textoNotificacion, avisoDesdeRespuesta } = require(RAIZ + '/app/hud.js');

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

console.log('\nEL VECINO EN TRÁFICO');
{
  const AHORA = 1_000_000_000;
  const trabada = (u, desde, confirmado = false) =>
    ({ tiempo: '03:30', unidad: u, sinSenal: false, enTrafico: true, traficoDesde: desde, traficoConfirmado: confirmado });
  // Adelante parada 6 min: la brecha creció a 3:30 y la cuenta de siempre
  // diría "apurá" — hacia el embotellamiento.
  const h = construirHud({ adelante: trabada('M-08', AHORA - 6 * 60_000), atras: null, objetivoMin: 2 }, AHORA);
  ok('el rótulo dice que está parada y hace cuánto',
     h.adelante.rotulo === '+1 · M-08 · PARADA 6 MIN', h.adelante.rotulo);
  ok('el tiempo sigue ahí: el tráfico no borra la brecha', h.adelante.display === '3:30');
  ok('y la instrucción NO es apurar', !/Apurá/.test(h.instruccion) && /Mantené/.test(h.instruccion), h.instruccion);
  ok('dice quién, cuánto, y hacia qué no apurar',
     /M-08/.test(h.instruccion) && /6 min/.test(h.instruccion) && /embotellamiento/.test(h.instruccion), h.instruccion);
  ok('la notificación lo pone primero',
     textoNotificacion(h, true) === 'ADELANTE M-08 · PARADA 6 MIN', textoNotificacion(h, true));

  // Confirmado por el chofer: cambia la palabra, no la regla
  const hc = construirHud({ adelante: trabada('M-08', AHORA - 2 * 60_000, true), atras: null, objetivoMin: 2 }, AHORA);
  ok('si el chofer lo dijo, se dice "en tráfico"',
     hc.adelante.rotulo === '+1 · M-08 · EN TRÁFICO 2 MIN' && /avisa que está en tráfico/.test(hc.instruccion),
     [hc.adelante.rotulo, hc.instruccion]);

  // Sin señal Y en tráfico: se dicen las dos cosas
  const hs = construirHud({ adelante: { ...trabada('M-08', AHORA - 60_000), tiempo: null, sinSenal: true }, atras: null, objetivoMin: 2 }, AHORA);
  ok('sin señal y parada se dicen las dos', /sin señal/.test(hs.adelante.rotulo) && /PARADA 1 MIN/.test(hs.adelante.rotulo), hs.adelante.rotulo);

  // Atrás trabada: se avisa, ritmo normal, y NO manda "apurá" por la brecha chica de atrás
  const ha = construirHud({ adelante: null, atras: { ...trabada('M-21', AHORA - 4 * 60_000), tiempo: '00:50' }, objetivoMin: 2 }, AHORA);
  ok('con la de atrás trabada se avisa y se pide ritmo normal',
     /M-21/.test(ha.instruccion) && /atrás/.test(ha.instruccion) && /Mantené el ritmo/.test(ha.instruccion) && !/Apurá/.test(ha.instruccion),
     ha.instruccion);

  // Sin hora no revienta
  const hn = construirHud({ adelante: { ...trabada('M-08', undefined) }, atras: null, objetivoMin: 2 }, AHORA);
  ok('sin hora dice 0 min en vez de NaN', hn.adelante.traficoMin === 0 && /0 min/.test(hn.instruccion), hn.instruccion);

  // Y en la notificación viva (respuesta del POST /gps) viaja igual
  const a = avisoDesdeRespuesta({ toAhead: '03:30', aheadUnit: 'M-08', aheadSinSenal: false,
                                  aheadEnTrafico: true, aheadTraficoDesde: AHORA - 5 * 60_000, aheadTraficoConfirmado: true,
                                  toBehind: null, behindUnit: null, behindSinSenal: false, objetivoMin: 2 }, AHORA);
  ok('la notificación viva dice el tráfico igual que la pantalla',
     a.titulo === 'ADELANTE M-08 · EN TRÁFICO 5 MIN' && /Mantené/.test(a.detalle), a);
  // Y sin los campos (servidor viejo) todo sigue como antes
  const viejo = construirHud({ adelante: unidad('03:30', 'M-08'), atras: null, objetivoMin: 2 });
  ok('sin los campos de tráfico, la instrucción de siempre', /Apurá/.test(viejo.instruccion) && viejo.adelante.enTrafico === false);
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

console.log('\nLA NOTIFICACIÓN VIVA (la brecha que vuelve en el POST /gps)');
// Con la pantalla apagada no hay WebSocket: el único dato es el `brecha`
// que el servidor pega en la respuesta del POST. Este adaptador lo pasa por
// el MISMO construirHud de la pantalla — no puede decir otra cosa que el HUD.
{
  const resp = { toAhead: '02:24', aheadUnit: 'M-08', aheadSinSenal: false,
                 toBehind: null, behindUnit: null, behindSinSenal: false, objetivoMin: 2 };
  const a = avisoDesdeRespuesta(resp);
  ok('el título lleva la brecha y contra quién',
     /M-08/.test(a.titulo) && /2:24/.test(a.titulo), a.titulo);
  ok('y el detalle da la instrucción, con el objetivo',
     /(Apurá|Aflojá|Mantené)/.test(a.detalle) && /2:00/.test(a.detalle), a.detalle);

  const sinSenal = avisoDesdeRespuesta({ ...resp, toAhead: null, aheadSinSenal: true });
  ok('el de adelante sin señal se dice igual que en pantalla',
     /sin señal/.test(sinSenal.titulo), sinSenal.titulo);

  const solo = avisoDesdeRespuesta({ toAhead: null, aheadUnit: null, aheadSinSenal: false,
                                     toBehind: null, behindUnit: null, behindSinSenal: false, objetivoMin: 2 });
  ok('solo en la ruta: sin brecha que mostrar, pero no revienta',
     /Sin brecha/.test(solo.titulo), solo.titulo);

  // null significa "no toques la notificación", no "mostrá vacío"
  ok('sin brecha en la respuesta, no hay aviso', avisoDesdeRespuesta(undefined) === null);
}

console.log('\nBORDES');
ok('sin brechas todavía, no revienta',
   construirHud(undefined).principal.vacio === true);
ok('sin objetivo, tampoco', construirHud({ adelante: unidad('02:00', 'M-08'), atras: null }).estado === 'ninguno');

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
