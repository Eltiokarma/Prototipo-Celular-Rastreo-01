// Los colores y cuándo cambian (`app/tema.js`).
//
// "Oscuro" no es "de noche". A las diez, en la cabina, una pantalla azul
// brillante a 30 cm de la cara encandila y arruina la visión nocturna del
// chofer varios segundos después de mirarla — o sea, tiempo manejando con los
// ojos todavía adaptándose.
//
// Lo que se prueba acá no es el gusto: es que la regla horaria sea la de
// Juliaca, que no falte ningún color en ninguna paleta (una clave faltante es
// un hueco negro que se ve recién en el teléfono y de noche), y que la de
// noche sea de verdad más oscura y menos azul.
const RAIZ = require('path').join(__dirname, '..');
const { paleta, esDeNoche, esOscuro, siguienteModo, MODOS, PALETAS } = require(RAIZ + '/app/tema.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const alas = (h, m = 0) => { const d = new Date(2026, 5, 15, h, m, 0); return d; };
const luminancia = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;   // percibida, no promedio
};
const azulez = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return b - (r + g) / 2;                        // cuánto se va al azul
};

console.log('\nCUÁNDO ES DE NOCHE EN JULIACA');
{
  // A 15° de latitud sur el día casi no cambia con la estación: amanece entre
  // 5:20 y 6:00 y anochece entre 18:00 y 18:40 todo el año. Por eso alcanza
  // una regla horaria y no hace falta calcular la posición del sol.
  ok('el mediodía es de día', esDeNoche(alas(12)) === false);
  ok('las 9 de la mañana también', esDeNoche(alas(9)) === false);
  ok('las 22 son de noche', esDeNoche(alas(22)) === true);
  ok('las 3 de la madrugada también', esDeNoche(alas(3)) === true);

  // Los bordes, que es donde una regla horaria se equivoca fácil.
  ok('18:00 todavía es de día', esDeNoche(alas(18, 0)) === false);
  ok('18:30 ya es de noche', esDeNoche(alas(18, 30)) === true);
  ok('05:00 todavía es de noche', esDeNoche(alas(5, 0)) === true);
  ok('06:00 ya es de día', esDeNoche(alas(6, 0)) === false);

  // Y que cruce la medianoche sin romperse: 23 y 1 tienen que dar lo mismo,
  // que es donde falla un rango escrito como "entre A y B".
  ok('cruza la medianoche', esDeNoche(alas(23)) === true && esDeNoche(alas(1)) === true);
}

console.log('\nLA DE NOCHE ES MÁS OSCURA Y MENOS AZUL');
{
  const d = PALETAS.dia, n = PALETAS.noche;
  ok('el fondo de noche es más oscuro',
     luminancia(n.fondo) < luminancia(d.fondo), [luminancia(n.fondo), luminancia(d.fondo)]);
  ok('y el panel también',
     luminancia(n.panel) < luminancia(d.panel), [luminancia(n.panel), luminancia(d.panel)]);

  // El azul es lo que más dilata la pupila y lo que más tarda en soltar la
  // vista. Es la razón por la que los tableros de los autos son ámbar.
  ok('lo que brilla de noche NO es azul',
     azulez(n.brillante) < azulez(d.brillante), [azulez(n.brillante), azulez(d.brillante)]);
  ok('y el texto principal tampoco',
     azulez(n.blanco) < azulez(d.blanco), [azulez(n.blanco), azulez(d.blanco)]);

  // Un blanco puro sobre negro es el peor contraste de noche: deslumbra en el
  // borde de cada letra.
  ok('el texto principal no es blanco puro', n.blanco.toUpperCase() !== '#FFFFFF', n.blanco);

  // Pero tiene que seguir leyéndose: bajar todo hasta que no se vea es el
  // otro error, y peor, porque el chofer prende la luz de la cabina.
  ok('igual se lee sobre el fondo',
     luminancia(n.blanco) - luminancia(n.fondo) > 100,
     luminancia(n.blanco) - luminancia(n.fondo));
}

