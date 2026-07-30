// Operaciones sobre cooperativas: alta, supervisor, rutas, suspensión.
//
// Viven acá y no adentro de quien las usa porque tienen DOS puertas: la
// consola (`empresa.js`) y el panel del creador (`creador.js`). Escritas dos
// veces se separarían con el tiempo, y son justamente las que no pueden —
// una validación que exista de un lado y del otro no es una validación.
//
// Ninguna función sabe de HTTP ni corta el proceso: devuelven
// `{ error: 'texto' }` o `{ ok: true, ... }` y quien llama decide si eso es
// un 400, una línea roja en la consola o un cartel en pantalla.

const { hashPassword, idLimpio } = require('./base');

// El mismo mínimo que exige el panel de Despacho al fijar una contraseña
const CLAVE_MINIMA = 6;

// ─── LECTURA ─────────────────────────────────────────────────

// Todas las cooperativas con su tamaño. Es la vista del nivel de arriba: el
// único lugar del sistema donde se ven varias empresas juntas.
function listar(db) {
  return db.prepare('SELECT * FROM companies ORDER BY createdAt').all().map(e => ({
    companyId: e.companyId,
    name: e.name,
    ruc: e.ruc,
    contacto: e.contacto,
    activa: !!e.activa,
    createdAt: e.createdAt,
    rutas: db.prepare('SELECT routeId, name FROM routes WHERE companyId = ? ORDER BY routeId')
      .all(e.companyId),
    vehiculos: db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE companyId = ?').get(e.companyId).c,
    personas: db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role <> 'dispatch'")
      .get(e.companyId).c,
    despacho: db.prepare("SELECT unitId, routeId, lastLogin FROM users WHERE companyId = ? AND role = 'dispatch' ORDER BY unitId")
      .all(e.companyId),
  }));
}

