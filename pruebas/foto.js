// Las fotos, contra el servidor de verdad.
//
// Levanta su propio servidor y manda fotos con el mismo cliente que va a usar
// la app. Lo que defiende:
//
//   - que una foto de más NO pase, porque el reparto lo pagan todos los que
//     la reciben y no el que la manda;
//   - que el tope del cliente y el del servidor sean el MISMO número. Están
//     escritos en dos archivos distintos, y si se separan aparece el peor de
//     los dos mundos: el cliente cree que la mandó y el servidor la tira **en
//     silencio**. El chofer nunca se entera;
//   - que una foto privada no se filtre al grupo, que es la misma regla del
//     texto y de la voz — y ahora las tres comparten el código que la aplica;
//   - que las fotos viejas suelten la imagen sin llevarse los audios puestos.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const { crearCliente } = require(RAIZ + '/app/protocolo/cliente.js');
const { MAX_DATAURL } = require(RAIZ + '/app/imagen.js');
const fs = require('fs');

const DB = S + '/foto-test.db';
const P = 3147;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Una "foto" del tamaño que se pida. No hace falta que sea un JPEG de verdad:
// el servidor mira el prefijo y el tamaño, que es exactamente lo que se está
// probando.
const foto = (largo) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.max(0, largo - 23));

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', STATE_INTERVAL_MS: '600',
           // Con los 20 de producción no se puede probar la poda: el cupo es
           // de 6 fotos por minuto, así que llegar a 20 lleva cuatro minutos.
           // Con 3 se prueba la MISMA regla en segundos.
           PHOTO_KEEP: '3' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const nuevo = () => crearCliente({ servidor: API, WebSocketImpl: WebSocket });

