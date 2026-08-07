// Las dos palancas de ahorro que llevan código (`COSTOS.md` §5): el índice
// de vueltas y la compresión del WebSocket.
//
// El estado que cada ruta emite cada 3 s es el 90 % del egress a 2000
// unidades (~$518/mes) y los ~89 MB de datos móviles que el chofer paga por
// turno. Es JSON repetitivo —los mismos 17 nombres de campo por unidad, y
// cada estado casi idéntico al anterior—, así que permessage-deflate lo
// achica varias veces. Esta suite no confía en la teoría: levanta el
// servidor real, conecta un espectador que comprime y otro que no, les hace
// llegar los MISMOS estados y compara los bytes que pasaron por el cable.
//
// El que no comprime importa tanto como el que sí: el WebSocket de la app
// nativa (OkHttp) no ofrece la extensión, y tiene que seguir funcionando
// exactamente igual que hasta hoy.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const DB = S + '/compresion-test.db';
const P = 3176;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const LAT0 = -15.4904, LNG0 = -70.1333, gr = 1 / 111320;
const anillo = t => ({
  lat: LAT0 + gr * 900 * Math.cos(t * 2 * Math.PI),
  lng: LNG0 + gr * 900 * Math.sin(t * 2 * Math.PI) / Math.cos(LAT0 * Math.PI / 180),
});

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
           STATE_INTERVAL_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

