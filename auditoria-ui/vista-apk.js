#!/usr/bin/env node
// Una vista de la APK armada con sus estilos REALES, para revisar colores y
// tamaños sin un teléfono. No es la app: no corre React Native. Saca
// `crearEstilos()` de app/App.js y las paletas de app/tema.js, traduce cada
// estilo a CSS y arma, con esos estilos, la estructura de cuatro pantallas
// (ingreso, ruta, ruta sin señal, chat) en el tema de día y en el de noche.
//
//   node auditoria-ui/vista-apk.js            # escribe auditoria-ui/medidas/vista-apk.html
//
// Lo que no muestra: márgenes del sistema, la fuente real del teléfono
// (usa la sans del navegador), el mapa, las animaciones. Lo que sí: que cada
// texto vaya en su color sobre su fondo y a su tamaño, en las dos paletas.
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const { PALETAS } = require(RAIZ + '/app/tema.js');

const app = fs.readFileSync(RAIZ + '/app/App.js', 'utf8');
const ini = app.indexOf('function crearEstilos(C) {');
if (ini < 0) throw new Error('no encuentro crearEstilos en app/App.js');
const crearEstilos = new Function('StyleSheet', app.slice(ini) + '\nreturn crearEstilos;')({ create: x => x });

// ── de un estilo de React Native a CSS ───────────────────────────────
const SIN_PX = new Set(['fontWeight', 'flex', 'opacity', 'zIndex', 'flexGrow', 'flexShrink']);
const kebab = k => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
function css(...estilos) {
  const e = Object.assign({}, ...estilos.flat().filter(Boolean));
  const out = [];
  const px = (k, v) => (typeof v === 'number' && !SIN_PX.has(k) ? v + 'px' : v);
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === null || /^shadow|^elevation|^transform/.test(k)) continue;
    if (k === 'paddingVertical') { out.push(`padding-top:${px(k, v)};padding-bottom:${px(k, v)}`); continue; }
    if (k === 'paddingHorizontal') { out.push(`padding-left:${px(k, v)};padding-right:${px(k, v)}`); continue; }
    if (k === 'marginVertical') { out.push(`margin-top:${px(k, v)};margin-bottom:${px(k, v)}`); continue; }
    if (k === 'marginHorizontal') { out.push(`margin-left:${px(k, v)};margin-right:${px(k, v)}`); continue; }
    if (/^border(Top|Bottom|Left|Right)?Width$/.test(k)) {
      out.push(`${kebab(k)}:${px(k, v)};${kebab(k).replace('-width', '-style')}:solid`); continue;
    }
    if (k === 'fontFamily' && v === 'monospace') { out.push('font-family:ui-monospace,Menlo,monospace'); continue; }
    if (k === 'textDecorationLine') { out.push(`text-decoration:${v}`); continue; }
    out.push(`${kebab(k)}:${px(k, v)}`);
  }
  return out.join(';');
}
const V = (estilo, hijos = '') => `<div style="display:flex;flex-direction:column;${css(estilo)}">${hijos}</div>`;
const F = (estilo, hijos = '') => `<div style="display:flex;flex-direction:row;${css(estilo)}">${hijos}</div>`;
const T = (estilo, texto) => `<div style="${css(estilo)}">${texto}</div>`;

