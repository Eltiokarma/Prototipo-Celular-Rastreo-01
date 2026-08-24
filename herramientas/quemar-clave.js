// Calcula la HUELLA de una contraseña que ya no debe volver a usarse.
//
//   node herramientas/quemar-clave.js
//
// Pide la clave, no la muestra mientras se escribe, imprime su huella y se
// olvida de ella. La huella se pega en la variable `CLAVES_QUEMADAS` del
// despliegue, y desde ahí el servidor se niega a arrancar si alguien vuelve a
// poner esa clave.
//
// ═══ POR QUÉ SE PIDE POR TECLADO Y NO COMO ARGUMENTO ═══
// Escribirla como `node quemar-clave.js miclave` la dejaría en tres lugares a
// la vez: el historial del shell (`~/.bash_history`, que sobrevive al
// reinicio), la lista de procesos —cualquier usuario de la máquina puede
// hacer `ps` mientras corre— y, si esto se corriera en un servidor, en el log
// del sistema. Una herramienta para quemar un secreto que de paso lo publica
// en tres lados no sirve para nada. Por eso: teclado, sin eco, y si no hay
// terminal de verdad, se niega a funcionar.
//
// Lo que se imprime NO es la contraseña ni permite recuperarla: `scrypt` va en
// un solo sentido. Pero conviene saber que una huella de una contraseña corta
// y común sí se puede adivinar probando candidatas — la protección de verdad
// es que la clave NUEVA sea larga y aleatoria. Esta herramienta sirve para que
// nadie vuelva a la VIEJA por distracción, no para que la vieja siga siendo
// segura. Si se filtró, se filtró.
const { huella, motivoQuemada } = require('../server/claves');
const readline = require('readline');

function pedirSinEco(pregunta) {
  return new Promise((resolve, reject) => {
    // Sin terminal interactiva no hay forma de apagar el eco: mejor negarse
    // que escribir el secreto en pantalla o en un archivo de log.
    if (!process.stdin.isTTY) {
      reject(new Error(
        'esto necesita una terminal de verdad.\n' +
        '  No le pases la clave por tubería ni por archivo: quedaría guardada.\n' +
        '  Corré `node herramientas/quemar-clave.js` a mano y escribila cuando la pida.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const alEscribir = (s) => {
      // Se reescribe la línea sin los caracteres tecleados
      if (s.includes(pregunta)) rl.output.write(pregunta);
    };
    rl.output.write(pregunta);
    // A partir de acá lo que llegue no se hace eco
    rl._writeToOutput = alEscribir;
    rl.question('', (respuesta) => {
      rl.output.write('\n');
      rl.close();
      resolve(respuesta);
    });
  });
}

(async () => {
  console.log('');
  console.log('  QUEMAR UNA CLAVE');
  console.log('  ────────────────');
  console.log('  Escribí la clave que ya NO debe poder usarse más.');
  console.log('  No se va a ver mientras la escribís, y no se guarda en ningún lado.');
  console.log('');

  const clave = await pedirSinEco('  Clave a quemar: ');
  if (!clave) {
    console.error('\n  No escribiste nada. No se hizo nada.\n');
    process.exit(1);
  }

  const yaEstaba = motivoQuemada(clave);
  const h = huella(clave);

  console.log('');
  if (yaEstaba) {
    console.log('  Esta clave YA estaba rechazada:');
    console.log(`  ${yaEstaba}.`);
    console.log('  No hace falta que agregues nada — el servidor ya se niega a arrancar con ella.');
    console.log('');
    process.exit(0);
  }

  console.log('  Huella (esto NO es la clave, y no se puede volver atrás):');
  console.log('');
  console.log(`      ${h}`);
  console.log('');
  console.log('  Qué hacer con esto:');
  console.log('');
  console.log('    1. Pegala en la variable CLAVES_QUEMADAS de tu despliegue.');
  console.log('       Si ya tenía otras, separalas con coma:');
  console.log('');
  console.log(`           CLAVES_QUEMADAS=${h}`);
  console.log('');
  console.log('    2. Asegurate de que la clave NUEVA sea distinta, larga y aleatoria.');
  console.log('    3. Reiniciá. Si alguien vuelve a poner la vieja, no arranca.');
  console.log('');
  console.log('  La huella se puede guardar y compartir sin riesgo. La clave no.');
  console.log('');
})().catch((e) => {
  console.error('\n  No se pudo: ' + e.message + '\n');
  process.exit(1);
});
