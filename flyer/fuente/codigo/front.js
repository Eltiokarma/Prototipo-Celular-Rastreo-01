const fs = require('fs');
const { makeRng, makeNoise2D, fbm, f2, pathD, textW, esc, mix, fPaper, fNebula } = require('./lib.js');
const { combi, logoMark } = require('./combi.js');

const W = 720, H = 1018;
const NAVY = '#0B2239', INK = '#2A4864', BLUE = '#2580CF', GREEN = '#1E8A4C', PAPER = '#F5F3EE';

// ---------- logotipo "micros tempo" con los relojes en las o ----------
function wordmark(x, y, size, color) {
  const parts = ['micr', 'O', 's temp', 'O'];
  let cx = x, s = '';
  for (const p of parts) {
    if (p === 'O') {
      const d = size * 0.62;
      s += `<g transform="translate(${f2(cx + size * 0.05)} ${f2(y - d * 0.92)})">${logoMark(d, color, 9)}</g>`;
      cx += d + size * 0.11;
    } else {
      s += `<text x="${f2(cx)}" y="${y}" font-family="Poppins" font-weight="600" font-size="${size}" fill="${color}" xml:space="preserve">${p}</text>`;
      cx += textW(p, 'p600', size) - (p.endsWith('r') ? size * 0.05 : size * 0.0);
    }
  }
  return { svg: s, w: cx - x };
}

