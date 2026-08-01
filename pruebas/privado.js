const RAIZ = require('path').join(__dirname, '..');
const WebSocket = require(RAIZ + '/server/node_modules/ws');
const API = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, e) => console.log(n, c === true ? 'OK' : 'FALLA', e !== undefined ? '→ ' + e : '');
const login = (u, p) => fetch(API + '/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, password: p }) }).then(r => r.json());

const conectar = async (user, clave = 'clave1234') => {
  const s = await login(user, clave);
  if (!s.token) throw new Error('no entró ' + user + ': ' + JSON.stringify(s));
  const ws = new WebSocket('ws://localhost:3001');
  await new Promise(r => ws.on('open', r));
  const rec = { chats: [], historial: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'chat_msg') rec.chats.push(m);
    if (m.type === 'chat_history') rec.historial = m.items;
  });
  ws.send(JSON.stringify({ type: 'identify', token: s.token }));
  await sleep(500);
  return { ws, rec, s };
};

(async () => {
  const tk = (await login('DESPACHO', 'despacho99')).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk };
  const alta = (b) => fetch(API + '/admin/users', { method: 'POST', headers: H, body: JSON.stringify(b) });
  await alta({ unitId: 'raul', name: 'Raúl Mamani', alias: 'El Chino', personRole: 'driver', password: 'clave1234' });
  await alta({ unitId: 'maria', name: 'María Quispe', personRole: 'collector', vehicleId: 'raul', password: 'clave1234' });
  await alta({ unitId: 'M-08', name: 'Ana Flores', personRole: 'driver', password: 'clave1234' });

  const despacho = await conectar('DESPACHO', 'despacho99');
  const chofer = await conectar('raul');
  const cobrador = await conectar('maria');
  const otro = await conectar('M-08');

  // 1. Despacho le escribe SOLO a la unidad raul
  despacho.ws.send(JSON.stringify({ type: 'chat', to: 'raul', text: 'volvé al terminal', timestamp: Date.now() }));
  await sleep(1200);
  const lo = (c) => c.rec.chats.filter(m => m.text === 'volvé al terminal');
  ok('1. Le llega al chofer de esa unidad', lo(chofer).length === 1, lo(chofer)[0] && 'para ' + lo(chofer)[0].toVehicleId);
  ok('2. Le llega también a su cobrador', lo(cobrador).length === 1);
  ok('3. NO le llega a otra unidad de la misma ruta', lo(otro).length === 0);
  ok('4. Despacho ve su propio mensaje', lo(despacho).length === 1);

  // 2. El chofer contesta en privado
  chofer.ws.send(JSON.stringify({ type: 'chat', privado: true, text: 'estoy en Huancané', timestamp: Date.now() }));
  await sleep(1200);
  const resp = (c) => c.rec.chats.filter(m => m.text === 'estoy en Huancané');
  ok('5. La respuesta llega a Despacho', resp(despacho).length === 1, 'de ' + (resp(despacho)[0]||{}).driverName);
  ok('6. Y la ve su cobrador (van en la misma combi)', resp(cobrador).length === 1);
  ok('7. NO la ve la otra unidad', resp(otro).length === 0);

  // 3. Un chofer NO puede escribirle en privado a otra unidad
  chofer.ws.send(JSON.stringify({ type: 'chat', to: 'M-08', text: 'che M-08, apurate', timestamp: Date.now() }));
  await sleep(1200);
  const intento = (c) => c.rec.chats.filter(m => m.text === 'che M-08, apurate');
  ok('8. Un chofer no puede mandarle un privado a otro chofer',
     intento(otro).length === 0,
     'terminó en la conversación de ' + ((intento(despacho)[0] || {}).toVehicleId || 'nadie'));

  // 4. El grupo sigue siendo del grupo
  chofer.ws.send(JSON.stringify({ type: 'chat', text: 'hay bloqueo en la avenida', timestamp: Date.now() }));
  await sleep(1200);
  const grupo = (c) => c.rec.chats.filter(m => m.text === 'hay bloqueo en la avenida');
  ok('9. Un mensaje del grupo lo ven todos', grupo(otro).length === 1 && grupo(despacho).length === 1);

  // 5. El historial: cada uno ve lo suyo
  const nuevoOtro = await conectar('M-08');
  const textos = (c) => (c.rec.historial || []).map(i => i.text);
  ok('10. La otra unidad NO ve el privado en el historial',
     !textos(nuevoOtro).includes('volvé al terminal') && textos(nuevoOtro).includes('hay bloqueo en la avenida'),
     JSON.stringify(textos(nuevoOtro)));
  const nuevoChofer = await conectar('raul');
  ok('11. La unidad destinataria SÍ lo ve al reconectar',
     textos(nuevoChofer).includes('volvé al terminal') && textos(nuevoChofer).includes('estoy en Huancané'));
  const nuevoCobrador = await conectar('maria');
  ok('12. Su cobrador también', textos(nuevoCobrador).includes('volvé al terminal'));
  const nuevoDespacho = await conectar('DESPACHO', 'despacho99');
  ok('13. Despacho ve todas las conversaciones de su ruta',
     textos(nuevoDespacho).includes('volvé al terminal') && textos(nuevoDespacho).includes('estoy en Huancané'));

  // 6. Despacho no puede escribirle a una unidad que no existe
  despacho.ws.send(JSON.stringify({ type: 'chat', to: 'NO-EXISTE', text: 'hola?', timestamp: Date.now() }));
  await sleep(1000);
  ok('14. Un destinatario inexistente se descarta',
     despacho.rec.chats.filter(m => m.text === 'hola?').length === 0);

  [despacho, chofer, cobrador, otro, nuevoOtro, nuevoChofer, nuevoCobrador, nuevoDespacho].forEach(c => c.ws.close());
  process.exit(0);
})();
