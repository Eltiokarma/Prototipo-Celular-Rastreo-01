// Panel del creador — el nivel que está por encima de todas las cooperativas.
//
// ═══ POR QUÉ ESTE ARCHIVO ESTÁ SEPARADO ═══
// Quien entra acá puede crear una cooperativa, y quien puede crear una
// cooperativa puede crearse un supervisor adentro de ella y mirar lo que
// quiera. Es el poder más grande del sistema. Toda su superficie —cómo se
// entra, qué se puede hacer— tiene que poder leerse de una sentada, sin
// buscarla entre dos mil líneas de otra cosa.
//
// ═══ LAS CUATRO BARRERAS ═══
// La consigna era que este nivel no fuera "un rol más del mismo login".
// No lo es, y no por una sino por cuatro razones que se suman:
//
//   1. APAGADO POR DEFECTO. Sin CREATOR_PASSWORD en el entorno, estas rutas
//      NO EXISTEN — no responden 401 ni 403: no están registradas, y el
//      servidor contesta 404 como con cualquier URL inventada. No se puede
//      atacar lo que no está.
//   2. CREDENCIAL APARTE. No es un usuario de la tabla `users`. No hay forma
//      de llegar acá desde una cuenta de Despacho, ni siquiera comprometida,
//      porque no hay ninguna fila de la base que dé este acceso.
//   3. RUTA NO ADIVINABLE. CREATOR_PATH mueve el panel a donde uno quiera.
//      No es seguridad por sí sola —por eso hay clave— pero saca al panel
//      de cualquier barrido automático de URLs conocidas.
//   4. SEGUNDO FACTOR OPCIONAL. Con CREATOR_TOTP_SECRET hace falta además el
//      código de 6 dígitos del celular. Sin librerías: TOTP es un HMAC.
//
// Y encima: las sesiones viven SOLO EN MEMORIA y duran 2 horas. Reiniciar el
// servidor cierra todas. Un token de acá no sirve en /admin y uno de Despacho
// no sirve acá — son dos mundos que no se tocan.
//
// ═══ LO QUE ESTO NO ES ═══
// No reemplaza a `empresa.js`. La consola sigue siendo el piso: es la salida
// cuando el panel no se puede abrir. El panel es comodidad.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const coop = require('./cooperativas');
const marca = require('./marca');
const respaldo = require('./respaldo');

// La clave del creador abre todas las cooperativas del servidor. El mínimo
// de 6 que rige para Despacho acá sería una broma.
const CLAVE_MINIMA_CREADOR = 12;

const SESION_MS = 2 * 60 * 60 * 1000;   // 2 horas, sin renovación automática
const SESIONES_MAX = 5;                  // más que eso es una sesión olvidada

// Fuerza bruta: mucho más duro que el login normal. Acá no hay usuarios que
// puedan quedar afuera por error — somos nosotros y nadie más.
const INTENTOS_MAX = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
// Retardo fijo en CADA intento, acierte o falle. Hace inviable adivinar en
// línea y de paso aplana el tiempo de respuesta, que si no cuenta cosas.
const RETARDO_MS = 500;

