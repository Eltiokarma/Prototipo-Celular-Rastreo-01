// Levanta el servidor con el panel del creador encendido y corre creador-ui.js
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const fs = require('fs');
const DB = __dirname + '/creador-ui.db';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  const srv = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: '3034', DB_FILE: DB,
      CREATOR_PASSWORD: 'clave-larga-del-creador', CREATOR_PATH: '/creador',
      DISPATCH_PASSWORD: 'despacho99', MODO: 'demo' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch('http://localhost:3034/ping'); break; } catch {}
  }
  // La primera cooperativa con el nombre que espera la suite
  const D = require(RAIZ + '/server/node_modules/better-sqlite3');
  const db = new D(DB);
  db.prepare("UPDATE companies SET name = 'Cooperativa de Transportes Juliaca'").run();
  db.close();
  const hijo = spawn('node', [__dirname + '/creador-ui.js'], {
    env: { ...process.env, SP: __dirname }, stdio: 'inherit',
  });
  hijo.on('exit', (c) => { srv.kill(); process.exit(c || 0); });
})();
