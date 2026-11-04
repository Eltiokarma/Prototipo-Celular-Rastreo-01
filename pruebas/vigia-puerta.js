// El vigía de la puerta (`app/puerta.js`, y su copia en la web del chofer):
// el chofer que entró, no tocó SALIR A RUTA y ya está manejando.
//
// Lo que se prueba es que salte con lo que es manejar y con nada más: el
// teléfono quieto con el zigzag del GPS, el que camina con la app abierta y
// el rebote de una lectura no avisan; la combi que arranca —o que ya venía
// andando cuando el chofer entró— sí, y si nadie contesta sale sola al
// minuto. Y que «no estoy manejando» lo calle de verdad.
//
// Los mismos casos corren contra las dos copias: la nativa se importa, la de
// la web se saca del HTML (no tiene build para importar la otra).
const RAIZ = require('path').join(__dirname, '..');
const fs = require('fs');
const nativa = require(RAIZ + '/app/puerta.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// La copia de la web: del marcador de inicio al de fin, evaluada aparte
function sacarDeLaWeb() {
  const html = fs.readFileSync(RAIZ + '/project/Prototipo.html', 'utf8');
  const i = html.indexOf('// ── VIGÍA DE LA PUERTA');
  const j = html.indexOf('// ── FIN DEL VIGÍA DE LA PUERTA');
  if (i < 0 || j < 0) return null;
  // eslint-disable-next-line no-new-func
  return new Function(html.slice(i, j) + '\nreturn { crearVigiaPuerta, metrosEntrePuerta };')();
}
const web = sacarDeLaWeb();

const LAT = -15.4900, LNG = -70.1330;
const M = 1 / 111320;   // un metro en grados de latitud
// Una lectura cada `cada` ms durante `durMs`, con la posición que da `donde(t)`
function recorrer(v, { durMs, cada = 5000, t0 = 0, donde }) {
  const salidas = [];
  for (let t = t0; t <= t0 + durMs; t += cada) {
    const p = donde(t);
    const r = v.posicion(p.lat, p.lng, t);
    if (r) salidas.push({ r, t });
  }
  return salidas;
}
// En línea recta hacia el sur a `kmh`, con un zigzag de GPS de unos metros
const andando = (kmh, desde = 0) => (t) => {
  const m = Math.max(0, t - desde) / 1000 * kmh / 3.6;
  return { lat: LAT - m * M + 6 * Math.sin(t / 7000) * M, lng: LNG + 5 * Math.cos(t / 9000) * M };
};

function casos(nombre, mod) {
  console.log(`\n${nombre.toUpperCase()}`);
  if (!mod) { ok('la copia existe', false); return; }
  const { crearVigiaPuerta } = mod;

  let v = crearVigiaPuerta();
  let s = recorrer(v, { durMs: 10 * 60_000, donde: andando(0) });
  ok('quieto en la puerta diez minutos, con el zigzag del GPS: nada', s.length === 0, s);

  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 15 * 60_000, donde: andando(5) });
  ok('caminando a 5 km/h con la app abierta (1,2 km): nada', s.length === 0, s);

  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 4 * 60_000, donde: (t) => (t === 60_000
    ? { lat: LAT - 600 * M, lng: LNG } : andando(0)(t)) });
  ok('un rebote de 600 m en una sola lectura: nada', s.length === 0, s);

  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 5 * 60_000, donde: andando(25, 60_000) });
  const aviso = s.find(x => x.r === 'avisar');
  ok('arranca a 25 km/h al minuto de entrar: avisa', !!aviso, aviso);
  ok('antes de los dos minutos de arrancar', !!aviso && aviso.t - 60_000 <= 120_000, aviso && aviso.t);
  const sale = s.find(x => x.r === 'salir');
  ok('y si nadie contesta, sale solo al minuto del aviso', !!sale && sale.t - aviso.t >= 60_000 && sale.t - aviso.t <= 65_000,
    sale && sale.t - aviso.t);
  ok('avisa una sola vez', s.filter(x => x.r === 'avisar').length === 1);

  v = crearVigiaPuerta();
  recorrer(v, { durMs: 3 * 60_000, donde: andando(25) });
  ok('entró ya manejando: también avisa', v.faltaMs(3 * 60_000) !== null);

  // La cuenta corre sola, sin posiciones nuevas (el GPS puede no mandar)
  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 3 * 60_000, donde: andando(25) });
  const t1 = s.find(x => x.r === 'avisar').t;
  ok('la cuenta regresiva arranca en 60 s', v.faltaMs(t1) === 60_000, v.faltaMs(t1));
  ok('y baja con el reloj', v.faltaMs(t1 + 20_000) === 40_000, v.faltaMs(t1 + 20_000));
  ok('el reloj solo, sin GPS, también la termina', v.tic(t1 + 59_000) === null && v.tic(t1 + 60_000) === 'salir');

  // «No estoy manejando»: va de pasajero
  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 3 * 60_000, donde: andando(25) });
  const t2 = s.find(x => x.r === 'avisar').t;
  v.callar(t2 + 5000);
  ok('callado: no hay cuenta', v.faltaMs(t2 + 6000) === null && v.tic(t2 + 70_000) === null);
  s = recorrer(v, { t0: t2 + 10_000, durMs: 25 * 60_000, donde: andando(25) });
  ok('y sigue andando 25 minutos sin que avise', s.length === 0, s);
  s = recorrer(v, { t0: t2 + 35 * 60_000, durMs: 5 * 60_000, donde: andando(25) });
  ok('pasada la media hora, si sigue andando, vuelve a avisar', s.some(x => x.r === 'avisar'));

  // El primer fix sale a 400 m (con el wifi) y a los 40 s se corrige: un
  // salto que se SOSTIENE, no un rebote de una lectura
  v = crearVigiaPuerta();
  s = recorrer(v, { durMs: 4 * 60_000, donde: (t) => (t < 40_000 ? { lat: LAT - 400 * M, lng: LNG } : andando(0)(t)) });
  ok('el GPS se corrige 400 m de una vez y queda ahí: nada', s.length === 0, s);

  // Lecturas malas (precisión de 300 m, el GPS sin cielo): ni se miran
  v = crearVigiaPuerta();
  for (let t = 0; t <= 5 * 60_000; t += 5000) {
    const p = andando(25)(t);
    if (v.posicion(p.lat, p.lng, t, 300)) { s = ['avisó']; break; } else s = [];
  }
  ok('con precisión de 300 m no juzga, aunque se mueva', s.length === 0);
}

