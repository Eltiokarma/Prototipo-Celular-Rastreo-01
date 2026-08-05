// Las paletas de las tres pantallas web, medidas contra la física del caso:
// sol directo a 3800 m, el chofer mirando de reojo con el vehículo en
// movimiento. `tema.js` cubre la paleta de la app NATIVA (`app/tema.js`);
// esta suite cubre lo que aquella no ve: los `TEMAS` de `Prototipo.html` y
// `despacho.html`, y el `:root` de `creador.html` — que es una copia a mano
// de `day` de despacho y hasta hoy nadie comparaba las dos.
//
// Lo que se defiende no es el gusto, son las reglas de PROMPT-DISENO.md
// vueltas número: el tema día es el de fábrica, el contraste del texto no
// baja de AA (4.5:1), el sol extremo existe para leerse MEJOR que el día,
// el #FF2D55 está reservado a emergencia, y ninguna paleta tiene huecos.
//
// Dos pisos distintos, y es a propósito:
//   4.5:1 (AA)  texto normal — etiquetas, chat, tintas de estado.
//   3.0:1       el número héroe de brecha (texto gigante en Archivo Black,
//               donde la propia WCAG pide 3:1) y `dim3`, que el tema declara
//               "metadatos mínimos". Lo que queda entre 3 y 4.5 se lista en
//               un bloque informativo en cada corrida: no falla, pero no se
//               esconde. Subir la tinta o la vara es decisión del dueño del
//               producto, no de esta suite.
const fs = require('fs');
const RAIZ = require('path').join(__dirname, '..');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// ── sacar los TEMAS del HTML ────────────────────────────────────────────
// Recorta el literal `const TEMAS = {…}` contando llaves, salteando strings
// y comentarios: las URLs de tiles traen `{z}/{x}/{y}` adentro y un conteo
// ingenuo corta el objeto por la mitad. Si el literal deja de ser literal
// (alguien mete una función), esto revienta acá, ruidosamente — mejor que
// medir de menos en silencio.
function extraerTemas(archivo) {
  const src = fs.readFileSync(archivo, 'utf8');
  const inicio = src.indexOf('const TEMAS = {');
  if (inicio === -1) throw new Error('no hay `const TEMAS = {` en ' + archivo);
  let i = src.indexOf('{', inicio);
  let prof = 0, enStr = null, enLinea = false, enBloque = false;
  for (; i < src.length; i++) {
    const c = src[i], sig = src[i + 1];
    if (enLinea) { if (c === '\n') enLinea = false; continue; }
    if (enBloque) { if (c === '*' && sig === '/') { enBloque = false; i++; } continue; }
    if (enStr) {
      if (c === '\\') { i++; continue; }
      if (c === enStr) enStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { enStr = c; continue; }
    if (c === '/' && sig === '/') { enLinea = true; i++; continue; }
    if (c === '/' && sig === '*') { enBloque = true; i++; continue; }
    if (c === '{') prof++;
    if (c === '}') { prof--; if (prof === 0) break; }
  }
  if (prof !== 0) throw new Error('llaves sin cerrar en ' + archivo);
  const literal = src.slice(src.indexOf('{', inicio), i + 1);
  return { temas: new Function('return (' + literal + ')')(), src };
}

// El creador no usa TEMAS: un solo tema claro en variables CSS.
function extraerRoot(archivo) {
  const src = fs.readFileSync(archivo, 'utf8');
  const m = src.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error('no hay bloque :root en ' + archivo);
  const vars = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
  return vars;
}

// ── contraste WCAG 2 ────────────────────────────────────────────────────
const canal = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminancia = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};
const contraste = (a, b) => {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const esHex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v);

const proto = extraerTemas(RAIZ + '/project/Prototipo.html');
const desp = extraerTemas(RAIZ + '/project/despacho.html');
const cread = extraerRoot(RAIZ + '/server/creador.html');

