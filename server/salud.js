'use strict';
// La salud del servidor (PENDIENTES 0.2, 03/11): saber que algo anda mal
// ANTES de que lo digan los choferes.
//
// `/ping` contestaba «pong» aunque la base no abriera; el disco lleno no
// avisaba (el login y el «fuera» daban 500 y nadie sabía por qué); la zona
// horaria y el WAL eran una línea en el log de arranque que nadie lee. Esto
// junta todo en un chequeo que se puede pedir (`GET /salud`, para un monitor
// externo y para el healthcheck del despliegue) y que el propio servidor
// corre cada minuto para avisar cuando cambia.
//
// Dos niveles:
//   problemas → el servidor NO está haciendo su trabajo (no guarda, el disco
//               se acabó). `/salud` contesta 503.
//   avisos    → anda, pero algo se va a romper o ya mide mal (respaldo
//               viejo, disco llenándose, hora corrida). `/salud` contesta 200.
//
// Módulo puro: recibe la base y lo demás, no lee variables de entorno. Así
// se prueba sin levantar el servidor (suite `salud`).
const fs = require('fs');
const path = require('path');

// Lo que dice cada código, para el log, la alerta y el panel del creador.
// Sin números: los números van aparte, sólo para el creador.
const TEXTOS = {
  base_en_memoria: 'La base está en memoria: un reinicio borra todo.',
  base_en_disco_de_app: 'La base está en el mismo disco que la aplicación: el próximo despliegue la borra. Falta montar el volumen.',
  base_no_lee: 'La base no contesta.',
  base_no_escribe: 'La base no puede escribir: no se guardan logins, turnos, mensajes ni SOS.',
  errores_de_base: 'Hubo errores al escribir en la base en los últimos minutos.',
  disco_lleno: 'Queda muy poco disco: la base está por dejar de escribir.',
  disco_poco: 'El disco se está llenando.',
  respaldo_nunca: 'No hay ningún respaldo de la base.',
  respaldo_viejo: 'El último respaldo es viejo: el automático no está corriendo.',
  zona_horaria_utc: 'El servidor corre en UTC (falta TZ=America/Lima): «hoy» y los informes van corridos cinco horas.',
  sin_wal: 'La base no está en modo WAL: más lenta con mucha carga.',
  servidor_lento: 'El servidor tarda en atender: algo lo está trabando.',
  sin_copia_afuera: 'Los respaldos están sólo en el disco del servidor: si se pierde el volumen, se pierden con ellos. Falta configurar la copia afuera.',
  copia_afuera_mal_configurada: 'La copia afuera está a medio configurar: faltan variables o la frase de cifrado.',
  copia_afuera_falla: 'La copia de los respaldos fuera del servidor está fallando.',
  copia_afuera_vieja: 'La última copia fuera del servidor es vieja.',
};

