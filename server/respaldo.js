// El respaldo de la base.
//
// La base tiene TODO: usuarios, rutas, trazados, chat, vueltas, informes,
// logos. Hasta este archivo no había NINGÚN respaldo — un volumen perdido o
// un DB_FILE mal apuntado se llevaba la cooperativa entera, sin de dónde
// volver. Es lo primero que pregunta cualquiera que confíe su operación a un
// sistema, y la respuesta era "no hay".
//
// QUÉ PROTEGE Y QUÉ NO. El respaldo automático queda en el MISMO disco (el
// volumen montado): eso cubre corrupción de la base, un borrado por error y
// un bug que escriba mal — no cubre perder el volumen entero. Para eso, desde
// el 03/11, cada respaldo verificado sale cifrado a un bucket aparte
// (`copia-afuera.js`, con `alTerminar` de `programar`), y se vuelve a uno con
// RESTAURAR_DESDE (`restaurar.js`). La descarga desde el panel del creador
// sigue estando, para tener uno en la mano.
//
// CÓMO SE HACE. Con `db.backup()` de better-sqlite3, que usa la API de
// respaldo en caliente de SQLite: consistente aunque el servidor esté
// escribiendo, compatible con WAL, sin frenar a nadie. NUNCA copiando el
// archivo con `cp` — copiar una base viva con WAL da un archivo que abre
// bien y está roto por dentro, que es el peor de los respaldos posibles.

'use strict';

const fs = require('fs');
const path = require('path');

// Cuántos se conservan. Con uno cada 6 horas, 28 archivos son una semana de
// historia. La base de una cooperativa chica pesa pocos MB: una semana entera
// cuesta menos que una foto del chat.
const CONSERVAR = Number(process.env.RESPALDO_CONSERVAR) || 28;

// Cada cuánto, en horas. 0 apaga el respaldo automático (queda el manual).
const CADA_HORAS = process.env.RESPALDO_CADA_H !== undefined
  ? Number(process.env.RESPALDO_CADA_H)
  : 6;

// Dónde. Por defecto en `respaldos/` al lado de la base — o sea adentro del
// mismo volumen montado, que es el único disco que sobrevive un redeploy.
function dirDe(archivoBase) {
  if (process.env.RESPALDO_DIR) return process.env.RESPALDO_DIR;
  return path.join(path.dirname(archivoBase), 'respaldos');
}

// El nombre lleva la fecha y ORDENA bien como texto: la rotación y "cuál es
// el último" salen de ordenar el listado, sin parsear nada.
function nombreDe(cuando = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `respaldo-${cuando.getFullYear()}-${p(cuando.getMonth() + 1)}-${p(cuando.getDate())}` +
         `-${p(cuando.getHours())}${p(cuando.getMinutes())}${p(cuando.getSeconds())}.db`;
}

const ES_RESPALDO = /^respaldo-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

