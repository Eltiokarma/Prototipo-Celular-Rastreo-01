// Los cobradores de la combi, gestionados por su chofer.
//
// El cobrador lo pone el chofer: sube con él y cambia seguido. Que cada alta
// pasara por Despacho terminaba en lo peor —el cobrador entrando con la
// cuenta del chofer—, que es justo lo que rompe las horas por persona.
//
// Lo que se abre es un permiso NUEVO para el eslabón más bajo de la cadena,
// así que lo que esta suite prueba no es que funcione (eso es lo fácil): es
// DÓNDE TERMINA. Todo lo que decide permisos sale de la sesión y no del
// cuerpo del pedido, y acá se lo intenta torcer a propósito:
//
//   · pedir el alta de un CHOFER en vez de un cobrador;
//   · pedir que el cobrador quede colgado de la combi de otro;
//   · tocarle el cobrador al de al lado;
//   · que un cobrador gestione cobradores.
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
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99' },
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
    ok('el perfil abre y dice que puede gestionar', p.body.puedeGestionar === true, p.status);
    ok('arranca sin cobradores', Array.isArray(p.body.cobradores) && p.body.cobradores.length === 0, p.body.cobradores);
    ok('y dice cuántos entran por combi', p.body.topeCobradores >= 1, p.body.topeCobradores);
  }

  console.log('\nDA DE ALTA AL SUYO');
  {
    const r = await post(ch1, '/perfil/cobradores',
      { unitId: 'cob-1', name: 'María Quispe', alias: 'Mari', password: 'cobrador12' });
    ok('el alta pasa', r.status === 200, r.body);
    const p = await get(ch1, '/perfil');
    ok('y aparece en su perfil con nombre y usuario',
       p.body.cobradores.length === 1 && p.body.cobradores[0].unitId === 'cob-1' &&
       p.body.cobradores[0].alias === 'Mari', p.body.cobradores);
    const entra = await login('cob-1', 'cobrador12');
    ok('el cobrador puede entrar con SU usuario (por eso sus horas son suyas)',
       !!entra.body.token, entra.status);
    ok('y entra como cobrador, no como chofer', entra.body.role === 'collector', entra.body.role);
    ok('colgado de la combi de quien lo dio de alta', entra.body.vehicleId === 'CH-1', entra.body.vehicleId);
  }

  console.log('\nEL COBRADOR VE, NO GESTIONA');
  {
    const cob = (await login('cob-1', 'cobrador12')).body.token;
    const p = await get(cob, '/perfil');
    ok('su perfil abre', p.status === 200, p.status);
    ok('pero NO puede gestionar', p.body.puedeGestionar === false, p.body.puedeGestionar);
    ok('y ve con qué chofer anda', p.body.chofer?.name === 'Chofer CH-1', p.body.chofer);
    const r = await post(cob, '/perfil/cobradores',
      { unitId: 'cob-x', name: 'Colado', password: 'cobrador12' });
    ok('un cobrador no puede dar de alta a otro', r.status === 403, r.status);
    const b = await del(cob, '/perfil/cobradores/cob-1');
    ok('ni darse de baja a sí mismo por esta puerta', b.status === 403, b.status);
  }

  console.log('\nLO QUE NO PUEDE TORCER');
  {
    // El rol NO sale del pedido: pedir 'driver' igual da un cobrador. Si
    // saliera del cuerpo, cualquier chofer se fabricaría choferes.
    const r = await post(ch1, '/perfil/cobradores',
      { unitId: 'cob-2', name: 'Pedro Mamani', password: 'cobrador12',
        personRole: 'driver', role: 'driver' });
    ok('pedir el alta de un CHOFER igual da un cobrador', r.status === 200, r.body);
    const e = await login('cob-2', 'cobrador12');
    ok('y entra como cobrador', e.body.role === 'collector', e.body.role);

    // El vehículo tampoco: mandar la combi del vecino no lo cuelga de ahí
    ok('el vehículo sale de la sesión, no del pedido', e.body.vehicleId === 'CH-1', e.body.vehicleId);
    const p2 = await get(ch2, '/perfil');
    ok('la combi del vecino sigue sin cobradores', p2.body.cobradores.length === 0, p2.body.cobradores);
  }

  console.log('\nEL TOPE');
  {
    const r = await post(ch1, '/perfil/cobradores',
      { unitId: 'cob-3', name: 'Uno de más', password: 'cobrador12' });
    ok('pasado el tope, el alta rebota', r.status === 409, r.status);
    ok('y el error dice qué hacer', /baja/i.test(r.body.error || ''), r.body.error);
    const tomado = await post(ch1, '/perfil/cobradores',
      { unitId: 'CH-2', name: 'Robo de usuario', password: 'cobrador12' });
    ok('y un usuario ya tomado no se puede pisar', tomado.status === 409, tomado.status);
    const sigue = await login('CH-2', 'chofer1234');
    ok('el dueño de ese usuario sigue entrando igual', !!sigue.body.token);
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
    for (const a of ['alta_cobrador', 'clave_cobrador', 'baja_cobrador']) {
      ok(`la auditoría registra ${a}`, acciones.includes(a), acciones.slice(0, 8));
    }
    const clave = (audit.body.events || []).find(e => e.action === 'clave_cobrador');
    ok('y del cambio de clave NO guarda cuál era', !clave?.detail, clave);
    // Despacho y la gerencia los siguen viendo: esto suma quién da el alta,
    // no esconde gente del panel de nadie.
    const users = await get(ger, '/admin/users');
    ok('la gerencia sigue viendo al cobrador que cargó el chofer',
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
