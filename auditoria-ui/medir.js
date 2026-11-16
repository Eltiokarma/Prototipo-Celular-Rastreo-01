#!/usr/bin/env node
// Mide, sobre las pantallas corriendo, lo que una captura no dice con número:
// zonas táctiles, tamaño de letra, contraste del texto contra su fondo real
// y animaciones vivas (con y sin prefers-reduced-motion). De acá salieron las
// cifras de AUDITORIA-UI-2026-11-16.md.
//
//   API=http://localhost:3150 node auditoria-ui/medir.js
//   SOLO=chofer node auditoria-ui/medir.js      # chofer | despacho | creador | publicas
//
// Necesita un servidor YA ANDANDO con la cooperativa de demostración del
// manual (manual/demo.js) y la flota reportando. `manual/capturas.js` arma
// todo eso pero apaga el servidor al terminar: para la auditoría se corrió
// una copia que lo deja vivo. Dejar eso como opción (VIVO=1) es el paso 0 del
// plan. Las capturas y el JSON quedan en auditoria-ui/medidas/ (no va al repo).
//
// Límites: el fondo se calcula subiendo por los ancestros, así que un texto
// sobre degradado o imagen sale marcado «dudoso»; y «texto grande» se decide
// por tamaño y peso declarados, de modo que Archivo Black (peso 400, pero
// negra a la vista) se juzga con el piso de 4,5 cuando le toca el de 3.
'use strict';
const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');
const { chromium } = require(RAIZ + '/pruebas/node_modules/playwright-core');
const interceptarHttps = require(RAIZ + '/pruebas/cdn.js');
const D = require(RAIZ + '/manual/demo.js');
const RUTAS = require(RAIZ + '/manual/rutas-demo.json');
const API = process.env.API || 'http://localhost:3150';
const OUT = path.join(__dirname, 'medidas');
fs.mkdirSync(OUT, { recursive: true });
const res = {};

