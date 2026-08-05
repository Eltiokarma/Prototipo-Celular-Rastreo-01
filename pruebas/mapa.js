// Qué se dibuja en el mapa del chofer (`app/mapa.js`).
//
// El mapa es un Leaflet adentro de un WebView, pero lo que se prueba acá no
// es el dibujo: es la lista de cosas para dibujar, que es JS puro. Un punto
// en un mapa se cree MÁS que un número, así que un error acá es más caro que
// el mismo error en el HUD.
const RAIZ = require('path').join(__dirname, '..');
const { marcadores, lineas, centro, vista, html, escapar, coloresDe,
        JULIACA, TILES, ZOOM_SEGUIMIENTO } = require(RAIZ + '/app/mapa.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const YO = { unitId: 'M-12', vehicleId: 'M-12' };
const u = (o) => ({ lat: -15.49, lng: -70.13, driverName: 'Alguien', ...o });

console.log('\nQUIÉN ES QUIÉN');
{
  const ms = marcadores({ units: [
    u({ unitId: 'M-12', vehicleId: 'M-12', driverName: 'Elmer Ccama' }),
    u({ unitId: 'M-08', vehicleId: 'M-08', driverName: 'Rufino Quispe' }),
  ] }, YO);
  ok('el mío se marca como mío', ms.find(m => m.id === 'M-12')?.tipo === 'yo', ms);
  ok('el de otro, como otro', ms.find(m => m.id === 'M-08')?.tipo === 'otra');
  ok('cada uno lleva su unidad como rótulo',
     ms.find(m => m.id === 'M-08')?.etiqueta === 'M-08');
}

console.log('\nLA QUE PERDIÓ SEÑAL SE VE, PERO NO SE VE IGUAL');
{
  // Las dos salidas fáciles están mal: sacarla del mapa hace creer que la
  // combi no está —y está, con gente arriba—; dibujarla igual que las demás
  // hace creer que ese punto es de ahora, y es de hace rato. Es el mismo
  // error que ya costó caro en las brechas, y en un mapa se ve peor.
  const ms = marcadores({ units: [
    u({ unitId: 'M-12', vehicleId: 'M-12' }),
    u({ unitId: 'M-08', vehicleId: 'M-08', sinSenal: true, driverName: 'Rufino' }),
  ] }, YO);
  ok('sigue estando en el mapa', ms.length === 2, ms.length);
  ok('pero con su propio tipo', ms.find(m => m.id === 'M-08')?.tipo === 'sinSenal');
  ok('y lo dice con todas las letras',
     /sin señal/.test(ms.find(m => m.id === 'M-08')?.detalle || ''),
     ms.find(m => m.id === 'M-08')?.detalle);
  ok('el nombre del chofer NO tapa el aviso',
     ms.find(m => m.id === 'M-08')?.detalle === 'sin señal');
}

console.log('\nSOLO SE ROTULAN LAS QUE IMPORTAN');
{
  // Con veinte combis, veinte etiquetas permanentes tapan el mapa y no dicen
  // nada. Al chofer le importan la de adelante y la de atrás: son las que le
  // mueven la brecha. Es la misma tesis del HUD, dibujada.
  const estado = {
    units: [
      u({ unitId: 'M-12', vehicleId: 'M-12' }),          // yo
      u({ unitId: 'M-08', vehicleId: 'M-08' }),          // adelante
      u({ unitId: 'M-20', vehicleId: 'M-20' }),          // atrás
      u({ unitId: 'M-31', vehicleId: 'M-31' }),          // una cualquiera
      u({ unitId: 'M-44', vehicleId: 'M-44' }),          // otra
    ],
    gaps: { 'M-12': { aheadUnit: 'M-08', behindUnit: 'M-20', toAhead: 90, toBehind: 150 } },
  };
  const ms = marcadores(estado, YO);
  const fijas = ms.filter(m => m.fija).map(m => m.id).sort();
  ok('se rotulan yo, la de adelante y la de atrás',
     fijas.join(',') === 'M-08,M-12,M-20', fijas);
  ok('y las demás no', ms.filter(m => !m.fija).length === 2, ms.filter(m => !m.fija).map(m => m.id));

  ok('la de adelante sabe que es la de adelante',
     ms.find(m => m.id === 'M-08')?.rol === 'adelante');
  ok('y la de atrás también', ms.find(m => m.id === 'M-20')?.rol === 'atras');
  ok('las demás no tienen rol', ms.find(m => m.id === 'M-31')?.rol === null);

  // El mapa y el número grande salen de la MISMA brecha: si se separaran,
  // el chofer vería un "apurá" contra una combi que el mapa no destaca.
  ok('sale de gaps, que es de donde sale el HUD',
     marcadores({ units: estado.units }, YO).filter(m => m.fija).length === 1);
}

console.log('\nSIN COORDENADAS NO HAY PUNTO');
{
  // Una unidad recién conectada todavía no reportó posición. Dibujarla en
  // 0,0 la manda al Golfo de Guinea, y en el mapa de una ruta de Juliaca eso
  // no se ve como un error: se ve como que desapareció.
  const ms = marcadores({ units: [
    u({ unitId: 'M-12', vehicleId: 'M-12' }),
    { unitId: 'M-99', lat: null, lng: null },
    { unitId: 'M-98' },
    { unitId: 'M-97', lat: 'no', lng: 'va' },
    { unitId: 'M-96', lat: NaN, lng: -70 },
  ] }, YO);
  ok('solo entran las que tienen posición', ms.length === 1, ms.map(m => m.id));
}

console.log('\nUN APELLIDO NO PUEDE ROMPER LA PANTALLA');
{
  // Los nombres los tipea Despacho a mano. Uno con comilla o con `<` rompe
  // la página entera del WebView, y en el celular eso es una pantalla en
  // blanco sin ningún mensaje.
  const ms = marcadores({ units: [
    u({ unitId: 'M-08', vehicleId: '<script>alert(1)</script>', driverName: `O'Higgins "el rápido"` }),
  ] }, YO);
  ok('el rótulo sale escapado', !/<script>/.test(ms[0].etiqueta), ms[0].etiqueta);
  ok('y el detalle también', !/"/.test(ms[0].detalle) && !/'/.test(ms[0].detalle), ms[0].detalle);
  ok('escapar cubre los cinco', escapar(`<&>"'`) === '&lt;&amp;&gt;&quot;&#39;', escapar(`<&>"'`));
  ok('y no revienta con nada', escapar(null) === '' && escapar(undefined) === '');
}

console.log('\nEL TRAZADO');
{
  const geo = { tramos: {
    ida: [[-15.49, -70.13], [-15.48, -70.12], [-15.47, -70.11]],
    vuelta: [{ lat: -15.47, lng: -70.11 }, { lat: -15.49, lng: -70.13 }],
  } };
  const ls = lineas(geo);
  ok('salen los dos tramos', ls.length === 2, ls.map(t => t.nombre));
  ok('los pares llegan como [lat, lng]',
     JSON.stringify(ls[0].puntos[0]) === '[-15.49,-70.13]', ls[0].puntos[0]);
  ok('y los objetos {lat,lng} también',
     JSON.stringify(ls[1].puntos[0]) === '[-15.47,-70.11]', ls[1].puntos[0]);

  // Un tramo de un solo punto no es una línea: Leaflet dibuja nada y queda
  // un hueco silencioso.
  const flaco = lineas({ tramos: { ida: [[-15.49, -70.13]], vuelta: [] } });
  ok('un tramo de menos de dos puntos no se dibuja', flaco.length === 0, flaco);

  const sucio = lineas({ tramos: { ida: [[-15.49, -70.13], [null, null], [-15.47, -70.11]] } });
  ok('los puntos rotos se descartan sin tirar el tramo',
     sucio[0]?.puntos.length === 2, sucio[0]?.puntos);
}

console.log('\nDÓNDE ABRE EL MAPA');
{
  const geo = { tramos: { ida: [[-15.50, -70.14], [-15.48, -70.12]] } };

  // El chofer se busca a sí mismo primero.
  const conmigo = centro({ units: [u({ unitId: 'M-12', vehicleId: 'M-12', lat: -15.4, lng: -70.1 })] }, YO, geo);
  ok('si estoy en el mapa, centra en mí',
     conmigo.lat === -15.4 && conmigo.lng === -70.1, conmigo);

  const sinMi = centro({ units: [] }, YO, geo);
  ok('si no, en el trazado', sinMi.lat < -15.4 && sinMi.lat > -15.6, sinMi);

  // 0,0 es el Golfo de Guinea. Abrir ahí no se lee como "no hay datos": se
  // lee como que la app se rompió.
  const nada = centro(null, YO, null);
  ok('y sin nada, en Juliaca — nunca en 0,0',
     nada.lat === JULIACA.lat && nada.lng === JULIACA.lng, nada);
  ok('que no es 0,0', nada.lat !== 0 && nada.lng !== 0);
}

console.log('\nEL TEMA NO PUEDE RECARGAR EL MAPA');
{
  // La página se armaba con la paleta del momento. Al pasar a modo noche
  // —a las 18:30, en plena vuelta— cambiaba el `source` del WebView y el
  // mapa SE RECARGABA ENTERO: se perdían el zoom y el desplazamiento que el
  // chofer tenía puestos, y había que esperar las tiles de nuevo. Un cambio
  // de color no puede costar eso.
  ok('la página no depende del tema', html() === html(), 'iguales');
  ok('y no toma argumentos de color',
     html.length === 0, 'html() recibe ' + html.length + ' argumento(s)');

  const p = html();
  ok('los colores entran por variables CSS', /--fondo/.test(p) && /setProperty/.test(p));
  ok('y el tema llega por mensaje, no incrustado', /m\.colores/.test(p));

  // Lo que se le manda ANTES de que cargue se pierde: no hay nadie
  // escuchando. Sin el saludo, el mapa arrancaba con los colores de día
  // aunque fuera de noche.
  ok('la página avisa cuando está lista', /listo:\s*true/.test(p));

  // Y los colores tienen que llegar completos: una clave faltante deja un
  // punto `undefined`, que en Leaflet se dibuja transparente.
  const c = coloresDe({ fondo: '#000', panel: '#111', linea: '#222', blanco: '#fff',
                        tenue: '#555', brillante: '#0f0', ambar: '#ff0' });
  for (const k of ['fondo', 'panel', 'linea', 'blanco', 'tenue', 'yo', 'otra', 'sinSenal', 'ida', 'vuelta']) {
    ok('coloresDe trae ' + k, typeof c[k] === 'string' && c[k].length > 0, c[k]);
  }
  ok('y sin paleta igual devuelve todo',
     Object.values(coloresDe(null)).every(v => typeof v === 'string' && v));
}

console.log('\nCENTRARME CENTRA, SIEMPRE');
{
  const p = html();
  // Antes centrar caía en una rama que quedaba muerta después del primer
  // dibujo del trazado, así que el botón no hacía nada. Ahora es una orden:
  // no depende de que haya llegado un estado nuevo.
  ok('centrar llama a setView sin condiciones previas',
     /if \(m\.tipo === 'centrar'\)[\s\S]{0,400}mapa\.setView\(aDonde/.test(p));
  ok('y siempre tiene a dónde ir', /function aDonde/.test(p) && /mapa\.getCenter\(\)/.test(p));
  // Centrarse es para VERSE. Dejarlo en el zoom de la ruta entera es como no
  // haber centrado.
  ok('y se acerca al centrar', p.includes(String(ZOOM_SEGUIMIENTO)), ZOOM_SEGUIMIENTO);

  // `centro()` nunca devuelve null, así que el destino existe siempre —
  // incluso sin unidades y sin trazado.
  const v = vista(null, null, null);
  ok('hasta sin datos hay un centro', typeof v.centro.lat === 'number', v.centro);
}

console.log('\nLA PÁGINA DEL WEBVIEW');
{
  const p = html();
  ok('es una página completa', /^<!DOCTYPE html>/.test(p) && /<\/html>$/.test(p.trim()));

  // El fondo oscuro y sin detalle es la decisión que hace legible el mapa: un
  // mapa de calles a todo color tiene cientos de nombres, íconos y manchas de
  // parque compitiendo con tres puntos y una línea.
  ok('el fondo es el mapa oscuro, no el de calles a color',
     p.includes(TILES) && /dark-matter/.test(p), TILES);
  ok('y NO usa el de OpenStreetMap a color', !/tile\.openstreetmap\.org/.test(p));

  // OSM la exige (ODbL) y Geoapify la pide en su plan gratuito.
  ok('la atribución se muestra', /attribution:/.test(p) && !/attributionControl:\s*false/.test(p));
  ok('y nombra a OpenStreetMap con todas las letras', /OpenStreetMap contributors/.test(p));

  // La clave NO va compilada: la página se arma sin ella y la recibe por
  // mensaje, como los colores. Rotar la clave no puede costar repartir un APK.
  ok('la página se arma sin ninguna clave adentro', !/apiKey=[A-Za-z0-9]/.test(p));
  ok('y la clave entra por mensaje', /m\.tipo === 'tiles'/.test(p) && /m\.clave/.test(p) && /setUrl/.test(p));

  // Ida llena, vuelta punteada: una línea de un solo color no dice para qué
  // lado va ese trazo, que es lo que hay que saber para ubicar a la de adelante.
  ok('la vuelta va punteada y de otro color', /dashArray/.test(p) && /vuelta/.test(p));

  // Mover marcadores en vez de rehacerlos es lo que hace viables 20 unidades:
  // borrar y recrear cada 3 s hace parpadear el mapa y tira las etiquetas
  // justo cuando el chofer las está leyendo.
  ok('los marcadores se mueven, no se rehacen',
     /setLatLng/.test(p) && !/capaUnidades\.clearLayers/.test(p));
  ok('y encuadra el trazado al dibujarlo', /fitBounds/.test(p));

  // Escucha los DOS: en Android el mensaje llega por `document`, en iOS por
  // `window`. Con uno solo, el mapa se queda vacío en una de las dos
  // plataformas y no da ningún error.
  ok('escucha el mensaje por document (Android)', /document\.addEventListener\('message'/.test(p));
  ok('y por window (iOS)', /window\.addEventListener\('message'/.test(p));

  ok('y tiene el modo noche para el mapa', /\.oscuro \.leaflet-tile-pane/.test(p));
  ok('es una página con cuerpo', html().length > 2000, html().length);
}

console.log('\nEL MAPA NO DEPENDE DE QUE HAYA INTERNET PARA EXISTIR');
{
  // La primera apertura del mapa es en la calle, con el celular recién
  // instalado. Si en ese momento Leaflet viene de un CDN y el CDN no
  // contesta, el mapa queda en blanco y sin decir por qué: `L` no existe y
  // el script de la página se corta en la primera línea. Ya pasó en el panel
  // del creador, en producción, con este mismo CDN.
  const p = html();
  ok('Leaflet no se baja de ningún lado', !/unpkg\.com|cdnjs|jsdelivr/.test(p));
  ok('viene adentro de la página, código y estilos',
     /Leaflet 1\.9\.4, a JS library/.test(p) && /\.leaflet-pane\s*\{/.test(p));

  // Las tiles SÍ son de la red y no hay forma de que no lo sean: sin señal el
  // mapa queda gris, pero los puntos y el trazado —que es lo que el chofer
  // necesita— se dibujan igual. Eso es lo que se gana.
  ok('las tiles vienen del proveedor con licencia (Geoapify), no de CARTO',
     /maps\.geoapify\.com/.test(p) && !/cartocdn/.test(p));

  // Leaflet lleva etiquetas HTML adentro de sus textos ("<span>+</span>" en
  // los botones de zoom). Sin escapar la barra, el parser del WebView cierra
  // la etiqueta antes de tiempo y se pierde media librería.
  ok('las barras de cierre van escapadas', !/<\/span>/.test(p) && p.includes('<\\/span>'));

  // Que la copia del APK siga siendo la misma que sirve el servidor lo
  // verifica la suite `vendor`, que es la dueña de ese contrato para las
  // cuatro pantallas. Acá solo importa qué tiene adentro esta página.
}

console.log('\nTODO JUNTO');
{
  const v = vista(
    { units: [u({ unitId: 'M-12', vehicleId: 'M-12' }), u({ unitId: 'M-08', vehicleId: 'M-08' })] },
    YO,
    { tramos: { ida: [[-15.50, -70.14], [-15.48, -70.12]] } },
  );
  ok('trae marcadores, líneas y centro',
     v.marcadores.length === 2 && v.lineas.length === 1 && typeof v.centro.lat === 'number');

  // Va por `postMessage`, así que tiene que poder serializarse. Un valor
  // circular o un undefined suelto deja el mapa mudo, sin error.
  let json = null;
  try { json = JSON.stringify(v); } catch {}
  ok('y se puede mandar por postMessage', typeof json === 'string' && json.length > 10);
}

console.log('\nBORDES');
{
  for (const malo of [undefined, null, {}, { units: null }, { units: 'no' }]) {
    ok('marcadores no revienta con ' + JSON.stringify(malo),
       Array.isArray(marcadores(malo, YO)) && marcadores(malo, YO).length === 0);
  }
  for (const malo of [undefined, null, {}, { tramos: null }, { tramos: 'no' }, { tramos: [1, 2] }]) {
    ok('lineas tampoco con ' + JSON.stringify(malo), lineas(malo).length === 0);
  }
  ok('sin sesión, nada es mío',
     marcadores({ units: [u({ unitId: 'M-12', vehicleId: 'M-12' })] }, null)
       .every(m => m.tipo !== 'yo'));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
