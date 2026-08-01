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
