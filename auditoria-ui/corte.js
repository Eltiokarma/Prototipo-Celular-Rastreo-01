#!/usr/bin/env node
// ¿Qué ve el chofer cuando se queda sin señal a mitad de vuelta?
// Entra como chofer, sale a ruta, corta la red y lee la pantalla a los 5, 15,
// 30, 60 y 90 s; después intenta mandar un mensaje. Es la evidencia de N1 y
// N3 en AUDITORIA-UI-2026-11-16.md.
//
//   API=http://localhost:3150 node auditoria-ui/corte.js
//
// Necesita lo mismo que medir.js: un servidor ya andando con la cooperativa
// de demostración y la flota reportando. El corte es del navegador, no de una
// red celular: los tiempos en un teléfono real pueden ser otros.
'use strict';
const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');
const { chromium } = require(RAIZ + '/pruebas/node_modules/playwright-core');
const interceptarHttps = require(RAIZ + '/pruebas/cdn.js');
const D = require(RAIZ + '/manual/demo.js');
const RUTAS = require(RAIZ + '/manual/rutas-demo.json');
const API = process.env.API || 'http://localhost:3150';
const OUT = path.join(__dirname, 'medidas', 'corte'); fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const c = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true,
    locale: 'es-PE', timezoneId: 'America/Lima', permissions: ['geolocation'] });
  await interceptarHttps(c);
  let k = 40;
  const mover = async () => { k = (k + 1) % RUTAS['18A'].ida.length; const q = RUTAS['18A'].ida[k]; await c.setGeolocation({ latitude: q[0] + (Math.random() - .5) * 6e-5, longitude: q[1] + (Math.random() - .5) * 6e-5, accuracy: 8 }).catch(() => {}); };
  await mover(); const t = setInterval(mover, 2500);
  const p = await c.newPage();
  await p.goto(API + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  await p.locator('input').nth(0).fill('ch-rufino'); await p.locator('input').nth(1).fill(D.CLAVE_CHOFER);
  await p.click('button:has-text("INGRESAR")'); await p.waitForTimeout(3000);
  await p.click('button:has-text("SALIR A RUTA")'); await p.waitForTimeout(6000);
  for (let i = 0; i < 25; i++) { await p.waitForTimeout(1500); if (!(await p.evaluate(() => document.body.innerText.includes('YENDO A LA RUTA')))) break; }
  await p.waitForTimeout(3000);
  const v = p.locator('button:has-text("DESPACHO VIO TU SOS")'); if (await v.count()) { await v.first().click().catch(() => {}); await p.waitForTimeout(600); }
  const leer = () => p.evaluate(() => {
    const txt = document.body.innerText;
    const cab = (txt.match(/EN VIVO[^\n]*|SIMULADO|SIN CONEXIÓN/) || ['?'])[0];
    const digs = [...document.querySelectorAll('div')].filter(d => getComputedStyle(d).fontSize === '118px' && d.children.length && d.children[0].tagName === 'SPAN').map(d => d.innerText.replace(/\s/g, ''));
    const ins = (txt.match(/(Mantené|Apurá|Aflojá|Sos la única|Sin brecha|YENDO)[^\n]*/) || ['?'])[0];
    return { cab, heroe: digs[0] || '—', ins };
  });
  console.log('con señal      ', JSON.stringify(await leer()));
  await p.screenshot({ path: path.join(OUT, '1-con-senal.png') });
  await c.setOffline(true);
  // y se cortan también los sockets vivos, como cuando el celular pierde la celda
  const cdp = await c.newCDPSession(p);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const t0 = Date.now();
  for (const s of [5, 15, 30, 60, 90]) {
    await p.waitForTimeout(s * 1000 - (Date.now() - t0));
    console.log(`sin señal ${String(s).padStart(2)} s `, JSON.stringify(await leer()));
    if (s === 30 || s === 90) await p.screenshot({ path: path.join(OUT, `2-sin-senal-${s}s.png`) });
  }
  // el chat, sin señal
  await p.click('button[aria-label="Chat"]').catch(() => {}); await p.waitForTimeout(1200);
  const campo = p.locator('input[placeholder^="Mensaje"], textarea[placeholder^="Mensaje"]').first();
  if (await campo.count()) {
    await campo.fill('Estoy llegando al paradero'); await campo.press('Enter'); await p.waitForTimeout(1200);
    console.log('chat sin señal → campo:', JSON.stringify(await campo.inputValue()), '· burbuja:', await p.evaluate(() => (document.body.innerText.match(/Tú[^\n]*/g) || []).slice(-1)[0]));
    await p.screenshot({ path: path.join(OUT, '3-chat-sin-senal.png') });
  }
  clearInterval(t); await b.close();
})().catch(e => { console.error('SE CAYÓ:', e.stack || e.message); process.exit(1); });
