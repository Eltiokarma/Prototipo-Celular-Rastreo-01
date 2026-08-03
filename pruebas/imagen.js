// Las cuentas de la foto (`app/imagen.js`).
//
// Son cuentas, y las cuentas mal hechas no se ven en la pantalla: se ven en
// la factura de datos del chofer. Una foto sin achicar en una ruta de veinte
// combis son veinte descargas, en Juliaca y con prepago.
const RAIZ = require('path').join(__dirname, '..');
const { medidaObjetivo, pesoAproximado, demasiadoPesada, esImagen, comoTexto,
        MAX_LADO, MAX_DATAURL } = require(RAIZ + '/app/imagen.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

console.log('\nA QUÉ MEDIDA SE ACHICA');
{
  // Una foto de celular de hoy. Horizontal: se limita el ancho.
  ok('una foto horizontal grande se limita por el ancho',
     JSON.stringify(medidaObjetivo(4000, 3000)) === JSON.stringify({ width: MAX_LADO }),
     medidaObjetivo(4000, 3000));

  // Vertical: se limita el ALTO. Si se limitara siempre el ancho, una foto
  // vertical quedaría 1280×1707 — más alta que el horizontal que se quería
  // acotar, o sea más pesada que el caso que sí se limitó.
  ok('una vertical se limita por el alto, no por el ancho',
     JSON.stringify(medidaObjetivo(3000, 4000)) === JSON.stringify({ height: MAX_LADO }),
     medidaObjetivo(3000, 4000));

  const v = medidaObjetivo(3000, 4000);
  ok('y nunca se piden las dos medidas juntas (deformaría la foto)',
     Object.keys(v).length === 1, v);
}

console.log('\nLO QUE YA ENTRA NO SE TOCA');
{
  // Pedir 1280 sobre una foto de 600 la AGRANDA: pesa más y no se ve mejor.
  // Es el error fácil de este código.
  ok('una foto chica no se agranda', medidaObjetivo(600, 800) === null, medidaObjetivo(600, 800));
  ok('una justo en el límite tampoco',
     medidaObjetivo(MAX_LADO, 900) === null, medidaObjetivo(MAX_LADO, 900));
  ok('una de un pixel más sí se achica',
     medidaObjetivo(MAX_LADO + 1, 900) !== null, medidaObjetivo(MAX_LADO + 1, 900));
  ok('una cuadrada grande se achica', medidaObjetivo(3000, 3000) !== null);
}

console.log('\nCUÁNTO PESA DE VERDAD');
{
  // El base64 infla 4/3. Tomar el largo de la cadena como peso sobreestima
  // un 33 % y hace rechazar fotos que entraban bien.
  const tres = Buffer.from([1, 2, 3]).toString('base64');           // sin relleno
  const dos  = Buffer.from([1, 2]).toString('base64');              // un '='
  const uno  = Buffer.from([1]).toString('base64');                 // dos '=='
  ok('3 bytes se leen como 3', pesoAproximado('data:image/jpeg;base64,' + tres) === 3);
  ok('2 bytes se leen como 2', pesoAproximado('data:image/jpeg;base64,' + dos) === 2);
  ok('1 byte se lee como 1',  pesoAproximado('data:image/jpeg;base64,' + uno) === 1);

  const mil = Buffer.alloc(1000).toString('base64');
  const medido = pesoAproximado('data:image/jpeg;base64,' + mil);
  ok('1000 bytes se leen como 1000', medido === 1000, medido);

  // Y NO como el largo de la cadena, que es lo que se rompería.
  ok('no confunde el peso con el largo de la cadena',
     medido < ('data:image/jpeg;base64,' + mil).length, [medido, mil.length]);
}

console.log('\nLA QUE NO VA A ENTRAR');
{
  // El servidor la descarta EN SILENCIO. Sin este chequeo el chofer ve su
  // foto salir y nunca se entera de que no llegó.
  const justa = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_DATAURL - 30);
  const pasada = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_DATAURL);
  ok('una que entra, pasa', demasiadoPesada(justa) === false, justa.length);
  ok('una que no entra, se avisa antes de mandarla', demasiadoPesada(pasada) === true, pasada.length);
  ok('y algo que no es una cadena también se rechaza',
     demasiadoPesada(null) === true && demasiadoPesada(undefined) === true);
}

console.log('\nQUÉ ES UNA IMAGEN');
{
  ok('un data-URL de imagen lo es', esImagen('data:image/jpeg;base64,AAA') === true);
  ok('un audio NO lo es', esImagen('data:audio/m4a;base64,AAA') === false);
  ok('una URL cualquiera tampoco', esImagen('https://ejemplo/foto.jpg') === false);
  ok('y nada tampoco', esImagen(null) === false && esImagen(undefined) === false);
}

console.log('\nCÓMO SE LE MUESTRA AL CHOFER');
{
  ok('kilobytes cuando son pocos', comoTexto(180 * 1024) === '180 kB', comoTexto(180 * 1024));
  ok('megabytes cuando son muchos', comoTexto(2.5 * 1024 * 1024) === '2.5 MB', comoTexto(2.5 * 1024 * 1024));
  ok('cero no revienta', comoTexto(0) === '0 kB', comoTexto(0));
  ok('basura tampoco', comoTexto(undefined) === '0 kB', comoTexto(undefined));
}

console.log('\nBORDES');
{
  for (const [a, b] of [[0, 0], [-100, 200], [NaN, 100], ['ancho', 'alto'], [undefined, undefined]]) {
    ok(`medidaObjetivo(${a}, ${b}) no revienta`, medidaObjetivo(a, b) === null, medidaObjetivo(a, b));
  }
  ok('pesoAproximado de algo sin coma da 0', pesoAproximado('sinbase64') === 0);
  ok('y de algo que no es cadena, también', pesoAproximado(null) === 0 && pesoAproximado(12) === 0);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
