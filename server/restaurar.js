'use strict';
// Volver a un respaldo (PENDIENTES 0.3, 03/11). Dos usos:
//
// 1. EN EL SERVIDOR, al arrancar. En Railway no hay una terminal para
//    copiar un archivo al volumen: se pone la variable RESTAURAR_DESDE con el
//    nombre del respaldo y se redespliega. `index.js` corre esto ANTES de
//    abrir la base (con la base cerrada, mover archivos es seguro):
//      - `local:respaldo-2026-11-03-060000.db` → uno de los del volumen
//      - `respaldos/respaldo-2026-11-03-060000.db.gz.enc` → uno de la copia
//        afuera (se baja y se descifra con RESPALDO_CIFRADO)
//    Se verifica (abre, quick_check, tiene las tablas), la base actual NO se
//    borra: queda al lado como `r14.db.antes-de-restaurar-<fecha>`, y se deja
//    una marca (`restaurado.json`) con lo que se pidió. Si la variable queda
//    puesta, el próximo arranque ve la marca y NO vuelve a restaurar — sin
//    esto, olvidarse la variable borraba en cada reinicio todo lo cargado
//    después de la restauración.
//
// 2. EN UNA COMPUTADORA, con Node y las mismas variables de la copia afuera:
//      node server/restaurar.js listar
//      node server/restaurar.js bajar <clave> [destino.db]
//      node server/restaurar.js descifrar <archivo.gz.enc> [destino.db]
//    Para mirar un respaldo sin tocar el servidor, o tenerlo a mano.
const fs = require('fs');
const path = require('path');
const copia = require('./copia-afuera');
const respaldo = require('./respaldo');

