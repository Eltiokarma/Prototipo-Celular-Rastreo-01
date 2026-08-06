// La lógica del chat de la app nativa (`app/chat.js`).
//
// Sin servidor: es una función pura de lo que llega a lo que se dibuja. Lo
// que defiende es que no se confunda quién habló ni en qué canal — un
// privado que aparece en el grupo es una filtración, y un mensaje de
// Despacho que se ve como propio es peor que no mostrarlo.
const RAIZ = require('path').join(__dirname, '..');
const { aMensaje, hilo, sinLeer } = require(RAIZ + '/app/chat.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const YO = { miPersona: 'M-12', miVehiculo: 'M-12' };
const T = 1785649000000;
const crudo = (o) => ({ kind: 'chat', role: 'driver', timestamp: T, ...o });

console.log('\nQUIÉN HABLÓ');
{
  const mio = aMensaje(crudo({ unitId: 'M-12', vehicleId: 'M-12', driverName: 'Elmer', text: 'voy' }), YO);
  ok('lo mío se marca como mío y se firma "TÚ"', mio.propio === true && mio.quien === 'TÚ', mio);
  ok('y no repite mi propia unidad al lado', mio.unidad === null, mio.unidad);

  const otro = aMensaje(crudo({ unitId: 'M-08', vehicleId: 'M-08', driverName: 'Rufino Quispe', text: 'ok' }), YO);
  ok('lo de otro chofer lleva su nombre y su unidad',
     otro.propio === false && otro.quien === 'Rufino Quispe' && otro.unidad === 'M-08', otro);

  // A quien maneja le importa que le habla la central, no quién está de turno.
  const desp = aMensaje(crudo({ unitId: 'DESPACHO', role: 'dispatch', driverName: 'Ana', text: 'esperá' }), YO);
  ok('Despacho se muestra como DESPACHO, no con el nombre de quien atiende',
     desp.quien === 'DESPACHO' && desp.tono === 'despacho', desp);
}

console.log('\nLOS DOS CANALES');
{
  const grupo   = aMensaje(crudo({ unitId: 'M-08', text: 'grupo' }), YO);
  const directo = aMensaje(crudo({ unitId: 'DESPACHO', role: 'dispatch', toVehicleId: 'M-12', text: 'privado' }), YO);
  ok('sin destinatario es el grupo', grupo.canal === 'grupo', grupo.canal);
  ok('con destinatario es el directo', directo.canal === 'directo', directo.canal);

  const todos = [grupo, directo];
  ok('el hilo del grupo NO trae el privado',
     hilo(todos, 'grupo').every(m => m.texto !== 'privado'), hilo(todos, 'grupo').map(m => m.texto));
  ok('y el del directo NO trae el del grupo',
     hilo(todos, 'directo').every(m => m.texto !== 'grupo'), hilo(todos, 'directo').map(m => m.texto));
}

console.log('\nEL HILO');
{
  // Al reconectar llega el historial completo y se solapa con lo que ya se
  // había recibido en vivo: los repetidos son reales, no hipotéticos.
  const a = aMensaje(crudo({ unitId: 'M-08', text: 'uno', timestamp: T + 1000 }), YO);
  const b = aMensaje(crudo({ unitId: 'M-08', text: 'dos', timestamp: T + 2000 }), YO);
  const repetido = aMensaje(crudo({ unitId: 'M-08', text: 'uno', timestamp: T + 1000 }), YO);
  const h = hilo([b, a, repetido], 'grupo');
  ok('sale en orden aunque llegue desordenado',
     h.map(m => m.texto).join(',') === 'uno,dos', h.map(m => m.texto));
  ok('y sin repetidos', h.length === 2, h.length);
}

console.log('\nEL SOS');
{
  const sos = aMensaje({ type: 'sos_alert', sosId: 7, unitId: 'M-08', driverName: 'Rufino Quispe',
                         vehicleId: 'M-08', lat: -15.48, lng: -70.13, timestamp: T }, YO);
  ok('se lee como pedido de ayuda, no como un texto vacío',
     /pide ayuda/.test(sos.texto) && /Rufino/.test(sos.texto), sos.texto);
  ok('y lleva su propio tono para poder destacarlo', sos.tono === 'sos', sos.tono);
  ok('recién disparado no dice tipo: nace genérico', !/\(/.test(sos.texto), sos.texto);
  ok('y lleva el ancla para cuando el tipo llegue', sos.sosId === 7, sos.sosId);

  // El tipo llega DESPUÉS, como mensaje aparte, y actualiza la burbuja ya
  // dibujada — la emergencia del hilo es una sola, no dos.
  const { conTipoSos } = require(RAIZ + '/app/chat.js');
  const con = conTipoSos(sos, 'accidente');
  ok('el tipo se suma a la misma burbuja', /pide ayuda \(accidente\)/.test(con.texto), con.texto);
  const corregido = conTipoSos(con, 'mecanica');
  ok('corregir reemplaza, no acumula', /\(falla mecánica\)$/.test(corregido.texto) &&
     !/accidente/.test(corregido.texto), corregido.texto);
  ok('un tipo inventado deja el mensaje como está', conTipoSos(sos, 'ovni') === sos);
  ok('y un chat común ni se inmuta',
     conTipoSos(aMensaje(crudo({ unitId: 'M-08', text: 'hola' }), YO), 'accidente').texto === 'hola');

  // Del historial ya viene calificado: el que reconecta ve lo mismo.
  const delHistorial = aMensaje({ kind: 'sos', sosId: 7, sosTipo: 'policia', unitId: 'M-08',
                                  driverName: 'Rufino Quispe', timestamp: T }, YO);
  ok('el historial trae el tipo puesto', /\(policía\)$/.test(delHistorial.texto), delHistorial.texto);
}

console.log('\nLAS NOTAS DE VOZ');
{
  const voz = aMensaje(crudo({ kind: 'voice', unitId: 'M-08', driverName: 'Rufino',
                               duration: 7, data: 'data:audio/m4a;base64,AAAA' }), YO);
  ok('se anuncia como nota con su duración', /Nota de voz · 7s/.test(voz.texto), voz.texto);
  ok('lleva el audio para poder reproducirlo', voz.audio === 'data:audio/m4a;base64,AAAA', voz.audio);
  ok('y su propio tono', voz.tono === 'voz', voz.tono);

  // El servidor solo conserva el audio de las 30 más recientes: las viejas
  // llegan sin `data` y tienen que verse como lo que son.
  const vieja = aMensaje(crudo({ kind: 'voice', unitId: 'M-08', duration: 4 }), YO);
  ok('una nota vieja sin audio no revienta y queda sin reproducción',
     vieja.audio === null && /Nota de voz/.test(vieja.texto), vieja);
}

console.log('\nLAS FOTOS');
{
  const foto = aMensaje(crudo({ kind: 'photo', unitId: 'M-08', driverName: 'Rufino',
                                data: 'data:image/jpeg;base64,AAAA' }), YO);
  ok('lleva la imagen para poder verla', foto.imagen === 'data:image/jpeg;base64,AAAA', foto.imagen);
  ok('y su propio tono', foto.tono === 'foto', foto.tono);
  // Una burbuja vacía no se distingue de un bug: sin pie, algo tiene que decir.
  ok('sin pie de foto igual dice algo', foto.texto === 'Foto', foto.texto);

  const conPie = aMensaje(crudo({ kind: 'photo', unitId: 'M-08', text: 'se rompió el eje',
                                  data: 'data:image/jpeg;base64,AAAA' }), YO);
  ok('con pie de foto, se muestra el pie', conPie.texto === 'se rompió el eje', conPie.texto);

  // El servidor conserva solo las 20 últimas imágenes.
  const expirada = aMensaje(crudo({ kind: 'photo', unitId: 'M-08', text: 'el choque' }), YO);
  ok('una foto vieja sin imagen no revienta',
     expirada.imagen === null && expirada.texto === 'el choque', expirada);

  // Y que no se crucen: una foto no es un audio.
  ok('una foto no trae audio', foto.audio === null, foto.audio);
  const voz2 = aMensaje(crudo({ kind: 'voice', unitId: 'M-08', duration: 3,
                                data: 'data:audio/m4a;base64,AAAA' }), YO);
  ok('y una nota de voz no trae imagen', voz2.imagen === null, voz2.imagen);
}

console.log('\nSIN LEER');
{
  const ms = [
    aMensaje(crudo({ unitId: 'M-08', text: 'viejo', timestamp: T }), YO),
    aMensaje(crudo({ unitId: 'M-08', text: 'nuevo', timestamp: T + 5000 }), YO),
    aMensaje(crudo({ unitId: 'M-12', vehicleId: 'M-12', text: 'mío', timestamp: T + 6000 }), YO),
  ];
  ok('cuenta lo posterior a la última mirada', sinLeer(ms, 'grupo', T) === 1, sinLeer(ms, 'grupo', T));
  ok('lo propio nunca cuenta como sin leer', sinLeer(ms, 'grupo', 0) === 2, sinLeer(ms, 'grupo', 0));
  ok('un canal vacío da cero', sinLeer(ms, 'directo', 0) === 0);
}

console.log('\nBORDES');
{
  const vacio = aMensaje(crudo({ unitId: 'M-08' }), YO);
  ok('un mensaje sin texto no revienta', vacio.texto === '', vacio.texto);
  ok('sin hora, la hora queda vacía',
     aMensaje({ unitId: 'M-08', text: 'x' }, YO).hora === '', aMensaje({ unitId: 'M-08', text: 'x' }, YO).hora);
  ok('un hilo vacío devuelve vacío', hilo([], 'grupo').length === 0);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
