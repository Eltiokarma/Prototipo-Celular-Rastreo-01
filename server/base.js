// Piezas compartidas entre el servidor y las herramientas de consola.
//
// Están acá y no en `index.js` por una razón práctica: requerir `index.js`
// levanta el servidor. Una herramienta que lo importara para reutilizar una
// función abriría un puerto sin querer, y en producción eso es un segundo
// proceso peleando por el mismo archivo de base.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Abre la base con red de seguridad: si la ruta configurada no sirve
// (volumen sin montar, permisos), cae a una ruta local y, en última
// instancia, a memoria — el sistema sigue en pie aunque sin persistir.
//
// `silencioso` es para las herramientas de consola: ahí la memoria NO es un
// destino aceptable (escribirían en una base que se evapora), así que se
// devuelve null y el que llama decide.
function openDatabase(Database, { silencioso = false, sinMemoria = false } = {}) {
  const candidates = [];
  if (process.env.DB_FILE) candidates.push(process.env.DB_FILE);
  candidates.push(path.join(__dirname, 'r14.db'));
  if (!sinMemoria) candidates.push(':memory:');

  for (const file of candidates) {
    try {
      if (file !== ':memory:') {
        // Solo se crea el directorio si falta: con el volumen ya montado
        // no hace falta tocar nada.
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
      const database = new Database(file);
      // WAL es más rápido, pero algunos volúmenes montados no lo soportan:
      // si falla, se sigue con el journal por defecto en vez de morir.
      try {
        database.pragma('journal_mode = WAL');
      } catch {
        if (!silencioso) console.warn('WAL no disponible en este disco — journal por defecto');
      }
      if (!silencioso) {
        if (file === ':memory:') {
          console.warn('⚠ Base en MEMORIA: los datos se pierden al reiniciar.');
        } else {
          console.log('Base de datos:', file);
        }
      }
      return database;
    } catch (e) {
      console.error(`No se pudo abrir la base en ${file}: ${e.message}`);
    }
  }
  return null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

// Los identificadores (empresa, unidad, vehículo, ruta, usuario) terminan
// pintados dentro del HTML de los pines del mapa y en nombres de archivo de
// los informes, así que se limitan a un juego de caracteres seguro. Los
// NOMBRES y alias no tienen esta restricción: van por React, que los escapa.
const ID_VALIDO = /^[A-Za-z0-9._-]{1,24}$/;

function idLimpio(v) {
  const s = String(v || '').trim();
  return ID_VALIDO.test(s) ? s : null;
}

module.exports = { openDatabase, hashPassword, verifyPassword, idLimpio, ID_VALIDO };