// ---------- escena del altiplano ----------
function scene(seed, IW, IH) {
  const rng = makeRng(seed), noise = makeNoise2D(rng);
  const HZ = 176;                       // horizonte
  let s = `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="${HZ}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2F76BC"/><stop offset=".55" stop-color="#7DB6E2"/><stop offset="1" stop-color="#DCEBF4"/></linearGradient>
  <linearGradient id="pampa" x1="0" y1="${HZ}" x2="0" y2="${IH}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#D9CBA2"/><stop offset=".5" stop-color="#C4A86C"/><stop offset="1" stop-color="#9C7F45"/></linearGradient>
  <linearGradient id="road" x1="0" y1="250" x2="0" y2="304" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#59626C"/><stop offset="1" stop-color="#3B434C"/></linearGradient>
  <filter id="cloud1" x="-40%" y="-80%" width="180%" height="260%"><feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="4" seed="${seed + 1}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="2.2"/></filter>
  <filter id="cloud2" x="-40%" y="-80%" width="180%" height="260%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="${seed + 2}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="2.6"/></filter>
  </defs>
  <rect width="${IW}" height="${HZ + 4}" fill="url(#sky)"/>`;

  // nubes de altura: masas planas abajo, crecidas arriba (cúmulos del altiplano)
  const clouds = [[110, 58, 120, 26, 'cloud1'], [600, 40, 150, 30, 'cloud2'], [380, 92, 90, 16, 'cloud1']];
  for (const [cx, cy, rx, ry, f] of clouds) {
    s += `<g filter="url(#${f})" opacity=".92"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff"/>
      <ellipse cx="${cx - rx * 0.3}" cy="${cy - ry * 0.8}" rx="${rx * 0.45}" ry="${ry * 0.9}" fill="#fff"/>
      <ellipse cx="${cx + rx * 0.25}" cy="${cy - ry * 0.6}" rx="${rx * 0.4}" ry="${ry * 0.8}" fill="#fff"/></g>
      <ellipse cx="${cx}" cy="${cy + ry * 0.7}" rx="${rx * 0.8}" ry="${ry * 0.25}" fill="#B9D3E8" opacity=".5" filter="url(#${f})"/>`;
  }

  // cerros de ichu alrededor de Juliaca: lomas redondeadas, color de pasto seco,
  // apagadas y desenfocadas por la distancia (sin nevados)
  const ridge = (base, amp, fr, off, step = 4, oct = 3) => {
    const pts = [];
    for (let x = -10; x <= IW + 10; x += step) { const r = 0.5 + fbm(noise, x * fr + off, off, oct) * 1.6; pts.push([x, base - Math.max(0, r) ** 1.4 * amp - amp * 0.1]); }
    return pts;
  };
  s += `<defs>
    <linearGradient id="cerroLejos" x1="0" y1="${HZ - 130}" x2="0" y2="${HZ + 4}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#A39675"/><stop offset="1" stop-color="#8E7E58"/></linearGradient>
    <linearGradient id="cerroCerca" x1="0" y1="${HZ - 80}" x2="0" y2="${HZ + 8}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#857246"/><stop offset="1" stop-color="#6F5D38"/></linearGradient>
    <filter id="lejania" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="1.8"/></filter>
    <filter id="lejania2" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="0.9"/></filter>
  </defs>`;
  const far = ridge(HZ - 10, 115, 0.0042, 3.1, 4);
  s += `<path d="${pathD(far)}L${IW + 10} ${HZ + 4}L-10 ${HZ + 4}Z" fill="url(#cerroLejos)" filter="url(#lejania)"/>`;
  // velo de aire sobre los cerros lejanos (perspectiva atmosférica)
  s += `<path d="${pathD(far)}L${IW + 10} ${HZ + 4}L-10 ${HZ + 4}Z" fill="#C9DAE8" opacity=".22" filter="url(#lejania)"/>`;
  const mid = ridge(HZ + 2, 66, 0.0068, 11.4, 4);
  const midD = pathD(mid) + `L${IW + 10} ${HZ + 8}L-10 ${HZ + 8}Z`;
  s += `<g filter="url(#lejania2)"><path d="${midD}" fill="url(#cerroCerca)"/>`;
  // vetas de ichu en las laderas, recortadas a la silueta
  s += `<clipPath id="midc"><path d="${midD}"/></clipPath><g clip-path="url(#midc)">`;
  let vet = '';
  for (let i = 0; i < 40; i++) {
    const x = rng.range(-10, IW), y = rng.range(HZ - 40, HZ + 6), w = rng.range(20, 70);
    vet += `M${f2(x)} ${f2(y)}q${f2(w / 2)} ${f2(rng.range(-3, 3))} ${f2(w)} ${f2(rng.range(-2, 4))}`;
  }
  s += `<path d="${vet}" stroke="#B39A62" stroke-width="2" fill="none" opacity=".35" stroke-linecap="round"/></g></g>`;

  // suelo de la ciudad (polvo de calle)
  s += `<rect y="${HZ}" width="${IW}" height="${IH - HZ}" fill="#B9B1A0"/>`;
  // ---- Juliaca: tres filas de edificios de ladrillo, tarrajeo, vidrio azul espejado ----
  const HAZE = '#C6D6E4';
  const RT0 = 252;
  const rows = [
    { base: HZ + 16, hmin: 12, hmax: 40, wmin: 12, wmax: 30, t: 0.62, k: 0.45 },
    { base: HZ + 44, hmin: 30, hmax: 86, wmin: 20, wmax: 44, t: 0.36, k: 0.7 },
    { base: RT0 - 5, hmin: 70, hmax: 140, wmin: 34, wmax: 70, t: 0.12, k: 1.0 },
  ];
  const kinds = [['brick', 0.52], ['plaster', 0.24], ['glass', 0.12], ['raw', 0.12]];
  const pickKind = () => { let r = rng(), acc = 0; for (const [k, p] of kinds) { acc += p; if (r < acc) return k; } return 'brick'; };
  const plaster = ['#E6D3A8', '#D9A69C', '#A9C7D8', '#E3B97A', '#C9D3A4', '#EFE6D6'];
  let cityS = '';
  s += `<defs>${[1.1, 0.8, 0.55].map((d, i) => `<filter id="cityBlur${i}" x="-2%" y="-10%" width="104%" height="120%"><feGaussianBlur stdDeviation="${d}"/></filter>`).join('')}</defs>`;
  rows.forEach((R, ri) => {
    const fogC = c => mix(c, HAZE, R.t);
    let x = -20 + rng.range(0, 20);
    let row = '';
    while (x < IW + 20) {
      const w = rng.range(R.wmin, R.wmax);
      let h = R.hmin + (R.hmax - R.hmin) * Math.min(1, Math.pow(rng(), 1.6) * 1.15);
      const kind = pickKind();
      const top = R.base - h;
      const base = kind === 'brick' ? rng.pick(['#B4583A', '#A84F33', '#BF6A45', '#9E4A30'])
        : kind === 'plaster' ? rng.pick(plaster) : kind === 'glass' ? '#3F7FB8' : '#A3A39C';
      let b = `<rect x="${f2(x)}" y="${f2(top)}" width="${f2(w)}" height="${f2(h + 2)}" fill="${fogC(base)}"/>`;
      // canto oscuro a la izquierda: separa edificios pegados
      b += `<rect x="${f2(x)}" y="${f2(top)}" width="${f2(Math.max(1.2, 3 * R.k))}" height="${f2(h + 2)}" fill="${fogC('#3A2A22')}" opacity=".35"/>`;
      if (kind === 'brick' && ri === 2) b += `<rect x="${f2(x)}" y="${f2(top)}" width="${f2(w)}" height="${f2(h)}" fill="url(#brick)" opacity=".5"/>`;
      // ventanas por piso
      const fh = 13 * R.k, floors = Math.max(1, Math.floor(h / fh));
      const cols = Math.max(1, Math.floor(w / (11 * R.k)));
      const ww = w / cols;
      for (let f = (ri === 2 ? 1 : 0); f < floors; f++) {
        const wy = R.base - (f + 1) * fh + fh * 0.25;
        if (wy < top + 2) continue;
        if (kind === 'glass') {
          b += `<rect x="${f2(x + 2)}" y="${f2(wy - fh * 0.15)}" width="${f2(w - 4)}" height="${f2(fh * 0.85)}" fill="${fogC(f % 2 ? '#6FA8D8' : '#5592C8')}"/>`;
          continue;
        }
        for (let c = 0; c < cols; c++) {
          if (rng.chance(0.12)) continue;
          const lit = rng.chance(0.25);
          b += `<rect x="${f2(x + c * ww + ww * 0.25)}" y="${f2(wy)}" width="${f2(ww * 0.5)}" height="${f2(fh * 0.5)}" fill="${fogC(lit ? '#7FB2DA' : '#2B3A48')}"/>`;
        }
      }
      // primer piso de la fila cercana: tiendas con persiana metálica y letrero
      if (ri === 2) {
        const sh = fh * 0.95, sy = R.base - sh;
        const doors = Math.max(1, Math.floor(w / 26));
        for (let d = 0; d < doors; d++) {
          const dx = x + 3 + d * (w - 6) / doors, dw = (w - 6) / doors - 3;
          b += `<rect x="${f2(dx)}" y="${f2(sy)}" width="${f2(dw)}" height="${f2(sh)}" fill="#8F969C"/>`;
          for (let ly = sy + 2; ly < R.base; ly += 2.2) b += `<path d="M${f2(dx)} ${f2(ly)}h${f2(dw)}" stroke="#6E757B" stroke-width=".6"/>`;
        }
        if (rng.chance(0.6)) b += `<rect x="${f2(x + 3)}" y="${f2(sy - 6)}" width="${f2(w - 6)}" height="5" fill="${rng.pick(['#E2463E', '#F2C230', '#2E7BC4', '#3AA35B', '#FFFFFF'])}"/>`;
      }
      // azotea: fierros de construcción y tanque de agua negro
      const roof = fogC('#2B2B2B');
      if (kind !== 'glass' && rng.chance(0.65)) {
        let rb = '';
        const n = rng.int(3, 6);
        for (let i = 0; i < n; i++) { const rx = x + 2 + (w - 4) * i / (n - 1); rb += `M${f2(rx)} ${f2(top)}v${f2(-rng.range(3, 7) * R.k)}`; }
        b += `<path d="${rb}" stroke="${roof}" stroke-width="${f2(0.6 + 0.5 * R.k)}" opacity=".8"/>`;
      }
      if (kind === 'raw' && ri > 0) {
        // piso a medio construir: solo columnas
        const ch = fh * 0.95;
        b += `<path d="M${f2(x + 1)} ${f2(top)}v${f2(-ch)}M${f2(x + w / 2)} ${f2(top)}v${f2(-ch)}M${f2(x + w - 1)} ${f2(top)}v${f2(-ch)}" stroke="${fogC('#8E8E88')}" stroke-width="${f2(2.4 * R.k)}"/>
          <path d="M${f2(x)} ${f2(top - ch)}h${f2(w)}" stroke="${roof}" stroke-width=".6" opacity=".7"/>`;
      }
      if (rng.chance(0.45)) {
        const tw = 6 * R.k, th = 7 * R.k, tx = x + rng.range(2, Math.max(3, w - tw - 2));
        b += `<rect x="${f2(tx)}" y="${f2(top - th)}" width="${f2(tw)}" height="${f2(th)}" rx="${f2(tw * 0.35)}" fill="${fogC('#1B1D20')}"/>`;
      }
      row += b;
      x += w * rng.range(0.82, 1.08);
    }
    cityS += `<g filter="url(#cityBlur${ri})">${row}</g>`;
  });
  s += `<defs><pattern id="brick" width="8" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H8M0 2H8M2 0V2M6 2V4" stroke="#6B2E1C" stroke-width=".5"/></pattern></defs>` + cityS;
  // postes y cables de luz
  let poles = '', cables = '';
  const px = []; for (let x = 40; x < IW; x += rng.range(150, 200)) px.push(x);
  for (const x of px) poles += `<path d="M${f2(x)} ${RT0}V${RT0 - 104}M${f2(x - 9)} ${RT0 - 98}h18" stroke="#3E4247" stroke-width="2.4" stroke-linecap="round"/>`;
  for (let i = 0; i < px.length - 1; i++) for (const dy of [-98, -92]) {
    const x1 = px[i], x2 = px[i + 1], y = RT0 + dy;
    cables += `M${f2(x1 - 7)} ${y}Q${f2((x1 + x2) / 2)} ${y + 12} ${f2(x2 - 7)} ${y}`;
  }
  s += `<path d="${cables}" stroke="#2E3236" stroke-width=".9" fill="none" opacity=".75"/>${poles}`;
  // vereda
  s += `<rect x="-10" y="${RT0 - 6}" width="${IW + 20}" height="6" fill="#CFC9BC"/>`;

  // pista
  const RT = 252, RB = 304;
  s += `<path d="M-10 ${RT}H${IW + 10}V${RB}H-10Z" fill="url(#road)"/>
  <path d="M-10 ${RT}H${IW + 10}" stroke="#8E8A80" stroke-width="3"/>
  <path d="M-10 ${RB}H${IW + 10}" stroke="#7B6A44" stroke-width="2"/>`;
  let dash = '';
  for (let x = -20; x < IW + 20; x += 46) dash += `M${x} 281h24`;
  s += `<path d="${dash}" stroke="#EDE6D0" stroke-width="3" opacity=".75"/>`;

  // ichu en la berma de atrás (chico) y adelante (grande)
  const tufts = (y0, y1, n, hmin, hmax, cols, op) => {
    let d = {};
    for (const c of cols) d[c] = '';
    for (let i = 0; i < n; i++) {
      const x = rng.range(-10, IW + 10), y = rng.range(y0, y1);
      const k = (y - y0) / Math.max(1, y1 - y0);
      const h = hmin + (hmax - hmin) * (0.4 + 0.6 * k) * rng.range(0.6, 1.1);
      const c = rng.pick(cols), blades = rng.int(5, 9);
      for (let b = 0; b < blades; b++) {
        const a = -Math.PI / 2 + rng.gauss(0, 0.32) + fbm(noise, x * 0.01, 50) * 0.6;
        const bx = x + rng.range(-3, 3);
        const ex = bx + Math.cos(a) * h, ey = y + Math.sin(a) * h;
        d[c] += `M${f2(bx)} ${f2(y)}Q${f2(bx + Math.cos(a) * h * 0.5)} ${f2(y + Math.sin(a) * h * 0.6)} ${f2(ex)} ${f2(ey)}`;
      }
    }
    return Object.entries(d).map(([c, p]) => `<path d="${p}" stroke="${c}" stroke-width="${hmax > 20 ? 1.8 : 1.1}" fill="none" stroke-linecap="round" opacity="${op}"/>`).join('');
  };
  return { svg: s, tuftsFront: () => tufts(316, IH + 16, 160, 12, 30, ['#E9D492', '#C59F55', '#8D6F37', '#D8BA6E'], 0.95), RT, RB };
}

