// La copia de los respaldos fuera del servidor, y volver a uno (PENDIENTES
// 0.3, 03/11).
//
//   - la firma de AWS (SigV4) contra los tres ejemplos que publica AWS: sin
//     ella, R2/B2/S3 contestan 403 y no hay copia;
//   - el cifrado: ida y vuelta, frase equivocada, archivo alterado, y que lo
//     que sale no tenga nada legible;
//   - la configuración a medias se dice, no se adivina;
//   - un servidor de verdad contra un S3 de mentira que VERIFICA la firma de
//     cada pedido tal como llegó: el respaldo del arranque sale cifrado, el
//     panel del creador lo lista, /salud queda sin avisos;
//   - restaurar con RESTAURAR_DESDE: desde la copia afuera y desde el disco,
//     la base de antes queda guardada, no se repite si la variable queda
//     puesta, y un nombre equivocado no arranca ni toca nada;
//   - un almacenamiento que rechaza: /salud lo avisa y el panel lo dice;
//   - y la herramienta de línea de comandos que descifra un respaldo bajado.
const RAIZ = require('path').join(__dirname, '..');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { hashPassword } = require(RAIZ + '/server/base.js');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const copia = require(RAIZ + '/server/copia-afuera.js');
const { crearSalud } = require(RAIZ + '/server/salud.js');

