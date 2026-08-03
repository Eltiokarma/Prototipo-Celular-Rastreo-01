// Una flota falsa manejando la ruta de verdad.
//
//   node herramientas/flota.js
//   node herramientas/flota.js --unidades 20 --ruta R-14
//
// Para qué: para ver el mapa, las brechas y el panel de Despacho con veinte
// combis moviéndose, sin veinte teléfonos ni veinte choferes. Es la única
// forma de mirar cómo se ve la app con la flota llena antes de que exista la
// flota llena.
//
// ═══ POR QUÉ NO SIMULA EN EL CLIENTE ═══════════════════════════════════════
//
// El prototipo viejo (Micros-Tracking) tenía "fantasmas": unidades inventadas
// que la propia app dibujaba, calculando su posición por tiempo. Se ve bien y
// no sirve para lo que hace falta acá, porque **no pasan por el servidor**:
// no tienen brecha calculada, no cuentan para el objetivo automático, no
// disparan "sin señal", no aparecen en Despacho ni en los informes, y sobre
// todo NO PRUEBAN NADA — la parte que se puede romper es justamente la que se
// saltean.
//
// Ésta entra por la puerta: crea usuarios de verdad, hace login de verdad, y
// manda posiciones por el mismo `POST /gps` que usa el teléfono. Para el
// servidor son veinte combis y no se entera de la diferencia. Es la misma
// decisión que en `pruebas/`: sin mocks, porque todo lo que se rompió en este
// proyecto se rompió en la juntura.
//
// ═══ CUIDADO ═══════════════════════════════════════════════════════════════
//
// Esto CREA USUARIOS y ENSUCIA LA BASE del servidor al que le pegues. Contra
// el de producción te deja veinte choferes inventados en la cooperativa y
// vueltas falsas en los informes. Por eso apunta a localhost por defecto y
// hay que pedir explícitamente otra cosa.
'use strict';

const RAIZ = require('path').join(__dirname, '..');

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf('--' + nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const SERVIDOR = opcion('servidor', 'http://localhost:3001');
const RUTA = opcion('ruta', 'R-14');
const CUANTAS = Math.max(1, Math.min(60, Number(opcion('unidades', 20))));
const CLAVE_DESPACHO = opcion('despacho', process.env.DISPATCH_PASSWORD || 'despacho99');
const CLAVE_CHOFER = 'flota1234';
const CADENCIA_MS = Number(opcion('cadencia', 3000));
const PREFIJO = opcion('prefijo', 'F');

// Los nombres son inventados pero verosímiles: en el panel de Despacho una
// lista de "Chofer 1, Chofer 2…" no deja ver si la pantalla aguanta nombres
// largos, que es una de las cosas que se vienen a mirar.
const NOMBRES = [
  'Rufino Quispe', 'Elmer Ccama', 'Ana Colque', 'Wilber Mamani', 'Yeny Apaza',
  'Justo Huanca', 'Nilda Cutipa', 'Fredy Choquehuanca', 'Rosa Ticona', 'Edwin Larico',
  'Marleny Condori', 'Saturnino Pari', 'Gladys Chambi', 'Hernán Coaquira', 'Lucio Vilca',
  'Bertha Sucasaca', 'Román Ccopa', 'Delia Machaca', 'Sabino Turpo', 'Nancy Aroquipa',
];

const dormir = (ms) => new Promise(r => setTimeout(r, ms));
const sinFinal = (u) => u.replace(/\/+$/, '');
const API = sinFinal(SERVIDOR);

async function pedir(ruta, opciones = {}) {
  const r = await fetch(API + ruta, opciones);
  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { ok: r.ok, status: r.status, cuerpo };
}

// ─── La geometría ──────────────────────────────────────────────────────────
// Se le pide AL SERVIDOR el trazado de la ruta y las unidades caminan sobre
// él. Así la flota falsa recorre el recorrido que vos cargaste con el
// trazador, y no un círculo inventado que no se parece a nada.
function aPuntos(tramos) {
  const normal = (pts) => (pts || []).map(p => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p))
    .filter(p => p && isFinite(p.lat) && isFinite(p.lng));
  const ida = normal(tramos?.ida);
  const vuelta = normal(tramos?.vuelta);
  return { ida, vuelta };
}

const R = 6371000;
const rad = (g) => g * Math.PI / 180;
function metros(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const m = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(m));
}

// Un tramo con sus distancias acumuladas, para poder pedir "el punto que está
// a X metros del arranque" sin recalcular todo cada vez.
function medir(puntos) {
  const acum = [0];
  for (let i = 1; i < puntos.length; i++) acum.push(acum[i - 1] + metros(puntos[i - 1], puntos[i]));
  return { puntos, acum, largo: acum[acum.length - 1] || 0 };
}