// ─── ALTA DE UNA COOPERATIVA ─────────────────────────────────
// Opcionalmente con su primera ruta y su cuenta supervisora, que es como
// conviene darla de alta: una empresa sin rutas no deja conectar a nadie, y
// una sin cuenta de despacho no se puede administrar.
function alta(db, datos = {}) {
  const companyId = idLimpio(datos.companyId);
  if (!companyId) {
    return { error: 'El código de la empresa solo admite letras, números, punto, guion y guion bajo (hasta 24)' };
  }
  const name = String(datos.name || '').trim().slice(0, 80);
  if (!name) return { error: 'Falta el nombre de la cooperativa' };
  if (db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(companyId)) {
    return { error: `Ya existe una empresa con el código ${companyId}` };
  }

  // La ruta y la cuenta se validan ANTES de escribir nada: media alta —la
  // empresa creada y el supervisor no— es peor que ninguna.
  let ruta = null;
  if (datos.ruta) {
    ruta = idLimpio(datos.ruta);
    if (!ruta) return { error: 'El código de la ruta tiene caracteres no permitidos' };
    // Los códigos de ruta son únicos en todo el servidor: si no, una consulta
    // por routeId no sabría de qué cooperativa está hablando.
    if (db.prepare('SELECT routeId FROM routes WHERE routeId = ?').get(ruta)) {
      return { error: `El código de ruta ${ruta} ya está tomado` };
    }
  }

  let usuario = null;
  if (datos.despacho) {
    usuario = idLimpio(datos.despacho);
    if (!usuario) return { error: 'El usuario de despacho tiene caracteres no permitidos' };
    if (!datos.clave || String(datos.clave).length < CLAVE_MINIMA) {
      return { error: `La cuenta de despacho necesita una clave de al menos ${CLAVE_MINIMA} caracteres` };
    }
    if (db.prepare('SELECT unitId FROM users WHERE unitId = ?').get(usuario)) {
      return { error: `El usuario ${usuario} ya está tomado` };
    }
  }

  const ahora = Date.now();
  db.transaction(() => {
    db.prepare('INSERT INTO companies (companyId, name, ruc, contacto, activa, createdAt) VALUES (?, ?, ?, ?, 1, ?)')
      .run(companyId, name,
        String(datos.ruc || '').trim().slice(0, 20) || null,
        String(datos.contacto || '').trim().slice(0, 80) || null,
        ahora);

    if (ruta) {
      db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ruta, String(datos.nombreRuta || ruta).trim().slice(0, 60), 2, 50, companyId, ahora);
    }

    if (usuario) {
      // Supervisor de la empresa: sin routeId, ve todas las rutas de SU
      // cooperativa (y solo las de ella).
      db.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
                  VALUES (?, ?, ?, 'dispatch', NULL, ?, ?, ?)`)
        .run(usuario, 'Despacho', 'Despacho', companyId, hashPassword(String(datos.clave)), ahora);
    }
  })();

  return { ok: true, companyId, name, ruta, usuario };
}

// ─── CUENTA SUPERVISORA ──────────────────────────────────────
// Crea la cuenta o le restablece la clave. Es la salida cuando una
// cooperativa pierde el acceso a su propio panel.
function supervisor(db, { companyId, usuario, clave } = {}) {
  const empresa = idLimpio(companyId);
  const unitId = idLimpio(usuario);
  if (!empresa || !unitId) return { error: 'Falta la empresa o el usuario' };
  if (!clave || String(clave).length < CLAVE_MINIMA) {
    return { error: `La clave necesita al menos ${CLAVE_MINIMA} caracteres` };
  }
  if (!db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(empresa)) {
    return { error: `No existe la empresa ${empresa}` };
  }

  const existente = db.prepare('SELECT unitId, companyId FROM users WHERE unitId = ?').get(unitId);
  if (existente && existente.companyId !== empresa) {
    // Mover una cuenta de una cooperativa a otra se parece demasiado a un
    // error de tipeo. Que se dé de baja y se cree de nuevo, a la vista.
    return { error: `El usuario ${unitId} ya existe y pertenece a ${existente.companyId}` };
  }

  const hash = hashPassword(String(clave));
  if (existente) {
    db.prepare("UPDATE users SET passHash = ?, role = 'dispatch', routeId = NULL WHERE unitId = ?")
      .run(hash, unitId);
    // Las sesiones abiertas con la clave vieja dejan de valer
    db.prepare('DELETE FROM sessions WHERE unitId = ?').run(unitId);
    return { ok: true, companyId: empresa, usuario: unitId, creado: false };
  }

  db.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
              VALUES (?, ?, ?, 'dispatch', NULL, ?, ?, ?)`)
    .run(unitId, 'Despacho', 'Despacho', empresa, hash, Date.now());
  return { ok: true, companyId: empresa, usuario: unitId, creado: true };
}

// ─── RUTA NUEVA EN UNA COOPERATIVA ───────────────────────────
function altaRuta(db, { companyId, routeId, name, targetGapMin, durationMin } = {}) {
  const empresa = idLimpio(companyId);
  const ruta = idLimpio(routeId);
  if (!empresa || !ruta) return { error: 'Falta la empresa o el código de la ruta' };
  if (!db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(empresa)) {
    return { error: `No existe la empresa ${empresa}` };
  }
  if (db.prepare('SELECT routeId FROM routes WHERE routeId = ?').get(ruta)) {
    return { error: `El código de ruta ${ruta} ya está tomado` };
  }
  const gap = Number(targetGapMin);
  const dur = Number(durationMin);
  db.prepare('INSERT INTO routes (routeId, name, targetGapMin, durationMin, companyId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ruta, String(name || ruta).trim().slice(0, 60),
      Number.isFinite(gap) && gap > 0 ? gap : 2,
      Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 50,
      empresa, Date.now());
  return { ok: true, companyId: empresa, routeId: ruta };
}

// ─── SUSPENDER O HABILITAR ───────────────────────────────────
function estado(db, { companyId, activa } = {}) {
  const empresa = idLimpio(companyId);
  if (!empresa) return { error: 'Falta el código de la empresa' };
  const e = db.prepare('SELECT * FROM companies WHERE companyId = ?').get(empresa);
  if (!e) return { error: `No existe la empresa ${empresa}` };

  db.prepare('UPDATE companies SET activa = ? WHERE companyId = ?').run(activa ? 1 : 0, empresa);

  // Suspender sin cortar las sesiones abiertas dejaría a la cooperativa
  // trabajando hasta que a cada uno se le venza el token: 30 días.
  let sesiones = 0;
  if (!activa) {
    sesiones = db.prepare(
      'DELETE FROM sessions WHERE unitId IN (SELECT unitId FROM users WHERE companyId = ?)'
    ).run(empresa).changes;
  }
  return { ok: true, companyId: empresa, name: e.name, activa: !!activa, sesiones };
}

module.exports = { listar, alta, supervisor, altaRuta, estado, CLAVE_MINIMA };