const DIR = path.join(__dirname, 'copia-afuera-tmp');
const DB = path.join(DIR, 'r14.db');
const P = 3187, PS3 = 3191;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CLAVE_CREADOR = 'clave-larga-del-creador';
const FRASE = 'una frase larga para cifrar los respaldos';

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// ─── Un S3 de mentira ───────────────────────────────────────
// Guarda en memoria y verifica la firma de cada pedido recomputándola con lo
// que llegó por la red (método, ruta, consulta, cabeceras firmadas). Lo que
// la firma no cubra bien —el host con puerto, la consulta codificada— da 403.
const S3 = { objetos: new Map(), pedidos: [], rechazar: false };
const ID = 'AKIAPRUEBA', SECRETO = 'secreto-de-prueba';
http.createServer((req, res) => {
  const partes = [];
  req.on('data', d => partes.push(d));
  req.on('end', () => {
    const cuerpo = Buffer.concat(partes);
    const u = new URL(req.url, `http://${req.headers.host}`);
    S3.pedidos.push(`${req.method} ${u.pathname}${u.search}`);
    const auth = req.headers.authorization || '';
    const m = auth.match(/Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/);
    let firmaOk = false;
    if (m && m[1] === ID) {
      const cabeceras = {};
      for (const h of m[4].split(';')) if (!['host', 'x-amz-content-sha256', 'x-amz-date'].includes(h)) cabeceras[h] = req.headers[h];
      const consulta = Object.fromEntries(u.searchParams.entries());
      const amz = req.headers['x-amz-date'];
      const fecha = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
      const esperado = copia.firmarV4({ metodo: req.method, host: req.headers.host, ruta: u.pathname, consulta, cabeceras,
        hashCuerpo: req.headers['x-amz-content-sha256'], fecha, region: m[3], idClave: ID, secreto: SECRETO });
      const hashReal = crypto.createHash('sha256').update(cuerpo).digest('hex');
      firmaOk = esperado.firma === m[5] && hashReal === req.headers['x-amz-content-sha256'];
    }
    if (!firmaOk || S3.rechazar) {
      res.writeHead(403); return res.end('<Error><Code>' + (S3.rechazar ? 'AccessDenied' : 'SignatureDoesNotMatch') + '</Code></Error>');
    }
    const [, bucket, ...resto] = u.pathname.split('/');
    const clave = resto.map(decodeURIComponent).join('/');
    if (bucket !== 'flota') { res.writeHead(404); return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
    if (req.method === 'PUT') { S3.objetos.set(clave, { datos: cuerpo, en: new Date() }); res.writeHead(200); return res.end(); }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const pre = u.searchParams.get('prefix') || '';
      const items = [...S3.objetos.entries()].filter(([k]) => k.startsWith(pre)).map(([k, o]) =>
        `<Contents><Key>${k}</Key><LastModified>${o.en.toISOString()}</LastModified><Size>${o.datos.length}</Size></Contents>`).join('');
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><ListBucketResult>${items}</ListBucketResult>`);
    }
    if (req.method === 'GET') {
      const o = S3.objetos.get(clave);
      if (!o) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200); return res.end(o.datos);
    }
    res.writeHead(400); res.end();
  });
}).listen(PS3);

const ENV_S3 = {
  RESPALDO_S3_ENDPOINT: `http://localhost:${PS3}`, RESPALDO_S3_BUCKET: 'flota',
  RESPALDO_S3_KEY_ID: ID, RESPALDO_S3_SECRET: SECRETO, RESPALDO_S3_REGION: 'auto', RESPALDO_CIFRADO: FRASE,
};

let servidor = null;
async function arrancar(env = {}, { esperarVivo = true } = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo',
      CREATOR_PASSWORD: CLAVE_CREADOR, TZ: 'America/Lima', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.log = '';
  servidor.stdout.on('data', d => { servidor.log += d; });
  servidor.stderr.on('data', d => { servidor.log += d; });
  servidor.salida = new Promise(r => servidor.on('exit', r));
  if (!esperarVivo) return;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó:\n' + servidor.log);
}
const parar = async () => { servidor.kill(); await servidor.salida; await sleep(200); };
const pedir = (ruta, o = {}) => fetch(`http://localhost:${P}${ruta}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const creador = async () => ({ Authorization: 'Bearer ' + (await pedir('/creador/login', { method: 'POST',
  body: JSON.stringify({ password: CLAVE_CREADOR }) })).body.token });
const usuarios = () => { const d = new Database(DB, { readonly: true });
  const r = d.prepare('SELECT unitId FROM users').all().map(u => u.unitId); d.close(); return r; };
// Una cuenta cargada «después»: directo en la base (con el servidor andando,
// WAL deja escribir de a dos). Lo que se prueba es la restauración, no el alta.
const altaDe = async (unitId) => {
  const d = new Database(DB);
  const emp = d.prepare("SELECT companyId FROM users WHERE unitId = 'DESPACHO'").get().companyId;
  d.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
             VALUES (?, ?, ?, 'driver', 'R-14', ?, ?, ?)`).run(unitId, unitId, unitId, emp, hashPassword('clave12345'), Date.now());
  d.close();
};
const correr = (args, env) => new Promise((res, rej) => execFile('node', args, { env: { ...process.env, ...env }, encoding: 'utf8' },
  (e, out, err) => e ? rej(new Error(err || e.message)) : res(out)));
const hasta = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await sleep(200); } return false; };

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });

  console.log('\nLA FIRMA DE AWS, CONTRA SUS EJEMPLOS');
  {
    const base = { host: 'examplebucket.s3.amazonaws.com', fecha: new Date('2013-05-24T00:00:00Z'), region: 'us-east-1',
      idClave: 'AKIAIOSFODNN7EXAMPLE', secreto: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const vacio = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    ok('GET de un objeto', copia.firmarV4({ ...base, metodo: 'GET', ruta: '/test.txt', cabeceras: { range: 'bytes=0-9' }, hashCuerpo: vacio }).firma
      === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    ok('el listado (con consulta)', copia.firmarV4({ ...base, metodo: 'GET', ruta: '/', consulta: { 'max-keys': '2', prefix: 'J' }, hashCuerpo: vacio }).firma
      === '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
    const h = crypto.createHash('sha256').update('Welcome to Amazon S3.').digest('hex');
    ok('PUT con cuerpo y un $ en el nombre', copia.firmarV4({ ...base, metodo: 'PUT', ruta: '/test%24file.text',
      cabeceras: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, hashCuerpo: h }).firma
      === '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  }

  console.log('\nEL CIFRADO');
  {
    const plano = Buffer.from('CREATE TABLE users (unitId TEXT); INSERT INTO users VALUES (\'pedro\');'.repeat(50));
    const c = copia.cifrar(plano, FRASE);
    ok('ida y vuelta da lo mismo', copia.descifrar(c, FRASE).equals(plano));
    ok('comprimido y sin nada legible', c.length < plano.length && !c.includes('pedro') && !c.includes('CREATE'));
    ok('dos veces lo mismo no da lo mismo (sal e iv nuevos)', !copia.cifrar(plano, FRASE).equals(c));
    let e1 = null; try { copia.descifrar(c, 'otra frase cualquiera de prueba'); } catch (e) { e1 = e.message; }
    ok('con otra frase, no abre y lo dice', /frase de cifrado no es la de este respaldo/.test(e1 || ''), e1);
    const alterado = Buffer.from(c); alterado[alterado.length - 5] ^= 1;
    let e2 = null; try { copia.descifrar(alterado, FRASE); } catch (e) { e2 = e.message; }
    ok('un byte alterado tampoco', !!e2);
  }

  console.log('\nLA CONFIGURACIÓN');
  {
    ok('sin nada: no está configurada', copia.configDe({}) === null);
    ok('a medias: se dice qué falta', /van juntas/.test(copia.configDe({ RESPALDO_S3_BUCKET: 'x' }).error));
    ok('sin frase de cifrado: no sale nada', /RESPALDO_CIFRADO/.test(copia.configDe({ ...ENV_S3, RESPALDO_CIFRADO: '' }).error));
    ok('frase corta: tampoco', /16 caracteres/.test(copia.configDe({ ...ENV_S3, RESPALDO_CIFRADO: 'corta' }).error));
    const cfg = copia.configDe(ENV_S3);
    ok('completa', !cfg.error && cfg.prefijo === 'respaldos/' && cfg.region === 'auto');
  }

  console.log('\n/salud SIN COPIA AFUERA');
  {
    const d = new Database(path.join(DIR, 'salud.db'));
    const sinCopia = crearSalud({ db: d, demo: false, discoCriticoMb: 0, discoAvisoMb: 0, medirBucle: false,
      copiaAfuera: () => ({ configurada: false }) }).chequear();
    ok('en producción, sin copia afuera: aviso', sinCopia.avisos.includes('sin_copia_afuera') && sinCopia.ok === true, sinCopia.avisos);
    const mal = crearSalud({ db: d, demo: false, medirBucle: false, copiaAfuera: () => ({ configurada: false, error: 'falta' }) }).chequear();
    ok('a medio configurar: aviso propio', mal.avisos.includes('copia_afuera_mal_configurada'));
    const vieja = crearSalud({ db: d, demo: true, medirBucle: false, respaldo: { CADA_HORAS: 6, dirDe: () => DIR, listar: () => [{ cuando: Date.now() }] },
      copiaAfuera: () => ({ configurada: true, revisada: true, ultimaOk: { en: Date.now() - 13 * 3600_000 } }) }).chequear();
    ok('la última copia de hace 13 h: vieja', vieja.avisos.includes('copia_afuera_vieja'), vieja.avisos);
    d.close();
  }

  console.log('\nEL SERVIDOR SUBE LA COPIA');
  await arrancar(ENV_S3);
  ok('el respaldo del arranque sale cifrado al almacenamiento', await hasta(() => S3.objetos.size >= 1), S3.pedidos);
  const [clave] = [...S3.objetos.keys()];
  const objeto = S3.objetos.get(clave).datos;
  ok('con su nombre y adentro de respaldos/', /^respaldos\/respaldo-\d{4}-\d{2}-\d{2}-\d{6}\.db\.gz\.enc$/.test(clave), clave);
  ok('ilegible para el proveedor', objeto.subarray(0, 6).toString() === 'FLOTA1' && !objeto.includes('DESPACHO') && !objeto.includes('SQLite format'));
  const abierto = path.join(DIR, 'abierto.db');
  fs.writeFileSync(abierto, copia.descifrar(objeto, FRASE));
  { const d = new Database(abierto, { readonly: true });
    ok('y descifrada es la base, con DESPACHO adentro', !!d.prepare("SELECT 1 FROM users WHERE unitId = 'DESPACHO'").get()); d.close(); }
  ok('ni un archivo de verificación suelto', !fs.readdirSync(DIR).some(n => /restaurando/.test(n)));
  ok('ningún pedido con la firma mal', !servidor.log.includes('SignatureDoesNotMatch') && !/COPIA AFUERA FALLÓ/.test(servidor.log), servidor.log.split('\n').filter(l => /COPIA/.test(l)));
  let s = await fetch(`http://localhost:${P}/salud`).then(r => r.json());
  ok('/salud sin avisos de copia', !s.avisos.some(a => /copia/.test(a)), s);
  const HC = await creador();
  const lista = await pedir('/creador/respaldos-afuera', { headers: HC });
  ok('el panel del creador la lista (de ahí sale el nombre para restaurar)', lista.body.configurada === true && lista.body.copias.some(c => c.clave === clave), lista.body);
  const manual = await pedir('/creador/respaldos', { method: 'POST', headers: HC });
  ok('«Respaldar ahora» también la copia afuera, y dice si salió', manual.status === 200 && manual.body.afuera && manual.body.afuera.ok === true, manual.body.afuera);
  // Algo cargado DESPUÉS del respaldo: lo que se pierde al restaurar
  await altaDe('despues');
  ok('se carga a «despues» después del respaldo', usuarios().includes('despues'));
  await parar();

  console.log('\nVOLVER A UNO DE LA COPIA AFUERA');
  await arrancar({ ...ENV_S3, RESTAURAR_DESDE: clave });
  ok('arranca con la base del respaldo: «despues» no está', !usuarios().includes('despues') && usuarios().includes('DESPACHO'), usuarios());
  const antes = fs.readdirSync(DIR).filter(n => /^r14\.db\.antes-de-restaurar-\d{8}-\d{6}$/.test(n));
  ok('la base de antes NO se borró: quedó al lado', antes.length === 1, fs.readdirSync(DIR));
  { const d = new Database(path.join(DIR, antes[0]), { readonly: true });
    ok('y tiene a «despues»', !!d.prepare("SELECT 1 FROM users WHERE unitId = 'despues'").get()); d.close(); }
  ok('el log dice qué hizo y que hay que sacar la variable', /Base restaurada desde .*sacá RESTAURAR_DESDE/s.test(servidor.log));
  const sis = await pedir('/creador/sistema', { headers: await creador() });
  ok('el panel del creador lo muestra', sis.body.restauracion && sis.body.restauracion.pedido === clave, sis.body.restauracion);
  await altaDe('post');
  await parar();

  console.log('\nSI LA VARIABLE QUEDA PUESTA');
  await arrancar({ ...ENV_S3, RESTAURAR_DESDE: clave });
  ok('no vuelve a restaurar: lo cargado después sigue ahí', usuarios().includes('post'), usuarios());
  ok('y avisa que hay que sacarla', /ya se restauró .*no se repite/.test(servidor.log));
  await parar();

  console.log('\nUN NOMBRE EQUIVOCADO');
  await arrancar({ ...ENV_S3, RESTAURAR_DESDE: 'respaldos/no-existe.db.gz.enc' }, { esperarVivo: false });
  const codigo = await Promise.race([servidor.salida, sleep(30000).then(() => 'sigue')]);
  ok('no arranca (sale con 1) y dice por qué', codigo === 1 && /No existe «respaldos\/no-existe\.db\.gz\.enc»/.test(servidor.log) &&
     /La base actual NO se tocó/.test(servidor.log), { codigo, log: servidor.log.split('\n').filter(l => /✖|No existe/.test(l)) });
  ok('y la base sigue como estaba', usuarios().includes('post'));
  await arrancar({ ...ENV_S3, RESTAURAR_DESDE: 'local:../../etc/passwd' }, { esperarVivo: false });
  ok('un local con ruta se rechaza', (await servidor.salida) === 1 && /no es el nombre de un respaldo/.test(servidor.log));

  console.log('\nVOLVER A UNO DEL DISCO');
  const locales = fs.readdirSync(path.join(DIR, 'respaldos')).filter(n => /^respaldo-.*\.db$/.test(n)).sort();
  await arrancar({ RESTAURAR_DESDE: 'local:' + locales[0] });
  ok('con local: y sin copia afuera configurada', !usuarios().includes('post') && usuarios().includes('DESPACHO'), usuarios());
  await parar();

  console.log('\nUN ALMACENAMIENTO QUE RECHAZA');
  S3.rechazar = true;
  await arrancar(ENV_S3);
  await hasta(async () => (await fetch(`http://localhost:${P}/salud`).then(r => r.json())).avisos.includes('copia_afuera_falla'));
  s = await fetch(`http://localhost:${P}/salud`).then(r => r.json());
  ok('/salud lo avisa (200: el servidor trabaja igual)', s.ok === true && s.avisos.includes('copia_afuera_falla'), s);
  const l2 = await pedir('/creador/respaldos-afuera', { headers: await creador() });
  ok('el panel dice qué contestó el almacenamiento', /403 \(AccessDenied\)/.test(l2.body.error || '') ||
     /AccessDenied/.test(JSON.stringify(l2.body.estado || {})), l2.body);
  await parar();
  S3.rechazar = false;

  console.log('\nLA HERRAMIENTA DE LÍNEA DE COMANDOS');
  const bajado = path.join(DIR, 'bajado.db.gz.enc');
  fs.writeFileSync(bajado, objeto);
  const salida = await correr([RAIZ + '/server/restaurar.js', 'descifrar', bajado, path.join(DIR, 'mirado.db')], { RESPALDO_CIFRADO: FRASE });
  ok('descifra un respaldo bajado y lo verifica', /✔ .*mirado\.db .*verificada/.test(salida), salida.trim());
  const listado = await correr([RAIZ + '/server/restaurar.js', 'listar'], ENV_S3);
  ok('y lista lo que hay afuera', listado.includes(clave), listado.trim());

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
