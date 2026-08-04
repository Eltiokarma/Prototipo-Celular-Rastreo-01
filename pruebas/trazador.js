// La lógica del trazador (server/trazador.js): geometría y edición, sin mapa.
//
// Acá se prueba lo que el panel no puede probar solo: que un clic sobre la
// línea INSERTA en el segmento correcto y uno lejos AGREGA al final, que
// borrar entre dos puntos respeta los elegidos, que deshacer devuelve el
// estado de antes aunque el de ahora se haya seguido mutando. Son las
// herramientas nuevas del trazador del creador — si esto miente, el que
// dibuja una ruta pierde trabajo sin enterarse.
const RAIZ = require('path').join(__dirname, '..');
const T = require(RAIZ + '/server/trazador.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\nLA GEOMETRÍA DICE LA VERDAD EN JULIACA');
{
  // Un grado de latitud son ~111,3 km en cualquier parte del planeta.
  const d = T.metrosEntre([-15.5, -70.13], [-14.5, -70.13]);
  ok('un grado de latitud mide ~111 km', cerca(d, 111320, 100), Math.round(d));

  // Uno de longitud, a la latitud de Juliaca, se achica con cos(15,5°)≈0,9637.
  const dLng = T.metrosEntre([-15.5, -70.13], [-15.5, -69.13]);
  ok('y uno de longitud se achica con el coseno', cerca(dLng, 111320 * 0.9637, 300), Math.round(dLng));

  const largo = T.largoDe([[-15.50, -70.13], [-15.49, -70.13], [-15.49, -70.12]]);
  ok('el largo suma los tramos', cerca(largo, 1113 + 1073, 20), Math.round(largo));

  // A zoom 16 y latitud -15,5, un pixel del mapa mide ~2,3 m: es el número
  // que convierte "12 px del dedo" en el umbral en metros de dondeVa().
  const mpp = T.metrosPorPixel(-15.5, 16);
  ok('metros por pixel a zoom 16 da ~2,3', cerca(mpp, 2.3, 0.15), mpp.toFixed(2));
}

console.log('\nEL CLIC DECIDE SOLO: INSERTAR O AGREGAR');
{
  // Una L de tres puntos: baja un km y dobla un km al este.
  const L = [[-15.50, -70.13], [-15.49, -70.13], [-15.49, -70.12]];

  // Un punto pegadito al medio del PRIMER segmento…
  const s = T.segmentoMasCercano(L, [-15.495, -70.1301]);
  ok('encuentra el segmento correcto', s.i === 0, s);
  ok('con la distancia real (~10 m)', cerca(s.distM, 10.7, 2), Math.round(s.distM));

  // …y otro pegado al segundo.
  const s2 = T.segmentoMasCercano(L, [-15.4901, -70.125]);
  ok('y el otro segmento cuando toca al otro', s2.i === 1, s2);

  const sobre = T.dondeVa(L, [-15.495, -70.1301], 25);
  ok('un clic SOBRE la línea pide insertar ahí', sobre.accion === 'insertar' && sobre.i === 0, sobre);

  const lejos = T.dondeVa(L, [-15.47, -70.10], 25);
  ok('uno lejos pide agregar al final', lejos.accion === 'agregar', lejos);

  ok('sin línea todavía, siempre se agrega',
     T.dondeVa([], [-15.5, -70.13], 25).accion === 'agregar' &&
     T.dondeVa([[-15.5, -70.13]], [-15.5, -70.13], 25).accion === 'agregar');
}

console.log('\nLAS OPERACIONES NO TOCAN LA LISTA ORIGINAL');
{
  // El historial guarda referencias a estados viejos: una operación que
  // mutara la lista original pudriría TODOS los deshacer de una vez.
  const antes = [[-15.50, -70.13], [-15.49, -70.13], [-15.49, -70.12]];
  const copiaFiel = JSON.stringify(antes);

  const conUno = T.agregar(antes, [-15.48, -70.12]);
  const insertado = T.insertar(antes, 0, [-15.495, -70.13]);
  const movido = T.mover(antes, 1, [-15.4905, -70.1305]);
  const borrado = T.borrar(antes, 1);

  ok('agregar pone al final', conUno.length === 4 && conUno[3][0] === -15.48);
  ok('insertar mete ADENTRO del segmento (posición i+1)',
     insertado.length === 4 && insertado[1][0] === -15.495, insertado.map(p => p[0]));
  ok('mover cambia solo ese punto',
     movido[1][0] === -15.4905 && movido[0][0] === -15.50 && movido[2][0] === -15.49);
  ok('borrar saca solo ese punto', borrado.length === 2 && borrado[1][1] === -70.12);
  ok('y la lista original quedó intacta tras las cuatro', JSON.stringify(antes) === copiaFiel);
}

console.log('\nBORRAR ENTRE DOS PUNTOS: LA CUADRA QUE QUEDÓ MAL');
{
  const cinco = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const sinMedio = T.borrarEntre(cinco, 1, 3);
  ok('borra lo de adentro y respeta los dos elegidos',
     JSON.stringify(sinMedio.map(p => p[0])) === '[0,1,3,4]', sinMedio.map(p => p[0]));

  ok('el orden de la selección no importa',
     JSON.stringify(T.borrarEntre(cinco, 3, 1)) === JSON.stringify(sinMedio));

  ok('dos puntos pegados no tienen nada entre medio',
     T.borrarEntre(cinco, 2, 3).length === 5);

  ok('de punta a punta deja solo los extremos',
     JSON.stringify(T.borrarEntre(cinco, 0, 4).map(p => p[0])) === '[0,4]');
}

