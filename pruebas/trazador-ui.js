// Interacciones reales del editor de Despacho, sin servidor ni datos reales.
// Usa React 18, Leaflet y el mismo JSX del HTML; la API y las tiles son locales.
// node pruebas/trazador-ui.js
// COOP_TEST_MODULES: directorios adicionales de node_modules (separador del SO).
// COOP_TEST_BROWSER: ejecutable Chrome/Chromium, si Playwright no lo tiene instalado.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const RAIZ = path.join(__dirname, '..');
const rutas = [...(process.env.COOP_TEST_MODULES || '').split(path.delimiter).filter(Boolean), __dirname];
const resolver = nombre => {
  for (const ruta of rutas) {
    try { return require.resolve(path.join(ruta, nombre)); } catch {}
  }
  return require.resolve(nombre, { paths: rutas });
};
const cargar = nombre => require(resolver(nombre));
const { chromium } = cargar('playwright-core');
let compilar;
try {
  const Babel = cargar('@babel/standalone');
  compilar = fuente => Babel.transform(fuente, { presets: ['react'] }).code;
} catch {
  const Babel = cargar('@babel/core'), preset = cargar('@babel/preset-react');
  compilar = fuente => Babel.transformSync(fuente, { presets: [preset], configFile: false, babelrc: false }).code;
}
const paquete = nombre => path.dirname(resolver(nombre + '/package.json'));
const ida = [[-15.491, -70.140], [-15.493, -70.140], [-15.493, -70.135], [-15.490, -70.135]];
const vuelta = [[-15.4902, -70.1353], [-15.494, -70.1353], [-15.494, -70.141], [-15.4912, -70.141]];

