#!/usr/bin/env node
// Las capturas del manual de usuario, sacadas de la app de verdad.
//
//   node manual/capturas.js                 # todas, a manual/img/
//   TILES_DIR=/ruta/al/mapa node manual/capturas.js
//
// Levanta un servidor limpio y arma la cooperativa de demostración (`demo.js`)
// POR LAS PANTALLAS, como se arma una de verdad: el creador da de alta la
// cooperativa, la gerencia carga las combis y el logo, Despacho da de alta a
// la gente. Después pone a andar la flota por `POST /gps` —el mismo camino del
// teléfono— y recorre cada pantalla con un navegador.
//
// No es una prueba, pero sirve de una: si un paso no encuentra su botón o la
// página tira un error, queda listado al final y el proceso sale con 1. Así
// se armó este manual, y así fue como aparecieron los arreglos del 28/10.
//
// El mapa: sin TILES_DIR el fondo sale gris (las tiles del proveedor piden
// clave). Con la carpeta del release `mapa-propio` (juliaca-claro.pmtiles y
// zonas.json) salen las calles de Juliaca, que es como lo ve un chofer.
'use strict';
process.env.TZ = process.env.TZ || 'America/Lima';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const { chromium } = require(RAIZ + '/pruebas/node_modules/playwright-core');
const interceptarHttps = require(RAIZ + '/pruebas/cdn.js');
const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
const D = require('./demo');
const RUTAS = require('./rutas-demo.json');

const P = Number(process.env.PUERTO || 3150);
const API = `http://localhost:${P}`;
const TMP = path.join(__dirname, '.tmp');
const IMG = path.join(__dirname, 'img');
const DB = path.join(TMP, 'manual.db');
const TILES_DIR = process.env.TILES_DIR || '';
const SOLO = (process.env.SOLO || '').split(',').filter(Boolean);
const dormir = ms => new Promise(r => setTimeout(r, ms));
const errores = [];
const hechas = [];

