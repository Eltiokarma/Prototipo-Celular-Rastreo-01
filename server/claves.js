// Las llaves de arranque: que ninguna instancia de verdad salga con una que
// ya no es secreta.
//
// ═══ POR QUÉ ESTO EXISTE ═══
// `CREATOR_PASSWORD` abre TODAS las cooperativas del servidor y estuvo escrita
// en un chat en texto plano. `DISPATCH_PASSWORD` administra a todos los
// choferes de una. Las dos se rotan a mano, y rotar a mano quiere decir que
// alguien se tiene que acordar — el día del despliegue, entre otras veinte
// cosas. Nadie se acuerda.
//
// Lo que este archivo hace NO es elegir contraseñas ni guardarlas. Es negarse
// a arrancar cuando la que hay ya está quemada, para que el olvido se note
// cuando todavía es barato: en el arranque, y no seis meses después.
//
// ═══ QUÉ CUENTA COMO QUEMADA ═══
// Tres familias, y las tres por el mismo motivo — alguien que no somos
// nosotros ya la puede escribir:
//
//   1. LAS DE ESTE REPOSITORIO. `despacho99` aparece en 37 archivos de
//      pruebas. El repositorio es público: esa clave es tan secreta como el
//      README. Es la que más riesgo tiene de terminar en un despliegue de
//      verdad, porque copiar la configuración de las pruebas es exactamente
//      lo que uno hace cuando tiene apuro.
//   2. LAS OBVIAS. `password`, `123456`, `admin`, `cambiame`. No hace falta
//      que se hayan filtrado: son las primeras que prueba cualquiera.
//   3. LAS QUE QUEMÓ EL DUEÑO. Las que pasaron por un chat, un correo o una
//      captura de pantalla. Ésas NO están acá y no pueden estarlo: nosotros no
//      las sabemos, y escribirlas en el repositorio sería publicarlas por
//      segunda vez. Van por `CLAVES_QUEMADAS` (ver abajo), como huellas.
//
// ═══ SE GUARDA LA HUELLA, NUNCA EL VALOR ═══
// Ni acá ni en la configuración del despliegue aparece una contraseña. Lo que
// se guarda es una huella `scrypt`, que va en un solo sentido: sirve para
// preguntar "¿es ésta?" y no para recuperarla.
//
// La sal es fija y está a la vista, y tiene que serlo: la huella se calcula en
// la máquina del dueño y se compara en el servidor, así que las dos puntas
// necesitan llegar al mismo resultado. Una sal por instalación daría huellas
// que no se pueden mover de una máquina a otra, que es justo lo que hace falta
// acá.
//
// Eso tiene un costo y conviene decirlo entero en vez de esconderlo: con sal
// fija, alguien podría precalcular huellas de contraseñas comunes y darlas
// vuelta. `scrypt` con estos parámetros hace que ese precálculo cueste caro, y
// las claves que este archivo protege tienen mínimos de largo — pero **una
// huella de una contraseña corta y común sigue siendo adivinable**. La
// protección de verdad no es la huella: es haber rotado a una clave larga y
// aleatoria. La huella sólo impide volver a la vieja por distracción.
const crypto = require('crypto');

// Deliberadamente lento. Son unas pocas comparaciones en el arranque y ninguna
// después, así que el costo no se paga en ningún camino caliente.
const SAL = 'coop-r14/claves-quemadas/v1';
const COSTO = { N: 16384, r: 8, p: 1 };

// La huella completa se corta a 32 hex. Alcanza de sobra para no chocar por
// accidente y hace más corta la línea que el dueño tiene que copiar.
function huella(clave) {
  const texto = String(clave == null ? '' : clave);
  if (!texto) return null;
  return crypto.scryptSync(texto, SAL, 32, COSTO).toString('hex').slice(0, 32);
}

// ─── LAS QUE VIAJAN CON EL CÓDIGO ────────────────────────────
// Huellas, no valores — aunque estas cuatro primeras estén igual a la vista en
// las pruebas, no hay razón para escribirlas una vez más. La lista se genera
// con `node herramientas/quemar-clave.js` y se pega acá.
const QUEMADAS = new Map([
  // Las de este repositorio (públicas por estar acá)
  [huella('despacho99'), 'es la clave de las pruebas de este repositorio'],
  [huella('clave-larga-del-creador'), 'es la clave de las pruebas de este repositorio'],
  [huella('escala99'), 'es la clave del banco de medición de este repositorio'],
  [huella('corta123'), 'es la clave de las pruebas de este repositorio'],
  // Las que prueba cualquiera, en el orden en que las prueba
  [huella('password'), 'es una de las primeras que prueba cualquiera'],
  [huella('Password1'), 'es una de las primeras que prueba cualquiera'],
  [huella('123456'), 'es una de las primeras que prueba cualquiera'],
  [huella('12345678'), 'es una de las primeras que prueba cualquiera'],
  [huella('admin'), 'es una de las primeras que prueba cualquiera'],
  [huella('administrador'), 'es una de las primeras que prueba cualquiera'],
  [huella('cambiame'), 'es una clave de relleno, no una clave'],
  [huella('changeme'), 'es una clave de relleno, no una clave'],
  [huella('contraseña'), 'es una clave de relleno, no una clave'],
  [huella('despacho'), 'es el nombre de la cuenta, no una clave'],
  [huella('creador'), 'es el nombre del panel, no una clave'],
  [huella('coopr14'), 'es el nombre del sistema, no una clave'],
]);