const MARCA = 'restaurado.json';
const p2 = (n) => String(n).padStart(2, '0');
const sello = (d = new Date()) =>
  `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

function cargarDatabase() {
  return require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
}

function marcaDe(dbFile) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(dbFile), MARCA), 'utf8')); } catch { return null; }
}

// Lo que se pidió → los bytes de la base. Valida el nombre: nada de rutas.
async function obtener(pedido, dbFile, env, fetchImpl) {
  if (pedido.startsWith('local:')) {
    const nombre = pedido.slice(6);
    if (!respaldo.ES_RESPALDO.test(nombre)) throw new Error(`«${nombre}» no es el nombre de un respaldo (respaldo-AAAA-MM-DD-HHMMSS.db)`);
    const ruta = path.join(respaldo.dirDe(dbFile), nombre);
    if (!fs.existsSync(ruta)) throw new Error(`No existe ${nombre} en ${respaldo.dirDe(dbFile)}`);
    // Se copia de archivo a archivo, no por memoria: `readFileSync` no lee
    // más de 2 GiB y una base grande no se podía restaurar (auditoría 11/11)
    return { archivo: ruta };
  }
  if (!/^[\w./-]+$/.test(pedido) || pedido.includes('..')) throw new Error(`«${pedido}» no parece el nombre de un respaldo de la copia afuera`);
  // Del almacenamiento, sólo lo CIFRADO: un .db plano ahí no tiene cómo
  // probar que lo subió este sistema —quien tenga la llave del bucket podría
  // dejar una base suya con nombre de respaldo— (revisión integral del
  // 04/11). Un .db bajado a mano se restaura con `local:` o por la consola.
  if (!/\.enc$/.test(pedido)) throw new Error(`«${pedido}» no es una copia cifrada (.gz.enc): desde el almacenamiento sólo se restauran ésas`);
  const cfg = copia.configDe(env);
  if (!cfg) throw new Error('Para bajar de la copia afuera hacen falta las variables RESPALDO_S3_* y RESPALDO_CIFRADO');
  if (cfg.error) throw new Error(cfg.error);
  return copia.bajar(cfg, pedido, fetchImpl);
}

// El reemplazo, con la base CERRADA. Devuelve la marca escrita.
async function restaurarAlArrancar({ dbFile, pedido, env = process.env, fetchImpl, log = console.log } = {}) {
  const previa = marcaDe(dbFile);
  if (previa && previa.pedido === pedido) {
    log(`RESTAURAR_DESDE=${pedido} ya se restauró el ${new Date(previa.en).toLocaleString('es-PE')}: no se repite. ` +
        'Sacá la variable de Railway.');
    return { repetido: true, marca: previa };
  }
  const Database = cargarDatabase();
  log(`Restaurando la base desde ${pedido}…`);
  const datos = await obtener(pedido, dbFile, env, fetchImpl);
  const nueva = `${dbFile}.restaurando`;
  // Sin espacio, la escritura falla a la mitad: el pedazo no puede quedar
  // ocupando el disco que ya faltaba (revisión integral del 04/11)
  try {
    if (datos && datos.archivo) fs.copyFileSync(datos.archivo, nueva);
    else fs.writeFileSync(nueva, datos);
  }
  catch (e) {
    try { fs.unlinkSync(nueva); } catch {}
    throw new Error(`No se pudo escribir el respaldo al lado de la base (${e.code === 'ENOSPC' ? 'no hay espacio en el disco' : e.message}): la base actual NO se tocó`);
  }
  const v = respaldo.verificar(Database, nueva);
  // Abrirla para verificar deja sus -wal y -shm (vacíos): no viajan con ella
  for (const x of ['-wal', '-shm']) { try { fs.unlinkSync(nueva + x); } catch {} }
  if (!v.ok) {
    try { fs.unlinkSync(nueva); } catch {}
    throw new Error(`El respaldo no pasó la verificación (${v.motivo}): la base actual NO se tocó`);
  }
  // La actual se guarda, no se borra: si el respaldo elegido era el
  // equivocado, se puede volver
  let anterior = null;
  if (fs.existsSync(dbFile)) {
    anterior = `${dbFile}.antes-de-restaurar-${sello()}`;
    fs.renameSync(dbFile, anterior);
    for (const x of ['-wal', '-shm']) {
      if (fs.existsSync(dbFile + x)) fs.renameSync(dbFile + x, anterior + x);
    }
  }
  fs.renameSync(nueva, dbFile);
  const bytes = datos && datos.archivo ? fs.statSync(dbFile).size : datos.length;
  const marca = { pedido, en: Date.now(), bytes, anterior: anterior ? path.basename(anterior) : null };
  fs.writeFileSync(path.join(path.dirname(dbFile), MARCA), JSON.stringify(marca, null, 2));
  log(`✔ Base restaurada desde ${pedido}. La anterior quedó como ${marca.anterior || '(no había)'}. ` +
      'Cuando confirmes que está bien, sacá RESTAURAR_DESDE de las variables.');
  return { repetido: false, marca };
}

// ─── LÍNEA DE COMANDOS ──────────────────────────────────────
async function principal(argv) {
  const [orden, a, b] = argv;
  if (orden === 'al-arrancar') {
    await restaurarAlArrancar({ dbFile: process.env.DB_FILE, pedido: String(process.env.RESTAURAR_DESDE || '').trim() });
    return;
  }
  if (orden === 'listar') {
    const cfg = copia.configDe();
    if (!cfg || cfg.error) throw new Error(cfg ? cfg.error : 'Faltan las variables RESPALDO_S3_* y RESPALDO_CIFRADO');
    for (const x of await copia.listar(cfg)) {
      console.log(`${new Date(x.cuando).toLocaleString('es-PE')}  ${String(Math.round(x.bytes / 1024)).padStart(7)} kB  ${x.clave}`);
    }
    return;
  }
  if (orden === 'bajar' || orden === 'descifrar') {
    if (!a) throw new Error(`Uso: node server/restaurar.js ${orden} <${orden === 'bajar' ? 'clave' : 'archivo.gz.enc'}> [destino.db]`);
    let datos;
    if (orden === 'bajar') {
      const cfg = copia.configDe();
      if (!cfg || cfg.error) throw new Error(cfg ? cfg.error : 'Faltan las variables RESPALDO_S3_* y RESPALDO_CIFRADO');
      datos = await copia.bajar(cfg, a);
    } else {
      if (!process.env.RESPALDO_CIFRADO) throw new Error('Falta RESPALDO_CIFRADO (la frase con que se cifró)');
      datos = copia.descifrar(fs.readFileSync(a), process.env.RESPALDO_CIFRADO);
    }
    const destino = b || path.basename(a).replace(/\.gz\.enc$/, '');
    fs.writeFileSync(destino, datos);
    const v = respaldo.verificar(cargarDatabase(), destino);
    console.log(v.ok ? `✔ ${destino} (${Math.round(datos.length / 1024)} kB), verificada` : `✖ ${destino} no pasa la verificación: ${v.motivo}`);
    if (!v.ok) process.exitCode = 1;
    return;
  }
  console.log('Uso:\n  node server/restaurar.js listar\n  node server/restaurar.js bajar <clave> [destino.db]\n' +
              '  node server/restaurar.js descifrar <archivo.gz.enc> [destino.db]');
}

if (require.main === module) {
  principal(process.argv.slice(2)).catch((e) => {
    console.error('✖ ' + e.message);
    process.exit(1);
  });
}

module.exports = { restaurarAlArrancar, marcaDe, MARCA };
