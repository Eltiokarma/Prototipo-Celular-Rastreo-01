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
function armarLado(brechaLado, etiqueta, signo, objetivoMin) {
  if (!brechaLado) {
    return { etiqueta, signo, unidad: null, vacio: true, sinSenal: false,
             estado: 'ninguno', display: null, rotulo: 'sin nadie' };
  }
  if (brechaLado.sinSenal || !brechaLado.tiempo) {
    return { etiqueta, signo, unidad: brechaLado.unidad, vacio: true, sinSenal: true,
             estado: 'ninguno', display: null,
             rotulo: `${brechaLado.unidad} · sin señal` };
  }
  return {
    etiqueta, signo, unidad: brechaLado.unidad, vacio: false, sinSenal: false,
    estado: estadoDe(brechaLado.tiempo, objetivoMin),
    display: sinCeroInicial(brechaLado.tiempo),
    minutos: aMinutos(brechaLado.tiempo),
    rotulo: `${signo} · ${brechaLado.unidad}`,
  };
}

// `brecha` es lo que devuelve cliente.miBrecha().
function construirHud(brecha) {
  const objetivoMin = brecha?.objetivoMin ?? null;
  const adelante = armarLado(brecha?.adelante, 'ADELANTE', '+1', objetivoMin);
  const atras    = armarLado(brecha?.atras,    'ATRÁS',    '−1', objetivoMin);

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
  if (p.sinSenal) return `${p.unidad} sin señal · sigue en ruta`;
  if (p.vacio) return 'Sin brecha para medir';
  return `${p.etiqueta} ${p.rotulo.replace(/^.{2} · /, '')} · ${p.display}`;
}

module.exports = {
  construirHud, textoNotificacion,
  // Se exportan para las pruebas y para que las pantallas no las repitan
  aMinutos, estadoDe, objetivoLegible, sinCeroInicial,
};
