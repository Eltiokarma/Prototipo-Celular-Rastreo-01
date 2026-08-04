// La lógica del trazador de recorridos — sin mapa, sin React, sin DOM.
//
// El trazador del panel del creador necesita más herramientas que "tocar
// agrega un punto al final": insertar en el medio de una curva, seleccionar
// una cuadra entre dos puntos y borrarla, deshacer. Todo eso es geometría y
// listas — nada de eso necesita un navegador para existir ni para probarse.
//
// Por eso vive acá, como archivo aparte: Node lo carga con require() y lo
// prueba (pruebas/trazador.js), y el panel del creador lo carga con un
// <script> que sirve el propio panel. El mismo archivo, sin copia.
//
// El trazador de Despacho (despacho.html) tiene su propia copia inline de
// simplificar() y leerRecorrido(): se queda así mientras tanto, porque ese
// trazador entero está en retirada — las rutas las carga el nivel de arriba
// (PENDIENTES 2bis) y Despacho a lo sumo corrige.
//
// CONVENCIONES. Un punto es [lat, lng] — igual que en el trazador de
// Despacho y que lo que come Leaflet. Ninguna operación toca la lista que
// recibe: todas devuelven una lista nueva, porque el historial de deshacer
// guarda referencias a los estados anteriores y una mutación los pudriría
// a todos a la vez.