// ── los pares COMO EL CÓDIGO LOS COMPONE ────────────────────────────────
// No "todo contra todo": cada par existe en un style={} concreto. El héroe
// se dibuja con `color` en day/sun y con `ink` cuando hay resplandor
// (Prototipo.html, componente del HUD); la burbuja de Despacho en el chat
// del chofer se lee con HUD.fg, no con una tinta propia.
const AA = 4.5, GRANDE = 3;
const PARES_PROTO = [
  ['texto primario / fondo',        t => t.fg,   t => t.bg, AA],
  ['texto secundario / fondo',      t => t.fg2,  t => t.bg, AA],
  ['etiquetas / fondo',             t => t.dim,  t => t.bg, AA],
  ['metadatos / fondo',             t => t.dim2, t => t.bg, AA],
  ['metadatos mínimos / fondo',     t => t.dim3, t => t.bg, GRANDE],
  ['texto primario / superficie',   t => t.fg,   t => t.surface, AA],
  ['HÉROE verde / fondo',  t => t.resplandor ? t.greenInk : t.green, t => t.bg, GRANDE],
  ['HÉROE ámbar / fondo',  t => t.resplandor ? t.amberInk : t.amber, t => t.bg, GRANDE],
  ['HÉROE rojo / fondo',   t => t.resplandor ? t.redInk : t.red,     t => t.bg, GRANDE],
  ['burbuja de chat',               t => t.burbujaInk,       t => t.burbuja, AA],
  ['burbuja propia',                t => t.burbujaPropiaInk, t => t.burbujaPropia, AA],
  ['burbuja de Despacho (usa fg)',  t => t.fg,               t => t.burbujaAdmin, AA],
  ['burbuja de aviso',              t => t.burbujaWarnInk,   t => t.burbujaWarn, AA],
  ['burbuja de SOS',                t => t.burbujaSosInk,    t => t.burbujaSos, AA],
];
const PARES_DESP = [
  ['texto primario / fondo',        t => t.fg,   t => t.bg, AA],
  ['texto secundario / fondo',      t => t.fg2,  t => t.bg, AA],
  ['etiquetas / fondo',             t => t.dim,  t => t.bg, AA],
  ['metadatos / fondo',             t => t.dim2, t => t.bg, AA],
  ['metadatos mínimos / fondo',     t => t.dim3, t => t.bg, GRANDE],
  ['texto primario / superficie',   t => t.fg,   t => t.surface, AA],
  ['brecha verde / celda',          t => t.green, t => t.celda, GRANDE],
  ['brecha ámbar / celda',          t => t.amber, t => t.celda, GRANDE],
  ['brecha roja / celda',           t => t.red,   t => t.celda, GRANDE],
  ['tinta verde / su fondo',        t => t.verdeTinta,  t => t.verdeFondo, AA],
  ['tinta ámbar / su fondo',        t => t.ambarTinta,  t => t.ambarFondo, AA],
  ['tinta ámbar 2 / su fondo',      t => t.ambarTinta2, t => t.ambarFondo, AA],
  ['tinta roja / su fondo',         t => t.rojoTinta,   t => t.rojoFondo, AA],
  ['tinta azul / su fondo',         t => t.azulTinta,   t => t.azulFondo, AA],
  ['clave generada / su fondo',     t => t.okClave, t => t.okFondo, AA],
  ['acento / fondo',                t => t.bright,  t => t.bg, AA],
  ['burbuja de chat',               t => t.burbujaInk,       t => t.burbuja, AA],
  ['burbuja propia',                t => t.burbujaPropiaInk, t => t.burbujaPropia, AA],
  ['burbuja de SOS',                t => t.burbujaSosInk,    t => t.burbujaSos, AA],
];

const bajoAA = [];   // lo que pasó su piso pero no llega a AA: se informa
let paresAAA = 0, paresTotal = 0;

function medir(pantalla, temas, pares) {
  for (const [modo, t] of Object.entries(temas)) {
    console.log(`\n${pantalla} · tema ${modo.toUpperCase()}`);
    for (const [nombre, fgDe, bgDe, piso] of pares) {
      const f = fgDe(t), b = bgDe(t);
      if (!esHex(f) || !esHex(b)) { ok(`${nombre}: par medible`, false, [f, b]); continue; }
      const r = contraste(f, b);
      paresTotal++;
      if (r >= 7) paresAAA++;
      if (r >= piso && r < AA) bajoAA.push(`${pantalla}/${modo} · ${nombre} = ${r.toFixed(2)} (${f} sobre ${b})`);
      ok(`${nombre} ≥ ${piso}:1`, r >= piso, r.toFixed(2) + ` (${f} sobre ${b})`);
    }
  }
}

