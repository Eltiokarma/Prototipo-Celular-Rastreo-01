// El índice de unidades por ruta no se separa nunca del mapa plano.
//
// `buildState` dejó de barrer la flota entera para armar el estado de una ruta
// (era cuadrático, medido en `herramientas/emision.js`): ahora lee un índice
// `routeId → Set`. El índice sólo sirve si es SIEMPRE fiel al mapa plano — una
// unidad en un balde que no está en el mapa, o al revés, sale mal en el mapa de
// Despacho, que es peor que el barrido lento.
//
// Esta suite no confía en leer el código: fuzzea el módulo real con miles de
// operaciones al azar —alta, baja, y sobre todo CAMBIO DE RUTA, que es el caso
// que obliga a centralizar la mutación— y después de CADA una reconstruye el
// índice desde el mapa plano y exige que coincidan. Si divergen una sola vez,
// falla con la operación que lo rompió.
const path = require('path');
const { crearIndiceUnidades } = require(path.join(__dirname, '..', 'server', 'indice-unidades'));

const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');

// Un PRNG con semilla: el fuzz tiene que ser reproducible. Math.random no da
// eso —y además está prohibido en este repo por romper el resume— así que va
// un generador propio, chico.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── 1. Fuzz: miles de operaciones, invariante después de cada una ──
{
  const idx = crearIndiceUnidades();
  const rand = rng(20260824);
  const RUTAS = ['R-0', 'R-1', 'R-2', 'R-3', 'R-4'];
  const IDS = Array.from({ length: 30 }, (_, i) => 'M-' + i);
  let roto = null;
  let cambiosDeRuta = 0, altas = 0, bajas = 0;

  for (let paso = 0; paso < 5000 && !roto; paso++) {
    const id = IDS[Math.floor(rand() * IDS.length)];
    const dado = rand();
    if (dado < 0.35) {
      const routeId = RUTAS[Math.floor(rand() * RUTAS.length)];
      const previo = idx.units.get(id);
      if (previo && previo.routeId !== routeId) cambiosDeRuta++; else if (!previo) altas++;
      idx.poner(id, { unitId: id, routeId, lat: -15 + rand(), routeProgress: rand() });
    } else if (dado < 0.5) {
      if (idx.units.has(id)) bajas++;
      idx.quitar(id);
    } else {
      // Re-poner en la MISMA ruta (el caso común: cada GPS reescribe la unidad)
      const u = idx.units.get(id);
      if (u) idx.poner(id, { ...u, routeProgress: rand() });
    }
    const err = idx.verificar();
    if (err) roto = `paso ${paso}: ${err}`;
  }
  ok('1. Fuzz de 5000 operaciones: índice fiel al mapa en cada paso', roto === null, roto);
  ok('2. El fuzz ejercitó de verdad los tres casos',
    cambiosDeRuta > 50 && altas > 10 && bajas > 50,
    `${altas} altas · ${bajas} bajas · ${cambiosDeRuta} cambios de ruta`);
}

// ── 2. Casos borde nombrados, para que la intención quede escrita ──
{
  const idx = crearIndiceUnidades();
  idx.poner('A', { unitId: 'A', routeId: 'R-1' });
  idx.poner('B', { unitId: 'B', routeId: 'R-1' });
  ok('3. Dos en la misma ruta', idx.deRuta('R-1').length === 2 && idx.verificar() === null);

  idx.poner('A', { unitId: 'A', routeId: 'R-2' });   // A cambia de ruta
  ok('4. Cambio de ruta: sale del balde viejo',
    idx.deRuta('R-1').length === 1 && idx.deRuta('R-2').length === 1 && idx.verificar() === null,
    `R-1=${idx.deRuta('R-1').length} R-2=${idx.deRuta('R-2').length}`);

  idx.quitar('B');                                    // R-1 queda vacía
  ok('5. Al vaciarse una ruta, su balde se borra (no queda basura)',
    !idx.unitsByRoute.has('R-1') && idx.verificar() === null);

  idx.quitar('A'); idx.quitar('A');                   // quitar dos veces no rompe
  ok('6. Quitar algo que no está es inocuo',
    idx.units.size === 0 && idx.unitsByRoute.size === 0 && idx.verificar() === null);

  ok('7. deRuta de una ruta desconocida es lista vacía', idx.deRuta('R-9').length === 0);
}

// ── 3. Que el verificador TENGA dientes (si no, todo lo de arriba miente) ──
{
  const idx = crearIndiceUnidades();
  idx.poner('A', { unitId: 'A', routeId: 'R-1' });
  // Rompo el índice a mano, saltándome los helpers, y exijo que se note.
  idx.unitsByRoute.get('R-1').add('FANTASMA');
  const err1 = idx.verificar();
  idx.unitsByRoute.get('R-1').delete('FANTASMA');
  idx.unitsByRoute.get('R-1').delete('A');            // ahora falta la de verdad
  const err2 = idx.verificar();
  ok('8. El verificador detecta una unidad de más y una de menos',
    typeof err1 === 'string' && typeof err2 === 'string', `${err1} | ${err2}`);
}