console.log('\nSIMPLIFICAR RESPETA LA FORMA');
{
  // Una recta con ruido de GPS (~2 m de zigzag) es una recta.
  const conRuido = [];
  for (let i = 0; i <= 20; i++) {
    conRuido.push([-15.50 + i * 0.001, -70.13 + (i % 2 ? 0.00002 : -0.00002)]);
  }
  const recta = T.simplificar(conRuido, 10);
  ok('el zigzag del GPS desaparece', recta.length === 2, recta.length);

  // Pero una esquina de verdad (una cuadra al este) sobrevive.
  const conEsquina = [[-15.50, -70.13], [-15.495, -70.13], [-15.49, -70.13], [-15.49, -70.125], [-15.49, -70.12]];
  const esquina = T.simplificar(conEsquina, 10);
  ok('la esquina de verdad se queda',
     esquina.length === 3 && esquina[1][0] === -15.49 && esquina[1][1] === -70.13,
     esquina);
}

console.log('\nIMPORTAR LO QUE EXPORTA UN GRABADOR');
{
  const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
    <trkpt lat="-15.4904" lon="-70.1333"><ele>3825</ele></trkpt>
    <trkpt lat="-15.4910" lon="-70.1340"/>
    <rtept lat="-15.4920" lon="-70.1350"/>
  </trkseg></trk></gpx>`;
  const puntos = T.leerRecorrido(gpx);
  ok('un GPX se lee (trkpt y rtept)', puntos.length === 3 && puntos[0][0] === -15.4904, puntos[0]);

  const geo = JSON.stringify({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-70.1333, -15.4904], [-70.1340, -15.4910]] },
  });
  const dos = T.leerRecorrido(geo);
  ok('un GeoJSON también, con lat y lng en su lugar',
     dos.length === 2 && dos[0][0] === -15.4904 && dos[0][1] === -70.1333, dos[0]);

  let explota = false;
  try { T.leerRecorrido('esto no es ningún formato'); } catch { explota = true; }
  ok('la basura avisa en vez de devolver vacío', explota);
}

console.log('\nDESHACER DEVUELVE EL PASADO DE VERDAD');
{
  const h = T.crearHistorial(3);
  ok('recién creado no hay nada que deshacer', h.hay() === false && h.deshacer() === null);

  let tramos = { ida: [[-15.50, -70.13]], vuelta: [] };
  h.guardar(tramos);
  tramos = { ...tramos, ida: T.agregar(tramos.ida, [-15.49, -70.13]) };
  h.guardar(tramos);
  tramos = { ...tramos, ida: T.agregar(tramos.ida, [-15.48, -70.13]) };

  // La trampa clásica: guardar referencias y que el presente pudra el pasado.
  // Se muta el estado ACTUAL a mano y el snapshot no tiene que moverse.
  tramos.ida[0][0] = -99;

  const vuelta1 = h.deshacer();
  ok('deshacer devuelve el estado anterior', vuelta1.ida.length === 2, vuelta1.ida.length);
  ok('inmune a las mutaciones del presente', vuelta1.ida[0][0] === -15.50, vuelta1.ida[0][0]);

  const vuelta2 = h.deshacer();
  ok('y el anterior del anterior', vuelta2.ida.length === 1);
  ok('hasta que no queda pasado', h.deshacer() === null && h.hay() === false);

  // El tope: guardar 5 estados con tope 3 tira los 2 más viejos, no los
  // más nuevos — al revés, deshacer volvería a un pasado remoto de un salto.
  const h3 = T.crearHistorial(3);
  for (let i = 1; i <= 5; i++) h3.guardar({ ida: new Array(i).fill([0, 0]), vuelta: [] });
  const salidas = [h3.deshacer().ida.length, h3.deshacer().ida.length, h3.deshacer().ida.length];
  ok('con tope 3, sobreviven los 3 últimos estados',
     JSON.stringify(salidas) === '[5,4,3]' && h3.deshacer() === null, salidas);
}

console.log('\nEL MISMO ARCHIVO SIRVE A LOS DOS MUNDOS');
{
  // El panel lo carga con <script> y usa window.Trazador; Node con require.
  // Si a alguien se le escapa una API de navegador adentro, require explota
  // y esta suite entera se cae — eso ya es la mitad de la prueba. La otra
  // mitad: que exporte todo lo que el panel usa.
  const usadas = ['metrosEntre', 'largoDe', 'metrosPorPixel', 'segmentoMasCercano',
    'dondeVa', 'agregar', 'insertar', 'mover', 'borrar', 'borrarEntre',
    'simplificar', 'leerRecorrido', 'crearHistorial'];
  const faltan = usadas.filter(f => typeof T[f] !== 'function');
  ok('exporta todas las herramientas del panel', faltan.length === 0, faltan);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
process.exit(fallas === 0 ? 0 : 1);