console.log('EL TEMA DE FÁBRICA ES EL DÍA');
{
  // Un tema oscuro elegante es ilegible al mediodía en Juliaca. La regla
  // vive en dos lados y los dos tienen que decir lo mismo: el orden del
  // objeto y el arranque de HUD.
  ok('en el chofer, day es el primer tema', Object.keys(proto.temas)[0] === 'day', Object.keys(proto.temas));
  ok('en Despacho también', Object.keys(desp.temas)[0] === 'day', Object.keys(desp.temas));
  ok('el HUD del chofer arranca en day', /const HUD = \{ \.\.\.TEMAS\.day \}/.test(proto.src));
  ok('el de Despacho también', /const HUD = \{ \.\.\.TEMAS\.day \}/.test(desp.src));
}

console.log('\nNINGÚN TEMA TIENE HUECOS');
{
  // Una clave que falte en un tema es un `undefined` que se ve recién en el
  // teléfono, con la app abierta y el chofer manejando. Igual que tema.js,
  // pero sobre las paletas web.
  for (const [pantalla, { temas }] of [['chofer', proto], ['despacho', desp]]) {
    const claves = Object.keys(Object.values(temas)[0]).sort();
    for (const [modo, t] of Object.entries(temas)) {
      const suyas = Object.keys(t).sort();
      ok(`${pantalla}.${modo} tiene exactamente las mismas claves`,
         JSON.stringify(suyas) === JSON.stringify(claves),
         suyas.filter(c => !claves.includes(c)).concat(claves.filter(c => !suyas.includes(c))));
      // Todo lo que empieza con # es un color de 6 dígitos; el resto son los
      // no-colores conocidos (tiles, banderas, rgba de superficies flotantes)
      const malos = Object.entries(t).filter(([, v]) =>
        typeof v === 'string' && v.startsWith('#') && !esHex(v));
      ok(`y todo #color de ${pantalla}.${modo} es válido`, malos.length === 0, malos);
    }
  }
}

console.log('\nCONTRASTE, PAR POR PAR');
medir('chofer', proto.temas, PARES_PROTO);
medir('despacho', desp.temas, PARES_DESP);

{
  console.log('\ncreador · tema único');
  for (const [nombre, f, b, piso] of [
    ['texto primario / fondo',    cread.fg,   cread.bg, AA],
    ['texto secundario / fondo',  cread.fg2,  cread.bg, AA],
    ['etiquetas / fondo',         cread.dim,  cread.bg, AA],
    ['metadatos mínimos / fondo', cread.dim3, cread.bg, GRANDE],
    ['tinta verde / su fondo',    cread.verdeTinta, cread.verdeFondo, AA],
    ['tinta ámbar / su fondo',    cread.ambarTinta, cread.ambarFondo, AA],
    ['tinta roja / su fondo',     cread.rojoTinta,  cread.rojoFondo, AA],
  ]) {
    if (!esHex(f) || !esHex(b)) { ok(`${nombre}: par medible`, false, [f, b]); continue; }
    const r = contraste(f, b);
    paresTotal++;
    if (r >= 7) paresAAA++;
    if (r >= piso && r < AA) bajoAA.push(`creador · ${nombre} = ${r.toFixed(2)} (${f} sobre ${b})`);
    ok(`${nombre} ≥ ${piso}:1`, r >= piso, r.toFixed(2));
  }
}

