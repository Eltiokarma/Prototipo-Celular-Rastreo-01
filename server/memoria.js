// La memoria caliente: lo que el servidor sabe de la calle y sólo vive en
// memoria (PENDIENTES 0.12, 04/11).
//
// Las vueltas y los tramos en curso, los desvíos y las paradas abiertas, la
// presencia declarada de cada combi, la flota en vivo, la variante que
// Despacho activó a mano. Antes un reinicio —un deploy, un cuelgue— lo
// perdía todo: cada combi que volvía a mandar parecía «recién llegada», se le
// descartaba la vuelta a medias, y los desvíos y paradas abiertos se cerraban
// como «cortados». Un deploy en hora pico le tiraba la vuelta a cada combi.
//
// Ahora se saca una FOTO de esa memoria —cada pocos segundos y al apagar— a
// una fila de la base, y al arrancar, si la foto es reciente, se retoma tal
// cual. Lo que estaba viejo lo limpian las reglas de siempre (el olvido de
// los tres minutos, la poda), igual que si el servidor no se hubiera caído.
//
// Este módulo sólo guarda y lee: qué mapas son y cómo se vuelven a poner lo
// decide `index.js`, que es el que los tiene.

function crearTabla(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS memoria_caliente (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    guardadoEn INTEGER NOT NULL,
    motivo TEXT,
    datos TEXT NOT NULL
  )`);
}

// La foto de la vez anterior, si es de hace menos de `retomarMs`. Una foto
// más vieja es de otro momento del día: retomarla sería inventar.
function leerPrevia(db, { retomarMs, ahora = Date.now() } = {}) {
  if (!db) return null;
  crearTabla(db);
  const fila = db.prepare('SELECT guardadoEn, motivo, datos FROM memoria_caliente WHERE id = 1').get();
  if (!fila) return null;
  const edad = ahora - fila.guardadoEn;
  if (!(edad >= 0 && edad <= retomarMs)) {
    console.log(`Memoria caliente: la última es de hace ${Math.round(edad / 1000)} s, demasiado vieja para retomarla`);
    return null;
  }
  // Se usa UNA vez: un segundo arranque dentro de los 10 minutos (otro
  // cuelgue, o uno intermedio sin memoria) no vuelve a aplicar la misma foto
  // sobre lo que pasó después (revisión integral del 04/11).
  db.prepare('DELETE FROM memoria_caliente WHERE id = 1').run();
  try {
    const d = JSON.parse(fila.datos);
    return { guardadoEn: fila.guardadoEn, motivo: fila.motivo, mapas: d.mapas || {}, extra: d.extra || {} };
  } catch (e) {
    console.error('Memoria caliente: no se pudo leer la última foto:', e.message);
    return null;
  }
}

// Los ids de las filas que estaban ABIERTAS en la foto (desvíos, paradas,
// huecos de señal). El arranque cierra como «cortado» todo lo abierto; éstos
// no, porque se van a retomar.
function abiertosDe(previa) {
  const m = (previa && previa.mapas) || {};
  const ids = (entradas, de) => (entradas || []).map(([, v]) => de(v)).filter(n => Number.isInteger(n));
  return {
    desvios: ids(m.desvios, v => v && v.id),
    paradas: ids(m.paradasAbiertas, v => v),
    huecos: ids(m.huecosAbiertos, v => v && v.id),
  };
}

// Saca la foto. `mapas` = { nombre: Map }, `extra` = lo que no es un Map.
// Devuelve cuánto pesó y cuánto tardó, para el log.
function guardar(db, mapas, extra, { motivo = 'periodica', ahora = Date.now() } = {}) {
  const t0 = Date.now();
  const datos = JSON.stringify({
    v: 1,
    mapas: Object.fromEntries(Object.entries(mapas).map(([k, m]) => [k, [...m.entries()]])),
    extra,
  });
  db.prepare(`INSERT INTO memoria_caliente (id, guardadoEn, motivo, datos) VALUES (1, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET guardadoEn = excluded.guardadoEn, motivo = excluded.motivo, datos = excluded.datos`)
    .run(ahora, motivo, datos);
  return { bytes: datos.length, ms: Date.now() - t0 };
}

module.exports = { crearTabla, leerPrevia, abiertosDe, guardar };
