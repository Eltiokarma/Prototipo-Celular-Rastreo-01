// Qué se dibuja en el mapa.
//
// El mapa en sí es un Leaflet adentro de un WebView, igual que los paneles
// web. Este archivo NO sabe nada de eso: convierte el estado que manda el
// servidor en una lista de cosas para dibujar, y es JavaScript puro para
// poder probarlo en Node.
//
// La decisión de fondo: Leaflet sobre OpenStreetMap en vez de
// `react-native-maps`. Ese último usa Google Maps y en Android **exige una
// clave de Google Cloud** —una cuenta, una tarjeta, una consola—. Leaflet no
// pide nada, usa las mismas tiles que los tres paneles web de este proyecto, y
// así la misma geografía se ve igual en el celular del chofer y en la pantalla
// de Despacho. Si algún día hace falta el mapa nativo, la puerta queda
// abierta: lo único que cambiaría es quién dibuja esta misma lista.

'use strict';

// Leaflet viaja ADENTRO del APK, no se baja de un CDN. La primera vez que un
// chofer abre el mapa es en la calle, con el celular recién instalado: si en
// ese momento unpkg no contesta —o no hay señal, que es lo normal— el mapa
// queda en blanco y sin decir por qué, porque `L` no existe y el script de
// abajo se corta en la primera línea. Son 158 kB en el bundle, una sola vez.
// Sale de server/vendor/leaflet/ por herramientas/vendor-leaflet.js.
const LEAFLET = require('./vendor/leaflet');

