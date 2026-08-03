// La identidad de cada cooperativa: su nombre y su logo.
//
// Suena a decoración y no lo es. Este sistema atiende a VARIAS cooperativas a
// la vez, y hasta ahora la única señal de a cuál pertenecía una pantalla era
// el nombre en un rincón. Un chofer que abre la app y ve la marca de otra
// cooperativa —o ninguna— no sabe si se equivocó de cuenta, si el sistema es
// de su empresa, ni a quién reclamarle. La marca es lo que hace que el sistema
// se sienta de ellos, y eso es la mitad de que lo usen.
//
// JS puro y con su suite porque son reglas, no dibujo: qué logo se acepta, qué
// pasa cuando no hay ninguno, y cuánto puede pesar.

'use strict';

// El tope, en caracteres del data-URL. Un logo es chico por naturaleza: a
// 256x256 un PNG decente entra en 30-60 kB. 200 000 caracteres son ~150 kB
// reales, o sea holgado, y sigue siendo un orden de magnitud menos que una
// foto del chat.
//
// Importa que sea CHICO porque el logo viaja a cada pantalla que lo muestra,
// incluida la del chofer, y esta app se mide en megas de datos móviles.
const MAX_LOGO = 200_000;

// Solo imágenes, y solo formatos que un navegador y un WebView dibujen sin
// pensar. SVG queda AFUERA a propósito: un SVG es un documento con scripts
// adentro, y esto se pinta en el panel de Despacho y en la app del chofer.
// Un logo que puede ejecutar código no es un logo.
const FORMATOS = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/webp'];

function logoValido(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const limpio = dataUrl.trim();
  if (!FORMATOS.some(f => limpio.startsWith(f))) return null;
  if (limpio.length > MAX_LOGO) return null;
  // Tiene que tener cuerpo: `data:image/png;base64,` a secas pasa los dos
  // controles de arriba y deja un cuadro roto en pantalla.
  const coma = limpio.indexOf(',');
  if (coma < 0 || limpio.length - coma < 100) return null;
  return limpio;
}

// Por qué se rechazó, para poder decírselo a quien lo sube. Un "no se pudo"
// pelado hace que la persona pruebe el mismo archivo tres veces.
function motivoRechazo(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) return 'Falta la imagen';
  const limpio = dataUrl.trim();
  if (/^data:image\/svg/i.test(limpio)) {
    return 'Los SVG no se aceptan por seguridad: mandá PNG, JPG o WEBP';
  }
  if (!FORMATOS.some(f => limpio.startsWith(f))) {
    return 'El logo tiene que ser una imagen PNG, JPG o WEBP';
  }
  if (limpio.length > MAX_LOGO) {
    return `El logo pesa demasiado: el tope son ${Math.round(MAX_LOGO / 1024)} kB de data-URL`;
  }
  return 'La imagen está vacía o incompleta';
}

// Las iniciales, para cuando NO hay logo.
//
// Un hueco en blanco donde va la marca se lee como que el sistema está roto.
// Dos letras sobre un cuadro de color se leen como una cooperativa que todavía
// no subió su logo, que es la verdad. Y sirve desde el primer día, sin que
// nadie tenga que hacer nada.
//
// Se saltean las palabras que tienen todas las cooperativas —"cooperativa",
// "transportes"—, porque si no todas se llamarían "CT".
const GENERICAS = new Set([
  'cooperativa', 'coop', 'transporte', 'transportes',
  'servicio', 'servicios', 'empresa', 'sa', 'srl', 'eirl', 'ltda',
]);

// Los conectores se saltean SIEMPRE, incluso cuando no queda nada más. Un
// nombre que da "CD" —de "Cooperativa **de** Transportes"— es peor que uno
// que da "CT": la inicial de un "de" no identifica a nadie.
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en']);

function iniciales(nombre) {
  const palabras = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca los acentos
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter(p => !CONECTORES.has(p.toLowerCase()));

  const utiles = palabras.filter(p => !GENERICAS.has(p.toLowerCase()));
  // Si TODO el nombre son palabras genéricas, mejor esas que nada.
  const fuente = utiles.length ? utiles : palabras;
  if (!fuente.length) return '?';

  // Un nombre de una sola palabra da sus dos primeras letras: "Andina" → AN.
  if (fuente.length === 1) return fuente[0].slice(0, 2).toUpperCase();
  return (fuente[0][0] + fuente[1][0]).toUpperCase();
}

// Un color estable a partir del identificador, para el cuadro de las
// iniciales. Estable importa: si cambiara entre pantallas o entre recargas,
// dejaría de servir como seña de "ésta es mi cooperativa".
const COLORES = ['#2580CF', '#3DD685', '#F5C542', '#FF8A3D', '#B46BD8', '#38B6A6'];

function colorDe(companyId) {
  const s = String(companyId || '');
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return COLORES[n % COLORES.length];
}

// Lo que se manda a cualquier pantalla que muestre la marca.
function marcaDe(empresa) {
  const nombre = empresa?.name || null;
  return {
    companyId: empresa?.companyId || null,
    nombre,
    logo: empresa?.logo || null,
    iniciales: iniciales(nombre),
    color: colorDe(empresa?.companyId),
  };
}

module.exports = { logoValido, motivoRechazo, iniciales, colorDe, marcaDe,
                   MAX_LOGO, FORMATOS, COLORES };
