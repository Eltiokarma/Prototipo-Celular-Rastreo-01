// Banco de pruebas visual del rediseño: levanta el servidor con datos
// sembrados (unidades en ruta con brechas distintas, una fuera del recorrido,
// chat con SOS) y saca capturas de cada pantalla.
//
// Sirve para dos cosas: mirar el resultado, y enterarse de que la página
// reventó — cualquier error de JavaScript queda listado al final.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const interceptarHttps = require(S + '/cdn.js');
const fs = require('fs');

const DB = S + '/rediseno.db';
const P = 3111;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALIDA = process.env.SALIDA || S + '/shots';

// Circuito: un rectángulo alrededor del centro de Juliaca, para que las
// unidades se vean separadas en el mapa y no todas encimadas.
const LAT = -15.4904, LNG = -70.1333;
const g = 1 / 111320;
const anillo = (t) => {           // t de 0 a 1 sobre un rombo de ~2 km
  const v = t % 1;
  const r = 900;
  const ang = v * 2 * Math.PI;
  return { lat: LAT + g * r * Math.cos(ang), lng: LNG + g * r * Math.sin(ang) / Math.cos(LAT * Math.PI / 180) };
};

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99',
      STATE_INTERVAL_MS: '400',
      // Corto, para poder ver una unidad sin señal sin esperar los 30 s
      SIN_SENAL_MS: '3000', OLVIDAR_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = (ruta, opts = {}) =>
  fetch(`http://localhost:${P}${ruta}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// Todo lo que salió mal, para que quede listado al final en vez de perderse:
// errores de JavaScript de la página, y también los del armado del escenario
// —un alta que falla deja el panel vacío y la captura no lo dice.
const errores = [];

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  fs.mkdirSync(SALIDA, { recursive: true });
  await arrancar();

  const D = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: 'DESPACHO', password: 'despacho99' }) })).body;
  const H = { Authorization: 'Bearer ' + D.token, 'Content-Type': 'application/json' };

  // Nombre de cooperativa y de ruta que se lean como los de verdad
  const db0 = new Database(DB);
  db0.prepare("UPDATE companies SET name = 'Señor de Huayllani' WHERE companyId = (SELECT companyId FROM routes WHERE routeId = 'R-14')").run();
  db0.prepare("UPDATE routes SET name = 'Cerro Colorado ⇄ Centro', durationMin = 50, targetGapMin = 2, autoTarget = 0 WHERE routeId = 'R-14'").run();
  db0.close();

  // Trazado: el anillo completo como ida y el mismo al revés como vuelta
  const ida = Array.from({ length: 40 }, (_, i) => anillo(i / 78));
  const vuelta = Array.from({ length: 40 }, (_, i) => anillo(0.5 + i / 78));
  await fetch(`http://localhost:${P}/admin/routes/R-14/points`, {
    method: 'PUT', headers: H, body: JSON.stringify({ tramos: { ida, vuelta } }),
  });

  // Un segundo trazado, sin activar: es el caso que dispara el aviso del
  // trazador y la confirmación de cambio de medición.
  const db1 = new Database(DB);
  db1.prepare(`INSERT INTO route_variants (routeId, name, activa, createdAt)
               VALUES ('R-14', 'Variante feria', 0, ?)`).run(Date.now());
  const varianteFeria = db1.prepare("SELECT variantId FROM route_variants WHERE name = 'Variante feria'").get().variantId;
  db1.close();
  // Con recorrido dibujado: sin puntos, activarla está bloqueado a propósito
  // y la confirmación nunca llega a mostrarse.
  await fetch(`http://localhost:${P}/admin/routes/R-14/points`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      variantId: varianteFeria,
      tramos: {
        ida: ida.map(p => ({ lat: p.lat + g * 250, lng: p.lng })),
        vuelta: vuelta.map(p => ({ lat: p.lat + g * 250, lng: p.lng })),
      },
    }),
  });

  // El progreso sobre el circuito sale casi igual al parámetro del anillo, y
  // la brecha es esa diferencia por los 50 min de recorrido. Con eso se
  // eligen a mano los tres colores: 0.04 = 2:00 (objetivo, verde),
  // 0.05 = 2:30 (ámbar), 0.025 = 1:15 (pegadas, rojo).
  const gente = [
    ['M-08', 'Rufino Quispe', 0.000, false],
    ['M-12', 'Elmer Ccama', 0.040, false],
    ['M-03', 'Julia Mamani', 0.090, false],
    ['M-17', 'Wilber Apaza', 0.115, true],   // pegada a M-03 y fuera del recorrido
    ['M-05', 'Nilda Arapa', 0.160, false],
  ];

  // Los VEHÍCULOS primero, y después las personas arriba de ellos.
  //
  // Desde que la persona dejó de ser la unidad, el servidor descarta el GPS de
  // un chofer que no tiene combi asignada (`if (!vehicleId) return`), y dar de
  // alta un chofer sin combi existente es cosa del gerente, no de Despacho:
  // con la cuenta de Despacho el alta devolvía 403. Este banco seguía pidiendo
  // las altas como antes, así que las cinco fallaban, nadie reportaba posición
  // y las capturas salían con el panel vacío — sin un solo error a la vista.
  // Un banco visual que fotografía una pantalla vacía no verifica nada.
  const db2 = new Database(DB);
  const altaVehiculo = db2.prepare(
    'INSERT OR IGNORE INTO vehicles (vehicleId, label, routeId, companyId, createdAt) VALUES (?, ?, ?, ?, ?)');
  const empresaDeR14 = db2.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId;
  for (const [u] of [...gente, ['X-01']]) altaVehiculo.run(u, 'Placa ' + u, 'R-14', empresaDeR14, Date.now());
  db2.close();

  await pedir('/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ unitId: 'X-01', name: 'Reserva', vehicleId: 'X-01', password: 'chofer1234' }) });
  for (const [u, nombre] of gente) {
    const alta = await pedir('/admin/users', {
      method: 'POST', headers: H,
      body: JSON.stringify({ unitId: u, name: nombre, vehicleId: u, password: 'chofer1234' }),
    });
    // Que un alta falle en silencio es exactamente lo que dejó este banco
    // fotografiando una pantalla vacía. Que se oiga.
    if (alta.status !== 200) errores.push(`no se pudo dar de alta a ${u}: ${JSON.stringify(alta.body)}`);
  }

  const conectados = [];
  for (const [u, , t, fuera] of gente) {
    const s = (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: 'chofer1234' }) })).body;
    const ws = new WebSocket(`ws://localhost:${P}`);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'identify', token: s.token }));
    await sleep(250);
    conectados.push({ ws, t, fuera, u });
  }
  // El servidor no marca desvío hasta que se sostiene diez muestras seguidas
  // más allá de los 300 m: por eso hace falta esta cantidad de rondas, y no
  // dos. Son 12 posiciones por conexión, dentro del cupo de 40 por minuto.
  for (let ronda = 0; ronda < 12; ronda++) {
    for (const c of conectados) {
      const p = anillo(c.t + ronda * 0.0004);
      const desvio = c.fuera ? { lat: p.lat + g * 420, lng: p.lng } : p;
      c.ws.send(JSON.stringify({ type: 'gps', ...desvio, speed: 16 + (ronda % 4) * 4 }));
    }
    await sleep(900);
  }
  conectados[1].ws.send(JSON.stringify({ type: 'chat', text: 'Estoy pegado al de adelante, ¿espero en el paradero?', timestamp: Date.now() }));
  await sleep(400);
  conectados[3].ws.send(JSON.stringify({ type: 'sos', lat: anillo(0.30).lat, lng: anillo(0.30).lng, timestamp: Date.now() }));
  await sleep(1200);

  // Latido mientras el navegador arranca.
  //
  // Acá a una unidad se la da por callada a los 3 s (`SIN_SENAL_MS`, corto a
  // propósito para poder fotografiar una sin señal sin esperar los 30 s de
  // producción), y levantar Chromium, cargar la página y entrar lleva mucho
  // más que eso. Sin latido las cinco combis salían en la captura como SIN
  // SEÑAL y con las brechas en "—" — justo lo contrario de lo que este banco
  // existe para mostrar, que son los tres colores de brecha.
  //
  // Cada 2 s: por debajo del umbral de silencio y a 30 mensajes por minuto,
  // dentro del cupo de 40. Avanzan todas lo mismo, así que las distancias
  // entre ellas —o sea las brechas, o sea los colores— no cambian: la flota
  // se mueve y la foto sigue siendo la que se eligió.
  let avance = 12;
  const latido = setInterval(() => {
    avance++;
    for (const c of conectados) {
      const q = anillo(c.t + avance * 0.0004);
      const d = c.fuera ? { lat: q.lat + g * 420, lng: q.lng } : q;
      try { c.ws.send(JSON.stringify({ type: 'gps', ...d, speed: 18 })); } catch {}
    }
  }, 2000);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const abrir = async (ancho, alto) => {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2 });
    await interceptarHttps(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
    await p.goto(`http://localhost:${P}/despacho.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.fill('input[type="password"]', 'despacho99');
    await p.click('button:has-text("INGRESAR")');
    await p.waitForTimeout(4000);
    return p;
  };

  const p = await abrir(1400, 900);
  await p.screenshot({ path: SALIDA + '/01-despacho.png' });

  // Que la flota SE VEA. Es lo primero que este banco tiene que garantizar y
  // era justo lo que no verificaba: con el panel vacío las capturas salían
  // perfectas y no mostraban nada. Un mapa sin combis se fotografía igual de
  // bien que uno con combis.
  {
    const txt = await p.evaluate(() => document.body.innerText);
    const enPantalla = gente.filter(([u]) => txt.includes(u)).map(([u]) => u);
    if (enPantalla.length !== gente.length) {
      errores.push(`Despacho muestra ${enPantalla.length} de ${gente.length} unidades (${enPantalla.join(', ') || 'ninguna'})`);
    }
  }

  const pasos = (process.env.PASOS || '').split(',').filter(Boolean);
  for (const paso of pasos) {
    const [etiqueta, ...clicks] = paso.split('>');
    for (const c of clicks) {
      try {
        // "sel:<selector>|<valor>" elige en un <select>; el resto es un click
        if (c.startsWith('sel:')) {
          const [sel, valor] = c.slice(4).split('|');
          await p.selectOption(sel, valor, { timeout: 4000 });
        } else {
          await p.click(c, { timeout: 4000 });
        }
      } catch (e) { errores.push(`no se pudo operar ${c}: ${e.message.split('\n')[0]}`); }
      await p.waitForTimeout(1200);
    }
    await p.screenshot({ path: `${SALIDA}/${etiqueta}.png` });
  }

  // A M-05 se le apaga la pantalla: tiene que quedar en gris y con la hora
  // de su última posición, y sus brechas en "—". Las otras SIGUEN
  // reportando durante la espera; si no, se quedan calladas todas y la
  // captura no muestra la diferencia, que es lo único que se quiere ver.
  // Se corta el latido: de acá en adelante manda esta sección, que tiene su
  // propio ritmo. Los dos juntos pasarían el cupo de mensajes por minuto.
  clearInterval(latido);
  const apagada = conectados.find(c => c.u === 'M-05');
  apagada.ws.close();
  for (let ronda = 0; ronda < 9; ronda++) {
    for (const c of conectados) {
      if (c === apagada) continue;
      const q = anillo(c.t + (12 + ronda) * 0.0004);
      const d = c.fuera ? { lat: q.lat + g * 420, lng: q.lng } : q;
      c.ws.send(JSON.stringify({ type: 'gps', ...d, speed: 18 }));
    }
    await sleep(1000);
  }
  await p.screenshot({ path: SALIDA + '/02-sin-senal.png' });
  const txt = await p.evaluate(() => document.body.innerText);
  const calladas = (txt.match(/SIN SEÑAL/gi) || []).length;
  if (calladas === 0) errores.push('Despacho no marca la unidad que perdió señal');
  if (calladas > 1) errores.push(`Despacho marca ${calladas} unidades sin señal y solo una lo está`);

  const cel = await abrir(412, 900);
  await cel.screenshot({ path: SALIDA + '/99-celular.png' });

  console.log('capturas en', SALIDA);
  console.log('errores de la página:', errores.length ? errores : 'ninguno');
  await browser.close();
  conectados.forEach(c => c.ws.close());
  if (servidor) servidor.kill();
  await sleep(400);
  process.exit(errores.length ? 1 : 0);
})().catch(e => {
  console.error('EL BANCO SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