// ─── SEGUNDO FACTOR (TOTP) ───────────────────────────────────
// RFC 6238 en veinte líneas. Se implementa acá en vez de sumar una
// dependencia: el código es corto, no cambia nunca, y una librería más en el
// camino de la puerta principal es superficie de ataque que no hace falta.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32aBytes(texto) {
  const limpio = String(texto).toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!limpio) return null;
  let bits = 0, acumulado = 0;
  const bytes = [];
  for (const c of limpio) {
    acumulado = (acumulado << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((acumulado >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return bytes.length ? Buffer.from(bytes) : null;
}

function codigoTotp(clave, paso) {
  const contador = Buffer.alloc(8);
  contador.writeUInt32BE(Math.floor(paso / 2 ** 32), 0);
  contador.writeUInt32BE(paso >>> 0, 4);
  const h = crypto.createHmac('sha1', clave).update(contador).digest();
  const off = h[h.length - 1] & 0x0f;
  const num = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(num % 1_000_000).padStart(6, '0');
}

// Se aceptan el paso actual y el anterior: el reloj del celular casi nunca
// coincide al segundo con el del servidor, y rechazar por 3 segundos de
// diferencia lo vuelve inusable.
function totpValido(clave, codigo) {
  const limpio = String(codigo || '').replace(/\D/g, '');
  if (limpio.length !== 6) return false;
  const paso = Math.floor(Date.now() / 30_000);
  let vale = false;
  for (const p of [paso, paso - 1]) {
    // Sin cortar el bucle al primer acierto: comparar siempre la misma
    // cantidad de veces no le dice al de afuera cuál de los dos pasos entró.
    if (igualesEnTiempoConstante(codigoTotp(clave, p), limpio)) vale = true;
  }
  return vale;
}

function igualesEnTiempoConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── MONTAJE ─────────────────────────────────────────────────
// Devuelve la ruta base si quedó montado, o null si está apagado.
//
// deps: { db, audit, origenDe, dbFile, estadoVivo }
function montarPanelDelCreador(app, deps) {
  const clave = process.env.CREATOR_PASSWORD || '';
  if (!clave) return null;   // apagado: las rutas ni se registran

  if (clave.length < CLAVE_MINIMA_CREADOR) {
    console.error('──────────────────────────────────────────────────────────');
    console.error(`CREATOR_PASSWORD tiene menos de ${CLAVE_MINIMA_CREADOR} caracteres.`);
    console.error('Esta clave abre TODAS las cooperativas del servidor, así que');
    console.error('el panel del creador queda APAGADO hasta que sea más larga.');
    console.error('El resto del sistema funciona normalmente.');
    console.error('──────────────────────────────────────────────────────────');
    return null;
  }

  const BASE = normalizarRuta(process.env.CREATOR_PATH) || '/creador';

  let totpClave = null;
  if (process.env.CREATOR_TOTP_SECRET) {
    totpClave = base32aBytes(process.env.CREATOR_TOTP_SECRET);
    if (!totpClave) {
      console.error('CREATOR_TOTP_SECRET no es base32 válido — el panel del creador queda APAGADO ' +
        'en vez de arrancar sin el segundo factor que se pidió.');
      return null;
    }
  }

  const { db, audit, origenDe, dbFile, routeOf, guardarRecorrido, puntosDeVariante, varianteActiva } = deps;
  const arrancadoEn = Date.now();

  // Sesiones EN MEMORIA a propósito: un reinicio las cierra todas, y no queda
  // ningún rastro en la base que sirva para entrar.
  const sesiones = new Map();          // token → { expira, ip, desde }
  const intentos = new Map();          // ip → { n, hasta }

  const anotar = (accion, sobre, detalle, companyId) =>
    audit('CREADOR', accion, sobre || null, detalle || null, null, companyId || null);

  function ipBloqueada(ip) {
    const e = intentos.get(ip);
    return !!(e && e.hasta > Date.now());
  }

  function anotarFallo(ip) {
    const e = intentos.get(ip) || { n: 0, hasta: 0 };
    e.n++;
    if (e.n >= INTENTOS_MAX) {
      e.hasta = Date.now() + BLOQUEO_MS;
      e.n = 0;
      console.warn(`Panel del creador: ${INTENTOS_MAX} intentos fallidos desde ${ip} — bloqueado ${BLOQUEO_MS / 60000} min`);
      anotar('creador_bloqueo', null, `origen ${ip}`);
    }
    intentos.set(ip, e);
  }

  function limpiarSesiones() {
    const ahora = Date.now();
    for (const [t, s] of sesiones) if (s.expira <= ahora) sesiones.delete(t);
  }

  const esperar = () => new Promise(r => setTimeout(r, RETARDO_MS));

  // ─── PUERTA ────────────────────────────────────────────────
  app.post(BASE + '/login', async (req, res) => {
    const ip = origenDe(req);
    if (ipBloqueada(ip)) {
      return res.status(429).json({ error: 'Demasiados intentos. Esperá 15 minutos.' });
    }
    // El retardo va ANTES de mirar nada: así el tiempo de respuesta es el
    // mismo para una clave corta, una larga y una correcta.
    await esperar();

    const enviada = String(req.body?.password || '');
    const claveOk = igualesEnTiempoConstante(clave, enviada);
    const segundoOk = !totpClave || totpValido(totpClave, req.body?.codigo);

    if (!claveOk || !segundoOk) {
      anotarFallo(ip);
      // El mensaje NO distingue entre clave mala y código malo: decirlo
      // confirmaría media credencial.
      return res.status(401).json({ error: 'No coincide' });
    }

    intentos.delete(ip);
    limpiarSesiones();
    // Una sesión olvidada en otra máquina es una puerta abierta. Si se
    // acumulan, se cierra la más vieja.
    while (sesiones.size >= SESIONES_MAX) {
      const masVieja = [...sesiones.entries()].sort((a, b) => a[1].desde - b[1].desde)[0];
      sesiones.delete(masVieja[0]);
    }

    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, { expira: Date.now() + SESION_MS, ip, desde: Date.now() });
    anotar('creador_login', null, `origen ${ip}`);
    console.log(`Panel del creador: sesión abierta desde ${ip}`);
    res.json({ token, expiraEn: SESION_MS, segundoFactor: !!totpClave });
  });

  function requireCreador(req, res, next) {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const s = token ? sesiones.get(token) : null;
    // Ojo: este Map es SOLO de sesiones del creador. Un token de Despacho,
    // por válido que sea allá, acá no está — y al revés. No hay un lugar
    // donde los dos niveles compartan credenciales.
    if (!s || s.expira <= Date.now()) {
      if (s) sesiones.delete(token);
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
    req.creadorIp = s.ip;
    next();
  }

  app.post(BASE + '/salir', requireCreador, (req, res) => {
    const token = String(req.headers.authorization || '').slice(7);
    sesiones.delete(token);
    res.json({ ok: true });
  });

  // ─── COOPERATIVAS ──────────────────────────────────────────
  app.get(BASE + '/empresas', requireCreador, (req, res) => {
    res.json({ empresas: coop.listar(db) });
  });

  app.post(BASE + '/empresas', requireCreador, (req, res) => {
    const r = coop.alta(db, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    anotar('alta_empresa', r.companyId,
      `${r.name}${r.ruta ? ` · ruta ${r.ruta}` : ' · sin rutas'}${r.usuario ? ` · despacho ${r.usuario}` : ''}`,
      r.companyId);
    console.log(`Empresa creada desde el panel del creador: ${r.companyId}`);
    res.json(r);
  });

  // ─── LA MARCA DE UNA COOPERATIVA ───────────────────────────
  //
  // Acá arriba se configura, en Despacho se corrige. El caso normal es que la
  // cooperativa reciba el sistema YA con su logo puesto: pedirle a un
  // despachador que lo suba el primer día es pedirle que se ocupe de algo que
  // nosotros podemos dejar hecho.
  //
  // El logo va por su propio endpoint y no en el listado: son hasta 200 kB
  // cada uno, y una lista que crece con la cantidad de cooperativas no
  // aguanta el día que haya veinte.
  app.get(BASE + '/empresas/:companyId/marca', requireCreador, (req, res) => {
    const e = db.prepare('SELECT companyId, name, logo FROM companies WHERE companyId = ?')
      .get(String(req.params.companyId));
    if (!e) return res.status(404).json({ error: 'Esa cooperativa no existe' });
    res.json({ marca: marca.marcaDe(e) });
  });

  app.put(BASE + '/empresas/:companyId/logo', requireCreador, (req, res) => {
    const companyId = String(req.params.companyId);
    const e = db.prepare('SELECT companyId, name FROM companies WHERE companyId = ?').get(companyId);
    if (!e) return res.status(404).json({ error: 'Esa cooperativa no existe' });

    const crudo = req.body?.logo;
    if (crudo === null || crudo === '') {
      db.prepare('UPDATE companies SET logo = NULL WHERE companyId = ?').run(companyId);
      anotar('logo_quitado', companyId, e.name, companyId);
      return res.json({ ok: true, logo: null });
    }
    const logo = marca.logoValido(crudo);
    if (!logo) return res.status(400).json({ error: marca.motivoRechazo(crudo) });
    db.prepare('UPDATE companies SET logo = ? WHERE companyId = ?').run(logo, companyId);
    anotar('logo_cambiado', companyId, e.name, companyId);
    res.json({ ok: true, logo });
  });

  // Corregir nombre, RUC y contacto. El código no se toca: cuelga de él
  // todo lo demás. Queda anotado con la empresa, como todo lo que el
  // creador le hace a una cooperativa.
  app.put(BASE + '/empresas/:companyId/datos', requireCreador, (req, res) => {
    const r = coop.editar(db, { ...req.body, companyId: req.params.companyId });
    if (r.error) return res.status(/No existe/.test(r.error) ? 404 : 400).json({ error: r.error });
    anotar('editar_empresa', r.companyId, r.name, r.companyId);
    res.json(r);
  });

  app.post(BASE + '/empresas/:companyId/estado', requireCreador, (req, res) => {
    const r = coop.estado(db, { companyId: req.params.companyId, activa: !!req.body?.activa });
    if (r.error) return res.status(400).json({ error: r.error });
    anotar(r.activa ? 'empresa_activada' : 'empresa_suspendida', r.companyId,
      r.activa ? null : `${r.sesiones} sesión(es) cerrada(s)`, r.companyId);
    res.json(r);
  });

  app.post(BASE + '/empresas/:companyId/despacho', requireCreador, (req, res) => {
    const r = coop.supervisor(db, {
      companyId: req.params.companyId,
      usuario: req.body?.usuario,
      clave: req.body?.clave,
    });
    if (r.error) return res.status(400).json({ error: r.error });
    // Queda registrado CON la empresa: así la cooperativa ve en su propia
    // pestaña de actividad que alguien de arriba le tocó una cuenta. El
    // nivel de arriba puede todo, pero no a escondidas.
    anotar(r.creado ? 'alta_supervisor' : 'reset_supervisor', r.usuario, `empresa ${r.companyId}`, r.companyId);
    res.json(r);
  });

  // Las cuentas de gerencia se dan de alta acá y no en el panel de Despacho:
  // el gerente mira, entre otras cosas, cómo se está corriendo la ruta, y eso
  // es el trabajo de Despacho. Nadie se elige a su propio auditor.
  app.post(BASE + '/empresas/:companyId/gerencia', requireCreador, (req, res) => {
    const r = coop.gerente(db, {
      companyId: req.params.companyId,
      usuario: req.body?.usuario,
      clave: req.body?.clave,
      routeId: req.body?.routeId,
    });
    if (r.error) return res.status(400).json({ error: r.error });
    anotar(r.creado ? 'alta_gerente' : 'reset_gerente', r.usuario,
      r.routeId ? `empresa ${r.companyId} · ruta ${r.routeId}` : `empresa ${r.companyId} · toda la cooperativa`,
      r.companyId);
    res.json(r);
  });

  app.post(BASE + '/empresas/:companyId/rutas', requireCreador, (req, res) => {
    const r = coop.altaRuta(db, { ...req.body, companyId: req.params.companyId });
    if (r.error) return res.status(400).json({ error: r.error });
    anotar('alta_ruta', r.routeId, `empresa ${r.companyId}`, r.companyId);
    res.json(r);
  });

  // Renombrar una ruta (el código no: por lo mismo que el de la empresa).
  app.put(BASE + '/empresas/:companyId/rutas/:routeId', requireCreador, (req, res) => {
    const r = coop.editarRuta(db, {
      companyId: req.params.companyId, routeId: req.params.routeId, name: req.body?.name,
    });
    if (r.error) return res.status(/no es de/.test(r.error) ? 404 : 400).json({ error: r.error });
    anotar('editar_ruta', r.routeId, r.name, r.companyId);
    res.json(r);
  });

  // ─── VARIANTES DEL RECORRIDO ───────────────────────────────
  // Decidir que una ruta puede manejarse de dos maneras es cartografía, no
  // operación del día: por eso se crean acá y no en el panel de Despacho.
  // Despacho ELIGE entre las que existan, y las dibuja con su trazador.

  // La ruta tiene que ser de la empresa de la URL: sin este chequeo, un
  // identificador de ruta ajeno colgado de la empresa correcta pasaría.
  function rutaDe(companyId, routeId) {
    return db.prepare('SELECT * FROM routes WHERE routeId = ? AND companyId = ?')
      .get(String(routeId), String(companyId)) || null;
  }

  app.get(BASE + '/empresas/:companyId/rutas/:routeId/variantes', requireCreador, (req, res) => {
    const ruta = rutaDe(req.params.companyId, req.params.routeId);
    if (!ruta) return res.status(404).json({ error: 'Esa ruta no existe' });
    // Toda ruta tiene al menos su variante base: se crea acá si falta, para
    // que una ruta recién dada de alta ya tenga sobre qué dibujar.
    varianteActiva(ruta.routeId);
    res.json({ routeId: ruta.routeId, variantes: coop.variantes(db, ruta.routeId) });
  });

  app.post(BASE + '/empresas/:companyId/rutas/:routeId/variantes', requireCreador, (req, res) => {
    const ruta = rutaDe(req.params.companyId, req.params.routeId);
    if (!ruta) return res.status(404).json({ error: 'Esa ruta no existe' });
    const r = coop.altaVariante(db, { ...req.body, routeId: ruta.routeId });
    if (r.error) return res.status(400).json({ error: r.error });
    anotar('alta_variante', ruta.routeId,
      `${r.name}${r.copiadaDe ? ` (copiada de ${r.copiadaDe})` : ''}`, ruta.companyId);
    res.json(r);
  });

  app.post(BASE + '/variantes/:variantId', requireCreador, (req, res) => {
    const r = coop.editarVariante(db, { ...req.body, variantId: req.params.variantId });
    if (r.error) return res.status(400).json({ error: r.error });
    const ruta = routeOf(r.routeId);
    if (!ruta) return res.status(404).json({ error: 'Esa ruta no existe' });
    // El nombre de la variante viaja en el mensaje de geometría, así que si
    // se renombró la que está midiendo hay que rearmar la caché.
    if (deps.recargarGeometria) deps.recargarGeometria(r.routeId);
    anotar('editar_variante', r.routeId, r.name, ruta.companyId);
    res.json(r);
  });

  app.delete(BASE + '/variantes/:variantId', requireCreador, (req, res) => {
    const r = coop.bajaVariante(db, { variantId: req.params.variantId });
    if (r.error) return res.status(400).json({ error: r.error });
    const ruta = routeOf(r.routeId);
    anotar('baja_variante', r.routeId, r.name, ruta ? ruta.companyId : null);
    res.json(r);
  });

  // ─── SALUD DEL SISTEMA ─────────────────────────────────────

  // ¿La base está en un disco aparte del de la aplicación?
  //
  // Es LA pregunta de operación: en un servidor que redespliega —Railway,
  // Fly, cualquier contenedor— el disco de la aplicación se rehace de cero
  // en cada despliegue. Un archivo ahí adentro desaparece con todo lo que
  // tenga: cuentas, historial, vueltas, turnos.
  //
  // Se compara el NÚMERO DE DISPOSITIVO de las dos carpetas, no el texto de
  // la ruta. Un volumen montado es otro dispositivo, y eso es cierto se
  // llame /data, /mnt/lo-que-sea o como fuere. Comparar contra "/data" sería
  // adivinar el nombre que usa un proveedor en particular.
  function enDiscoAparte(archivo) {
    try {
      return fs.statSync(path.dirname(archivo)).dev !== fs.statSync(__dirname).dev;
    } catch {
      return null;   // no se pudo averiguar: mejor decirlo que inventar
    }
  }

  // ─── EL RECORRIDO DE UNA RUTA ──────────────────────────────
  //
  // El trazador vive acá arriba porque las rutas las carga este nivel al dar
  // de alta la cooperativa — igual que el logo: la cooperativa recibe el
  // sistema ya configurado, y Despacho a lo sumo corrige.
  //
  // Se guarda por la MISMA función que usa Despacho (validación, transacción,
  // recarga de geometría y broadcast): dos copias de eso es una que se queda
  // atrás justo en lo que recalcula todas las brechas.
  const rutaDeLaEmpresa = (companyId, routeId) =>
    db.prepare('SELECT routeId FROM routes WHERE routeId = ? AND companyId = ?')
      .get(String(routeId), String(companyId));

  const varianteDe = (routeId, variantId) => {
    if (Number.isFinite(Number(variantId)) && variantId !== undefined && variantId !== '') {
      return db.prepare('SELECT * FROM route_variants WHERE variantId = ? AND routeId = ?')
        .get(Number(variantId), String(routeId)) || null;
    }
    // Sin variantId se trabaja sobre la activa — creándola si la ruta es
    // nueva, igual que hace el endpoint gemelo de Despacho.
    return varianteActiva(String(routeId));
  };

  app.get(BASE + '/empresas/:companyId/rutas/:routeId/recorrido', requireCreador, (req, res) => {
    // La ruta tiene que ser DE ESA cooperativa: el creador ve todas, pero una
    // URL que mezcla la empresa A con la ruta de B es un error que conviene
    // que explote acá y no en silencio.
    if (!rutaDeLaEmpresa(req.params.companyId, req.params.routeId)) {
      return res.status(404).json({ error: 'Esa ruta no es de esa cooperativa' });
    }
    const variante = varianteDe(req.params.routeId, req.query.variantId);
    if (!variante) return res.status(404).json({ error: 'Esa variante no existe' });
    res.json({
      routeId: req.params.routeId,
      variante: { variantId: variante.variantId, name: variante.name, activa: !!variante.activa },
      tramos: {
        ida: puntosDeVariante(variante.variantId, 'ida'),
        vuelta: puntosDeVariante(variante.variantId, 'vuelta'),
      },
    });
  });

  app.put(BASE + '/empresas/:companyId/rutas/:routeId/recorrido', requireCreador, (req, res) => {
    if (!rutaDeLaEmpresa(req.params.companyId, req.params.routeId)) {
      return res.status(404).json({ error: 'Esa ruta no es de esa cooperativa' });
    }
    const variante = varianteDe(req.params.routeId, req.body?.variantId);
    if (!variante) return res.status(404).json({ error: 'Esa variante no existe' });
    const r = guardarRecorrido(String(req.params.routeId), variante, req.body, 'CREADOR');
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    anotar('recorrido', req.params.routeId,
      `${r.variante.name}: ida ${r.puntos.ida} pts · vuelta ${r.puntos.vuelta} pts`,
      req.params.companyId);
    res.json(r);
  });

  // ─── RESPALDOS ─────────────────────────────────────────────
  //
  // Viven en el nivel del creador y no en Despacho a propósito: la base es de
  // TODAS las cooperativas a la vez, así que su respaldo no le pertenece a
  // ninguna. Y la descarga es la pieza que completa el esquema: el automático
  // queda en el mismo disco (cubre corrupción y borrados, no la pérdida del
  // volumen); bajarse el archivo a otra máquina es el respaldo de verdad.
  app.get(BASE + '/respaldos', requireCreador, (req, res) => {
    const carpeta = respaldo.dirDe(db.name || '');
    res.json({
      respaldos: respaldo.listar(carpeta).reverse(),   // el más nuevo primero
      cadaHoras: respaldo.CADA_HORAS,
      conservar: respaldo.CONSERVAR,
      enMemoria: !db.name || db.name === ':memory:',
    });
  });

  app.post(BASE + '/respaldos', requireCreador, async (req, res) => {
    const r = await respaldo.respaldar(db, db.constructor);
    if (!r.ok) return res.status(500).json({ error: r.motivo });
    anotar('respaldo_manual', null, `${r.archivo} (${Math.round(r.bytes / 1024)} kB)`);
    res.json(r);
  });

  app.get(BASE + '/respaldos/:archivo', requireCreador, (req, res) => {
    const nombre = String(req.params.archivo);
    // Solo el formato exacto de nombre que generamos: sin esto, un
    // `../../etc/passwd` viaja como "nombre de archivo" y esto se vuelve
    // lectura arbitraria del disco con sesión de creador.
    if (!respaldo.ES_RESPALDO.test(nombre)) {
      return res.status(400).json({ error: 'Ese nombre no es un respaldo' });
    }
    const ruta = path.join(respaldo.dirDe(db.name || ''), nombre);
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Ese respaldo no existe' });
    anotar('respaldo_descargado', null, nombre);
    res.download(ruta, nombre);
  });

  app.get(BASE + '/sistema', requireCreador, (req, res) => {
    const mem = process.memoryUsage();
    // La base y su WAL: el WAL puede crecer más que el archivo principal y
    // es lo primero que llena un volumen chico.
    const tamano = (archivo) => {
      try { return fs.statSync(archivo).size; } catch { return 0; }
    };
    const base = dbFile && dbFile !== ':memory:' ? dbFile : null;
    const vivo = deps.estadoVivo ? deps.estadoVivo() : { unidades: 0, conexiones: 0 };

    res.json({
      arrancadoEn,
      ahora: Date.now(),
      node: process.version,
      memoriaMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      // La RUTA COMPLETA, no solo el nombre del archivo. Antes decía
      // "r14.db" y con eso era imposible distinguir /data/r14.db —a salvo en
      // un volumen— de server/r14.db, que se borra en cada despliegue. Era
      // justo la diferencia que hay que ver.
      base: base || 'memoria',
      baseMb: base ? +((tamano(base) + tamano(base + '-wal')) / 1048576).toFixed(2) : 0,
      // Tres estados, no dos: en memoria / en el disco de la aplicación /
      // en un disco aparte. Solo el último sobrevive a un redespliegue.
      baseEnMemoria: !base,
      baseEnDiscoAparte: base ? enDiscoAparte(base) : false,
      empresas: db.prepare('SELECT COUNT(*) AS c FROM companies').get().c,
      empresasActivas: db.prepare('SELECT COUNT(*) AS c FROM companies WHERE activa = 1').get().c,
      rutas: db.prepare('SELECT COUNT(*) AS c FROM routes').get().c,
      personas: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role <> 'dispatch'").get().c,
      vehiculos: db.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c,
      sesionesAbiertas: db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE expiresAt > ?').get(Date.now()).c,
      ...vivo,
      sesionesCreador: sesiones.size,
      segundoFactor: !!totpClave,
    });
  });

  // ─── ACTIVIDAD DE TODO EL SERVIDOR ─────────────────────────
  // El único lugar donde se ve la auditoría de todas las cooperativas junta,
  // incluidas las acciones del propio creador.
  app.get(BASE + '/actividad', requireCreador, (req, res) => {
    const eventos = db.prepare(`
      SELECT actor, action, target, detail, routeId, companyId, timestamp
      FROM audit ORDER BY id DESC LIMIT 200
    `).all();
    res.json({ eventos });
  });

  // La lógica del trazador (geometría, inserción, deshacer) vive en
  // server/trazador.js: Node la prueba con require() y el panel la carga
  // con este <script>. Sin sesión igual que el HTML — una etiqueta <script>
  // no puede mandar el Bearer, y el archivo es código, no datos.
  const MODULO_TRAZADOR = path.join(__dirname, 'trazador.js');
  app.get(BASE + '/trazador.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('application/javascript').sendFile(MODULO_TRAZADOR);
  });

  // Leaflet lo sirve el propio panel, NO un CDN. Pasó de verdad: unpkg no
  // le entregó leaflet.js al navegador del creador y elegir una ruta dejaba
  // la página en blanco — el mapa se inicializaba con `L` sin existir. El
  // único nivel que puede depender de la red ajena es ninguno. Son 160 kB
  // en server/vendor/, verificados contra los hashes oficiales de 1.9.4.
  // Sí se cachea (a diferencia del resto del panel): es código público de
  // Leaflet, no datos de nadie, y pesa más que todo lo demás junto.
  const VENDOR = path.join(__dirname, 'vendor', 'leaflet');
  for (const [archivo, tipo] of [['leaflet.js', 'application/javascript'], ['leaflet.css', 'text/css']]) {
    app.get(BASE + '/' + archivo, (req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type(tipo).sendFile(path.join(VENDOR, archivo));
    });
  }

  // ─── LA PANTALLA ───────────────────────────────────────────
  // El HTML NO vive en project/, que se sirve entero como estáticos: ahí
  // quedaría accesible para cualquiera aunque el panel estuviera apagado.
  // Se sirve desde acá, y solo si el panel está montado.
  const PANTALLA = path.join(__dirname, 'creador.html');
  app.get(BASE, (req, res) => {
    // Nada de caché ni de indexado: esta página no tiene por qué quedar en
    // el disco de una máquina prestada ni en el historial de un buscador.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').sendFile(PANTALLA);
  });

  console.log(`Panel del creador montado en ${BASE}` +
    (totpClave ? ' (con segundo factor)' : ' (sin segundo factor: considerá CREATOR_TOTP_SECRET)'));
  return BASE;
}

// La ruta tiene que ser un path razonable: sin caracteres raros, sin
// espacios, y siempre empezando con barra.
function normalizarRuta(valor) {
  if (!valor) return null;
  let p = String(valor).trim();
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9._~/-]{1,80}$/.test(p)) {
    console.error(`CREATOR_PATH inválido (${valor}) — se usa /creador`);
    return null;
  }
  return p;
}

module.exports = { montarPanelDelCreador };
