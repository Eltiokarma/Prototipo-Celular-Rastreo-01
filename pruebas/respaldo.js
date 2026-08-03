// El respaldo de la base (`server/respaldo.js`) y sus endpoints del creador.
//
// Lo que se defiende no es que exista un archivo: es que ese archivo SIRVA el
// día que haga falta. Un respaldo corrupto guardado con éxito es peor que
// ninguno — es la falsa tranquilidad de que "hay respaldo" hasta el día en
// que se lo necesita y no abre. Por eso acá se respalda una base real, se la
// restaura de verdad, y se lee lo restaurado.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { respaldar, verificar, rotar, listar, nombreDe, ES_RESPALDO } = require(RAIZ + '/server/respaldo.js');

const DB = S + '/respaldo-test.db';
const CARPETA = S + '/respaldo-test-dir';
const P = 3157;
const API = `http://localhost:${P}`;
const CLAVE = 'una-clave-larga-de-creador-99';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const limpiar = () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  try { fs.rmSync(CARPETA, { recursive: true, force: true }); } catch {}
};

(async () => {
  limpiar();

  console.log('\nEL NOMBRE ORDENA SOLO');
  {
    // La rotación y "cuál es el último" salen de ordenar texto. Si el nombre
    // no ordenara cronológicamente, la rotación borraría los nuevos.
    const a = nombreDe(new Date(2026, 7, 3, 9, 5, 0));
    const b = nombreDe(new Date(2026, 7, 3, 18, 30, 0));
    const c = nombreDe(new Date(2026, 11, 1, 0, 0, 0));
    ok('la mañana ordena antes que la tarde', a < b, [a, b]);
    ok('y agosto antes que diciembre', b < c, [b, c]);
    ok('el formato es el que la descarga acepta', ES_RESPALDO.test(a), a);
  }

  console.log('\nRESPALDAR UNA BASE DE VERDAD');
  {
    // Una base con vida: tablas como las reales y filas que se puedan releer.
    const db = new Database(DB);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE users (unitId TEXT PRIMARY KEY, name TEXT);
             CREATE TABLE routes (routeId TEXT PRIMARY KEY);
             CREATE TABLE companies (companyId TEXT PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run('M-12', 'Elmer Ccama');
    db.prepare('INSERT INTO companies VALUES (?, ?)').run('R14', 'Cooperativa Juliaca');

    const r = await respaldar(db, Database, { dir: CARPETA, cuando: new Date(2026, 7, 3, 10, 0, 0) });
    ok('se crea y se verifica', r.ok === true, r);
    ok('con un tamaño real', r.bytes > 1000, r.bytes);

    // LA PRUEBA QUE IMPORTA: restaurar y leer. Un respaldo se juzga por la
    // restauración, no por la creación.
    const restaurada = new Database(path.join(CARPETA, r.archivo), { readonly: true });
    const fila = restaurada.prepare('SELECT name FROM users WHERE unitId = ?').get('M-12');
    ok('lo restaurado tiene los datos', fila?.name === 'Elmer Ccama', fila);
    restaurada.close();

    // Y sigue sirviendo aunque la base original siga escribiendo (WAL):
    db.prepare('INSERT INTO users VALUES (?, ?)').run('M-08', 'Rufino Quispe');
    const r2 = await respaldar(db, Database, { dir: CARPETA, cuando: new Date(2026, 7, 3, 16, 0, 0) });
    const dos = new Database(path.join(CARPETA, r2.archivo), { readonly: true });
    ok('el segundo respaldo trae lo nuevo',
       dos.prepare('SELECT COUNT(*) AS c FROM users').get().c === 2);
    dos.close();
    db.close();
  }

  console.log('\nUN RESPALDO ROTO NO SE GUARDA');
  {
    // La verificación abre el archivo de verdad. Basura con nombre de .db:
    const falso = path.join(CARPETA, 'falso.db');
    fs.writeFileSync(falso, 'esto no es una base de datos para nada');
    const v = verificar(Database, falso);
    ok('la basura se rechaza', v.ok === false, v.motivo);
    fs.unlinkSync(falso);

    // Y una base VÁLIDA pero vacía —sin las tablas del sistema— también: un
    // respaldo de la base equivocada pasa quick_check y no sirve de nada.
    const vacia = path.join(CARPETA, 'vacia.db');
    const dbv = new Database(vacia);
    dbv.exec('CREATE TABLE x (a)');
    dbv.close();
    const v2 = verificar(Database, vacia);
    ok('una base sin las tablas del sistema también', v2.ok === false, v2.motivo);
    fs.unlinkSync(vacia);

    // En memoria no hay qué respaldar, y se dice.
    const mem = new Database(':memory:');
    const r = await respaldar(mem, Database, { dir: CARPETA });
    ok('la base en memoria avisa en vez de fingir', r.ok === false && /memoria/.test(r.motivo), r.motivo);
    mem.close();
  }

  console.log('\nLA ROTACIÓN');
  {
    // Se fabrican respaldos "viejos" con nombres reales y se verifica que se
    // van LOS MÁS VIEJOS — al revés, la rotación destruiría la historia nueva.
    const previos = listar(CARPETA).length;   // los 2 de arriba
    for (let d = 1; d <= 6; d++) {
      fs.writeFileSync(path.join(CARPETA, nombreDe(new Date(2026, 0, d, 12, 0, 0))), 'x');
    }
    const borrados = rotar(CARPETA, 4);
    ok('borra hasta quedar en el tope', listar(CARPETA).length === 4, listar(CARPETA).length);
    ok('y borró la cantidad justa', borrados === previos + 6 - 4, borrados);
    const quedan = listar(CARPETA).map(r => r.archivo);
    ok('sobreviven los más nuevos',
       quedan.includes(nombreDe(new Date(2026, 7, 3, 16, 0, 0))) &&
       !quedan.includes(nombreDe(new Date(2026, 0, 1, 12, 0, 0))), quedan);
  }

  // ─── Con el servidor y el panel del creador ──────────────────────────────
  limpiar();
  const servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', CREATOR_PASSWORD: CLAVE,
           RESPALDO_DIR: CARPETA, RESPALDO_CADA_H: '0',   // el timer no ensucia la prueba
           STATE_INTERVAL_MS: '600' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let listo = false;
  for (let i = 0; i < 80 && !listo; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); listo = true; } catch {}
  }
  if (!listo) { console.log('FALLA  el servidor no arrancó'); process.exit(1); }

  const pedir = async (ruta, opciones = {}) => {
    const r = await fetch(API + ruta, opciones);
    const texto = await r.text();
    let cuerpo = null; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
    return { ok: r.ok, status: r.status, cuerpo, crudoBuffer: null };
  };

  console.log('\nDESDE EL PANEL DEL CREADOR');
  {
    const login = await pedir('/creador/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: CLAVE }),
    });
    ok('entra el creador', login.ok, login.status);
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.cuerpo.token };

    const creado = await pedir('/creador/respaldos', { method: 'POST', headers: H });
    ok('un respaldo a pedido se crea y verifica', creado.ok && !!creado.cuerpo.archivo, creado.cuerpo);

    const lista = await pedir('/creador/respaldos', { headers: H });
    ok('el listado lo muestra, el más nuevo primero',
       lista.cuerpo?.respaldos?.[0]?.archivo === creado.cuerpo.archivo,
       lista.cuerpo?.respaldos?.map(r => r.archivo));

    // LA DESCARGA ES EL RESPALDO FUERA DEL SERVIDOR: lo que baja tiene que
    // ser una base que abre y tiene los datos, no un archivo cualquiera.
    const r = await fetch(`${API}/creador/respaldos/${creado.cuerpo.archivo}`, { headers: H });
    ok('se descarga', r.ok, r.status);
    const cuerpo = Buffer.from(await r.arrayBuffer());
    const tmp = path.join(CARPETA, 'descargado.db');
    fs.writeFileSync(tmp, cuerpo);
    const abierta = new Database(tmp, { readonly: true });
    const despacho = abierta.prepare("SELECT unitId FROM users WHERE role = 'dispatch'").get();
    ok('y lo descargado es una base viva, con el DESPACHO adentro',
       despacho?.unitId === 'DESPACHO', despacho);
    abierta.close();
    fs.unlinkSync(tmp);

    // Un nombre malicioso no es un nombre: sin este rechazo, `../` convierte
    // la descarga en lectura arbitraria del disco con sesión de creador.
    const feo = await fetch(`${API}/creador/respaldos/..%2F..%2Fetc%2Fpasswd`, { headers: H });
    ok('un nombre con ../ se rechaza', feo.status === 400 || feo.status === 404, feo.status);
    const feo2 = await pedir('/creador/respaldos/cualquiercosa.db', { headers: H });
    ok('y un nombre fuera de formato también', feo2.status === 400, feo2.status);

    const inventado = await pedir('/creador/respaldos/' + nombreDe(new Date(2020, 0, 1)), { headers: H });
    ok('uno que no existe da 404', inventado.status === 404, inventado.status);
  }

  console.log('\nSIN CREADOR NO HAY RESPALDOS');
  {
    // La base es de TODAS las cooperativas: su respaldo no le pertenece a
    // ninguna. Ni sin sesión, ni con la sesión más alta del nivel de abajo.
    const suelto = await pedir('/creador/respaldos');
    ok('sin sesión, no se ve', suelto.status === 401 || suelto.status === 404, suelto.status);

    const d = await pedir('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }),
    });
    const conDespacho = await pedir('/creador/respaldos', {
      headers: { Authorization: 'Bearer ' + d.cuerpo.token },
    });
    ok('y la sesión de Despacho tampoco lo abre',
       conDespacho.status === 401 || conDespacho.status === 404, conDespacho.status);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  servidor.kill();
  await sleep(300);
  limpiar();
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('FALLA  ' + e.message);
  limpiar();
  process.exit(1);
});