// ─── El servidor ────────────────────────────────────────────────────────
let servidor = null;
let log = '';
async function arrancar() {
  fs.mkdirSync(TMP, { recursive: true });
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  servidor = spawn('node', [RAIZ + '/server/index.js'], {
    env: {
      ...process.env, PORT: String(P), DB_FILE: DB, MODO: 'demo',
      DISPATCH_PASSWORD: 'despacho-inicial-2026', CREATOR_PASSWORD: D.CLAVE_CREADOR,
      APP_VERSION_ACTUAL: '5', STATE_INTERVAL_MS: '1500',
      ...(TILES_DIR ? { TILES_DIR } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', d => { log += d; });
  servidor.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) {
    await dormir(250);
    try { if ((await fetch(API + '/ping')).ok) return; } catch {}
  }
  throw new Error('el servidor no arrancó:\n' + log);
}

const pedir = async (ruta, { metodo = 'GET', token, cuerpo } = {}) => {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const entrar = (user, password) => pedir('/auth/login', { metodo: 'POST', cuerpo: { user, password } }).then(j => j.token);

// ─── La flota ───────────────────────────────────────────────────────────
// Posiciones con la firma de un GPS de verdad: la velocidad varía (frena,
// arranca) y la posición zigzaguea unos metros alrededor de la calle. Sin
// eso el propio servidor la marca, con razón, como «GPS sospechoso».
const rad = g => g * Math.PI / 180;
const metros = (a, b) => {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const m = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(m));
};
const medir = pts => { const acum = [0]; for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + metros(pts[i - 1], pts[i])); return { pts, acum, largo: acum[acum.length - 1] }; };
const puntoEn = (t, d) => {
  const x = Math.max(0, Math.min(d, t.largo));
  let i = 1; while (i < t.acum.length && t.acum[i] < x) i++;
  const a = t.pts[i - 1], b = t.pts[Math.min(i, t.pts.length - 1)];
  const seg = t.acum[Math.min(i, t.acum.length - 1)] - t.acum[i - 1];
  const k = seg > 0 ? (x - t.acum[i - 1]) / seg : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
};
const TRAMOS = Object.fromEntries(Object.entries(RUTAS).map(([r, v]) => [r, { ida: medir(v.ida), vuelta: medir(v.vuelta) }]));
let EPOCA = Date.now();
function posicion(id, ahora = Date.now()) {
  const v = D.VEHICULOS.find(x => x.id === id);
  const f = D.FLOTA[id];
  const T = TRAMOS[v.ruta];
  const total = T.ida.largo + T.vuelta.largo;
  const n = D.VEHICULOS.indexOf(v);
  let s = (ahora - EPOCA) / 1000;
  if (f.raro === 'trafico' && s > 50) s = 50 + (s - 50) * 0.02;   // trabada en el tráfico
  const vMs = f.kmh / 3.6;
  // La distancia con la velocidad que sube y baja, y su derivada
  const d = (f.desde * total + vMs * (s + 6 * Math.sin(s / 23 + n) + 2.5 * Math.sin(s / 9.1 + 2 * n))) % total;
  const factor = 1 + (6 / 23) * Math.cos(s / 23 + n) + (2.5 / 9.1) * Math.cos(s / 9.1 + 2 * n);
  const tramo = d < T.ida.largo ? 'ida' : 'vuelta';
  let [lat, lng] = puntoEn(T[tramo], tramo === 'ida' ? d : d - T.ida.largo);
  // Unos metros de zigzag, como un GPS en la ciudad
  lat += (5 * Math.sin(s * 1.7 + n) + 3 * Math.sin(s * 0.63 + n * 3)) / 111320;
  lng += (5 * Math.cos(s * 1.3 + n * 2)) / 107000;
  // Arranca sobre la calle (así entra a la cadena) y a los 40 s se va ~440 m
  // hacia el noreste, donde no pasa ninguna de las dos calles del recorrido
  if (f.raro === 'fuera' && (ahora - EPOCA) / 1000 > 40) { lat += 0.005; lng += 0.005; }
  const quieta = f.raro === 'ausente' || (f.raro === 'trafico' && (ahora - EPOCA) / 1000 > 50);
  const kmh = quieta ? Math.random() * 2 : Math.max(3, f.kmh * factor + (Math.random() - 0.5) * 2);
  return { lat, lng, speed: Math.round(kmh), tramo };   // los teléfonos mandan km/h enteros
}

let flotaViva = false;
async function arrancarFlota() {
  const tokens = {};
  for (const p of D.PERSONAS.filter(p => p.rol === 'driver' && p.combi !== 'M-01' && !p.suplente)) {
    tokens[p.combi] = await entrar(p.usuario, D.CLAVE_CHOFER);
  }
  EPOCA = Date.now();
  flotaViva = true;
  let traficoAvisado = false;
  (async () => {
    while (flotaViva) {
      const ahora = Date.now();
      const s = (ahora - EPOCA) / 1000;
      await Promise.all(Object.entries(tokens).map(async ([id, token]) => {
        const f = D.FLOTA[id];
        if (f.raro === 'muda' && s > 45) return;               // se le cortó la señal
        const p = posicion(id, ahora);
        try {
          await fetch(API + '/gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({
              posiciones: [{ lat: p.lat, lng: p.lng, speed: p.speed, precision: 8 + Math.round(Math.random() * 10), timestamp: ahora }],
              presencia: f.raro === 'ausente' ? 'ausente' : 'ruta',
            }),
          });
        } catch {}
      }));
      // El de M-08 avisa que está en el tráfico, de un toque, como en la app
      if (!traficoAvisado && s > 80) {
        traficoAvisado = true;
        pedir('/trafico', { metodo: 'POST', token: tokens['M-08'], cuerpo: { activo: true } }).catch(e => errores.push('tráfico: ' + e.message));
      }
      await dormir(3000);
    }
  })();
}

