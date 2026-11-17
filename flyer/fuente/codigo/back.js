const fs = require('fs');
const QR = require('qrcode');
const { makeRng, makeNoise2D, fbm, f2, pathD, textW, esc, fPaper } = require('./lib.js');
const { logoMark } = require('./combi.js');
const { wordmark } = require('./front.js');

const W = 720, H = 1018;
const NAVY = '#0B2239', BLUE = '#2580CF', SKY = '#71BCFF';
const G_APP = '#1E8A4C', G_ON = '#3CCB7F', AMBER = '#F5B83D', RED = '#FF5A73';
const QR_URL = process.env.QR_URL || 'https://microstempo.com';

// ---------- mapa de calles generativo (Juliaca abstracta) con la ruta 18A ----------
function streetMap(seed) {
  const rng = makeRng(seed), noise = makeNoise2D(rng);
  const ang = -0.32, ca = Math.cos(ang), sa = Math.sin(ang);
  const warp = (u, v) => {
    const x = u * ca - v * sa + 360, y = u * sa + v * ca + 520;
    return [x + fbm(noise, x * 0.004, y * 0.004) * 60, y + fbm(noise, x * 0.004 + 7, y * 0.004) * 60];
  };
  let thin = '', thick = '';
  const step = 34;
  for (let v = -900; v <= 900; v += step) {
    const pts = []; for (let u = -900; u <= 900; u += 20) pts.push(warp(u, v));
    if (Math.abs(v) % (step * 4) === 0) thick += pathD(pts); else thin += pathD(pts);
  }
  for (let u = -900; u <= 900; u += step * 1.3) {
    if (rng.chance(0.18)) continue;
    const pts = []; for (let v = -900; v <= 900; v += 20) pts.push(warp(u, v));
    if (Math.abs(Math.round(u / (step * 1.3))) % 4 === 0) thick += pathD(pts); else thin += pathD(pts);
  }
  // ruta: curva suave que cruza la hoja
  const route = [];
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const x = 380 + t * 440 + Math.sin(t * Math.PI) * 60;
    const y = 1060 - t * 1000 + fbm(noise, t * 3, 4.2) * 40;
    route.push([x, y]);
  }
  // combis sobre la ruta, parejas por longitud de arco
  const L = []; let acc = 0;
  route.forEach((p, i) => { if (i) acc += Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]); L.push(acc); });
  const at = d => { let i = L.findIndex(l => l >= d); if (i < 1) i = 1; const t = (d - L[i - 1]) / (L[i] - L[i - 1]); return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t]; };
  let dots = '';
  for (let d = acc * 0.14; d < acc; d += acc / 7.5) {
    const [x, y] = at(d);
    dots += `<circle cx="${f2(x)}" cy="${f2(y)}" r="13" fill="#1668C4" opacity=".14"/><circle cx="${f2(x)}" cy="${f2(y)}" r="6" fill="#FFFFFF" stroke="#1668C4" stroke-width="3"/>`;
  }
  return `<g id="mapa">
    <path d="${thin}" stroke="#B3D7F0" stroke-width="1" fill="none"/>
    <path d="${thick}" stroke="#95C6EA" stroke-width="2.2" fill="none"/>
    <path d="${pathD(route)}" stroke="${BLUE}" stroke-width="12" fill="none" opacity=".18" stroke-linecap="round"/>
    <path d="${pathD(route)}" stroke="#1668C4" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${dots}</g>`;
}

