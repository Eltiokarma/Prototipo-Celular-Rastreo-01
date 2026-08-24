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
// El listado NO trae los logos, y es a propósito: son hasta 200 kB cada uno, y
// una lista que crece con la cantidad de cooperativas es justo lo que no
// aguanta cuando esto escale. Trae con qué DIBUJAR el escudo —iniciales,
// color y si tiene logo o no— y el logo se pide por cooperativa, solo cuando
// se abre la suya.
function listar(db) {
  const marca = require('./marca');
  return db.prepare('SELECT * FROM companies ORDER BY createdAt').all().map(e => ({
    companyId: e.companyId,
    name: e.name,
    tieneLogo: !!e.logo,
    iniciales: marca.iniciales(e.name),
    color: marca.colorDe(e.companyId),
    ruc: e.ruc,
    contacto: e.contacto,
    activa: !!e.activa,
    createdAt: e.createdAt,
    rutas: db.prepare('SELECT routeId, name FROM routes WHERE companyId = ? ORDER BY routeId')
      .all(e.companyId),
    vehiculos: db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE companyId = ?').get(e.companyId).c,
    // `personas` es la gente que va arriba de las combis. Las cuentas de
    // Despacho y las de gerencia se cuentan aparte: son otra cosa, y sumarlas
    // acá hacía que "34 personas" no coincidiera con nadie.
    personas: db.prepare("SELECT COUNT(*) AS c FROM users WHERE companyId = ? AND role NOT IN ('dispatch', 'manager')")
      .get(e.companyId).c,
    despacho: db.prepare("SELECT unitId, routeId, lastLogin FROM users WHERE companyId = ? AND role = 'dispatch' ORDER BY unitId")
      .all(e.companyId),
    gerencia: db.prepare("SELECT unitId, routeId, lastLogin FROM users WHERE companyId = ? AND role = 'manager' ORDER BY unitId")
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

// ─── CUENTA DE GERENCIA ──────────────────────────────────────
// El gerente MIRA: métricas, tendencias, cumplimiento y descarga de
// informes. No administra nada y no entra al tiempo real.
//
// La crea el nivel de arriba y no Despacho, por la misma razón por la que
// nadie se audita a sí mismo: buena parte de lo que el gerente mira es qué
// tan bien se está corriendo la ruta, o sea el trabajo de Despacho.
//
// `routeId` opcional: con ruta, el gerente ve solo esa; sin ruta, ve toda la
// cooperativa. Es el mismo borde que ya usa Despacho.
function gerente(db, { companyId, usuario, clave, routeId } = {}) {
  const empresa = idLimpio(companyId);
  const unitId = idLimpio(usuario);
  if (!empresa || !unitId) return { error: 'Falta la empresa o el usuario' };
  if (!clave || String(clave).length < CLAVE_MINIMA) {
    return { error: `La clave necesita al menos ${CLAVE_MINIMA} caracteres` };
  }
  if (!db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(empresa)) {
    return { error: `No existe la empresa ${empresa}` };
  }

  // El alcance por ruta tiene que ser una ruta DE ESA cooperativa: si no,
  // sería una forma de que un gerente terminara mirando la de al lado.
  let alcance = null;
  if (routeId) {
    alcance = idLimpio(routeId);
    if (!alcance) return { error: 'El código de la ruta no es válido' };
    const r = db.prepare('SELECT routeId FROM routes WHERE routeId = ? AND companyId = ?')
      .get(alcance, empresa);
    if (!r) return { error: `La ruta ${alcance} no es de ${empresa}` };
  }

  const existente = db.prepare('SELECT unitId, companyId, role FROM users WHERE unitId = ?').get(unitId);
  if (existente && existente.companyId !== empresa) {
    return { error: `El usuario ${unitId} ya existe y pertenece a ${existente.companyId}` };
  }
  // Convertir un chofer en gerente le dejaría el vehículo y los turnos
  // colgando de una cuenta que ya no va a ruta. Que se dé de baja primero.
  if (existente && existente.role !== 'manager') {
    return { error: `El usuario ${unitId} ya existe con rol ${existente.role}. Dalo de baja antes.` };
  }

  const hash = hashPassword(String(clave));
  if (existente) {
    db.prepare("UPDATE users SET passHash = ?, role = 'manager', routeId = ? WHERE unitId = ?")
      .run(hash, alcance, unitId);
    db.prepare('DELETE FROM sessions WHERE unitId = ?').run(unitId);
    return { ok: true, companyId: empresa, usuario: unitId, routeId: alcance, creado: false };
  }

  db.prepare(`INSERT INTO users (unitId, driverName, name, role, routeId, companyId, passHash, createdAt)
              VALUES (?, ?, ?, 'manager', ?, ?, ?, ?)`)
    .run(unitId, 'Gerencia', 'Gerencia', alcance, empresa, hash, Date.now());
  return { ok: true, companyId: empresa, usuario: unitId, routeId: alcance, creado: true };
}

// ─── RUTA NUEVA EN UNA COOPERATIVA ───────────────────────────
function altaRuta(db, { companyId, routeId, name, targetGapMin, durationMin } = {}) {
  const empresa = idLimpio(companyId);
  if (!empresa) return { error: 'Falta la empresa' };
  // Se distingue "no lo pusiste" de "lo pusiste mal": antes las dos daban
  // "falta el código", y quien escribía un código con un espacio o un
  // acento se quedaba mirando un mensaje que no tenía nada que ver.
  const ruta = idLimpio(routeId);
  if (!ruta) {
    return {
      error: routeId
        ? 'El código de la ruta solo admite letras, números, punto, guion y guion bajo (hasta 24)'
        : 'Falta el código de la ruta (ej. R-15)',
    };
  }
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

// ─── CORREGIR LOS DATOS ──────────────────────────────────────
// Nombre, RUC y contacto se corrigen; el CÓDIGO (companyId) no se toca:
// cuelga de él todo lo demás —usuarios, rutas, sesiones, auditoría— y
// renombrarlo sería mover la cooperativa entera de lugar.
function editar(db, { companyId, name, ruc, contacto } = {}) {
  const empresa = idLimpio(companyId);
  if (!empresa) return { error: 'Falta el código de la empresa' };
  if (!db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(empresa)) {
    return { error: `No existe la empresa ${empresa}` };
  }
  const nombre = String(name || '').trim().slice(0, 80);
  if (!nombre) return { error: 'El nombre de la cooperativa es obligatorio' };
  const rucLimpio = String(ruc || '').trim().slice(0, 20) || null;
  const contactoLimpio = String(contacto || '').trim().slice(0, 80) || null;
  db.prepare('UPDATE companies SET name = ?, ruc = ?, contacto = ? WHERE companyId = ?')
    .run(nombre, rucLimpio, contactoLimpio, empresa);
  return { ok: true, companyId: empresa, name: nombre, ruc: rucLimpio, contacto: contactoLimpio };
}

// El nombre de una ruta también se corrige (el código no, por lo mismo).
// Es lo que se lee en los selectores y en el mapa del chofer: un error de
// tipeo ahí queda a la vista de todos los días.
function editarRuta(db, { companyId, routeId, name } = {}) {
  const empresa = idLimpio(companyId);
  const ruta = idLimpio(routeId);
  if (!empresa || !ruta) return { error: 'Falta la empresa o la ruta' };
  if (!db.prepare('SELECT routeId FROM routes WHERE routeId = ? AND companyId = ?').get(ruta, empresa)) {
    return { error: `La ruta ${ruta} no es de la empresa ${empresa}` };
  }
  const nombre = String(name || '').trim().slice(0, 60);
  if (!nombre) return { error: 'El nombre de la ruta no puede quedar vacío' };
  db.prepare('UPDATE routes SET name = ? WHERE routeId = ?').run(nombre, ruta);
  return { ok: true, companyId: empresa, routeId: ruta, name: nombre };
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

// ─── VARIANTES DEL RECORRIDO ─────────────────────────────────
// Crear y borrar variantes es cartografía: decidir que esta ruta puede
// manejarse de dos maneras. Por eso vive en el nivel de arriba y no en el
// panel de Despacho, que solo ELIGE entre las que existen.

function variantes(db, routeId) {
  return db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM route_points p WHERE p.variantId = v.variantId) AS puntos
    FROM route_variants v WHERE v.routeId = ? ORDER BY v.variantId
  `).all(routeId).map(v => ({ ...v, activa: !!v.activa }));
}

// Una fecha opcional que llega del formulario. Se acepta vacío (sin
// vigencia), un timestamp o un 'YYYY-MM-DD'.
function fechaOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, ts: null };
  if (typeof valor === 'number' && Number.isFinite(valor)) return { ok: true, ts: valor };
  const t = Date.parse(String(valor));
  if (Number.isNaN(t)) return { ok: false };
  return { ok: true, ts: t };
}

// Los días de la semana opcionales ("los domingos"): llegan como array
// [0, 6] o como "0,6" — 0 es domingo, la misma convención que Date.getDay().
// Se guardan "0,6" o null. La forma la valida ACÁ y no cada puerta.
function diasOpcionales(valor) {
  if (valor === undefined || valor === null || valor === '' ||
      (Array.isArray(valor) && valor.length === 0)) return { ok: true, dias: null };
  const nums = (Array.isArray(valor) ? valor : String(valor).split(',')).map(Number);
  if (!nums.length || nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return { ok: false };
  return { ok: true, dias: [...new Set(nums)].sort().join(',') };
}

function altaVariante(db, { routeId, name, desde, hasta, dias, copiarDe } = {}) {
  const ruta = idLimpio(routeId);
  if (!ruta) return { error: 'Falta la ruta' };
  if (!db.prepare('SELECT routeId FROM routes WHERE routeId = ?').get(ruta)) {
    return { error: `No existe la ruta ${ruta}` };
  }
  const nombre = String(name || '').trim().slice(0, 60);
  if (!nombre) return { error: 'La variante necesita un nombre (para qué es: "Obra Circunvalación")' };

  const d = fechaOpcional(desde), h = fechaOpcional(hasta);
  if (!d.ok || !h.ok) return { error: 'Las fechas de vigencia no se entienden' };
  if (d.ts && h.ts && h.ts <= d.ts) return { error: 'La vigencia termina antes de empezar' };
  const ds = diasOpcionales(dias);
  if (!ds.ok) return { error: 'Los días de vigencia no se entienden (0 a 6, 0 es domingo)' };

  // Copiar de otra es lo normal: un desvío suele ser el recorrido de siempre
  // con dos cuadras distintas, no un trazado nuevo desde cero.
  let origen = null;
  if (copiarDe !== undefined && copiarDe !== null && copiarDe !== '') {
    origen = db.prepare('SELECT * FROM route_variants WHERE variantId = ? AND routeId = ?')
      .get(Number(copiarDe), ruta);
    if (!origen) return { error: 'La variante que se quiere copiar no es de esta ruta' };
  }

  let variantId;
  db.transaction(() => {
    variantId = db.prepare(
      'INSERT INTO route_variants (routeId, name, activa, desde, hasta, dias, createdAt) VALUES (?, ?, 0, ?, ?, ?, ?)'
    ).run(ruta, nombre, d.ts, h.ts, ds.dias, Date.now()).lastInsertRowid;

    if (origen) {
      db.prepare(`
        INSERT INTO route_points (variantId, leg, seq, lat, lng)
        SELECT ?, leg, seq, lat, lng FROM route_points WHERE variantId = ?
      `).run(variantId, origen.variantId);
    }
  })();

  return {
    ok: true, routeId: ruta, variantId, name: nombre,
    desde: d.ts, hasta: h.ts, dias: ds.dias, copiadaDe: origen ? origen.name : null,
  };
}

function editarVariante(db, { variantId, name, desde, hasta, dias } = {}) {
  const v = db.prepare('SELECT * FROM route_variants WHERE variantId = ?').get(Number(variantId));
  if (!v) return { error: 'Esa variante no existe' };
  const nombre = String(name || '').trim().slice(0, 60) || v.name;
  const d = fechaOpcional(desde), h = fechaOpcional(hasta);
  if (!d.ok || !h.ok) return { error: 'Las fechas de vigencia no se entienden' };
  if (d.ts && h.ts && h.ts <= d.ts) return { error: 'La vigencia termina antes de empezar' };
  const ds = diasOpcionales(dias);
  if (!ds.ok) return { error: 'Los días de vigencia no se entienden (0 a 6, 0 es domingo)' };
  db.prepare('UPDATE route_variants SET name = ?, desde = ?, hasta = ?, dias = ? WHERE variantId = ?')
    .run(nombre, d.ts, h.ts, ds.dias, v.variantId);
  return { ok: true, routeId: v.routeId, variantId: v.variantId, name: nombre,
           desde: d.ts, hasta: h.ts, dias: ds.dias };
}

function bajaVariante(db, { variantId } = {}) {
  const v = db.prepare('SELECT * FROM route_variants WHERE variantId = ?').get(Number(variantId));
  if (!v) return { error: 'Esa variante no existe' };
  // Dos negativas, y las dos son para no dejar una ruta sin con qué medir:
  // borrar la que está midiendo, o borrar la última que queda.
  if (v.activa) {
    return { error: 'Esa es la variante con la que se está midiendo. Activá otra y después borrala.' };
  }
  // En la práctica no se llega acá: la única variante de una ruta siempre
  // está activa, así que la corta el chequeo de arriba. Queda igual como red
  // por si alguna vez se rompe esa invariante — una ruta sin variantes no
  // mediría nada y se vería como un recorrido que desapareció solo.
  const cuantas = db.prepare('SELECT COUNT(*) AS c FROM route_variants WHERE routeId = ?').get(v.routeId).c;
  if (cuantas <= 1) return { error: 'Es la única variante de la ruta: no se puede borrar' };

  db.transaction(() => {
    db.prepare('DELETE FROM route_points WHERE variantId = ?').run(v.variantId);
    db.prepare('DELETE FROM route_variants WHERE variantId = ?').run(v.variantId);
    // Las vueltas que se midieron con ella quedan, pero apuntando a una
    // variante que ya no está. Se las marca como "sin variante" para que no
    // ensucien el promedio de ninguna otra.
    db.prepare('UPDATE laps SET variantId = NULL WHERE variantId = ?').run(v.variantId);
  })();
  return { ok: true, routeId: v.routeId, name: v.name };
}

// ─── AVISOS A UNA COOPERATIVA ────────────────────────────────
// El nivel de arriba le deja un mensaje a la cooperativa —una deuda, un
// mantenimiento programado— y aparece como banner en su panel de Despacho
// hasta que alguien lo marque como visto. No toca el chat de las rutas: la
// relación es con la cooperativa, no con sus choferes, y escribirle a las
// unidades por encima de su propio Despacho quemaría el canal.

const AVISO_MAX = 500;
const AVISOS_VISTOS_DIAS = 365;   // los vistos se guardan un año, como el resto de lo administrativo

function aviso(db, { companyId, routeId, texto } = {}) {
  const empresa = idLimpio(companyId);
  if (!empresa || !db.prepare('SELECT companyId FROM companies WHERE companyId = ?').get(empresa)) {
    return { error: `No existe la empresa ${companyId || ''}` };
  }
  const cuerpo = String(texto || '').trim().slice(0, AVISO_MAX);
  if (!cuerpo) return { error: 'El aviso está vacío' };
  let ruta = null;
  if (routeId) {
    ruta = String(routeId).trim();
    // La ruta tiene que ser de ESA empresa: un aviso colgado de una ruta
    // ajena aparecería en el panel de otra cooperativa.
    if (!db.prepare('SELECT routeId FROM routes WHERE routeId = ? AND companyId = ?').get(ruta, empresa)) {
      return { error: `La ruta ${ruta} no es de ${empresa}` };
    }
  }
  const r = db.prepare(`INSERT INTO notices (companyId, routeId, texto, creadoEn)
                        VALUES (?, ?, ?, ?)`).run(empresa, ruta, cuerpo, Date.now());
  // Los vistos viejos se van solos; los pendientes NO caducan — un aviso sin
  // ver es exactamente lo que no puede desaparecer callado.
  db.prepare('DELETE FROM notices WHERE vistoEn IS NOT NULL AND vistoEn < ?')
    .run(Date.now() - AVISOS_VISTOS_DIAS * 86400_000);
  return { ok: true, id: r.lastInsertRowid, companyId: empresa, routeId: ruta, texto: cuerpo };
}

// Lo que el nivel de arriba ve de sus propios avisos: si los vieron y quién.
function avisos(db, companyId) {
  const empresa = idLimpio(companyId);
  if (!empresa) return [];
  return db.prepare(`SELECT id, routeId, texto, creadoEn, vistoEn, vistoPor
                     FROM notices WHERE companyId = ? ORDER BY id DESC LIMIT 20`).all(empresa);
}

module.exports = {
  listar, alta, supervisor, gerente, altaRuta, estado, editar, editarRuta,
  variantes, altaVariante, editarVariante, bajaVariante,
  aviso, avisos, AVISO_MAX,
  CLAVE_MINIMA,
};
