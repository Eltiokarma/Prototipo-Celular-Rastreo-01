// La salud del servidor (PENDIENTES 0.2, 03/11).
//
// `/ping` contestaba «pong» aunque la base no escribiera, y el disco lleno no
// avisaba a nadie: lo decían los choferes («no me deja entrar»). Acá:
//
//   - el módulo (`server/salud.js`), con bases y discos de mentira: base que
//     no escribe, errores de base recientes que se olvidan solos, disco poco
//     y disco lleno, respaldo que nunca hubo o viejo, base en memoria (grave
//     en producción, aviso en la demo), WAL, y lo público sin números;
//   - la vigilancia: avisa sólo cuando el estado cambia, no cada minuto;
//   - el webhook: JSON con `text`/`content` (Slack, Discord), texto plano
//     para ntfy;
//   - y el servidor de verdad: `/salud` contesta 200 sano, 503 con el disco
//     «lleno», el webhook recibe la alerta sola, `/ping` sigue vivo, y el
//     panel del creador trae los números.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const http = require('http');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const { crearSalud, vigilar, avisarAfuera, textoDeAlerta } = require(RAIZ + '/server/salud.js');
const fs = require('fs');

const DB = S + '/salud.db';
const P = 3185;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const borrar = (f) => { for (const x of [f, f + '-wal', f + '-shm']) { try { fs.unlinkSync(x); } catch {} } };

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un webhook de mentira: anota lo que le llega
function webhook(puerto) {
  const recibidos = [];
  const srv = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', d => { cuerpo += d; });
    req.on('end', () => {
      recibidos.push({ url: req.url, tipo: req.headers['content-type'], titulo: req.headers.title, cuerpo });
      res.end('ok');
    });
  }).listen(puerto);
  return { recibidos, cerrar: () => srv.close() };
}

