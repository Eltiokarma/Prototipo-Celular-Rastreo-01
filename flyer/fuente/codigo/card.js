// Tarjeta de presentación Micros Tempo — 90 × 50 mm + 3 mm de sangrado por lado.
// Escala: 10 px = 1 mm. Lienzo 960 × 560. Corte en 30..930 × 30..530.
// Zona segura (3 mm dentro del corte): 60..900 × 60..500.
// Firma: las franjas del pintado de la combi (navy, azul, celeste, amarillo)
// subiendo en diagonal, igual que en el flyer.
const fs = require('fs');
const QR = require('qrcode');
const { f2, textW, esc } = require('./lib.js');
const { logoMark } = require('./combi.js');
const { wordmark } = require('./front.js');

const W = 960, H = 560, B = 30, S = 60;            // lienzo, sangrado, zona segura
const NAVY = '#0B2239', BLUE = '#2580CF', BLUE_TXT = '#1668C4', SKY = '#71BCFF',
  YEL = '#F5C542', GREEN = '#1E8A4C', INK = '#2A4864', MUTED = '#41627F', BG = '#E6EDF3';

// Datos de EJEMPLO (no reales)
const D = {
  nombre: 'Gerson Choquehuanca',
  cargo: 'Director',
  tel: '+51 951 234 567',
  mail: 'gerson@microstempo.com',
  web: 'microstempo.com',
  lugar: 'Juliaca · Puno',
  wa: 'https://wa.me/51951234567',
};

// Franjas del pintado: bandas paralelas que suben en diagonal hacia la derecha.
function livery(x0, yBase, len, rise, scale = 1) {
  const bands = [[NAVY, 9], [BLUE, 30], [SKY, 13], [YEL, 5]];
  let y = yBase, s = '';
  for (const [c, h] of bands) {
    const hh = h * scale;
    s += `<path d="M${x0} ${f2(y)}L${f2(x0 + len)} ${f2(y - rise)}V${f2(y - rise + hh)}L${x0} ${f2(y + hh)}Z" fill="${c}"/>`;
    y += hh;
  }
  return s;
}

function marks() {   // marcas de corte, fuera del área impresa (solo en la vista de prueba)
  const L = 14, g = 4; let d = '';
  for (const x of [B, W - B]) for (const y of [B, H - B]) {
    const sx = x === B ? -1 : 1, sy = y === B ? -1 : 1;
    d += `M${x} ${y + sy * g}v${sy * L}M${x + sx * g} ${y}h${sx * L}`;
  }
  return `<path d="${d}" stroke="#FF00AA" stroke-width="1.5"/>`;
}

// ---------- FRENTE: la marca ----------
function frente(guides) {
  const wm = wordmark(0, 0, 74, '#FFFFFF');
  const wx = (W - wm.w) / 2, wy = 268;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><radialGradient id="luz" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#173A5E"/><stop offset="1" stop-color="${NAVY}"/></radialGradient>
  <clipPath id="sangre"><rect width="${W}" height="${H}"/></clipPath></defs>
  <g clip-path="url(#sangre)">
  <rect width="${W}" height="${H}" fill="url(#luz)"/>
  ${livery(-20, 498, W + 40, 64, 1.05)}
  </g>
  <g transform="translate(${f2(wx)} ${wy})">${wm.svg}</g>
  <text x="${W / 2}" y="${wy + 62}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="27" letter-spacing=".4" fill="#C9DDF0">Minutos exactos entre combis</text>`;
  if (guides) s += marks();
  return s + '</svg>';
}

// ---------- DORSO: la persona y cómo contactarla ----------
const ICON = {
  wa: c => `<path d="M11 2A9 9 0 0 0 3.3 15.6L2 20l4.6-1.2A9 9 0 1 0 11 2Z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M7.6 7.4c.3-.7.7-.7 1-.7.3 0 .5.2.6.4l.8 1.9c.1.3 0 .6-.2.8l-.6.6c.6 1.2 1.6 2.2 2.8 2.8l.6-.6c.2-.2.5-.3.8-.2l1.9.8c.3.1.4.3.4.6 0 .3 0 .7-.7 1-.7.4-1.6.5-2.6.1-2.6-1-4.7-3.1-5.7-5.7-.4-1-.3-1.9.1-2.6Z" fill="${c}"/>`,
  mail: c => `<rect x="2" y="4.5" width="18" height="13" rx="2.5" fill="none" stroke="${c}" stroke-width="2"/><path d="M3 6l8 6 8-6" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`,
  web: c => `<circle cx="11" cy="11" r="9" fill="none" stroke="${c}" stroke-width="2"/><path d="M2 11h18M11 2c3 3 3 15 0 18M11 2c-3 3-3 15 0 18" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  pin: c => `<path d="M11 21s-7-6.4-7-11.5a7 7 0 0 1 14 0C18 14.6 11 21 11 21Z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><circle cx="11" cy="9.5" r="2.6" fill="${c}"/>`,
};

function dorso(guides) {
  const qr = QR.create(D.wa, { errorCorrectionLevel: 'M' });
  const N = qr.modules.size; let qd = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (qr.modules.get(x, y)) qd += `M${x} ${y}h1v1h-1z`;
  const QS = 204, qx = 900 - QS - 6, qy = 160;       // QR de 20,4 mm
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><clipPath id="sangre2"><rect width="${W}" height="${H}"/></clipPath></defs>
  <g clip-path="url(#sangre2)">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${livery(-20, 548, W + 40, 62, 0.7)}
  </g>
  <g transform="translate(66 118)">
    <text x="0" y="0" font-family="Poppins" font-weight="700" font-size="46" letter-spacing="-.6" fill="${NAVY}">${esc(D.nombre)}</text>
    <text x="2" y="44" font-family="Poppins" font-weight="600" font-size="25" letter-spacing="2.4" fill="${BLUE_TXT}">${D.cargo.toUpperCase()} · MICROS TEMPO</text>
  </g>
  <rect x="68" y="192" width="56" height="5" rx="2.5" fill="${BLUE}"/>`;
  const rows = [['wa', D.tel], ['mail', D.mail], ['web', D.web], ['pin', D.lugar]];
  rows.forEach(([ic, t], i) => {
    const y = 248 + i * 54;
    s += `<g transform="translate(66 ${y - 26}) scale(1.45)">${ICON[ic](NAVY)}</g>
    <text x="114" y="${y}" font-family="Poppins" font-weight="${i === 0 ? 600 : 500}" font-size="27" fill="${i === 0 ? NAVY : INK}">${esc(t)}</text>`;
  });
  s += `<rect x="${qx - 10}" y="${qy - 10}" width="${QS + 20}" height="${QS + 20}" rx="18" fill="#FFFFFF" stroke="#C9DCEB" stroke-width="2"/>
  <g transform="translate(${qx} ${qy}) scale(${f2(QS / N)})"><path d="${qd}" fill="${NAVY}" shape-rendering="crispEdges"/></g>
  <text x="${qx + QS / 2}" y="${qy + QS + 46}" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="24" fill="${NAVY}">Escríbame</text>
  <text x="${qx + QS / 2}" y="${qy + QS + 74}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="24" fill="${MUTED}">por WhatsApp</text>`;
  if (guides) s += marks();
  return s + '</svg>';
}

module.exports = { frente, dorso, D };
if (require.main === module) {
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/tarjeta-frente.svg', frente(false));
  fs.writeFileSync('out/tarjeta-dorso.svg', dorso(false));
  fs.writeFileSync('out/tarjeta-frente-guias.svg', frente(true));
  fs.writeFileSync('out/tarjeta-dorso-guias.svg', dorso(true));
}