// ─── LAS QUE AGREGA EL DUEÑO ─────────────────────────────────
// `CLAVES_QUEMADAS` es una lista de huellas separadas por coma, y va en la
// configuración del despliegue y NO en el repositorio. Ése es el punto: la
// huella de la clave que se filtró en un chat vive al lado de la clave nueva
// que la reemplazó, en el único lugar donde las dos importan.
function quemadasDelEntorno() {
  return String(process.env.CLAVES_QUEMADAS || '')
    .split(/[,\s]+/).map(h => h.trim().toLowerCase()).filter(Boolean);
}

// Devuelve el motivo si está quemada, o null si no.
function motivoQuemada(clave) {
  const h = huella(clave);
  if (!h) return null;
  if (QUEMADAS.has(h)) return QUEMADAS.get(h);
  if (quemadasDelEntorno().includes(h)) {
    return 'está en la lista CLAVES_QUEMADAS de este despliegue';
  }
  return null;
}

// ─── LA REVISIÓN DEL ARRANQUE ────────────────────────────────
// Devuelve una lista de problemas. Vacía quiere decir que se puede arrancar.
// No imprime ni corta el proceso: eso lo decide quien llama, que es el único
// que sabe si esto es producción.
//
// Cada problema trae con qué arreglarlo. El que lo va a leer es alguien que no
// programa, mirando un servidor que no levanta, probablemente temprano y con
// gente esperando.
function revisarClaves(env = process.env, opciones = {}) {
  const { claveMinimaDespacho = 6, claveMinimaCreador = 12 } = opciones;
  const problemas = [];

  const despacho = env.DISPATCH_PASSWORD;
  const creador = env.CREATOR_PASSWORD;

  // ── DESPACHO ──
  // Que FALTE es un problema en sí mismo, y es el menos evidente de todos.
  // Sin esta variable la cuenta DESPACHO no se crea al arrancar, y entonces el
  // sistema queda en "bootstrap": mientras no exista ninguna cuenta capaz de
  // administrar, el primer login del mundo que use el nombre DESPACHO se la
  // queda, con la contraseña que mande y viendo TODAS las rutas. En un
  // servidor recién desplegado —justo cuando la base está vacía— esa ventana
  // está abierta y gana quien llegue primero.
  if (!despacho) {
    problemas.push({
      variable: 'DISPATCH_PASSWORD',
      que: 'no está puesta',
      porque: 'sin ella la cuenta DESPACHO no se crea al arrancar, y hasta que exista ' +
        'alguna cuenta de administración el primer login que use el nombre DESPACHO se ' +
        'la queda, con la clave que quiera y viendo todas las rutas.',
      como: 'poné DISPATCH_PASSWORD con una clave larga y nueva.',
    });
  } else if (despacho.length < claveMinimaDespacho) {
    problemas.push({
      variable: 'DISPATCH_PASSWORD',
      que: `tiene menos de ${claveMinimaDespacho} caracteres`,
      porque: 'es la cuenta que administra a todos los choferes de la cooperativa.',
      como: `poné una de ${claveMinimaDespacho} caracteres o más.`,
    });
  } else {
    const motivo = motivoQuemada(despacho);
    if (motivo) {
      problemas.push({
        variable: 'DISPATCH_PASSWORD',
        que: 'ya no es secreta',
        porque: `${motivo}. Cualquiera que la escriba entra como Despacho y administra ` +
          'a todos los choferes de la cooperativa.',
        como: 'poné una clave nueva, que no haya estado en ningún chat ni en ningún archivo.',
      });
    }
  }

  // ── CREADOR ──
  // Que falte NO es un problema: sin la variable el panel no se monta y sus
  // rutas ni existen. Apagado es el estado seguro, y es el que corresponde
  // mientras no haga falta. El largo mínimo tampoco se revisa acá — de eso ya
  // se ocupa `creador.js`, que en ese caso deja el panel apagado y sigue.
  //
  // Lo que sí se revisa es que no sea una quemada, y ahí no alcanza con apagar
  // el panel: si está puesta, alguien la puso a propósito, y dejarla ahí
  // callados significa que la clave filtrada se queda en la configuración del
  // despliegue para siempre. Que el servidor no arranque es lo único que
  // obliga a mirarla.
  if (creador) {
    const motivo = motivoQuemada(creador);
    if (motivo) {
      problemas.push({
        variable: 'CREATOR_PASSWORD',
        que: 'ya no es secreta',
        porque: `${motivo}. Es la ÚNICA llave que abre TODAS las cooperativas del ` +
          'servidor: quien entra puede crear una cooperativa, crearse un supervisor ' +
          'adentro y mirar lo que quiera de cualquiera de ellas.',
        como: 'poné una clave nueva, larga y aleatoria. Después agregá la huella de la ' +
          'vieja a CLAVES_QUEMADAS con `node herramientas/quemar-clave.js`, para que ' +
          'nadie pueda volver a ponerla por distracción.',
      });
    }
  }

  // Que las dos sean la misma no es "quemada", pero es un solo secreto
  // haciendo dos trabajos: quien consigue el de la cooperativa consigue el de
  // todas. Vale la pena frenar por eso.
  if (despacho && creador && despacho === creador) {
    problemas.push({
      variable: 'CREATOR_PASSWORD',
      que: 'es igual a DISPATCH_PASSWORD',
      porque: 'son dos niveles distintos y tienen que ser dos secretos distintos. Así ' +
        'como está, quien consigue la clave de una cooperativa consigue la de todas.',
      como: 'poné una clave distinta en cada una.',
    });
  }

  return problemas;
}

module.exports = { huella, motivoQuemada, revisarClaves };