// ---------- pantalla del chofer (tema DÍA, capturas del manual) ----------
function phone(x, y, w, h) {
  const r = 40, b = 10;
  const sx = x + b, sy = y + b, sw = w - 2 * b, sh = h - 2 * b;
  const P = 18; // padding interno
  let s = `<g id="celular">
  <rect x="${x - 2}" y="${y + 20}" width="${w + 4}" height="${h}" rx="${r}" fill="#0B2239" opacity=".35" filter="url(#phSh)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#0A1622"/>
  <rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="${r - 1}" fill="none" stroke="#3B5670" stroke-width="2"/>
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${r - b}"/></clipPath>
  <g clip-path="url(#scr)">
  <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="#F5F9FD"/>
  <rect x="${sx}" y="${sy}" width="${sw}" height="7" fill="${G_APP}"/>`;
  // barra de estado
  s += `<text x="${sx + 26}" y="${sy + 30}" font-family="Archivo" font-weight="700" font-size="12" fill="${NAVY}">9:41</text>
  <rect x="${sx + sw / 2 - 40}" y="${sy + 15}" width="80" height="22" rx="11" fill="#0A1622"/>
  <rect x="${sx + sw - 46}" y="${sy + 21}" width="20" height="10" rx="3" fill="none" stroke="${NAVY}" stroke-width="1.4"/>
  <rect x="${sx + sw - 44}" y="${sy + 23}" width="13" height="6" rx="1.5" fill="${NAVY}"/>`;
  // puntos de navegación + DÍA
  const cy0 = sy + 54;
  s += `<circle cx="${sx + sw / 2 - 22}" cy="${cy0}" r="3" fill="#B7C9DA"/><rect x="${sx + sw / 2 - 11}" y="${cy0 - 3.5}" width="22" height="7" rx="3.5" fill="${BLUE}"/><circle cx="${sx + sw / 2 + 22}" cy="${cy0}" r="3" fill="#B7C9DA"/>
  <rect x="${sx + sw - P - 30}" y="${cy0 - 9}" width="30" height="18" rx="4" fill="none" stroke="#C3D2E0"/>
  <text x="${sx + sw - P - 15}" y="${cy0 + 4}" text-anchor="middle" font-family="Archivo" font-weight="700" font-size="8.5" letter-spacing=".8" fill="#41627F">DÍA</text>`;
  // EN VIVO · 7 / 28 km/h
  const y1 = sy + 88;
  s += `<circle cx="${sx + P + 3}" cy="${y1 - 4}" r="3.2" fill="${G_APP}"/>
  <text x="${sx + P + 11}" y="${y1}" font-family="Archivo" font-weight="700" font-size="10.5" letter-spacing="1.3" fill="#2A4864">EN VIVO · 7</text>
  <text x="${sx + sw - P}" y="${y1 + 1}" text-anchor="end" font-family="Archivo" font-size="10" fill="#2A4864"><tspan font-family="Archivo Black" font-size="17" fill="${NAVY}">28</tspan> km/h</text>`;
  // brecha grande
  const y2 = sy + 168;
  s += `<text x="${sx + P}" y="${y2}" font-family="Archivo" font-weight="800" font-size="15" letter-spacing="1.2" fill="${G_APP}">ATRÁS <tspan font-weight="500" font-size="11" letter-spacing=".4" fill="#41627F">−1 · M-02</tspan></text>
  <text x="${sx + P - 3}" y="${y2 + 70}" font-family="Archivo Black" font-size="80" letter-spacing="-2" fill="${G_APP}">6:15</text>
  <text x="${sx + P}" y="${y2 + 98}" font-family="Archivo" font-size="12" fill="#2A4864">Mantené el ritmo. Objetivo 6:00.</text>
  <rect x="${sx + P}" y="${y2 + 116}" width="${sw - 2 * P}" height="1" fill="#C9D6E2"/>
  <text x="${sx + P}" y="${y2 + 142}" font-family="Archivo" font-weight="800" font-size="12.5" letter-spacing="1" fill="${G_APP}">ADELANTE <tspan font-weight="500" font-size="10" letter-spacing=".4" fill="#41627F">+1 · M-03</tspan></text>
  <text x="${sx + P - 1}" y="${y2 + 180}" font-family="Archivo Black" font-size="40" letter-spacing="-1" fill="${G_APP}">6:01</text>
  <text x="${sx + sw - P}" y="${y2 + 172}" text-anchor="end" font-family="Archivo" font-weight="700" font-size="10" fill="#2A4864">OK</text>`;
  // botones
  const bw = sw - 2 * P, y3 = sy + sh - 150;
  s += `<rect x="${sx + P}" y="${y3}" width="${bw}" height="30" rx="7" fill="none" stroke="#B8860B" stroke-width="1.3"/>
  <text x="${sx + sw / 2}" y="${y3 + 19}" text-anchor="middle" font-family="Archivo" font-weight="800" font-size="8.5" letter-spacing="1" fill="#9A6C00">ESTOY EN TRÁFICO</text>
  <rect x="${sx + P}" y="${y3 + 38}" width="${bw * 0.42}" height="30" rx="7" fill="none" stroke="#B8860B" stroke-width="1.3"/>
  <text x="${sx + P + bw * 0.21}" y="${y3 + 57}" text-anchor="middle" font-family="Archivo" font-weight="800" font-size="8.5" letter-spacing="1" fill="#9A6C00">AUSENTE</text>
  <rect x="${sx + P + bw * 0.45}" y="${y3 + 38}" width="${bw * 0.55}" height="30" rx="7" fill="none" stroke="#C3D2E0" stroke-width="1.3"/>
  <text x="${sx + P + bw * 0.725}" y="${y3 + 57}" text-anchor="middle" font-family="Archivo" font-weight="800" font-size="8.5" letter-spacing="1" fill="#2A4864">SALIR DE RUTA</text>
  <rect x="${sx + P}" y="${y3 + 78}" width="${bw}" height="48" rx="10" fill="#E8EFF7" stroke="#C3D2E0"/>
  <rect x="${sx + P + 4}" y="${y3 + 82}" width="44" height="40" rx="8" fill="#C8102E"/>
  <text x="${sx + P + 26}" y="${y3 + 106}" text-anchor="middle" font-family="Archivo Black" font-size="12" fill="#fff">SOS</text>
  <text x="${sx + P + 60}" y="${y3 + 106}" font-family="Archivo" font-weight="700" font-size="11" fill="#2A4864">DESLIZÁ PARA SOS</text>
  <path d="M${sx + P + 170} ${y3 + 102}h10m-4 -4l4 4l-4 4" stroke="#2A4864" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${sx + sw / 2 - 50}" y="${sy + sh - 12}" width="100" height="4" rx="2" fill="#0B2239" opacity=".35"/>
  </g>
  <path d="M${x + w} ${y + 120}v44M${x} ${y + 110}v30M${x} ${y + 150}v50" stroke="#0A1622" stroke-width="5" stroke-linecap="round"/>
  </g>`;
  return s;
}