function pantallas(nombre, C) {
  const s = crearEstilos(C);
  const color = { verde: C.verde, ambar: C.ambar, rojo: C.rojo, ninguno: C.tenue };
  const marco = (titulo, cuerpo) => `<figure><figcaption>${titulo}</figcaption>
    <div class="tel" style="background:${C.fondo}">${V([s.pantalla, { padding: 16, paddingTop: 34, height: '100%' }], cuerpo)}</div></figure>`;
  const barra = (activa) => F(s.barraAbajo,
    T(s.chipTema, nombre === 'dia' ? 'DÍA' : 'NOCHE') +
    ['MAPA', 'RUTA', 'CHAT'].map(t => F(s.tab, T([s.tabTexto, activa === t && { color: C.brillante }], t) +
      (t === 'CHAT' ? V(s.badge, T(s.badgeTexto, '2')) : ''))).join(''));
  const cabecera = (texto, viejo) => F(s.barra,
    `<div style="width:26px;height:26px;border-radius:6px;background:${C.marca}"></div>` +
    T([s.chip, { color: viejo ? C.ambarTexto : C.verdeTexto }], texto) + T(s.salir, 'Perfil') + T(s.salir, 'Salir'));
  const acciones = F(s.filaPresencia, '') +
    V(s.botonTrafico, T(s.botonPresenciaTexto, 'ESTOY EN TRÁFICO')) +
    F(s.filaPresencia,
      V([s.botonPresencia, { borderColor: C.ambar }], T([s.botonPresenciaTexto, { color: C.ambarTexto }], 'AUSENTE')) +
      V(s.botonPresencia, T(s.botonPresenciaTexto, 'SALIR DE RUTA'))) +
    `<div style="position:relative;${css(s.sosPista)}">${T([s.sosTexto, { left: 0, right: 0, textAlign: 'center' }], 'DESLIZA PARA SOS  →')}${V(s.sosBoton, T(s.sosBotonTexto, 'SOS'))}</div>`;

  const ingreso = marco('Ingreso',
    T(s.tituloChico, 'CONTROL DE RUTA') + T(s.subtitulo, 'Ingresa con el usuario que te dio tu cooperativa') +
    T(s.rotulo, 'Usuario') + T(s.campo, 'ch-rufino') +
    T(s.rotulo, 'Contraseña') + F(s.campoConBoton, T([s.campo, s.campoSinBorde, { flex: 1 }], '••••••••') + V(s.ojo, T(s.ojoTexto, 'VER'))) +
    V(s.boton, T(s.botonTexto, 'INGRESAR')) +
    V(s.emergenciaSinSesion, T(s.emergenciaSinSesionTexto, '¿EMERGENCIA? LLAMAR A LA CENTRAL · 051321456')) +
    T(s.pie, 'r14.ejemplo.pe · app 0.3.0 (6)'));

  const ruta = marco('Ruta',
    cabecera('● EN VIVO') +
    V(s.centro,
      F(s.filaRotulo, T([s.ladoEtiqueta, { color: color.ambar }], 'ATRÁS') + T(s.ladoUnidad, '−1 · M-02')) +
      T([s.digitos, { color: color.ambar }], '4:28') + T(s.instruccion, 'Apura un poco. Objetivo 6:00.') +
      V(s.divisor) +
      F(s.filaRotulo, T(s.ladoEtiquetaSec, 'ADELANTE') + T(s.ladoUnidad, '+1 · M-03')) +
      T([s.digitosSec, { color: color.verde }], '6:01')) +
    acciones + barra('RUTA'));

  const sinSenal = marco('Ruta sin señal (12 s y 61 s)',
    cabecera('○ SIN SEÑAL · 0:12', true) +
    V(s.centro,
      F(s.filaRotulo, T([s.ladoEtiqueta, { color: color.ninguno }], 'ATRÁS') + T(s.ladoUnidad, '−1 · M-02')) +
      T([s.digitos, { color: color.ninguno }], '4:28') + T(s.instruccion, 'Brecha de hace 0:12. Puede haber cambiado.') +
      V(s.divisor) +
      T(s.sinSenalTitulo, 'SIN SEÑAL') + T(s.sinSenalTexto, 'No veo a las otras combis desde hace 1:01. Ve con cuidado: siguen en ruta.')) +
    acciones + barra('RUTA'));

  const chat = marco('Chat',
    F(s.canales, ['GRUPO', 'COMBI', 'PERSONAL'].map((t, i) => F([s.canal, i === 0 && s.canalActivo], T([s.canalTexto, i === 0 && { color: C.sobreBrillante }], t))).join('')) +
    V({ flex: 1 },
      V(s.burbuja, T(s.burbujaQuien, 'ELMER · M-02') + T(s.burbujaTexto, 'Bloqueo en el óvalo, voy por Lampa')) +
      V([s.burbuja, s.burbujaDespacho], T(s.burbujaQuien, 'DESPACHO') + T(s.burbujaTexto, 'Rufo, espera 2 minutos en el mercado.')) +
      V([s.burbuja, s.burbujaSos], T(s.burbujaQuien, 'WILBER · M-04') + T(s.burbujaTexto, 'SOS — pide ayuda')) +
      V([s.burbuja, s.burbujaPropia], T(s.burbujaQuien, 'TÚ') + T(s.burbujaTexto, 'Copiado, salgo ya'))) +
    F(s.escribir, T([s.campoChat, { color: C.tenue }], 'Mensaje…') + V(s.enviar, T(s.enviarTexto, '➤'))) +
    barra('CHAT'));

  return `<h2>${nombre === 'dia' ? 'Día' : 'Noche'}</h2><div class="fila">${ingreso}${ruta}${sinSenal}${chat}</div>`;
}

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>APK — vista armada con sus estilos</title>
<style>
  body { margin: 0; padding: 20px; background: #6b7280; font-family: system-ui, sans-serif; }
  h1 { color: #fff; font-size: 20px; margin: 0 0 4px; } p { color: #e5e7eb; margin: 0 0 16px; font-size: 14px; }
  h2 { color: #fff; font-size: 16px; margin: 18px 0 8px; }
  .fila { display: flex; gap: 14px; flex-wrap: wrap; }
  figure { margin: 0; } figcaption { color: #fff; font-size: 12px; margin-bottom: 4px; }
  .tel { width: 360px; height: 740px; border-radius: 18px; overflow: hidden; box-sizing: border-box; }
  .tel * { box-sizing: border-box; }
</style></head><body>
<h1>La APK, armada con sus estilos reales</h1>
<p>Sale de crearEstilos() en app/App.js y de app/tema.js. No es la app: sin márgenes del sistema, sin el mapa, con la sans del navegador.</p>
${pantallas('dia', PALETAS.dia)}${pantallas('noche', PALETAS.noche)}
</body></html>`;

const salida = path.join(__dirname, 'medidas', 'vista-apk.html');
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, html);
console.log('escrita', path.relative(RAIZ, salida));
