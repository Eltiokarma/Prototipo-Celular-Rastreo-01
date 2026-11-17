// Qué mostrarle al chofer, a partir de las brechas del servidor.
//
// JavaScript puro, sin React ni React Native: es la parte donde vivieron
// TODOS los bugs de esta pantalla —la unidad inventada, el lado vacío, el
// "sin señal" confundido con "no hay nadie", el "02:60"— y es la que se
// puede probar sin un teléfono en la mano. Las pantallas solo dibujan lo
// que devuelve esto.
//
// La misma lógica existe hoy dentro de `project/Prototipo.html`. Está
// repetida a propósito por ahora: mientras la web y la nativa convivan,
// unificarlas obligaría a la web a tener un paso de build, que es justo lo
// que ese archivo evita. Si divergen, manda `pruebas/hud.js`.

'use strict';

// "02:15" → 2.25. Devuelve NaN para un lado sin dato, que es lo que vale un
// tiempo que no existe.
function aMinutos(mmss) {
  if (!mmss) return NaN;
  const [m, s] = String(mmss).split(':').map(Number);
  return m + s / 60;
}

// 2 → "2:00", 2.5 → "2:30"
function objetivoLegible(min) {
  const total = Math.round(min * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// El dígito grande no lleva cero adelante: "02:24" → "2:24"
function sinCeroInicial(mmss) {
  return String(mmss || '').replace(/^0(\d)/, '$1');
}

// Desvío relativo al objetivo. Los cortes salieron de una auditoría: verde
// hasta 15 %, ámbar hasta 30 %, rojo por encima.
function estadoDe(mmss, objetivoMin) {
  const min = aMinutos(mmss);
  if (!Number.isFinite(min) || !objetivoMin) return 'ninguno';
  const desvio = Math.abs(min - objetivoMin) / objetivoMin;
  if (desvio <= 0.15) return 'verde';
  if (desvio <= 0.30) return 'ambar';
  return 'rojo';
}

// Un lado (adelante o atrás) tiene TRES formas, no dos. Ver PROTOCOLO.md:
// "no hay nadie" y "hay alguien y no sé dónde" son situaciones opuestas para
// el que maneja, y mostrarlas igual fue el bug más caro de este proyecto.
// Cuánto lleva trabado el vecino, en minutos enteros. `ahora` se inyecta
// para que la prueba no dependa del reloj.
function minutosDeTrafico(brechaLado, ahora) {
  if (!brechaLado?.enTrafico) return null;
  const desde = Number(brechaLado.traficoDesde);
  if (!Number.isFinite(desde)) return 0;
  return Math.max(0, Math.round((ahora - desde) / 60000));
}

function armarLado(brechaLado, etiqueta, signo, objetivoMin, ahora) {
  if (!brechaLado) {
    return { etiqueta, signo, unidad: null, vacio: true, sinSenal: false, enTrafico: false, traficoMin: null,
             estado: 'ninguno', display: null, rotulo: 'sin nadie' };
  }
  // El tráfico se suma a cualquiera de los otros dos estados: una unidad
  // trabada sigue teniendo (o no) un tiempo contra el cual medirse. Lo que
  // cambia es el rótulo, y abajo, la instrucción.
  const enTrafico = !!brechaLado.enTrafico;
  const traficoMin = minutosDeTrafico(brechaLado, ahora);
  const traficoConfirmado = !!brechaLado.traficoConfirmado;
  const sufijoTrafico = enTrafico
    ? ` · ${traficoConfirmado ? 'EN TRÁFICO' : 'PARADA'} ${traficoMin} MIN` : '';
  if (brechaLado.sinSenal || !brechaLado.tiempo) {
    return { etiqueta, signo, unidad: brechaLado.unidad, vacio: true, sinSenal: true,
             enTrafico, traficoMin, traficoConfirmado,
             estado: 'ninguno', display: null,
             rotulo: `${brechaLado.unidad} · sin señal${sufijoTrafico}` };
  }
  return {
    etiqueta, signo, unidad: brechaLado.unidad, vacio: false, sinSenal: false,
    enTrafico, traficoMin, traficoConfirmado,
    estado: estadoDe(brechaLado.tiempo, objetivoMin),
    display: sinCeroInicial(brechaLado.tiempo),
    minutos: aMinutos(brechaLado.tiempo),
    rotulo: `${signo} · ${brechaLado.unidad}${sufijoTrafico}`,
  };
}

// ─── LA BRECHA VIEJA (auditoría de UI, N1, 16/11) ───────────────────
// Sin señal la pantalla seguía mostrando la última brecha en su color y con
// su instrucción: «Mantén el ritmo» sobre un dato de hace minutos. Con el
// teléfono reportando, el estado llega cada ~3 s (cada posición dispara
// uno), así que su edad mide la señal mejor que el socket, que tarda en
// darse cuenta de que murió. Los mismos cortes que la web:
//   - menos de 10 s: nada cambia;
//   - desde 10 s: la brecha es VIEJA, va en gris y se dice cuánto hace;
//   - desde 60 s: está PERDIDA, la pantalla retira el número.
// El acompañante no reporta (su estado depende de otros teléfonos): ahí
// manda la conexión.
const VIEJA_MS = 10_000, PERDIDA_MS = 60_000;

// 75 000 ms → "1:15"
function duracionLegible(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Un lado con número, apagado: el número queda, el color de estado no.
const apagado = (lado) => (lado.vacio ? lado : { ...lado, estadoReal: lado.estado, estado: 'ninguno' });

// `brecha` es lo que devuelve cliente.miBrecha(). `recibido` es cuándo llegó
// el estado de donde sale; sin él (la notificación, las pruebas viejas) la
// brecha se toma como fresca.
function construirHud(brecha, ahora = Date.now(), { recibido = null, fiable = true, conectado = true } = {}) {
  const edad = recibido ? Math.max(0, ahora - recibido) : 0;
  const viejo = !!recibido && (fiable ? edad >= VIEJA_MS : !conectado);
  const perdido = viejo && edad >= PERDIDA_MS;
  const objetivoMin = brecha?.objetivoMin ?? null;
  const adelante = armarLado(brecha?.adelante, 'ADELANTE', '+1', objetivoMin, ahora);
  const atras    = armarLado(brecha?.atras,    'ATRÁS',    '−1', objetivoMin, ahora);

  // El dígito grande es para lo que el chofer tiene que corregir, así que un
  // lado sin número nunca puede ser el principal. Entre dos lados sin número
  // manda el que tiene a alguien sin señal: es lo único que hay para decir.
  const heroeEsAtras =
    (atras.vacio && adelante.vacio) ? (atras.sinSenal && !adelante.sinSenal)
    : atras.vacio ? false
    : adelante.vacio ? true
    : Math.abs(atras.minutos - objetivoMin) >= Math.abs(adelante.minutos - objetivoMin);

  const principal = heroeEsAtras ? atras : adelante;
  const secundario = heroeEsAtras ? adelante : atras;

  if (viejo) {
    const hace = duracionLegible(edad);
    return {
      objetivoMin, adelante: apagado(adelante), atras: apagado(atras),
      principal: apagado(principal), secundario: apagado(secundario),
      instruccion: principal.vacio
        ? `Sin datos nuevos desde hace ${hace}.`
        : `Brecha de hace ${hace}. Puede haber cambiado.`,
      estado: 'ninguno', viejo, perdido, edad, hace,
    };
  }
  return {
    objetivoMin, adelante, atras, principal, secundario,
    instruccion: instruccionDe(principal, heroeEsAtras, objetivoMin, adelante, atras),
    estado: principal.estado, viejo: false, perdido: false, edad, hace: null,
  };
}

function instruccionDe(principal, esAtras, objetivoMin, adelante, atras) {
  // El de ADELANTE trabado manda sobre todo lo demás. La brecha contra él
  // crece sola mientras está parado, y la cuenta de siempre diría "apura":
  // apurar hacia un embotellamiento es el pelotón que este sistema existe
  // para evitar, y encima con la combi de adelante ya adentro.
  if (adelante.enTrafico) {
    const que = adelante.traficoConfirmado ? 'avisa que está en tráfico' : 'lleva parada';
    return `${adelante.unidad} ${que} ${adelante.traficoMin} min. Mantén: no te apures hacia el embotellamiento.`;
  }
  // El de ATRÁS trabado no es un peligro para ti: se dice, y se pide ritmo
  // normal — la brecha con él se va a agrandar sola y no es tu culpa.
  if (atras.enTrafico) {
    return `${atras.unidad} (atrás) ${atras.traficoConfirmado ? 'está en tráfico' : 'lleva parada'} ${atras.traficoMin} min. Mantén el ritmo.`;
  }
  // Con alguien sin señal, callarse o decir "eres la única" sería peor que no
  // mostrar nada: hay una combi que el chofer no ve, y manejar como si no
  // estuviera es exactamente lo que hay que evitar.
  if (principal.sinSenal) {
    return `${principal.unidad} se quedó sin señal. Ve con cuidado: sigue en ruta.`;
  }
  if (principal.vacio) {
    return (adelante.sinSenal || atras.sinSenal)
      ? 'Sin brecha para medir por ahora.'
      : 'Eres la única unidad en ruta.';
  }
  if (principal.estado === 'verde') {
    return `Mantén el ritmo. Objetivo ${objetivoLegible(objetivoMin)}.`;
  }
  // Con la de ADELANTE, una brecha mayor al objetivo significa que se está
  // escapando: hay que apurar. Con la de ATRÁS es al revés — una brecha
  // chica significa que te vienen pisando y hay que apurar igual.
  const dev = principal.minutos - objetivoMin;
  const apurar = esAtras ? dev < 0 : dev > 0;
  return `${apurar ? 'Apura' : 'Afloja'} un poco. Objetivo ${objetivoLegible(objetivoMin)}.`;
}

// El texto de la notificación permanente. Android la exige para que el GPS
// corra en segundo plano, así que va a estar sí o sí: que diga la brecha en
// vez de "la app está corriendo" es gratis y es lo que el chofer mira sin
// desbloquear.
function textoNotificacion(hud, reportaGps) {
  if (!reportaGps) return 'Modo acompañante · tu GPS no se usa';
  if (hud.viejo) return `Sin señal hace ${hud.hace} · la brecha puede haber cambiado`;
  const p = hud.principal;
  // El tráfico adelante es lo primero que se lee sin desbloquear
  if (hud.adelante.enTrafico) {
    return `ADELANTE ${hud.adelante.unidad} · ${hud.adelante.traficoConfirmado ? 'EN TRÁFICO' : 'PARADA'} ${hud.adelante.traficoMin} MIN`;
  }
  if (p.sinSenal) return `${p.unidad} sin señal · sigue en ruta`;
  if (p.vacio) return 'Sin brecha para medir';
  return `${p.etiqueta} ${p.rotulo.replace(/^.{2} · /, '')} · ${p.display}`;
}

// La brecha que vuelve en la respuesta del POST /gps → la notificación viva.
//
// Con la pantalla apagada no hay WebSocket ni estado: el único dato que
// llega es el `brecha` que el servidor pega en la respuesta del POST (los
// mismos campos que gaps[unidad] del estado). Esto lo convierte en las dos
// líneas de la notificación, pasando por el MISMO construirHud que dibuja
// la pantalla — la notificación no puede decir una cosa y el HUD otra.
//
// Devuelve null cuando no hay nada que decir (sin brecha en la respuesta):
// null significa "no toques la notificación", no "muestra vacío".
function avisoDesdeRespuesta(brecha, ahora = Date.now()) {
  if (!brecha) return null;
  // Los tres estados de un lado, como en cliente.js: nadie / alguien a
  // tanto / alguien sin señal, más el tráfico encima. Ver PROTOCOLO.md.
  const lado = (tiempo, unidad, sinSenal, enTrafico, desde, confirmado) => {
    if (!unidad) return null;
    const t = { enTrafico: !!enTrafico, traficoDesde: desde ?? null, traficoConfirmado: !!confirmado };
    if (sinSenal || !tiempo) return { tiempo: null, unidad, sinSenal: true, ...t };
    return { tiempo, unidad, sinSenal: false, ...t };
  };
  const hud = construirHud({
    adelante: lado(brecha.toAhead, brecha.aheadUnit, brecha.aheadSinSenal,
                   brecha.aheadEnTrafico, brecha.aheadTraficoDesde, brecha.aheadTraficoConfirmado),
    atras:    lado(brecha.toBehind, brecha.behindUnit, brecha.behindSinSenal,
                   brecha.behindEnTrafico, brecha.behindTraficoDesde, brecha.behindTraficoConfirmado),
    objetivoMin: brecha.objetivoMin ?? null,
  }, ahora);
  return { titulo: textoNotificacion(hud, true), detalle: hud.instruccion };
}

// La notificación cuando los envíos dejan de salir (auditoría de UI, N1 en la
// APK). Con la pantalla apagada la notificación se actualiza con la respuesta
// de cada POST /gps; si fallan, seguía mostrando la última brecha como si
// fuera de ahora. En minutos y no en segundos: la notificación se re-emite
// sólo cuando cambia el texto, y un intento cada 10 s no tiene que
// re-emitirla cada 10 s. Devuelve null con el último envío fresco.
function avisoSinSenal(ultimoEnvio, ahora = Date.now()) {
  if (!ultimoEnvio || ahora - ultimoEnvio < VIEJA_MS) return null;
  const min = Math.floor((ahora - ultimoEnvio) / 60_000);
  return {
    titulo: `SIN SEÑAL · ${min < 1 ? 'hace menos de 1 min' : `hace ${min} min`}`,
    detalle: 'La última brecha puede haber cambiado. Ve con cuidado: las otras combis siguen en ruta.',
  };
}

// ─── La combi del cobrador ───────────────────────────────────────────
// El cobrador ve el HUD de su combi, de acompañante: la posición la manda el
// teléfono del chofer. Pero las brechas sólo dicen algo si esa combi está
// EN la cadena. Si está ausente, yendo, fuera de ruta o el teléfono del
// chofer dejó de mandar, el servidor no le calcula brechas, y el HUD decía
// «Eres la única unidad en ruta» (con otras combis andando) o le atribuía
// la falta de señal al vecino (revisión del manual con ChatGPT, 17/11).
//
// `estado` es el estado de la ruta tal cual llega; `combi`, la del cobrador.
// Sin estado todavía no se sabe nada: null, y se espera.
function estadoDeMiCombi(estado, combi) {
  if (!estado || !combi) return null;
  const u = (estado.units || []).find(x => x.unitId === combi);
  if (!u) return { estado: 'fuera', combi };
  if (u.presencia === 'ausente') return { estado: 'ausente', combi };
  if (u.presencia === 'ruta' && u.enRuta === false) return { estado: 'yendo', combi };
  if (u.sinSenal) return { estado: 'sinSenal', combi, desde: u.sinSenalDesde ?? u.timestamp ?? null };
  return { estado: 'ok', combi };
}

const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// Lo que se le dice en vez de las brechas. null: la combi está en la cadena
// y las brechas valen.
function avisoDeMiCombi(e) {
  if (!e || e.estado === 'ok') return null;
  const c = e.combi;
  switch (e.estado) {
    case 'fuera': return { titulo: 'TU COMBI NO ESTÁ EN RUTA',
      texto: `${c} todavía no salió a ruta, o ya terminó. Las brechas aparecen cuando el chofer desliza SALIR A RUTA.` };
    case 'ausente': return { titulo: 'TU COMBI ESTÁ AUSENTE',
      texto: `El chofer sacó a ${c} de la cadena (comer, un repuesto): nadie se mide contra ella hasta que vuelva a ruta.` };
    case 'yendo': return { titulo: 'TU COMBI VA HACIA LA RUTA',
      texto: `Las brechas de ${c} arrancan cuando pise el trazado.` };
    case 'sinSenal': return { titulo: 'EL CHOFER NO TIENE SEÑAL',
      texto: `El teléfono del chofer no manda la posición de ${c}${e.desde ? ` desde las ${hhmm(e.desde)}` : ''}. Las brechas vuelven cuando vuelva su señal.` };
    default: return null;
  }
}

module.exports = {
  construirHud, textoNotificacion, avisoDesdeRespuesta, avisoSinSenal, estadoDeMiCombi, avisoDeMiCombi,
  // Se exportan para las pruebas y para que las pantallas no las repitan
  aMinutos, estadoDe, objetivoLegible, sinCeroInicial, duracionLegible,
  VIEJA_MS, PERDIDA_MS,
};
