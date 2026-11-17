// Combi tipo Nissan Urvan NV350 techo alto, de costado, mirando a la derecha.
// Pintado de empresa Micros Tempo: franjas azul/celeste/amarillo, nombres de ruta,
// número de unidad, sticker de ruta y cinta reflectiva roja y blanca.
// Coordenadas locales: x 20..708, techo y≈22, piso de llanta y≈328.
const { f2 } = require('./lib.js');

const BODY = 'M27 62Q22 38 46 24L478 22Q500 23 513 38L650 124Q670 136 684 150Q694 160 697 190L706 238L708 276Q708 286 698 286L621 286A52 52 0 0 0 517 286L214 286A52 52 0 0 0 110 286L30 286Q20 286 20 276L20 90Q20 72 27 62Z';
const NAVY = '#0B2239', BLUE = '#2580CF', SKY = '#71BCFF', YEL = '#F5C542';

function wheel(cx, cy, id) {
  let s = `<circle cx="${cx}" cy="${cy}" r="46" fill="#15191E"/>
  <circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="#262D35" stroke-width="4"/>
  <circle cx="${cx}" cy="${cy}" r="28" fill="url(#${id}-rim)"/>`;
  for (let i = 0; i < 10; i++) {          // tapacubo con ranuras, como la foto
    const a = i * Math.PI / 5;
    s += `<path d="M${f2(cx + Math.cos(a) * 11)} ${f2(cy + Math.sin(a) * 11)}L${f2(cx + Math.cos(a + 0.12) * 24)} ${f2(cy + Math.sin(a + 0.12) * 24)}" stroke="#7F8B97" stroke-width="3.2" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="28" fill="none" stroke="#8592A0" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="8" fill="#D5DCE3" stroke="#7F8B97" stroke-width="2"/>
  <path d="M${cx - 32} ${cy - 20}A38 38 0 0 1 ${cx + 6} ${cy - 39}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="5" stroke-linecap="round"/>`;
  return s;
}

function defs(id) {
  return `
  <linearGradient id="${id}-body" x1="0" y1="20" x2="0" y2="288" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#F2F6F9"/>
    <stop offset=".85" stop-color="#DCE4EC"/><stop offset="1" stop-color="#C1CDD9"/></linearGradient>
  <linearGradient id="${id}-glass" x1="0" y1="70" x2="0" y2="148" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#16283A"/><stop offset=".6" stop-color="#2A4560"/><stop offset="1" stop-color="#466584"/></linearGradient>
  <radialGradient id="${id}-rim" cx=".4" cy=".35" r=".75">
    <stop offset="0" stop-color="#F4F6F8"/><stop offset=".7" stop-color="#BCC6D0"/><stop offset="1" stop-color="#909DAA"/></radialGradient>
  <filter id="${id}-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
  <linearGradient id="${id}-beam" x1="0" x2="1"><stop offset="0" stop-color="#FFF4C8" stop-opacity=".55"/><stop offset="1" stop-color="#FFF4C8" stop-opacity="0"/></linearGradient>
  <clipPath id="${id}-clip"><path d="${BODY}"/></clipPath>
  <filter id="${id}-sh" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="9"/></filter>`;
}

// apoyacabezas por la ventana
function seats(x0, x1, step = 46) {
  let s = '';
  for (let x = x0 + 18; x < x1 - 24; x += step)
    s += `<path d="M${x} 148V112Q${x} 100 ${x + 11} 100H${x + 20}Q${x + 31} 100 ${x + 31} 112V148Z" fill="#0E1C2A" opacity=".55"/>`;
  return s;
}

// franjas del pintado: suben en diagonal hacia adelante, como las combis de Juliaca
function stripe(y0, h, color, slant = 46) {
  const xEnd = 600;
  return `<path d="M0 ${y0}H${xEnd}L${xEnd + slant} ${y0 - slant * 0.55}V${y0 - slant * 0.55 + h}L${xEnd} ${y0 + h}H0Z" fill="${color}"/>`;
}

function reflective(x0, x1, y, h = 6, sq = 9) {
  let s = '';
  for (let x = x0, i = 0; x < x1; x += sq, i++)
    s += `<rect x="${f2(x)}" y="${y}" width="${f2(Math.min(sq, x1 - x))}" height="${h}" fill="${i % 2 ? '#FFFFFF' : '#D7263D'}"/>`;
  return `<g opacity=".95">${s}</g>`;
}

function combi(opts = {}) {
  const id = opts.id || 'c';
  const unit = opts.unit || '07';
  const route = opts.route || '18A';
  return `<g class="combi">
  <defs>${defs(id)}</defs>
  <ellipse cx="364" cy="326" rx="345" ry="11" fill="#1B2630" opacity=".45" filter="url(#${id}-sh)"/>
  <circle cx="162" cy="286" r="54" fill="#0B0F13"/>
  <circle cx="569" cy="286" r="54" fill="#0B0F13"/>
  <path d="${BODY}" fill="url(#${id}-body)"/>
  <g clip-path="url(#${id}-clip)">
    <!-- pintado Micros Tempo -->
    ${stripe(158, 9, NAVY)}
    ${stripe(167, 30, BLUE)}
    ${stripe(197, 13, SKY)}
    ${stripe(210, 5, YEL)}
    <path d="M0 0H720" stroke="#fff" stroke-width="0"/>
    <rect x="0" y="246" width="720" height="40" fill="#C9D4DF" opacity=".5"/>
    <path d="M24 226H640" stroke="#9FB0C1" stroke-width="1.6" opacity=".55"/>
    <path d="M46 26L476 24" stroke="#fff" stroke-width="5" opacity=".9"/>
  </g>
  <!-- nombres de la ruta sobre la franja azul -->
  <g transform="translate(232 188)">
    <g transform="translate(0 -15) scale(.17)"><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="9"/><path d="M50 4v12M50 84v12M4 50h12M84 50h12M50 50L38 34M50 50l15-17" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"/></g>
    <text x="22" y="0" font-family="Poppins" font-weight="600" font-size="17" fill="#FFFFFF">micros tempo</text>
  </g>
  <text x="56" y="187" font-family="Poppins" font-weight="700" font-style="italic" font-size="13" fill="#FFFFFF" letter-spacing=".5">Taparachi</text>
  <text x="400" y="187" font-family="Poppins" font-weight="700" font-style="italic" font-size="13" fill="#FFFFFF" letter-spacing=".5">Norte</text>
  <text x="80" y="208" font-family="Poppins" font-weight="600" font-size="9.5" fill="${NAVY}" letter-spacing="2">JULIACA · RUTA ${route}</text>
  <!-- vidrios: banda continua atrás, ventana de la puerta delantera -->
  <rect x="50" y="70" width="424" height="78" rx="16" fill="#0E1924"/>
  <rect x="58" y="76" width="160" height="66" rx="10" fill="url(#${id}-glass)"/>
  <rect x="228" y="76" width="66" height="66" rx="6" fill="url(#${id}-glass)"/>
  <rect x="304" y="76" width="162" height="66" rx="10" fill="url(#${id}-glass)"/>
  ${seats(58, 218)}${seats(304, 466)}
  <path d="M496 74H545L640 134V148H496Z" fill="url(#${id}-glass)"/><path d="M606 112L640 134V148H606Z" fill="#0E1924"/>
  <path d="M520 148V116Q520 104 532 104H546Q556 104 556 116V148Z" fill="#0E1C2A" opacity=".55"/>
  <path d="M546 70Q554 67 562 69L651 125Q648 131 641 131Z" fill="#1E3346"/>
  <g fill="#fff">
    <path d="M70 142L118 76H140L92 142Z" opacity=".12"/><path d="M240 142L270 100V118L256 142Z" opacity=".10"/>
    <path d="M320 142L368 76H388L340 142Z" opacity=".12"/><path d="M508 148L550 84H564L524 148Z" opacity=".12"/>
  </g>
  <!-- costuras, manijas -->
  <path d="M300 40V286M490 30Q486 160 494 286" stroke="#7E8FA0" stroke-width="2" fill="none" opacity=".7"/>
  <path d="M300 150H490" stroke="#55677A" stroke-width="3" opacity=".5"/>
  <rect x="470" y="228" width="20" height="7" rx="3.5" fill="${NAVY}"/>
  <rect x="512" y="228" width="20" height="7" rx="3.5" fill="${NAVY}"/>
  <!-- espejo, faro, parachoques negros, stop -->
  <path d="M624 136H638V143H624Z" fill="#1C2127"/><path d="M637 109Q651 107 656 116L657 134Q657 141 650 141H640Q635 141 635 136L635 113Q635 110 637 109Z" fill="${NAVY}"/><path d="M639 114Q648 112 652 118" stroke="#5B7690" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M697 180L770 160V232L699 208Z" fill="url(#${id}-beam)"/>
  <ellipse cx="686" cy="192" rx="22" ry="17" fill="#FFE59A" opacity=".9" filter="url(#${id}-glow)"/>
  <path d="M664 172Q684 172 694 182L698 208Q680 208 666 200Z" fill="#FFF7DA" stroke="#C9B26A" stroke-width="1.5"/>
  <path d="M668 178Q682 179 690 188" stroke="#fff" stroke-width="2.4" fill="none"/>
  <path d="M640 234H706L708 276Q708 288 696 288H640Z" fill="#1C2127"/>
  <path d="M20 216H52V288H30Q20 288 20 278Z" fill="#1C2127"/>
  <ellipse cx="22" cy="184" rx="14" ry="38" fill="#FF2E45" opacity=".85" filter="url(#${id}-glow)"/>
  <rect x="21" y="154" width="14" height="60" rx="4" fill="#F0263F"/>
  <rect x="23" y="158" width="6" height="52" rx="3" fill="#FF8A99"/><rect x="24" y="160" width="3" height="14" rx="1.5" fill="#FFE1E5"/>
  <!-- cinta reflectiva -->
  ${reflective(214, 517, 270)}${reflective(56, 110, 270)}${reflective(22, 50, 244, 6, 7)}
  <!-- número de unidad y sticker de ruta -->
  <circle cx="452" cy="250" r="15" fill="${YEL}" stroke="${NAVY}" stroke-width="2.5"/>
  <text x="452" y="256" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="14" fill="${NAVY}">${unit}</text>
  <rect x="64" y="82" width="42" height="21" rx="4" fill="${YEL}"/>
  <text x="85" y="98" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="14" fill="${NAVY}">${route}</text>
  ${wheel(162, 282, id)}${wheel(569, 282, id)}
  <path d="${BODY}" fill="none" stroke="${NAVY}" stroke-width="2.2" opacity=".5"/>
  </g>`;
}

// El reloj del logo (la "o" de micros tempo). Tamaño = s px, esquina sup-izq en 0,0.
function logoMark(s, color, sw = 8) {
  const k = s / 100;
  return `<g transform="scale(${f2(k)})"><circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="${sw}"/>
  <path d="M50 4v12M50 84v12M4 50h12M84 50h12M50 50L38 34M50 50l15-17" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" fill="none"/></g>`;
}

module.exports = { combi, logoMark };
