#!/usr/bin/env node
// Las pantallas de AJUSTES de Android que el manual necesita para configurar
// el celular del chofer: el permiso de ubicación, las notificaciones, la
// batería, la hora automática y la instalación de la APK.
//
// Son ILUSTRACIONES, no capturas: este repositorio no tiene un teléfono ni un
// emulador de Android a mano (el contenedor donde se arma el manual no los
// puede correr). Están dibujadas en HTML con el aspecto de Android 14 y los
// textos de Android en español; en otras marcas (Samsung, Xiaomi, Motorola)
// el camino y los nombres cambian un poco, y el manual lo dice. Si alguien
// saca las capturas de verdad desde un teléfono, van a manual/img/ con el
// mismo nombre y reemplazan a estas.
//
//   node manual/ilustraciones-android.js        # escribe manual/img/a*.jpg
'use strict';
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const { chromium } = require(RAIZ + '/pruebas/node_modules/playwright-core');
const IMG = process.env.IMG_DIR || path.join(__dirname, 'img');

const APP = 'Control de ruta';
const ICONO_APP = `<span class="ico-app"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.2"><circle cx="12" cy="12" r="7"/><path d="M12 8v4l3 2"/></svg></span>`;

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 360px; height: 760px; font-family: Roboto, "Noto Sans", system-ui, sans-serif; color: #1B1B1F; background: #F8F9FF; overflow: hidden; position: relative; }
  .barra { height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; font-size: 13px; color: #1B1B1F; }
  .barra .der { display: flex; gap: 6px; align-items: center; }
  .barra i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; background: #44474E; }
  .barra i.bat { width: 20px; }
  .tope { padding: 8px 8px 0; height: 56px; display: flex; align-items: center; gap: 4px; }
  .tope .atras { width: 48px; height: 48px; display: grid; place-items: center; font-size: 22px; color: #44474E; }
  h1 { font-size: 30px; font-weight: 400; padding: 18px 24px 22px; line-height: 1.2; }
  .sub { font-size: 14px; color: #44474E; padding: 0 24px 16px; line-height: 1.45; }
  .cab-app { display: flex; align-items: center; gap: 14px; padding: 4px 24px 18px; font-size: 16px; }
  .ico-app { width: 40px; height: 40px; border-radius: 12px; background: #1668C4; display: grid; place-items: center; flex-shrink: 0; }
  .grupo { margin: 0 16px 14px; background: #FFFFFF; border-radius: 24px; overflow: hidden; }
  .titulo-grupo { font-size: 14px; color: #0B57D0; font-weight: 500; padding: 16px 24px 8px; }
  .fila { display: flex; align-items: center; gap: 16px; padding: 16px 20px; min-height: 64px; position: relative; }
  .fila + .fila { border-top: 1px solid #F0F0F5; }
  .fila .txt { flex: 1; }
  .fila .t { font-size: 16px; }
  .fila .d { font-size: 14px; color: #44474E; margin-top: 2px; line-height: 1.35; }
  .radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #44474E; flex-shrink: 0; position: relative; }
  .radio.si { border-color: #0B57D0; }
  .radio.si::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: #0B57D0; }
  .interruptor { width: 52px; height: 32px; border-radius: 16px; background: #E1E2EC; border: 2px solid #74777F; flex-shrink: 0; position: relative; }
  .interruptor::after { content: ""; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #74777F; top: 6px; left: 6px; }
  .interruptor.si { background: #0B57D0; border-color: #0B57D0; }
  .interruptor.si::after { width: 24px; height: 24px; top: 2px; left: 22px; background: #fff; }
  /* Lo que hay que tocar, marcado: un recuadro naranja, como un dedo en la foto */
  .tocar { outline: 3px solid #F28C00; outline-offset: -3px; border-radius: 16px; background: #FFF4E5; }
  .fila.tocar .txt { padding-right: 52px; }
  .flecha { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 12px; font-weight: 700; color: #B35F00; background: #FFE2B8; padding: 3px 8px; border-radius: 10px; }
  .velo { position: absolute; inset: 0; background: rgba(0,0,0,.42); }
  .fondo-app { position: absolute; inset: 28px 0 0; background: #F7FAFD; padding: 24px; }
  .fondo-app .x { height: 14px; border-radius: 7px; background: #DCE6F1; margin-bottom: 14px; }
  .dialogo { position: absolute; left: 24px; right: 24px; top: 50%; transform: translateY(-50%); background: #F1F3FC; border-radius: 28px; padding: 24px 22px 18px; text-align: center; }
  .dialogo .ico { font-size: 26px; color: #0B57D0; margin-bottom: 14px; }
  .dialogo h2 { font-size: 21px; font-weight: 400; line-height: 1.3; margin-bottom: 18px; }
  .dialogo h2 b { font-weight: 600; }
  .opciones-prec { display: flex; justify-content: space-around; margin-bottom: 16px; font-size: 14px; }
  .opciones-prec div { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .opciones-prec .c { width: 96px; height: 96px; border-radius: 50%; background: #DCE6F8; border: 3px solid transparent; }
  .opciones-prec .c.si { border-color: #0B57D0; }
  .boton { display: block; width: 100%; padding: 13px; margin-top: 8px; border-radius: 22px; background: #DDE3F4; color: #0B57D0; font-size: 15px; font-weight: 500; }
  .boton.tocar { background: #FFF4E5; color: #8A4A00; }
  .nota { position: absolute; left: 16px; right: 16px; bottom: 16px; font-size: 12px; color: #44474E; text-align: center; }
`;

const barra = `<div class="barra"><span>9:41</span><span class="der"><i></i><i></i><i class="bat"></i></span></div>`;
const tope = `<div class="tope"><span class="atras">←</span></div>`;
const pagina = (cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${cuerpo}</body></html>`;
const fondoApp = `<div class="fondo-app"><div class="x" style="width:60%"></div><div class="x" style="width:90%;height:60px"></div><div class="x" style="width:40%"></div><div class="x" style="width:80%;height:120px"></div></div>`;

const PANTALLAS = {
  // 1 · Al abrir la app por primera vez
  'a01-ubicacion': pagina(`${barra}${fondoApp}<div class="velo"></div>
    <div class="dialogo">
      <div class="ico">◎</div>
      <h2>¿Permitir que <b>${APP}</b> acceda a la ubicación de este dispositivo?</h2>
      <div class="opciones-prec"><div><span class="c si"></span>Precisa</div><div><span class="c"></span>Aproximada</div></div>
      <span class="boton tocar">Mientras la app está en uso</span>
      <span class="boton">Solo esta vez</span>
      <span class="boton">No permitir</span>
    </div>`),
  // 2 · Después la app lleva a los ajustes: hay que elegir «todo el tiempo»
  'a02-ubicacion-siempre': pagina(`${barra}${tope}<h1>Permiso de ubicación</h1>
    <div class="cab-app">${ICONO_APP}${APP}</div>
    <div class="grupo"><div class="titulo-grupo">Acceso a la ubicación para esta app</div>
      <div class="fila tocar"><span class="radio si"></span><div class="txt"><div class="t">Permitir todo el tiempo</div></div><span class="flecha">ESTA</span></div>
      <div class="fila"><span class="radio"></span><div class="txt"><div class="t">Permitir solo mientras se usa la app</div></div></div>
      <div class="fila"><span class="radio"></span><div class="txt"><div class="t">Preguntar siempre</div></div></div>
      <div class="fila"><span class="radio"></span><div class="txt"><div class="t">No permitir</div></div></div>
    </div>
    <div class="grupo"><div class="fila"><div class="txt"><div class="t">Usar ubicación precisa</div></div><span class="interruptor si"></span></div></div>`),
  // 3 · Las notificaciones: la brecha en la barra y el aviso del GPS
  'a03-notificaciones': pagina(`${barra}${fondoApp}<div class="velo"></div>
    <div class="dialogo">
      <div class="ico">🔔</div>
      <h2>¿Permitir que <b>${APP}</b> te envíe notificaciones?</h2>
      <span class="boton tocar">Permitir</span>
      <span class="boton">No permitir</span>
    </div>`),
  // 4 · La batería: sin esto Android corta la app con la pantalla apagada
  'a04-bateria': pagina(`${barra}${tope}<h1>Uso de batería de la app</h1>
    <div class="cab-app">${ICONO_APP}${APP}</div>
    <div class="grupo">
      <div class="fila tocar"><span class="radio si"></span><div class="txt"><div class="t">Sin restricciones</div><div class="d">Permite usar la batería en segundo plano sin restricciones</div></div><span class="flecha">ESTA</span></div>
      <div class="fila"><span class="radio"></span><div class="txt"><div class="t">Optimizado</div><div class="d">Optimiza según tu uso</div></div></div>
      <div class="fila"><span class="radio"></span><div class="txt"><div class="t">Restringido</div><div class="d">Limita el uso de batería en segundo plano</div></div></div>
    </div>
    <p class="nota">Ajustes → Apps → ${APP} → Batería</p>`),
  // 5 · La hora automática: con el reloj corrido el servidor no puede medir
  'a05-hora': pagina(`${barra}${tope}<h1>Fecha y hora</h1>
    <div class="grupo">
      <div class="fila tocar"><div class="txt"><div class="t">Establecer la hora automáticamente</div><div class="d">Usar la hora que proporciona la red</div></div><span class="interruptor si"></span></div>
      <div class="fila"><div class="txt"><div class="t">Establecer zona horaria automáticamente</div><div class="d">GMT-05:00 hora de Perú</div></div><span class="interruptor si"></span></div>
      <div class="fila"><div class="txt"><div class="t">Usar formato de 24 horas</div></div><span class="interruptor si"></span></div>
    </div>
    <p class="nota">Ajustes → Sistema → Fecha y hora</p>`),
  // 6 · Instalar la APK que manda la cooperativa (no viene de Google Play)
  'a06-instalar-apk': pagina(`${barra}${tope}<h1>Instalar apps desconocidas</h1>
    <div class="cab-app"><span class="ico-app" style="background:#5F6368"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2"><path d="M4 7h16v12H4zM8 7V5h8v2"/></svg></span>Archivos</div>
    <div class="grupo">
      <div class="fila tocar"><div class="txt"><div class="t">Permitir desde esta fuente</div></div><span class="interruptor si"></span></div>
    </div>
    <p class="sub">Tu teléfono y tus datos personales son más vulnerables a ataques de apps desconocidas. Si instalas apps de esta fuente, aceptas que eres responsable de los daños que puedan producirse.</p>
    <p class="nota">Aparece la primera vez que se abre la APK. Después se puede volver a apagar.</p>`),
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 });
  for (const [nombre, html] of Object.entries(PANTALLAS)) {
    await p.setContent(html);
    await p.screenshot({ path: path.join(IMG, nombre + '.jpg'), type: 'jpeg', quality: 82 });
    console.log('·', nombre);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