console.log('\nEL SOL EXTREMO EXISTE PARA LEERSE MEJOR');
{
  // Si el tema sun mide peor que day en algún par, no es un tema: es un
  // adorno. Cada par tiene que subir o, como poco, empatar.
  for (const [nombre, fgDe, bgDe] of PARES_PROTO) {
    const rDay = contraste(fgDe(proto.temas.day), bgDe(proto.temas.day));
    const rSun = contraste(fgDe(proto.temas.sun), bgDe(proto.temas.sun));
    ok(`${nombre}: sun ≥ day`, rSun >= rDay, [rSun.toFixed(2), rDay.toFixed(2)]);
  }
  ok('y el fondo de sun es al menos tan claro como el de day',
     luminancia(proto.temas.sun.bg) >= luminancia(proto.temas.day.bg));
}

console.log('\nEL ROJO DE EMERGENCIA ESTÁ RESERVADO');
{
  // #FF2D55 es SOS y brecha crítica. Si aparece de decorativo en cualquier
  // otro rol, el único color que el chofer lee sin leer deja de significar.
  const usos = [];
  for (const [pantalla, { temas }] of [['chofer', proto], ['despacho', desp]]) {
    for (const [modo, t] of Object.entries(temas)) {
      for (const [k, v] of Object.entries(t)) {
        if (String(v).toUpperCase().includes('FF2D55')) usos.push(`${pantalla}.${modo}.${k}`);
      }
    }
  }
  ok('#FF2D55 aparece solo como red del tema night',
     usos.every(u => u.endsWith('.night.red')) && usos.length > 0, usos);
  ok('en el creador no aparece nunca',
     !Object.values(cread).some(v => String(v).toUpperCase().includes('FF2D55')));
}

console.log('\nLOS ESTADOS SIGUEN SIENDO SU COLOR');
{
  // Verde, ámbar y rojo dicen qué hacer. Calcado de tema.js: el rojo tiene
  // que seguir siendo rojo, el verde verde, y los tres distinguirse.
  for (const [pantalla, { temas }] of [['chofer', proto], ['despacho', desp]]) {
    for (const [modo, t] of Object.entries(temas)) {
      const rojo = parseInt(t.red.slice(1), 16), verde = parseInt(t.green.slice(1), 16);
      ok(`${pantalla}.${modo}: el rojo es rojo`,
         ((rojo >> 16) & 255) > ((rojo >> 8) & 255) && ((rojo >> 16) & 255) > (rojo & 255), t.red);
      ok(`${pantalla}.${modo}: el verde es verde`,
         ((verde >> 8) & 255) > ((verde >> 16) & 255) && ((verde >> 8) & 255) > (verde & 255), t.green);
      ok(`${pantalla}.${modo}: los tres se distinguen`,
         new Set([t.green, t.amber, t.red]).size === 3);
    }
  }
}

console.log('\nEL CREADOR ES LA MISMA PALETA QUE DESPACHO');
{
  // El :root de creador.html es una copia a mano de day de despacho.html.
  // Esta es la soldadura: si alguien retoca una y no la otra, acá se ve.
  const limpio = v => String(v).replace(/\s/g, '').toUpperCase();
  let compartidas = 0;
  const distintas = [];
  for (const [k, v] of Object.entries(cread)) {
    const d = desp.temas.day[k];
    if (d === undefined) continue;   // el creador puede tener menos, no distinto
    compartidas++;
    if (limpio(d) !== limpio(v)) distintas.push(`--${k}: creador=${v} despacho=${d}`);
  }
  // Si el regex del :root se rompe, "todo coincide" saldría verde con cero
  // comparaciones. Por eso el piso.
  ok('se comparan al menos 20 variables compartidas', compartidas >= 20, compartidas);
  ok('y todas coinciden con day de Despacho', distintas.length === 0, distintas);
}

console.log('\nINFORMATIVO — pasa su piso pero no llega a AA (4.5:1)');
{
  // No es falla: son los pares con piso 3:1 (héroe gigante, metadatos
  // mínimos) que quedaron entre 3 y 4.5. Se listan para que el número esté
  // a la vista en cada corrida. Subir la tinta es decisión de diseño.
  if (bajoAA.length === 0) console.log('  (nada: todo lo medido llega a AA)');
  for (const l of bajoAA) console.log('  · ' + l);
  console.log(`  AAA (7:1) alcanzado en ${paresAAA} de ${paresTotal} pares medidos`);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
