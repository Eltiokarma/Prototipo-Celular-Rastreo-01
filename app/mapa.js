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

// El HTML del WebView. Se arma UNA vez y después solo se le mandan datos por
// `postMessage`: recargar la página en cada estado —cada 3 segundos— tiraría
// el zoom y el desplazamiento que el chofer acaba de hacer con el dedo.
//
// EL FONDO ES OSCURO Y SIN DETALLE, a propósito. Un mapa de calles a todo
// color tiene cientos de nombres, íconos y manchas de parque compitiendo con
// lo único que el chofer necesita ver: tres puntos y una línea. Con el mapa
// claro había que buscarse; con éste, las combis son lo primero que salta.
// Sale del prototipo viejo, donde ya estaba resuelto así.
//
// La atribución SE MUESTRA. Es chiquita y se puede ignorar, pero tanto
// OpenStreetMap como CARTO la piden en sus condiciones de uso, y esto va a
// una app que se va a repartir.
const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const ATRIBUCION = '© OpenStreetMap · © CARTO';

function html(C) {
  const c = C || {};
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #m { margin:0; padding:0; height:100%; width:100%; background:${c.fondo || '#0A1A2E'}; }
  .u { border-radius:50%; box-shadow:0 0 10px rgba(0,0,0,.9); }
  /* La etiqueta es un tooltip de Leaflet y no un div al costado: así se
     acomoda sola arriba del punto y no se monta sobre el marcador cuando la
     combi se mueve. */
  .leaflet-tooltip.rot {
    background:${c.panel || '#16304A'}; color:${c.blanco || '#F5F9FF'};
    border:1px solid ${c.linea || '#234969'}; border-radius:6px;
    font:700 10px system-ui,sans-serif; letter-spacing:.5px;
    padding:1px 5px; white-space:nowrap; box-shadow:none;
  }
  .leaflet-tooltip.rot:before { display:none; }
  .leaflet-control-attribution {
    background:rgba(0,0,0,.45); color:${c.tenue || '#5A7A99'};
    font:400 9px system-ui,sans-serif; padding:1px 5px;
  }
  .leaflet-control-attribution a { color:${c.tenue || '#5A7A99'}; }
  /* De noche, todavía más apagado: el mapa es lo único que ocupa todo el
     vidrio, así que es lo que más encandila. */
  .oscuro .leaflet-tile-pane { filter: brightness(.55) contrast(1.05); }
</style>
</head><body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var mapa = L.map('m', { zoomControl: false })
              .setView([${JULIACA.lat}, ${JULIACA.lng}], ${ZOOM_INICIAL});
  L.tileLayer('${TILES}', { subdomains: 'abcd', maxZoom: 19,
                            attribution: '${ATRIBUCION}' }).addTo(mapa);
  mapa.attributionControl.setPrefix('');

  var capaLineas = L.layerGroup().addTo(mapa);
  var marcas = {};            // id -> marcador, para MOVERLOS y no redibujarlos
  var seguir = true;          // hasta que el chofer mueva el mapa con el dedo
  var dibujadas = false;

  mapa.on('dragstart', function () { seguir = false; avisar(); });
  function avisar() {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ seguir: seguir })); } catch (e) {}
  }

  var COLOR = { yo: '${c.blanco || '#F5F9FF'}', otra: '${c.brillante || '#2E9DFF'}',
                sinSenal: '${c.tenue || '#5A7A99'}' };
  var IDA = '${c.brillante || '#2E9DFF'}', VUELTA = '${c.ambar || '#F5C542'}';

  function icono(u) {
    var tam = u.tipo === 'yo' ? 16 : u.fija ? 14 : 10;
    var op = u.tipo === 'sinSenal' ? .4 : 1;
    // El mío lleva anillo en vez de otro color: en un mapa oscuro, "el punto
    // blanco con halo" se encuentra sin leer nada.
    var borde = u.tipo === 'yo'
      ? '3px solid ' + '${c.fondo || '#0A1A2E'}'
      : u.fija ? '2px solid #fff' : 'none';
    var halo = u.tipo === 'yo' ? ';box-shadow:0 0 0 2px ' + COLOR.yo + ',0 0 14px ' + COLOR.yo : '';
    return L.divIcon({ className: '', iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2],
      html: '<div class="u" style="width:' + tam + 'px;height:' + tam + 'px;opacity:' + op
          + ';background:' + COLOR[u.tipo] + ';border:' + borde + halo + '"></div>' });
  }

  function rotulo(u) {
    var pre = u.rol === 'adelante' ? '▲ ' : u.rol === 'atras' ? '▼ ' : '';
    return pre + u.etiqueta + (u.detalle ? ' · ' + u.detalle : '');
  }

  function pintar(v) {
    // IDA llena, VUELTA punteada, y de colores distintos. Una sola línea de
    // un solo color no dice para qué lado va ese trazo, que es justo lo que
    // hay que saber para entender dónde está la de adelante.
    if (!dibujadas && v.lineas && v.lineas.length) {
      var todas = [];
      v.lineas.forEach(function (t) {
        var vuelta = t.nombre === 'vuelta';
        var l = L.polyline(t.puntos, {
          color: vuelta ? VUELTA : IDA, weight: 3, opacity: .9,
          dashArray: vuelta ? '5,7' : null,
        }).addTo(capaLineas);
        todas.push(l);
      });
      dibujadas = true;       // el trazado no cambia: se dibuja una sola vez
      if (todas.length) {
        var b = todas[0].getBounds();
        for (var k = 1; k < todas.length; k++) b = b.extend(todas[k].getBounds());
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
        m.on('click', function () {
          try { window.ReactNativeWebView.postMessage(JSON.stringify({ tocada: u.id })); } catch (e) {}
        });
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

    var mio = (v.marcadores || []).filter(function (u) { return u.tipo === 'yo'; })[0];
    if (seguir && mio) mapa.setView([mio.lat, mio.lng], mapa.getZoom());
    else if (seguir && !dibujadas && v.centro) mapa.setView([v.centro.lat, v.centro.lng], mapa.getZoom());
  }

  function recibir(e) {
    try {
      var m = JSON.parse(e.data);
      if (m.tipo === 'vista') pintar(m.vista);
      if (m.tipo === 'centrar') { seguir = true; avisar(); pintar(m.vista); }
      if (m.tipo === 'tema') document.body.className = m.oscuro ? 'oscuro' : '';
    } catch (err) {}
  }
  document.addEventListener('message', recibir);   // Android
  window.addEventListener('message', recibir);     // iOS y web
  avisar();
})();
</script>
</body></html>`;
}

module.exports = { marcadores, lineas, centro, vista, html, escapar,
                   JULIACA, ZOOM_INICIAL, TILES, ATRIBUCION };