// Un cliente WS que se identifica y anota lo que recibe. `deflate` es lo
// único que cambia entre los dos espectadores de la comparación.
async function conectar(token, deflate) {
  const ws = new WebSocket(`ws://localhost:${P}`, { perMessageDeflate: deflate });
  await new Promise((r, x) => { ws.on('open', r); ws.on('error', x); });
  const visto = { estados: 0, ultimo: null, chats: [] };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'state') { visto.estados++; visto.ultimo = m; }
    if (m.type === 'chat_msg') visto.chats.push(m.text);
  });
  ws.send(JSON.stringify({ type: 'identify', token }));
  await sleep(250);
  return { ws, visto, bytes: () => ws._socket.bytesRead };
}

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  console.log('\nEL ÍNDICE DE VUELTAS (palanca #4)');
  {
    // Sin él, cada carga de la pestaña de vueltas recorría la tabla entera:
    // 142 ms a base de régimen, bloqueando el hilo que atiende el GPS.
    const b = new Database(DB, { readonly: true });
    const indices = b.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'laps'").all().map(x => x.name);
    ok('laps tiene su índice por fecha de cierre', indices.includes('idx_laps_cierre'), indices);
    const plan = b.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM laps WHERE finishedAt >= ?').all(0).map(x => x.detail).join(' | ');
    ok('y la consulta del panel lo usa de verdad', /idx_laps_cierre/.test(plan), plan);
    b.close();
  }

  // Seis combis reportando y dos espectadores mirando la misma ruta: los
  // dos reciben los MISMOS estados, así que la única diferencia medible en
  // el cable es la compresión.
  const gerente = { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + await require('./gerente.js')(API, DB) };
  const flota = ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06'];
  for (const u of [...flota, 'M-07', 'M-08']) {
    await fetch(`${API}/admin/users`, { method: 'POST', headers: gerente,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'clave1234' }) });
  }

  const reporteros = [];
  for (let i = 0; i < flota.length; i++) {
    const s = await login(flota[i], 'clave1234');
    reporteros.push(await conectar(s.token, false));
  }
  // El espectador que comprime manda TODO comprimido (threshold 0): así el
  // camino de subida —el servidor descomprimiendo lo que le llega— también
  // queda probado, no solo el de bajada.
  const conDeflate = await conectar((await login('M-07', 'clave1234')).token, { threshold: 0 });
  const sinDeflate = await conectar((await login('M-08', 'clave1234')).token, false);

  console.log('\nLA NEGOCIACIÓN ES DE CADA CLIENTE');
  {
    ok('el que ofrece permessage-deflate lo consigue',
       /permessage-deflate/.test(String(conDeflate.ws.extensions)), String(conDeflate.ws.extensions));
    // La app nativa (OkHttp) no ofrece la extensión: esta conexión es ella.
    ok('el que no ofrece queda sin comprimir, como la app nativa',
       !/permessage-deflate/.test(String(sinDeflate.ws.extensions)), String(sinDeflate.ws.extensions));
  }

  // A rodar: cada combi reporta cada 400 ms (el cupo es 40/min por conexión,
  // acá van ~20) y el estado sale cada 400 ms. Baseline DESPUÉS de que el
  // primer estado ya circuló, para no contar login ni historial.
  let paso = 0;
  const rodando = setInterval(() => {
    paso++;
    reporteros.forEach((r, i) => {
      const q = anillo((i * 4 + paso * 0.2) / 100);
      r.ws.send(JSON.stringify({ type: 'gps', lat: q.lat, lng: q.lng, speed: 25 }));
    });
  }, 400);
  await sleep(1500);
  const base = { con: conDeflate.bytes(), sin: sinDeflate.bytes(),
                 estCon: conDeflate.visto.estados, estSin: sinDeflate.visto.estados };
  await sleep(6000);
  const delta = {
    con: conDeflate.bytes() - base.con,
    sin: sinDeflate.bytes() - base.sin,
    estCon: conDeflate.visto.estados - base.estCon,
    estSin: sinDeflate.visto.estados - base.estSin,
  };
  clearInterval(rodando);

  console.log('\nLOS MISMOS ESTADOS, MUCHOS MENOS BYTES');
  {
    ok('los dos vieron pasar estados de sobra', delta.estCon >= 5 && delta.estSin >= 5, delta);
    ok('y la misma cantidad — la comparación es justa',
       Math.abs(delta.estCon - delta.estSin) <= 3, delta);
    const u = conDeflate.visto.ultimo;
    ok('el estado llega entero a través de la compresión: las 6 unidades y sus brechas',
       u && u.units.length === 6 && typeof u.gaps === 'object',
       u && { units: u.units.length, gaps: Object.keys(u.gaps || {}).length });

    const porEstado = { con: delta.con / Math.max(1, delta.estCon),
                        sin: delta.sin / Math.max(1, delta.estSin) };
    // La estimación de COSTOS.md era 70-85 % menos. Acá se exige la mitad:
    // la suite defiende que la compresión ESTÁ y muerde, no un ratio exacto
    // que dependa del zlib del día.
    ok('el espectador que comprime recibió menos de la mitad de los bytes por estado',
       porEstado.con < porEstado.sin * 0.5,
       { bytesPorEstado: { con: Math.round(porEstado.con), sin: Math.round(porEstado.sin) } });
    console.log(`         (medido: ${Math.round(porEstado.sin)} B/estado sin comprimir → ` +
                `${Math.round(porEstado.con)} B comprimido, −${Math.round(100 - 100 * porEstado.con / porEstado.sin)} %)`);
  }

  console.log('\nLA SUBIDA COMPRIMIDA TAMBIÉN ES LA DE SIEMPRE');
  {
    // Del cliente que comprime al que no: si el servidor descomprimiera mal,
    // este texto no llegaría — o llegaría roto.
    const texto = 'Cambio de turno en el paradero de la salida — ' + 'x'.repeat(150);
    conDeflate.ws.send(JSON.stringify({ type: 'chat', text: texto }));
    for (let i = 0; i < 20 && !sinDeflate.visto.chats.length; i++) await sleep(150);
    ok('un chat mandado comprimido llega intacto al que no comprime',
       sinDeflate.visto.chats.includes(texto), sinDeflate.visto.chats.map(t => t.slice(0, 40)));
  }

  for (const r of [...reporteros, conDeflate, sinDeflate]) { try { r.ws.close(); } catch {} }
  servidor.kill();

  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA SUITE SE CAYÓ:', e.stack);
  try { servidor.kill(); } catch {}
  process.exit(1);
});