// íconos simples, trazo 2.4, en una caja de 22
const ICON = {
  brecha: c => `<path d="M2 11h18M6 7l-4 4 4 4M16 7l4 4-4 4" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  sos: c => `<rect x="1" y="5" width="20" height="12" rx="6" fill="none" stroke="${c}" stroke-width="2.2"/><rect x="3.5" y="7.5" width="7" height="7" rx="3.5" fill="${c}"/><path d="M13 11h5m-2-2 2 2-2 2" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  trafico: c => `<rect x="7" y="1" width="8" height="20" rx="4" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="11" cy="6" r="1.8" fill="${c}"/><circle cx="11" cy="11" r="1.8" fill="${c}"/><circle cx="11" cy="16" r="1.8" fill="${c}"/>`,
  chat: c => `<path d="M3 4h16v11H9l-5 4v-4H3Z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/><path d="M7 9h8M7 12h5" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`,
  atasco: c => `<path d="M11 21C11 21 3 13.5 3 8.5A8 8 0 0 1 19 8.5C19 13.5 11 21 11 21Z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="11" cy="8.5" r="4.2" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M11 6.3V8.5L12.6 9.8" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  pantalla: c => `<rect x="5" y="1" width="12" height="20" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M11 7v4M8.2 9.2a4 4 0 1 0 5.6 0" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
};

