// Las puertas: quién entra, con qué, y hasta dónde llega adentro.
//
// Salió de una revisión de seguridad del sistema entero (8/8). Son cinco
// agujeros distintos con una cosa en común: ninguno se veía usando la app.
//
//   1. El BOOTSTRAP de DESPACHO era una puerta abierta con nombre conocido.
//      Si no existía esa fila —y `DISPATCH_PASSWORD` es opcional, y una
//      cooperativa dada de alta desde el panel del creador recibe su
//      supervisor con OTRO nombre— el primer POST anónimo del mundo se
//      creaba la cuenta que administra a todos, con la clave que él eligiera.
//
//   2. El bloqueo por origen leía el PRIMER elemento de `X-Forwarded-For`,
//      que es justo el pedazo que escribe el cliente. Una cabecera distinta
//      por pedido y cada intento estrenaba contador: el único freno contra
//      probar una contraseña en las 2000 cuentas no frenaba nada.
//
//   3. No había forma de CERRAR SESIÓN. El "salir" de las pantallas borraba
//      el token del navegador y nada más: en el servidor seguía valiendo 30
//      días.
//
//   4. Cambiar la contraseña propia no cerraba las otras sesiones, así que
//      el remedio no servía contra la amenaza que lo justifica — un token
//      copiado de un teléfono desbloqueado seguía entrando.
//
//   5. Las grabaciones y el logo se saltaban el alcance por ruta: una
//      gerencia atada a una ruta veía —y bajaba— los trazados de las otras,
//      y podía cambiarle la marca a toda la cooperativa.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let vivos = [];
async function arrancar(db, puerto, env = {}) {
  const srv = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(puerto), DB_FILE: db, STATE_INTERVAL_MS: '500', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  srv.stderr.on('data', d => {
    const s = String(d);
    if (!/GEOAPIFY|clave se crea/.test(s)) process.stderr.write('[srv] ' + s);
  });
  vivos.push(srv);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${puerto}/ping`); return srv; } catch {}
  }
  throw new Error('el servidor no arrancó en ' + puerto);
}
const matar = async (srv) => { srv.kill(); await sleep(500); };
const limpiar = (f) => { for (const x of [f, f + '-wal', f + '-shm']) { try { fs.unlinkSync(x); } catch {} } };

const pedir = (api, ruta, opts = {}) => fetch(api + ruta, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const entrar = (api, user, password, cab = {}) =>
  pedir(api, '/auth/login', { method: 'POST', headers: cab, body: JSON.stringify({ user, password }) });

(async () => {
  // ── 1. EL BOOTSTRAP SOLO EN UN SISTEMA QUE NADIE ADMINISTRA ──────────
  console.log('\nEL BOOTSTRAP DE DESPACHO NO ES UNA PUERTA PERMANENTE');
  {
    const DB = S + '/puertas-boot.db';
    limpiar(DB);
    // Sin DISPATCH_PASSWORD a propósito: es opcional, y ése es el caso.
    let srv = await arrancar(DB, 3186, { DISPATCH_PASSWORD: '' });
    const API = 'http://localhost:3186';

    // Sistema recién nacido, nadie a quien pedirle el alta: el bootstrap
    // tiene que funcionar, porque si no la primera instalación no arranca.
    let r = await entrar(API, 'DESPACHO', 'arranque123');
    ok('en un sistema vacío el bootstrap funciona', r.status === 200 && r.body.created === true,
       { status: r.status, created: r.body.created, role: r.body.role });
    await matar(srv);

    // Ahora el caso real: la cooperativa ya está provisionada desde el panel
    // del creador —con su supervisor llamado como quisieron— y la fila
    // DESPACHO no existe. Antes, cualquiera se la creaba.
    {
      const b = new Database(DB);
      b.prepare("DELETE FROM users WHERE unitId = 'DESPACHO'").run();
      const e = coop.alta(b, { companyId: 'COOP-X', name: 'Cooperativa X' });
      if (e.error) throw new Error('alta empresa: ' + e.error);
      const g = coop.supervisor(b, { companyId: 'COOP-X', usuario: 'JEFE-TURNO', clave: 'jefeturno123' });
      if (g.error) throw new Error('supervisor: ' + g.error);
      ok('el sistema queda administrado por otra cuenta, sin fila DESPACHO',
         !b.prepare("SELECT 1 FROM users WHERE unitId = 'DESPACHO'").get() &&
         !!b.prepare("SELECT 1 FROM users WHERE unitId = 'JEFE-TURNO'").get());
      b.close();
    }
    srv = await arrancar(DB, 3186, { DISPATCH_PASSWORD: '' });

    r = await entrar(API, 'DESPACHO', 'meLaLlevoYo1');
    ok('un anónimo YA NO puede reclamar la cuenta DESPACHO', r.status === 403,
       { status: r.status, error: r.body.error });
    ok('y el error no delata que el sistema esté sin esa cuenta',
       /no registrada/i.test(r.body.error || ''), r.body.error);
    // Y que no la haya creado igual
    {
      const b = new Database(DB, { readonly: true });
      ok('no quedó ninguna cuenta creada por el intento',
         !b.prepare("SELECT 1 FROM users WHERE unitId = 'DESPACHO'").get());
      b.close();
    }
    // El administrador legítimo sigue entrando
    r = await entrar(API, 'JEFE-TURNO', 'jefeturno123');
    ok('el administrador de verdad entra sin problema', r.status === 200 && !!r.body.token,
       { status: r.status, role: r.body.role });

    await matar(srv);
    limpiar(DB);
  }

  // ── 2. EL BLOQUEO POR ORIGEN NO SE ESQUIVA CON UNA CABECERA ──────────
  console.log('\nEL BLOQUEO POR ORIGEN MIRA LO QUE EL CLIENTE NO ESCRIBE');
  {
    // TRUST_PROXY=0 es "no hay proxy adelante": la cabecera se ignora entera.
    const DB = S + '/puertas-xff.db';
    limpiar(DB);
    const srv = await arrancar(DB, 3187, { DISPATCH_PASSWORD: 'despacho99', TRUST_PROXY: '0' });
    const API = 'http://localhost:3187';

    // 35 fallos, cada uno con una IP inventada distinta y contra un usuario
    // distinto: es el ataque que el bloqueo por cuenta no puede ver.
    let bloqueado = false;
    for (let i = 0; i < 35; i++) {
      const r = await entrar(API, `M-${100 + i}`, 'loQueSea1',
        { 'X-Forwarded-For': `203.0.113.${i}` });
      if (r.status === 429) { bloqueado = true; break; }
    }
    ok('sin proxy, inventar la cabecera no evita el bloqueo', bloqueado === true,
       bloqueado ? 'bloqueó' : 'nunca bloqueó');
    await matar(srv);
    limpiar(DB);
  }
  {
    // Con un proxy adelante (TRUST_PROXY=1), la IP real la agrega ÉL al
    // final. Variar sólo lo de la izquierda —lo único que el cliente puede
    // escribir— tiene que seguir cayendo en el mismo contador.
    const DB = S + '/puertas-xff2.db';
    limpiar(DB);
    const srv = await arrancar(DB, 3188, { DISPATCH_PASSWORD: 'despacho99', TRUST_PROXY: '1' });
    const API = 'http://localhost:3188';
    let bloqueado = false;
    for (let i = 0; i < 35; i++) {
      const r = await entrar(API, `M-${200 + i}`, 'loQueSea1',
        { 'X-Forwarded-For': `198.51.100.${i}, 10.0.0.7` });   // el proxy agregó 10.0.0.7
      if (r.status === 429) { bloqueado = true; break; }
    }
    ok('con proxy, sólo cuenta la IP que agregó el proxy (la última)', bloqueado === true,
       bloqueado ? 'bloqueó' : 'nunca bloqueó');
    await matar(srv);
    limpiar(DB);
  }

  // ── 3, 4 y 5 ─────────────────────────────────────────────────────────
  const DB = S + '/puertas.db';
  limpiar(DB);
  const srv = await arrancar(DB, 3189, { DISPATCH_PASSWORD: 'despacho99', REVISAR_SESIONES_MS: '2000' });
  const API = 'http://localhost:3189';
  const D = (await entrar(API, 'DESPACHO', 'despacho99')).body;
  const HD = { Authorization: 'Bearer ' + D.token };
  const HG = { Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  await pedir(API, '/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'M-50', name: 'Chofer cincuenta', personRole: 'driver', password: 'chofer1234' }) });

  console.log('\nCERRAR SESIÓN EXISTE, Y CIERRA DE VERDAD');
  {
    const s1 = (await entrar(API, 'M-50', 'chofer1234')).body;
    const H1 = { Authorization: 'Bearer ' + s1.token };
    let r = await pedir(API, '/perfil', { headers: H1 });
    ok('con el token se entra al perfil', r.status === 200, r.status);

    r = await pedir(API, '/auth/logout', { method: 'POST', headers: H1, body: '{}' });
    ok('cerrar sesión contesta ok', r.status === 200 && r.body.cerradas === 1, r.body);

    r = await pedir(API, '/perfil', { headers: H1 });
    ok('y el token deja de valer EN EL SERVIDOR, no sólo en la pantalla',
       r.status === 401, r.status);

    // Cerrar una sesión que ya no existe no puede fallar ni delatar nada
    r = await pedir(API, '/auth/logout', { method: 'POST', headers: H1, body: '{}' });
    ok('cerrar dos veces no falla ni dice si el token existía',
       r.status === 200 && r.body.cerradas === 0, r.body);
  }

  console.log('\nY SE PUEDEN CERRAR TODAS: EL TELÉFONO QUE SE PERDIÓ');
  {
    const a = (await entrar(API, 'M-50', 'chofer1234')).body;
    const b = (await entrar(API, 'M-50', 'chofer1234')).body;
    const HA = { Authorization: 'Bearer ' + a.token };
    const HB = { Authorization: 'Bearer ' + b.token };
    const r = await pedir(API, '/auth/logout', { method: 'POST', headers: HA,
      body: JSON.stringify({ todas: true }) });
    ok('cierra las dos', r.status === 200 && r.body.cerradas === 2, r.body);
    ok('la del otro dispositivo ya no vale',
       (await pedir(API, '/perfil', { headers: HB })).status === 401);
    ok('y la propia tampoco', (await pedir(API, '/perfil', { headers: HA })).status === 401);
  }

  console.log('\nCAMBIAR LA CLAVE ECHA AL QUE COPIÓ EL TOKEN');
  {
    const propio = (await entrar(API, 'M-50', 'chofer1234')).body;
    const robado = (await entrar(API, 'M-50', 'chofer1234')).body;
    const HP = { Authorization: 'Bearer ' + propio.token };
    const HR = { Authorization: 'Bearer ' + robado.token };
    ok('el token copiado entra, como entraría el ladrón',
       (await pedir(API, '/perfil', { headers: HR })).status === 200);

    const r = await pedir(API, '/perfil/clave', { method: 'POST', headers: HP,
      body: JSON.stringify({ actual: 'chofer1234', nueva: 'nueva123456' }) });
    ok('el dueño cambia su clave con la actual en la mano', r.status === 200, r.body);
    ok('y eso cierra la sesión copiada',
       (await pedir(API, '/perfil', { headers: HR })).status === 401);
    // Lo que NO tiene que pasar: que se eche a sí mismo del teléfono en el
    // mismo acto de cuidarlo.
    ok('sin echarlo a él de su propio teléfono',
       (await pedir(API, '/perfil', { headers: HP })).status === 200);
  }

  console.log('\nEL ALCANCE POR RUTA TAMBIÉN VALE PARA GRABACIONES Y LOGO');
  {
    // Dos rutas en la misma cooperativa, y una gerencia atada a UNA.
    const b = new Database(DB);
    const empresa = b.prepare("SELECT companyId FROM users WHERE unitId = 'DESPACHO'").get().companyId;
    coop.altaRuta(b, { companyId: empresa, routeId: 'R-99', name: 'Ruta noventa y nueve' });
    const g = coop.gerente(b, { companyId: empresa, usuario: 'GER-R99', clave: 'gerr99clave', routeId: 'R-99' });
    if (g.error) throw new Error('gerente de ruta: ' + g.error);
    // Una grabación de CADA ruta, puestas directo en la base
    const ins = b.prepare(`INSERT INTO recordings (personId, companyId, routeId, nombre, puntos, cantidad, largoM, createdAt)
                           VALUES (?, ?, ?, ?, ?, 2, 100, ?)`);
    const pts = JSON.stringify([{ lat: -15.5, lng: -70.13 }, { lat: -15.49, lng: -70.13 }]);
    ins.run('M-50', empresa, 'R-14', 'la de la ruta ajena', pts, Date.now());
    const ajena = b.prepare('SELECT id FROM recordings ORDER BY id DESC LIMIT 1').get().id;
    ins.run('M-50', empresa, 'R-99', 'la suya', pts, Date.now());
    b.close();

    const HR99 = { Authorization: 'Bearer ' + (await entrar(API, 'GER-R99', 'gerr99clave')).body.token };

    let r = await pedir(API, '/admin/grabaciones', { headers: HR99 });
    const rutas = (r.body.grabaciones || []).map(x => x.routeId);
    ok('la gerencia de una ruta sólo ve las grabaciones de SU ruta',
       rutas.length === 1 && rutas[0] === 'R-99', rutas);

    r = await pedir(API, `/admin/grabaciones/${ajena}.geojson`, { headers: HR99 });
    ok('y bajar la de otra ruta da 404, no el trazado', r.status === 404, r.status);
    ok('con un error que no confirma que exista',
       /no existe/i.test(r.body.error || ''), r.body.error);

    // El supervisor de toda la cooperativa sí las ve las dos
    r = await pedir(API, '/admin/grabaciones', { headers: HD });
    ok('el supervisor de la cooperativa sigue viéndolas todas',
       (r.body.grabaciones || []).length === 2, (r.body.grabaciones || []).length);

    // El logo es de la cooperativa entera
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    r = await pedir(API, '/admin/company/logo', { method: 'PUT', headers: HR99,
      body: JSON.stringify({ logo: png }) });
    ok('una gerencia de ruta NO puede cambiarle la marca a toda la cooperativa',
       r.status === 403, { status: r.status, error: r.body.error });
    r = await pedir(API, '/admin/company/logo', { method: 'PUT', headers: HR99,
      body: JSON.stringify({ logo: null }) });
    ok('ni borrarla', r.status === 403, r.status);
  }

  console.log('\nLO QUE MANDA EL TELÉFONO SE MIRA ANTES DE CREERLE');
  {
    const WebSocket = require(RAIZ + '/server/node_modules/ws');
    const s = (await entrar(API, 'M-50', 'nueva123456')).body;
    const ws = new WebSocket('ws://localhost:3189');
    await new Promise(r => ws.on('open', r));
    const estados = [];
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'state') estados.push(m); });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(700);

    // 1. Una latitud que no es un número. Llegaba hasta Leaflet en el panel
    //    y dejaba en blanco la pantalla de todos los despachadores de la
    //    ruta; y en el SOS, el toFixed de la auditoría mataba el proceso.
    ws.send(JSON.stringify({ type: 'gps', lat: 'x', lng: 'x', speed: 20 }));
    await sleep(900);
    let mia = (estados.at(-1)?.units || []).find(u => u.unitId === 'M-50');
    ok('una coordenada que no es número no entra al mapa',
       !mia || typeof mia.lat === 'number', mia && { lat: mia.lat, tipo: typeof mia.lat });

    // 2. Un progreso de 999 no le arruina la brecha AL DE ADELANTE
    ws.send(JSON.stringify({ type: 'gps', lat: -15.49, lng: -70.13, speed: 20, routeProgress: 999 }));
    await sleep(900);
    mia = (estados.at(-1)?.units || []).find(u => u.unitId === 'M-50');
    ok('un progreso fuera de 0..1 se descarta, no ordena la cadena',
       !!mia && mia.routeProgress >= 0 && mia.routeProgress <= 1,
       mia && mia.routeProgress);

    // 3. Un SOS con coordenadas basura: la emergencia SALE igual —eso no se
    //    negocia— pero no tumba el servidor ni guarda una posición inventada.
    ws.send(JSON.stringify({ type: 'sos', lat: '1', lng: '1', timestamp: 1 }));
    await sleep(900);
    ok('el servidor sigue en pie tras un SOS con coordenadas basura',
       (await pedir(API, '/ping')).status === 200);

    const b0 = new Database(DB, { readonly: true });
    const sos = b0.prepare("SELECT lat, lng, timestamp FROM messages WHERE kind = 'sos' ORDER BY id DESC LIMIT 1").get();
    b0.close();
    ok('la emergencia quedó registrada igual', !!sos, sos);
    ok('sin la coordenada inventada', !!sos && sos.lat === null, sos && sos.lat);
    // Con timestamp 1 la fila existía pero no aparecía en NINGÚN informe
    // fechado, y la poda la borraba por vieja: la emergencia ocurría y no
    // dejaba rastro.
    ok('y con una hora que cae dentro del informe, no en 1970',
       !!sos && Math.abs(sos.timestamp - Date.now()) < 6 * 3600_000, sos && sos.timestamp);

    ws.close();
  }

  console.log('\nUNA SESIÓN REVOCADA CORTA TAMBIÉN EL WEBSOCKET');
  {
    const WebSocket = require(RAIZ + '/server/node_modules/ws');
    const s = (await entrar(API, 'M-50', 'nueva123456')).body;
    const ws = new WebSocket('ws://localhost:3189');
    await new Promise(r => ws.on('open', r));
    let echado = null;
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'auth_error') echado = m.error; });
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(700);

    // Se revoca por afuera, como lo hace suspender una cooperativa: borrando
    // la fila y nada más. Antes, el socket seguía recibiendo todo.
    const b1 = new Database(DB);
    b1.prepare('DELETE FROM sessions WHERE token = ?').run(s.token);
    b1.close();

    // El barrido corre cada REVISAR_SESIONES_MS (2 s en esta prueba)
    for (let i = 0; i < 20 && !echado && ws.readyState === 1; i++) await sleep(400);
    ok('al socket se le avisa y se lo cierra', !!echado, echado || 'siguió abierto');
    ok('y queda cerrado', ws.readyState !== 1, ws.readyState);
    try { ws.close(); } catch {}
  }

  await matar(srv);
  limpiar(DB);

  // ── EL MODO DEMO NO SE ENCIENDE SOLO EN PRODUCCIÓN ───────────────────
  //
  // `OPEN_REGISTRATION=1` es la última puerta cruzada entre cooperativas:
  // quien se auto-registra elige su `unitId` y queda SIN vehículo, y "mi
  // combi" se resuelve como `vehicleId || unitId` — así que con el código de
  // una combi ajena administraba a los cobradores de otra cooperativa.
  //
  // Era un cartel en el log. Un cartel depende de que alguien lo lea, y las
  // variables de un deploy se copian del deploy anterior sin mirarlas.
  console.log('\nCON REGISTRO ABIERTO Y SIN DECLARAR DEMO, EL SERVIDOR NO ARRANCA');
  {
    // Arranca y se espera a que TERMINE, que es justo lo contrario de lo que
    // hace `arrancar()`: acá lo que se mide es que se muera y con qué código.
    const intentar = (env) => new Promise((resolve) => {
      const DBX = S + '/puertas-demo.db';
      limpiar(DBX);
      const p = spawn('node', [RAIZ + '/server/index.js'], {
        env: { ...process.env, PORT: '3190', DB_FILE: DBX, DISPATCH_PASSWORD: 'despacho99', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let salida = '';
      p.stdout.on('data', d => { salida += d; });
      p.stderr.on('data', d => { salida += d; });
      const corte = setTimeout(() => { p.kill(); resolve({ codigo: null, salida }); }, 12_000);
      p.on('exit', (codigo) => { clearTimeout(corte); limpiar(DBX); resolve({ codigo, salida }); });
    });

    let r = await intentar({ OPEN_REGISTRATION: '1' });
    ok('con OPEN_REGISTRATION y sin MODO=demo, se niega a arrancar',
       r.codigo === 1, { codigo: r.codigo });
    ok('y el mensaje NOMBRA la variable que está mal',
       /OPEN_REGISTRATION/.test(r.salida), r.salida.slice(0, 80));
    ok('dice por qué es peligrosa, no sólo que lo es',
       /otra cooperativa|cooperativa/i.test(r.salida));
    ok('y dice cómo desactivarla',
       /sacá OPEN_REGISTRATION/i.test(r.salida) && /MODO=demo/.test(r.salida));

    // Que un valor cualquiera no valga como declaración de demo
    r = await intentar({ OPEN_REGISTRATION: '1', MODO: 'produccion' });
    ok('un MODO que no es "demo" tampoco lo habilita', r.codigo === 1, { codigo: r.codigo });

    // Y que el servidor normal —sin la variable— no se vea afectado
    r = await intentar({ MODO: '' });
    ok('sin la variable, arranca como siempre (no muere solo)',
       r.codigo === null, { codigo: r.codigo });
  }

  console.log('\nY LA DEMO SIGUE SIENDO UNA DEMO');
  {
    const DBD = S + '/puertas-demo2.db';
    limpiar(DBD);
    const srvD = await arrancar(DBD, 3190,
      { DISPATCH_PASSWORD: 'despacho99', OPEN_REGISTRATION: '1', MODO: 'demo' });
    const APID = 'http://localhost:3190';
    ok('declarando MODO=demo arranca', (await pedir(APID, '/ping')).status === 200);

    // Lo que la demo tiene que seguir haciendo: registrarse sola
    const r = await entrar(APID, 'M-DEMO', 'demo12345');
    ok('y el registro abierto sigue funcionando', r.status === 200 && !!r.body.token,
       { status: r.status, created: r.body.created });

    // El segundo cerrojo: aun EN demo, el auto-registrado no llega a los
    // cobradores de otra cooperativa. El arranque ya lo impide en producción;
    // esto es que la regla valga sola, sin depender de las variables.
    {
      const b = new Database(DBD);
      const e = coop.alta(b, { companyId: 'COOP-Z', name: 'Cooperativa Z' });
      if (e.error) throw new Error('alta: ' + e.error);
      coop.altaRuta(b, { companyId: 'COOP-Z', routeId: 'R-Z', name: 'Ruta Z' });
      // Una combi y su cobrador, en la OTRA cooperativa
      b.prepare(`INSERT INTO vehicles (vehicleId, label, routeId, companyId, createdAt)
                 VALUES ('M-AJENA', 'Placa', 'R-Z', 'COOP-Z', ?)`).run(Date.now());
      b.prepare(`INSERT INTO users (unitId, passHash, role, routeId, companyId, name, driverName, vehicleId, createdAt)
                 VALUES ('C-AJENO', 'x:x', 'collector', 'R-Z', 'COOP-Z', 'Cobrador ajeno', 'Cobrador ajeno', 'M-AJENA', ?)`)
        .run(Date.now());
      b.close();
    }
    // El atacante se registra eligiendo como usuario el CÓDIGO de esa combi
    const atacante = await entrar(APID, 'M-AJENA', 'atacante123');
    ok('el atacante se auto-registra con el código de una combi ajena',
       atacante.status === 200, atacante.status);
    const HA = { Authorization: 'Bearer ' + atacante.body.token };

    let a = await pedir(APID, '/perfil/cobradores/C-AJENO/clave', { method: 'POST', headers: HA,
      body: JSON.stringify({ nueva: 'meLaRobo123' }) });
    ok('pero NO puede cambiarle la clave al cobrador de la otra cooperativa',
       a.status === 404, { status: a.status, error: a.body.error });
    a = await pedir(APID, '/perfil/cobradores/C-AJENO', { method: 'DELETE', headers: HA });
    ok('ni darlo de baja', a.status === 404, a.status);
    {
      const b = new Database(DBD, { readonly: true });
      ok('y el cobrador ajeno sigue existiendo',
         !!b.prepare("SELECT 1 FROM users WHERE unitId = 'C-AJENO'").get());
      b.close();
    }

    await matar(srvD);
    limpiar(DBD);
  }

  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('FALLA (excepción):', e);
  for (const s of vivos) { try { s.kill(); } catch {} }
  process.exit(1);
});
