// Utilidades compartidas: rng con semilla, ruido, medición de texto, filtros.
const M = require('./metrics.json');

function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.int = (a, b) => Math.floor(rng.range(a, b + 1));
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.chance = p => rng() < p;
  rng.gauss = (m = 0, s = 1) => {
    const u = 1 - rng(), v = rng();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  rng.shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return rng;
}

function makeNoise2D(rng) {
  const perm = rng.shuffle([...Array(256).keys()]);
  const p = new Uint16Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = Array.from({ length: 256 }, () => {
    const a = rng() * Math.PI * 2; return [Math.cos(a), Math.sin(a)];
  });
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dot = (ix, iy, x, y) => {
    const g = G[p[p[ix & 255] + (iy & 255)]];
    return g[0] * (x - ix) + g[1] * (y - iy);
  };
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const u = fade(x - x0), v = fade(y - y0);
    return lerp(lerp(dot(x0, y0, x, y), dot(x0 + 1, y0, x, y), u),
      lerp(dot(x0, y0 + 1, x, y), dot(x0 + 1, y0 + 1, x, y), u), v);
  };
}
const fbm = (noise, x, y, oct = 4) => {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); f *= 2; amp *= 0.5; }
  return s;
};
const f2 = n => +n.toFixed(2);
const pathD = pts => 'M' + pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L');

// Ancho real de un texto con las métricas de la fuente (+ letter-spacing por carácter).
function textW(str, font, size, ls = 0) {
  const m = M[font]; let w = 0;
  for (const ch of str) w += (m.w[ch] ?? m.w['n']) / m.u * size + ls;
  return w - ls;
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map(h => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const fPaper = (id, seed, freq = 0.75, k = 0.22, W, H) => `
<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
  <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
  <feDiffuseLighting in="n" surfaceScale="1.2" lighting-color="#fff" result="l">
    <feDistantLight azimuth="45" elevation="60"/></feDiffuseLighting>
  <feColorMatrix in="l" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -${k} 0 0 0 ${k}" result="s"/>
  <feComposite in="s" in2="SourceGraphic" operator="atop"/></filter>`;

const fNebula = (id, seed, freq = 0.006, blur = 14, scale = 120) => `
<filter id="${id}" x="-30%" y="-60%" width="160%" height="220%">
  <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}" result="n"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/>
  <feDisplacementMap in="n" in2="b" scale="${scale}" result="d"/>
  <feComposite in="d" in2="b" operator="in"/></filter>`;

const fRough = (id, seed, freq = 0.04, scale = 3) => `
<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

module.exports = { makeRng, makeNoise2D, fbm, f2, pathD, textW, esc, mix, fPaper, fNebula, fRough };
