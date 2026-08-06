// Las zonas del mapa propio. UNA ENTRADA POR CIUDAD: expandir a una
// provincia nueva es agregar una línea acá y correr `node extraer.js <zona>`.
// No hay nada más que tocar — el servidor sirve todo archivo .pmtiles que
// encuentre en su carpeta de tiles, y la cascada (fase 3) decide por bbox.
//
// bbox en [oeste, sur, este, norte] (el orden de lon/lat de GeoJSON).
// zooms [min, max]: 11-18 cubre de "toda la ciudad" a "esta cuadra".
module.exports = {
  juliaca: {
    nombre: 'Juliaca',
    // Cubre el Terminal Sur, la salida a Huancané y las periferias.
    // Validado por Gerson: las combis no salen de acá (2026-08).
    bbox: [-70.21, -15.56, -70.04, -15.41],
    zooms: [11, 18],
  },

  // ── Futuras (startup): descomentar, ajustar el bbox y correr ──────────
  // cusco:    { nombre: 'Cusco',    bbox: [-72.05, -13.60, -71.85, -13.45], zooms: [11, 18] },
  // arequipa: { nombre: 'Arequipa', bbox: [-71.65, -16.50, -71.40, -16.30], zooms: [11, 18] },
  // lapaz:    { nombre: 'La Paz',   bbox: [-68.25, -16.60, -68.00, -16.40], zooms: [11, 18] },
};