function build(seed = 4) {
  const qr = QR.create(QR_URL, { errorCorrectionLevel: 'M' });
  const N = qr.modules.size; let qd = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (qr.modules.get(x, y)) qd += `M${x} ${y}h1v1h-1z`;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${fPaper('paper2', seed + 30, 0.8, 0.12, W, H)}
<filter id="phSh" x="-30%" y="-20%" width="160%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
<radialGradient id="glow" cx="0.72" cy="0.38" r="0.55"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".9"/><stop offset="1" stop-color="#D6ECFA" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#D6ECFA" stop-opacity=".92"/><stop offset=".55" stop-color="#D6ECFA" stop-opacity=".6"/><stop offset="1" stop-color="#D6ECFA" stop-opacity="0"/></linearGradient>
</defs>
<g id="fondo" filter="url(#paper2)"><rect width="${W}" height="${H}" fill="#D6ECFA"/>
${streetMap(seed)}
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect width="430" height="${H}" fill="url(#fade)"/></g>`;

  const wm = wordmark(0, 0, 24, NAVY);
  svg += `<g transform="translate(48 70)">${wm.svg}</g>
  <rect x="${W - 48 - 118}" y="48" width="118" height="30" rx="15" fill="none" stroke="#1668C4" stroke-opacity=".7" stroke-width="1.5"/>
  <text x="${W - 48 - 59}" y="68" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="11.5" letter-spacing="1.2" fill="#1668C4">APP ANDROID</text>`;

  // titular
  svg += `<text x="48" y="160" font-family="Poppins" font-weight="700" font-size="13.5" letter-spacing="2.2" fill="#1668C4">LA APP DE LOS MICROS</text>
  <text x="46" y="218" font-family="Poppins" font-weight="800" font-size="50" letter-spacing="-1" fill="${NAVY}">Su distancia,</text>
  <text x="46" y="270" font-family="Poppins" font-weight="800" font-size="50" letter-spacing="-1" fill="#1668C4">en grande.</text>`;
  [['', 'Minutos exactos', ' con las combis de alrededor.'], ['Con ', 'mapa, chat e historial', ' de vueltas.']].forEach(([p, k, q], i) =>
    svg += `<text x="48" y="${318 + i * 26}" font-family="Poppins" font-weight="500" font-size="15" fill="#2A4864">${esc(p)}<tspan font-weight="700" fill="${NAVY}">${esc(k)}</tspan>${esc(q)}</text>`);

  // semáforo de la brecha
  const sem = [['#1E8A4C', 'EN OBJETIVO', 'buena distancia'], ['#A86F00', 'AL LÍMITE', 'se aproxima'], ['#D62845', 'CRÍTICA', 'unidad cercana a ti']];
  sem.forEach(([c, w, d], i) => {
    const y = 404 + i * 34;
    svg += `<rect x="48" y="${y - 15}" width="8" height="22" rx="4" fill="${c}"/>
    <text x="66" y="${y + 1}" font-family="Poppins" font-weight="700" font-size="13" letter-spacing="1.1" fill="${c}">${w}</text>
    <text x="${66 + textW(w, 'p700', 13, 1.1) + 10}" y="${y + 1}" font-family="Poppins" font-size="13.5" fill="#41627F">${d}</text>`;
  });

  // lo que trae
  const feats = [['brecha', 'Brecha en vivo, con color y palabra'], ['pantalla', 'Sigue con la pantalla apagada'], ['chat', 'Chat con la ruta y con la Central'], ['trafico', '«Estoy en tráfico» avisa a la ruta'], ['sos', 'SOS, botón de emergencias'], ['atasco', 'Recuerda tiempos y lugares de embotellamiento']];
  svg += `<text x="48" y="532" font-family="Poppins" font-weight="700" font-size="13.5" letter-spacing="2.2" fill="#1668C4">LO QUE TRAE</text>`;
  feats.forEach(([ic, t], i) => {
    const y = 554 + i * 43;
    svg += `<rect x="48" y="${y}" width="34" height="34" rx="10" fill="${BLUE}"/>
    <g transform="translate(54 ${y + 6})">${ICON[ic]('#FFFFFF')}</g>
    <text x="96" y="${y + 23}" font-family="Poppins" font-weight="500" font-size="15" fill="${NAVY}">${esc(t)}</text>`;
  });

  svg += phone(410, 122, 262, 560);
  // detalle de nota bajo el celular
  svg += `<text x="470" y="716" text-anchor="middle" font-family="Poppins" font-size="11.5" fill="#41627F">La pantalla real, en ruta.</text>`;

  // tarjeta inferior: QR + Play + contacto
  const cy = 836, ch = 136;
  svg += `<rect x="48" y="${cy}" width="${W - 96}" height="${ch}" rx="22" fill="${NAVY}"/>
  <g id="qr-pendiente">
  <rect x="64" y="${cy + 14}" width="108" height="108" rx="12" fill="#FFF7E0" stroke="#A67300" stroke-width="2.5" stroke-dasharray="7 5"/>
  <path d="M84 ${cy + 34}h14M84 ${cy + 34}v14M152 ${cy + 34}h-14M152 ${cy + 34}v14M84 ${cy + 102}h14M84 ${cy + 102}v-14M152 ${cy + 102}h-14M152 ${cy + 102}v-14" stroke="#A67300" stroke-width="3" stroke-linecap="round" fill="none"/>
  <text x="118" y="${cy + 64}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="20" fill="#A67300">QR</text>
  <text x="118" y="${cy + 82}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="10.5" letter-spacing=".8" fill="#A67300">PENDIENTE</text>
  <text x="118" y="${cy + 96}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="8.5" fill="#7A5600">no imprimir</text>
  </g>
  <text x="192" y="${cy + 44}" font-family="Poppins" font-weight="800" font-size="22" fill="#FFFFFF">Escanee e instale</text>
  <text x="192" y="${cy + 68}" font-family="Poppins" font-size="14" fill="#C9DDF0">Gratis para el chofer y el cobrador.</text>
  <g transform="translate(192 ${cy + 84})">
    <rect width="150" height="38" rx="9" fill="#D6ECFA"/>
    <g transform="translate(12 7)"><path d="M1.5 1.2 13.4 13 1.5 24.8Q1 24.4 1 23.6V2.4Q1 1.6 1.5 1.2Z" fill="#2E9DFF"/><path d="M1.5 1.2Q2.2.6 3.2 1.2L17.6 9.3 13.4 13Z" fill="#3DD685"/><path d="M1.5 24.8Q2.2 25.4 3.2 24.8L17.6 16.7 13.4 13Z" fill="#FF4D6D"/><path d="M17.6 9.3 22 11.8Q23.4 13 22 14.2L17.6 16.7 13.4 13Z" fill="#F5C542"/></g>
    <text x="44" y="15" font-family="Poppins" font-weight="500" font-size="8" letter-spacing=".6" fill="${NAVY}">DISPONIBLE EN</text>
    <text x="44" y="31" font-family="Poppins" font-weight="700" font-size="15" fill="${NAVY}">Google Play</text></g>
  <text x="${W - 70}" y="${cy + 98}" text-anchor="end" font-family="Poppins" font-weight="600" font-size="13.5" fill="#FFFFFF">soporte@microstempo.com</text>
  <text x="${W - 70}" y="${cy + 118}" text-anchor="end" font-family="Poppins" font-size="13.5" fill="#C9DDF0">microstempo.com</text>
  <text x="${W / 2}" y="${H - 18}" text-anchor="middle" font-family="Poppins" font-size="10.5" fill="#41627F">Control de flota para combis y micros · Perú</text>
</svg>`;
  return svg;
}

if (require.main === module) {
  const seed = +(process.argv[2] || 4);
  fs.writeFileSync(`out/dorso-${seed}.svg`, build(seed));
}
module.exports = { build };
