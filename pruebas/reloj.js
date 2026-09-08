// El reloj atrasado del teléfono (server/reloj.js): que se lo reconozca, y
// que el vaciado de atraso de un corte no se confunda con él.
const RAIZ = require('path').join(__dirname, '..');
const { crearEstimadorDeReloj, LAPSO_MS, MIN_MUESTRAS, TOPE_MS } = require(RAIZ + '/server/reloj.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const T0 = 1_000_000_000;
const seg = (n) => n * 1000;

// `n` envíos cada `cadaS` segundos, todos con la más nueva `edadS` vieja
function mandar(r, id, { desde = T0, n, cadaS = 3, edadS }) {
  let t = desde;
  for (let i = 0; i < n; i++) { r.muestra(id, { cuando: t, edadMs: seg(typeof edadS === 'function' ? edadS(i) : edadS) }); t += seg(cadaS); }
  return t - seg(cadaS); // hora del último
}

console.log('\nLOS NÚMEROS');
ok('se cree recién sostenido un minuto', LAPSO_MS === 60_000, LAPSO_MS);
ok('y con tres envíos como mínimo', MIN_MUESTRAS === 3);
ok('más de diez minutos no es un reloj', TOPE_MS === 600_000, TOPE_MS);

console.log('\nSIN CON QUÉ DECIRLO, CERO');
{
  const r = crearEstimadorDeReloj();
  ok('una unidad desconocida no atrasa', r.sesgoDe('M-01', T0) === 0);
  const t = mandar(r, 'M-01', { n: 2, edadS: 120 });
  ok('dos envíos no alcanzan', r.sesgoDe('M-01', t) === 0, r.sesgoDe('M-01', t));
  const t2 = mandar(r, 'M-02', { n: 5, cadaS: 3, edadS: 120 });
  ok('cinco envíos en 12 s tampoco: no se sostuvo un minuto', r.sesgoDe('M-02', t2) === 0, r.sesgoDe('M-02', t2));
}

console.log('\nEL RELOJ DOS MINUTOS ATRÁS');
{
  const r = crearEstimadorDeReloj();
  // Cada 3 s durante 70 s, siempre 120 s vieja (más 1 s de red)
  const t = mandar(r, 'M-01', { n: 24, cadaS: 3, edadS: (i) => 120 + (i % 2) });
  ok('sostenido más de un minuto, se cree: ~120 s', r.sesgoDe('M-01', t) === seg(120), r.sesgoDe('M-01', t));
  ok('y es el MÍNIMO visto, no el promedio ni el último', r.sesgoDe('M-01', t) !== seg(121));
  ok('cada unidad por su lado', r.sesgoDe('M-02', t) === 0);
}

console.log('\nEL VACIADO DE ATRASO NO ES UN RELOJ');
{
  const r = crearEstimadorDeReloj();
  // Tras un túnel, la app manda su cola en lotes cada 20 s; cada lote trae
  // la posición de ahora adentro, así que la más nueva tiene edad ~1 s.
  const t = mandar(r, 'M-01', { n: 6, cadaS: 20, edadS: 1 });
  ok('con la más nueva fresca en cada lote, el sesgo es el de la red: 1 s', r.sesgoDe('M-01', t) === seg(1), r.sesgoDe('M-01', t));
}
{
  const r = crearEstimadorDeReloj();
  // Un reloj atrasado y, en el medio, un envío que sí trae la hora bien
  // (pasa al sincronizarse): el mínimo baja a cero y ahí queda.
  let t = mandar(r, 'M-01', { n: 24, cadaS: 3, edadS: 120 });
  r.muestra('M-01', { cuando: t + seg(3), edadMs: 0 });
  ok('un solo envío con la hora bien lo baja a cero', r.sesgoDe('M-01', t + seg(3)) === 0);
}
{
  const r = crearEstimadorDeReloj();
  // "150 ya vistas, la más nueva de hace 4302 s": eso no es un reloj
  const t = mandar(r, 'M-01', { n: 10, cadaS: 20, edadS: 4302 });
  ok('una edad de más de diez minutos no se cree', r.sesgoDe('M-01', t) === 0);
}

console.log('\nLA VENTANA Y EL OLVIDO');
{
  const r = crearEstimadorDeReloj();
  const t = mandar(r, 'M-01', { n: 24, cadaS: 3, edadS: 120 });
  ok('recién medido, 120 s', r.sesgoDe('M-01', t) === seg(120));
  ok('seis minutos después, sin envíos nuevos, ya no dice nada', r.sesgoDe('M-01', t + seg(6 * 60)) === 0);
  r.olvidar('M-01');
  ok('olvidada, cero', r.sesgoDe('M-01', t) === 0);
  ok('olvidar a quien no está no rompe', (r.olvidar('M-77'), true));
}
{
  const r = crearEstimadorDeReloj();
  // Un reloj ADELANTADO da edades negativas: no es atraso, se toma como cero
  const t = mandar(r, 'M-01', { n: 24, cadaS: 3, edadS: -30 });
  ok('un reloj adelantado no da un sesgo negativo', r.sesgoDe('M-01', t) === 0);
  r.muestra('M-01', { cuando: NaN, edadMs: 5 });
  r.muestra('M-01', { cuando: t, edadMs: undefined });
  ok('basura no rompe', r.sesgoDe('M-01', t) === 0);
}

console.log('\nLOS PLAZOS SE INYECTAN');
{
  // Con 4 s de plazo (2 × un SIN_SENAL_MS de 2 s, como en las suites)
  const r = crearEstimadorDeReloj({ lapsoMs: 4000 });
  const t = mandar(r, 'M-01', { n: 3, cadaS: 2, edadS: 8 });
  ok('tres envíos en 4 s alcanzan', r.sesgoDe('M-01', t) === seg(8), r.sesgoDe('M-01', t));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
