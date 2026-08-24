// Avisos del creador a las cooperativas: el canal del nivel de arriba.
//
// Lo que se defiende: el aviso lo manda SOLO el creador, aparece en el panel
// de Despacho de ESA cooperativa (y de ninguna otra), no desaparece hasta
// que alguien lo marca visto, y del visto queda quién y cuándo — porque el
// caso de uso es una deuda, y "se les avisó tal día y lo vieron" es la mitad
// que importa. Los pendientes no caducan; los vistos viejos se van solos.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const coop = require(RAIZ + '/server/cooperativas.js');
const fs = require('fs');

const S = __dirname;
const DB = S + '/avisos-test.db';
const P = 3193;
const API = `http://localhost:${P}`;
const CLAVE_CREADOR = 'clave-larga-del-creador';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
      DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', CREATOR_PASSWORD: CLAVE_CREADOR },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, token, opts = {}) => fetch(API + ruta, {
  ...opts,
  headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}) },
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  // La puerta del creador
  const c = await pedir('/creador/login', null, { method: 'POST',
    body: JSON.stringify({ password: CLAVE_CREADOR }) });
  ok('el creador entra', c.status === 200 && !!c.body.token, c.status);
  const ct = c.body.token;

  // Un chofer y el Despacho de la empresa base
  const gerente = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  await fetch(`${API}/admin/users`, { method: 'POST', headers: gerente,
    body: JSON.stringify({ unitId: 'M-01', name: 'Elmer Ccama', password: 'clave1234' }) });
  const chofer = await login('M-01', 'clave1234');
  const d = await login('DESPACHO', 'despacho99');

  console.log('\nEL AVISO SALE DEL CREADOR, Y VALIDADO');
  {
    let r = await pedir('/creador/empresas/R14/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: '   ' }) });
    ok('un aviso vacío no entra: 400', r.status === 400, r.status);
    r = await pedir('/creador/empresas/NO-EXISTE/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: 'hola' }) });
    ok('una empresa que no existe: 404', r.status === 404, r.status);
    r = await pedir('/creador/empresas/R14/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: 'hola', routeId: 'R-99' }) });
    ok('una ruta que no es de la empresa: 400', r.status === 400, r.body);

    r = await pedir('/creador/empresas/R14/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: 'Tienen pendiente el pago de agosto.' }) });
    ok('el aviso a la cooperativa sale', r.status === 200 && r.body.ok === true, r.body);

    r = await pedir('/admin/avisos', d.token, { method: 'POST' });
    // (POST a la lista no existe; el envío es SOLO del creador)
    r = await pedir('/creador/empresas/R14/avisos', d.token, { method: 'POST',
      body: JSON.stringify({ texto: 'me lo mando solo' }) });
    ok('un token de Despacho no abre la puerta del creador: 401', r.status === 401, r.status);
  }

  console.log('\nDESPACHO LO VE COMO BANNER, EL CHOFER NO VE NADA');
  {
    let r = await pedir('/admin/avisos', d.token);
    const a = (r.body.avisos || [])[0];
    ok('Despacho lo ve pendiente', r.status === 200 &&
       a?.texto === 'Tienen pendiente el pago de agosto.', r.body.avisos);
    r = await pedir('/admin/avisos', chofer.token);
    ok('un chofer no lee avisos — son del panel: 403', r.status === 403, r.status);
  }

  console.log('\nEL BORDE DE EMPRESA');
  {
    // Otra cooperativa, con su propio Despacho
    const db2 = new Database(DB);
    const alta = coop.alta(db2, { companyId: 'OTRA', name: 'La Otra', ruta: 'R-9',
      despacho: 'DESPACHO-2', clave: 'clavelarga2' });
    db2.close();
    ok('la segunda cooperativa existe', alta.ok === true, alta);
    const d2 = await login('DESPACHO-2', 'clavelarga2');

    let r = await pedir('/admin/avisos', d2.token);
    ok('el Despacho de OTRA empresa no ve el aviso', (r.body.avisos || []).length === 0, r.body);

    const id = (await pedir('/admin/avisos', d.token)).body.avisos[0].id;
    r = await pedir(`/admin/avisos/${id}/visto`, d2.token, { method: 'POST' });
    ok('ni lo puede marcar visto — 404, como si no existiera', r.status === 404, r.status);
  }

  console.log('\nMARCAR VISTO: QUIÉN Y CUÁNDO, Y NO DESAPARECE SOLO');
  {
    let r = await pedir('/admin/avisos', d.token);
    const id = r.body.avisos[0].id;
    r = await pedir(`/admin/avisos/${id}/visto`, d.token, { method: 'POST' });
    ok('Despacho lo marca visto', r.status === 200, r.status);
    r = await pedir('/admin/avisos', d.token);
    ok('y el banner se va', (r.body.avisos || []).length === 0, r.body);
    r = await pedir(`/admin/avisos/${id}/visto`, d.token, { method: 'POST' });
    ok('marcarlo dos veces no existe: 404', r.status === 404, r.status);

    // El creador ve el visto con quién y cuándo — la mitad que importa
    r = await pedir('/creador/empresas/R14/avisos', ct);
    const a = (r.body.avisos || []).find(x => x.id === id);
    ok('el creador lo ve VISTO, con quién y cuándo',
       !!a && a.vistoPor === 'DESPACHO' && typeof a.vistoEn === 'number', a);

    // Y queda en la auditoría de la cooperativa
    r = await pedir('/admin/audit', d.token);
    ok('el visto queda auditado',
       (r.body.events || []).some(e => e.action === 'aviso_visto' && e.actor === 'DESPACHO'),
       (r.body.events || []).slice(0, 3).map(e => e.action));
  }

  console.log('\nEL AVISO POR RUTA Y LA RETENCIÓN');
  {
    // Un aviso colgado de una ruta concreta llega igual (el Despacho de la
    // empresa lo ve — el borde por ruta se aplica a cuentas con alcance)
    let r = await pedir('/creador/empresas/R14/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: 'Obra en la ruta', routeId: 'R-14' }) });
    ok('el aviso por ruta sale', r.status === 200 && r.body.routeId === 'R-14', r.body);
    r = await pedir('/admin/avisos', d.token);
    ok('y Despacho lo ve, con su ruta',
       (r.body.avisos || []).some(a => a.routeId === 'R-14'), r.body.avisos);

    // Los VISTOS viejos se van solos al mandar el siguiente; los pendientes
    // no caducan nunca — un aviso sin ver no puede desaparecer callado.
    const db3 = new Database(DB);
    db3.prepare("UPDATE notices SET vistoEn = ?, creadoEn = ? WHERE vistoEn IS NOT NULL")
      .run(Date.now() - 400 * 86400_000, Date.now() - 401 * 86400_000);
    db3.prepare("UPDATE notices SET creadoEn = ? WHERE vistoEn IS NULL")
      .run(Date.now() - 401 * 86400_000);
    db3.close();
    await pedir('/creador/empresas/R14/avisos', ct, { method: 'POST',
      body: JSON.stringify({ texto: 'el que dispara la poda' }) });
    r = await pedir('/creador/empresas/R14/avisos', ct);
    const vistos = (r.body.avisos || []).filter(a => a.vistoEn);
    const pendientesViejos = (r.body.avisos || []).filter(a => !a.vistoEn && a.creadoEn < Date.now() - 400 * 86400_000);
    ok('el visto de hace más de un año se fue solo', vistos.length === 0, vistos);
    ok('el pendiente viejo sigue ahí — sin ver no caduca', pendientesViejos.length === 1,
       (r.body.avisos || []).length);
  }

  servidor.kill();
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { servidor.kill(); } catch {}
  process.exit(1);
});