// Un respaldo que no se puede abrir no es un respaldo: es una falsa
// tranquilidad guardada en el disco. Se verifica CADA archivo recién creado,
// abriéndolo de verdad y preguntándole a SQLite si está íntegro. Si no pasa,
// se borra y se avisa — mejor saber hoy que el respaldo falla que descubrirlo
// el día que haga falta.
function verificar(Database, archivo) {
  let db = null;
  try {
    db = new Database(archivo, { readonly: true });
    const chequeo = db.pragma('quick_check', { simple: true });
    if (chequeo !== 'ok') return { ok: false, motivo: `quick_check: ${chequeo}` };
    // Que además tenga las tablas que importan: un .db vacío pasa quick_check.
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map(t => t.name);
    for (const esperada of ['users', 'routes', 'companies']) {
      if (!tablas.includes(esperada)) return { ok: false, motivo: `falta la tabla ${esperada}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  } finally {
    try { db && db.close(); } catch {}
  }
}

// La misma verificación, en un HILO aparte. `quick_check` es síncrono y
// recorre la base entera: 626 MB tardaban ~1 s con el hilo único parado —el
// GPS y el SOS de todas las cooperativas esperando— cada 6 h, al arrancar y
// en cada respaldo manual; con 2 a 5 GB serían 3 a 9 s (auditoría 11/11,
// medido). Si el hilo no se puede crear, se verifica como antes.
function verificarEnHilo(Database, archivo) {
  let modulo;
  try { modulo = require.resolve('better-sqlite3', { paths: [__dirname] }); }
  catch { return Promise.resolve(verificar(Database, archivo)); }
  return new Promise((resolve) => {
    let w;
    try {
      const { Worker } = require('worker_threads');
      w = new Worker(
        "const { parentPort, workerData } = require('worker_threads');" +
        "const Database = require(workerData.modulo);" +
        "const { verificar } = require(workerData.respaldo);" +
        "parentPort.postMessage(verificar(Database, workerData.archivo));",
        { eval: true, workerData: { modulo, respaldo: __filename, archivo } });
    } catch { resolve(verificar(Database, archivo)); return; }
    let listo = false;
    const fin = (r) => { if (!listo) { listo = true; resolve(r); } };
    w.once('message', fin);
    w.once('error', (e) => fin({ ok: false, motivo: e.message }));
    w.once('exit', (c) => fin(c === 0 ? { ok: false, motivo: 'el hilo terminó sin contestar' } : { ok: false, motivo: `el hilo salió con ${c}` }));
  });
}

// Hace un respaldo, lo verifica y rota los viejos. Devuelve qué pasó en vez
// de tirar: quien llama decide si es un log o un 500.
//
// ANTES de escribir mira si hay lugar: el temporal ocupa lo mismo que la base
// y la rotación borra recién después. Sin mirar, el propio respaldo llenaba
// el disco cada 6 h, y con el disco lleno la flota dejaba de entrar al mapa
// (auditoría 11/11). Si no entra con `reservaMb` de margen, primero borra
// respaldos viejos (siempre deja el último); si aun así no entra, no lo
// intenta y lo dice.
async function respaldar(db, Database, { dir, cuando = new Date(), conservar = CONSERVAR, reservaMb = RESERVA_MB, libreBytes = libreEn } = {}) {
  if (!db || !db.name || db.name === ':memory:') {
    return { ok: false, motivo: 'la base está en memoria: no hay qué respaldar' };
  }
  const carpeta = dir || dirDe(db.name);
  fs.mkdirSync(carpeta, { recursive: true });
  {
    let tamano = 0;
    for (const f of [db.name, db.name + '-wal']) { try { tamano += fs.statSync(f).size; } catch {} }
    const hace = () => tamano + reservaMb * 1048576;
    let libre = libreBytes(carpeta);
    let quedan = listar(carpeta).length;
    while (libre != null && libre < hace() && quedan > 1) {
      rotar(carpeta, quedan - 1);
      quedan = listar(carpeta).length;
      libre = libreBytes(carpeta);
    }
    if (libre != null && libre < hace()) {
      return { ok: false, sinLugar: true,
        motivo: `no hay disco para el respaldo: hacen falta ${Math.round(hace() / 1048576)} MB y quedan ${Math.round(libre / 1048576)} MB` };
    }
  }
  const destino = path.join(carpeta, nombreDe(cuando));
  // Se escribe con un nombre TEMPORAL —que `listar` no reconoce— y recién
  // verificado se renombra al definitivo, que en el mismo disco es atómico.
  // Escrito en su lugar final, un apagado a mitad de `backup` dejaba un
  // archivo roto con nombre de respaldo: `listar` lo contaba como el último,
  // el arranque decía «todavía vale» y no respaldaba, y el panel lo ofrecía
  // para bajar. Y dos pedidos en el mismo segundo escribían el mismo archivo:
  // el que fallaba borraba el que el otro acababa de verificar (22/9).
  const temporal = `${destino}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  limpiarTemporales(carpeta);

  try {
    await db.backup(temporal);
  } catch (e) {
    try { fs.unlinkSync(temporal); } catch {}
    return { ok: false, motivo: 'backup: ' + e.message };
  }

  const v = await verificarEnHilo(Database, temporal);
  if (!v.ok) {
    try { fs.unlinkSync(temporal); } catch {}
    return { ok: false, motivo: 'verificación: ' + v.motivo };
  }
  try {
    fs.renameSync(temporal, destino);
  } catch (e) {
    try { fs.unlinkSync(temporal); } catch {}
    return { ok: false, motivo: 'renombrar: ' + e.message };
  }

  const borrados = rotar(carpeta, conservar);
  const bytes = fs.statSync(destino).size;
  return { ok: true, archivo: path.basename(destino), bytes, borrados };
}

// Los temporales de un respaldo que se cortó (el proceso murió a mitad). Se
// borran los de más de una hora: uno más nuevo puede ser de otro respaldo
// que está corriendo ahora mismo.
function limpiarTemporales(carpeta) {
  let nombres = [];
  try { nombres = fs.readdirSync(carpeta); } catch { return; }
  const hace1h = Date.now() - 3600_000;
  for (const n of nombres) {
    if (!/^respaldo-.*\.db\.tmp-/.test(n)) continue;
    const ruta = path.join(carpeta, n);
    try { if (fs.statSync(ruta).mtimeMs < hace1h) fs.unlinkSync(ruta); } catch {}
  }
}

// Se van los MÁS VIEJOS. El nombre ordena cronológicamente como texto.
// Lo que tiene que quedar libre en el disco DESPUÉS de escribir el respaldo:
// es el margen con el que la base sigue guardando turnos, mensajes y SOS.
const RESERVA_MB = Number(process.env.RESPALDO_RESERVA_MB || 200);
function libreEn(carpeta) {
  if (typeof fs.statfsSync !== 'function') return null;
  try { const st = fs.statfsSync(carpeta); return st.bavail * st.bsize; } catch { return null; }
}

function rotar(carpeta, conservar = CONSERVAR) {
  const todos = listar(carpeta).map(r => r.archivo).sort();
  const sobran = todos.slice(0, Math.max(0, todos.length - conservar));
  for (const a of sobran) {
    try { fs.unlinkSync(path.join(carpeta, a)); } catch {}
  }
  return sobran.length;
}

function listar(carpeta) {
  let nombres = [];
  try { nombres = fs.readdirSync(carpeta); } catch { return []; }
  return nombres
    .filter(n => ES_RESPALDO.test(n))
    .sort()
    .map(n => {
      let bytes = 0, cuando = null;
      try {
        const st = fs.statSync(path.join(carpeta, n));
        bytes = st.size; cuando = st.mtimeMs;
      } catch {}
      return { archivo: n, bytes, cuando };
    });
}

// El automático: uno ahora si el último quedó lejos, y de ahí en más uno cada
// CADA_HORAS. Se cuelga del arranque del servidor y no de cron del sistema,
// porque en Railway no hay cron: solo existe este proceso.
// `alTerminar(r)` corre después de cada respaldo bueno: la copia afuera.
function programar(db, Database, { log = console.log, alTerminar = null } = {}) {
  if (!CADA_HORAS || CADA_HORAS <= 0) {
    log('Respaldo automático APAGADO (RESPALDO_CADA_H=0)');
    return null;
  }
  if (!db || !db.name || db.name === ':memory:') return null;

  const carpeta = dirDe(db.name);
  const cadaMs = CADA_HORAS * 3600 * 1000;

  const correr = async () => {
    const r = await respaldar(db, Database, { dir: carpeta });
    if (r.ok) log(`Respaldo: ${r.archivo} (${Math.round(r.bytes / 1024)} kB)${r.borrados ? `, ${r.borrados} viejo(s) rotado(s)` : ''}`);
    else console.error('RESPALDO FALLÓ: ' + r.motivo);
    if (r.ok && alTerminar) { try { await alTerminar(r); } catch {} }
    return r;
  };

  // Al arrancar solo si hace falta: un servidor que se redeploya cinco veces
  // en una tarde no tiene por qué dejar cinco respaldos idénticos.
  const ultimos = listar(carpeta);
  const ultimo = ultimos.length ? ultimos[ultimos.length - 1] : null;
  const viejo = !ultimo || (Date.now() - (ultimo.cuando || 0)) > cadaMs;
  if (viejo) correr();
  else log(`Respaldo: el último (${ultimo.archivo}) todavía vale`);

  const timer = setInterval(correr, cadaMs);
  // Que el timer no mantenga vivo el proceso él solo
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  respaldar, verificar, verificarEnHilo, rotar, listar, programar, dirDe, nombreDe,
  ES_RESPALDO, CONSERVAR, CADA_HORAS, RESERVA_MB,
};
