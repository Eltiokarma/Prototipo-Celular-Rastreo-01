// La app del chofer: lo que la auditoría del 11/11 encontró en el teléfono.
//
//   A. «Ausente» al terminar el día y manejar a casa: el vigía lo devolvía a
//      «ruta» solo y, como en ruta no hay tope, el teléfono mandaba la
//      ubicación de la casa toda la noche. Ahora el servidor dice en cada
//      POST /gps si la combi ya pisó el trazado (`enRuta`) y, si volvió sola
//      y en 20 min nunca lo pisó, la app sale de ruta.
//   B. El GPS que se apaga sin avisar (reinicio, forzar detención, una
//      actualización, la ubicación apagada): un aviso a futuro que cada envío
//      corre; si el servicio murió, suena.
//
// Lo del teléfono se lee del código (no hay Android acá); la decisión es una
// función pura y se ejecuta de verdad.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');

const DB = S + '/app-auditoria.db';
const P = 3251;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};
const borrarBase = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };
const pedir = (ruta, o = {}) => fetch(API + ruta, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let servidor = null;
(async () => {
  const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8');
  const notif = fs.readFileSync(RAIZ + '/app/notificacion.js', 'utf8');

  console.log('\nA. VOLVIÓ A RUTA SOLO Y NUNCA PISÓ EL TRAZADO');
  // La decisión, ejecutada de verdad
  const cuerpoFn = servicio.slice(servicio.indexOf('export function decidirVueltaSola'));
  const fn = cuerpoFn.slice(0, cuerpoFn.indexOf('\n}\n') + 3).replace('export ', '');
  const constante = /const VOLVIO_SOLO_MAX_MS = [^;]+;/.exec(servicio)[0];
  const decidir = new Function(`${constante}\n${fn}\nreturn decidirVueltaSola;`)();
  const t0 = 1_000_000_000;
  ok('recién vuelto y sin pisar el trazado: todavía nada', decidir(t0, false, t0 + 5 * 60_000) === null);
  ok('pisó el trazado: era una vuelta a ruta de verdad', decidir(t0, true, t0 + 30 * 60_000) === 'confirmada');
  ok('20 min sin pisarlo: se fue a su casa, sale de ruta', decidir(t0, false, t0 + 21 * 60_000) === 'fuera');
  ok('sin vuelta automática, nada', decidir(0, false, t0) === null);
  ok('la vuelta automática del vigía queda anotada',
    /presenciaEfectiva = 'ruta';[\s\S]{0,200}LLAVE_VOLVIO_SOLO, String\(Date\.now\(\)\)/.test(servicio));
  ok('y si toca salir, avisa al servidor y apaga el GPS',
    /decidirVueltaSola\(volvio, cuerpo\.enRuta, Date\.now\(\)\) === 'fuera'[\s\S]{0,1500}\/presencia[\s\S]{0,1200}stopLocationUpdatesAsync/.test(servicio));

  // El servidor dice `enRuta` en cada POST /gps
  borrarBase();
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }
  const d = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const LAT0 = -15.50, LNG = -70.13, g = 3000 / 111320;
  await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: { Authorization: 'Bearer ' + d.token }, body: JSON.stringify({ tramos: {
    ida: [{ lat: LAT0, lng: LNG }, { lat: LAT0 + g, lng: LNG }], vuelta: [{ lat: LAT0 + g, lng: LNG }, { lat: LAT0, lng: LNG }] } }) });
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'M-01', name: 'Chofer Uno', personRole: 'driver', password: 'chofer1234' }) });
  const s = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'M-01', password: 'chofer1234' }) })).body;
  const H = { Authorization: 'Bearer ' + s.token };
  // Lejos del trazado (su casa, a 2 km al costado)
  let t = Date.now() - 60_000;
  let r = await pedir('/gps', { method: 'POST', headers: H, body: JSON.stringify({ presencia: 'ruta',
    posiciones: [0, 1, 2].map(k => ({ lat: LAT0 + 0.01, lng: LNG + 0.02 + k * 1e-4, speed: 30, timestamp: (t += 10_000) })) }) });
  ok('lejos del trazado: enRuta false', r.status === 200 && r.body.enRuta === false, r.body.enRuta);
  r = await pedir('/gps', { method: 'POST', headers: H, body: JSON.stringify({ presencia: 'ruta',
    posiciones: [0, 1, 2].map(k => ({ lat: LAT0 + (300 + k * 100) / 111320, lng: LNG, speed: 30, timestamp: (t += 10_000) })) }) });
  ok('sobre el trazado: enRuta true', r.status === 200 && r.body.enRuta === true, r.body.enRuta);
  servidor.kill();

  console.log('\nB. EL AVISO DE «TU GPS DEJÓ DE MANDAR»');
  ok('se programa a 10 min, con su canal de importancia alta',
    /SILENCIO_AVISO_MS = 10 \* 60_000/.test(notif) && /importance: Notifications\.AndroidImportance\.HIGH/.test(notif) &&
    /identifier: ID_SILENCIO[\s\S]{0,400}seconds: Math\.round\(SILENCIO_AVISO_MS \/ 1000\)/.test(notif));
  ok('cada vez, el anterior se cancela (se corre, no se suma)', /cancelScheduledNotificationAsync\(ID_SILENCIO\)[\s\S]{0,300}scheduleNotificationAsync/.test(notif));
  ok('a lo sumo una vez por minuto', /if \(ahora - silencioCorridoEn < 60_000\) return;/.test(notif));
  ok('cada lectura del GPS en ruta o ausente lo corre (antes del envío: una zona sin señal no es falsa alarma)',
    /if \(presenciaEfectiva === 'ruta' \|\| presenciaEfectiva === 'ausente'\) vigilarSilencio\(\)[\s\S]{0,40}const r = await pedirConCorte\(servidor \+ '\/gps'/.test(servicio));
  ok('salir de ruta, cerrar sesión o el relevo lo apagan',
    /export async function limpiarNotificacion\(\) \{[\s\S]{0,200}apagarVigiaDeSilencio\(\)/.test(notif) &&
    /export async function notificarSinRol\(motivo\) \{\s*\/\/[^\n]*\n\s*apagarVigiaDeSilencio\(\)/.test(notif));

  console.log('\nC. PLAY STORE: LA GALERÍA SIN PERMISO');
  // `blockedPermissions` es nativo: va con la próxima APK (PLAYSTORE.md §3),
  // para que los arreglos de JavaScript lleguen ya por EAS Update a la 0.3.0
  const playstore = fs.readFileSync(RAIZ + '/PLAYSTORE.md', 'utf8');
  ok('la próxima APK bloquea READ_MEDIA_* y READ_EXTERNAL_STORAGE (anotado en PLAYSTORE.md)',
    /"blockedPermissions": \[[\s\S]*READ_MEDIA_IMAGES[\s\S]*READ_EXTERNAL_STORAGE[\s\S]*\]/.test(playstore));
  const foto = fs.readFileSync(RAIZ + '/app/foto.js', 'utf8');
  const elegir = foto.slice(foto.indexOf('export async function elegirFoto'));
  ok('elegir una foto no pide permiso de galería (el selector del sistema no lo necesita)',
    !/pedirPermisoGaleria\(\)/.test(elegir.slice(0, elegir.indexOf('\n}'))));

  await sleep(300);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('LA SUITE SE CAYÓ:', e.stack); if (servidor) servidor.kill(); process.exit(1); });
