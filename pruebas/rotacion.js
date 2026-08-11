// Rotar DISPATCH_PASSWORD es la ruta de recuperación cuando la clave de
// Despacho se perdió o se filtró. Lo que se prueba acá no es que la clave
// nueva entre —eso es lo fácil— sino que la VIEJA deje de servir para todo,
// incluido lo que ya había abierto: un token de sesión dura 30 días y antes
// sobrevivía a la rotación, así que la cuenta que administra a todos seguía
// accesible un mes más con la clave que se estaba quemando.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const P = 3184;
const API = `http://localhost:${P}`;
const DB = path.join(__dirname, 'rotacion.db');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');

const login = (u, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: p }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// Un endpoint que exige sesión de Despacho: sirve de termómetro del token.
const conToken = (tk) => fetch(API + '/admin/users', {
  headers: { Authorization: 'Bearer ' + tk },
}).then(r => r.status);

function limpiar() {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
}

async function arrancar(clave) {
  const p = spawn('node', [path.join(RAIZ, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: clave },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return p; } catch {}
  }
  console.error('  [el servidor no arrancó]', err.slice(0, 500));
  return p;
}

// Apagar y esperar a que suelte el puerto: si no, el arranque siguiente no
// puede atarse y la ronda que sigue le habla al servidor de la anterior.
async function apagar(p) {
  if (!p) return;
  p.kill();
  for (let i = 0; i < 40; i++) {
    const vivo = await fetch(API + '/ping').then(() => true, () => false);
    if (!vivo) return;
    await sleep(250);
  }
}

(async () => {
  limpiar();

  // ── Ronda 1: la clave original, y una sesión abierta con ella
  let srv = await arrancar('claveviejadespacho');
  const r1 = await login('DESPACHO', 'claveviejadespacho');
  const tkViejo = r1.body.token;
  ok('1. Despacho entra con la clave original', r1.status === 200 && !!tkViejo, 'HTTP ' + r1.status);
  ok('2. Su token abre el panel', (await conToken(tkViejo)) === 200);

  // ── Ronda 2: mismo servidor, MISMA clave. Un redeploy no debe echar a nadie:
  // si la rotación revocara siempre, cada deploy dejaría a Despacho afuera.
  await apagar(srv);
  srv = await arrancar('claveviejadespacho');
  ok('3. Un redeploy con la misma clave NO corta la sesión',
    (await conToken(tkViejo)) === 200);

  // ── Ronda 3: la rotación de verdad
  await apagar(srv);
  srv = await arrancar('clavenuevadespacho');

  const estado = await conToken(tkViejo);
  ok('4. Rotar la clave revoca el token que abrió la vieja', estado === 401, 'HTTP ' + estado);

  const viejo = await login('DESPACHO', 'claveviejadespacho');
  ok('5. Y la clave vieja ya no entra', viejo.status === 401, 'HTTP ' + viejo.status);

  const nuevo = await login('DESPACHO', 'clavenuevadespacho');
  ok('6. La clave nueva sí', nuevo.status === 200 && !!nuevo.body.token, 'HTTP ' + nuevo.status);

  await apagar(srv);
  limpiar();
})();