async function montar(browser, opciones = {}) {
  const page = await browser.newPage({ viewport: opciones.viewport || { width: 1440, height: 1000 } });
  const errores = [];
  page.on('pageerror', error => errores.push(error.message));
  // Una regresión que intente llamar al servidor de producción queda bloqueada.
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(RAIZ, 'project/despacho.html'), 'utf8');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>');
  for (const archivo of [
    path.join(paquete('react'), 'umd/react.production.min.js'),
    path.join(paquete('react-dom'), 'umd/react-dom.production.min.js'),
    path.join(RAIZ, 'server/vendor/leaflet/leaflet.js'),
  ]) await page.addScriptTag({ path: archivo });
  await page.addStyleTag({ path: path.join(RAIZ, 'server/vendor/leaflet/leaflet.css') });
  await page.evaluate(({ ida, vuelta, opciones }) => {
    window.__peticiones = []; window.__cerrado = 0; window.__guardados = [];
    window.__inicial = { ida, vuelta }; window.__opciones = opciones;
    const crearMapa = L.map;
    L.map = (nodo, opcionesMapa) => {
      const mapa = crearMapa(nodo, { ...opcionesMapa, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      window.__mapa = mapa; return mapa;
    };
    L.tileLayer = () => L.gridLayer();
    window.__api = async (url, peticion = {}) => {
      window.__peticiones.push({ url, ...peticion });
      if (peticion.method === 'PUT') {
        if (window.__opciones.pausarGuardado) await new Promise(resolve => { window.__terminarGuardado = resolve; });
        if (window.__opciones.fallarGuardado) throw Error('Fallo de prueba al guardar');
        window.__guardados.push(JSON.parse(peticion.body));
        return { ok: true };
      }
      if (url.includes('/points')) {
        if (window.__opciones.fallarCarga) throw Error('Fallo de prueba al cargar');
        return { tramos: Object.fromEntries(Object.entries(window.__inicial)
          .map(([k, v]) => [k, v.map(([lat, lng]) => ({ lat, lng }))])) };
      }
      return { grabaciones: [], pedidos: [], vehicles: [] };
    };
  }, { ida: opciones.ida || ida, vuelta: opciones.vuelta || vuelta, opciones });
  let fuente = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
  const montaje = "ReactDOM.createRoot(document.getElementById('root')).render(<Muro recargaSola><Root /></Muro>);";
  assert.ok(fuente.includes(montaje), 'se encuentra el montaje de la aplicación');
  fuente = fuente.replace(montaje, `
    if (window.__opciones.noche) aplicarTema('night');
    document.documentElement.style.setProperty('--bg', HUD.bg);
    document.documentElement.style.setProperty('--fg', HUD.fg);
    ReactDOM.createRoot(document.getElementById('root')).render(
      <Trazador routeId="R-14" routeName="Terminal Sur - Huancané"
        variantes={[{ variantId: 1, name: 'Recorrido normal', activa: true },
          { variantId: 2, name: 'Desvío guardado', activa: false }]}
        api={window.__api} onClose={() => { window.__cerrado++; }} onGuardado={() => {}} />
    );`);
  await page.addScriptTag({ content: compilar(fuente) });
  await page.waitForSelector('.leaflet-container');
  if (!opciones.fallarCarga && (opciones.ida || ida).length)
    await page.waitForSelector('.trazador-punto');
  // El componente invalida el tamaño al abrir a 80 y 400 ms; esperamos ese ajuste
  // antes de medir posiciones o iniciar un arrastre de ratón.
  await page.waitForTimeout(450);
  return { page, errores };
}

async function posicion(page, p) {
  return page.evaluate(p => {
    const m = window.__mapa, xy = m.latLngToContainerPoint(p), r = m.getContainer().getBoundingClientRect();
    return { x: xy.x + r.left, y: xy.y + r.top };
  }, p);
}
async function tocar(page, p) { const xy = await posicion(page, p); await page.mouse.click(xy.x, xy.y); }
async function arrastrar(page, de, a) {
  const inicio = await posicion(page, de), fin = await posicion(page, a);
  await page.mouse.move(inicio.x, inicio.y); await page.mouse.down();
  await page.mouse.move(fin.x, fin.y, { steps: 10 }); await page.mouse.up();
}
async function lineas(page) {
  return page.evaluate(() => {
    const todas = [];
    window.__mapa.eachLayer(l => {
      if (l instanceof L.Polyline) todas.push({
        puntos: l.getLatLngs().map(p => [p.lat, p.lng]), opciones: l.options,
      });
    });
    return todas;
  });
}

async function recorrido(page) {
  return (await lineas(page)).find(l => l.opciones.weight === 5 && !l.opciones.dashArray)?.puntos || [];
}
async function esperarPuntos(page, cantidad) {
  await page.waitForFunction(cantidad => {
    let puntos = [];
    window.__mapa.eachLayer(l => {
      if (l instanceof L.Polyline && l.options.weight === 5 && !l.options.dashArray) puntos = l.getLatLngs();
    });
    return puntos.length === cantidad;
  }, cantidad);
  return recorrido(page);
}
function cerca(a, b, mensaje) {
  assert.ok(Math.abs(a[0] - b[0]) < .00005 && Math.abs(a[1] - b[1]) < .00005, mensaje + ': ' + JSON.stringify({ actual: a, esperado: b }));
}
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
async function deshacer(page) { await boton(page, '↶ Deshacer').click(); }
async function rehacer(page) { await boton(page, '↷ Rehacer').click(); }

async function ejecutar() {
  const browser = await chromium.launch({
    ...(process.env.COOP_TEST_BROWSER ? { executablePath: process.env.COOP_TEST_BROWSER } : {}),
    headless: true,
  });
  try {
    {
      const { page, errores } = await montar(browser);
      assert.equal(await boton(page, 'Guardar recorrido').isDisabled(), true, 'sin cambios no se guarda');
      await tocar(page, ida[1]);
      assert.deepEqual(await recorrido(page), ida, 'seleccionar no borra ni mueve');
      assert.equal(await boton(page, '↶ Deshacer').isDisabled(), true, 'seleccionar no crea historial');
      await tocar(page, [-15.4905, -70.138]);
      assert.deepEqual(await recorrido(page), ida, 'un clic fuera de la línea no prolonga en modo editar');
      const medio = [-15.493, -70.1375];
      await tocar(page, medio);
      const insertado = await esperarPuntos(page, 5);
      cerca(insertado[2], medio, 'el clic sobre la línea inserta en el segmento correcto una sola vez');
      await deshacer(page); assert.deepEqual(await esperarPuntos(page, 4), ida);
      await rehacer(page); await esperarPuntos(page, 5);
      await arrastrar(page, medio, [-15.4924, -70.1375]);
      cerca((await recorrido(page))[2], [-15.4924, -70.1375], 'arrastrar cambia el punto');
      await deshacer(page); cerca((await recorrido(page))[2], medio, 'un arrastre se deshace en un solo paso');
      await tocar(page, medio); await boton(page, 'Eliminar punto').click();
      assert.deepEqual(await esperarPuntos(page, 4), ida, 'eliminar exige una acción explícita');
      assert.equal(await boton(page, '↷ Rehacer').isDisabled(), true, 'editar tras deshacer invalida rehacer');
      await deshacer(page); await esperarPuntos(page, 5);
      await page.keyboard.press('Control+z'); assert.deepEqual(await esperarPuntos(page, 4), ida, 'Ctrl+Z deshace');
      await page.keyboard.press('Control+Shift+z'); await esperarPuntos(page, 5);
      const antesGuardar = await recorrido(page);
      await boton(page, 'Guardar recorrido').click();
      assert.ok((await page.getByRole('dialog').innerText()).includes('descarta las vueltas en curso'));
      await page.locator('[data-confirmar-aceptar]').click();
      await page.waitForFunction(() => window.__guardados.length === 1);
      const guardado = await page.evaluate(() => window.__guardados[0]);
      assert.equal(guardado.variantId, 1);
      assert.deepEqual(guardado.tramos.ida, antesGuardar.map(([lat, lng]) => ({ lat, lng })));
      assert.deepEqual(guardado.tramos.vuelta, vuelta.map(([lat, lng]) => ({ lat, lng })));
      assert.deepEqual(errores, []);
      await page.close();
      console.log('OK seleccionar, insertar, mover, eliminar, deshacer/rehacer y guardar ambos sentidos');
    }
    {
      const { page, errores } = await montar(browser);
      await page.getByRole('button', { name: /^Agregar tramo/ }).click();
      await boton(page, 'Desde A · inicio').click();
      const primero = [-15.490, -70.1415], segundo = [-15.489, -70.142];
      await tocar(page, primero); await esperarPuntos(page, 5);
      await tocar(page, segundo); const ampliado = await esperarPuntos(page, 6);
      cerca(ampliado[0], segundo, 'al prolongar A, el último clic es el nuevo inicio');
      cerca(ampliado[1], primero, 'los puntos quedan en orden de conducción');
      assert.deepEqual(ampliado.slice(2), ida);
      await boton(page, 'Desde B · final').click();
      await tocar(page, [-15.489, -70.134]);
      cerca((await esperarPuntos(page, 7))[6], [-15.489, -70.134], 'B se prolonga al final');
      await boton(page, 'Vuelta').click();
      await page.getByRole('button', { name: /^Agregar tramo/ }).click();
      await boton(page, 'Desde B · final').click();
      await tocar(page, [-15.490, -70.142]); await esperarPuntos(page, 5);
      await boton(page, 'Ida').click(); await esperarPuntos(page, 7);
      await deshacer(page);
      assert.deepEqual(await esperarPuntos(page, 4), vuelta, 'deshacer vuelve al sentido donde se hizo el cambio');
      await boton(page, 'Cerrar').click();
      assert.equal(await page.getByRole('dialog').count(), 1, 'cerrar con cambios requiere confirmación');
      assert.equal(await page.evaluate(() => window.__cerrado), 0);
      await boton(page, 'No cambiar nada').click();
      assert.deepEqual(errores, []); await page.close();
      console.log('OK prolongar A/B, historial entre ida/vuelta y protección al cerrar');
    }
    {
      const { page, errores } = await montar(browser);
      await page.getByRole('button', { name: /^Redibujar un tramo/ }).click();
      await tocar(page, ida[3]); await tocar(page, ida[0]);
      const nueva1 = [-15.492, -70.139], nueva2 = [-15.491, -70.137];
      await tocar(page, nueva1); await tocar(page, nueva2);
      assert.deepEqual(await recorrido(page), ida, 'el borrador no altera la ruta guardable');
      assert.equal(await boton(page, 'Guardar recorrido').isDisabled(), true, 'no se guarda un desvío sin aplicar');
      await boton(page, 'Aplicar tramo').click();
      const aplicado = await recorrido(page);
      assert.equal(aplicado.length, 4); assert.deepEqual(aplicado[0], ida[0]); assert.deepEqual(aplicado[3], ida[3]);
      cerca(aplicado[1], nueva1, 'primer punto del reemplazo'); cerca(aplicado[2], nueva2, 'segundo punto del reemplazo');
      await deshacer(page); assert.deepEqual(await recorrido(page), ida, 'deshacer recupera todo el tramo original');
      await page.getByRole('button', { name: /^Redibujar un tramo/ }).click();
      await tocar(page, ida[0]); await tocar(page, ida[2]); await tocar(page, nueva1);
      await tocar(page, ida[1]);
      await page.keyboard.press('Control+z');
      const borrador = (await lineas(page)).find(l => l.opciones.dashArray === '10 6');
      assert.equal(borrador.puntos.length, 3, 'Ctrl+Z quita el punto añadido desde un marcador sin perder extremos');
      cerca(borrador.puntos[1], nueva1, 'conserva el resto del borrador');
      await boton(page, 'Vuelta').click();
      assert.equal(await page.getByRole('dialog').count(), 1, 'cambiar sentido avisa antes de descartar borrador');
      await boton(page, 'No cambiar nada').click();
      await boton(page, 'Cancelar tramo').click();
      assert.deepEqual(await recorrido(page), ida, 'cancelar el borrador conserva el recorrido');
      assert.deepEqual(errores, []); await page.close();
      console.log('OK redibujar entre extremos en ambos órdenes, aplicar, cancelar y deshacer');
    }
    {
      const { page, errores } = await montar(browser, { viewport: { width: 390, height: 844 }, noche: true });
      const medidas = await page.locator('[data-mapa-trazador]').boundingBox();
      assert.ok(medidas.height >= 200, 'el editor móvil deja mapa utilizable');
      assert.ok(medidas.width <= 390, 'el mapa cabe en el móvil');
      const desbordes = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect(); return r.width && r.left < -1 || r.right > innerWidth + 1;
      }).map(b => b.textContent));
      assert.deepEqual(desbordes, [], 'los botones no desbordan horizontalmente');
      assert.deepEqual(errores, []);
      if (process.env.COOP_TEST_SCREENSHOT) await page.screenshot({ path: process.env.COOP_TEST_SCREENSHOT });
      await page.close();
      console.log('OK móvil y tema noche sin desbordes ni errores');
    }
    {
      const muchos = Array.from({ length: 601 }, (_, i) => [-15.493 + .001 * Math.sin(i / 30), -70.142 + i * .000015]);
      const { page, errores } = await montar(browser, { ida: muchos, vuelta: [] });
      assert.ok(await page.locator('.trazador-punto').count() <= 204, 'una ruta densa limita los marcadores');
      await page.locator('.trazador-punto[title^="Punto 601"]').click();
      await boton(page, 'Eliminar punto').click(); await esperarPuntos(page, 600);
      await deshacer(page); assert.deepEqual(await esperarPuntos(page, 601), muchos);
      assert.deepEqual(errores, []); await page.close();
      console.log('OK rutas densas siguen editables y recuperables');
    }
    {
      const { page, errores } = await montar(browser, { fallarGuardado: true, pausarGuardado: true });
      await tocar(page, [-15.493, -70.1375]); await esperarPuntos(page, 5);
      const antes = await recorrido(page);
      await boton(page, 'Guardar recorrido').click(); await page.locator('[data-confirmar-aceptar]').click();
      await page.waitForFunction(() => typeof window.__terminarGuardado === 'function');
      await tocar(page, [-15.492, -70.140]);
      assert.deepEqual(await recorrido(page), antes, 'no se edita durante PUT');
      assert.equal(await page.locator('select').first().isDisabled(), true, 'no se cambia de variante durante PUT');
      await page.evaluate(() => window.__terminarGuardado());
      await page.getByText('Fallo de prueba al guardar', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__cerrado), 0, 'un error no cierra el editor');
      assert.deepEqual(await recorrido(page), antes, 'un error de guardado conserva las ediciones');
      assert.equal(await boton(page, 'Guardar recorrido').isDisabled(), false, 'permite reintentar');
      await page.locator('select').first().selectOption('2');
      assert.equal(await page.getByRole('dialog').count(), 1, 'avisa al cambiar variante con cambios');
      await page.locator('[data-confirmar-aceptar]').click();
      await esperarPuntos(page, 4);
      assert.equal(await boton(page, '↶ Deshacer').isDisabled(), true, 'otra variante no hereda historial');
      assert.deepEqual(errores, []); await page.close();
      console.log('OK PUT bloquea edición, conserva cambios al fallar y aísla variantes');
    }
    {
      const { page, errores } = await montar(browser);
      const gpx = '<gpx><trk><trkseg><trkpt lat="-15.492" lon="-70.14"/><trkpt lat="-15.495" lon="-70.14"/><trkpt lat="-15.495" lon="-70.136"/></trkseg></trk></gpx>';
      await page.locator('input[type=file]').setInputFiles({ name: 'ruta.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
      await esperarPuntos(page, 3);
      await deshacer(page); assert.deepEqual(await esperarPuntos(page, 4), ida, 'importar se puede deshacer');
      await page.locator('input[type=file]').setInputFiles({ name: 'invalido.geojson', mimeType: 'application/json', buffer: Buffer.from('{"type":"LineString","coordinates":[["error",-15],[1,2]]}') });
      await page.getByText(/No se pudo leer el archivo:/).waitFor();
      assert.deepEqual(await recorrido(page), ida, 'importar coordenadas inválidas no destruye la ruta');
      await page.evaluate(() => {
        FileReader.prototype.readAsText = function() { window.__lectorPendiente = this; };
      });
      await page.locator('input[type=file]').setInputFiles({ name: 'demorado.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
      await page.locator('select').first().selectOption('2');
      await page.waitForFunction(() => window.__peticiones.some(p => p.url.endsWith('?variantId=2')));
      await esperarPuntos(page, 4);
      await page.evaluate(gpx => {
        Object.defineProperty(window.__lectorPendiente, 'result', { value: gpx });
        window.__lectorPendiente.onload();
      }, gpx);
      assert.deepEqual(await recorrido(page), ida, 'una importación tardía no entra en otra variante');
      assert.equal(await boton(page, '↶ Deshacer').isDisabled(), true);
      assert.deepEqual(errores, []); await page.close();
      console.log('OK importación reversible, validación e importación tardía entre variantes');
    }
    {
      const { page, errores } = await montar(browser, { fallarCarga: true });
      assert.equal(await boton(page, 'Guardar recorrido').isDisabled(), true, 'fallar GET no permite sobrescribir con vacío');
      await tocar(page, [-15.4904, -70.1333]);
      assert.deepEqual(errores, []); await page.close();
      const vacio = await montar(browser, { vuelta: [] });
      await boton(vacio.page, 'Vuelta').click();
      assert.equal(await boton(vacio.page, 'Desde B · final').count(), 1, 'una dirección vacía activa agregar tramo');
      assert.deepEqual(vacio.errores, []); await vacio.page.close();
      const muchos = Array.from({ length: 2000 }, (_, i) => [-15.493 + .001 * Math.sin(i / 30), -70.142 + i * .0000045]);
      const tope = await montar(browser, { ida: muchos, vuelta: [] });
      await tope.page.getByRole('button', { name: /^Agregar tramo/ }).click();
      await tocar(tope.page, [-15.489, -70.135]);
      await tope.page.getByText(/Máximo 2000 puntos por dirección/).waitFor();
      assert.deepEqual(await recorrido(tope.page), muchos, 'el límite manual no trunca ni altera puntos');
      assert.deepEqual(tope.errores, []); await tope.page.close();
      console.log('OK carga fallida, dirección vacía y límite manual de 2000 puntos');
    }
  } finally { await browser.close(); }
}

module.exports = { montar, posicion, tocar, arrastrar, lineas, ida, vuelta };
if (require.main === module) ejecutar().catch(error => { console.error(error); process.exitCode = 1; });
