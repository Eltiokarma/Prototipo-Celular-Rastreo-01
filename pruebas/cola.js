// La cola de posiciones de la app nativa (`app/cola.js`).
//
// Sin servidor: la cola es lógica pura. Lo que defiende es que un tramo sin
// datos no deje un agujero en el historial, y que al volver la señal no se
// vacíe de golpe contra el cupo del servidor —que descarta EN SILENCIO— y se
// pierda casi todo sin que nadie se entere.
const RAIZ = require('path').join(__dirname, '..');
const { crearCola } = require(RAIZ + '/app/cola.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const pos = (i) => ({ lat: -15.49 + i * 1e-4, lng: -70.13, speed: 20, timestamp: 1000 + i });

console.log('\nGUARDAR Y ENTREGAR');
{
  const c = crearCola();
  for (let i = 0; i < 5; i++) c.guardar(pos(i));
  ok('guarda lo que se le da', c.largo === 5, c.largo);
  ok('entrega en orden, la más vieja primero',
     c.proximas(3).map(p => p.timestamp).join(',') === '1000,1001,1002',
     c.proximas(3).map(p => p.timestamp));
  ok('mirar no consume', c.largo === 5, c.largo);
  c.confirmar(3);
  ok('confirmar sí consume, y solo lo confirmado', c.largo === 2 && c.primera.timestamp === 1003,
     { largo: c.largo, primera: c.primera });
}

console.log('\nLA HORA ES LA DE LA POSICIÓN, NO LA DEL ENVÍO');
{
  const c = crearCola();
  c.guardar(pos(7));
  ok('se conserva el timestamp original',
     c.primera.timestamp === 1007, c.primera);
  // Si se pisara con la hora del envío, al reconectar el servidor recibiría
  // diez posiciones con la misma hora y el recorrido quedaría hecho un nudo.
  ok('y no se reemplaza por "ahora"', c.primera.timestamp < Date.now());
}

console.log('\nSI EL CORTE ES LARGO');
{
  const c = crearCola({ tope: 10 });
  for (let i = 0; i < 25; i++) c.guardar(pos(i));
  ok('no crece sin límite', c.largo === 10, c.largo);
  ok('se tiran las MÁS VIEJAS, no las nuevas',
     c.primera.timestamp === 1015 && c.ultima.timestamp === 1024,
     { primera: c.primera.timestamp, ultima: c.ultima.timestamp });
  ok('y dice cuántas tiró, en vez de perderlas en silencio',
     c.descartadas === 15, c.descartadas);
}

console.log('\nAL VOLVER LA SEÑAL');
{
  const c = crearCola();
  for (let i = 0; i < 300; i++) c.guardar(pos(i));
  // El servidor corta a 40 GPS por minuto. Vaciar de golpe haría que
  // descarte casi todo sin avisar: se entrega de a tandas.
  const tanda = c.proximas(30);
  ok('se puede pedir de a tandas y no todo junto', tanda.length === 30, tanda.length);
  ok('la cola no se toca hasta confirmar', c.largo === 300, c.largo);

  // Corte a la mitad de la descarga: lo no enviado tiene que seguir ahí.
  c.confirmar(12);
  ok('si se corta a la mitad, lo no enviado sobrevive',
     c.largo === 288 && c.primera.timestamp === 1012,
     { largo: c.largo, primera: c.primera.timestamp });
}

console.log('\nBORDES');
{
  const c = crearCola();
  ok('una posición sin coordenadas no entra', c.guardar({ speed: 10 }) === false && c.largo === 0);
  ok('null tampoco', c.guardar(null) === false);
  ok('vacía, no revienta al pedirle', c.proximas(5).length === 0 && c.primera === null);
  c.guardar(pos(1));
  c.confirmar(99);
  ok('confirmar de más no rompe nada', c.largo === 0, c.largo);
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