console.log('\nLOS ESTADOS SIGUEN SIENDO INFORMACIÓN');
{
  // Verde, ámbar y rojo dicen qué hacer. De noche se bajan, no se cambian:
  // si el rojo dejara de ser rojo, el chofer perdería el único dato que lee
  // sin leer.
  const n = PALETAS.noche;
  const rojo = parseInt(n.rojo.slice(1), 16);
  const verde = parseInt(n.verde.slice(1), 16);
  ok('el rojo de noche sigue siendo rojo',
     ((rojo >> 16) & 255) > ((rojo >> 8) & 255) && ((rojo >> 16) & 255) > (rojo & 255), n.rojo);
  ok('el verde de noche sigue siendo verde',
     ((verde >> 8) & 255) > ((verde >> 16) & 255) && ((verde >> 8) & 255) > (verde & 255), n.verde);
  ok('y los tres se distinguen entre sí',
     new Set([n.verde, n.ambar, n.rojo]).size === 3);
}

console.log('\nNINGUNA PALETA TIENE HUECOS');
{
  // Una clave que falte en una paleta es un color `undefined`, que en React
  // Native se dibuja como nada. Se ve recién en el teléfono, de noche, y
  // parece que la app se rompió.
  const claves = Object.keys(PALETAS.dia).sort();
  for (const [nombre, p] of Object.entries(PALETAS)) {
    const suyas = Object.keys(p).sort();
    ok(`la paleta ${nombre} tiene exactamente los mismos colores`,
       JSON.stringify(suyas) === JSON.stringify(claves),
       suyas.filter(c => !claves.includes(c)).concat(claves.filter(c => !suyas.includes(c))));
    ok(`y todos son colores válidos en ${nombre}`,
       Object.values(p).every(v => /^#[0-9A-Fa-f]{6}$/.test(v)),
       Object.entries(p).filter(([, v]) => !/^#[0-9A-Fa-f]{6}$/.test(v)));
  }
}

console.log('\nEL MODO');
{
  ok('automático de día da la de día', paleta('auto', alas(12)) === PALETAS.dia);
  ok('automático de noche da la de noche', paleta('auto', alas(22)) === PALETAS.noche);

  // El manual existe porque un túnel, una tormenta o un parabrisas
  // polarizado no los sabe el reloj.
  ok('forzar día gana al reloj', paleta('dia', alas(22)) === PALETAS.dia);
  ok('forzar noche también', paleta('noche', alas(12)) === PALETAS.noche);
  ok('esOscuro acompaña', esOscuro('noche', alas(12)) === true && esOscuro('dia', alas(22)) === false);

  // El botón cicla y VUELVE: si no cerrara el ciclo, quedarse en un modo
  // sería definitivo hasta reinstalar.
  let m = 'auto';
  const vistos = [];
  for (let i = 0; i < MODOS.length; i++) { vistos.push(m); m = siguienteModo(m); }
  ok('el botón pasa por los tres modos', new Set(vistos).size === MODOS.length, vistos);
  ok('y vuelve al principio', m === 'auto', m);
  ok('empieza en automático', MODOS[0] === 'auto', MODOS);
}

console.log('\nBORDES');
{
  for (const malo of [undefined, null, 'inventado', 42]) {
    const p = paleta(malo, alas(12));
    ok('un modo ' + JSON.stringify(malo) + ' cae en automático', p === PALETAS.dia, Object.keys(p).length);
  }
  ok('una fecha inválida no revienta', typeof esDeNoche(new Date('x')) === 'boolean');
  ok('sin fecha tampoco', typeof esDeNoche() === 'boolean');
  ok('siguienteModo de algo raro arranca el ciclo', MODOS.includes(siguienteModo('x')), siguienteModo('x'));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
