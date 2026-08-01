// Panel del creador: la puerta y lo que hay detrás.
// Arranca sus propios servidores: la configuración ES lo que se prueba.
const RAIZ = require('path').join(__dirname, '..');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const CLAVE = 'clave-larga-del-creador';
const SECRETO = 'JBSWY3DPEHPK3PXP';   // base32
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// El mismo TOTP que el servidor, escrito aparte: si los dos tuvieran el
// mismo error, la prueba no lo vería.
function totp(secretoBase32, desfase = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, acc = 0; const bytes = [];
  for (const c of secretoBase32.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    acc = (acc << 5) | A.indexOf(c); bits += 5;
    if (bits >= 8) { bytes.push((acc >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const paso = Math.floor(Date.now() / 30000) + desfase;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(paso / 2 ** 32), 0);
  buf.writeUInt32BE(paso >>> 0, 4);
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const num = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(num % 1000000).padStart(6, '0');
}

const servidores = [];
async function arrancar(puerto, env, dbFile) {
  const p = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(puerto), DB_FILE: dbFile, DISPATCH_PASSWORD: 'despacho99', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  p.stdout.on('data', d => { salida += d; });
  p.stderr.on('data', d => { salida += d; });
  servidores.push(p);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${puerto}/ping`); return { p, log: () => salida }; } catch {}
  }
  throw new Error('el servidor no arrancó: ' + salida);
}

const pedir = (puerto, ruta, opts = {}) =>
  fetch(`http://localhost:${puerto}${ruta}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  // Base limpia y propia: este test crea cooperativas.
  const DB = S + '/creador-test.db';
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

  console.log('\nCUANDO ESTÁ APAGADO');
  {
    const { log } = await arrancar(3021, {}, DB);
    const r = await fetch('http://localhost:3021/creador');
    ok('sin CREATOR_PASSWORD, el panel no existe (404, no 401 ni 403)', r.status === 404, r.status);
    const l = await pedir(3021, '/creador/login', { method: 'POST', body: JSON.stringify({ password: CLAVE }) });
    ok('y su login tampoco', l.status === 404, l.status);
    ok('el arranque ni lo menciona', !/Panel del creador/i.test(log()),
      (log().match(/.*Panel del creador.*/i) || [])[0]);
  }

  console.log('\nCUANDO LA CLAVE ES CORTA');
  {
    const { log } = await arrancar(3022, { CREATOR_PASSWORD: 'corta123' }, DB);
    const r = await fetch('http://localhost:3022/creador');
    ok('se niega a encender', r.status === 404, r.status);
    ok('y dice por qué', /menos de 12 caracteres/.test(log()));
    const ping = await pedir(3022, '/ping');
    ok('el resto del sistema sigue funcionando', ping.status === 200);
  }

  console.log('\nLA PUERTA');
  const P = 3023;
  await arrancar(P, { CREATOR_PASSWORD: CLAVE, CREATOR_PATH: '/gestion-x9k2' }, DB);
  {
    const enDefecto = await fetch(`http://localhost:${P}/creador`);
    ok('con CREATOR_PATH, la ruta por defecto no existe', enDefecto.status === 404, enDefecto.status);
    const pantalla = await fetch(`http://localhost:${P}/gestion-x9k2`);
    const html = await pantalla.text();
    ok('la pantalla sale en la ruta configurada', pantalla.status === 200 && /Creador/.test(html));
    ok('y no se cachea', /no-store/.test(pantalla.headers.get('cache-control') || ''),
      pantalla.headers.get('cache-control'));
    ok('ni se indexa', /noindex/.test(pantalla.headers.get('x-robots-tag') || ''));

    const mala = await pedir(P, '/gestion-x9k2/login', { method: 'POST', body: JSON.stringify({ password: 'otra-clave-larga' }) });
    ok('una clave equivocada no entra', mala.status === 401, mala.body.error);

    const t0 = Date.now();
    const buena = await pedir(P, '/gestion-x9k2/login', { method: 'POST', body: JSON.stringify({ password: CLAVE }) });
    const tardo = Date.now() - t0;
    ok('la correcta entra', buena.status === 200 && !!buena.body.token);
    ok('y cada intento tarda igual, acierte o no', tardo >= 450, tardo + ' ms');
    var TOKEN = buena.body.token;
  }

  console.log('\nFUERZA BRUTA');
  {
    // El quinto fallo bloquea el origen 15 minutos
    let bloqueoEn = null;
    for (let i = 1; i <= 7 && bloqueoEn === null; i++) {
      const r = await pedir(P, '/gestion-x9k2/login', {
        method: 'POST', body: JSON.stringify({ password: 'clave-equivocada-' + i }),
      });
      if (r.status === 429) bloqueoEn = i;
    }
    ok('a los pocos intentos bloquea el origen', bloqueoEn !== null && bloqueoEn <= 6,
      bloqueoEn ? `bloqueado en el intento ${bloqueoEn}` : 'nunca bloqueó');
    const conLaBuena = await pedir(P, '/gestion-x9k2/login', { method: 'POST', body: JSON.stringify({ password: CLAVE }) });
    ok('y bloqueado no entra ni con la clave correcta', conLaBuena.status === 429, conLaBuena.status);
    ok('la sesión que ya estaba abierta sigue valiendo',
      (await pedir(P, '/gestion-x9k2/empresas', { headers: { Authorization: 'Bearer ' + TOKEN } })).status === 200);
  }

  console.log('\nLOS DOS NIVELES NO SE TOCAN');
  {
    const despacho = await pedir(P, '/auth/login', {
      method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }),
    });
    const tokenDespacho = despacho.body.token;
    ok('un token de Despacho no abre el panel del creador',
      (await pedir(P, '/gestion-x9k2/empresas', { headers: { Authorization: 'Bearer ' + tokenDespacho } })).status === 401);
    ok('y uno del creador no abre la administración de Despacho',
      (await pedir(P, '/admin/users', { headers: { Authorization: 'Bearer ' + TOKEN } })).status === 401);
    ok('sin token, nada', (await pedir(P, '/gestion-x9k2/empresas')).status === 401);
    ok('con un token inventado, tampoco',
      (await pedir(P, '/gestion-x9k2/empresas', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).status === 401);
  }

  console.log('\nLO QUE SE PUEDE HACER ADENTRO');
  const H = { Authorization: 'Bearer ' + TOKEN };
  {
    const alta = await pedir(P, '/gestion-x9k2/empresas', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        companyId: 'NUEVA-1', name: 'Cooperativa Nueva', ruta: 'RN-1',
        nombreRuta: 'Centro ↔ Aeropuerto', despacho: 'DESP-N1', clave: 'clavenueva1',
      }),
    });
    ok('se da de alta una cooperativa completa', alta.status === 200 && alta.body.usuario === 'DESP-N1', alta.body);

    // Y esa cooperativa funciona de verdad: su despacho entra y ve lo suyo
    const suLogin = await pedir(P, '/auth/login', {
      method: 'POST', body: JSON.stringify({ user: 'DESP-N1', password: 'clavenueva1' }),
    });
    ok('su cuenta de Despacho entra', suLogin.status === 200 && suLogin.body.companyId === 'NUEVA-1', suLogin.body.companyId);
    const susRutas = await pedir(P, '/admin/routes', { headers: { Authorization: 'Bearer ' + suLogin.body.token } });
    ok('y ve solo su ruta', susRutas.body.routes.length === 1 && susRutas.body.routes[0].routeId === 'RN-1',
      susRutas.body.routes.map(r => r.routeId));

    // El alta de rutas vive acá ahora, así que la validación del código
    // también se prueba acá: un identificador con HTML termina pintado en
    // los pines del mapa.
    const rutaXss = await pedir(P, `/gestion-x9k2/empresas/NUEVA-1/rutas`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ routeId: '<img src=x onerror=alert(1)>', name: 'x' }),
    });
    ok('un código de ruta con HTML se rechaza', rutaXss.status === 400, rutaXss.body.error);

    ok('un código repetido se rechaza',
      (await pedir(P, '/gestion-x9k2/empresas', { method: 'POST', headers: H,
        body: JSON.stringify({ companyId: 'NUEVA-1', name: 'Otra' }) })).status === 400);
    ok('y un alta a medias no deja la empresa creada',
      (await pedir(P, '/gestion-x9k2/empresas', { method: 'POST', headers: H,
        body: JSON.stringify({ companyId: 'NUEVA-2', name: 'Media', ruta: 'RN-1' }) })).status === 400 &&
      !(await pedir(P, '/gestion-x9k2/empresas', { headers: H })).body.empresas.some(e => e.companyId === 'NUEVA-2'));

    const ruta = await pedir(P, `/gestion-x9k2/empresas/NUEVA-1/rutas`, {
      method: 'POST', headers: H, body: JSON.stringify({ routeId: 'RN-2', name: 'Segunda' }),
    });
    ok('se le agrega una ruta', ruta.status === 200, ruta.body);

    const reset = await pedir(P, `/gestion-x9k2/empresas/NUEVA-1/despacho`, {
      method: 'POST', headers: H, body: JSON.stringify({ usuario: 'DESP-N1', clave: 'otraclave99' }),
    });
    ok('se le restablece la clave a su Despacho', reset.status === 200 && reset.body.creado === false);
    ok('la clave vieja deja de servir',
      (await pedir(P, '/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESP-N1', password: 'clavenueva1' }) })).status === 401);
    ok('y la sesión que tenía abierta también',
      (await pedir(P, '/admin/routes', { headers: { Authorization: 'Bearer ' + suLogin.body.token } })).status === 401);

    // Suspender
    await pedir(P, `/gestion-x9k2/empresas/NUEVA-1/estado`, { method: 'POST', headers: H, body: JSON.stringify({ activa: false }) });
    ok('suspendida, su gente no entra',
      (await pedir(P, '/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESP-N1', password: 'otraclave99' }) })).status === 403);
    ok('y la de al lado sigue trabajando',
      (await pedir(P, '/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).status === 200);
    await pedir(P, `/gestion-x9k2/empresas/NUEVA-1/estado`, { method: 'POST', headers: H, body: JSON.stringify({ activa: true }) });
    ok('al habilitarla vuelve',
      (await pedir(P, '/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESP-N1', password: 'otraclave99' }) })).status === 200);
  }

  console.log('\nQUEDA REGISTRADO');
  {
    const act = await pedir(P, '/gestion-x9k2/actividad', { headers: H });
    const delCreador = act.body.eventos.filter(e => e.actor === 'CREADOR');
    ok('las acciones del creador quedan en la auditoría', delCreador.length >= 4,
      delCreador.map(e => e.action).slice(0, 6));
    ok('y el login del creador también', delCreador.some(e => e.action === 'creador_login'));

    // Lo que se le hizo a una cooperativa lo ve esa cooperativa
    const suyo = await pedir(P, '/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESP-N1', password: 'otraclave99' }) });
    const suAudit = await pedir(P, '/admin/audit', { headers: { Authorization: 'Bearer ' + suyo.body.token } });
    ok('la cooperativa ve que le tocaron su cuenta',
      suAudit.body.events.some(e => e.actor === 'CREADOR' && e.action === 'reset_supervisor'),
      suAudit.body.events.filter(e => e.actor === 'CREADOR').map(e => e.action));
    ok('pero NO ve los logins del creador (no son de nadie)',
      !suAudit.body.events.some(e => e.action === 'creador_login'));
    ok('ni la actividad de otra cooperativa',
      !suAudit.body.events.some(e => e.target === 'DESPACHO' || e.actor === 'DESPACHO'));
  }

  console.log('\nSALUD DEL SISTEMA');
  {
    const sis = await pedir(P, '/gestion-x9k2/sistema', { headers: H });
    ok('informa el estado del servidor', sis.status === 200 && sis.body.empresas >= 2 && sis.body.node.startsWith('v'),
      { empresas: sis.body.empresas, base: sis.body.base, node: sis.body.node });
    // El indicador tiene TRES estados: en memoria, en el disco de la
    // aplicación (se borra en cada despliegue) y en un disco aparte.
    ok('dice dónde vive la base, con la ruta completa',
      sis.body.base.endsWith('creador-test.db') && sis.body.base.includes('/'), sis.body.base);
    ok('y no está en memoria', sis.body.baseEnMemoria === false);
    ok('sabe si está en un disco aparte o no', typeof sis.body.baseEnDiscoAparte === 'boolean',
      sis.body.baseEnDiscoAparte);
    ok('y avisa que no hay segundo factor', sis.body.segundoFactor === false);
  }

  console.log('\nCERRAR SESIÓN');
  {
    ok('al salir, el token muere',
      (await pedir(P, '/gestion-x9k2/salir', { method: 'POST', headers: H })).status === 200 &&
      (await pedir(P, '/gestion-x9k2/empresas', { headers: H })).status === 401);
  }

  console.log('\nSEGUNDO FACTOR');
  {
    const Q = 3024;
    await arrancar(Q, { CREATOR_PASSWORD: CLAVE, CREATOR_TOTP_SECRET: SECRETO }, DB);
    const soloClave = await pedir(Q, '/creador/login', { method: 'POST', body: JSON.stringify({ password: CLAVE }) });
    ok('con la clave sola no alcanza', soloClave.status === 401, soloClave.body.error);
    const codigoMalo = await pedir(Q, '/creador/login', {
      method: 'POST', body: JSON.stringify({ password: CLAVE, codigo: '000000' }),
    });
    ok('con un código inventado tampoco', codigoMalo.status === 401);
    ok('el mensaje no dice cuál de las dos falló',
      soloClave.body.error === codigoMalo.body.error, [soloClave.body.error, codigoMalo.body.error]);
    const bien = await pedir(Q, '/creador/login', {
      method: 'POST', body: JSON.stringify({ password: CLAVE, codigo: totp(SECRETO) }),
    });
    ok('con el código del celular entra', bien.status === 200 && !!bien.body.token, bien.body.error);
    ok('y el panel lo declara',
      (await pedir(Q, '/creador/sistema', { headers: { Authorization: 'Bearer ' + bien.body.token } })).body.segundoFactor === true);

    // Un secreto mal escrito no puede degradar a "sin segundo factor"
    const R = 3025;
    const { log } = await arrancar(R, { CREATOR_PASSWORD: CLAVE, CREATOR_TOTP_SECRET: '!!!!' }, DB);
    ok('un secreto inválido apaga el panel en vez de dejarlo sin segundo factor',
      (await fetch(`http://localhost:${R}/creador`)).status === 404 && /base32/.test(log()));
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  servidores.forEach(p => { try { p.kill(); } catch {} });
  await sleep(400);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(async e => {
  console.error('LA SUITE SE CAYÓ:', e.message);
  servidores.forEach(p => { try { p.kill(); } catch {} });
  process.exit(1);
});
