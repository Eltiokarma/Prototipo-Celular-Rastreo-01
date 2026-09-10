// El GPS que inventa (server/farsa.js): la heurística para el simulador que
// no trae el flag de Android.
//
// Lo que se defiende: que una combi de verdad —que frena en cada esquina y
// zigzaguea alrededor del trazado— NUNCA quede sospechosa; que un simulador
// que dibuja la ruta a velocidad constante y clavado en la línea sí; que la
// velocidad reportada que no tiene nada que ver con la implícita también; y
// que se diga una vez por episodio, con el motivo.
const RAIZ = require('path').join(__dirname, '..');
const { crearDetectorDeFarsa, VENTANA } = require(RAIZ + '/server/farsa.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const T0 = 1_000_000_000;
const LAT0 = -15.49, LNG0 = -70.13;
const gr = 1 / 111_320;             // un metro en latitud
// Un generador determinista, para que la suite sea la misma cada vez
let semilla = 7;
const azar = () => { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; };

// Manda `n` posiciones cada 10 s por una calle recta hacia el norte.
//   metrosPorSeg: función (i) → velocidad real en m/s
//   ruidoM: error del GPS en metros (±), en los dos ejes: el lateral es el
//           desvío al trazado; el longitudinal mueve la velocidad implícita
//   speedReportada: función (i, real) → lo que dice el aparato, en km/h
function correr(d, id, { n = 14, metrosPorSeg = () => 6, ruidoM = 15, speedReportada = (i, real) => real * 3.6, desde = T0 }) {
  let y = 0, r = null;
  const cambios = [];
  for (let i = 0; i < n; i++) {
    const v = metrosPorSeg(i);
    y += v * 10;
    const lateral = ruidoM ? (azar() * 2 - 1) * ruidoM : 0;
    const longitudinal = ruidoM ? (azar() * 2 - 1) * ruidoM : 0;
    r = d.posicion(id, {
      cuando: desde + i * 10_000,
      lat: LAT0 + gr * (y + longitudinal), lng: LNG0 + gr * lateral,
      speed: speedReportada(i, v),
      desvioM: Math.abs(lateral),
    });
    if (r.cambio) cambios.push({ i, cambio: r.cambio, motivo: r.motivo });
  }
  return { r, cambios };
}

console.log('\nLA COMBI DE VERDAD NUNCA ES SOSPECHOSA');
{
  const d = crearDetectorDeFarsa();
  // Frena en cada esquina: 2 a 9 m/s, GPS con ±15 m, velocidad reportada honesta
  const { r, cambios } = correr(d, 'M-01', { n: 30, metrosPorSeg: (i) => 2 + (i % 4) * 2.3 + azar() });
  ok('con frenadas y zigzag, nada', r.sospechoso === false && cambios.length === 0, cambios);
}
{
  const d = crearDetectorDeFarsa();
  // Parada en el terminal: todo GPS parado parece constante y quieto. No se juzga.
  const { r } = correr(d, 'M-01', { n: 30, metrosPorSeg: () => 0.2, ruidoM: 8 });
  ok('parada (ruido de GPS quieto) no es sospechosa', r.sospechoso === false, r);
}
{
  const d = crearDetectorDeFarsa();
  // Avenida recta y despejada: velocidad pareja (±2 km/h), PERO el GPS de
  // verdad tiene su error de posición y ése mueve la velocidad implícita.
  const { r, cambios } = correr(d, 'M-01', { n: 30, metrosPorSeg: () => 8 + (azar() - 0.5) * 1.2, ruidoM: 12 });
  ok('velocidad pareja por la avenida con un GPS de verdad: tampoco', r.sospechoso === false && cambios.length === 0, cambios);
}
{
  const d = crearDetectorDeFarsa();
  // Carretera a Puno, 60 km/h clavados con el pie firme y un GPS bueno (±5 m)
  const { r, cambios } = correr(d, 'M-01', { n: 30, metrosPorSeg: () => 16.7 + (azar() - 0.5) * 0.6, ruidoM: 5 });
  ok('60 km/h clavados en carretera con GPS bueno: tampoco', r.sospechoso === false && cambios.length === 0, cambios);
}

console.log('\nEL SIMULADOR: VELOCIDAD CONSTANTE Y CLAVADO EN LA LÍNEA');
{
  const d = crearDetectorDeFarsa();
  const { r, cambios } = correr(d, 'M-02', { n: 20, metrosPorSeg: () => 6, ruidoM: 0, speedReportada: () => 21.6 });
  ok('a 21,6 km/h exactos sobre la línea, sospechoso', r.sospechoso === true, r);
  ok('con su motivo', ['velocidad_constante', 'sin_ruido'].includes(r.motivo), r.motivo);
  ok('dicho UNA vez, cuando la ventana se llena', cambios.filter(c => c.cambio === 'empezo').length === 1 && cambios[0].i === VENTANA - 1, cambios);
  ok('y estadoDe lo repite', d.estadoDe('M-02').motivo === r.motivo);
}
{
  const d = crearDetectorDeFarsa();
  // Clavado en la línea pero con la velocidad variando (un simulador con
  // "ruido de velocidad"): la firma 2 lo agarra igual
  const { r } = correr(d, 'M-03', { n: 20, metrosPorSeg: (i) => 4 + (i % 3) * 2, ruidoM: 0 });
  ok('variando la velocidad pero a 0 m del trazado durante toda la ventana: sospechoso por sin ruido', r.motivo === 'sin_ruido', r);
}

console.log('\nLA VELOCIDAD QUE NO TIENE NADA QUE VER');
{
  const d = crearDetectorDeFarsa();
  // La posición avanza a 35 km/h (con ruido) y el aparato dice 0 todo el tiempo
  const { r } = correr(d, 'M-04', { n: 20, metrosPorSeg: () => 9 + azar() * 2, ruidoM: 15, speedReportada: () => 0 });
  ok('posición a 35 km/h y velocidad reportada 0: incoherente', r.motivo === 'velocidad_incoherente', r);
}
{
  const d = crearDetectorDeFarsa();
  // Un simulador que inventa velocidad "realista" (varía) pero la posición
  // avanza a paso constante y clavada en la línea
  const { r } = correr(d, 'M-04b', { n: 20, metrosPorSeg: () => 6, ruidoM: 0, speedReportada: (i) => 15 + (i % 5) * 4 });
  ok('velocidad reportada que varía sobre posición constante y clavada: sin ruido', r.motivo === 'sin_ruido', r);
}

console.log('\nEL EPISODIO TERMINA Y SE OLVIDA');
{
  const d = crearDetectorDeFarsa();
  correr(d, 'M-05', { n: 14, metrosPorSeg: () => 6, ruidoM: 0, speedReportada: () => 21.6 });
  ok('sospechoso', d.estadoDe('M-05').motivo !== null);
  // Vuelve el GPS de verdad
  const { r, cambios } = correr(d, 'M-05', { n: 14, metrosPorSeg: (i) => 2 + (i % 4) * 2.3, ruidoM: 15, desde: T0 + 14 * 10_000 });
  ok('con la ventana llena de posiciones reales, termina', r.sospechoso === false && cambios.some(c => c.cambio === 'termino'), cambios);
  d.olvidar('M-05');
  ok('olvidada, sin motivo', d.estadoDe('M-05').motivo === null);
  ok('cada unidad por su lado', d.estadoDe('M-02').motivo === null);
}

console.log('\nSIN TRAZADO NO HAY «SIN RUIDO», PERO LAS OTRAS DOS SIGUEN');
{
  const d = crearDetectorDeFarsa();
  let r = null;
  for (let i = 0; i < 14; i++) {
    r = d.posicion('M-06', { cuando: T0 + i * 10_000, lat: LAT0 + gr * 60 * i, lng: LNG0, speed: 21.6, desvioM: null });
  }
  ok('sin desvioM, la constante igual lo agarra', r.motivo === 'velocidad_constante', r);
}

console.log('\nLOS NÚMEROS');
ok('doce posiciones de ventana', VENTANA === 12);
{
  const d = crearDetectorDeFarsa({ ventana: 4 });
  const { cambios } = correr(d, 'M-07', { n: 6, metrosPorSeg: () => 6, ruidoM: 0, speedReportada: () => 21.6 });
  ok('la ventana se inyecta', cambios.length === 1 && cambios[0].i === 3, cambios);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
