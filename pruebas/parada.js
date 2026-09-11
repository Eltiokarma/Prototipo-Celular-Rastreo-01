// La parada sostenida (server/parada.js): N minutos sin avanzar por la ruta.
//
// Lo que se defiende: que la parada de pasajeros de una esquina de Juliaca
// NO sea tráfico, que el embotellamiento que arrastra a paso de hombre SÍ lo
// sea, que el terminal no cuente, y que un semáforo adentro del embotellamiento
// no apague y prenda el aviso. Lógica pura, con el reloj en la mano.
const RAIZ = require('path').join(__dirname, '..');
const { crearDetectorDeParada, PARADA_MS, AVANCE_M, LIBRE_MS, LIBRE_AVANCE_M } = require(RAIZ + '/server/parada.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const T0 = 1_000_000_000;
const seg = (n) => n * 1000;

// Manda posiciones cada 10 s durante `segundos`, avanzando `metrosPorSeg`
// por segundo desde `m0`. Devuelve la última respuesta y los cambios vistos.
function correr(d, { desde = T0, segundos, m0 = 1000, metrosPorSeg = 0, extra = {} }) {
  let r = null;
  const cambios = [];
  for (let s = 0; s <= segundos; s += 10) {
    r = d.posicion('M-01', { cuando: desde + seg(s), recorridoM: m0 + metrosPorSeg * s, ...extra });
    if (r.cambio) cambios.push({ s, cambio: r.cambio, duroMs: r.duroMs });
  }
  return { r, cambios };
}

console.log('\nLOS NÚMEROS');
ok('tres minutos sin avanzar es parada', PARADA_MS === 180_000, PARADA_MS);
ok('"sin avanzar" son menos de 150 m en esos minutos (3 km/h)', AVANCE_M === 150, AVANCE_M);
ok('y se sale con 100 m en el último minuto (6 km/h)', LIBRE_MS === 60_000 && LIBRE_AVANCE_M === 100);

console.log('\nLA ESQUINA DE JULIACA NO ES TRÁFICO');
{
  const d = crearDetectorDeParada();
  // 50 s parado subiendo pasajeros, con el zigzag del GPS parado (±20 m)
  let r = null;
  for (let s = 0; s <= 50; s += 10) {
    r = d.posicion('M-01', { cuando: T0 + seg(s), recorridoM: 1000 + (s % 20 ? 20 : -15) });
  }
  ok('50 s parado no es nada', r.parado === false && r.cambio === null, r);
  // arranca y anda a 30 km/h (8,3 m/s)
  const { r: r2, cambios } = correr(d, { desde: T0 + seg(60), segundos: 180, m0: 1000, metrosPorSeg: 8.3 });
  ok('y sigue sin ser nada al andar', r2.parado === false && cambios.length === 0, cambios);
}

console.log('\nTRES MINUTOS CLAVADO SÍ');
{
  const d = crearDetectorDeParada();
  const { r, cambios } = correr(d, { segundos: 170, m0: 5000 });
  ok('a los 170 s todavía no', r.parado === false, r);
  const r2 = d.posicion('M-01', { cuando: T0 + seg(180), recorridoM: 5010 });
  ok('a los 180 s, parada — y avisa que EMPEZÓ', r2.parado === true && r2.cambio === 'empezo', r2);
  ok('desde el principio de la ventana, no desde ahora', r2.desde === T0, r2.desde);
  const r3 = d.posicion('M-01', { cuando: T0 + seg(190), recorridoM: 5005 });
  ok('y se sostiene sin volver a avisar', r3.parado === true && r3.cambio === null && r3.desde === T0, r3);
  ok('estadoDe lo dice igual', d.estadoDe('M-01').parado === true);
  ok('y de una unidad desconocida dice que no', d.estadoDe('M-99').parado === false);
}

console.log('\nEL EMBOTELLAMIENTO QUE ARRASTRA TAMBIÉN');
{
  // A paso de hombre: 0,5 m/s = 1,8 km/h → 90 m en 3 min, menos que 150
  const d = crearDetectorDeParada();
  const { r, cambios } = correr(d, { segundos: 180, m0: 5000, metrosPorSeg: 0.5 });
  ok('avanzando a 1,8 km/h se marca parada igual', r.parado === true, r);
  ok('una sola vez', cambios.filter(c => c.cambio === 'empezo').length === 1, cambios);
}
{
  // Lento pero circulando: 1 m/s = 3,6 km/h → 180 m en 3 min, más que 150
  const d = crearDetectorDeParada();
  const { r } = correr(d, { segundos: 180, m0: 5000, metrosPorSeg: 1 });
  ok('a 3,6 km/h sostenidos NO es parada: circula', r.parado === false, r);
}

console.log('\nSALIR: ANDAR EN EL ÚLTIMO MINUTO');
{
  const d = crearDetectorDeParada();
  correr(d, { segundos: 240, m0: 5000 });          // 4 min clavado → parado
  ok('parado', d.estadoDe('M-01').parado === true);
  // Un semáforo adentro del embotellamiento: 30 m en un minuto no alcanza
  const { r: r1 } = correr(d, { desde: T0 + seg(250), segundos: 50, m0: 5000, metrosPorSeg: 0.5 });
  ok('avanzar 30 m en un minuto no lo libera', r1.parado === true && r1.cambio === null, r1);
  // Arranca de verdad: 8 m/s → 100 m en 13 s
  const { r: r2, cambios } = correr(d, { desde: T0 + seg(310), segundos: 30, m0: 5030, metrosPorSeg: 8 });
  ok('al andar 100 m en el último minuto, TERMINÓ', r2.parado === false && cambios.some(c => c.cambio === 'termino'), cambios);
  const fin = cambios.find(c => c.cambio === 'termino');
  ok('y dice cuánto duró: desde el principio de la ventana hasta que arrancó',
     fin && fin.duroMs === (T0 + seg(320)) - T0, fin);
  ok('después de terminar, la ventana arranca de cero (no vuelve a marcar enseguida)',
     correr(d, { desde: T0 + seg(350), segundos: 100, m0: 5300 }).r.parado === false);
}

console.log('\n"ANDANDO": LO QUE APAGA LA PALABRA DEL CHOFER');
{
  // El chofer puede marcar tráfico antes de que la parada automática exista
  // (va a 4 km/h). Su marca se apaga sola cuando vuelve a circular, y para
  // eso el detector dice en cada posición si anduvo en el último minuto.
  const d = crearDetectorDeParada();
  const { r: quieto } = correr(d, { segundos: 60, m0: 5000, metrosPorSeg: 0.5 });
  ok('a paso de hombre, no anda', quieto.andando === false, quieto);
  const { r: rapido } = correr(d, { desde: T0 + seg(70), segundos: 60, m0: 5030, metrosPorSeg: 8 });
  ok('a 30 km/h, anda', rapido.andando === true, rapido);
  ok('y sin muestras, no anda', crearDetectorDeParada().posicion('M-01', { cuando: T0, recorridoM: 1 }).andando === false);
}

console.log('\nLO QUE NO CUENTA');
{
  const d = crearDetectorDeParada();
  const { r } = correr(d, { segundos: 300, m0: 10, extra: { enExtremo: true } });
  ok('en el extremo del tramo (el terminal) nunca es parada', r.parado === false, r);
}
{
  const d = crearDetectorDeParada();
  const { r } = correr(d, { segundos: 300, m0: 5000, extra: { fueraDeRuta: true } });
  ok('fuera de ruta tampoco: eso ya tiene su alarma', r.parado === false, r);
}
{
  const d = crearDetectorDeParada();
  const { r } = correr(d, { segundos: 300, m0: NaN });
  ok('sin proyección (ruta sin trazado) no se mide', r.parado === false, r);
}
{
  const d = crearDetectorDeParada();
  correr(d, { segundos: 240, m0: 5000 });
  const r = d.posicion('M-01', { cuando: T0 + seg(250), recorridoM: 5000, enExtremo: true });
  ok('llegar al extremo estando parado lo termina', r.parado === false && r.cambio === 'termino', r);
}

console.log('\nEL CAMBIO DE VUELTA NO ES MARCHA ATRÁS');
{
  const d = crearDetectorDeParada();
  // Va a 8 m/s por el final del circuito (20 km) y vuelve a cero
  let r = null;
  for (let s = 0; s <= 120; s += 10) r = d.posicion('M-01', { cuando: T0 + seg(s), recorridoM: 19_500 + 8 * s });
  for (let s = 130; s <= 300; s += 10) r = d.posicion('M-01', { cuando: T0 + seg(s), recorridoM: 8 * (s - 130) });
  ok('el salto de 20 000 m a 0 no marca parada', r.parado === false, r);
}

console.log('\nY SI ESTABA PARADA, EL CAMBIO DE VUELTA CIERRA EL EPISODIO');
{
  // Revisión del 10/9, L17. El reinicio por cambio de vuelta vaciaba las
  // muestras pero dejaba puestos `e.parado` y `e.desde`: el episodio
  // sobrevivía con el `desde` de la vuelta anterior hasta que la combi
  // avanzara 100 m, y su duración salía inflada con toda esa vuelta.
  const d = crearDetectorDeParada();
  // Cuatro minutos clavada cerca del final del circuito: parada.
  const clavada = correr(d, { segundos: 240, m0: 19_500 });
  ok('primero queda parada, como corresponde',
     clavada.r.parado === true && clavada.cambios.some(c => c.cambio === 'empezo'), clavada.cambios);
  // Y ahora el circuito vuelve a cero: dio la vuelta entera.
  const vuelta = d.posicion('M-01', { cuando: T0 + seg(250), recorridoM: 40 });
  ok('el cambio de vuelta cierra el episodio en el acto',
     vuelta.parado === false && vuelta.cambio === 'termino', vuelta);
  ok('y lo cierra con el `desde` de VERDAD, no con el de ahora',
     vuelta.desde === T0, { desde: vuelta.desde, T0 });
  ok('la unidad queda sin parada abierta', d.estadoDe('M-01').parado === false, d.estadoDe('M-01'));
  // Y la muestra del cambio de vuelta NO se pierde: es la primera de la
  // ventana nueva, así que tres minutos clavada ahí vuelven a ser parada.
  let r2 = null;
  for (let s = 260; s <= 440; s += 10) r2 = d.posicion('M-01', { cuando: T0 + seg(s), recorridoM: 40 });
  ok('y la ventana nueva arranca en el cambio de vuelta, no se pierde esa muestra',
     r2.parado === true && r2.desde === T0 + seg(250), { desde: r2.desde, esperado: T0 + seg(250) });
}

console.log('\nCADA UNIDAD POR SU LADO, Y EL OLVIDO');
{
  const d = crearDetectorDeParada();
  correr(d, { segundos: 240, m0: 5000 });
  for (let s = 0; s <= 240; s += 10) d.posicion('M-02', { cuando: T0 + seg(s), recorridoM: 3000 + 8 * s });
  ok('M-01 parada y M-02 andando, sin mezclarse',
     d.estadoDe('M-01').parado === true && d.estadoDe('M-02').parado === false);
  const o = d.olvidar('M-01');
  ok('olvidar dice si estaba parada, para cerrar el episodio', o.estabaParado === true && o.desde === T0, o);
  ok('y después no queda nada', d.estadoDe('M-01').parado === false);
  ok('olvidar a quien no estaba no rompe', d.olvidar('M-77').estabaParado === false);
}

console.log('\nLAS POSICIONES NO CAEN JUSTO EN EL BORDE DE LA VENTANA');
{
  // Encontrado el 10/9 con la suite `trucos`: la ventana descartaba toda
  // muestra más vieja que N minutos y exigía que la primera guardada tuviera
  // N minutos. Con posiciones cada 10 s exactos una caía justo en el borde y
  // funcionaba; con cada 10,037 s —que es lo que manda un GPS— la primera
  // guardada tenía siempre 2:50 y la parada no se detectaba NUNCA.
  for (const paso of [10_037, 9_500, 11_300]) {
    const d = crearDetectorDeParada();
    let r = null, marco = null;
    for (let i = 0; i < 40 && !marco; i++) {
      r = d.posicion('M-01', { cuando: T0 + i * paso, recorridoM: 5000 });
      if (r.parado) marco = i * paso;
    }
    ok(`cada ${paso} ms clavada: parada a los ${marco ? Math.round(marco / 1000) : '—'} s, desde el principio`,
       marco !== null && marco >= PARADA_MS && marco < PARADA_MS + paso && r.desde === T0, { marco, desde: r && r.desde });
  }
  // Y andando con el mismo paso irregular, nada
  const d = crearDetectorDeParada();
  let r = null;
  for (let i = 0; i < 40; i++) r = d.posicion('M-01', { cuando: T0 + i * 10_037, recorridoM: 1000 + 8.3 * i * 10.037 });
  ok('andando a 30 km/h con paso irregular, nada', r.parado === false, r);
}

console.log('\nUN HUECO DE DATOS NO ES UNA PARADA');
{
  // Revisión del 10/9, L7: con la muestra anterior al borde guardada, dos
  // muestras separadas por diez minutos declaraban una parada de diez
  // minutos sobre una ventana sin una sola medición.
  const d = crearDetectorDeParada();
  d.posicion('M-01', { cuando: T0, recorridoM: 5000 });
  const r = d.posicion('M-01', { cuando: T0 + seg(600), recorridoM: 5000 });
  ok('dos muestras a diez minutos, sin nada en el medio: nada', r.parado === false && r.cambio === null, r);
  // Y la parada que estaba en curso termina si se cortan los datos
  const d2 = crearDetectorDeParada();
  correr(d2, { segundos: 240, m0: 5000 });
  ok('(parada en curso)', d2.estadoDe('M-01').parado === true);
  const r2 = d2.posicion('M-01', { cuando: T0 + seg(240 + 400), recorridoM: 5000 });
  ok('tras un hueco de más de la ventana, termina: sin datos no se sostiene', r2.parado === false && r2.cambio === 'termino', r2);
  // La muestra de después del hueco arranca la ventana nueva
  let r3 = null;
  for (let s = 10; s <= 180; s += 10) r3 = d2.posicion('M-01', { cuando: T0 + seg(640 + s), recorridoM: 5000 });
  ok('y tres minutos clavada después del hueco vuelve a ser parada, fechada después del hueco', r3.parado === true && r3.desde === T0 + seg(640), r3);
}

console.log('\nLOS PLAZOS SE INYECTAN');
{
  const d = crearDetectorDeParada({ paradaMs: 3000, avanceM: 10, libreMs: 1000, libreAvanceM: 5 });
  let r = null;
  for (let ms = 0; ms <= 3000; ms += 500) r = d.posicion('M-01', { cuando: T0 + ms, recorridoM: 100 });
  ok('con 3 s de plazo, a los 3 s marca', r.parado === true, r);
  r = d.posicion('M-01', { cuando: T0 + 3500, recorridoM: 110 });
  ok('y con 5 m en el último segundo, libera', r.parado === false && r.cambio === 'termino', r);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