function crearSalud({
  db,
  respaldo = null,            // el módulo `respaldo.js`, para la edad del último
  copiaAfuera = null,         // () => estado de la copia afuera (ver index.js)
  demo = false,               // en la demo, la base en memoria es un aviso y no un problema
  // La carpeta de la aplicación, para ver si la base vive en OTRO disco (el
  // volumen). Sin volumen montado, el servidor arrancaba con una base nueva
  // y vacía en el disco del contenedor, y /salud daba 200: Railway aceptaba
  // el deploy y el siguiente borraba todo (auditoría 11/11). En producción
  // es un problema (503, el deploy no se acepta); `permitirDiscoDeApp` es
  // para un servidor propio de un solo disco, que no se rehace al desplegar.
  dirApp = null,
  permitirDiscoDeApp = false,
  discoCriticoMb = 100,
  discoAvisoMb = 500,
  ventanaErroresMs = 10 * 60_000,
  lentoMs = 2000,             // un atraso así del bucle de eventos ya se nota en el mapa
  ahora = () => Date.now(),
  medirBucle = true,
} = {}) {
  // La fila del latido: escribir de verdad es la única forma de saber que se
  // puede escribir (el disco lleno no se ve leyendo)
  try { db.exec('CREATE TABLE IF NOT EXISTS salud (clave TEXT PRIMARY KEY, valor INTEGER)'); } catch {}

  // Los errores de base que pasaron en otros lados (un INSERT que falló en
  // un handler): los anota quien los atrapa
  let errores = [];
  let noEscribe = false;
  // Sólo los errores que dicen que la BASE está mal (disco lleno, de sólo
  // lectura, de entrada/salida, dañada, no se abre). Un SQLITE_CONSTRAINT es
  // un bug de un pedido, y un SQLITE_BUSY suelto pasa solo: contarlos ponía
  // /salud en 503 diez minutos por un error cualquiera —y en los primeros
  // minutos de un deploy, Railway lo rechazaba— (revisión integral del 04/11).
  const GRAVES = /^SQLITE_(FULL|IOERR|READONLY|CORRUPT|CANTOPEN|NOTADB)/;
  function anotarFallaDeBase(e) {
    const codigo = e && typeof e.code === 'string' ? e.code : '';
    if (!GRAVES.test(codigo)) return false;
    errores.push({ en: ahora(), codigo });
    if (errores.length > 50) errores = errores.slice(-50);
    return true;
  }

  // El bucle de eventos: un tic por segundo, y cuánto llegó tarde. Un
  // servidor trabado (una consulta enorme, un bucle) contesta /salud tarde
  // pero contesta; esto lo nombra.
  let atrasos = [];
  let reloj = null;
  if (medirBucle) {
    let esperado = Date.now() + 1000;
    reloj = setInterval(() => {
      const t = Date.now();
      atrasos.push({ en: t, ms: Math.max(0, t - esperado) });
      if (atrasos.length > 120) atrasos = atrasos.slice(-120);
      esperado = t + 1000;
    }, 1000);
    if (reloj.unref) reloj.unref();
  }

  // `latido`: si se prueba escribir. Lo hace el vigilante cada minuto; el
  // GET /salud público NO escribe (cualquiera puede pedirlo las veces que
  // quiera) y además contesta lo último que vio si es de hace menos de 10 s.
  let ultimo = null;
  function chequear({ latido = true } = {}) {
    const t = ahora();
    const problemas = [];
    const avisos = [];
    const numeros = {};
    const archivo = db && db.name && db.name !== ':memory:' && !db.memory ? db.name : null;

    if (!archivo) (demo ? avisos : problemas).push('base_en_memoria');
    if (archivo && dirApp && !permitirDiscoDeApp) {
      try {
        if (fs.statSync(path.dirname(archivo)).dev === fs.statSync(dirApp).dev) {
          (demo ? avisos : problemas).push('base_en_disco_de_app');
        }
      } catch {}
    }

    try { db.prepare('SELECT 1').get(); } catch { problemas.push('base_no_lee'); }
    if (latido) {
      try {
        db.prepare("INSERT OR REPLACE INTO salud (clave, valor) VALUES ('latido', ?)").run(t);
        noEscribe = false;
      } catch (e) {
        anotarFallaDeBase(e);
        noEscribe = true;
      }
    }
    if (noEscribe) problemas.push('base_no_escribe');
    const recientes = errores.filter(x => t - x.en < ventanaErroresMs);
    numeros.erroresDeBase = recientes.length;
    if (recientes.length) numeros.ultimoErrorDeBase = recientes[recientes.length - 1].codigo;
    if (recientes.length && !problemas.includes('base_no_escribe')) problemas.push('errores_de_base');

    // El disco donde vive la base (el volumen), no el de la aplicación
    if (archivo && typeof fs.statfsSync === 'function') {
      try {
        const st = fs.statfsSync(path.dirname(archivo));
        const libre = Math.round(st.bavail * st.bsize / 1048576);
        numeros.discoLibreMb = libre;
        numeros.discoTotalMb = Math.round(st.blocks * st.bsize / 1048576);
        if (libre < discoCriticoMb) problemas.push('disco_lleno');
        else if (libre < discoAvisoMb) avisos.push('disco_poco');
      } catch {}
    }

    if (archivo && respaldo && respaldo.CADA_HORAS > 0) {
      try {
        const lista = respaldo.listar(respaldo.dirDe(archivo));
        const ultimo = lista[lista.length - 1];
        if (!ultimo) avisos.push('respaldo_nunca');
        else {
          numeros.respaldoHaceMin = Math.round((t - (ultimo.cuando || 0)) / 60_000);
          // Dos vueltas del automático perdidas: una puede ser un reinicio
          if (t - (ultimo.cuando || 0) > 2 * respaldo.CADA_HORAS * 3600_000) avisos.push('respaldo_viejo');
        }
      } catch {}
    }

    // La copia afuera (PENDIENTES 0.3). Sin configurar, en producción, es un
    // aviso y no un problema: el servidor trabaja igual, pero un volumen
    // perdido se lleva todo. Fallando o vieja, también aviso.
    if (copiaAfuera && archivo) {
      const c = copiaAfuera() || {};
      const cada = respaldo && respaldo.CADA_HORAS > 0 ? respaldo.CADA_HORAS : 6;
      if (c.error) avisos.push('copia_afuera_mal_configurada');
      else if (!c.configurada) { if (!demo) avisos.push('sin_copia_afuera'); }
      else {
        if (c.ultimaOk) numeros.copiaAfueraHaceMin = Math.round((t - c.ultimaOk.en) / 60_000);
        if (c.ultimoFallo && (!c.ultimaOk || c.ultimoFallo.en > c.ultimaOk.en)) {
          avisos.push('copia_afuera_falla');
          numeros.copiaAfueraError = c.ultimoFallo.motivo;
        } else if (c.revisada && (!c.ultimaOk || t - c.ultimaOk.en > 2 * cada * 3600_000)) {
          avisos.push('copia_afuera_vieja');
        }
      }
    }

    // La misma regla que el aviso de arranque: la hora local es la del
    // servidor, y en UTC el día del gerente empieza a las 19:00 de Perú
    numeros.zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    if (new Date(t).getTimezoneOffset() === 0) avisos.push('zona_horaria_utc');

    if (archivo) {
      try {
        const modo = db.pragma('journal_mode', { simple: true });
        numeros.journal = modo;
        if (String(modo).toLowerCase() !== 'wal') avisos.push('sin_wal');
      } catch {}
    }

    const ultimoMinuto = atrasos.filter(x => t - x.en < 60_000);
    numeros.atrasoMaxMs = ultimoMinuto.reduce((m, x) => Math.max(m, x.ms), 0);
    if (numeros.atrasoMaxMs > lentoMs) avisos.push('servidor_lento');

    const estado = problemas.length ? 'falla' : avisos.length ? 'aviso' : 'ok';
    ultimo = { ok: problemas.length === 0, estado, problemas, avisos, numeros, en: t };
    return ultimo;
  }

  // Lo público: sin números ni rutas. Alcanza para que un monitor decida y
  // para que quien mira sepa qué pasa; los números son del creador.
  function publico(r = chequear()) {
    return {
      ok: r.ok, estado: r.estado,
      problemas: r.problemas, avisos: r.avisos,
      detalle: [...r.problemas, ...r.avisos].map(c => TEXTOS[c] || c),
      time: new Date(r.en).toISOString(),
    };
  }

  // Para el GET público: lo último si es fresco, si no un chequeo sin escribir
  function paraAfuera() {
    if (ultimo && ahora() - ultimo.en < 10_000) return ultimo;
    return chequear({ latido: false });
  }
  return { chequear, paraAfuera, publico, anotarFallaDeBase, detener: () => reloj && clearInterval(reloj) };
}

