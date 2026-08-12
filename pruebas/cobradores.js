// Los cobradores de la combi, administrados por su chofer.
//
// El chofer VE a los que van arriba de su combi, les cambia la clave y los
// saca. Es lo del día a día: se olvidó la contraseña, cambió de teléfono, o
// ya no sube más — y esperar a Despacho para eso es lo que termina en que
// los dos entren con la misma cuenta.
//
// **El ALTA no es suya**, por decisión del dueño del producto: crear una
// cuenta es dar acceso al sistema y se queda en Despacho o la gerencia, que
// además cargan el nombre real con el que se liquidan las horas. Esta suite
// lo verifica como cualquier otro borde — que el endpoint no exista no es
// algo que se pueda dar por sentado desde el código.
//
// Lo que se abre igual es un permiso NUEVO para el eslabón más bajo de la
// cadena, así que lo que esta suite prueba no es que funcione (eso es lo
// fácil): es DÓNDE TERMINA. Acá se lo intenta torcer a propósito:
//
//   · dar de alta un cobrador desde la app del chofer;
//   · tocarle el cobrador al de al lado;
//   · que un cobrador administre cobradores;
//   · que se dé de baja a sí mismo por esta puerta.
//
// Los cuatro tienen que rebotar. Y las horas de cada uno tienen que quedar
// separadas, que es la razón por la que esto existe.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const P = 3175;
const API = `http://localhost:${P}`;
const DB = path.join(__dirname, 'cobradores.db');
const limpiar = () => { for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} } };

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
const get = (t, url) => fetch(API + url, { headers: H(t) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const post = (t, url, body) => fetch(API + url, { method: 'POST', headers: H(t), body: JSON.stringify(body || {}) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const del = (t, url) => fetch(API + url, { method: 'DELETE', headers: H(t) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let servidor = null;
(async () => {
  for (let i = 0; i < 40; i++) {
    const vivo = await fetch(API + '/ping').then(() => true, () => false);
    if (!vivo) break;
    if (i === 39) throw new Error(`el puerto ${P} sigue ocupado por otra corrida`);
    await sleep(250);
  }
  limpiar();
  servidor = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  // La gerencia carga los choferes con su combi (desde la fusión de paneles)
  {
    const Database = require(path.join(RAIZ, 'server', 'node_modules', 'better-sqlite3'));
    const coop = require(path.join(RAIZ, 'server', 'cooperativas.js'));
    const base = new Database(DB);
    coop.gerente(base, { companyId: 'R14', usuario: 'GER-COB', clave: 'gerentecob1' });
    base.close();
  }
  const ger = (await login('GER-COB', 'gerentecob1')).body.token;
  if (!ger) throw new Error('no entró el gerente');
  for (const u of ['CH-1', 'CH-2']) {
    const r = await post(ger, '/admin/users', { unitId: u, name: 'Chofer ' + u, password: 'chofer1234' });
    if (r.status !== 200) throw new Error('alta de ' + u + ' falló: ' + JSON.stringify(r));
  }
  const ch1 = (await login('CH-1', 'chofer1234')).body.token;
  const ch2 = (await login('CH-2', 'chofer1234')).body.token;

  console.log('\nEL CHOFER VE SU COMBI');
  {
    const p = await get(ch1, '/perfil');
    ok('el perfil abre y dice que puede administrar', p.body.puedeGestionar === true, p.status);
    ok('arranca sin cobradores', Array.isArray(p.body.cobradores) && p.body.cobradores.length === 0, p.body.cobradores);
  }

  console.log('\nEL ALTA NO ES DEL CHOFER');
  {
    // La decisión del dueño del producto: crear una cuenta es dar acceso al
    // sistema y se queda arriba. Se prueba que el endpoint NO exista, no que
    // esté escondido en la pantalla — la pantalla no es la que manda.
    const r = await post(ch1, '/perfil/cobradores',
      { unitId: 'colado', name: 'Cuenta fabricada', password: 'cobrador12' });
    ok('el chofer no puede crear cuentas de cobrador', r.status === 404, r.status);
    const existe = await login('colado', 'cobrador12');
    ok('y esa cuenta no quedó creada', !existe.body.token, existe.status);
  }

  console.log('\nLOS CARGA LA GERENCIA, Y AHÍ SÍ LOS VE');
  {
    const alta = await post(ger, '/admin/users',
      { unitId: 'cob-1', name: 'María Quispe', alias: 'Mari', personRole: 'collector', vehicleId: 'CH-1', password: 'cobrador12' });
    ok('la gerencia carga al cobrador sobre la combi', alta.status === 200, alta.body);
    const p = await get(ch1, '/perfil');
    ok('y el chofer lo ve en su perfil con nombre y usuario',
       p.body.cobradores.length === 1 && p.body.cobradores[0].unitId === 'cob-1' &&
       p.body.cobradores[0].alias === 'Mari', p.body.cobradores);
    ok('con sus horas contadas aparte', p.body.cobradores[0].horasSec === 0, p.body.cobradores[0]);
    const entra = await login('cob-1', 'cobrador12');
    ok('el cobrador entra con SU usuario (por eso sus horas son suyas)',
       !!entra.body.token, entra.status);
    ok('y entra como cobrador, no como chofer', entra.body.role === 'collector', entra.body.role);
    ok('colgado de la combi en la que lo cargaron', entra.body.vehicleId === 'CH-1', entra.body.vehicleId);
    // El segundo, para tener con qué probar que el del vecino no se toca
    await post(ger, '/admin/users',
      { unitId: 'cob-2', name: 'Pedro Mamani', personRole: 'collector', vehicleId: 'CH-1', password: 'cobrador12' });
  }

  console.log('\nEL COBRADOR VE, NO ADMINISTRA');
  {
    const cob = (await login('cob-1', 'cobrador12')).body.token;
    const p = await get(cob, '/perfil');
    ok('su perfil abre', p.status === 200, p.status);
    ok('pero NO puede administrar', p.body.puedeGestionar === false, p.body.puedeGestionar);
    ok('y ve con qué chofer anda', p.body.chofer?.name === 'Chofer CH-1', p.body.chofer);
    const b = await del(cob, '/perfil/cobradores/cob-2');
    ok('un cobrador no puede sacar a su compañero', b.status === 403, b.status);
    const c = await post(cob, '/perfil/cobradores/cob-2/clave', { nueva: 'meloafano1' });
    ok('ni cambiarle la clave', c.status === 403, c.status);
    const sigue = await login('cob-2', 'cobrador12');
    ok('el compañero sigue entrando igual', !!sigue.body.token);
  }

  console.log('\nLA COMBI DEL VECINO NO SE TOCA');
  {
    const p2 = await get(ch2, '/perfil');
    ok('el vecino no ve cobradores que no son suyos', p2.body.cobradores.length === 0, p2.body.cobradores);
  }

  console.log('\nEL COBRADOR DEL DE AL LADO NO SE TOCA');
  {
    const b = await del(ch2, '/perfil/cobradores/cob-1');
    ok('no lo puede dar de baja', b.status === 404, b.status);
    const c = await post(ch2, '/perfil/cobradores/cob-1/clave', { nueva: 'meloafano1' });
    ok('ni cambiarle la clave', c.status === 404, c.status);
    ok('y el error no confirma que exista', /no va en tu combi/i.test(c.body.error || ''), c.body.error);
    const sigue = await login('cob-1', 'cobrador12');
    ok('el cobrador sigue entrando con su clave de siempre', !!sigue.body.token);
  }

  console.log('\nLA CLAVE Y LA BAJA, LAS DEL SUYO SÍ');
  {
    const c = await post(ch1, '/perfil/cobradores/cob-1/clave', { nueva: 'clavenueva9' });
    ok('el chofer le cambia la clave a su cobrador', c.status === 200, c.body);
    const vieja = await login('cob-1', 'cobrador12');
    ok('la clave vieja deja de servir', !vieja.body.token, vieja.status);
    const nueva = await login('cob-1', 'clavenueva9');
    ok('y con la nueva entra', !!nueva.body.token);
    const corta = await post(ch1, '/perfil/cobradores/cob-1/clave', { nueva: '123' });
    ok('una clave corta no pasa', corta.status === 400, corta.status);

    const b = await del(ch1, '/perfil/cobradores/cob-1');
    ok('y lo puede dar de baja', b.status === 200, b.body);
    const despues = await login('cob-1', 'clavenueva9');
    ok('dado de baja ya no entra', !despues.body.token, despues.status);
    const p = await get(ch1, '/perfil');
    ok('y deja de figurar en la combi', !p.body.cobradores.some(c2 => c2.unitId === 'cob-1'), p.body.cobradores);
  }

  console.log('\nQUEDA ESCRITO QUIÉN LO HIZO');
  {
    const audit = await get(ger, '/admin/audit');
    const acciones = (audit.body.events || []).map(e => e.action);
    for (const a of ['clave_cobrador', 'baja_cobrador']) {
      ok(`la auditoría registra ${a}`, acciones.includes(a), acciones.slice(0, 8));
    }
    // Y NO puede haber altas hechas por un chofer: el alta no es suya
    ok('no hay ninguna alta de cobrador hecha por un chofer',
       !acciones.includes('alta_cobrador'), acciones.slice(0, 8));
    const clave = (audit.body.events || []).find(e => e.action === 'clave_cobrador');
    ok('y del cambio de clave NO guarda cuál era', !clave?.detail, clave);
    // Despacho y la gerencia los siguen viendo: esto suma quién da el alta,
    // no esconde gente del panel de nadie.
    const users = await get(ger, '/admin/users');
    ok('la gerencia sigue viendo a los cobradores de la flota',
       users.body.users.some(u => u.unitId === 'cob-2' && u.role === 'collector'),
       users.body.users.map(u => u.unitId));
  }

  servidor.kill();
  limpiar();
  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  limpiar();
  process.exit(1);
});