// ─── El historial: dos semanas de trabajo, para Números y los informes ───
function sembrarHistorial() {
  const db = new Database(DB);
  const variante = Object.fromEntries(db.prepare('SELECT routeId, variantId FROM route_variants WHERE activa = 1').all().map(r => [r.routeId, r.variantId]));
  const insLap = db.prepare(`INSERT INTO laps (unitId, routeId, variantId, startedAt, finishedAt, durationSec, avgSpeed, brechaProm, objetivoSec, parcial, progresoInicial) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insLeg = db.prepare(`INSERT INTO legs (unitId, routeId, variantId, leg, startedAt, finishedAt, durationSec, parcial) VALUES (?,?,?,?,?,?,?,?)`);
  const insTurno = db.prepare(`INSERT INTO shifts (personId, vehicleId, routeId, role, startedAt, lastSeenAt, endedAt) VALUES (?,?,?,?,?,?,?)`);
  const insDesvio = db.prepare(`INSERT INTO deviations (vehicleId, routeId, startedAt, endedAt, durationSec, maxM, umbralM, silenciado, cierre) VALUES (?,?,?,?,?,?,?,0,'regreso')`);
  const insMsg = db.prepare(`INSERT INTO messages (kind, unitId, driverName, text, routeId, vehicleId, timestamp) VALUES (?,?,?,?,?,?,?)`);
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  let semilla = 11;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
  const ahora = Date.now();
  db.transaction(() => {
    for (let d = 14; d >= 0; d--) {
      const dia = hoy0.getTime() - d * 86400_000;
      const domingo = new Date(dia).getDay() === 0;
      D.PERSONAS.filter(p => p.rol === 'driver' && !p.suplente).forEach((p, i) => {
        if (domingo && i % 2) return;
        if ((d + i) % 9 === 0) return;                        // franco
        const ruta = p.ruta;
        const objetivo = D.RUTAS[ruta].objetivoMin * 60;
        const inicio = dia + (5.5 + (i % 4) * 0.5) * 3600_000;
        const vueltas = 4 + Math.floor(azar() * 4);
        let t = inicio;
        for (let v = 0; v < vueltas; v++) {
          const dur = Math.round(D.RUTAS[ruta].duracionMin * 60 * (0.85 + azar() * 0.3));
          // Hoy, sólo lo que ya pasó, con una hora de margen: lo de ahora lo hace la flota
          if (t + dur * 1000 > ahora - 3600_000) break;
          const brecha = Math.round(objetivo * (0.7 + azar() * 0.6));
          insLap.run(p.combi, ruta, variante[ruta], t, t + dur * 1000, dur, 18 + Math.round(azar() * 8), brecha, objetivo, 0, 0.01);
          insLeg.run(p.combi, ruta, variante[ruta], 'ida', t, t + dur * 480, Math.round(dur * 0.48), 0);
          insLeg.run(p.combi, ruta, variante[ruta], 'vuelta', t + dur * 480, t + dur * 1000, Math.round(dur * 0.52), 0);
          t += dur * 1000 + (6 + azar() * 10) * 60_000;
        }
        if (t === inicio) return;
        insTurno.run(p.usuario, p.combi, ruta, 'driver', inicio - 10 * 60_000, t, t + 5 * 60_000);
        const cob = D.PERSONAS.find(q => q.rol === 'collector' && q.combi === p.combi);
        if (cob) insTurno.run(cob.usuario, p.combi, ruta, 'collector', inicio, t, t + 5 * 60_000);
        if ((d * 3 + i) % 11 === 0) insDesvio.run(p.combi, ruta, inicio + 2 * 3600_000, inicio + 2 * 3600_000 + 420_000, 420, 380 + Math.round(azar() * 200), 300);
      });
      if (d === 6) insMsg.run('sos', 'ch-wilber', 'Wilber Apaza Ticona', null, '18A', 'M-04', dia + 9.3 * 3600_000);
    }
  })();
  db.close();
}

// ─── El navegador ───────────────────────────────────────────────────────
let browser = null;
async function contexto({ ancho = 1440, alto = 900, escala = 1, movil = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: ancho, height: alto }, deviceScaleFactor: escala,
    isMobile: movil, hasTouch: movil, locale: 'es-PE', timezoneId: process.env.TZ,
  });
  await interceptarHttps(ctx);
  // Despacho y el creador piden las tiles al proveedor (con clave). Para el
  // manual se las sirve el mapa propio del servidor: son las mismas calles.
  // Va DESPUÉS del interceptor: en Playwright gana la ruta registrada última.
  if (TILES_DIR) {
    await ctx.route(/maps\.geoapify\.com\/v1\/tile\//, async (route) => {
      const m = route.request().url().match(/tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
      if (!m) return route.abort();
      const estilo = /dark/.test(m[1]) ? 'oscuro' : 'claro';
      try {
        const r = await fetch(`${API}/tiles/xyz/juliaca/${estilo}/${m[2]}/${m[3]}/${m[4]}.png`);
        if (!r.ok) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(await r.arrayBuffer()) });
      } catch { return route.abort(); }
    });
  }
  return ctx;
}
async function pagina(ctx, url, quien) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(`${quien}: error de la página: ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Una tile que el mapa propio no tiene (fuera de la zona) no es un error del manual
    if (/Failed to load resource/.test(t)) return;
    errores.push(`${quien}: consola: ${t.slice(0, 200)}`);
  });
  await p.goto(API + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  return p;
}
// JPEG: con mapas y capturas grandes, el PNG hacía un manual de 40 MB
async function foto(p, nombre, opciones = {}) {
  if (SOLO.length && !SOLO.some(s => nombre.startsWith(s))) return;
  await p.screenshot({ path: path.join(IMG, nombre + '.jpg'), type: 'jpeg', quality: 86, ...opciones });
  hechas.push(nombre);
}
async function paso(nombre, fn) {
  try { await fn(); } catch (e) { errores.push(`${nombre}: ${e.message.split('\n')[0]}`); }
}
const clic = (p, sel, ms = 1200) => p.click(sel, { timeout: 6000 }).then(() => p.waitForTimeout(ms));

