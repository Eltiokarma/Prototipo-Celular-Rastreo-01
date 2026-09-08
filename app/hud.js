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

// `brecha` es lo que devuelve cliente.miBrecha().
function construirHud(brecha, ahora = Date.now()) {
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

  return {
    objetivoMin, adelante, atras, principal, secundario,
    instruccion: instruccionDe(principal, heroeEsAtras, objetivoMin, adelante, atras),
    estado: principal.estado,
  };
}

function instruccionDe(principal, esAtras, objetivoMin, adelante, atras) {
  // El de ADELANTE trabado manda sobre todo lo demás. La brecha contra él
  // crece sola mientras está parado, y la cuenta de siempre diría "apurá":
  // apurar hacia un embotellamiento es el pelotón que este sistema existe
  // para evitar, y encima con la combi de adelante ya adentro.
  if (adelante.enTrafico) {
    const que = adelante.traficoConfirmado ? 'avisa que está en tráfico' : 'lleva parada';
    return `${adelante.unidad} ${que} ${adelante.traficoMin} min. Mantené: no te apures hacia el embotellamiento.`;
  }
  // El de ATRÁS trabado no es un peligro para vos: se dice, y se pide ritmo
  // normal — la brecha con él se va a agrandar sola y no es tu culpa.
  if (atras.enTrafico) {
    return `${atras.unidad} (atrás) ${atras.traficoConfirmado ? 'está en tráfico' : 'lleva parada'} ${atras.traficoMin} min. Mantené el ritmo.`;
  }
  // Con alguien sin señal, callarse o decir "sos la única" sería peor que no
  // mostrar nada: hay una combi que el chofer no ve, y manejar como si no
  // estuviera es exactamente lo que hay que evitar.
  if (principal.sinSenal) {
    return `${principal.unidad} se quedó sin señal. Andá con cuidado: sigue en ruta.`;
  }
  if (principal.vacio) {
    return (adelante.sinSenal || atras.sinSenal)
      ? 'Sin brecha para medir por ahora.'
      : 'Sos la única unidad en ruta.';
  }
  if (principal.estado === 'verde') {
    return `Mantené el ritmo. Objetivo ${objetivoLegible(objetivoMin)}.`;
  }
  // Con la de ADELANTE, una brecha mayor al objetivo significa que se está
  // escapando: hay que apurar. Con la de ATRÁS es al revés — una brecha
  // chica significa que te vienen pisando y hay que apurar igual.
  const dev = principal.minutos - objetivoMin;
  const apurar = esAtras ? dev < 0 : dev > 0;
  return `${apurar ? 'Apurá' : 'Aflojá'} un poco. Objetivo ${objetivoLegible(objetivoMin)}.`;
}

// El texto de la notificación permanente. Android la exige para que el GPS
// corra en segundo plano, así que va a estar sí o sí: que diga la brecha en
// vez de "la app está corriendo" es gratis y es lo que el chofer mira sin
// desbloquear.
function textoNotificacion(hud, reportaGps) {
  if (!reportaGps) return 'Modo acompañante · tu GPS no se usa';
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
// null significa "no toques la notificación", no "mostrá vacío".
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

module.exports = {
  construirHud, textoNotificacion, avisoDesdeRespuesta,
  // Se exportan para las pruebas y para que las pantallas no las repitan
  aMinutos, estadoDe, objetivoLegible, sinCeroInicial,
};