// El texto de una alerta, para el log y para el webhook
function textoDeAlerta(r, servidor) {
  const cabeza = r.estado === 'ok'
    ? `✔ ${servidor}: el servidor volvió a estar bien.`
    : `${r.estado === 'falla' ? '✖' : '⚠'} ${servidor}: ${r.estado === 'falla' ? 'PROBLEMA' : 'aviso'}.`;
  const lineas = [...r.problemas, ...r.avisos].map(c => '- ' + (TEXTOS[c] || c));
  return [cabeza, ...lineas].join('\n');
}

// Avisar afuera: un POST al webhook que se configure (ALERTA_URL). ntfy.sh
// quiere el texto plano; Slack, Discord y casi todo lo demás aceptan JSON con
// `text` o `content`, así que se mandan los dos. Mejor esfuerzo: si el
// webhook no contesta, queda en el log y nada más.
async function avisarAfuera(url, r, servidor, fetchImpl = globalThis.fetch) {
  if (!url || !fetchImpl) return false;
  const texto = textoDeAlerta(r, servidor);
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 8000);
  try {
    const esNtfy = /ntfy/i.test(url);
    const res = await fetchImpl(url, esNtfy
      ? { method: 'POST', body: texto, signal: control.signal,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: `Control de flota: ${r.estado}`,
                     Priority: r.estado === 'falla' ? 'urgent' : 'default' } }
      : { method: 'POST', signal: control.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: texto, content: texto, estado: r.estado, servidor,
                                 problemas: r.problemas, avisos: r.avisos }) });
    return res.ok;
  } catch {
    return false;
  } finally { clearTimeout(t); }
}

// La vigilancia: chequear cada `cadaMs` y avisar sólo cuando el estado
// CAMBIA (de ok a aviso, de aviso a falla, y de vuelta a ok). Un aviso por
// minuto con lo mismo es ruido que se termina silenciando. Un cambio en la
// lista de problemas dentro del mismo estado también se avisa.
function vigilar(salud, { cadaMs = 60_000, alCambiar } = {}) {
  let anterior = null;
  const firma = (r) => `${r.estado}|${r.problemas.join(',')}|${r.avisos.join(',')}`;
  const mirar = () => {
    const r = salud.chequear();
    const f = firma(r);
    // El primer chequeo avisa sólo si no está bien: arrancar sano no es noticia
    if (anterior === null ? r.estado !== 'ok' : f !== anterior) {
      try { alCambiar && alCambiar(r, anterior); } catch {}
    }
    anterior = f;
    return r;
  };
  const reloj = setInterval(mirar, cadaMs);
  if (reloj.unref) reloj.unref();
  return { mirar, detener: () => clearInterval(reloj) };
}

module.exports = { crearSalud, vigilar, avisarAfuera, textoDeAlerta, TEXTOS };
