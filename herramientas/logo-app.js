// Las imágenes de arranque de la app, desde el logo del flyer
// (flyer/fuente/piezas) con la Poppins de verdad (flyer/fuente/codigo/fonts).
// Sale: arranque-reloj.png (la pantalla nativa: el reloj, blanco),
// logotipo-blanco.png (la presentación), logotipo-azul.png (por si hace falta
// sobre fondo claro) y muestra.png (cómo se ven, para revisar).
// Uso: node herramientas/logo-app.js . <carpeta de salida>
// Las dos primeras van a app/assets/ (H1 y H3, CAMBIOS bloque 43).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [raiz, salida] = process.argv.slice(2);
const piezas = path.join(raiz, 'flyer/fuente/piezas');
// Embebida: una página armada con setContent no puede leer archivos locales
const fuente = 'data:font/ttf;base64,' + fs.readFileSync(path.join(raiz, 'flyer/fuente/codigo/fonts/Poppins-600.ttf')).toString('base64');
const limpiar = (svg) => svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/xmlns:c2pa="[^"]*"/g, '');
const pintar = (svg, color) => svg.replace(/#0B2239/g, color);
(async () => {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
  const hacer = async (archivo, color, ancho, alto, nombre, margen = 0) => {
    const svg = pintar(limpiar(fs.readFileSync(path.join(piezas, archivo), 'utf8')), color)
      .replace(/width="\d+" height="\d+"/, `width="${ancho - 2 * margen}" height="${alto - 2 * margen}"`);
    await pagina.setViewportSize({ width: ancho, height: alto });
    await pagina.setContent(`<html><head><style>
      @font-face { font-family: 'Poppins'; font-weight: 600; src: url('${fuente}'); }
      html, body { margin: 0; background: transparent; }
      body { width: ${ancho}px; height: ${alto}px; display: flex; align-items: center; justify-content: center; }
    </style></head><body>${svg}</body></html>`);
    await pagina.evaluate(() => document.fonts.load('600 40px Poppins'));
    const cargada = await pagina.evaluate(() => document.fonts.check('600 40px Poppins'));
    if (!cargada) throw new Error('la Poppins no cargó');
    await pagina.screenshot({ path: path.join(salida, nombre), omitBackground: true });
  };
  // La pantalla nativa: el reloj, blanco
  await hacer('reloj-logo.svg', '#FFFFFF', 600, 600, 'arranque-reloj.png', 30);
  // La presentación: el logotipo entero, blanco (fondo oscuro) y azul (fondo claro)
  await hacer('logotipo-micros-tempo.svg', '#FFFFFF', 933, 210, 'logotipo-blanco.png');
  await hacer('logotipo-micros-tempo.svg', '#0B2239', 933, 210, 'logotipo-azul.png');
  // Cómo se vería, para mostrar: sobre el azul noche de la pantalla nativa
  await pagina.setViewportSize({ width: 900, height: 700 });
  const b64 = (n) => fs.readFileSync(path.join(salida, n)).toString('base64');
  await pagina.setContent(`<html><body style="margin:0;display:flex;font-family:sans-serif">
    <div style="width:450px;height:700px;background:#0A1A2E;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8aa">
      <img src="data:image/png;base64,${b64('arranque-reloj.png')}" style="width:120px;height:120px">
      <p style="margin-top:40px">1. Pantalla nativa (Android)</p></div>
    <div style="width:450px;height:700px;background:#0A1A2E;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8aa">
      <img src="data:image/png;base64,${b64('logotipo-blanco.png')}" style="width:280px">
      <p style="margin-top:40px">2. Presentación (fondo oscuro)</p></div>
  </body></html>`);
  await pagina.screenshot({ path: path.join(salida, 'muestra.png') });
  await navegador.close();
})().catch(e => { console.error(e); process.exit(1); });
