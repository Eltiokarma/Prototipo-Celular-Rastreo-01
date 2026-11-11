// Un plugin de Babel para los chequeos de sintaxis: avisa cuando una
// const/let se usa ANTES de su declaración en el mismo cuerpo de función
// —no adentro de una función anidada, que corre después—. Compila bien y
// revienta al ejecutar («Cannot access 'combis' before initialization»).
//
// Existe por la revisión previa a la APK (31/10): un `combis` usado unas
// líneas antes de su `useState` en `App.js` habría tirado la app al abrirla,
// y ni la sintaxis ni ninguna suite lo veía.
module.exports = function zonaMuerta(hallazgos, fuente) {
  const linea = (pos) => fuente.slice(0, pos).split('\n').length;
  return () => ({
    visitor: {
      ReferencedIdentifier(p) {
        const b = p.scope.getBinding(p.node.name);
        if (!b || (b.kind !== 'const' && b.kind !== 'let')) return;
        if (b.path.node.start == null || p.node.start == null || p.node.start >= b.path.node.start) return;
        const enRef = p.getFunctionParent(), enDecl = b.path.getFunctionParent();
        if ((enRef && enRef.node) !== (enDecl && enDecl.node)) return;
        const msg = `«${p.node.name}» en la línea ${linea(p.node.start)}, usada antes de declararse (en la ${linea(b.path.node.start)})`;
        if (!hallazgos.includes(msg)) hallazgos.push(msg);
      },
    },
  });
};

// Y su pariente: un nombre que no existe en ese lugar. También compila y
// revienta al ejecutar. Lo destapó la revisión del 03/11 en la nativa: un
// componente usaba `sesion`, que vive en otro componente, y `Grabar` pintaba
// el botón con `C.rojo` sin haber sacado `C` del tema —mantener apretado el
// micrófono tiraba «C is not defined»—. Lo que no está declarado tiene que
// ser de esta lista: lo que el entorno trae de fábrica.
const COMUNES = ['Array', 'Boolean', 'Date', 'Error', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number',
  'Object', 'Promise', 'Proxy', 'RangeError', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'TypeError', 'WeakMap',
  'WeakSet', 'AbortController', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'Uint32Array', 'ArrayBuffer',
  'arguments', 'undefined', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'fetch', 'globalThis', 'WebSocket', 'XMLHttpRequest', 'FormData', 'Blob', 'atob', 'btoa', 'structuredClone'];
const GLOBALES = {
  rn: new Set([...COMUNES, 'require', 'module', 'exports', 'process', '__DEV__', 'global', 'requestAnimationFrame',
    'cancelAnimationFrame']),
  navegador: new Set([...COMUNES, 'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'performance', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'MutationObserver',
    'IntersectionObserver', 'FileReader', 'Image', 'Audio', 'MediaRecorder', 'Notification', 'AudioContext',
    'webkitAudioContext', 'history', 'alert', 'confirm', 'getComputedStyle', 'CustomEvent', 'Event', 'crypto',
    // Las librerías que cargan los <script> de la página
    'React', 'ReactDOM', 'L', 'Babel']),
};
module.exports.sinDeclarar = function sinDeclarar(hallazgos, fuente, entorno) {
  const conocidos = GLOBALES[entorno];
  const linea = (pos) => fuente.slice(0, pos).split('\n').length;
  return () => ({
    visitor: {
      ReferencedIdentifier(p) {
        const n = p.node.name;
        if (p.scope.hasBinding(n, true) || conocidos.has(n)) return;
        // <div>, <span>: etiquetas, no variables
        if (p.isJSXIdentifier() && /^[a-z]/.test(n)) return;
        const msg = `«${n}» en la línea ${linea(p.node.start)} no está declarado en ningún lado`;
        // Babel recorre más de una vez: una línea por caso
        if (!hallazgos.includes(msg)) hallazgos.push(msg);
      },
    },
  });
};
