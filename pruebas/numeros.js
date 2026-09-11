// Lo que el gerente y el creador no veían (REVISION-2026-09-10.md, tanda 5a:
// E2, E4, E5, E6, E8, E10, E11, E13, E14).
//
// Lo que se defiende: que las vueltas se atribuyan a la PERSONA que tenía el
// turno de chofer cuando se cerraron (y las que no caen en ningún turno se
// cuenten aparte, no se inventen); que la flota entera aparezca —la combi
// sin actividad, apagada y con su última señal—; que las entradas tardías se
// cuenten por unidad; que el resumen diga su alcance y acepte ruta; que haya
// tendencia por día y CSV de paradas; que el creador vea unidades-día del
// mes y la última señal de cada cooperativa; y que el servidor avise si no
// corre en hora de Perú.
const RAIZ = require('path').join(__dirname, '..');
const { spawn } = require('child_process');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const fs = require('fs');

const S = __dirname;
const DB = S + '/numeros-test.db';
const P = 3169;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = 3600_000;

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

let servidor = null;
(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  let errores = '';
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    // En UTC a propósito: el aviso de TZ tiene que salir
    env: { ...process.env, TZ: 'UTC', PORT: String(P), DB_FILE: DB, DISPATCH_PASSWORD: 'despacho99', MODO: 'demo', ARRANQUE_GRACIA_MS: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => { errores += d; });
  for (let i = 0; i < 80; i++) { await sleep(250); try { await fetch(API + '/ping'); break; } catch {} }

  const pedir = (ruta, opts = {}) => fetch(API + ruta, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const login = async (u, p) =>
    (await pedir('/auth/login', { method: 'POST', body: JSON.stringify({ user: u, password: p }) })).body;
  const d = await login('DESPACHO', 'despacho99');
  const HD = { Authorization: 'Bearer ' + d.token };
  const tokenG = await require('./gerente.js')(API, DB);
  const HG = { Authorization: 'Bearer ' + tokenG };
  // Dos choferes y un cobrador, y una combi más que nunca trabaja
  for (const [u, extra] of [['M-01', {}], ['M-02', { vehicleId: 'M-01' }], ['M-09', {}]]) {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: u, name: 'Chofer ' + u, password: 'chofer1234', ...extra }) });
  }
  await pedir('/admin/users', { method: 'POST', headers: HG,
    body: JSON.stringify({ unitId: 'C-01', name: 'Cobrador Uno', personRole: 'collector', vehicleId: 'M-01', password: 'chofer1234' }) });
  const resumen = async (desde, hasta, ruta) => (await pedir(`/gerencia/resumen?desde=${desde}&hasta=${hasta}${ruta ? '&routeId=' + ruta : ''}`, { headers: HG })).body;

  console.log('\nEL SERVIDOR AVISA SI NO CORRE EN HORA DE PERÚ');
  ok('en UTC, el arranque lo dice fuerte', /TZ=America\/Lima/.test(errores), errores.split('\n').filter(l => /TZ/.test(l))[0]);

  // Un día de trabajo, sembrado a mano: M-01 manejó la combi M-01 de 8 a 12
  // (3 vueltas), M-02 la misma combi de 13 a 17 (2 vueltas y una salida de
  // ruta), y una vuelta temprana que no cayó en el turno de nadie.
  const ahora = Date.now();
  // Las horas del día de trabajo, ANCLADAS a la medianoche de hoy y
  // comprimidas a minutos: «las 8» es 00:08. Con `ahora - (24 - h) × 3600000`
  // el día sembrado cruzaba la medianoche según la hora a la que se corriera
  // la suite, y entonces la tendencia por día salía partida en dos y las
  // unidades-día del creador contaban dos: la suite sólo pasaba de noche. Lo
  // que estas pruebas miran es el ORDEN de las horas dentro de un mismo día
  // —quién manejaba cuándo—, no que sean las ocho de la mañana.
  const medianoche = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const hoy = (h) => medianoche + h * 60_000;
  const w = new Database(DB);
  const turno = w.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt) VALUES (?, ?, 'R-14', ?, ?, ?, ?)`);
  turno.run('M-01', 'M-01', 'driver', hoy(8), hoy(12), hoy(12));
  turno.run('C-01', 'M-01', 'collector', hoy(8), hoy(12), hoy(12));
  turno.run('M-02', 'M-01', 'driver', hoy(13), hoy(17), hoy(17));
  const vuelta = w.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, parcial, objetivoSec) VALUES ('M-01', 'R-14', ?, ?, 3000, 20, ?, 0, 600)`);
  for (const h of [9, 10, 11]) vuelta.run(hoy(h) - 30_000, hoy(h), 600);        // dentro del objetivo
  for (const h of [14, 16]) vuelta.run(hoy(h) - 30_000, hoy(h), 900);           // fuera del objetivo
  // La vuelta que no es de nadie va ANTES del primer turno, no después del
  // último: la atribución le perdona al turno cerrado los 15 min de
  // `RECONEXION_MS` —una vuelta que cierra al ratito de que el chofer se
  // desconecte sigue siendo suya—, y en esta escala comprimida «dos horas
  // después» son dos minutos, adentro de ese perdón. Antes del primer turno
  // no hay tolerancia que valga: no había nadie.
  vuelta.run(hoy(5) - 30_000, hoy(5), null);                                    // de nadie, y sin brecha
  w.prepare(`INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre) VALUES ('M-01', 'R-14', ?, ?, 120, 400, 300, 0, 'regreso')`)
    .run(hoy(15), hoy(15) + 120_000);
  w.prepare(`INSERT INTO audit (actor, action, target, detail, timestamp, routeId, companyId) VALUES ('sistema', 'entrada_tardia', 'M-01', 'entró al 40 %', ?, 'R-14', ?)`)
    .run(hoy(13) + 60_000, w.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId);
  w.prepare(`INSERT INTO paradas (vehicleId, routeId, companyId, startedAt, endedAt, durationSec, lat, lng, progreso, tramo, confirmado, medida, cierre) VALUES ('M-01', 'R-14', ?, ?, ?, 240, -15.49, -70.13, 0.42, 'ida', 1, 1, 'movio')`)
    .run(w.prepare("SELECT companyId FROM routes WHERE routeId = 'R-14'").get().companyId, hoy(10), hoy(10) + 240_000);
  w.close();

  console.log('\nLAS VUELTAS SON DE LA PERSONA QUE MANEJABA');
  {
    const r = await resumen(ahora - 26 * H, ahora + H);
    const p1 = (r.porPersona || []).find(p => p.personId === 'M-01');
    const p2 = (r.porPersona || []).find(p => p.personId === 'M-02');
    const pc = (r.porPersona || []).find(p => p.personId === 'C-01');
    ok('M-01 tiene sus 3 vueltas, todas en objetivo', !!p1 && p1.vueltas === 3 && p1.cumplimiento === 100 && p1.brechaProm === 600, p1);
    ok('M-02 tiene sus 2, fuera del objetivo, y la salida de ruta de su turno', !!p2 && p2.vueltas === 2 && p2.cumplimiento === 0 && p2.desvios === 1, p2);
    ok('el cobrador no tiene vueltas (no maneja)', !!pc && pc.vueltas === 0 && pc.desvios === 0, pc);
    ok('la vuelta de las 19 no se le inventa a nadie: sin atribuir', r.totales.sinAtribuir === 1, r.totales.sinAtribuir);
    ok('y la unidad sigue con las 6 (la vuelta es de la combi)', ((r.porUnidad || []).find(u => u.unitId === 'M-01') || {}).vueltas === 6);
    ok('el cumplimiento dice de cuántas sale: una sin brecha', r.totales.sinBrecha === 1 && r.totales.vueltas === 6, { sinBrecha: r.totales.sinBrecha });
  }

  console.log('\nLA FLOTA ENTERA, Y LA QUE NO TRABAJÓ SE VE');
  {
    const r = await resumen(ahora - 26 * H, ahora + H);
    const u9 = (r.porUnidad || []).find(u => u.unitId === 'M-09');
    ok('la combi sin actividad aparece, apagada y sin última señal', !!u9 && u9.activa === false && u9.ultimaVez === null && u9.vueltas === 0, u9 && { activa: u9.activa, ultimaVez: u9.ultimaVez });
    const u1 = (r.porUnidad || []).find(u => u.unitId === 'M-01');
    ok('la que trabajó está activa, con su última señal', !!u1 && u1.activa === true && u1.ultimaVez === hoy(17), u1 && { activa: u1.activa, ultimaVez: u1.ultimaVez - hoy(17) });
    ok('flota y activas en los totales', r.totales.flota >= 2 && r.totales.unidadesActivas === 1 && r.totales.unidades === 1, { flota: r.totales.flota, activas: r.totales.unidadesActivas });
    ok('las entradas tardías, contadas por unidad y en el total', !!u1 && u1.senal.entradasTardias === 1 && r.totales.entradasTardias === 1, u1 && u1.senal.entradasTardias);
    ok('la tendencia por día trae el día con sus 6 vueltas', (r.porDia || []).some(x => x.vueltas === 6), r.porDia);
    ok('y el resumen dice su alcance (toda la cooperativa)', r.alcance && r.alcance.routeId === null && r.alcance.fijo === false, r.alcance);
    const r2 = await resumen(ahora - 26 * H, ahora + H, 'R-14');
    ok('pedido por ruta, lo dice', r2.alcance && r2.alcance.routeId === 'R-14', r2.alcance);
    ok('una ruta ajena es 404', (await pedir(`/gerencia/resumen?desde=${ahora - H}&hasta=${ahora}&routeId=R-99`, { headers: HG })).status === 404);
  }

  console.log('\nEL CSV DE PARADAS Y LO QUE VE EL CREADOR');
  {
    const csv = await fetch(`${API}/admin/informe/paradas.csv?desde=${ahora - 26 * H}&hasta=${ahora}`, { headers: HD }).then(r => r.text());
    ok('paradas.csv existe y trae la parada con punto del circuito, medida y avisada', /Informe de paradas/.test(csv) && /M-01;R-14;.*;4;ida;42;.*;sí;sí;volvió a andar/.test(csv), csv.split('\r\n').slice(5, 8));
    const coop = require(RAIZ + '/server/cooperativas.js');
    const r = new Database(DB, { readonly: true });
    const e = coop.listar(r).find(x => x.rutas.some(rt => rt.routeId === 'R-14'));
    r.close();
    ok('el creador ve las unidades-día del mes (una combi, un día)', !!e && e.unidadesDiaMes === 1, e && e.unidadesDiaMes);
    ok('y la última señal de la cooperativa', !!e && e.ultimoGps === hoy(17), e && e.ultimoGps);
  }

  console.log('\nEL PERÍODO SON DÍAS DE CALENDARIO, NO RODANTES');
  // La otra mitad de E14. `ahora - N × 86400000` arranca a la hora en que se
  // abrió la pantalla: el primer día del período es un día PARTIDO, y la
  // tendencia abre con una barra que vale unas horas comparada contra días
  // enteros. Con días de calendario, «1 día» es HOY, y la vuelta de anoche
  // —que está adentro de las últimas 24 h— queda afuera.
  //
  // El servidor corre en UTC en esta suite, así que la medianoche que corta
  // es la de UTC; lo que se prueba es el corte, no el huso.
  {
    const w2 = new Database(DB);
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: 'M-10', name: 'Chofer M-10', password: 'chofer1234' }) });
    const v = w2.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, parcial, objetivoSec) VALUES ('M-10', 'R-14', ?, ?, 3000, 20, 600, 0, 600)`);
    v.run(medianoche - 3_060_000, medianoche - 60_000);   // anoche, 23:59
    v.run(medianoche + 60_000, medianoche + 3_060_000);   // hoy, 00:01
    w2.close();
    const m = (await pedir('/admin/metrics?dias=1', { headers: HD })).body;
    const u10 = (m.metrics || []).find(x => x.unitId === 'M-10');
    ok('«1 día» son las vueltas de HOY, no las de las últimas 24 horas',
       !!u10 && u10.lapsTotal === 1, u10 && { lapsTotal: u10.lapsTotal });
    ok('y el período servido lo dice', m.periodo && m.periodo.dias === 1, m.periodo);
    const m2 = (await pedir('/admin/metrics?dias=2', { headers: HD })).body;
    const u10b = (m2.metrics || []).find(x => x.unitId === 'M-10');
    ok('con 2 días entra el día de ayer ENTERO, no las 24 h anteriores',
       !!u10b && u10b.lapsTotal === 2, u10b && { lapsTotal: u10b.lapsTotal });
  }

  console.log('\nEL ROL NO SE CONGELA CON EL PRIMER TURNO');
  // E12. Quien hizo de cobrador a la mañana y de chofer a la tarde salía con
  // un rol solo —el del primer turno que devolvía la consulta—, y con
  // «cobrador» la pantalla le tapaba las vueltas que había manejado.
  {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: 'M-11', name: 'Los Dos Roles', password: 'chofer1234' }) });
    const w3 = new Database(DB);
    const t3 = w3.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, endedAt, lastSeenAt) VALUES ('M-11', 'M-11', 'R-14', ?, ?, ?, ?)`);
    t3.run('collector', hoy(20), hoy(24), hoy(24));   // cobrador, 4 min
    t3.run('driver',    hoy(25), hoy(31), hoy(31));   // chofer, 6 min: manda
    w3.prepare(`INSERT INTO laps (unitId, routeId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, parcial, objetivoSec) VALUES ('M-11', 'R-14', ?, ?, 3000, 20, 600, 0, 600)`)
      .run(hoy(26), hoy(28));
    w3.close();
    const r = await resumen(ahora - 26 * H, ahora + H);
    const p11 = (r.porPersona || []).find(p => p.personId === 'M-11');
    ok('la persona trae los DOS roles del período, el chofer primero',
       !!p11 && Array.isArray(p11.roles) && p11.roles.join(',') === 'driver,collector', p11 && p11.roles);
    ok('y el `role` suelto es en el que puso más horas, no el del primer turno',
       !!p11 && p11.role === 'driver', p11 && p11.role);
    ok('la vuelta que manejó es suya, no queda sin atribuir',
       !!p11 && p11.vueltas === 1, p11 && p11.vueltas);
    // Y lo mismo en la lista de Despacho, que es la otra pantalla que lo usa
    const sh = (await pedir(`/admin/shifts?desde=${hoy(0)}`, { headers: HD })).body;
    const s11 = (sh.personas || []).find(p => p.personId === 'M-11');
    ok('Turnos también los trae los dos', !!s11 && (s11.roles || []).join(',') === 'driver,collector', s11 && s11.roles);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN\n' : `\n${fallas} FALLA(S)\n`);
  servidor.kill();
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); try { servidor && servidor.kill(); } catch {} process.exit(1); });
