// El vigía del envío (app/envio.js): qué pasa con un POST /gps que no vuelve.
//
// Lo que se defiende: que un envío colgado no tape el resto del turno. Y que
// el corte NO dependa de un timer, porque con la pantalla apagada React
// Native no corre los timers de JavaScript — el `setTimeout` de 15 s de la
// primera versión se quedaba esperando junto con el fetch que tenía que
// cortar, y el servidor veía ráfagas y silencios de minutos. El reloj es la
// propia tarea del GPS, que sí dispara con la pantalla apagada.
const RAIZ = require('path').join(__dirname, '..');
const fs = require('fs');
const { crearVigiaDeEnvio, CORTE_MS } = require(RAIZ + '/app/envio.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un reloj de mentira, que avanza cuando se le dice — igual que la tarea del
// GPS, que dispara cada 10 s con la pantalla apagada.
const reloj = () => { let t = 1_000_000; return { ahora: () => t, pasan: (ms) => { t += ms; } }; };
// Un AbortController de mentira, que anota si lo abortaron
const control = () => { const c = { abortado: 0, abort() { c.abortado++; } }; return c; };
const pos = (i) => ({ lat: -15.49, lng: -70.13, speed: 20, timestamp: 1000 + i });
const tanda = (n) => Array.from({ length: n }, (_, i) => pos(i));

console.log('\nSIN NADA EN VUELO, SE MANDA');
{
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  ok('libre al arrancar', v.revisar().accion === 'libre');
  ok('y no hay vuelo', v.enVuelo === null);
}

console.log('\nUN ENVÍO RECIENTE HACE ESPERAR A LA TANDA NUEVA');
{
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  const c = control();
  const vuelo = v.empezar(tanda(3), c);
  ok('el vuelo queda anotado con su hora', v.enVuelo === vuelo && vuelo.desde === r.ahora());
  r.pasan(10_000);   // el disparo siguiente, a los 10 s
  ok('a los 10 s todavía es un envío lento, no uno colgado', v.revisar().accion === 'esperar');
  ok('y no se lo abortó', c.abortado === 0);
  ok('ni se lo marcó cortado', vuelo.cortado === false);
  v.terminar(vuelo);
  ok('al terminar, queda libre', v.revisar().accion === 'libre' && v.enVuelo === null);
}

console.log('\nUN ENVÍO COLGADO SE CORTA DESDE LA TAREA, SIN NINGÚN TIMER');
{
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  const c = control();
  const posiciones = tanda(150);
  const vuelo = v.empezar(posiciones, c);
  r.pasan(20_000);   // dos disparos del GPS después, sigue sin volver
  const res = v.revisar();
  ok('pasado el corte, la revisión lo corta', res.accion === 'cortado', res.accion);
  ok('y aborta el fetch: es lo que cierra el socket muerto', c.abortado === 1);
  ok('devuelve el MISMO vuelo, con sus posiciones para la cola',
     res.vuelo === vuelo && res.vuelo.posiciones === posiciones);
  ok('el vuelo queda marcado como cortado', vuelo.cortado === true);
  ok('y el vigía queda libre para mandar en este mismo disparo',
     v.enVuelo === null && v.revisar().accion === 'libre');
}

console.log('\nEL CORTE CAE ENTRE LOS 15 Y LOS 20 SEGUNDOS');
{
  ok('el corte es de 15 s', CORTE_MS === 15_000, CORTE_MS);
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  v.empezar(tanda(1), control());
  r.pasan(CORTE_MS - 1);
  ok('un milisegundo antes todavía espera', v.revisar().accion === 'esperar');
  r.pasan(1);
  ok('justo al corte, corta', v.revisar().accion === 'cortado');
  // Y se puede acortar para probar sin esperar
  const v2 = crearVigiaDeEnvio({ ahora: r.ahora, corteMs: 5 });
  v2.empezar(tanda(1), control());
  r.pasan(5);
  ok('el corte se inyecta', v2.revisar().accion === 'cortado');
}

console.log('\nEL ENVÍO CORTADO, AL MORIR TARDE, NO PISA AL QUE ARRANCÓ DESPUÉS');
{
  // La secuencia real: se corta el viejo, arranca el nuevo, y RECIÉN
  // entonces el rechazo del viejo llega a su `finally`. Si ese `terminar`
  // soltara al nuevo, el próximo disparo lo creería libre y mandaría
  // encima — dos envíos a la vez, que es lo que el vigía existe para evitar.
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  const viejo = v.empezar(tanda(2), control());
  r.pasan(20_000);
  ok('se corta el viejo', v.revisar().accion === 'cortado');
  const nuevo = v.empezar(tanda(2), control());
  v.terminar(viejo);   // el rechazo del viejo llega tarde
  ok('el nuevo sigue en vuelo', v.enVuelo === nuevo);
  r.pasan(5_000);
  ok('y el próximo disparo espera al nuevo, no manda encima', v.revisar().accion === 'esperar');
  v.terminar(nuevo);
  ok('terminar el nuevo sí libera', v.enVuelo === null);
}

console.log('\nUN CONTROL QUE REVIENTA AL ABORTAR NO TUMBA LA TAREA');
{
  const r = reloj();
  const v = crearVigiaDeEnvio({ ahora: r.ahora });
  v.empezar(tanda(1), { abort() { throw new Error('ya cerrado'); } });
  r.pasan(20_000);
  let res = null, error = null;
  try { res = v.revisar(); } catch (e) { error = e; }
  ok('corta igual, sin propagar el error', error === null && res?.accion === 'cortado', error?.message);
  const v2 = crearVigiaDeEnvio({ ahora: r.ahora });
  v2.empezar(tanda(1), null);
  r.pasan(20_000);
  ok('y sin control también', v2.revisar().accion === 'cortado');
}

console.log('\nEL RELOJ ES LA TAREA DEL GPS, NO UN TIMER');
{
  // Es la razón de todo el módulo: un setTimeout acá volvería a no correr
  // con la pantalla apagada, que es exactamente donde hace falta.
  const fuente = fs.readFileSync(RAIZ + '/app/envio.js', 'utf8');
  const codigo = fuente.replace(/\/\/[^\n]*/g, '');   // sin comentarios
  ok('envio.js no usa setTimeout ni setInterval', !/setTimeout|setInterval/.test(codigo));
  ok('y no importa nada de React Native ni de Expo', !/require\(|^import /m.test(codigo));

  // Y el servicio lo USA como reloj: cada disparo revisa, y el envío
  // cortado no vuelve a encolar sus posiciones desde su propio catch.
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const cuerpoSubir = (servicio.match(/async function subir\(nuevas\) \{[\s\S]*?\n\}/) || [''])[0];
  ok('el servicio revisa el vuelo en cada disparo', /vigiaEnvio\.revisar\(\)/.test(cuerpoSubir));
  ok('devuelve a la cola las posiciones del envío cortado',
     /accion === 'cortado'/.test(cuerpoSubir) && /guardar\(r\.vuelo\.posiciones\)/.test(cuerpoSubir));
  ok('y el envío cortado no las vuelve a encolar desde su catch',
     /if \(vuelo\.cortado\) return;/.test(servicio));
  ok('el fetch del envío lleva el control del vuelo, no uno propio',
     /\}, control\);/.test(servicio) && /vigiaEnvio\.empezar\(posiciones, control\)/.test(servicio));
  ok('y ya no hay un booleano `subiendo` que un cuelgue deje trabado para siempre',
     !/let subiendo/.test(servicio));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
