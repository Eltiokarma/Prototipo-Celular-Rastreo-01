const { chromium } = require('playwright-core');
const SHOT = __dirname;
const interceptarHttps = require(SHOT + '/cdn.js');
const P = 3034;
let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + e : ''));
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await interceptarHttps(ctx);
  const errores = [];
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(e.message));
  // El único diálogo del panel es el confirm de "cambios sin guardar" del
  // trazador: acá siempre se descartan a propósito.
  p.on('dialog', d => d.accept());

  await p.goto(`http://localhost:${P}/creador`, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await p.waitForTimeout(2500);

  console.log('\nPUERTA');
  let t = await p.innerText('body');
  // Las etiquetas de campo van en mayúscula desde el rediseño
  ok('pide clave y no muestra nada más', /Creador/.test(t) && /clave/i.test(t) && !/cooperativas/i.test(t));
  await p.screenshot({ path: SHOT + '/creador-puerta.png' });

  await p.fill('input[type="password"]', 'clave-mal-puesta-1');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(1500);
  t = await p.innerText('body');
  ok('con la clave mal, no entra', /No coincide/.test(t) && !/Cooperativas/.test(t));

  await p.fill('input[type="password"]', 'clave-larga-del-creador');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(2500);

  console.log('\nCOOPERATIVAS');
  t = await p.innerText('body');
  ok('adentro lista las cooperativas', /COOPERATIVAS/.test(t) && /Cooperativa de Transportes Juliaca/.test(t));
  ok('con su tamaño', /vehículo\(s\)/.test(t) && /persona\(s\)/.test(t));
  await p.screenshot({ path: SHOT + '/creador-empresas.png' });

  // Alta completa desde la pantalla
  await p.click('button:has-text("+ Nueva cooperativa")');
  await p.waitForTimeout(600);
  await p.fill('input[placeholder="COOP-15"]', 'UI-COOP');
  await p.fill('input[placeholder="Cooperativa Santa Rosa"]', 'Cooperativa de Prueba');
  await p.fill('input[placeholder="R-15"]', 'RUI-1');
  await p.fill('input[placeholder="Plaza ↔ Salida Cusco"]', 'Terminal ↔ Mercado');
  await p.fill('input[placeholder="DESPACHO-15"]', 'DESP-UI');
  const claves = await p.$$('input');
  await claves[claves.length - 1].fill('claveprueba1');
  await p.click('button:has-text("Crear")');
  await p.waitForTimeout(2500);
  t = await p.innerText('body');
  ok('se crea una cooperativa entera desde la pantalla',
    /Cooperativa creada/.test(t) && /Cooperativa de Prueba/.test(t) && /RUI-1/.test(t));

  // Administrar: corregir datos y renombrar una ruta sin dar nada de baja
  const laNueva = p.locator('[data-empresa="UI-COOP"]');
  t = await laNueva.innerText();
  ok('la tarjeta muestra RUC, contacto y fecha de alta', /RUC/.test(t) && /CONTACTO/i.test(t) && /ALTA/i.test(t));
  ok('y el nombre de cada ruta, no solo el código', /Terminal ↔ Mercado/.test(t));

  await laNueva.getByRole('button', { name: 'Administrar' }).click();
  await p.waitForTimeout(800);
  const camposDatos = laNueva.locator('input');
  await camposDatos.nth(2).fill('999 111 222');   // contacto (0=nombre, 1=RUC)
  await laNueva.getByRole('button', { name: 'Guardar datos' }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('los datos se corrigen desde la tarjeta',
    /Datos guardados/.test(t) && /contacto 999 111 222/.test(t));

  await p.screenshot({ path: SHOT + '/creador-administrar.png' });
  await laNueva.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await p.waitForTimeout(500);

  // Suspender y volver. La tarjeta se busca por su código, que es único:
  // apuntarle por nombre agarraba el contenedor de todas y terminaba
  // apretando el botón de la cooperativa de arriba.
  const tarjeta = p.locator('[data-empresa="UI-COOP"]');
  await tarjeta.getByRole('button', { name: 'Suspender', exact: true }).click();
  await p.waitForTimeout(600);
  t = await p.innerText('body');
  // La confirmación es una ventana aparte, no un renglón dentro de la
  // tarjeta: por eso se busca en la página y no en el locator de la empresa.
  ok('suspender pide confirmación y dice a cuál',
    /CONFIRMAR SUSPENSIÓN/i.test(t) && /Suspender «Cooperativa de Prueba»/.test(t));
  ok('y cuenta la consecuencia en gente concreta', /Corta el acceso/.test(t) && /persona/.test(t));
  ok('y todavía no suspendió nada', !/SUSPENDIDA/.test(t));
  await p.screenshot({ path: SHOT + '/creador-confirmar.png' });

  await p.getByRole('button', { name: 'No', exact: true }).click();
  await p.waitForTimeout(500);
  t = await p.innerText('body');
  ok('se puede arrepentir', !/CONFIRMAR SUSPENSIÓN/i.test(t) && !/SUSPENDIDA/.test(t));

  await tarjeta.getByRole('button', { name: 'Suspender', exact: true }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Sí, suspender/ }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('confirmada, se suspende', /SUSPENDIDA/.test(t) && /Cooperativa suspendida/.test(t));
  await p.screenshot({ path: SHOT + '/creador-suspendida.png' });

  await tarjeta.getByRole('button', { name: 'Habilitar' }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('y se vuelve a habilitar', /Cooperativa habilitada/.test(t) && !/SUSPENDIDA/.test(t),
    JSON.stringify({ aviso: /Cooperativa habilitada/.test(t), sigue: /SUSPENDIDA/.test(t) }));

  console.log('\nSISTEMA');
  await p.click('button:has-text("SISTEMA")');
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('muestra la salud del servidor', /ENCENDIDO HACE/i.test(t) && /BASE DE DATOS/i.test(t) && /NODE/i.test(t));
  ok('y avisa que falta el segundo factor', /segundo factor/i.test(t));
  await p.screenshot({ path: SHOT + '/creador-sistema.png' });

  console.log('\nACTIVIDAD');
  await p.click('button:has-text("ACTIVIDAD")');
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('muestra la actividad de todas juntas', /CREADOR/.test(t) && /alta_empresa/.test(t));
  ok('incluida la de la cooperativa nueva', /UI-COOP/.test(t));
  await p.screenshot({ path: SHOT + '/creador-actividad.png' });

  console.log('\nRUTAS: EL TRAZADOR');
  await p.click('button:has-text("RUTAS")');
  await p.waitForTimeout(1500);
  t = await p.innerText('body');
  ok('la pestaña pide elegir cooperativa y ruta', /Elegí cooperativa y ruta/.test(t));
  ok('la lógica del trazador llegó al navegador',
    (await p.evaluate(() => typeof window.Trazador)) === 'object');

  // La cooperativa creada más arriba, con su ruta RUI-1 recién nacida
  await p.locator('select').nth(0).selectOption('UI-COOP');
  await p.waitForTimeout(800);
  await p.locator('select').nth(1).selectOption('RUI-1');
  await p.waitForTimeout(3000);
  t = await p.innerText('body');
  ok('elegida la ruta, aparecen las herramientas',
    /DIBUJAR/.test(t) && /MANO/.test(t) && /SELECCIONAR/.test(t));
  ok('y la ruta nueva ya tiene su trazado base, midiendo', /MIDIENDO/.test(t));
  const mapa = p.locator('.leaflet-container');
  ok('el mapa está', (await mapa.count()) === 1);

  // La gestión vive acá ahora: renombrar la ruta…
  await p.getByRole('button', { name: 'Renombrar ruta' }).click();
  await p.waitForTimeout(400);
  await p.locator('input:focus').fill('Terminal ↔ Feria Dominical');
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('la ruta se renombra desde RUTAS',
    /Ruta renombrada/.test(t) && /Terminal ↔ Feria Dominical/.test(t));

  // …crear un trazado nuevo (queda elegido, en ámbar por no ser el que mide)…
  await p.getByRole('button', { name: '+ Nuevo trazado' }).click();
  await p.waitForTimeout(400);
  await p.locator('input:focus').fill('Obra de prueba');
  await p.getByRole('button', { name: 'Crear trazado' }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('un trazado nuevo se crea y queda elegido',
    /Trazado «Obra de prueba» creado/.test(t) && /no es el\s+trazado que está midiendo/.test(t.replace(/\n/g, ' ')));

  // …y borrarlo (el confirm se acepta solo en este banco)
  await p.getByRole('button', { name: 'Borrar este trazado' }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('y se borra, volviendo al que mide',
    /Trazado borrado/.test(t) && /MIDIENDO/.test(t));

  // Dibujar: dos clics separados agregan A y B; el tercero cae SOBRE la
  // línea que quedó entre ellos, así que inserta en el medio en vez de
  // colgar del final — la herramienta nueva.
  const caja = await mapa.boundingBox();
  const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2;
  await p.mouse.click(cx - 60, cy);
  await p.waitForTimeout(400);
  await p.mouse.click(cx + 60, cy);
  await p.waitForTimeout(400);
  t = await p.innerText('body');
  ok('dos clics dibujan la ida y el largo se ve', /IDA [0-9]+([.,][0-9])? km/.test(t) && !/IDA 0([.,]0)? km/.test(t),
    (t.match(/IDA [\d.,]+ km/) || [])[0]);
  await p.mouse.click(cx, cy);
  await p.waitForTimeout(400);
  await p.screenshot({ path: SHOT + '/creador-rutas.png' });

  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await p.waitForTimeout(2000);
  t = await p.innerText('body');
  ok('el clic sobre la línea insertó en el medio: se guardan 3 puntos',
    /ida 3 pts/.test(t), (t.match(/Guardado[^·]*·?[^·]*/) || [])[0]);
  ok('y avisa que el trazado que mide ya salió al mapa de todos', /ya está en el mapa de todos/.test(t));

  // Deshacer con el teclado: vuelve el estado de antes del último clic y
  // el botón de guardar se vuelve a encender.
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(500);
  ok('Ctrl+Z deshace y deja algo para guardar',
    await p.getByRole('button', { name: 'Guardar', exact: true }).isEnabled());

  // Cambiar de cooperativa y de ruta NO puede matar el mapa. Regresión: el
  // div del mapa se desmontaba con el cambio y al volver quedaba un
  // rectángulo blanco muerto — "explota" al segundo uso del selector.
  // (Hay cambios sin guardar por el Ctrl+Z: salta el confirm y se acepta.)
  await p.locator('select').nth(0).selectOption('R14');
  await p.waitForTimeout(1000);
  await p.locator('select').nth(1).selectOption('R-14');
  await p.waitForTimeout(3000);
  ok('cambiar de cooperativa deja el mapa vivo',
    (await p.locator('.leaflet-container').count()) === 1);
  const caja2 = await p.locator('.leaflet-container').boundingBox();
  await p.mouse.click(caja2.x + caja2.width / 2 - 50, caja2.y + caja2.height / 2);
  await p.waitForTimeout(300);
  await p.mouse.click(caja2.x + caja2.width / 2 + 50, caja2.y + caja2.height / 2);
  await p.waitForTimeout(500);
  t = await p.innerText('body');
  ok('y en la ruta recién elegida se puede dibujar',
    /IDA [0-9]+([.,][0-9])? km/.test(t) && !/IDA 0([.,]0)? km/.test(t),
    (t.match(/IDA [\d.,]+ km/) || [])[0]);

  console.log('\nSI EL MAPA NO LLEGA, SE DICE (nada de página en blanco)');
  {
    // La reproducción exacta de lo que pasó en producción: leaflet.js no
    // llega. Antes: elegir una ruta desmontaba TODO React — página blanca,
    // sin una palabra. Ahora: la pestaña dice qué faltó y el panel sigue.
    const p2 = await ctx.newPage();
    const errores2 = [];
    p2.on('pageerror', e => errores2.push(e.message));
    await p2.route('**/leaflet.js', r => r.abort());
    await p2.goto(`http://localhost:${P}/creador`, { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(2500);
    await p2.fill('input[type="password"]', 'clave-larga-del-creador');
    await p2.click('button:has-text("Entrar")');
    await p2.waitForTimeout(2000);
    await p2.click('button:has-text("RUTAS")');
    await p2.waitForTimeout(1200);
    const t2 = await p2.innerText('body');
    ok('la pestaña avisa qué faltó, con nombre y apellido',
      /El trazador no pudo cargar/.test(t2) && /leaflet\.js/.test(t2));
    ok('el resto del panel sigue vivo', /COOPERATIVAS/.test(t2) && /Salir/.test(t2));
    ok('y sin errores de página', errores2.length === 0, errores2.join(' | ') || undefined);
    await p2.screenshot({ path: SHOT + '/creador-sin-leaflet.png' });
    await p2.close();
  }

  console.log('\nSALIR');
  await p.click('button:has-text("Salir")');
  await p.waitForTimeout(1500);
  t = await p.innerText('body');
  ok('vuelve a la puerta', /clave/i.test(t) && !/COOPERATIVAS/.test(t));
  const guardado = await p.evaluate(() => JSON.stringify({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) }));
  ok('y no dejó nada guardado en la máquina', guardado === '{"ls":[],"ss":[]}', guardado);

  // Recargar no debe reabrir la sesión
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  t = await p.innerText('body');
  ok('recargar tampoco reabre la sesión', /clave/i.test(t) && !/COOPERATIVAS/.test(t));

  ok('sin errores de consola', errores.length === 0, errores.join(' | ') || undefined);
  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  await browser.close();
  process.exit(fallas === 0 ? 0 : 1);
})();