(function () {
  'use strict';

  // Un grado de latitud son ~111 km en cualquier parte; uno de longitud se
  // achica con el coseno de la latitud. Para distancias de cuadras esta
  // aproximación plana le erra por menos de lo que le erra el GPS.
  const METROS_POR_GRADO = 111320;

  function metrosEntre(a, b) {
    const kLng = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
    return Math.hypot((b[0] - a[0]) * METROS_POR_GRADO, (b[1] - a[1]) * METROS_POR_GRADO * kLng);
  }

  function largoDe(puntos) {
    let m = 0;
    for (let i = 1; i < puntos.length; i++) m += metrosEntre(puntos[i - 1], puntos[i]);
    return m;
  }

  // Cuántos metros mide un pixel del mapa en este zoom y esta latitud. El
  // umbral de "hiciste clic SOBRE la línea" tiene que ser en pixeles —lo que
  // el dedo ve— pero la geometría se calcula en metros: esto convierte.
  function metrosPorPixel(lat, zoom) {
    return 40075016.686 * Math.abs(Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
  }

  // Distancia de un punto a un SEGMENTO (no a la recta infinita): más allá
  // de los extremos manda la distancia al extremo, que es lo que se siente
  // al hacer clic cerca de la punta de una línea.
  function distAlSegmentoM(p, a, b) {
    const kLng = Math.cos(a[0] * Math.PI / 180);
    const px = (p[1] - a[1]) * METROS_POR_GRADO * kLng, py = (p[0] - a[0]) * METROS_POR_GRADO;
    const bx = (b[1] - a[1]) * METROS_POR_GRADO * kLng, by = (b[0] - a[0]) * METROS_POR_GRADO;
    const largo2 = bx * bx + by * by;
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largo2));
    return Math.hypot(px - t * bx, py - t * by);
  }

  // El segmento más cercano a un punto: { i, distM } donde el segmento va de
  // puntos[i] a puntos[i+1]. Con menos de dos puntos no hay segmentos: null.
  function segmentoMasCercano(puntos, p) {
    if (!puntos || puntos.length < 2) return null;
    let mejor = null;
    for (let i = 0; i < puntos.length - 1; i++) {
      const d = distAlSegmentoM(p, puntos[i], puntos[i + 1]);
      if (!mejor || d < mejor.distM) mejor = { i, distM: d };
    }
    return mejor;
  }

  // La decisión de cada clic en modo dibujo: si cayó ENCIMA de la línea
  // (más cerca que el umbral), es un "insertar acá en el medio" — es lo que
  // densifica una curva sin rehacer desde ahí. Si cayó lejos, es el gesto de
  // siempre: un punto más al final.
  function dondeVa(puntos, p, umbralM) {
    const cerca = segmentoMasCercano(puntos, p);
    if (cerca && cerca.distM <= umbralM) return { accion: 'insertar', i: cerca.i };
    return { accion: 'agregar' };
  }

  function agregar(puntos, p) {
    return [...puntos, p];
  }

  // Inserta p ADENTRO del segmento [i, i+1] — o sea en la posición i+1.
  function insertar(puntos, i, p) {
    return [...puntos.slice(0, i + 1), p, ...puntos.slice(i + 1)];
  }

  function mover(puntos, i, p) {
    return puntos.map((q, j) => (j === i ? p : q));
  }

  function borrar(puntos, i) {
    return puntos.filter((_, j) => j !== i);
  }

  // Borra lo que hay ENTRE dos puntos, sin tocar los dos elegidos: es la
  // herramienta de "esta cuadra quedó mal". Los extremos se quedan a
  // propósito — el hueco queda unido por una recta, y esa recta se rellena
  // haciendo clic encima (dondeVa la ve como segmento y va insertando).
  // El orden no importa: seleccionar de atrás para adelante es lo mismo.
  function borrarEntre(puntos, i, j) {
    const [a, b] = i < j ? [i, j] : [j, i];
    return puntos.filter((_, k) => k <= a || k >= b);
  }

  // Douglas-Peucker: saca los puntos que no cambian la forma del trazado.
  // Un GPX de una vuelta trae miles de puntos y no hacen falta: con
  // tolerancia de ~10 m el recorrido queda igual con una fracción.
  function simplificar(puntos, toleranciaM = 10) {
    if (puntos.length < 3) return puntos;
    const conservar = new Array(puntos.length).fill(false);
    conservar[0] = conservar[puntos.length - 1] = true;
    const pila = [[0, puntos.length - 1]];
    while (pila.length) {
      const [ini, fin] = pila.pop();
      let peor = 0, idx = -1;
      for (let i = ini + 1; i < fin; i++) {
        const d = distAlSegmentoM(puntos[i], puntos[ini], puntos[fin]);
        if (d > peor) { peor = d; idx = i; }
      }
      if (idx !== -1 && peor > toleranciaM) {
        conservar[idx] = true;
        pila.push([ini, idx], [idx, fin]);
      }
    }
    return puntos.filter((_, i) => conservar[i]);
  }

  // GPX (<trkpt lat lon>) y GeoJSON (LineString): lo que exporta cualquier
  // app de grabar recorridos. Regex y no un parser XML a propósito — así el
  // mismo código corre en Node (sin DOM) y en el navegador.
  function leerRecorrido(texto) {
    const t = String(texto).trim();
    if (t.startsWith('{')) {
      const j = JSON.parse(t);
      const busca = (o) => {
        if (!o || typeof o !== 'object') return null;
        if (o.type === 'LineString' && Array.isArray(o.coordinates)) {
          return o.coordinates.map(c => [Number(c[1]), Number(c[0])]);  // GeoJSON va [lng, lat]
        }
        for (const v of Object.values(o)) {
          const r = Array.isArray(v) ? v.map(busca).find(Boolean) : busca(v);
          if (r) return r;
        }
        return null;
      };
      const p = busca(j);
      if (!p) throw new Error('El GeoJSON no tiene un LineString');
      return p;
    }
    const puntos = [];
    const re = /<(?:trkpt|rtept|wpt)\s[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/gi;
    let m;
    while ((m = re.exec(t))) puntos.push([Number(m[1]), Number(m[2])]);
    if (!puntos.length) throw new Error('No se encontraron puntos en el archivo');
    return puntos;
  }

  // El historial de deshacer. Guarda ESTADOS ENTEROS ({ ida, vuelta }) y no
  // operaciones inversas: con listas de cientos de puntos la copia es barata,
  // y un snapshot no puede quedar desincronizado como sí puede una inversa
  // mal calculada. Se copia en profundidad al guardar — el que llama sigue
  // mutando su estado y el historial no tiene por qué enterarse.
  function crearHistorial(tope = 60) {
    const pila = [];
    const copia = (tramos) => ({
      ida: tramos.ida.map(p => [p[0], p[1]]),
      vuelta: tramos.vuelta.map(p => [p[0], p[1]]),
    });
    return {
      guardar(tramos) {
        pila.push(copia(tramos));
        if (pila.length > tope) pila.shift();
      },
      deshacer() {
        return pila.length ? pila.pop() : null;
      },
      hay() { return pila.length > 0; },
      largo() { return pila.length; },
    };
  }

  const Trazador = {
    METROS_POR_GRADO,
    metrosEntre, largoDe, metrosPorPixel, distAlSegmentoM,
    segmentoMasCercano, dondeVa,
    agregar, insertar, mover, borrar, borrarEntre,
    simplificar, leerRecorrido, crearHistorial,
  };

  // El mismo archivo sirve a los dos mundos: require() en Node (las pruebas)
  // y window.Trazador en el panel del creador.
  if (typeof module !== 'undefined' && module.exports) module.exports = Trazador;
  if (typeof window !== 'undefined') window.Trazador = Trazador;
})();