function enPagina() {
  const rgb = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const sobre = (f, b) => ({ r: f.a * f.r + (1 - f.a) * b.r, g: f.a * f.g + (1 - f.a) * b.g, b: f.a * f.b + (1 - f.a) * b.b, a: 1 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const vis = el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05 &&
      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  // El fondo real: se sube por los ancestros componiendo los translúcidos
  const fondoDe = el => {
    const capas = []; let dudoso = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') dudoso = true;
      const c = rgb(s.backgroundColor);
      if (c && c.a > 0) { capas.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base);
    return { c: base, dudoso };
  };
  const interactivos = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=menuitem],summary')]
    .filter(vis).map(el => {
      const r = el.getBoundingClientRect();
      return { t: (el.innerText || el.getAttribute('aria-label') || el.title || el.placeholder || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 44),
        w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(getComputedStyle(el).fontSize), dis: !!el.disabled };
    });
  const textos = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode; const t = n.textContent.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const el = n.parentElement; if (!el || !vis(el)) continue;
    if (el.closest('.leaflet-container') && !el.closest('.leaflet-control')) { /* pines: se miden igual */ }
    const s = getComputedStyle(el); const fs = parseFloat(s.fontSize); const peso = parseInt(s.fontWeight, 10) || 400;
    const { c: bg, dudoso } = fondoDe(el);
    let fg = rgb(s.color); if (!fg) continue;
    // opacidad heredada
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    fg = sobre({ ...fg, a: fg.a * op }, bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const cr = (hi + 0.05) / (lo + 0.05);
    const grande = fs >= 24 || (fs >= 18.66 && peso >= 700);
    textos.push({ t: t.slice(0, 50), fs, peso, fam: s.fontFamily.split(',')[0].replace(/"/g, ''), fg: hex(fg), bg: hex(bg), cr: Math.round(cr * 100) / 100,
      piso: grande ? 3 : 4.5, dudoso, mayus: s.textTransform === 'uppercase', ls: s.letterSpacing });
  }
  const anims = document.getAnimations().map(a => ({
    n: a.animationName || (a.transitionProperty ? 'transition:' + a.transitionProperty : '?'),
    it: a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : null,
    dur: a.effect && a.effect.getTiming ? a.effect.getTiming().duration : null, st: a.playState,
  }));
  return { vw: innerWidth, vh: innerHeight, interactivos, textos, anims,
    reducido: matchMedia('(prefers-reduced-motion: reduce)').matches };
}

async function medir(p, nombre, { foto = true } = {}) {
  const m = await p.evaluate(enPagina);
  res[nombre] = m;
  if (foto) await p.screenshot({ path: path.join(OUT, nombre + '.png') });
  const chicos = m.interactivos.filter(i => !i.dis && (i.h < 44 || i.w < 44));
  const bajos = m.textos.filter(t => t.cr < t.piso && !t.dudoso);
  const mini = m.textos.filter(t => t.fs < 12);
  console.log(`\n=== ${nombre} (${m.vw}×${m.vh}) · interactivos ${m.interactivos.length} · <44px: ${chicos.length} · <24px: ${chicos.filter(i => i.h < 24 || i.w < 24).length} · texto bajo piso: ${bajos.length}/${m.textos.length} · <12px: ${mini.length} · anims: ${m.anims.length}`);
  return m;
}

const dormir = ms => new Promise(r => setTimeout(r, ms));
async function ctx(b, { ancho, alto, movil = false, reducido = false, escala = 1 }) {
  const c = await b.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: escala, isMobile: movil, hasTouch: movil,
    locale: 'es-PE', timezoneId: 'America/Lima', permissions: ['notifications', 'geolocation'], reducedMotion: reducido ? 'reduce' : 'no-preference' });
  await interceptarHttps(c);
  return c;
}
const abrir = async (c, url) => { const p = await c.newPage(); await p.goto(API + url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500); return p; };
const clic = (p, sel, ms = 1200) => p.click(sel, { timeout: 6000 }).then(() => p.waitForTimeout(ms));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const SOLO = (process.env.SOLO || '').split(',').filter(Boolean);
  const va = n => !SOLO.length || SOLO.includes(n);

  // ── CHOFER ────────────────────────────────────────────────────────────
  if (va('chofer')) for (const reducido of [false, true]) {
    const suf = reducido ? '-reducido' : '';
    const c = await ctx(b, { ancho: 412, alto: 892, movil: true, reducido });
    const pt = RUTAS['18A'].ida[40];
    let k = 40;
    const mover = async () => { k = (k + 1) % RUTAS['18A'].ida.length; const q = RUTAS['18A'].ida[k]; await c.setGeolocation({ latitude: q[0] + (Math.random() - .5) * 6e-5, longitude: q[1] + (Math.random() - .5) * 6e-5, accuracy: 8 }).catch(() => {}); };
    await c.setGeolocation({ latitude: pt[0], longitude: pt[1], accuracy: 8 });
    const t = setInterval(mover, 2500);
    const p = await abrir(c, '/');
    await p.evaluate(() => localStorage.setItem('r14_central', '051321456'));
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
    if (!reducido) await medir(p, 'chofer-login');
    await p.locator('input').nth(0).fill('ch-rufino');
    await p.locator('input').nth(1).fill(D.CLAVE_CHOFER);
    await clic(p, 'button:has-text("INGRESAR")', 3000);
    await p.waitForSelector('[data-combis]', { timeout: 8000 }).catch(() => {});
    await medir(p, 'chofer-puerta' + suf);
    await clic(p, 'button:has-text("SALIR A RUTA")', 6000);
    for (let i = 0; i < 25; i++) { await p.waitForTimeout(1500); if (!(await p.evaluate(() => document.body.innerText.includes('YENDO A LA RUTA')))) break; }
    await p.waitForTimeout(3000);
    await medir(p, 'chofer-hud' + suf);
    { const v = p.locator('button:has-text("DESPACHO VIO TU SOS")'); if (await v.count()) { await v.first().click().catch(() => {}); await p.waitForTimeout(800); await medir(p, 'chofer-hud-limpio' + suf); } }
    if (!reducido) {
      await clic(p, 'button[aria-label="Mapa"]', 4000).catch(e => console.log('mapa:', e.message.split('\n')[0]));
      await medir(p, 'chofer-mapa');
      await clic(p, 'button[aria-label="Chat"]', 2000).catch(e => console.log('chat:', e.message.split('\n')[0]));
      await medir(p, 'chofer-chat');
      const ar = await p.evaluate(() => [...document.querySelectorAll('button[aria-label]')].map(x => x.getAttribute('aria-label')));
      console.log('aria-labels:', ar.join(' | '));
      const vuelve = ar.find(a => /ruta|brecha|hud|centro/i.test(a));
      if (vuelve) await clic(p, `button[aria-label="${vuelve}"]`, 1500).catch(() => {});
      await clic(p, 'button[data-tema]', 1500).catch(() => {});
      await medir(p, 'chofer-hud-noche');
    }
    clearInterval(t);
    await c.close();
  }

  // ── DESPACHO: escritorio y celular ────────────────────────────────────
  if (va('despacho')) for (const [nombre, o] of [['despacho-pc', { ancho: 1440, alto: 900 }], ['despacho-cel', { ancho: 390, alto: 844, movil: true }], ['despacho-pc-reducido', { ancho: 1440, alto: 900, reducido: true }]]) {
    const c = await ctx(b, o);
    const p = await abrir(c, '/despacho.html');
    if (nombre === 'despacho-pc') await medir(p, 'despacho-login');
    const campos = p.locator('input');
    await campos.nth(0).fill(D.DESPACHO); await campos.nth(1).fill(D.CLAVE_DESPACHO);
    await clic(p, 'button:has-text("INGRESAR")', 5000);
    await medir(p, nombre + '-panel');
    if (nombre === 'despacho-cel') {
      const tabs = await p.evaluate(() => [...document.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean).slice(-8));
      console.log('botones al final:', tabs.join(' | '));
      for (const v of ['Mapa', 'Chat', 'Gestión']) {
        await p.locator(`button:has-text("${v}")`).last().click({ timeout: 4000 }).catch(e => console.log(v, e.message.split('\n')[0]));
        await p.waitForTimeout(1500);
        await medir(p, `${nombre}-${v.toLowerCase()}`);
      }
    }
    if (nombre === 'despacho-pc') {
      await clic(p, 'button:has-text("Gestión")', 1500);
      for (const s of ['Personas', 'Vehículos', 'Turnos', 'Rutas', 'Vueltas', 'Dónde se traba', 'Informes', 'Empresa', 'Actividad']) {
        await p.locator(`button:has-text("${s}")`).first().click({ timeout: 4000 }).catch(e => console.log(s, e.message.split('\n')[0]));
        await p.waitForTimeout(1500);
        await medir(p, 'despacho-pc-' + s.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, ''));
      }
      // tema noche
      await clic(p, 'button:has-text("Mapa en vivo")', 1200).catch(() => {});
      await p.locator('button[title*="ema"], button[aria-label*="ema"]').first().click({ timeout: 3000 }).catch(e => console.log('tema:', e.message.split('\n')[0]));
      await p.waitForTimeout(1500);
      await medir(p, 'despacho-pc-noche');
    }
    await c.close();
  }

  // ── CREADOR ───────────────────────────────────────────────────────────
  if (va('creador')) {
    const c = await ctx(b, { ancho: 1440, alto: 900 });
    const p = await abrir(c, '/creador');
    await medir(p, 'creador-login');
    await p.locator('input').nth(0).fill(D.CLAVE_CREADOR);
    await clic(p, 'button:has-text("Entrar")', 2500);
    await medir(p, 'creador-cooperativas');
    for (const s of ['RUTAS', 'RESPALDOS', 'SISTEMA', 'ACTIVIDAD']) {
      await clic(p, `button:has-text("${s}")`, 2500).catch(e => console.log(s, e.message.split('\n')[0]));
      await medir(p, 'creador-' + s.toLowerCase());
    }
    await c.close();
  }

  // ── PÁGINAS PÚBLICAS ──────────────────────────────────────────────────
  if (va('publicas')) for (const [suf, o] of [['pc', { ancho: 1440, alto: 900 }], ['cel', { ancho: 390, alto: 844, movil: true }]]) {
    const c = await ctx(b, o);
    for (const [n, u] of [['landing', '/landing'], ['privacidad', '/privacidad'], ['consentimiento', '/consentimiento'], ['gerencia', '/gerencia.html']]) {
      const p = await abrir(c, u).catch(e => null);
      if (!p) { console.log('no abrió', u); continue; }
      await medir(p, `${n}-${suf}`, { foto: false });
      await p.screenshot({ path: path.join(OUT, `${n}-${suf}.png`), fullPage: true });
      await p.close();
    }
    await c.close();
  }

  fs.writeFileSync(path.join(OUT, (process.env.SOLO || 'todo') + '.json'), JSON.stringify(res, null, 1));
  await b.close();
})().catch(e => { console.error('SE CAYÓ:', e.stack || e.message); process.exit(1); });