async function hasta(cond, ms = 6000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(120); }
  return false;
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const despacho = nuevo();
  const d = await despacho.entrar('DESPACHO', 'despacho99');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token };
  const HG = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  for (const [u, n] of [['M-08', 'Rufino Quispe'], ['M-12', 'Elmer Ccama']]) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: n, password: 'chofer1234' }) });
  }

  const c08 = nuevo(), c12 = nuevo();
  const s08 = await c08.entrar('M-08', 'chofer1234');
  const s12 = await c12.entrar('M-12', 'chofer1234');
  const recibidas08 = [], recibidas12 = [], recibidasD = [];
  c08.on('foto', m => recibidas08.push(m));
  c12.on('foto', m => recibidas12.push(m));
  despacho.on('foto', m => recibidasD.push(m));
  c08.conectar(s08.token);
  c12.conectar(s12.token);
  despacho.conectar(d.token);
  await hasta(() => c08.conectado && c12.conectado && despacho.conectado);

  console.log('\nUNA FOTO AL GRUPO');
  {
    const r = c08.mandarFoto({ data: foto(5000), text: 'se rompió el eje' });
    ok('el cliente la acepta', r === null, r);
    ok('le llega al otro chofer', await hasta(() => recibidas12.length === 1));
    const m = recibidas12[0];
    ok('con la imagen entera', m?.data?.length === 5000, m?.data?.length);
    ok('con el pie de foto', m?.text === 'se rompió el eje', m?.text);
    ok('firmada por quien la sacó', m?.unitId === 'M-08' && m?.driverName === 'Rufino Quispe', m);
    ok('y también a Despacho', await hasta(() => recibidasD.length === 1));
  }

  console.log('\nEL TOPE ES EL MISMO EN LOS DOS LADOS');
  {
    // Éste es el punto de la suite. Si el cliente permite más que el
    // servidor, la foto sale y se pierde SIN AVISO — el chofer la ve salir y
    // Despacho nunca la recibe.
    const antes = recibidas12.length;
    const r = c08.mandarFoto({ data: foto(MAX_DATAURL + 1000) });
    ok('el cliente frena la que no va a entrar', r === 'muy-pesada', r);

    // Y si igual se colara (un cliente viejo, otro cliente), el servidor la tira.
    const crudo = new WebSocket(`ws://localhost:${P}`);
    await new Promise(res => crudo.on('open', res));
    crudo.send(JSON.stringify({ type: 'identify', token: s08.token }));
    await sleep(400);
    crudo.send(JSON.stringify({ type: 'photo', data: foto(MAX_DATAURL + 200_000), timestamp: Date.now() }));
    await sleep(700);
    ok('y el servidor también la descarta', recibidas12.length === antes, recibidas12.length - antes);

    // La de justo por debajo del tope SÍ tiene que pasar: un tope que rechaza
    // de más es igual de roto, solo que en silencio y a favor de nadie.
    crudo.send(JSON.stringify({ type: 'photo', data: foto(MAX_DATAURL - 500), timestamp: Date.now() }));
    ok('la que entra justo, pasa', await hasta(() => recibidas12.length === antes + 1),
       recibidas12.length - antes);
    crudo.close();
  }

  console.log('\nUNA FOTO PRIVADA NO SE FILTRA');
  {
    // Misma regla que el texto y la voz. Ahora las tres comparten el código
    // que la aplica, así que esto también cuida a las otras dos.
    const antes12 = recibidas12.length, antes08 = recibidas08.length;
    c08.mandarFoto({ data: foto(4000), text: 'para despacho', privado: true });
    ok('le llega a Despacho', await hasta(() => recibidasD.some(m => m.text === 'para despacho')));
    await sleep(600);
    ok('y NO al otro chofer', recibidas12.length === antes12, recibidas12.length - antes12);
    ok('el que la mandó sí la ve (es su conversación)',
       recibidas08.length > antes08, recibidas08.length - antes08);
  }

  console.log('\nLO QUE NO ES UNA FOTO');
  {
    const antes = recibidas12.length;
    ok('un audio mandado como foto se rechaza',
       c08.mandarFoto({ data: 'data:audio/m4a;base64,AAAA' }) === 'formato');
    ok('una URL cualquiera también',
       c08.mandarFoto({ data: 'https://ejemplo/foto.jpg' }) === 'formato');
    ok('y nada, también', c08.mandarFoto({ data: null }) === 'formato');
    await sleep(400);
    ok('nada de eso llegó a nadie', recibidas12.length === antes);
  }

  console.log('\nLAS VIEJAS SUELTAN LA IMAGEN, LOS AUDIOS NO SE VAN CON ELLAS');
  {
    // El servidor conserva las N fotos y las 30 notas de voz más recientes
    // (acá N = 3, ver arranque). Se poda POR TIPO a propósito: una ráfaga de
    // fotos no puede borrarle el audio a la nota de voz que hace falta
    // escuchar. Son dos presupuestos separados, no uno compartido.
    c08.mandarVoz({ data: 'data:audio/m4a;base64,' + 'A'.repeat(2000), duration: 5 });
    await sleep(300);
    // Seis: por debajo del cupo de 6/min de M-08 más las de M-12, y por
    // encima de los 3 que se conservan.
    for (const [quien, cuantas] of [[c08, 3], [c12, 3]]) {
      for (let i = 0; i < cuantas; i++) {
        quien.mandarFoto({ data: foto(3000), text: 'r' + i });
        await sleep(80);
      }
    }
    await sleep(1200);

    const nuevoCliente = nuevo();
    const sN = await nuevoCliente.entrar('M-12', 'chofer1234');
    let historial = null;
    nuevoCliente.on('historial', h => { historial = h; });
    nuevoCliente.conectar(sN.token);
    ok('llega el historial', await hasta(() => historial !== null));

    const fotos = (historial || []).filter(m => m.kind === 'photo');
    const conImagen = fotos.filter(m => m.data);
    ok('solo las últimas conservan la imagen', conImagen.length === 3, conImagen.length);
    ok('pero la burbuja de las viejas sigue estando',
       fotos.length > conImagen.length, [fotos.length, conImagen.length]);

    // Ésta es la que importa: si la poda fuera compartida, la ráfaga de
    // fotos se habría llevado puesto el audio.
    const voces = (historial || []).filter(m => m.kind === 'voice' && m.data);
    ok('y la nota de voz conservó su audio pese a la ráfaga de fotos', voces.length === 1, voces.length);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('FALLA  ' + e.message);
  if (servidor) servidor.kill();
  process.exit(1);
});
