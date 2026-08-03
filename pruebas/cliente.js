// El cliente del protocolo (`app/protocolo/cliente.js`), contra el servidor
// de verdad. Es el módulo que va a usar la app nativa, así que lo que falle
// acá falla arriba de una combi.
//
// Levanta su propio servidor: no depende de que haya uno en 3001.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { crearCliente } = require(RAIZ + '/app/protocolo/cliente.js');
const fs = require('fs');

const DB = S + '/cliente-test.db';
const P = 3141;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// El mismo anillo que usan los bancos visuales, para que todo el repo hable
// de la misma geografía.
const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', STATE_INTERVAL_MS: '600',
           // Plazos cortos: probar el "sin señal" con los 30 s de producción
           // haría una suite de un minuto para una sola comprobación.
           SIN_SENAL_MS: '2000', OLVIDAR_MS: '60000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const nuevo = () => crearCliente({ servidor: API, WebSocketImpl: WebSocket });

// Espera a que una condición se cumpla, o se rinde. Las brechas dependen de
// que el servidor emita estado, así que dormir un rato fijo es frágil.
async function hasta(cond, ms = 6000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(120); }
  return false;
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const despacho = nuevo();
  const d = await despacho.entrar('DESPACHO', 'despacho99');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token };

  const ida    = Array.from({ length: 30 }, (_, i) => anillo(i / 58));
  const vuelta = Array.from({ length: 30 }, (_, i) => anillo(0.5 + i / 58));
  await fetch(`${API}/admin/routes/R-14/points`, { method: 'PUT', headers: H,
    body: JSON.stringify({ tramos: { ida, vuelta } }) });
  const db = new Database(DB);
  db.prepare("UPDATE routes SET durationMin=50, targetGapMin=2, autoTarget=0 WHERE routeId='R-14'").run();
  db.close();
  for (const [u, n] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama'], ['M-20', 'Ana Colque']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: n, password: 'chofer1234' }) });
  }

  console.log('\nENTRAR');
  const s12 = await nuevo().entrar('M-12', 'chofer1234');
  ok('la sesión trae persona, vehículo y ruta',
     s12.unitId === 'M-12' && s12.vehicleId === 'M-12' && s12.routeId === 'R-14');
  let err = null;
  try { await nuevo().entrar('M-12', 'equivocada'); } catch (e) { err = e; }
  ok('la contraseña mal da 401 y no una excepción cualquiera', err?.status === 401, err?.message);

  console.log('\nCONECTAR');
  const c12 = nuevo();
  await c12.entrar('M-12', 'chofer1234');
  const eventos = [];
  ['rolGps', 'estado', 'geometria', 'historial'].forEach(e => c12.on(e, () => eventos.push(e)));
  c12.conectar(s12.token);
  ok('llega el estado al identificarse', await hasta(() => c12.conectado));
  ok('y también el rol de GPS y la geometría',
     eventos.includes('rolGps') && eventos.includes('geometria'), eventos);
  ok('la geometría viene normalizada a {lat,lng}',
     typeof c12.geometria?.tramos?.ida?.[0]?.lat === 'number',
     c12.geometria?.tramos?.ida?.[0]);

  console.log('\nEL ROL DE GPS');
  ok('el chofer que entra primero reporta', c12.reportaGps === true);

  const c20 = nuevo();      // un acompañante en OTRA unidad, para no robar rol
  await c20.entrar('M-20', 'chofer1234');
  c20.conectar((await nuevo().entrar('M-20', 'chofer1234')).token);
  await hasta(() => c20.conectado);

  // El relevo: otro chofer entra a la MISMA unidad y se lleva el rol.
  const relevo = nuevo();
  const sRelevo = await relevo.entrar('M-12', 'chofer1234');
  let perdido = null;
  c12.on('rolGps', r => { if (!r.reporta) perdido = r; });
  relevo.conectar(sRelevo.token);
  ok('el que entra después se lleva el reporte', await hasta(() => relevo.reportaGps === true));
  ok('y al anterior se le avisa con motivo', await hasta(() => perdido !== null) && !!perdido.motivo,
     perdido?.motivo);
  ok('el relevado deja de creer que reporta', c12.reportaGps === false);
  ok('y su mandarGps se niega en vez de mandar al vacío',
     c12.mandarGps({ lat: LAT0, lng: LNG0 }) === 'sin-rol');
  c12.salir();

  console.log('\nBRECHAS');
  const c08 = nuevo();
  const s08 = await c08.entrar('M-08', 'chofer1234');
  c08.conectar(s08.token);
  await hasta(() => c08.conectado);

  // M-08 adelante, el relevo de M-12 atrás, separados 1/25 del anillo.
  const posA = anillo(0.10), posB = anillo(0.06);
  await hasta(() => c08.reportaGps);
  c08.mandarGps({ lat: posA.lat, lng: posA.lng, speed: 24 });
  relevo.mandarGps({ lat: posB.lat, lng: posB.lng, speed: 21 });
  ok('la de atrás ve a la de adelante',
     await hasta(() => relevo.miBrecha().adelante?.unidad === 'M-08'),
     relevo.miBrecha());

  const b = relevo.miBrecha();
  ok('la brecha viene como "MM:SS"', /^\d{2}:\d{2}$/.test(b.adelante?.tiempo || ''), b.adelante);
  ok('y el objetivo de la ruta viaja con ella', b.objetivoMin === 2, b.objetivoMin);

  // Lo que más importa de todo el módulo: sin nadie atrás, null. Ni "00:00",
  // ni un valor de relleno. Es el bug que tuvo la app web.
  ok('sin nadie atrás, el lado viene null y no un tiempo inventado',
     b.atras === null, b.atras);
  ok('y la de adelante tampoco inventa a quién tiene delante',
     c08.miBrecha().adelante === null, c08.miBrecha().adelante);

  ok('la de adelante viene sin marca de sin señal', b.adelante?.sinSenal === false, b.adelante);

  ok('otrasUnidades no me incluye a mí',
     relevo.otrasUnidades().every(u => u.unitId !== 'M-12') &&
     relevo.otrasUnidades().some(u => u.unitId === 'M-08'),
     relevo.otrasUnidades().map(u => u.unitId));
  ok('miUnidad sí soy yo', relevo.miUnidad()?.unitId === 'M-12');

  console.log('\nLA SESIÓN GUARDADA (LA SEGUNDA VEZ QUE SE ABRE LA APP)');
  {
    // El token dura 30 días, así que de la segunda apertura en adelante NADIE
    // llama a `entrar()`: se conecta con la sesión que quedó en el disco. Si
    // el cliente no la recibe, no sabe quién es — y eso NO da ningún error:
    // el HUD dice "sin nadie" para siempre, los mensajes propios del chat se
    // ven como ajenos, y en el mapa ninguna unidad es "yo", así que el chofer
    // no se ve a sí mismo y CENTRARME no tiene a dónde ir.
    const guardada = await nuevo().entrar('M-08', 'chofer1234');

    // Así es como se reabre la app: cliente NUEVO, sin entrar, con lo del disco.
    const reabierto = nuevo();
    reabierto.conectar(guardada.token, guardada);
    ok('conecta con la sesión guardada', await hasta(() => reabierto.conectado));
    ok('y sabe quién es', reabierto.sesion?.vehicleId === 'M-08', reabierto.sesion?.vehicleId);
    ok('así que se encuentra a sí mismo en el estado',
       await hasta(() => reabierto.miUnidad() !== null), reabierto.miUnidad()?.unitId);
    ok('y su brecha no es la de un desconocido',
       reabierto.miBrecha().objetivoMin !== null, reabierto.miBrecha());
    reabierto.salir();

    // Y sin la sesión, que es como estaba: conecta igual, recibe estado
    // igual, y NO se encuentra. Ésta es la trampa, escrita.
    const ciego = nuevo();
    ciego.conectar(guardada.token);
    ok('sin la sesión igual conecta (por eso no se notaba)',
       await hasta(() => ciego.conectado));
    ok('recibe el estado con las unidades adentro',
       await hasta(() => (ciego.estado?.units || []).length > 0),
       (ciego.estado?.units || []).length);
    ok('pero NO se encuentra a sí mismo', ciego.miUnidad() === null, ciego.miUnidad());
    ok('y las otras unidades le parecen todas ajenas, incluida la suya',
       ciego.otrasUnidades().some(u => u.unitId === 'M-08'),
       ciego.otrasUnidades().map(u => u.unitId));
    ciego.salir();
  }

  console.log('\nCUANDO EL DE ADELANTE SE QUEDA SIN SEÑAL');
  // M-08 deja de reportar; el relevo (M-12) sigue quieto donde estaba. Los
  // tres estados de un lado tienen que quedar distinguibles: hay alguien y
  // sé a cuánto / hay alguien y no sé / no hay nadie.
  const sostener = setInterval(() => relevo.mandarGps({ lat: posB.lat, lng: posB.lng, speed: 21 }), 1500);
  ok('el lado pasa a sin señal, no a vacío',
     await hasta(() => relevo.miBrecha().adelante?.sinSenal === true, 9000),
     relevo.miBrecha().adelante);
  const sinSenal = relevo.miBrecha().adelante;
  ok('y conserva a quién tiene adelante', sinSenal?.unidad === 'M-08', sinSenal);
  ok('pero sin tiempo, que es lo que no se sabe', sinSenal?.tiempo === null, sinSenal);
  ok('"sin señal" y "no hay nadie" NO se confunden',
     relevo.miBrecha().atras === null && sinSenal !== null,
     { adelante: sinSenal, atras: relevo.miBrecha().atras });
  clearInterval(sostener);

  console.log('\nEL FRENO DE CADENCIA');
  // El servidor descarta en silencio pasado el cupo: el cliente cree que
  // mandó. El freno existe para que eso no pase nunca sin enterarse.
  const frenado = nuevo();
  const sf = await frenado.entrar('M-20', 'chofer1234');
  frenado.conectar(sf.token);
  await hasta(() => frenado.conectado && frenado.reportaGps);
  let rechazos = 0, aceptados = 0;
  for (let i = 0; i < 60; i++) {
    const r = frenado.mandarGps({ lat: posB.lat, lng: posB.lng, speed: 10 });
    if (r === 'cupo') rechazos++; else if (r === null) aceptados++;
  }
  ok('frena antes del cupo del servidor (40/min)', aceptados <= 35 && aceptados > 0, { aceptados, rechazos });
  ok('y dice que fue por cupo, no en silencio', rechazos > 0, rechazos);
  frenado.salir();

  console.log('\nCHAT Y SOS');
  const recibidos = [];
  c08.on('chat', m => recibidos.push(m));
  relevo.mandarChat('probando el grupo');
  ok('el mensaje de grupo llega a la otra unidad',
     await hasta(() => recibidos.some(m => m.text === 'probando el grupo')),
     recibidos.map(m => m.text));

  const privados = [];
  c08.on('chat', m => { if (m.toVehicleId) privados.push(m); });
  relevo.mandarChat('esto es para Despacho', { privado: true });
  await sleep(900);
  ok('el privado NO le llega a otra unidad', privados.length === 0, privados);

  const sos = [];
  c08.on('sos', a => sos.push(a));
  relevo.mandarSos({ lat: posB.lat, lng: posB.lng });
  ok('el SOS llega a la ruta con quién lo mandó',
     await hasta(() => sos.some(a => a.vehicleId === 'M-12')), sos);

  console.log('\nCAÍDAS');
  const caido = nuevo();
  const sc = await caido.entrar('M-20', 'chofer1234');
  let bajo = false;
  caido.on('conexion', c => { if (!c.conectado) bajo = true; });
  caido.conectar(sc.token);
  await hasta(() => caido.conectado);
  ok('al cortarse, deja de creer que reporta GPS',
     (caido.salir(), caido.reportaGps === false));

  const malo = nuevo();
  let authErr = null;
  malo.on('authError', e => { authErr = e; });
  malo.conectar('token-que-no-existe');
  ok('un token inválido da authError y no reintenta', await hasta(() => authErr !== null), authErr);

  [c08, c20, relevo, malo].forEach(c => { try { c.salir(); } catch {} });
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