// ---------- tarjeta de brecha (como la pantalla del chofer) ----------
function chip(cx, top, label, val, sub) {
  const vw = textW(val, 'p800', 34), lw = textW(label, 'p700', 12, 1.4);
  const w = Math.max(vw, lw) + 34, h = 74;
  const x = cx - w / 2;
  const r = 12, X2 = x + w, B = top + h;
  const outline = `M${f2(x + r)} ${top}H${f2(X2 - r)}Q${f2(X2)} ${top} ${f2(X2)} ${top + r}V${B - r}Q${f2(X2)} ${B} ${f2(X2 - r)} ${B}H${f2(cx + 8)}L${cx} ${B + 9}L${f2(cx - 8)} ${B}H${f2(x + r)}Q${f2(x)} ${B} ${f2(x)} ${B - r}V${top + r}Q${f2(x)} ${top} ${f2(x + r)} ${top}Z`;
  return `<path d="${outline}" fill="none" stroke="#3CCB7F" stroke-width="7" opacity=".55" filter="url(#chipGlow)"/>
  <g filter="url(#chipSh)"><path d="${outline}" fill="#FFFFFF"/></g>
  <path d="${outline}" fill="none" stroke="${GREEN}" stroke-width="2.4" stroke-linejoin="round"/>
  <rect x="${f2(x + 1)}" y="${top + 1}" width="${f2(w - 2)}" height="5" rx="2.5" fill="${GREEN}"/>
  <text x="${cx}" y="${top + 24}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="12" letter-spacing="1.4" fill="${GREEN}">${label}</text>
  <text x="${cx}" y="${top + 59}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="34" fill="${GREEN}">${val}</text>`;
}
function bracket(x1, x2, y, top) {
  const cx = (x1 + x2) / 2, a = 7;
  const line = `M${f2(x1)} ${f2(y)}H${f2(x2)}M${f2(cx)} ${f2(top)}V${f2(y)}`;
  const heads = `M${f2(x1 + a)} ${f2(y - a * 0.7)}L${f2(x1)} ${f2(y)}L${f2(x1 + a)} ${f2(y + a * 0.7)}M${f2(x2 - a)} ${f2(y - a * 0.7)}L${f2(x2)} ${f2(y)}L${f2(x2 - a)} ${f2(y + a * 0.7)}`;
  return `<path d="${line}${heads}" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${line}${heads}" fill="none" stroke="${GREEN}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${f2(cx)}" cy="${f2(y)}" r="3.5" fill="${GREEN}" stroke="#fff" stroke-width="1.5"/>`;
}

