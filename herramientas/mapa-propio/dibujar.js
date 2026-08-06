// Dibuja UNA tile raster de 256×256 a partir de los datos de OSM.
//
// No es un renderizador de cartografía general: es el mínimo que estas
// pantallas necesitan. El mapa de fondo de este sistema es a propósito
// callado —tres puntos y una línea encima son lo que importa—, así que acá
// van calles, agua, verde, rieles, pista de aterrizaje y nombres de
// barrios. Sin nombres de calle (v1): dibujarlos bien a lo largo de la vía
// es un proyecto en sí mismo, y las pantallas que los necesitan (trazar una
// ruta nueva) pueden seguir cayendo al proveedor con clave.
//
// Los dos estilos copian la paleta de los que ya usa el sistema
// (positron / dark-matter), para que mezclar tiles propias con tiles del
// proveedor en el mismo mapa no se note.

const TAM = 256;

// ─── PROYECCIÓN WEB MERCATOR ─────────────────────────────────
function lonAX(lon, z) { return ((lon + 180) / 360) * 2 ** z * TAM; }
function latAY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TAM;
}
// bbox geográfico de una tile (con un margen para que los trazos anchos que
// cruzan el borde no queden cortados)
function bboxDeTile(z, x, y, margen = 0.25) {
  const n = 2 ** z;
  const lonW = ((x - margen) / n) * 360 - 180;
  const lonE = ((x + 1 + margen) / n) * 360 - 180;
  const latDe = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [lonW, latDe(y + 1 + margen), lonE, latDe(y - margen)];
}

// ─── PALETAS ─────────────────────────────────────────────────
const PALETAS = {
  claro: {   // positron
    fondo: '#f7f7f5', agua: '#c9d4d6', aguaLinea: '#b8c9cc',
    verde: '#e5eede', viaRelleno: '#ffffff', viaBorde: '#d9d9d6',
    viaMenor: '#f2f0ec', riel: '#c9c4be', aero: '#e8e6e2',
    texto: '#8a8f94', textoHalo: 'rgba(255,255,255,.85)',
  },
  oscuro: {  // dark-matter
    fondo: '#0e1013', agua: '#12202e', aguaLinea: '#16283a',
    verde: '#131c15', viaRelleno: '#33373d', viaBorde: '#191b1e',
    viaMenor: '#24272b', riel: '#2a2d31', aero: '#1a1d21',
    texto: '#6b737b', textoHalo: 'rgba(14,16,19,.85)',
  },
};

// ─── CLASES DE VÍA ───────────────────────────────────────────
// Desde qué zoom se ve cada clase y qué ancho lleva. El ancho crece al
// acercarse: en z18 una avenida ocupa media cuadra de pantalla.
const VIAS = {
  motorway:      { desde: 11, ancho: z => 1.2 * 1.7 ** (z - 11) },
  trunk:         { desde: 11, ancho: z => 1.2 * 1.7 ** (z - 11) },
  primary:       { desde: 11, ancho: z => 1.0 * 1.65 ** (z - 11) },
  secondary:     { desde: 12, ancho: z => 1.0 * 1.6 ** (z - 12) },
  tertiary:      { desde: 13, ancho: z => 1.0 * 1.55 ** (z - 13) },
  residential:   { desde: 14, ancho: z => 0.8 * 1.6 ** (z - 14), menor: true },
  unclassified:  { desde: 14, ancho: z => 0.8 * 1.6 ** (z - 14), menor: true },
  living_street: { desde: 14, ancho: z => 0.8 * 1.6 ** (z - 14), menor: true },
  road:          { desde: 14, ancho: z => 0.8 * 1.6 ** (z - 14), menor: true },
  service:       { desde: 16, ancho: z => 0.8 * 1.5 ** (z - 16), menor: true },
  track:         { desde: 15, ancho: z => 0.7 * 1.4 ** (z - 15), menor: true },
  pedestrian:    { desde: 15, ancho: z => 0.8 * 1.5 ** (z - 15), menor: true },
  footway:       { desde: 17, ancho: z => 0.8 * 1.4 ** (z - 17), menor: true },
  path:          { desde: 17, ancho: z => 0.8 * 1.4 ** (z - 17), menor: true },
};
// Los enlaces se dibujan como su clase base
for (const c of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']) {
  VIAS[c + '_link'] = { ...VIAS[c], ancho: z => VIAS[c].ancho(z) * 0.7 };
}