casos('la app nativa (app/puerta.js)', nativa);
casos('la web del chofer (copia en Prototipo.html)', web);

console.log('\n«NO ESTOY MANEJANDO» SOBREVIVE A REHACER EL VIGÍA');
for (const [nombre, m] of [['nativa', nativa], ['web', web]]) {
  if (!m) continue;
  // Dijo que no a las 0; la app fue atrás y volvió: el vigía nuevo nace
  // callado hasta la media hora
  const v = m.crearVigiaPuerta({ calladoHasta: 30 * 60_000 });
  const antes = recorrer(v, { durMs: 10 * 60_000, t0: 60_000, donde: andando(30, 60_000) });
  ok(`${nombre}: rehecho a los 10 min, sigue callado`, antes.length === 0, antes);
  const despues = recorrer(m.crearVigiaPuerta({ calladoHasta: 30 * 60_000 }),
    { durMs: 5 * 60_000, t0: 31 * 60_000, donde: andando(30, 31 * 60_000) });
  ok(`${nombre}: pasada la media hora vuelve a avisar`, despues.some(x => x.r === 'avisar'), despues.slice(0, 1));
}

console.log('\nLAS DOS COPIAS, IGUALES');
if (web) {
  const cte = (src, k) => (src.match(new RegExp(`const ${k}[^=]*= ([^;]+);`)) || [])[1];
  const fuenteNativa = fs.readFileSync(RAIZ + '/app/puerta.js', 'utf8');
  const html = fs.readFileSync(RAIZ + '/project/Prototipo.html', 'utf8');
  for (const [k, kw] of [['RADIO_M', 'PUERTA_RADIO_M'], ['MARCHA_KMH', 'PUERTA_MARCHA_KMH'], ['VENTANA_MS', 'PUERTA_VENTANA_MS'],
    ['SEGUIDAS', 'PUERTA_SEGUIDAS'], ['AVISO_MS', 'PUERTA_AVISO_MS'], ['CALLADO_MS', 'PUERTA_CALLADO_MS'],
    ['PRECISION_MAX_M', 'PUERTA_PRECISION_MAX_M']]) {
    ok(`${k}: el mismo valor en las dos`, cte(fuenteNativa, k) === cte(html, kw), [cte(fuenteNativa, k), cte(html, kw)]);
  }
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
process.exit(fallas ? 1 : 0);
