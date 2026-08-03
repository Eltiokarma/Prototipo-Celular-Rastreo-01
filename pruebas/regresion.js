// Corre la regresión completa.
//
// Ocho suites esperan un servidor ya levantado en 3001 y hablan con SU base
// —unas por DBFILE y otras por DB_FILE, de ahí que se pasen las dos—. No son
// re-entrantes entre sí: cada una asume una base recién creada (turnos cuenta
// los turnos que hay, objetivo cuenta las vueltas). Por eso cada suite se
// corre contra su propio servidor y su propio archivo, y no todas contra uno
// compartido. Las de PROPIAS levantan el suyo solas.
const RAIZ = require('path').join(__dirname, '..');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const S = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const COMPARTIDAS = ['tramos', 'objetivo', 'informes', 'desvio', 'turnos', 'privado', 'seguridad', 'empresas'];
const PROPIAS = ['variantes', 'brecha', 'creador', 'gerencia', 'cliente', 'senal', 'gpshttp', 'foto',
                 'hud', 'chat', 'cola', 'margenes', 'gestos', 'imagen', 'tema', 'nativas'];

const correr = (suite, env) => new Promise((resolve) => {
  let salida = '';
  const p = spawn('node', [S + '/' + suite + '.js'], {
    env: { ...process.env, SP: S, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', d => { salida += d; });
  p.stderr.on('data', d => { salida += d; });
  p.on('exit', (code) => {
    const fallas = (salida.match(/FALLA/g) || []).length;
    resolve({ suite, ok: code === 0 && fallas === 0, code, fallas, salida });
  });
});

const responde = () => fetch('http://localhost:3001/ping').then(() => true, () => false);

// Esperar a que el puerto quede LIBRE antes de levantar el siguiente. Sin
// esto, el servidor nuevo no puede atarse a 3001, se muere, y la suite le
// habla al de la suite anterior — con la base de la anterior. Todo pasa o
// falla por motivos que no tienen nada que ver con el código.
async function esperarLibre() {
  for (let i = 0; i < 40; i++) {
    if (!(await responde())) return;
    // A los 10 s deja de ser "todavía se está apagando" y pasa a ser un
    // servidor colgado de una corrida anterior. Se lo saca del medio.
    if (i === 40 - 1) { try { execFileSync('pkill', ['-f', 'server/index.js']); } catch {} }
    await sleep(250);
  }
  await sleep(1000);
  if (await responde()) throw new Error('el puerto 3001 sigue ocupado');
}

async function conServidor(db, fn) {
  await esperarLibre();
  for (const f of [db, db + '-wal', db + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const srv = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: '3001', DB_FILE: db, DISPATCH_PASSWORD: 'despacho99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let arrancó = false;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await responde()) { arrancó = true; break; }
  }
  // Que responda no alcanza: tiene que ser ESTE servidor, con ESTA base
  if (!arrancó || !fs.existsSync(db)) { srv.kill(); throw new Error('el servidor no arrancó con ' + db); }
  try { return await fn(); }
  finally { srv.kill(); await esperarLibre(); }
}

(async () => {
  const resultados = [];
  for (const s of COMPARTIDAS) {
    const db = `${S}/reg-${s}.db`;
    resultados.push(await conServidor(db, () => correr(s, { DBFILE: db, DB_FILE: db })));
  }
  for (const s of PROPIAS) resultados.push(await correr(s, {}));

  console.log('');
  for (const r of resultados) {
    console.log(`${r.suite.padEnd(11)}${r.ok ? 'ok' : `FALLA (código ${r.code}, ${r.fallas} falla(s))`}`);
    if (!r.ok) console.log(r.salida.split('\n').filter(l => /FALLA|Error|error:/.test(l)).slice(0, 8).map(l => '    ' + l).join('\n'));
  }
  const rojas = resultados.filter(r => !r.ok).length;
  console.log(rojas ? `\n=== REGRESIÓN ROJA: ${rojas} suite(s) ===` : '\n=== REGRESIÓN VERDE ===');
  process.exit(rojas ? 1 : 0);
})();
