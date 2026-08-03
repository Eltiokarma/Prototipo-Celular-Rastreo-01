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
  return (Array.isArray(estado?.units) ? estado.units : [])
    .filter(conCoords)
    .map(u => ({
      id: String(u.unitId),
      lat: u.lat, lng: u.lng,
      tipo: u.unitId === mio ? 'yo' : u.sinSenal ? 'sinSenal' : 'otra',
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
function html(C) {
  const c = C || {};
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #m { margin:0; padding:0; height:100%; width:100%; background:${c.fondo || '#0A1A2E'}; }
  .u { border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 2px rgba(0,0,0,.4); }
  .rot { font:700 11px system-ui,sans-serif; color:#fff; text-shadow:0 1px 3px #000;
         white-space:nowrap; transform:translate(14px,-9px); }
  /* De noche el mapa entero se apaga: un mapa blanco a las diez de la noche
     encandila más que cualquier otra pantalla de la app, porque es lo único
     que ocupa todo el vidrio. */
  .oscuro .leaflet-tile-pane { filter: brightness(.45) saturate(.5) contrast(1.1); }
  .leaflet-control-attribution { display:none; }
</style>
</head><body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var mapa = L.map('m', { zoomControl: false, attributionControl: false })
              .setView([${JULIACA.lat}, ${JULIACA.lng}], ${ZOOM_INICIAL});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);

  var capaLineas = L.layerGroup().addTo(mapa);
  var capaUnidades = L.layerGroup().addTo(mapa);
  var seguir = true;          // hasta que el chofer mueva el mapa con el dedo
  var dibujadas = false;

  mapa.on('dragstart', function () { seguir = false; avisar(); });
  function avisar() {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ seguir: seguir })); } catch (e) {}
  }

  var COLOR = { yo: '${c.brillante || '#2E9DFF'}', otra: '${c.cielo || '#71BCFF'}',
                sinSenal: '${c.tenue || '#5A7A99'}' };

  function pintar(v) {
    if (!dibujadas && v.lineas && v.lineas.length) {
      capaLineas.clearLayers();
      v.lineas.forEach(function (t) {
        L.polyline(t.puntos, { color: '${c.marca || '#2580CF'}', weight: 4, opacity: .75 })
         .addTo(capaLineas);
      });
      dibujadas = true;       // el trazado no cambia: se dibuja una sola vez
    }

    capaUnidades.clearLayers();
    (v.marcadores || []).forEach(function (u) {
      var tam = u.tipo === 'yo' ? 18 : 14;
      var op = u.tipo === 'sinSenal' ? .45 : 1;
      L.marker([u.lat, u.lng], { icon: L.divIcon({
        className: '', iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2],
        html: '<div class="u" style="width:' + tam + 'px;height:' + tam + 'px;opacity:' + op
            + ';background:' + COLOR[u.tipo] + '"></div>'
            + '<div class="rot" style="opacity:' + op + '">' + u.etiqueta
            + (u.detalle ? ' · ' + u.detalle : '') + '</div>',
      }) }).addTo(capaUnidades);
    });

    var mio = (v.marcadores || []).filter(function (u) { return u.tipo === 'yo'; })[0];
    if (seguir && mio) mapa.setView([mio.lat, mio.lng], mapa.getZoom());
    else if (seguir && v.centro) mapa.setView([v.centro.lat, v.centro.lng], mapa.getZoom());
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

module.exports = { marcadores, lineas, centro, vista, html, escapar, JULIACA, ZOOM_INICIAL };
