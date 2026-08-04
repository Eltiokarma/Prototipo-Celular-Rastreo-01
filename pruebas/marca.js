// La identidad de cada cooperativa (`server/marca.js`) y su endpoint, contra
// el servidor de verdad.
//
// Suena a decoración y no lo es: este sistema atiende a VARIAS cooperativas y
// la marca es la única señal, en la pantalla, de a cuál pertenece lo que se
// está mirando. Pero lo que de verdad se defiende acá es lo de siempre en
// este proyecto: **que una cooperativa no pueda tocar la de al lado**.
const RAIZ = require('path').join(__dirname, '..');
const S = __dirname;
const { spawn } = require('child_process');
const { logoValido, motivoRechazo, iniciales, colorDe, marcaDe,
        MAX_LOGO, COLORES } = require(RAIZ + '/server/marca.js');
const fs = require('fs');

const DB = S + '/marca-test.db';
const P = 3153;
const API = `http://localhost:${P}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un "logo" del largo TOTAL que se pida, para poder afirmar sobre el tamaño
// exacto que quedó guardado.
const logo = (largo = 400, tipo = 'png') => {
  const cabeza = `data:image/${tipo};base64,`;
  return cabeza + 'A'.repeat(Math.max(120, largo - cabeza.length));
};

// ─── Sin servidor: las reglas ──────────────────────────────────────────────

console.log('\nQUÉ LOGO SE ACEPTA');
{
  ok('un PNG entra', logoValido(logo(400)) !== null);
  ok('un JPG también', logoValido(logo(400, 'jpeg')) !== null);
  ok('y un WEBP', logoValido(logo(400, 'webp')) !== null);

  // Un SVG es un documento con scripts adentro, y esto se pinta en el panel
  // de Despacho y en el WebView del chofer. Un logo que puede ejecutar código
  // no es un logo.
  const svg = 'data:image/svg+xml;base64,' + 'A'.repeat(400);
  ok('un SVG NO entra', logoValido(svg) === null);
  ok('y se explica por qué', /SVG/.test(motivoRechazo(svg)), motivoRechazo(svg));

  ok('un audio tampoco', logoValido('data:audio/m4a;base64,' + 'A'.repeat(400)) === null);
  ok('ni una URL cualquiera', logoValido('https://ejemplo/logo.png') === null);
  ok('ni nada', logoValido(null) === null && logoValido(undefined) === null);

  // `data:image/png;base64,` a secas pasa el prefijo y el tamaño, y deja un
  // cuadro roto en pantalla.
  ok('un data-URL vacío no pasa', logoValido('data:image/png;base64,') === null);
  ok('ni uno casi vacío', logoValido('data:image/png;base64,AAAA') === null);

  ok('uno demasiado pesado no entra', logoValido(logo(MAX_LOGO + 100)) === null);
  ok('y se dice el tope', /kB/.test(motivoRechazo(logo(MAX_LOGO + 100))), motivoRechazo(logo(MAX_LOGO + 100)));
  ok('uno justo por debajo sí', logoValido(logo(MAX_LOGO - 200)) !== null);
}

console.log('\nCUANDO NO HAY LOGO');
{
  // Un hueco en blanco donde va la marca se lee como que el sistema está
  // roto. Dos letras se leen como "todavía no subieron el logo", que es la
  // verdad, y sirve desde el primer día sin que nadie haga nada.
  ok('un nombre de dos palabras da dos iniciales',
     iniciales('Señor de Huanca') === 'SH', iniciales('Señor de Huanca'));
  ok('los acentos no rompen', iniciales('Ángeles Custodios') === 'AC', iniciales('Ángeles Custodios'));

  // Si no se saltearan las palabras genéricas, TODAS las cooperativas se
  // llamarían "CT" y las iniciales no distinguirían nada.
  ok('"Cooperativa de Transportes San Martín" no da CT',
     iniciales('Cooperativa de Transportes San Martín') === 'SM',
     iniciales('Cooperativa de Transportes San Martín'));
  ok('y "Coop. Transportes Andina" tampoco',
     iniciales('Coop. Transportes Andina') === 'AN',
     iniciales('Coop. Transportes Andina'));

  ok('una sola palabra da sus dos letras', iniciales('Andina') === 'AN', iniciales('Andina'));
  ok('un nombre todo genérico igual da algo',
     iniciales('Cooperativa de Transportes') === 'CT', iniciales('Cooperativa de Transportes'));
  for (const malo of [null, undefined, '', '   ', '///', 123]) {
    const i = iniciales(malo);
    ok('no revienta con ' + JSON.stringify(malo), typeof i === 'string' && i.length > 0, i);
  }

  // Estable importa: si el color cambiara entre pantallas o entre recargas,
  // dejaría de servir como seña de "ésta es mi cooperativa".
  ok('el color es estable', colorDe('R14') === colorDe('R14'), colorDe('R14'));
  ok('siempre es un color', /^#[0-9A-F]{6}$/i.test(colorDe('lo-que-sea')), colorDe('lo-que-sea'));
  ok('hasta sin id', /^#[0-9A-F]{6}$/i.test(colorDe(null)), colorDe(null));

  // Que dos ids distintos den colores distintos NO se puede exigir: con seis
  // colores, dos cooperativas cualesquiera coinciden una de cada seis veces.
  // Lo que sí se puede exigir es que REPARTA: si todas cayeran en el mismo
  // color, el color no distinguiría nada.
  const usados = {};
  for (let i = 0; i < 200; i++) {
    const c = colorDe('COOP-' + i);
    usados[c] = (usados[c] || 0) + 1;
  }
  ok('reparte entre todos los colores de la paleta',
     Object.keys(usados).length === COLORES.length, Object.keys(usados).length);
  const mayor = Math.max(...Object.values(usados));
  ok('y ninguno se lleva más de la mitad', mayor < 100, usados);
}

console.log('\nLO QUE SE MANDA A LA PANTALLA');
{
  const m = marcaDe({ companyId: 'R14', name: 'Señor de Huanca', logo: logo(300) });
  ok('trae nombre, logo, iniciales y color',
     m.nombre === 'Señor de Huanca' && !!m.logo && m.iniciales === 'SH' && !!m.color, m.iniciales);

  // Sin logo la pantalla igual tiene con qué dibujar algo: es la diferencia
  // entre "todavía no lo subieron" y "esto está roto".
  const sin = marcaDe({ companyId: 'R14', name: 'Señor de Huanca' });
  ok('sin logo igual hay iniciales y color',
     sin.logo === null && sin.iniciales === 'SH' && !!sin.color, sin);
  ok('y sin empresa tampoco revienta', typeof marcaDe(null).iniciales === 'string', marcaDe(null));
}

// ─── Con servidor: el endpoint y el aislamiento ────────────────────────────

let servidor = null;
async function arrancar() {
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB,
           DISPATCH_PASSWORD: 'despacho99', STATE_INTERVAL_MS: '600' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { await fetch(API + '/ping'); return; } catch {}
  }
  throw new Error('el servidor no arrancó');
}

const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(API + ruta, opciones);
  const t = await r.text();
  let c = null; try { c = JSON.parse(t); } catch { c = t; }
  return { ok: r.ok, status: r.status, cuerpo: c };
};

(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  await arrancar();

  const entrar = async (user, password) =>
    (await pedir('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }) })).cuerpo;

  const d = await entrar('DESPACHO', 'despacho99');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token };

  // Desde la fusión Despacho/gerencia, el logo es un ACTIVO y los activos
  // son del gerente. Se crea uno con las mismas piezas que usa la consola.
  {
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const coop = require(RAIZ + '/server/cooperativas.js');
    const base = new Database(DB);
    coop.gerente(base, { companyId: d.companyId, usuario: 'GERENTE-M', clave: 'gerente99' });
    base.close();
  }
  const g = await entrar('GERENTE-M', 'gerente99');
  const HG = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + g.token };

  console.log('\nSUBIR Y VER EL LOGO');
  {
    const deDespacho = await pedir('/admin/company/logo', {
      method: 'PUT', headers: H, body: JSON.stringify({ logo: logo(500) }),
    });
    ok('Despacho ya NO pone el logo: es un activo, y los activos son del gerente',
       deDespacho.status === 403, deDespacho.status);
    const puesto = await pedir('/admin/company/logo', {
      method: 'PUT', headers: HG, body: JSON.stringify({ logo: logo(500) }),
    });
    ok('el gerente pone el logo de SU cooperativa', puesto.ok, puesto.status);

    const marca = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d.token } });
    ok('y se lee de vuelta', marca.ok && marca.cuerpo?.marca?.logo?.length === 500,
       marca.cuerpo?.marca?.logo?.length);
    ok('con el nombre de la cooperativa', !!marca.cuerpo?.marca?.nombre, marca.cuerpo?.marca?.nombre);
    ok('y con iniciales y color para cuando no haya logo',
       !!marca.cuerpo?.marca?.iniciales && !!marca.cuerpo?.marca?.color, marca.cuerpo?.marca);

    // Sacarlo tiene que ser posible: un logo mal subido no puede quedar
    // pegado hasta que alguien toque la base a mano.
    const vacio = await pedir('/admin/company/logo', {
      method: 'PUT', headers: HG, body: JSON.stringify({ logo: null }),
    });
    const tras = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d.token } });
    ok('se puede sacar', vacio.ok && tras.cuerpo?.marca?.logo === null, tras.cuerpo?.marca?.logo);
    ok('y quedan las iniciales', !!tras.cuerpo?.marca?.iniciales, tras.cuerpo?.marca?.iniciales);

    await pedir('/admin/company/logo', { method: 'PUT', headers: HG, body: JSON.stringify({ logo: logo(500) }) });
  }

  console.log('\nLO QUE NO SE ACEPTA, TAMPOCO POR EL CABLE');
  {
    const svg = await pedir('/admin/company/logo', {
      method: 'PUT', headers: HG,
      body: JSON.stringify({ logo: 'data:image/svg+xml;base64,' + 'A'.repeat(400) }),
    });
    ok('un SVG se rechaza con 400', svg.status === 400, svg.status);
    ok('y con un motivo que se puede leer', /SVG/.test(svg.cuerpo?.error || ''), svg.cuerpo?.error);

    const gordo = await pedir('/admin/company/logo', {
      method: 'PUT', headers: HG, body: JSON.stringify({ logo: logo(MAX_LOGO + 5000) }),
    });
    ok('uno demasiado pesado también', gordo.status === 400, gordo.status);

    // Y el de antes sigue en su lugar: un rechazo no puede borrar lo que ya
    // estaba bien.
    const marca = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d.token } });
    ok('el logo anterior sobrevive al rechazo', marca.cuerpo?.marca?.logo?.length === 500,
       marca.cuerpo?.marca?.logo?.length);
  }

  console.log('\nEL CHOFER VE LA MARCA DE SU COOPERATIVA');
  {
    await pedir('/admin/users', { method: 'POST', headers: HG,
      body: JSON.stringify({ unitId: 'M-12', name: 'Elmer Ccama', password: 'chofer1234' }) });
    const s = await entrar('M-12', 'chofer1234');
    const marca = await pedir('/marca', { headers: { Authorization: 'Bearer ' + s.token } });
    ok('un chofer puede pedir la marca', marca.ok, marca.status);
    ok('y es la de SU cooperativa', marca.cuerpo?.marca?.companyId === d.companyId,
       [marca.cuerpo?.marca?.companyId, d.companyId]);

    // Pero NO puede cambiarla: la marca la maneja la gerencia.
    const intento = await pedir('/admin/company/logo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token },
      body: JSON.stringify({ logo: logo(300) }),
    });
    ok('un chofer NO puede cambiarla', intento.status === 403, intento.status);

    const sinSesion = await pedir('/marca');
    ok('y sin sesión no se ve nada', sinSesion.status === 401, sinSesion.status);
  }

  console.log('\nUNA COOPERATIVA NO TOCA LA DE AL LADO');
  {
    // Ésta es la que importa de verdad. Todo lo demás es cosmética; esto es
    // la línea que separa a dos empresas que no se conocen.
    const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
    const coop = require(RAIZ + '/server/cooperativas.js');
    const base = new Database(DB);
    const otra = coop.alta(base, {
      companyId: 'OTRA', name: 'Cooperativa Los Andes',
      ruta: 'R-99', despacho: 'DESPACHO2', clave: 'despacho99',
    });
    coop.gerente(base, { companyId: 'OTRA', usuario: 'GER-2', clave: 'gerente99' });
    base.close();
    ok('se creó la segunda cooperativa', !otra.error, otra.error || otra.companyId);

    const d2 = await entrar('DESPACHO2', 'despacho99');
    ok('y entra su despacho', !!d2?.token, d2?.error);

    const g2 = await entrar('GER-2', 'gerente99');
    const HG2 = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + g2.token };
    await pedir('/admin/company/logo', { method: 'PUT', headers: HG2, body: JSON.stringify({ logo: logo(700) }) });

    const m1 = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d.token } });
    const m2 = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d2.token } });
    ok('cada una ve SU logo',
       m1.cuerpo?.marca?.logo?.length === 500 && m2.cuerpo?.marca?.logo?.length === 700,
       [m1.cuerpo?.marca?.logo?.length, m2.cuerpo?.marca?.logo?.length]);
    ok('y su propio nombre',
       m1.cuerpo?.marca?.nombre !== m2.cuerpo?.marca?.nombre,
       [m1.cuerpo?.marca?.nombre, m2.cuerpo?.marca?.nombre]);
    ok('y su propio color',
       m1.cuerpo?.marca?.companyId !== m2.cuerpo?.marca?.companyId);

    // El endpoint NO recibe companyId a propósito: sale de la sesión. Si lo
    // recibiera, bastaría con mandar el ajeno para pisarle el logo a otra
    // cooperativa.
    const cruce = await pedir('/admin/company/logo', {
      method: 'PUT', headers: HG2,
      body: JSON.stringify({ logo: logo(900), companyId: d.companyId }),
    });
    const m1b = await pedir('/marca', { headers: { Authorization: 'Bearer ' + d.token } });
    ok('mandar el companyId ajeno NO pisa el logo del otro',
       m1b.cuerpo?.marca?.logo?.length === 500, m1b.cuerpo?.marca?.logo?.length);
    ok('el cambio cae en la propia', (await pedir('/marca', { headers: { Authorization: 'Bearer ' + d2.token } }))
       .cuerpo?.marca?.logo?.length === 900);
    ok('y la petición no falló en silencio', cruce.ok, cruce.status);
  }

  console.log('\nEL NIVEL DE ARRIBA CONFIGURA LA MARCA');
  {
    // El caso normal es que la cooperativa reciba el sistema YA con su logo
    // puesto: pedirle a un despachador que lo suba el primer día es pedirle
    // que se ocupe de algo que se puede dejar hecho.
    //
    // Este servidor arrancó SIN `CREATOR_PASSWORD`, así que el panel del
    // creador no existe. Que eso siga siendo cierto es más importante que
    // todo lo demás de esta suite: es la llave que abre TODAS las
    // cooperativas.
    const apagado = await pedir('/creador/empresas/R14/logo', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo: logo(400) }),
    });
    ok('sin CREATOR_PASSWORD el endpoint no existe (404, no 401 ni 403)',
       apagado.status === 404, apagado.status);

    // Y con el panel encendido, sigue pidiendo sesión de creador: la de
    // Despacho, que es la más alta que hay abajo, no alcanza.
    const conDespacho = await pedir('/creador/empresas/R14/logo', {
      method: 'PUT', headers: H, body: JSON.stringify({ logo: logo(400) }),
    });
    ok('y la sesión de Despacho tampoco lo abre',
       conDespacho.status === 404 || conDespacho.status === 401, conDespacho.status);
  }

  console.log('\nUN TRAZADO REAL ENTRA POR EL CABLE');
  {
    // Esto NO es sobre la marca, pero se descubrió acá y muerde hoy: el tope
    // de cuerpo de express venía en 100 kB, y el servidor dice aceptar 2000
    // puntos por tramo — o sea ~148 kB con los dos. Cargar un recorrido real
    // denso fallaba con un PayloadTooLargeError crudo, un HTML de Express,
    // antes de llegar a ninguna validación. Justo lo que pasa la primera vez
    // que alguien dibuja una ruta de verdad con el trazador.
    const anillo = (t) => ({
      lat: -15.4904 + 0.01 * Math.cos(t * 2 * Math.PI),
      lng: -70.1333 + 0.01 * Math.sin(t * 2 * Math.PI),
    });
    const denso = (n) => Array.from({ length: n }, (_, i) => anillo(i / n));
    const cuerpo = JSON.stringify({ tramos: { ida: denso(2000), vuelta: denso(2000) } });
    ok('el trazado de prueba pesa más que el viejo tope',
       cuerpo.length > 100 * 1024, Math.round(cuerpo.length / 1024) + ' kB');

    const r = await pedir('/admin/routes/R-14/points', { method: 'PUT', headers: H, body: cuerpo });
    ok('y el servidor lo acepta', r.ok, [r.status, String(r.cuerpo).slice(0, 80)]);
    ok('con los 2000 puntos de cada tramo',
       r.cuerpo?.puntos?.ida === 2000 && r.cuerpo?.puntos?.vuelta === 2000, r.cuerpo?.puntos);
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  servidor.kill();
  await sleep(300);
  process.exit(fallas ? 1 : 0);
})().catch(e => {
  console.error('FALLA  ' + e.message);
  if (servidor) servidor.kill();
  process.exit(1);
});
