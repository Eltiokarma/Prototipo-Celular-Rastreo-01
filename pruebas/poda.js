// El techo de filas del historial: que corte EXACTAMENTE lo mismo que antes.
//
// `podarHistorico()` recorta `laps`, `legs` y `messages` a un tope de filas.
// Estaba escrito como `id NOT IN (SELECT id … ORDER BY id DESC LIMIT @tope)`,
// que recorre la tabla entera aunque no haya nada para borrar — el caso normal,
// porque el techo es un cinturón. Medido con `herramientas/arranque.js` sobre
// 5000 unidades, esas consultas eran el 99 % del arranque: 5,4 s por reinicio
// para borrar cero filas, con el sistema caído mientras tanto.
//
// Ahora se corta por rango (`id <= (SELECT id … LIMIT 1 OFFSET @tope)`), que es
// equivalente porque `id` es INTEGER PRIMARY KEY. "Equivalente" es exactamente
// lo que hay que demostrar y no suponer: esto borra historial de verdad, y un
// borrado de más no se nota hasta que alguien pide un informe viejo y no está.
//
// Por eso la prueba corre LAS DOS FORMAS sobre copias idénticas y compara los
// ids que sobreviven, uno por uno. No cuenta filas: compara el conjunto.
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'));

const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'poda-'));
const limpiar = () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} };

const VIEJA = 'DELETE FROM t WHERE id NOT IN (SELECT id FROM t ORDER BY id DESC LIMIT ?)';
const NUEVA = 'DELETE FROM t WHERE id <= (SELECT id FROM t ORDER BY id DESC LIMIT 1 OFFSET ?)';

// Devuelve los ids que sobreviven al aplicar `sql` con ese tope.
function sobrevivientes(ids, sql, tope) {
  const db = new Database(path.join(DIR, 'x' + Math.random().toString(36).slice(2) + '.db'));
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, dato TEXT)');
  const ins = db.prepare('INSERT INTO t (id, dato) VALUES (?, ?)');
  db.transaction(() => { for (const i of ids) ins.run(i, 'x' + i); })();
  const borradas = db.prepare(sql).run(tope).changes;
  const quedan = db.prepare('SELECT id FROM t ORDER BY id').all().map(r => r.id);
  db.close();
  return { quedan, borradas };
}

const igual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Los ids NO son contiguos a propósito: después de podar por fecha quedan
// huecos, y una forma que dependa de que sean correlativos fallaría recién en
// producción, meses después del primer borrado.
const CON_HUECOS = [1, 2, 3, 7, 8, 15, 16, 17, 40, 41, 99, 100, 101, 500];
const CASOS = [
  ['tabla vacía', [], 5],
  ['una sola fila, tope holgado', [1], 10],
  ['el tope no aprieta (más tope que filas)', CON_HUECOS, 100],
  ['el tope justo == cantidad de filas', CON_HUECOS, CON_HUECOS.length],
  ['el tope aprieta por una fila', CON_HUECOS, CON_HUECOS.length - 1],
  ['el tope aprieta fuerte', CON_HUECOS, 3],
  ['tope 1: sobrevive sólo la más nueva', CON_HUECOS, 1],
  ['tope 0: se borra todo', CON_HUECOS, 0],
  ['ids correlativos', Array.from({ length: 200 }, (_, i) => i + 1), 60],
  ['ids muy separados', [1, 1000, 2_000_000, 9_000_000_000], 2],
];

let n = 0;
for (const [nombre, ids, tope] of CASOS) {
  const v = sobrevivientes(ids, VIEJA, tope);
  const nu = sobrevivientes(ids, NUEVA, tope);
  ok(`${++n}. ${nombre}`, igual(v.quedan, nu.quedan) && v.borradas === nu.borradas,
    `vieja deja [${v.quedan.slice(0, 6)}…] borró ${v.borradas} · nueva deja [${nu.quedan.slice(0, 6)}…] borró ${nu.borradas}`);
}

// Que la forma vieja no vuelva a entrar por descuido. Una prueba de semántica
// no sirve de nada si mañana alguien reescribe la consulta de producción con
// el patrón lento: acá se mide el archivo real, no una copia del SQL.
const fuente = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
for (const tabla of ['laps', 'legs', 'messages']) {
  const lento = new RegExp(`id NOT IN \\(SELECT id FROM ${tabla} ORDER BY id DESC LIMIT`);
  const rapido = new RegExp(`DELETE FROM ${tabla} WHERE id <= \\(SELECT id FROM ${tabla} ORDER BY id DESC LIMIT 1 OFFSET`);
  ok(`${++n}. ${tabla}: el techo se corta por rango, no con NOT IN`,
    !lento.test(fuente) && rapido.test(fuente),
    lento.test(fuente) ? 'volvió el NOT IN' : rapido.test(fuente) ? '' : 'no encontré el corte por rango');
}

limpiar();