function puntoA(tramo, d) {
  const { puntos, acum, largo } = tramo;
  if (!puntos.length) return null;
  if (largo <= 0) return puntos[0];
  const x = Math.max(0, Math.min(d, largo));
  let i = 1;
  while (i < acum.length && acum[i] < x) i++;
  const a = puntos[i - 1], b = puntos[Math.min(i, puntos.length - 1)];
  const seg = acum[Math.min(i, acum.length - 1)] - acum[i - 1];
  const t = seg > 0 ? (x - acum[i - 1]) / seg : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// ─── Cada unidad ───────────────────────────────────────────────────────────
//
// Velocidades DISTINTAS a propósito: con todas iguales las brechas quedan
// congeladas y no se ve nunca un "apurá" ni un "aguantá", que es justo lo que
// se viene a mirar. Y descansos en los terminales, que es lo que produce las
// unidades detenidas y los estados de espera.
function crearUnidad(i, tramos) {
  const kmh = 14 + (i % 7) * 2.5;                 // de 14 a 29 km/h
  const vMs = kmh * 1000 / 3600;
  const ida = medir(tramos.ida);
  const vuelta = medir(tramos.vuelta.length ? tramos.vuelta : [...tramos.ida].reverse());
  const descanso = 60 + (i % 5) * 45;             // de 1 a 4 minutos
  const vueltaCompleta = ida.largo / vMs + descanso + vuelta.largo / vMs + descanso;
  // Repartidas a lo largo del recorrido, no todas juntas en el terminal.
  const desfase = (i / CUANTAS) * vueltaCompleta;

  return {
    id: `${PREFIJO}-${String(i + 1).padStart(2, '0')}`,
    nombre: NOMBRES[i % NOMBRES.length] + (i >= NOMBRES.length ? ` ${Math.floor(i / NOMBRES.length) + 1}` : ''),
    kmh, token: null, sesion: null,
    donde(segundos) {
      let t = (segundos + desfase) % vueltaCompleta;
      const tIda = ida.largo / vMs;
      if (t < tIda) return { ...puntoA(ida, t * vMs), speed: kmh, parada: false };
      t -= tIda;
      if (t < descanso) return { ...puntoA(ida, ida.largo), speed: 0, parada: true };
      t -= descanso;
      const tVuelta = vuelta.largo / vMs;
      if (t < tVuelta) return { ...puntoA(vuelta, t * vMs), speed: kmh, parada: false };
      return { ...puntoA(vuelta, vuelta.largo), speed: 0, parada: true };
    },
  };
}

// ─── Arranque ──────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nFlota falsa → ${API}  ·  ruta ${RUTA}  ·  ${CUANTAS} unidades\n`);

  if (!/localhost|127\.0\.0\.1|192\.168\./.test(API) && !args.includes('--si-en-serio')) {
    console.log('Ese servidor NO es local. Esto crea usuarios y ensucia la base:');
    console.log('veinte choferes inventados y vueltas falsas en los informes.');
    console.log('Si de verdad querés, repetí el comando con  --si-en-serio\n');
    process.exit(1);
  }

  const entrar = await pedir('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'DESPACHO', password: CLAVE_DESPACHO }),
  });
  if (!entrar.ok) {
    console.log(`No pude entrar como DESPACHO (${entrar.status}). Probá con --despacho <clave>.`);
    process.exit(1);
  }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + entrar.cuerpo.token };

  const geo = await pedir(`/admin/routes/${RUTA}/points`, { headers: H });
  const tramos = aPuntos(geo.cuerpo?.tramos);
  if (tramos.ida.length < 2) {
    console.log(`La ruta ${RUTA} no tiene trazado cargado, así que no hay por dónde manejar.`);
    console.log('Cargalo con el trazador del panel de Despacho y volvé a correr esto.');
    process.exit(1);
  }
  console.log(`Trazado: ida ${tramos.ida.length} puntos, vuelta ${tramos.vuelta.length}.`);

  const unidades = Array.from({ length: CUANTAS }, (_, i) => crearUnidad(i, tramos));

  // Alta y login. Si el usuario ya existe, el alta falla y el login funciona
  // igual: correr esto dos veces no tiene que romperse.
  for (const u of unidades) {
    await pedir('/admin/users', {
      method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u.id, name: u.nombre, password: CLAVE_CHOFER, routeId: RUTA }),
    });
    const s = await pedir('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u.id, password: CLAVE_CHOFER }),
    });
    if (!s.ok) { console.log(`  ${u.id}: no pudo entrar (${s.status})`); continue; }
    u.token = s.cuerpo.token;
    u.sesion = s.cuerpo;
  }
  const vivas = unidades.filter(u => u.token);
  console.log(`Entraron ${vivas.length}/${CUANTAS}.  Ctrl+C para parar.\n`);
  if (!vivas.length) process.exit(1);

  const desde = Date.now();
  let vueltas = 0;
  for (;;) {
    const segundos = (Date.now() - desde) / 1000;
    let bien = 0, mal = 0;

    // Las posiciones van por `POST /gps`, el MISMO camino que usa el teléfono
    // con la pantalla bloqueada. Si mañana ese endpoint se rompe, esto se
    // rompe con él — que es exactamente lo que se quiere de una herramienta
    // de prueba.
    await Promise.all(vivas.map(async (u) => {
      const p = u.donde(segundos);
      if (!p || !isFinite(p.lat)) return;
      const r = await pedir('/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + u.token },
        body: JSON.stringify({ posiciones: [{ lat: p.lat, lng: p.lng, speed: p.speed, timestamp: Date.now() }] }),
      });
      if (r.ok) bien++; else mal++;
    }));

    vueltas++;
    if (vueltas % 5 === 0 || vueltas === 1) {
      const min = Math.floor(segundos / 60);
      process.stdout.write(`\r  ${min}m  ·  ${bien} ok  ${mal ? mal + ' fallidas' : ''}        `);
    }
    await dormir(CADENCIA_MS);
  }
})().catch(e => {
  console.error('\nSe cortó:', e.message);
  process.exit(1);
});
