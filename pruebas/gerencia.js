// El gerente y el administrador comparten el panel de Despacho: el gerente
// es la cuenta de ARRIBA, con más permisos. Esta suite prueba los dos lados
// de esa frase: que el gerente pueda lo que el admin no —los ACTIVOS:
// vehículos con placa, datos de la empresa, logo— y que ninguno de los dos
// se asome a la cooperativa de al lado. Los números de /gerencia/* siguen
// siendo solo del gerente: nadie audita su propio trabajo.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn, execFileSync } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/gerencia-test.db';
const P = 3131;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const cli = (...args) => execFileSync('node', [RAIZ + '/server/empresa.js', ...args],
  { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const pedir = (ruta, token, opts = {}) => fetch(API + ruta, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  // Dos cooperativas, cada una con su ruta, su despacho y su gerente
  cli('ruta', 'R14', 'R-99', 'Segunda ruta');
  cli('gerencia', 'R14', 'GER-EMPRESA', 'claveGerente1');            // toda la cooperativa
  cli('gerencia', 'R14', 'GER-RUTA', 'claveGerente2', '--ruta', 'R-14'); // solo R-14
  cli('alta', 'COOP-B', 'Cooperativa Beta', '--ruta', 'RB-1',
    '--despacho', 'DESP-B', '--clave', 'clavebeta12');
  cli('gerencia', 'COOP-B', 'GER-B', 'claveGerente3');

  // Una vuelta en cada ruta, para que haya algo que ver y algo que NO ver
  const db = new Database(DB);
  const vari = (r) => {
    const v = db.prepare('SELECT variantId FROM route_variants WHERE routeId = ? AND activa = 1').get(r);
    return v ? v.variantId : null;
  };
  const meter = (unit, ruta, brecha) => db.prepare(
    `INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm)
     VALUES (?, ?, ?, ?, ?, 3000, 22, ?)`
  ).run(unit, ruta, vari(ruta), Date.now() - 3000e3, Date.now() - 60e3, brecha);
  meter('M-01', 'R-14', 120);
  meter('M-02', 'R-14', 300);
  meter('N-01', 'R-99', 120);
  meter('B-01', 'RB-1', 120);
  db.close();

  console.log('\nLA PUERTA');
  const G = (await login('GER-EMPRESA', 'claveGerente1')).body;
  ok('el gerente entra y su rol lo dice', G.role === 'manager', G.role);
  ok('y trae su cooperativa', G.companyId === 'R14', G.companyId);
  ok('y entra al panel eligiendo ruta, como un supervisor', G.supervisor === true, G.supervisor);

  const D = (await login('DESPACHO', 'despacho99')).body;

  console.log('\nMIRA LO SUYO');
  {
    const r = await pedir('/gerencia/resumen', G.token);
    ok('el resumen responde', r.status === 200, r.status);
    ok('con las dos rutas de su cooperativa', r.body.rutas.length === 2,
      r.body.rutas && r.body.rutas.map(x => x.routeId));
    ok('y las vueltas de las dos, no la de la otra cooperativa',
      r.body.totales.vueltas === 3, r.body.totales.vueltas);
    ok('el alcance dice que no está fijado a una ruta',
      r.body.alcance.routeId === null && r.body.alcance.fijo === false, r.body.alcance);
    ok('cada ruta viene con su objetivo, no con un promedio',
      r.body.rutas.every(x => typeof x.objetivoSec === 'number'), r.body.rutas);
    // M-01 en 2:00 contra objetivo 2:00 cumple; M-02 en 5:00 no
    ok('el cumplimiento sale de comparar cada vuelta con el objetivo de SU ruta',
      r.body.totales.cumplimiento === 67, r.body.totales.cumplimiento);
    ok('compara unidad por unidad', r.body.porUnidad.length === 3,
      r.body.porUnidad.map(u => u.unitId));
    // Las salidas del recorrido cierran el cuadro: cuántas vueltas dio cada
    // unidad ya se sabía, cuántas veces se salió no. Sin desvíos en la base
    // el número es cero, no un hueco — cero significa "no se salió".
    ok('cada unidad trae sus salidas del recorrido',
      r.body.porUnidad.every(u => u.desvios === 0 && u.desvioSec === 0),
      r.body.porUnidad.map(u => `${u.unitId}:${u.desvios}`));
    ok('y el total del período también', r.body.totales.desvios === 0, r.body.totales.desvios);
  }

  console.log('\nUN GERENTE DE RUTA NO VE LAS OTRAS RUTAS DE SU EMPRESA');
  {
    const GR = (await login('GER-RUTA', 'claveGerente2')).body;
    const r = await pedir('/gerencia/resumen', GR.token);
    ok('solo ve la suya', r.body.rutas.length === 1 && r.body.rutas[0].routeId === 'R-14',
      r.body.rutas.map(x => x.routeId));
    ok('y solo sus vueltas', r.body.totales.vueltas === 2, r.body.totales.vueltas);
    ok('la pantalla sabe que el alcance está fijado', r.body.alcance.fijo === true);
    // Pedir la otra ruta de su propia empresa no la abre: el alcance manda
    const otra = await pedir('/gerencia/resumen?routeId=R-99', GR.token);
    ok('pedir otra ruta de su empresa no se la muestra',
      otra.body.rutas.length === 1 && otra.body.rutas[0].routeId === 'R-14',
      otra.body.rutas.map(x => x.routeId));
  }

  console.log('\nNO VE LA COOPERATIVA DE AL LADO');
  {
    const ajena = await pedir('/gerencia/resumen?routeId=RB-1', G.token);
    ok('una ruta ajena se responde como inexistente, no vacía', ajena.status === 404, ajena.status);
    const GB = (await login('GER-B', 'claveGerente3')).body;
    const suyo = await pedir('/gerencia/resumen', GB.token);
    ok('el gerente de la otra ve la suya y nada más',
      suyo.body.totales.vueltas === 1 && suyo.body.rutas[0].routeId === 'RB-1',
      { vueltas: suyo.body.totales.vueltas, rutas: suyo.body.rutas.map(x => x.routeId) });
  }

  console.log('\nEL GERENTE ADMINISTRA — Y PUEDE LO QUE DESPACHO NO');
  {
    // El mismo panel que Despacho, con más permisos: lo que existe lo ven
    // los dos; los ACTIVOS los decide el gerente.
    for (const ruta of ['/admin/users', '/admin/routes', '/admin/company']) {
      const r = await pedir(ruta, G.token);
      ok(`${ruta} le responde 200`, r.status === 200, r.status);
    }

    // Vehículos: el gerente los crea (con su placa); Despacho no.
    const placa = await pedir('/admin/vehicles', G.token, {
      method: 'POST', body: JSON.stringify({ vehicleId: 'M-77', label: 'V7X-889', routeId: 'R-14' }),
    });
    ok('el gerente da de alta un vehículo con placa', placa.status === 200, placa.body);
    const placaD = await pedir('/admin/vehicles', D.token, {
      method: 'POST', body: JSON.stringify({ vehicleId: 'M-78', routeId: 'R-14' }),
    });
    ok('Despacho NO puede crear vehículos', placaD.status === 403, placaD.status);
    ok('y el error dice quién sí', /gerencia/i.test(placaD.body.error || ''), placaD.body.error);

    // Personas: Despacho da de alta AYUDANTES sobre vehículos que existen.
    // Crear el vehículo al vuelo (chofer sin combi cargada) es del gerente.
    const chofer = await pedir('/admin/users', D.token, {
      method: 'POST', body: JSON.stringify({
        unitId: 'CH-77', name: 'Rufino Quispe', password: 'clave1234', vehicleId: 'M-77', routeId: 'R-14',
      }),
    });
    ok('Despacho sube un chofer a un vehículo existente', chofer.status === 200, chofer.body);
    const sinCombi = await pedir('/admin/users', D.token, {
      method: 'POST', body: JSON.stringify({ unitId: 'CH-88', name: 'Elmer Ccama', password: 'clave1234', routeId: 'R-14' }),
    });
    ok('pero no inventa el vehículo al pasar', sinCombi.status === 403, sinCombi.status);
    const conGerente = await pedir('/admin/users', G.token, {
      method: 'POST', body: JSON.stringify({ unitId: 'CH-88', name: 'Elmer Ccama', password: 'clave1234', routeId: 'R-14' }),
    });
    ok('el gerente sí: chofer y combi de una', conGerente.status === 200, conGerente.body);

    // Los datos y el logo de la empresa son identidad: gerente, no admin.
    const datosD = await pedir('/admin/company', D.token, {
      method: 'POST', body: JSON.stringify({ name: 'Pisada' }),
    });
    ok('Despacho no corrige los datos de la empresa', datosD.status === 403, datosD.status);
    const datosG = await pedir('/admin/company', G.token, {
      method: 'POST', body: JSON.stringify({ name: 'Cooperativa de Transportes Juliaca', ruc: '20100200300' }),
    });
    ok('el gerente sí', datosG.status === 200, datosG.body);
    const logoD = await pedir('/admin/company/logo', D.token, {
      method: 'PUT', body: JSON.stringify({ logo: 'data:image/png;base64,' + 'A'.repeat(400) }),
    });
    ok('el logo tampoco es de Despacho', logoD.status === 403, logoD.status);
    const logoG = await pedir('/admin/company/logo', G.token, {
      method: 'PUT', body: JSON.stringify({ logo: 'data:image/png;base64,' + 'A'.repeat(400) }),
    });
    ok('el gerente lo pone', logoG.status === 200, logoG.status);

    // Un gerente ACOTADO a una ruta no toca lo que es de toda la empresa
    const GR2 = (await login('GER-RUTA', 'claveGerente2')).body;
    const datosGR = await pedir('/admin/company', GR2.token, {
      method: 'POST', body: JSON.stringify({ name: 'Otra' }),
    });
    ok('un gerente de UNA ruta no toca los datos de toda la empresa', datosGR.status === 403, datosGR.status);

    // Los números de gerencia siguen siendo solo del gerente
    const alReves = await pedir('/gerencia/resumen', D.token);
    ok('el resumen de gerencia no se abre con Despacho', alReves.status === 403, alReves.status);
    const sinNada = await pedir('/gerencia/resumen', 'token-de-la-nada');
    ok('sin sesión válida es 401, no 403', sinNada.status === 401, sinNada.status);
  }

  console.log('\nENTRA AL TIEMPO REAL COMO PANEL');
  {
    // Desde la fusión, el gerente usa despacho.html: mapa y chat incluidos.
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    const respuesta = await new Promise((resolve) => {
      const reloj = setTimeout(() => resolve({ type: 'silencio' }), 4000);
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.type === 'auth_error' || m.type === 'state') { clearTimeout(reloj); resolve(m); }
      });
      ws.send(JSON.stringify({ type: 'identify', token: G.token }));
    });
    ok('el WebSocket lo deja entrar y le manda el estado', respuesta.type === 'state', respuesta.type);
    ok('y NO aparece como unidad en el mapa',
      !(respuesta.units || []).some(u => u.unitId === 'GER-EMPRESA'),
      (respuesta.units || []).map(u => u.unitId));
    try { ws.close(); } catch {}
  }

  console.log('\nDESPACHO LO VE PERO NO LO TOCA');
  {
    const lista = await pedir('/admin/users', D.token);
    const g = lista.body.users.find(u => u.unitId === 'GER-EMPRESA');
    ok('el gerente figura en la lista de personas', !!g, lista.body.users.map(u => u.unitId));
    ok('con su rol a la vista', g && g.role === 'manager', g && g.role);

    const clave = await pedir('/admin/users/GER-EMPRESA/password', D.token, {
      method: 'POST', body: JSON.stringify({ password: 'otraclave123' }),
    });
    ok('Despacho no le puede resetear la clave', clave.status === 403, clave.status);
    ok('y el error dice de dónde se maneja', /nivel de arriba/i.test(clave.body.error || ''), clave.body.error);

    const baja = await pedir('/admin/users/GER-EMPRESA', D.token, { method: 'DELETE' });
    ok('ni darlo de baja', baja.status === 403, baja.status);

    const identidad = await pedir('/admin/users/GER-EMPRESA/identity', D.token, {
      method: 'POST', body: JSON.stringify({ name: 'Colado' }),
    });
    ok('ni cambiarle el nombre', identidad.status === 403, identidad.status);

    // La clave vieja tiene que seguir funcionando después de los tres intentos
    const sigue = await login('GER-EMPRESA', 'claveGerente1');
    ok('y la cuenta sigue entrando con su clave de siempre', sigue.status === 200, sigue.status);
  }

  console.log('\nLOS CONTEOS NO LO MEZCLAN CON LOS CHOFERES');
  {
    const emp = await pedir('/admin/company', D.token);
    // Los 2 son CH-77 y CH-88, dados de alta más arriba: gente de las combis.
    ok('personas cuenta la gente de las combis', emp.body.resumen.personas === 2, emp.body.resumen);
    ok('y gerencia va aparte', emp.body.resumen.gerencia === 2, emp.body.resumen.gerencia);
  }

  console.log('\nCADA VUELTA SE JUZGA CON LA VARA DE SU MOMENTO');
  {
    // Lo que esto evita: con objetivo automático el número se mueve solo —
    // depende de cuántas unidades hay en ruta— así que el informe de la
    // semana pasada juzgaba las vueltas del lunes con el objetivo del jueves.
    // Nadie podía notarlo mirando la pantalla, que es lo que lo hace caro.
    const db2 = new Database(DB);
    const vari = (rt) => {
      const v = db2.prepare('SELECT variantId FROM route_variants WHERE routeId = ? AND activa = 1').get(rt);
      return v ? v.variantId : null;
    };
    // Dos vueltas idénticas (brecha 5:00) en la misma ruta, cuyo objetivo de
    // HOY es 2:00. Una guardó SU objetivo de entonces —5:00, o sea que
    // cumplió— y la otra no guardó ninguno.
    db2.prepare(
      `INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec)
       VALUES (?, ?, ?, ?, ?, 3000, 22, 300, 300)`
    ).run('M-90', 'R-14', vari('R-14'), Date.now() - 3000e3, Date.now() - 50e3);
    db2.close();

    const r = await pedir('/gerencia/resumen', G.token);
    const m90 = r.body.porUnidad.find(u => u.unitId === 'M-90');
    const m02 = r.body.porUnidad.find(u => u.unitId === 'M-02');
    ok('la que guardó su objetivo se mide contra ÉSE y cumple',
      m90 && m90.cumplimiento === 100, m90 && m90.cumplimiento);
    ok('y la misma brecha sin objetivo guardado, contra el de hoy, no cumple',
      m02 && m02.cumplimiento === 0, m02 && m02.cumplimiento);

    // Y se dice cuántas son de cada clase: mientras queden vueltas viejas, el
    // promedio tiene una parte medida con la vara equivocada y la pantalla
    // tiene que poder decirlo en vez de presentarlo como exacto.
    ok('el resumen cuenta las que traen su propio objetivo',
      r.body.totales.conObjetivoPropio === 1, r.body.totales.conObjetivoPropio);
    ok('y las que se miden contra el de hoy porque son anteriores',
      r.body.totales.conObjetivoViejo === 3, r.body.totales.conObjetivoViejo);
  }

  console.log('\nEL INFORME');
  {
    const csv = await fetch(`${API}/gerencia/informe/vueltas.csv?desde=${Date.now() - 86400e3}&hasta=${Date.now()}`,
      { headers: { Authorization: 'Bearer ' + G.token } }).then(r => r.text());
    ok('baja el mismo archivo que Despacho', /Informe de vueltas/.test(csv));
    ok('firmado por quien lo pidió', /GER-EMPRESA/.test(csv), csv.split('\r\n')[3]);
    ok('con el nombre de su cooperativa', /Cooperativa de Transportes Juliaca/.test(csv), csv.split('\r\n')[0]);

    // La brecha sin el objetivo al lado es un número sin vara: el que abre el
    // CSV el mes que viene no tiene forma de saber cuál regía ese martes.
    ok('la brecha viene con el objetivo de ESA vuelta al lado',
      /Objetivo de esa vuelta/.test(csv), csv.split('\r\n').find(l => /Brecha promedio/.test(l)));
    // Por POSICIÓN de la columna y no por fin de línea: el CSV gana columnas
    // cada tanto (la última vez, si la vuelta es entera y por dónde entró), y
    // un `$` convierte cada columna nueva en una falla que no tiene nada que
    // ver con lo que esta prueba defiende.
    const columna = (fila, nombre) => {
      const cab = csv.split('\r\n').find(l => l.startsWith('Unidad;'));
      const i = (cab || '').split(';').indexOf(nombre);
      return i === -1 ? undefined : (fila || '').split(';')[i];
    };
    const filaM90 = csv.split('\r\n').find(l => l.startsWith('M-90'));
    ok('y la vuelta que lo guardó lo muestra',
      columna(filaM90, 'Objetivo de esa vuelta (m:ss)') === '05:00', filaM90);
    const filaM02 = csv.split('\r\n').find(l => l.startsWith('M-02'));
    ok('la que no lo tiene deja la celda vacía, no un cero inventado',
      columna(filaM02, 'Objetivo de esa vuelta (m:ss)') === '', filaM02);

    // Los tres botones de descarga del panel, por su nombre REAL. El de horas
    // decía "CSV turnos" y pedía `turnos.csv`, que no existe: devolvía 404 y
    // la pantalla mostraba "No se pudo descargar", que no dice nada. Un nombre
    // que no existe se ve igual que un servidor caído.
    for (const tipo of ['vueltas', 'horas', 'desvios']) {
      const r = await fetch(`${API}/gerencia/informe/${tipo}.csv?desde=${Date.now() - 86400e3}&hasta=${Date.now()}`,
        { headers: { Authorization: 'Bearer ' + G.token } });
      ok(`el informe ${tipo} existe y baja`, r.status === 200, r.status);
    }
    const inventado = await fetch(`${API}/gerencia/informe/turnos.csv`,
      { headers: { Authorization: 'Bearer ' + G.token } });
    ok('y uno inventado sigue siendo 404', inventado.status === 404, inventado.status);

    const ajeno = await fetch(`${API}/gerencia/informe/vueltas.csv?routeId=RB-1`,
      { headers: { Authorization: 'Bearer ' + G.token } });
    ok('y no puede pedir el de otra cooperativa', ajeno.status === 404, ajeno.status);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  if (servidor) servidor.kill();
  await sleep(300);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