// Desde qué zoom se ve cada tipo de lugar, y su tamaño de letra
const LUGARES = {
  city:          { desde: 11, hasta: 15, px: 15 },
  town:          { desde: 11, hasta: 16, px: 13 },
  suburb:        { desde: 13, hasta: 18, px: 12 },
  neighbourhood: { desde: 15, hasta: 18, px: 11 },
  village:       { desde: 12, hasta: 17, px: 12 },
  hamlet:        { desde: 14, hasta: 17, px: 11 },
};

// ─── DIBUJO ──────────────────────────────────────────────────
function trazar(ctx, coords, z, tx, ty, cerrar) {
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const px = lonAX(coords[i][0], z) - tx * TAM;
    const py = latAY(coords[i][1], z) - ty * TAM;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  if (cerrar) ctx.closePath();
}

// `capas` es lo que arma extraer.js: { vias, agua, aguaLineas, verde,
// rieles, aero, lugares }, cada una con [{coords|punto, clase|nombre}].
// `elegir(capa, bbox)` devuelve los elementos que tocan el bbox (índice).
function dibujarTile(createCanvas, capas, elegir, estilo, z, x, y) {
  const P = PALETAS[estilo];
  const canvas = createCanvas(TAM, TAM);
  const ctx = canvas.getContext('2d');
  const bb = bboxDeTile(z, x, y);
  ctx.fillStyle = P.fondo;
  ctx.fillRect(0, 0, TAM, TAM);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Verde y agua: rellenos, debajo de todo
  if (z >= 12) {
    ctx.fillStyle = P.verde;
    for (const f of elegir(capas.verde, bb)) { trazar(ctx, f.coords, z, x, y, true); ctx.fill(); }
  }
  ctx.fillStyle = P.agua;
  for (const f of elegir(capas.agua, bb)) { trazar(ctx, f.coords, z, x, y, true); ctx.fill(); }
  if (z >= 13) {
    ctx.strokeStyle = P.aguaLinea;
    ctx.lineWidth = Math.min(1 + (z - 13) * 0.7, 4);
    for (const f of elegir(capas.aguaLineas, bb)) { trazar(ctx, f.coords, z, x, y); ctx.stroke(); }
  }

  // Aeropuerto: la pista es un punto de referencia que se ve desde lejos
  if (z >= 12) {
    ctx.strokeStyle = P.aero;
    ctx.lineWidth = 2 * 1.5 ** Math.min(z - 12, 5);
    for (const f of elegir(capas.aero, bb)) { trazar(ctx, f.coords, z, x, y); ctx.stroke(); }
  }

  // Vías en dos pasadas (borde y relleno) para el efecto de "calle con
  // vereda" de positron. El borde solo desde z14: antes es ruido.
  const visibles = elegir(capas.vias, bb).filter(f => {
    const c = VIAS[f.clase];
    return c && z >= c.desde;
  });
  if (z >= 14) {
    for (const f of visibles) {
      const c = VIAS[f.clase];
      ctx.strokeStyle = P.viaBorde;
      ctx.lineWidth = Math.min(c.ancho(z), 46) + 2;
      trazar(ctx, f.coords, z, x, y);
      ctx.stroke();
    }
  }
  for (const f of visibles) {
    const c = VIAS[f.clase];
    ctx.strokeStyle = c.menor && z < 16 ? P.viaMenor : P.viaRelleno;
    ctx.lineWidth = Math.min(c.ancho(z), 46);
    trazar(ctx, f.coords, z, x, y);
    ctx.stroke();
  }

  // Rieles: Juliaca es ciudad de tren — línea punteada encima de las calles
  if (z >= 13) {
    ctx.strokeStyle = P.riel;
    ctx.lineWidth = Math.min(1 + (z - 13) * 0.6, 4);
    ctx.setLineDash([6, 4]);
    for (const f of elegir(capas.rieles, bb)) { trazar(ctx, f.coords, z, x, y); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // Nombres de barrios y localidades: orientan sin gritar
  for (const f of elegir(capas.lugares, bb)) {
    const t = LUGARES[f.clase];
    if (!t || z < t.desde || z > t.hasta) continue;
    const px = lonAX(f.punto[0], z) - x * TAM;
    const py = latAY(f.punto[1], z) - y * TAM;
    if (px < -60 || px > TAM + 60 || py < -20 || py > TAM + 20) continue;
    ctx.font = `${t.px}px DejaVu Sans, sans-serif`;
    ctx.textAlign = 'center';
    // Halo para que se lea sobre cualquier fondo, como hace todo mapa
    ctx.strokeStyle = P.textoHalo;
    ctx.lineWidth = 3;
    ctx.strokeText(f.nombre, px, py);
    ctx.fillStyle = P.texto;
    ctx.fillText(f.nombre, px, py);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { dibujarTile, bboxDeTile, lonAX, latAY, PALETAS, VIAS };