// Las barras de cierre van escapadas una sola vez, acá: Leaflet lleva
// etiquetas HTML adentro de sus textos (el "<span>+</span>" del botón de zoom)
// y sin escaparlas el parser del WebView cerraría la etiqueta <script> antes de
// tiempo, perdiendo media librería. Se hace al cargar el módulo y no dentro de
// `html()` para no repetir un reemplazo sobre 144 kB en cada llamada.
const LEAFLET_JS = LEAFLET.js.replace(/<\//g, '<\\/');

// Juliaca. Si no hay nada que mostrar, el mapa igual tiene que abrir en algún
// lado, y abrirlo en el Golfo de Guinea —que es lo que pasa con 0,0— hace
// creer que se rompió.
const JULIACA = { lat: -15.4904, lng: -70.1333 };
const ZOOM_INICIAL = 14;

// El texto viene del servidor, o sea de un nombre que cargó una persona. Un
// apellido con comilla o con `<` rompe la página entera del WebView, y en el
// celular eso es una pantalla en blanco sin ningún mensaje. No es paranoia:
// los nombres los tipea Despacho a mano.
function escapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const esCoord = (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 180;
const conCoords = (u) => u && esCoord(u.lat) && esCoord(u.lng);

// Los marcadores: el mío y los de los demás.
//
// `sinSenal` va como un tipo aparte y NO se oculta. Las dos salidas fáciles
// están mal:
//
//   - sacarla del mapa hace creer que la combi no está, y está: sigue en la
//     calle, con gente arriba;
//   - dibujarla igual que las demás hace creer que ese punto es de ahora, y
//     es de hace rato.
//
// Es el mismo error que ya costó caro en las brechas —"apurá" hacia una combi
// que estaba justo adelante pero callada— y acá se vería peor, porque un
// punto en un mapa se cree más que un número.
//
// Se filtra con `Array.isArray` y NO con `|| []`: el `||` solo tapa null y
// undefined, así que cualquier otra cosa —un string, un objeto— pasaba
// derecho y reventaba en el `.filter`. Y esto viene del cable.
function marcadores(estado, yo) {
  const mio = yo?.vehicleId || yo?.unitId || null;
  // Las dos que importan salen de la MISMA brecha que se muestra en el HUD,
  // así el mapa y el número grande nunca pueden contar cosas distintas.
  const g = (estado?.gaps || {})[mio] || {};
  const destacadas = new Set([mio, g.aheadUnit, g.behindUnit].filter(Boolean).map(String));

  return (Array.isArray(estado?.units) ? estado.units : [])
    .filter(conCoords)
    .map(u => ({
      id: String(u.unitId),
      lat: u.lat, lng: u.lng,
      tipo: u.unitId === mio ? 'yo' : u.sinSenal ? 'sinSenal' : 'otra',
      // Con veinte combis, veinte etiquetas permanentes tapan el mapa y no
      // dicen nada: al chofer le importan la de adelante y la de atrás, que
      // son las que le mueven la brecha. El resto se toca para verlas. Es la
      // misma tesis del HUD, dibujada.
      rol: String(u.unitId) === String(g.aheadUnit) ? 'adelante'
         : String(u.unitId) === String(g.behindUnit) ? 'atras'
         : null,
      fija: destacadas.has(String(u.unitId)),
      etiqueta: escapar(u.vehicleId || u.unitId),
      detalle: escapar(u.sinSenal ? 'sin señal' : (u.driverName || '')),
    }));
}

// El trazado de la ruta. Llega como {ida: [...], vuelta: [...]} y sale como
// pares [lat, lng], que es lo que come Leaflet.
function lineas(geometria) {
  const t = geometria?.tramos;
  const tramos = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
  return Object.entries(tramos)
    .map(([nombre, puntos]) => ({
      nombre,
      puntos: (Array.isArray(puntos) ? puntos : [])
        .map(p => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p))
        .filter(conCoords)
        .map(p => [p.lat, p.lng]),
    }))
    .filter(t => t.puntos.length >= 2);
}

// Dónde centrar. Mi posición primero: el chofer se busca a sí mismo. Después
// el trazado, y si no hay nada, Juliaca.
function centro(estado, yo, geometria) {
  const mio = marcadores(estado, yo).find(m => m.tipo === 'yo');
  if (mio) return { lat: mio.lat, lng: mio.lng };

  const puntos = lineas(geometria).flatMap(t => t.puntos);
  if (puntos.length) {
    const lat = puntos.reduce((a, p) => a + p[0], 0) / puntos.length;
    const lng = puntos.reduce((a, p) => a + p[1], 0) / puntos.length;
    return { lat, lng };
  }
  return { ...JULIACA };
}

// Todo junto, que es lo que se le manda al WebView en cada estado.
function vista(estado, yo, geometria) {
  return {
    marcadores: marcadores(estado, yo),
    lineas: lineas(geometria),
    centro: centro(estado, yo, geometria),
  };
}

// El HTML del WebView.
//
// SE ARMA UNA SOLA VEZ Y NO DEPENDE DEL TEMA. Los colores entran después, por
// mensaje, y se aplican con variables CSS. Antes la página se armaba con la
// paleta del momento, así que al pasar a modo noche —a las 18:30, en plena
// vuelta— el `source` del WebView cambiaba y **el mapa se recargaba entero**:
// se perdían el zoom y el desplazamiento que el chofer tenía puestos, y había
// que esperar a que bajaran las tiles de nuevo. Un cambio de color no puede
// costar eso.
//
// Además, el estado que se le manda antes de que la página termine de cargar
// SE PIERDE —no hay nadie escuchando todavía—, así que la página avisa cuando
// está lista y recién ahí se le manda todo. Sin ese saludo, el mapa arrancaba
// con los colores de día aunque fuera de noche, hasta que algo lo cambiara.
//
// EL FONDO ES OSCURO Y SIN DETALLE, a propósito. Un mapa de calles a todo
// color tiene cientos de nombres, íconos y manchas de parque compitiendo con
// lo único que el chofer necesita ver: tres puntos y una línea. Con el mapa
// claro había que buscarse; con éste, las combis son lo primero que salta.
// Sale del prototipo viejo, donde ya estaba resuelto así.
//
// La atribución SE MUESTRA. Es chiquita y se puede ignorar, pero OpenStreetMap
// la exige en su licencia (ODbL) y Geoapify la pide en su plan gratuito, y
// esto va a una app que se va a repartir.
//
// El proveedor es Geoapify y NO CARTO, porque el CDN de CARTO es solo para
// clientes enterprise y proyectos sin fines de lucro — una cooperativa que
// cobra pasaje es uso comercial. `dark-matter` es el mismo diseño que el
// dark_all de antes: el mapa se ve igual.
//
// La URL de acá abajo NO lleva clave, a propósito: la página se arma una sola
// vez y la clave vive en el servidor (variable de entorno GEOAPIFY_API_KEY),
// llega con el login y entra por mensaje, como los colores. Compilarla en el
// APK obligaría a repartir una app nueva a toda la flota para rotarla.
const TILES = 'https://maps.geoapify.com/v1/tile/dark-matter/{z}/{x}/{y}.png';
const ATRIBUCION = 'Geoapify · © OpenMapTiles · © OpenStreetMap contributors';

// Al centrarse, el chofer quiere VERSE, no ver la ruta entera. Si estaba lejos
// con el mapa desplegado, dejarlo en ese zoom es como no haber centrado.
const ZOOM_SEGUIMIENTO = 16;

// Los colores que la página necesita saber. Se mandan por mensaje; acá solo
// están los de arranque, para que nunca dibuje con `undefined`.
function coloresDe(C) {
  const c = C || {};
  return {
    fondo: c.fondo || '#0A1A2E',
    panel: c.panel || '#16304A',
    linea: c.linea || '#234969',
    blanco: c.blanco || '#F5F9FF',
    tenue: c.tenue || '#5A7A99',
    yo: c.blanco || '#F5F9FF',
    otra: c.brillante || '#2E9DFF',
    sinSenal: c.tenue || '#5A7A99',
    ida: c.brillante || '#2E9DFF',
    vuelta: c.ambar || '#F5C542',
  };
}

function html() {
  const d = coloresDe(null);
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${LEAFLET.css}</style>
<style>
  :root {
    --fondo:${d.fondo}; --panel:${d.panel}; --linea:${d.linea};
    --blanco:${d.blanco}; --tenue:${d.tenue};
  }
  html, body, #m { margin:0; padding:0; height:100%; width:100%; background:var(--fondo); }
  .u { border-radius:50%; box-shadow:0 0 10px rgba(0,0,0,.9); }
  /* La etiqueta es un tooltip de Leaflet y no un div al costado: así se
     acomoda sola arriba del punto y no se monta sobre el marcador cuando la
     combi se mueve. */
  .leaflet-tooltip.rot {
    background:var(--panel); color:var(--blanco); border:1px solid var(--linea);
    border-radius:6px; font:700 10px system-ui,sans-serif; letter-spacing:.5px;
    padding:1px 5px; white-space:nowrap; box-shadow:none;
  }
  .leaflet-tooltip.rot:before { display:none; }
  .leaflet-control-attribution {
    background:rgba(0,0,0,.45); color:var(--tenue);
    font:400 9px system-ui,sans-serif; padding:1px 5px;
  }
  .leaflet-control-attribution a { color:var(--tenue); }
  /* De noche, todavía más apagado: el mapa es lo único que ocupa todo el
     vidrio, así que es lo que más encandila. */
  .oscuro .leaflet-tile-pane { filter: brightness(.5) contrast(1.05) sepia(.25); }
</style>
</head><body>
<div id="m"></div>
<!-- Leaflet entero, acá adentro y no en un CDN -->
<script>${LEAFLET_JS}</script>
<script>
(function () {
  var mapa = L.map('m', { zoomControl: false })
              .setView([${JULIACA.lat}, ${JULIACA.lng}], ${ZOOM_INICIAL});

  // LA CASCADA DE TILES, igual que en la app web: (1) el caché HTTP del
  // WebView, transparente; (2) el mapa PROPIO del servidor, dentro de las
  // zonas extraídas; (3) el proveedor con clave, solo fuera de zona o si el
  // propio falla. Zonas, servidor y clave llegan por mensaje con el login.
  var zonasPropias = {};
  var origenPropio = '';
  var statsTiles = { propias: 0, proveedor: 0, rescatadas: 0 };
  function zonaDeTile(coords) {
    var n = Math.pow(2, coords.z);
    var lon = (coords.x + 0.5) / n * 360 - 180;
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (coords.y + 0.5) / n))) * 180 / Math.PI;
    for (var id in zonasPropias) {
      var zo = zonasPropias[id];
      if (coords.z >= zo.zooms[0] && coords.z <= zo.zooms[1] &&
          lon >= zo.bbox[0] && lon <= zo.bbox[2] &&
          lat >= zo.bbox[1] && lat <= zo.bbox[3]) return id;
    }
    return null;
  }
  var CapaCascada = L.TileLayer.extend({
    getTileUrl: function (coords) {
      var zona = zonaDeTile(coords);
      if (!zona || !origenPropio) return L.TileLayer.prototype.getTileUrl.call(this, coords);
      // El mapa del chofer es oscuro siempre — es su rasgo de diseño.
      // La versión va en la URL: el WebView cachea las tiles igual que el
      // navegador, y sin versión un mapa renovado no le llegaría nunca al
      // chofer que ya tiene guardado el viejo. Si el servidor todavía no
      // declara versiones, la URL sale como salía y todo sigue andando.
      var zo = zonasPropias[zona] || {};
      var v = (zo.versiones || {}).oscuro;
      return origenPropio + '/tiles/xyz/' + zona + '/oscuro' + (v ? '/v' + v : '') +
             '/' + coords.z + '/' + coords.x + '/' + coords.y + '.png';
    },
    createTile: function (coords, listo) {
      var capa = this;
      var tile = L.TileLayer.prototype.createTile.call(this, coords, listo);
      if (zonaDeTile(coords) && origenPropio) {
        statsTiles.propias++;
        var socorro = L.TileLayer.prototype.getTileUrl.call(capa, coords);
        var errorOriginal = tile.onerror;
        tile.onerror = function (e) {
          if (tile.src === socorro) return errorOriginal && errorOriginal.call(this, e);
          statsTiles.rescatadas++;
          tile.src = socorro;
        };
      } else {
        statsTiles.proveedor++;
      }
      // El reporte sube a la app cada 25 tiles: es la evidencia de que el
      // proveedor es la excepción y no la ruta normal.
      var total = statsTiles.propias + statsTiles.proveedor;
      if (total > 0 && total % 25 === 0) avisar({ estadisticaTiles: statsTiles });
      return tile;
    },
  });
  // Sin clave todavía: hasta que llegue por mensaje, las tiles no cargan y el
  // fondo queda del color del tema — los puntos y el trazado se dibujan igual.
  var capaTiles = new CapaCascada('${TILES}', { maxZoom: 19,
                            attribution: '${ATRIBUCION}' }).addTo(mapa);
  mapa.attributionControl.setPrefix('');

  var capaLineas = L.layerGroup().addTo(mapa);
  var marcas = {};            // id -> marcador, para MOVERLOS y no redibujarlos
  var lineas = [];            // las polilíneas, para poder recolorearlas
  var seguir = true;          // hasta que el chofer mueva el mapa con el dedo
  var dibujadas = false;
  var ultima = null;          // la última vista, para repintar al cambiar el tema
  var C = ${JSON.stringify(d)};

  mapa.on('dragstart', function () { seguir = false; avisar({ seguir: false }); });
  function avisar(obj) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  }

  function icono(u) {
    var tam = u.tipo === 'yo' ? 16 : u.fija ? 14 : 10;
    var op = u.tipo === 'sinSenal' ? .4 : 1;
    // El mío lleva anillo en vez de otro color: en un mapa oscuro, "el punto
    // con halo" se encuentra sin leer nada.
    var borde = u.tipo === 'yo' ? '3px solid ' + C.fondo : u.fija ? '2px solid #fff' : 'none';
    var halo = u.tipo === 'yo' ? ';box-shadow:0 0 0 2px ' + C.yo + ',0 0 14px ' + C.yo : '';
    return L.divIcon({ className: '', iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2],
      html: '<div class="u" style="width:' + tam + 'px;height:' + tam + 'px;opacity:' + op
          + ';background:' + C[u.tipo] + ';border:' + borde + halo + '"></div>' });
  }

  function rotulo(u) {
    var pre = u.rol === 'adelante' ? '▲ ' : u.rol === 'atras' ? '▼ ' : '';
    return pre + u.etiqueta + (u.detalle ? ' · ' + u.detalle : '');
  }

  function pintar(v) {
    if (!v) return;
    ultima = v;

    // IDA llena, VUELTA punteada, y de colores distintos. Una sola línea de
    // un solo color no dice para qué lado va ese trazo, que es justo lo que
    // hay que saber para entender dónde está la de adelante.
    if (!dibujadas && v.lineas && v.lineas.length) {
      v.lineas.forEach(function (t) {
        var vuelta = t.nombre === 'vuelta';
        lineas.push(L.polyline(t.puntos, {
          color: vuelta ? C.vuelta : C.ida, weight: 3, opacity: .9,
          dashArray: vuelta ? '5,7' : null,
        }).addTo(capaLineas));
      });
      dibujadas = true;       // el trazado no cambia: se dibuja una sola vez
      if (lineas.length) {
        var b = lineas[0].getBounds();
        for (var k = 1; k < lineas.length; k++) b = b.extend(lineas[k].getBounds());
        mapa.fitBounds(b, { padding: [36, 36] });
      }
    }

    // Los marcadores SE MUEVEN, no se rehacen. Borrar y recrear veinte
    // marcadores cada 3 s hace parpadear el mapa y tira las etiquetas justo
    // cuando el chofer las está leyendo.
    var vistos = {};
    (v.marcadores || []).forEach(function (u) {
      vistos[u.id] = true;
      var m = marcas[u.id];
      if (!m) {
        m = L.marker([u.lat, u.lng], { icon: icono(u) }).addTo(mapa);
        marcas[u.id] = m;
      } else {
        m.setLatLng([u.lat, u.lng]);
        m.setIcon(icono(u));
      }
      // Etiqueta fija solo para las que importan; el resto, al tocarlas.
      if (m.getTooltip()) m.unbindTooltip();
      m.bindTooltip(rotulo(u), {
        permanent: !!u.fija, direction: 'top', offset: [0, -8], className: 'rot',
      });
    });
    Object.keys(marcas).forEach(function (id) {
      if (!vistos[id]) { mapa.removeLayer(marcas[id]); delete marcas[id]; }
    });

    if (seguir) mapa.setView(aDonde(v), mapa.getZoom(), { animate: false });
  }

  // Dónde está "yo", o el centro que mandó la app, o donde ya estaba. Siempre
  // devuelve algo: centrar no puede fallar en silencio.
  function aDonde(v) {
    var mio = ((v && v.marcadores) || []).filter(function (u) { return u.tipo === 'yo'; })[0];
    if (mio) return [mio.lat, mio.lng];
    if (v && v.centro) return [v.centro.lat, v.centro.lng];
    return mapa.getCenter();
  }

  function tema(m) {
    if (m.colores) {
      C = m.colores;
      var r = document.documentElement.style;
      r.setProperty('--fondo', C.fondo); r.setProperty('--panel', C.panel);
      r.setProperty('--linea', C.linea); r.setProperty('--blanco', C.blanco);
      r.setProperty('--tenue', C.tenue);
      lineas.forEach(function (l, i) {
        l.setStyle({ color: l.options.dashArray ? C.vuelta : C.ida });
      });
      if (ultima) {           // los marcadores llevan el color adentro del HTML
        (ultima.marcadores || []).forEach(function (u) {
          if (marcas[u.id]) marcas[u.id].setIcon(icono(u));
        });
      }
    }
    document.body.className = m.oscuro ? 'oscuro' : '';
  }

  function recibir(e) {
    try {
      var m = JSON.parse(e.data);
      if (m.tipo === 'tema') tema(m);
      if (m.tipo === 'vista') pintar(m.vista);
      // La clave, las zonas propias y el servidor, del login. setUrl repinta
      // la capa entera y las tiles que ya estaban en el caché HTTP del
      // WebView no se vuelven a bajar.
      if (m.tipo === 'tiles' && m.clave) {
        if (m.zonas) zonasPropias = m.zonas;
        if (m.servidor) origenPropio = String(m.servidor).replace(/\\/$/, '');
        capaTiles.setUrl('${TILES}?apiKey=' + encodeURIComponent(m.clave));
      }
      if (m.tipo === 'centrar') {
        // Centrar es una ORDEN, no una sugerencia: no depende de que haya
        // llegado un estado nuevo ni de si el trazado ya se dibujo. Antes
        // caia en una rama que quedaba muerta despues del primer dibujo, y
        // el boton no hacia nada.
        seguir = true;
        avisar({ seguir: true });
        if (m.vista) pintar(m.vista);
        mapa.setView(aDonde(m.vista || ultima), ${ZOOM_SEGUIMIENTO}, { animate: true });
      }
    } catch (err) {}
  }
  document.addEventListener('message', recibir);   // Android
  window.addEventListener('message', recibir);     // iOS y web

  // El saludo. Hasta que esto no sale, cualquier cosa que le manden se pierde
  // en el vacío: todavía no hay nadie escuchando.
  avisar({ listo: true, seguir: true });
})();
</script>
</body></html>`;
}

module.exports = { marcadores, lineas, centro, vista, html, escapar, coloresDe,
                   JULIACA, ZOOM_INICIAL, ZOOM_SEGUIMIENTO, TILES, ATRIBUCION };
