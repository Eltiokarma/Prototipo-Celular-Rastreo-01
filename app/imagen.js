// Cuánto puede pesar una foto y cuánto hay que achicarla.
//
// El problema no es sacar la foto: es que una de celular sale de 3 a 8 MB, y
// acá el que la manda paga una vez y **los que la reciben pagan cada uno**.
// Una foto sin achicar en una ruta de veinte combis son veinte descargas. Y
// esto corre en Juliaca, con datos prepago.
//
// Todo lo de acá es JavaScript puro para poder probarlo en Node: son cuentas,
// y las cuentas mal hechas no se ven en la pantalla — se ven en la factura.

// 1280 px en el lado largo. Es de sobra para lo que se va a mandar: una
// chapa, un desperfecto, un choque, un control policial. Nadie amplía eso.
const MAX_LADO = 1280;

// 0.5 de calidad JPEG. En una foto de la calle la diferencia con 0.9 no se
// ve en el celular de Despacho y pesa como un tercio.
const CALIDAD = 0.5;

// El mismo tope que el servidor (MAX_IMAGEN). Si se cambia uno hay que
// cambiar el otro — la suite `foto` lo verifica contra el servidor de verdad,
// mandando una foto de más y una de menos.
const MAX_DATAURL = 1_200_000;

// A qué medida hay que llevarla, o null si ya está bien.
//
// Se pide UN solo lado y el otro sale solo, para no deformarla. Y se pide el
// LARGO: pedir siempre el ancho deja una foto vertical de 1280×1707, que es
// más alta que el original horizontal que se quería limitar.
//
// Devuelve null cuando ya entra, y eso es importante: pedir 1280 sobre una
// foto de 600 px la AGRANDA, y una foto agrandada pesa más y no se ve mejor.
function medidaObjetivo(ancho, alto) {
  const a = Number(ancho), b = Number(alto);
  if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return null;
  if (Math.max(a, b) <= MAX_LADO) return null;
  return a >= b ? { width: MAX_LADO } : { height: MAX_LADO };
}

// Cuánto pesa de verdad un data-URL, en bytes del archivo.
//
// El base64 infla 4/3, así que la cadena NO es el peso: tomarla como peso
// sobreestima un 33 % y hace rechazar fotos que entraban bien.
function pesoAproximado(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const coma = dataUrl.indexOf(',');
  if (coma < 0) return 0;
  const cuerpo = dataUrl.length - coma - 1;
  const relleno = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(cuerpo * 3 / 4) - relleno);
}

// ¿La rechaza el servidor? Se pregunta ANTES de mandarla: el servidor la
// descarta en silencio, así que sin esto el chofer ve su foto salir y nunca
// se entera de que no llegó.
function demasiadoPesada(dataUrl) {
  return typeof dataUrl !== 'string' || dataUrl.length > MAX_DATAURL;
}

function esImagen(dataUrl) {
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image');
}

// Para mostrarle al chofer cuánto ocupó — en una ruta con datos prepago eso
// no es un detalle de nerd.
function comoTexto(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB';
}

module.exports = {
  medidaObjetivo, pesoAproximado, demasiadoPesada, esImagen, comoTexto,
  MAX_LADO, CALIDAD, MAX_DATAURL,
};