// ─── El recorrido ───────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  await arrancar();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const escritorio = () => contexto({ ancho: 1440, alto: 900, escala: 1 });

  // ── 1. EL CREADOR da de alta la cooperativa ───────────────────────────
  const cctx = await escritorio();
  const cr = await pagina(cctx, '/creador', 'creador');
  await paso('creador: entrar', async () => {
    await foto(cr, 'k01-creador-entrar');
    await cr.locator('input').nth(0).fill(D.CLAVE_CREADOR);
    await clic(cr, 'button:has-text("Entrar")', 2500);
    await foto(cr, 'k02-cooperativas');
  });
  await paso('creador: nueva cooperativa', async () => {
    await clic(cr, 'button:has-text("+ Nueva cooperativa")');
    const campo = (ph, v) => cr.fill(`input[placeholder="${ph}"]`, v);
    await campo('COOP-15', D.EMPRESA);
    await campo('Cooperativa Santa Rosa', D.NOMBRE_EMPRESA);
    await cr.locator('label:has-text("RUC") + input').fill(D.RUC);
    await cr.locator('label:has-text("Contacto") + input').fill(D.CONTACTO);
    await campo('R-15', '18A');
    await campo('Plaza ↔ Salida Cusco', D.RUTAS['18A'].nombre);
    await cr.locator('input[placeholder="DESPACHO-15"]').first().fill(D.DESPACHO);
    await cr.locator('label:has-text("Su clave") + input').fill(D.CLAVE_DESPACHO);
    await foto(cr, 'k03-nueva-cooperativa');
    await clic(cr, 'button:has-text("Crear")', 2500);
    const txt = await cr.evaluate(() => document.body.innerText);
    if (!txt.includes(D.NOMBRE_EMPRESA)) throw new Error('la cooperativa no aparece después de crearla');
  });
  // Lo que en la pantalla es repetir lo mismo, por la API: la segunda ruta,
  // la cuenta de gerencia y los recorridos.
  let tokCr = null;
  await paso('creador: rutas y cuentas', async () => {
    tokCr = (await pedir('/creador/login', { metodo: 'POST', cuerpo: { password: D.CLAVE_CREADOR } })).token;
    await pedir(`/creador/empresas/${D.EMPRESA}/rutas`, { metodo: 'POST', token: tokCr, cuerpo: { routeId: '18B', name: D.RUTAS['18B'].nombre, targetGapMin: D.RUTAS['18B'].objetivoMin, durationMin: D.RUTAS['18B'].duracionMin } });
    await pedir(`/creador/empresas/${D.EMPRESA}/gerencia`, { metodo: 'POST', token: tokCr, cuerpo: { usuario: D.GERENTE, clave: D.CLAVE_GERENTE } });
    for (const r of ['18A', '18B']) {
      const aPuntos = pts => pts.map(([lat, lng]) => ({ lat, lng }));
      await pedir(`/creador/empresas/${D.EMPRESA}/rutas/${r}/recorrido`, { metodo: 'PUT', token: tokCr,
        cuerpo: { tramos: { ida: aPuntos(RUTAS[r].ida), vuelta: aPuntos(RUTAS[r].vuelta) } } });
    }
  });
  await paso('creador: administrar', async () => {
    await cr.reload({ waitUntil: 'domcontentloaded' }); await cr.waitForTimeout(2000);
    // La sesión del creador muere al recargar: se vuelve a entrar
    if (await cr.locator('button:has-text("Entrar")').count()) {
      await cr.locator('input').nth(0).fill(D.CLAVE_CREADOR);
      await clic(cr, 'button:has-text("Entrar")', 2500);
    }
    // La tarjeta de ESTA cooperativa: el div más adentro que tiene su nombre
    // y un «Administrar» (los de afuera contienen a las dos)
    const tarjeta = cr.locator('div').filter({ hasText: D.NOMBRE_EMPRESA })
      .filter({ has: cr.locator('button:has-text("Administrar")') }).last();
    await tarjeta.locator('button:has-text("Administrar")').click(); await cr.waitForTimeout(1500);
    await foto(cr, 'k04-administrar', { fullPage: true });
    await tarjeta.locator('textarea').first().fill('Recordatorio: la cuota de noviembre vence el viernes 7. Cualquier consulta, a administración.');
    await tarjeta.locator('button:has-text("Enviar aviso")').click(); await cr.waitForTimeout(1500);
    await foto(cr, 'k09-aviso', { fullPage: true });
  });
  await paso('creador: trazados', async () => {
    await clic(cr, 'button:has-text("RUTAS")', 1500);
    const selects = cr.locator('select');
    await selects.nth(0).selectOption(D.EMPRESA); await cr.waitForTimeout(1200);
    await selects.nth(1).selectOption('18A'); await cr.waitForTimeout(3500);
    await foto(cr, 'k05-trazador');
  });
  await paso('creador: respaldos', async () => {
    await clic(cr, 'button:has-text("RESPALDOS")', 1500);
    await clic(cr, 'button:has-text("Respaldar ahora")', 2500);
    await foto(cr, 'k06-respaldos');
  });

  // ── 2. LA GERENCIA carga las combis y el logo ─────────────────────────
  const gctx = await escritorio();
  const ge = await pagina(gctx, '/despacho.html', 'gerencia');
  const entrarPanel = async (p, usuario, clave) => {
    const campos = p.locator('input');
    await campos.nth(0).fill(usuario); await campos.nth(1).fill(clave);
    await clic(p, 'button:has-text("INGRESAR")', 4500);
  };
  await paso('gerencia: entrar', () => entrarPanel(ge, D.GERENTE, D.CLAVE_GERENTE));
  await paso('gerencia: vehículos', async () => {
    await clic(ge, 'button:has-text("Gestión")', 1500);
    await clic(ge, 'button:has-text("Vehículos")', 1500);
    const primero = D.VEHICULOS[0];
    await ge.fill('input[placeholder="Código (ej. M-21)"]', primero.id);
    await ge.fill('input[placeholder="Placa o descripción (opcional)"]', primero.placa);
    await foto(ge, 'g04-vehiculo-alta');
    await ge.locator('input[placeholder="Placa o descripción (opcional)"]').press('Enter');
    await ge.waitForTimeout(800);
    // Si el Enter no lo dio de alta, el botón de al lado
    if (!(await ge.evaluate(id => document.body.innerText.includes(id + ' '), primero.id))) {
      await ge.locator('input[placeholder="Placa o descripción (opcional)"] >> xpath=following::button[1]').click().catch(() => {});
    }
    const tok = await entrar(D.GERENTE, D.CLAVE_GERENTE);
    for (const v of D.VEHICULOS) {
      await pedir('/admin/vehicles', { metodo: 'POST', token: tok, cuerpo: { vehicleId: v.id, label: v.placa, routeId: v.ruta } }).catch(() => {});
    }
  });
  await paso('gerencia: logo', async () => {
    // El logo de la cooperativa, dibujado acá mismo (inventado, como todo)
    const lienzo = await gctx.newPage();
    await lienzo.setContent(`<div id="l" style="width:256px;height:256px;border-radius:40px;background:#0E4C92;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
      <svg width="256" height="256" style="position:absolute;inset:0"><polygon points="0,200 70,110 110,150 160,80 256,190 256,256 0,256" fill="#F2B705"/><polygon points="0,225 90,160 140,200 190,150 256,215 256,256 0,256" fill="#2E8B57"/></svg>
      <span style="position:relative;font:900 92px Arial;color:#fff;letter-spacing:-4px;margin-top:-70px">TA</span></div>`);
    const png = await lienzo.locator('#l').screenshot({ type: 'png' });
    await lienzo.close();
    await clic(ge, 'button:has-text("Empresa")', 1500);
    await ge.setInputFiles('input[type="file"]', { name: 'logo.png', mimeType: 'image/png', buffer: png });
    await ge.waitForTimeout(2500);
    await foto(ge, 'g03-empresa');
  });

  // ── 3. DESPACHO da de alta a la gente ─────────────────────────────────
  const dctx = await escritorio();
  const de = await pagina(dctx, '/despacho.html', 'despacho');
  await paso('despacho: entrar', async () => {
    await foto(de, 'd01-entrar');
    await entrarPanel(de, D.DESPACHO, D.CLAVE_DESPACHO);
  });
  await paso('despacho: alta de persona', async () => {
    await clic(de, 'button:has-text("Gestión")', 1500);
    await clic(de, 'button:has-text("Personas")', 1200);
    await clic(de, 'button:has-text("+ Persona")', 1000);
    const p0 = D.PERSONAS[0];
    await de.fill('input[placeholder="Nombre y apellido *"]', p0.nombre);
    await de.fill('input[placeholder="Alias (opcional)"]', p0.alias);
    await de.fill('input[placeholder="Usuario para entrar *"]', p0.usuario);
    const veh = de.locator('select[title="Vehículo en el que va"]');
    if (await veh.count()) await veh.selectOption(p0.combi).catch(() => {});
    await de.fill('input[placeholder="Contraseña (o generar →)"]', D.CLAVE_CHOFER);
    await foto(de, 'd08-alta-persona');
    await clic(de, 'button:has-text("+ Alta")', 1500);
    // Rufino también puede manejar M-07 (la de Rosa): habilitada desde acá
    if (D.COMBIS_EXTRA_RUFINO) {
      const fila = de.locator('div').filter({ hasText: p0.usuario }).filter({ has: de.locator('button:has-text("Combis")') }).last();
      await fila.locator('button:has-text("Combis")').click({ timeout: 6000 });
      await de.waitForTimeout(600);
      for (const c of D.COMBIS_EXTRA_RUFINO) await clic(de, `[data-combis-de="${p0.usuario}"] [data-habilitar="${c}"]`, 300);
      await foto(de, 'd08b-combis');
      await clic(de, `[data-combis-de="${p0.usuario}"] button:has-text("Guardar")`, 1500);
    }
    const tok = await entrar(D.DESPACHO, D.CLAVE_DESPACHO);
    for (const p of D.PERSONAS.slice(1)) {
      await pedir('/admin/users', { metodo: 'POST', token: tok, cuerpo: { unitId: p.usuario, name: p.nombre, alias: p.alias, personRole: p.rol, vehicleId: p.combi, password: D.CLAVE_CHOFER, routeId: p.ruta } });
    }
    // Los objetivos de brecha de cada ruta, como los fijaría Despacho
    for (const [r, v] of Object.entries(D.RUTAS)) {
      await pedir(`/admin/routes/${r}/target`, { metodo: 'POST', token: tok, cuerpo: { targetGapMin: v.objetivoMin, auto: false } });
    }
    await clic(de, 'button:has-text("✕ Volver al mapa")', 1000);
  });

  sembrarHistorial();
  await arrancarFlota();

  // ── 4. EL CHOFER (el teléfono de Rufino) ──────────────────────────────
  const mctx = await contexto({ ancho: 412, alto: 892, escala: 1.5, movil: true });
  await mctx.grantPermissions(['geolocation']);
  // Rufino arranca lejos del trazado: así se ve «yendo a la ruta»
  let enLaRuta = false;
  const moverRufino = async () => {
    const p = posicion('M-01');
    const lejos = { lat: p.lat + 0.006, lng: p.lng - 0.004 };
    const q = enLaRuta ? p : lejos;
    await mctx.setGeolocation({ latitude: q.lat, longitude: q.lng, accuracy: 6 + Math.random() * 8 }).catch(() => {});
  };
  await moverRufino();
  const gpsRufino = setInterval(moverRufino, 2000);
  const ch = await pagina(mctx, '/', 'chofer');
  await paso('chofer: entrar', async () => {
    await foto(ch, 'c01-entrar');
    await clic(ch, 'button:has-text("Olvidé mi contraseña")', 600);
    await foto(ch, 'c13-olvide');
    await clic(ch, 'button:has-text("Olvidé mi contraseña")', 300);
    await ch.locator('input').nth(0).fill('ch-rufino');
    await ch.locator('input').nth(1).fill(D.CLAVE_CHOFER);
    await clic(ch, 'button:has-text("INGRESAR")', 2500);
    await ch.waitForSelector('[data-combis]', { timeout: 8000 }).catch(() => {});
    await ch.waitForTimeout(600);
    await foto(ch, 'c02-puerta');
    // Elegir la que maneja otro pide confirmar el relevo; acá se cancela
    if (await ch.$('[data-combi="M-07"]')) {
      await clic(ch, '[data-combi="M-07"]', 500);
      await foto(ch, 'c02c-relevo');
      await clic(ch, '[data-combis] button:has-text("Cancelar")', 400);
    }
  });
  await paso('chofer: salir a ruta, yendo', async () => {
    await clic(ch, 'button:has-text("SALIR A RUTA")', 6000);
    await foto(ch, 'c04-yendo');
    enLaRuta = true;
    await moverRufino();
    for (let i = 0; i < 20; i++) {
      await ch.waitForTimeout(1500);
      if (!(await ch.evaluate(() => document.body.innerText.includes('YENDO A LA RUTA')))) break;
    }
    await ch.waitForTimeout(4000);
    await foto(ch, 'c03-brechas');
  });
  await paso('chofer: tema noche', async () => {
    // DÍA → NOCHE, y de vuelta pasando por AUTO (el ciclo es AUTO, DÍA, NOCHE)
    await clic(ch, 'button[data-tema]', 1500);
    await foto(ch, 'c15-noche');
    await clic(ch, 'button[data-tema]', 300);
    await clic(ch, 'button[data-tema]', 1500);
  });

  // ── 5. DESPACHO con la flota andando ──────────────────────────────────
  // El suplente de M-02 entra por la web y arranca sin salir a ruta: el
  // vigía de la puerta lo ve manejando y avisa. El reloj de esa página va a
  // mano —la velocidad se mide en ventanas de 30 s—, y se cierra antes de
  // que salga solo: así queda en la puerta para el panel de Despacho.
  await paso('chofer: el vigía de la puerta', async () => {
    const sup = D.PERSONAS.find(p => p.suplente);
    const rctx = await contexto({ ancho: 412, alto: 892, escala: 1.5, movil: true });
    await rctx.grantPermissions(['geolocation']);
    const base = posicion(sup.combi);
    await rctx.setGeolocation({ latitude: base.lat, longitude: base.lng, accuracy: 8 });
    const rp = await rctx.newPage();
    rp.on('pageerror', e => errores.push(`suplente: error de la página: ${e.message}`));
    await rp.clock.install({ time: new Date() });
    await rp.goto(API + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await rp.waitForSelector('input[type="password"]', { timeout: 30000 });
    await rp.locator('input').nth(0).fill(sup.usuario);
    await rp.locator('input').nth(1).fill(D.CLAVE_CHOFER);
    await rp.click('button:has-text("INGRESAR")');
    await rp.waitForSelector('button:has-text("SALIR A RUTA")', { timeout: 15000 });
    let aviso = null;
    for (let i = 1; i <= 60 && !aviso; i++) {
      await rctx.setGeolocation({ latitude: base.lat - i * 35 / 111320, longitude: base.lng, accuracy: 8 });
      await rp.clock.fastForward(5000);
      aviso = await rp.$('[data-vigia-puerta]');
    }
    if (!aviso) throw new Error('el vigía de la puerta no avisó');
    await rp.clock.fastForward(13_000);
    await rp.waitForTimeout(400);
    await foto(rp, 'c02b-vigia');
    await rctx.close();
  });

  await paso('despacho: el aviso de la central', async () => {
    await de.reload({ waitUntil: 'domcontentloaded' }); await de.waitForTimeout(5000);
    if (await de.locator('button:has-text("INGRESAR")').count()) await entrarPanel(de, D.DESPACHO, D.CLAVE_DESPACHO);
    await foto(de, 'd18-aviso-central', { clip: { x: 0, y: 0, width: 1440, height: 260 } });
    const visto = de.locator('button[title="Lo marca visto para toda la cooperativa; queda registrado quién lo vio"]');
    if (await visto.count()) await clic(de, 'button[title="Lo marca visto para toda la cooperativa; queda registrado quién lo vio"]', 1200);
  });
  await paso('despacho: mensaje directo', async () => {
    // La tarjeta de M-01 (muestra el alias, «Rufo», y la placa)
    const tarjeta = de.locator('div').filter({ hasText: 'Z1A-701' })
      .filter({ has: de.locator('button:has-text("Mensaje directo")') }).last();
    await tarjeta.locator('button:has-text("Mensaje directo")').click({ timeout: 6000 }); await de.waitForTimeout(1000);
    const entrada = de.locator('input[placeholder^="Mensaje solo para"], textarea[placeholder^="Mensaje solo para"]').last();
    await entrada.fill('Rufo, en el paradero del mercado esperá 2 minutos: viene pegado M-02.');
    await entrada.press('Enter');
    await de.waitForTimeout(1500);
    await foto(de, 'd04-mensaje-directo');
    await clic(de, 'button[title="Volver al grupo de la ruta"]', 1000);
  });

  // ── 6. El chofer: mapa, chat, tráfico, SOS, ausente ───────────────────
  const puntos = async () => ch.$$('button[aria-label]');
  const irA = async (nombre) => { await ch.click(`button[aria-label="${nombre}"]`, { timeout: 5000 }); await ch.waitForTimeout(1500); };
  await paso('chofer: mapa', async () => { await irA('Mapa'); await ch.waitForTimeout(4000); await foto(ch, 'c10-mapa'); });
  await paso('chofer: chat', async () => {
    await irA('Chat');
    await ch.fill('input[placeholder^="Mensaje"]', 'Buenos días, salgo del paradero Norte');
    await ch.press('input[placeholder^="Mensaje"]', 'Enter');
    await ch.waitForTimeout(1500);
    await foto(ch, 'c11-chat-grupo');
    await clic(ch, 'button:has-text("DESPACHO")', 1500);
    await foto(ch, 'c12-chat-despacho');
    await clic(ch, 'button:has-text("GRUPO")', 800);
  });
  await paso('chofer: tráfico', async () => {
    await irA('Brechas');
    await clic(ch, 'button:has-text("ESTOY EN TRÁFICO")', 2500);
    await foto(ch, 'c05-trafico');
    await clic(ch, 'button:has-text("EN TRÁFICO")', 1500);
  });
  await paso('chofer: SOS', async () => {
    const perilla = await ch.locator('text=DESLIZÁ PARA SOS').boundingBox();
    const sos = await ch.locator('div:text-is("SOS")').last().boundingBox();
    const desde = sos || { x: perilla.x - 80, y: perilla.y, width: 60, height: perilla.height };
    const y = desde.y + desde.height / 2;
    await ch.mouse.move(desde.x + desde.width / 2, y);
    await ch.mouse.down();
    for (let i = 1; i <= 14; i++) { await ch.mouse.move(desde.x + desde.width / 2 + i * 22, y); await ch.waitForTimeout(30); }
    await ch.mouse.up();
    await ch.waitForTimeout(700);
    await foto(ch, 'c08-sos-enviado');
    await de.waitForTimeout(800);
    await foto(de, 'd05-sos');
    await ch.waitForTimeout(2000);
    await foto(ch, 'c09-sos-que-paso');
    await clic(ch, 'button:has-text("FALLA MECÁNICA")', 1500);
    await de.waitForTimeout(1500);
    await foto(de, 'd05b-sos-tipo', { clip: { x: 0, y: 0, width: 1440, height: 300 } });
  });
  await paso('chofer: ausente', async () => {
    await clic(ch, 'button:has-text("AUSENTE")', 2500);
    await foto(ch, 'c06-ausente');
    await clic(ch, 'button:has-text("VOLVER A RUTA")', 2500);
    await clic(ch, 'button:has-text("SALIR DE RUTA")', 400);
    await foto(ch, 'c07-salir-confirmar');
    await ch.waitForTimeout(4500);                     // se desarma solo
  });

  // ── 7. El cobrador de M-01 ────────────────────────────────────────────
  await paso('cobrador', async () => {
    const kctx = await contexto({ ancho: 412, alto: 892, escala: 1.5, movil: true });
    const ko = await pagina(kctx, '/', 'cobrador');
    await ko.locator('input').nth(0).fill('co-yeny');
    await ko.locator('input').nth(1).fill(D.CLAVE_CHOFER);
    await clic(ko, 'button:has-text("INGRESAR")', 2500);
    if (await ko.locator('button:has-text("SALIR A RUTA")').count()) await clic(ko, 'button:has-text("SALIR A RUTA")', 6000);
    await foto(ko, 'c14-cobrador');
    await kctx.close();
  });

  // ── 8. Despacho: el panel con la flota, Gestión y el tema noche ───────
  await paso('despacho: panel', async () => {
    // El SOS de la prueba ya se atendió
    if (await de.locator('button:has-text("ATENDIDO")').count()) await clic(de, 'button:has-text("ATENDIDO")', 1500);
    // La lista vuelve arriba: el «Mensaje directo» de antes la dejó corrida y
    // tapaba los dos avisos de arriba (fuera del recorrido, no salieron)
    await de.evaluate(() => {
      let e = document.querySelector('[data-puerta]');
      while (e && e !== document.body) { if (e.scrollHeight > e.clientHeight + 2) e.scrollTop = 0; e = e.parentElement; }
    });
    await de.waitForTimeout(2000);
    await foto(de, 'd02-panel');
    await foto(de, 'd03-lista', { clip: { x: 0, y: 60, width: 312, height: 840 } });
  });
  await paso('despacho: noche', async () => {
    await clic(de, 'button:has-text("☾")', 2500);
    await foto(de, 'd06-noche');
    await clic(de, 'button:has-text("☀")', 1500);
  });
  await paso('despacho: gestión', async () => {
    await clic(de, 'button:has-text("Gestión")', 1500);
    for (const [boton, nombre] of [
      ['Personas', 'd07-personas'], ['Vehículos', 'd09-vehiculos'], ['Turnos', 'd10-turnos'],
      ['Rutas', 'd11-rutas'], ['Vueltas', 'd13-vueltas'], ['Dónde se traba', 'd14-donde-se-traba'],
      ['Informes', 'd15-informes'], ['Empresa', 'd16-empresa'], ['Actividad', 'd17-actividad'],
    ]) {
      await clic(de, `button:has-text("${boton}")`, 2200);
      await foto(de, nombre);
    }
    await clic(de, 'button:has-text("Rutas")', 1500);
    await clic(de, 'button:has-text("Abrir trazador")', 4000);
    await foto(de, 'd12-trazador');
  });

  // ── 9. La gerencia: Números ───────────────────────────────────────────
  await paso('gerencia: números', async () => {
    await ge.reload({ waitUntil: 'domcontentloaded' }); await ge.waitForTimeout(4000);
    if (await ge.locator('button:has-text("INGRESAR")').count()) await entrarPanel(ge, D.GERENTE, D.CLAVE_GERENTE);
    await clic(ge, 'button:has-text("Gestión")', 1500);
    await clic(ge, 'button:has-text("Números")', 3500);
    await foto(ge, 'g01-numeros');
    await ge.evaluate(() => {
      const caja = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > d.clientHeight + 200);
      if (caja) caja.scrollTop = 620;
    });
    await ge.waitForTimeout(800);
    await foto(ge, 'g02-numeros-tablas');
  });

  // ── 10. El creador, al final: lo que pasó en el sistema ───────────────
  await paso('creador: sistema y actividad', async () => {
    await clic(cr, 'button:has-text("SISTEMA")', 2500);
    await foto(cr, 'k07-sistema');
    await clic(cr, 'button:has-text("ACTIVIDAD")', 2500);
    await foto(cr, 'k08-actividad');
    await clic(cr, 'button:has-text("COOPERATIVAS")', 2000);
    await foto(cr, 'k02b-cooperativas');
  });

  clearInterval(gpsRufino);
  flotaViva = false;
  await browser.close();
  servidor.kill();
  console.log(`${hechas.length} capturas en ${path.relative(RAIZ, IMG)}/`);
  if (errores.length) {
    console.log('\nLO QUE NO SALIÓ:');
    for (const e of errores) console.log('  · ' + e);
  }
  process.exit(errores.length ? 1 : 0);
})().catch(e => {
  console.error('SE CAYÓ:', e.stack || e.message);
  try { servidor && servidor.kill(); } catch {}
  process.exit(1);
});
