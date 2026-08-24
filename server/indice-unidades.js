'use strict';

// El mapa de unidades vivas, con un índice por ruta al lado.
//
// `units` es el Map plano de siempre (unitId → unidad); todo el resto del
// servidor lo lee igual que antes (`units.get/has/values/size`). Lo que se
// agrega es `unitsByRoute` (routeId → Set<unitId>), para que armar el estado de
// UNA ruta no tenga que barrer la flota entera. Sin él, `buildState` corría
// `Array.from(units.values()).filter(u => u.routeId === r)` cada 3 s por ruta:
// rutas × unidades por ciclo, cuadrático (medido en `herramientas/emision.js`:
// 6,2× de costo por 2,5× de flota).
//
// El índice sólo sirve si NUNCA se separa del mapa plano. Una unidad fantasma
// en un balde, o una que se cae del balde estando viva, es peor que el barrido
// lento: sale mal en el mapa de Despacho. Por eso la mutación pasa siempre por
// `poner`/`quitar` —nadie toca `units.set/.delete` por afuera— y el caso que
// obliga a centralizar, la unidad que CAMBIA de ruta, se resuelve en un solo
// lugar: se la saca del balde viejo antes de meterla en el nuevo.
//
// `verificar()` reconstruye el índice desde el mapa plano y lo compara: es la
// red que usa la suite `emision` para fuzzear set/delete/cambio-de-ruta y
// probar que los dos nunca divergen.
function crearIndiceUnidades() {
  const units = new Map();
  const unitsByRoute = new Map();

  function poner(id, obj) {
    const prev = units.get(id);
    if (prev && prev.routeId !== obj.routeId) {
      const s = unitsByRoute.get(prev.routeId);
      if (s) { s.delete(id); if (!s.size) unitsByRoute.delete(prev.routeId); }
    }
    units.set(id, obj);
    let s = unitsByRoute.get(obj.routeId);
    if (!s) { s = new Set(); unitsByRoute.set(obj.routeId, s); }
    s.add(id);
  }

  function quitar(id) {
    const prev = units.get(id);
    if (prev) {
      const s = unitsByRoute.get(prev.routeId);
      if (s) { s.delete(id); if (!s.size) unitsByRoute.delete(prev.routeId); }
    }
    units.delete(id);
  }

  // Las unidades de una ruta, por el índice. Salta las que ya no están en el
  // mapa plano por las dudas, aunque con `poner`/`quitar` eso no debería pasar.
  function deRuta(routeId) {
    const s = unitsByRoute.get(routeId);
    if (!s) return [];
    const out = [];
    for (const id of s) { const u = units.get(id); if (u) out.push(u); }
    return out;
  }

  // Reconstruye el índice desde cero y lo compara con el que se mantuvo.
  // Devuelve null si son idénticos, o una descripción de la primera diferencia.
  function verificar() {
    const esperado = new Map();
    for (const [id, u] of units) {
      let s = esperado.get(u.routeId);
      if (!s) { s = new Set(); esperado.set(u.routeId, s); }
      s.add(id);
    }
    // Baldes de más (rutas que quedaron en el índice pero ya no tienen unidad).
    for (const [routeId, s] of unitsByRoute) {
      if (s.size === 0) return `balde vacío no borrado: ${routeId}`;
      if (!esperado.has(routeId)) return `balde de más: ${routeId}`;
    }
    for (const [routeId, s] of esperado) {
      const real = unitsByRoute.get(routeId);
      if (!real) return `balde faltante: ${routeId}`;
      if (real.size !== s.size) return `${routeId}: índice tiene ${real.size}, deberían ser ${s.size}`;
      for (const id of s) if (!real.has(id)) return `${routeId}: falta ${id} en el índice`;
    }
    return null;
  }

  return { units, unitsByRoute, poner, quitar, deRuta, verificar };
}

module.exports = { crearIndiceUnidades };