let servidor = null;
async function arrancar(env = {}) {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.log = '';
  servidor.stdout.on('data', d => { servidor.log += d; });
  servidor.stderr.on('data', d => { servidor.log += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(`http://localhost:${P}/ping`); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}
const parar = async () => { servidor.kill(); await sleep(400); };

(async () => {
  const sinBucle = { medirBucle: false };

  console.log('\nLA BASE');
  {
    // Lee pero no escribe: la del disco lleno
    const base = new Database(':memory:');
    const falsa = {
      name: S + '/no-existe.db', memory: false, exec: () => {},
      prepare: (sql) => ({
        get: () => ({ 1: 1 }),
        run: () => { const e = new Error('database or disk is full'); e.code = 'SQLITE_FULL'; throw e; },
      }),
      pragma: () => 'wal',
    };
    const r = crearSalud({ db: falsa, demo: true, discoCriticoMb: 0, discoAvisoMb: 0, ...sinBucle }).chequear();
    ok('la que no escribe es un PROBLEMA, no un aviso', r.ok === false && r.estado === 'falla' && r.problemas.includes('base_no_escribe'), r.problemas);
    ok('y cuenta como error de base', r.numeros.erroresDeBase === 1 && r.numeros.ultimoErrorDeBase === 'SQLITE_FULL', r.numeros);
    base.close();

    const enMemoria = new Database(':memory:');
    const prod = crearSalud({ db: enMemoria, demo: false, ...sinBucle }).chequear();
    ok('en memoria, en producción: problema', prod.problemas.includes('base_en_memoria') && prod.ok === false);
    const demo = crearSalud({ db: enMemoria, demo: true, ...sinBucle }).chequear();
    ok('en memoria, en la demo: aviso', demo.avisos.includes('base_en_memoria') && demo.ok === true, demo);
    enMemoria.close();
  }

  console.log('\nLOS ERRORES DE OTROS LADOS');
  {
    borrar(DB);
    const db = new Database(DB);
    db.pragma('journal_mode = WAL');
    let t = 1_000_000;
    const s = crearSalud({ db, demo: true, discoCriticoMb: 0, discoAvisoMb: 0, ahora: () => t, ventanaErroresMs: 60_000, ...sinBucle });
    ok('sana, sin respaldo que mirar: ok', s.chequear().estado === 'ok' || s.chequear().avisos.every(a => a === 'zona_horaria_utc'), s.chequear());
    ok('un error que no es de base no cuenta', s.anotarFallaDeBase(new Error('otra cosa')) === false);
    const e = new Error('disk I/O error'); e.code = 'SQLITE_IOERR';
    s.anotarFallaDeBase(e);
    const r = s.chequear();
    ok('un error de base reciente es un problema', r.problemas.includes('errores_de_base') && r.numeros.ultimoErrorDeBase === 'SQLITE_IOERR', r);
    t += 61_000;
    ok('pasada la ventana, se olvida solo', !s.chequear().problemas.includes('errores_de_base'));
    db.close();
  }

  console.log('\nEL DISCO, EL RESPALDO, EL WAL');
  {
    const db = new Database(DB);
    const lleno = crearSalud({ db, demo: true, discoCriticoMb: 1e9, discoAvisoMb: 1e9, ...sinBucle }).chequear();
    ok('menos libre que el mínimo: disco_lleno, problema', lleno.problemas.includes('disco_lleno') && lleno.numeros.discoLibreMb > 0, lleno.numeros);
    const poco = crearSalud({ db, demo: true, discoCriticoMb: 0, discoAvisoMb: 1e9, ...sinBucle }).chequear();
    ok('menos que el aviso: disco_poco, aviso', poco.avisos.includes('disco_poco') && poco.ok === true);

    const t = Date.now();
    const sinNinguno = { CADA_HORAS: 6, dirDe: () => S, listar: () => [] };
    ok('sin ningún respaldo: aviso', crearSalud({ db, respaldo: sinNinguno, demo: true, discoCriticoMb: 0, discoAvisoMb: 0, ...sinBucle })
      .chequear().avisos.includes('respaldo_nunca'));
    const viejo = { CADA_HORAS: 6, dirDe: () => S, listar: () => [{ archivo: 'x.db', cuando: t - 13 * 3600_000 }] };
    const rv = crearSalud({ db, respaldo: viejo, demo: true, discoCriticoMb: 0, discoAvisoMb: 0, ...sinBucle }).chequear();
    ok('uno de hace 13 h con el automático cada 6: viejo', rv.avisos.includes('respaldo_viejo') && rv.numeros.respaldoHaceMin === 780, rv.numeros);
    const fresco = { CADA_HORAS: 6, dirDe: () => S, listar: () => [{ archivo: 'x.db', cuando: t - 3600_000 }] };
    ok('uno de hace una hora: nada', !crearSalud({ db, respaldo: fresco, demo: true, ...sinBucle }).chequear().avisos.some(a => /respaldo/.test(a)));

    db.pragma('journal_mode = DELETE');
    ok('sin WAL: aviso', crearSalud({ db, demo: true, ...sinBucle }).chequear().avisos.includes('sin_wal'));
    db.close();
  }

  console.log('\nLO PÚBLICO');
  {
    const db = new Database(DB);
    const s = crearSalud({ db, demo: true, discoCriticoMb: 1e9, ...sinBucle });
    const p = s.publico();
    ok('dice qué pasa, en castellano', p.ok === false && p.problemas.includes('disco_lleno') &&
       p.detalle.some(d => /muy poco disco/.test(d)), p);
    ok('sin números ni rutas', !('numeros' in p) && !JSON.stringify(p).includes(S));
    db.close();
  }

  console.log('\nLA VIGILANCIA AVISA CUANDO CAMBIA');
  {
    const estados = ['ok', 'ok', 'falla', 'falla', 'ok', 'ok'];
    let i = 0;
    const falsa = { chequear: () => {
      const e = estados[Math.min(i++, estados.length - 1)];
      return { estado: e, ok: e !== 'falla', problemas: e === 'falla' ? ['disco_lleno'] : [], avisos: [] };
    } };
    const cambios = [];
    const v = vigilar(falsa, { cadaMs: 1e9, alCambiar: (r) => cambios.push(r.estado) });
    for (let k = 0; k < 6; k++) v.mirar();
    v.detener();
    ok('arrancar sano no avisa; avisa al caer y al volver, una vez cada uno', JSON.stringify(cambios) === '["falla","ok"]', cambios);
    const cambios2 = [];
    const v2 = vigilar({ chequear: () => ({ estado: 'aviso', ok: true, problemas: [], avisos: ['respaldo_viejo'] }) },
      { cadaMs: 1e9, alCambiar: (r) => cambios2.push(r.estado) });
    v2.mirar(); v2.mirar(); v2.detener();
    ok('arrancar mal sí avisa, una vez', JSON.stringify(cambios2) === '["aviso"]', cambios2);
  }

  console.log('\nEL WEBHOOK');
  {
    const w = webhook(P + 100);
    const r = { estado: 'falla', ok: false, problemas: ['base_no_escribe'], avisos: ['respaldo_viejo'] };
    ok('Slack/Discord: contesta bien', await avisarAfuera(`http://localhost:${P + 100}/hook`, r, 'flota-prueba') === true);
    const j = JSON.parse(w.recibidos[0].cuerpo);
    ok('JSON con text y content, y lo que pasa en castellano',
       /application\/json/.test(w.recibidos[0].tipo) && j.text === j.content && /flota-prueba: PROBLEMA/.test(j.text) &&
       /no puede escribir/.test(j.text) && j.estado === 'falla', j);
    await avisarAfuera(`http://localhost:${P + 100}/ntfy-flota`, r, 'flota-prueba');
    ok('ntfy: texto plano con título', /text\/plain/.test(w.recibidos[1].tipo) && /falla/.test(w.recibidos[1].titulo || '') &&
       /flota-prueba: PROBLEMA/.test(w.recibidos[1].cuerpo), w.recibidos[1]);
    ok('un webhook que no contesta no rompe nada', await avisarAfuera('http://localhost:1/nada', r, 'x') === false);
    ok('y al volver dice que volvió', /volvió a estar bien/.test(textoDeAlerta({ estado: 'ok', problemas: [], avisos: [] }, 'x')));
    w.cerrar();
  }

  console.log('\nEL SERVIDOR DE VERDAD');
  borrar(DB);
  await arrancar({ TZ: 'America/Lima', DISCO_CRITICO_MB: '0', DISCO_AVISO_MB: '0', CREATOR_PASSWORD: 'clave-larga-del-creador' });
  await sleep(1500);                                   // el respaldo del arranque
  let r = await fetch(`http://localhost:${P}/salud`);
  let cuerpo = await r.json();
  ok('sano: 200, ok', r.status === 200 && cuerpo.ok === true, cuerpo);
  ok('sin números en lo público', !('numeros' in cuerpo) && !/discoLibre|\/pruebas\//.test(JSON.stringify(cuerpo)));
  const login = await fetch(`http://localhost:${P}/creador/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'clave-larga-del-creador' }) }).then(x => x.json());
  const sistema = await fetch(`http://localhost:${P}/creador/sistema`, { headers: { Authorization: 'Bearer ' + login.token } }).then(x => x.json());
  ok('el panel del creador trae la salud con sus números',
     !!sistema.salud && sistema.salud.numeros.discoLibreMb > 0 && sistema.salud.numeros.zonaHoraria === 'America/Lima', sistema.salud);
  await parar();

  const w = webhook(P + 101);
  await arrancar({ TZ: 'America/Lima', DISCO_CRITICO_MB: '1000000000', SALUD_CADA_MS: '300',
    ALERTA_URL: `http://localhost:${P + 101}/alerta`, SERVIDOR_NOMBRE: 'flota-prueba' });
  r = await fetch(`http://localhost:${P}/salud`);
  cuerpo = await r.json();
  ok('con el disco «lleno»: 503 y dice por qué', r.status === 503 && cuerpo.estado === 'falla' && cuerpo.problemas.includes('disco_lleno'), cuerpo);
  ok('/ping sigue diciendo que el proceso vive', (await fetch(`http://localhost:${P}/ping`)).status === 200);
  for (let i = 0; i < 30 && !w.recibidos.length; i++) await sleep(200);
  ok('el webhook recibió la alerta solo, sin que nadie pregunte',
     w.recibidos.length >= 1 && /flota-prueba: PROBLEMA/.test(JSON.parse(w.recibidos[0].cuerpo).text), w.recibidos.map(x => x.cuerpo));
  await sleep(1500);
  ok('y una sola vez mientras no cambie', w.recibidos.length === 1, w.recibidos.length);
  ok('el log lo dice fuerte', /SALUD: ✖ flota-prueba: PROBLEMA/.test(servidor.log));
  await parar();
  w.cerrar();

  borrar(DB);
  console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO EN ORDEN');
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('LA PRUEBA SE CAYÓ:', e.stack);
  if (servidor) servidor.kill();
  process.exit(1);
});