// ---------- las cuatro opciones como stickers (tres tachadas, la cuarta es Micros Tempo) ----------
const OPT_ICON = {
  chat: `<path d="M-24 -26H16Q24 -26 24 -18V6Q24 14 16 14H-6L-16 24V14H-24Q-32 14 -32 6V-18Q-32 -26 -24 -26Z" fill="#3CCB7F" stroke="#0B2239" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-25" y="-19" width="22" height="18" rx="3" fill="#FFFFFF" stroke="#0B2239" stroke-width="2"/>
    <path d="M-23 -3L-17 -11L-12 -6L-9 -9L-5 -3Z" fill="#2580CF"/><circle cx="-9" cy="-14" r="2.4" fill="#F5C542"/>
    <path d="M2 -16H17M2 -9H17M2 -2H12" stroke="#0B2239" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M14 18H30Q36 18 36 24V30L40 34H30Q14 34 14 28Z" fill="#FFFFFF" stroke="#0B2239" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M19 26h12" stroke="#0B2239" stroke-width="2" stroke-linecap="round"/>`,
  timeclock: `<rect x="-5" y="-34" width="10" height="70" fill="#8E969E" stroke="#0B2239" stroke-width="2.4"/>
    <rect x="-22" y="-26" width="38" height="44" rx="5" fill="#2A4864" stroke="#0B2239" stroke-width="3"/>
    <circle cx="-3" cy="-12" r="10" fill="#FFFFFF" stroke="#0B2239" stroke-width="2.4"/>
    <path d="M-3 -12V-18M-3 -12L1 -9" stroke="#0B2239" stroke-width="2" stroke-linecap="round"/>
    <rect x="-14" y="5" width="22" height="5" rx="1.5" fill="#0B2239"/>
    <path d="M16 -6H24V10" stroke="#0B2239" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="12" r="4" fill="#E63950" stroke="#0B2239" stroke-width="2"/>`,
  dice: `<g transform="rotate(-12)"><rect x="-22" y="-22" width="44" height="44" rx="10" fill="#FFFFFF" stroke="#0B2239" stroke-width="3"/>
    <circle cx="-10" cy="-10" r="4" fill="#0B2239"/><circle cx="10" cy="-10" r="4" fill="#0B2239"/><circle cx="0" cy="0" r="4" fill="#E63950"/>
    <circle cx="-10" cy="10" r="4" fill="#0B2239"/><circle cx="10" cy="10" r="4" fill="#0B2239"/></g>`,
};
function optionCards(seed) {
  const CS = 126, K = 0.95, gap = 22, n = 4, x0 = (W - (CS * K * n + gap * (n - 1))) / 2, y0 = 70;
  const items = [
    ['chat', ['Fotos y audios', 'por WhatsApp'], -5],
    ['timeclock', ['Marcar el reloj', 'del poste'], 3],
    ['dice', ['Confiar en', 'la suerte'], -3],
    ['logo', ['Micros', 'Tempo'], 2],
  ];
  let s = `<defs>${fRoughX('xmark', seed + 40)}</defs><g id="opciones">`;
  items.forEach(([ic, label, rot], i) => {
    const cx = x0 + i * (CS * K + gap) + CS * K / 2, cy = y0 + CS / 2;
    const hero = ic === 'logo';
    const bg = hero ? BLUE : '#FFFFFF', fg = hero ? '#FFFFFF' : NAVY;
    s += `<g transform="translate(${f2(cx)} ${f2(cy)}) rotate(${rot}) scale(${K})">
      <rect x="${-CS / 2 + 6}" y="${-CS / 2 + 6}" width="${CS}" height="${CS}" rx="18" fill="${NAVY}"/>
      <rect x="${-CS / 2}" y="${-CS / 2}" width="${CS}" height="${CS}" rx="18" fill="${bg}" stroke="${NAVY}" stroke-width="3"/>
      <g transform="translate(0 -16)">${hero ? `<g transform="translate(-27 -27)">${logoMark(54, '#FFFFFF', 9)}</g>` : OPT_ICON[ic]}</g>
      <text x="0" y="${CS / 2 - 30}" text-anchor="middle" font-family="Poppins" font-weight="${hero ? 700 : 600}" font-size="13" fill="${fg}">${label[0]}</text>
      <text x="0" y="${CS / 2 - 14}" text-anchor="middle" font-family="Poppins" font-weight="${hero ? 700 : 600}" font-size="13" fill="${fg}">${label[1]}</text>`;
    if (hero) {
      s += `<g transform="translate(${CS / 2 - 6} ${-CS / 2 + 6})"><circle r="17" fill="${GREEN}" stroke="${NAVY}" stroke-width="3"/>
        <path d="M-7 0L-2 6L8 -6" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    } else {
      const r = 36, oy = -18;
      s += `<g filter="url(#xmark)" transform="translate(0 ${oy})"><path d="M${-r} ${-r + 4}Q0 2 ${r - 2} ${r}M${r - 3} ${-r}Q-2 -1 ${-r + 2} ${r - 3}" stroke="#E63950" stroke-width="8" fill="none" stroke-linecap="round"/></g>`;
    }
    s += `</g>`;
  });
  return s + '</g>';
}
const fRoughX = (id, seed) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
  <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="${seed}" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>`;

function build(seed = 7) {
  const IY = 402, IH = 340;                 // banda de ilustración
  const sc = scene(seed, W, IH);
  const S = 0.345;                          // escala de las combis
  const CL = 688 * S;                       // largo de una combi
  const gap = 92;
  const heroX = (W - CL) / 2;
  const by = sc.RB - 6 - 328 * S;           // y de la combi para que pise la pista
  const xs = [heroX - gap - CL, heroX, heroX + CL + gap];
  const units = ['02', '07', '03'];
  let combis = '';
  xs.forEach((x, i) => {
    combis += `<g transform="translate(${f2(x - 20 * S)} ${f2(by)}) scale(${S})">${combi({ id: 'k' + i, unit: units[i] })}</g>`;
  });
  const roof = by + 22 * S;
  const bY = by + 118 * S;
  const g1 = [xs[0] + CL, xs[1]], g2 = [xs[1] + CL, xs[2]];

  // texto de cabecera
  const head = [['Más control.', NAVY, 0.95], ['Más pasajeros.', NAVY, 0.95], ['Menos accidentes.', BLUE, 1]];
  const HS = 54;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${fPaper('paper', seed + 20, 0.8, 0.2, W, H)}
<filter id="chipGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="chipSh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0B2239" flood-opacity=".28"/></filter>
<clipPath id="ill"><rect x="0" y="${IY}" width="${W}" height="${IH}"/></clipPath>
</defs>
<g id="fondo" filter="url(#paper)">${(process.env.BG || '#E9F0F6') ? `<rect width="${W}" height="${H}" fill="${process.env.BG || '#E9F0F6'}"/>` : `<rect width="${W}" height="${H}" fill="${PAPER}"/><rect width="${W}" height="${H}" fill="#CFE9FA" opacity=".16"/>`}</g>
<g id="cabecera">`;
  svg += `<text x="${W / 2}" y="46" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="18" fill="${INK}">Para saber los tiempos entre unidades, hay varias formas:</text>`;
  svg += optionCards(seed);
  head.forEach(([t, c, k], i) => svg += `<text x="${W / 2}" y="${[260, 312, 368][i]}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="${f2(HS * k)}" letter-spacing="-1" fill="${c}">${t}</text>`);
  svg += `</g>
<g id="ilustracion" clip-path="url(#ill)"><g transform="translate(0 ${IY})">
  <g id="paisaje" filter="url(#paper)">${sc.svg}</g>
  <g id="combis">${combis}</g>
  <g id="ichu-frente">${sc.tuftsFront()}</g>
  <g id="brechas">${bracket(g1[0] + 3, g1[1] - 3, bY, roof - 4)}${bracket(g2[0] + 3, g2[1] - 3, bY, roof - 4)}
  ${chip(f2((g1[0] + g1[1]) / 2), f2(roof - 96), 'ATRÁS', '6:15')}
  ${chip(f2((g2[0] + g2[1]) / 2), f2(roof - 96), 'ADELANTE', '6:01')}</g>
</g></g>
<rect x="0" y="${IY}" width="${W}" height="3" fill="${NAVY}" opacity=".9"/>
<rect x="0" y="${IY + IH - 3}" width="${W}" height="3" fill="${NAVY}" opacity=".9"/>`;

  // pie de ilustración: la idea en una frase
  svg += `<text x="${W / 2}" y="${IY + IH + 34}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="15.5" fill="${INK}">Combis <tspan font-weight="700" fill="${GREEN}">a buena distancia</tspan>: ni pegadas ni separadas, medido en minutos.</text>`;

  // tres columnas
  const steps = [
    ['Registramos la flota', 'y marcamos sus rutas', 'en el mapa.'],
    ['Cada chofer recibe', 'su usuario y su clave.', ''],
    ['Instala la app, toca', 'SALIR A RUTA y ¡listo!', ''],
  ];
  const sy0 = IY + IH + 92;
  svg += `<text x="${W / 2}" y="${sy0 - 22}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="13" letter-spacing="2.2" fill="${BLUE}">EMPEZAR ES ASÍ DE SIMPLE</text>`;
  const sw = 196, sg = 18, sx0 = (W - (sw * 3 + sg * 2)) / 2;
  steps.forEach((ls, i) => {
    const x = sx0 + i * (sw + sg);
    svg += `<rect x="${f2(x)}" y="${sy0 - 6}" width="${sw}" height="74" rx="16" fill="#FFFFFF" stroke="#C9DCEB" stroke-width="1.5"/>
    <circle cx="${f2(x + 26)}" cy="${sy0 + 31}" r="15" fill="${BLUE}"/>
    <text x="${f2(x + 26)}" y="${sy0 + 37}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="16" fill="#FFFFFF">${i + 1}</text>`;
    ls.filter(Boolean).forEach((l, j, arr) => {
      const y = sy0 + 31 - (arr.length - 1) * 8.5 + j * 17 + 4.5;
      if (l.startsWith('SALIR')) {
        svg += `<text x="${f2(x + 50)}" y="${f2(y)}" font-family="Poppins" font-size="12.5"><tspan font-weight="700" fill="${NAVY}">SALIR A RUTA</tspan><tspan font-weight="500" fill="${INK}"> y </tspan><tspan font-weight="700" fill="${GREEN}">¡listo!</tspan></text>`;
      } else {
        svg += `<text x="${f2(x + 50)}" y="${f2(y)}" font-family="Poppins" font-weight="500" font-size="12.5" fill="${INK}">${esc(l)}</text>`;
      }
    });
  });
  svg += `<text x="${W / 2}" y="${sy0 + 96}" text-anchor="middle" font-family="Poppins" font-size="12.5" fill="${INK}">Solo necesita un celular Android con GPS y datos.</text>`;

  const wm = wordmark(0, 0, 32, NAVY);
  svg += `<g transform="translate(${f2((W - wm.w) / 2)} ${H - 58})">${wm.svg}</g>
<text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-family="Poppins" font-size="12" fill="#5A7591">Control de flota para combis y micros · Perú</text>
</svg>`;
  return svg;
}

module.exports = { build, wordmark };
if (require.main === module) {
  const seed = +(process.argv[2] || 7);
  fs.writeFileSync(`out/frente-${seed}.svg`, build(seed));
}
