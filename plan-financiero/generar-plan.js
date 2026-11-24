#!/usr/bin/env node
// Genera el Plan del Primer Año v. alfa en HTML y en PDF.
//
//   node plan-financiero/generar-plan.js
//
// Todos los números salen de modelo/modelo.js: si cambia un supuesto, se
// vuelve a correr este archivo y el documento se rehace entero.
const fs = require('fs');
const path = require('path');
const { simular, SUPUESTOS } = require('./modelo/modelo');

const AQUI = __dirname;
const BASE = simular();
const F = BASE.filas;
const R = BASE.resumen;
const S = SUPUESTOS;

// ── Formato de la casa: coma decimal, miles con espacio desde 5 cifras,
//    signo menos verdadero y espacio antes de %.
const NBSP = ' ';
function entero(n) {
  const r = Math.round(n);
  const s = String(Math.abs(r));
  const conEspacios = s.length >= 5 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : s;
  return (r < 0 ? '−' : '') + conEspacios;
}
const soles = n => 'S/' + NBSP + entero(n);
const milesDeSoles = n => 'S/' + NBSP + (Math.round(n / 100) / 10).toLocaleString('es-PE', { maximumFractionDigits: 1 }).replace('.', ',') + NBSP + 'mil';
const decimal = (n, d = 2) => n.toFixed(d).replace('.', ',');
const pct = n => entero(n * 100) + NBSP + '%';
const celda = n => { const r = Math.round(n); return `<td class="${r < 0 ? 'neg' : ''}">${r === 0 ? '' : entero(r)}</td>`; };

const MES_LARGO = { ene: 'enero', feb: 'febrero', mar: 'marzo', abr: 'abril', may: 'mayo', jun: 'junio', jul: 'julio', ago: 'agosto', sep: 'septiembre', oct: 'octubre', nov: 'noviembre', dic: 'diciembre' };
const mesLargo = m => m ? MES_LARGO[m.slice(0, 3)] + ' de 20' + m.slice(4) : 'fuera del período';

// ── Escenarios de sensibilidad
const ESCENARIOS = [
  ['Plan base', {}],
  ['Sin pausa: se pasa directo a Arequipa o Cusco', { pausaMeses: 0 }],
  ['Pausa de 2 meses en vez de 4', { pausaMeses: 2 }],
  ['Solo Juliaca y Puno, sin ciudad grande', { ciudadGrande: false }],
  ['Facturación a inicio de mes', { cobroAdelantado: true }],
  ['Gerson sigue vendiendo 4 rutas por mes', { duenoVendeHasta: 99 }],
  ['Todos traen la mitad de lo previsto', { rutasDueno: 2, rampaTiempoCompleto: [1, 2], rampaMedioTiempo: [0, 1] }],
  ['La ciudad grande cuesta S/ 3000 al mes', { costoCiudadGrande: 3000 }],
  ['Gerson no cobra sueldo en todo el período', { sueldoDueno: 0 }],
  ['Se cobra solo el 85 % de las unidades-día', { utilizacion: 0.85 }],
  ['Cada ruta nueva tiene un mes gratis', { mesGratisNuevas: true }],
  ['El servidor cuesta el doble de lo previsto', { colchonInfraestructura: 2.5 }],
  ['Precio de S/ 0,60 por unidad por día', { precio: 0.6 }],
  ['Precio de S/ 0,50 más IGV', { precioIncluyeIGV: false }],
].map(([nombre, cambios]) => ({ nombre, r: simular(cambios) }));
const esc = nombre => ESCENARIOS.find(e => e.nombre === nombre).r;

// ── Economía de una ruta
const ventaRutaMes = S.unidadesPorRuta * S.precio * 30 / (1 + S.igv);
const servidorPorRuta = (F[15].desglose['Infraestructura'] ? Object.values(F[15].desglose['Infraestructura']).reduce((a, b) => a + b, 0) : 0) / F[15].rutas;
const costoEntrada = S.comisionPorRuta * (1 + S.cargasSociales) + S.kitPorRuta / (1 + S.igv);

// ── Punto de equilibrio con el equipo completo y sin crecer
const agosto = F[8];
const infraAgosto = Object.values(agosto.desglose['Infraestructura']).reduce((a, b) => a + b, 0);
const ciudadAgosto = agosto.gastos['Ciudad grande'] || 0;
const fijoMensual = agosto.totalGastos - infraAgosto * (1 + S.imprevistos) - ciudadAgosto * (1 + S.imprevistos) + agosto.depreciacion;
const variablePorRuta = infraAgosto / agosto.rutas * (1 + S.imprevistos);
const equilibrio = [0.5, 0.6, 0.7, 0.8].map(p => {
  const neto = S.unidadesPorRuta * p * 30.4 / (1 + S.igv) * (1 - S.incobrable) - variablePorRuta;
  return { precio: p, rutas: Math.ceil(fijoMensual / neto) };
});

// ── Gráficos en SVG, con la misma escala para marcas y etiquetas
function graficoLineas(series, { alto = 220, maximo, paso, etiquetaFinal = true } = {}) {
  const W = 680, H = alto, iz = 52, de = 12, ar = 12, ab = 26;
  const n = F.length, x = i => iz + i * (W - iz - de) / (n - 1), y = v => ar + (1 - v / maximo) * (H - ar - ab);
  let g = '';
  for (let v = 0; v <= maximo; v += paso) g += `<line x1="${iz}" x2="${W - de}" y1="${y(v)}" y2="${y(v)}" class="rejilla"/><text x="${iz - 6}" y="${y(v) + 3.5}" class="eje" text-anchor="end">${v === 0 ? '0' : entero(v / 1000) + ' mil'}</text>`;
  F.forEach((f, i) => { if (i % 2 === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 8}" class="eje" text-anchor="middle">${f.mes}</text>`; });
  for (const s of series) {
    g += `<path d="${s.valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" class="linea" style="stroke:${s.color}"/>`;
    const u = s.valores[n - 1];
    g += `<circle cx="${x(n - 1)}" cy="${y(u)}" r="3.5" style="fill:${s.color}"/>`;
    if (etiquetaFinal) g += `<text x="${x(n - 1) - 6}" y="${y(u) + (s.abajo ? 15 : -8)}" class="dato" text-anchor="end">${s.nombre}: ${soles(u)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function graficoBarras(valores, { minimo, maximo, paso, formato = soles, rotulo = true, alto = 200 }) {
  const W = 680, H = alto, iz = 52, de = 12, ar = 12, ab = 26, n = valores.length, bw = (W - iz - de) / n;
  const y = v => ar + (maximo - v) / (maximo - minimo) * (H - ar - ab);
  let g = '';
  for (let v = maximo; v >= minimo; v -= paso) g += `<line x1="${iz}" x2="${W - de}" y1="${y(v)}" y2="${y(v)}" class="rejilla"/><text x="${iz - 6}" y="${y(v) + 3.5}" class="eje" text-anchor="end">${v === 0 ? '0' : (Math.abs(v) >= 1000 ? entero(v / 1000) + ' mil' : entero(v))}</text>`;
  g += `<line x1="${iz}" x2="${W - de}" y1="${y(0)}" y2="${y(0)}" class="cero"/>`;
  valores.forEach((v, i) => {
    const top = v < 0 ? y(0) : y(v), h = Math.max(1, Math.abs(y(v) - y(0)));
    g += `<rect x="${iz + i * bw + 2}" y="${top}" width="${bw - 4}" height="${h}" rx="2" class="${v < 0 ? 'barra-neg' : 'barra'}"/>`;
    if (rotulo) g += `<text x="${iz + i * bw + bw / 2}" y="${v < 0 ? top + h + 11 : top - 4}" class="valor" text-anchor="middle">${formato(v)}</text>`;
    g += `<text x="${iz + i * bw + bw / 2}" y="${H - 8}" class="eje" text-anchor="middle">${F[i].mes.slice(0, 3)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

// ── Tablas mensuales con su desglose
const GRUPOS = ['Sueldos y comisiones', 'Cargas sociales', 'Infraestructura', 'Alquiler de oficina', 'Servicios de oficina', 'Planes de datos', 'Movilidad y viajes', 'Ciudad grande', 'Marketing y rutas nuevas', 'Contador externo', 'IA y software', 'Equipos menores', 'Trámites y legal', 'Útiles y bancos', 'Imprevistos'];
function tablaMensual(desde, hasta, conTotales, tipo) {
  const filas = F.slice(desde, hasta);
  const tot = (f, a) => F.filter(x => x.anio === a).reduce((s, x) => s + f(x), 0);
  const cab = `<tr><th>Concepto</th>${filas.map(f => `<th>${f.mes}</th>`).join('')}${conTotales ? '<th class="t">2026</th><th class="t">2027</th><th class="t">2028 (T1)</th>' : ''}</tr>`;
  const linea = (nombre, fn, clase = '') => `<tr class="${clase}"><th>${nombre}</th>${filas.map(f => celda(fn(f))).join('')}${conTotales ? [2026, 2027, 2028].map(a => celda(tot(fn, a))).join('') : ''}</tr>`;
  let b = '';
  if (tipo === 'resultados') {
    b += `<tr class="dato-fila"><th>Rutas activas</th>${filas.map(f => `<td>${f.rutas}</td>`).join('')}${conTotales ? '<td></td><td></td><td></td>' : ''}</tr>`;
    b += linea('Ventas netas (sin IGV)', f => f.venta, 'fuerte');
    b += linea('Rutas que pagan el mes completo', f => f.ventaCompletas, 'hijo');
    b += linea('Rutas nuevas, medio mes', f => f.ventaMedias, 'hijo');
    b += linea('(−) Cobranza dudosa', f => -f.incobrable);
    b += linea('Ingreso neto', f => f.venta - f.incobrable, 'sub');
    for (const g of GRUPOS) {
      const detalles = [...new Set(F.flatMap(f => Object.keys(f.desglose[g] || {})))];
      b += linea('(−) ' + g, f => -(f.gastos[g] || 0), detalles.length > 1 ? 'grupo' : '');
      if (detalles.length > 1) for (const d of detalles) b += linea(d, f => -((f.desglose[g] || {})[d] || 0), 'hijo');
    }
    b += linea('Total de gastos', f => -f.totalGastos, 'sub');
    b += linea('EBITDA', f => f.ebitda, 'fuerte');
    b += linea('(−) Depreciación de laptops', f => -f.depreciacion);
    b += linea('Utilidad operativa', f => f.utilOper, 'sub');
    b += linea('(−) Impuesto a la renta', f => -f.renta);
    b += linea('Utilidad neta', f => f.utilNeta, 'total');
  } else {
    b += linea('Cobranza (con IGV)', f => f.cobros, 'fuerte');
    b += linea('Facturas del mes anterior (95 %)', f => f.cobro1, 'hijo');
    b += linea('Saldo de hace dos meses (3 %)', f => f.cobro2, 'hijo');
    b += linea('(−) Pagos de gastos', f => -f.pagosOperativos, 'grupo');
    b += linea('Gastos del mes, sin IGV', f => -f.totalGastos, 'hijo');
    b += linea('IGV de las compras', f => -f.igvCompras, 'hijo');
    b += linea('(−) IGV pagado a SUNAT', f => -f.pagaIGV);
    b += linea('(−) Adelanto de renta (1 %)', f => -f.pagaAdelanto);
    b += linea('(−) Saldo de la renta de 2027', f => -f.pagaRentaAnual);
    b += linea('Flujo operativo', f => f.flujoOperativo, 'sub');
    b += linea('(−) Compra de laptops', f => -f.compraLaptops);
    b += linea('(−) Garantía del alquiler', f => -f.garantia);
    b += linea('Flujo del mes', f => f.flujo, 'fuerte');
    b += `<tr class="total"><th>Caja acumulada, sin aporte</th>${filas.map(f => celda(f.caja)).join('')}${conTotales ? '<td></td><td></td><td></td>' : ''}</tr>`;
    b += `<tr class="dato-fila"><th>Caja con aporte de S/ 50 000</th>${filas.map(f => celda(f.caja + 50000)).join('')}${conTotales ? '<td></td><td></td><td></td>' : ''}</tr>`;
  }
  return `<table class="mensual"><thead>${cab}</thead><tbody>${b}</tbody></table>`;
}

// ── Quién trae las rutas
function tablaRutas() {
  const p = [['Rutas de prueba', f => f.i === 0 ? f.nuevas : 0], ['Gerson', f => f.aportes.tu], ['Vendedor A', f => f.aportes.a], ['Vendedor B', f => f.aportes.b], ['Vendedor D', f => f.aportes.d]];
  let b = p.map(([n, fn]) => `<tr><th>${n}</th>${F.map(f => `<td>${fn(f) || ''}</td>`).join('')}</tr>`).join('');
  b += `<tr class="sub"><th>Rutas nuevas</th>${F.map(f => `<td>${f.nuevas || (f.enPausa ? 'pausa' : '')}</td>`).join('')}</tr>`;
  b += `<tr class="fuerte"><th>Rutas activas</th>${F.map(f => `<td>${f.rutas}</td>`).join('')}</tr>`;
  b += `<tr class="dato-fila"><th>Unidades</th>${F.map(f => `<td>${entero(f.unidades)}</td>`).join('')}</tr>`;
  b += `<tr class="dato-fila"><th>Ciudades</th>${F.map(f => `<td>${f.ciudades}</td>`).join('')}</tr>`;
  return `<table class="mensual"><thead><tr><th>Quién</th>${F.map(f => `<th>${f.mes}</th>`).join('')}</tr></thead><tbody>${b}</tbody></table>`;
}
function tablaEquipo() {
  const jor = v => v ? String(v).replace(/^0\.5$/, '½').replace('.5', ' ½') : '';
  const p = [['Vendedores, en jornadas', f => jor(f.equipo.vendedores)], ['Medio tiempo de oficina', f => jor(f.equipo.oficina)], ['Gerson en planilla', f => f.equipo.dueno ? '1' : '']];
  const b = p.map(([n, fn]) => `<tr><th>${n}</th>${F.map(f => `<td>${fn(f)}</td>`).join('')}</tr>`).join('');
  return `<table class="mensual"><thead><tr><th>Puesto</th>${F.map(f => `<th>${f.mes}</th>`).join('')}</tr></thead><tbody>${b}</tbody></table>`;
}

const tablaEscenarios = () => `<table class="simple"><thead><tr><th>Escenario</th><th>Gana todos los meses desde</th><th>Utilidad operativa 2027</th><th>Caja mínima</th><th>Caja a mar-28</th><th>Rutas a mar-28</th></tr></thead><tbody>${ESCENARIOS.map(e => `<tr${e.nombre === 'Plan base' ? ' class="fuerte"' : ''}><th>${e.nombre}</th><td>${e.r.resumen.ganaDesde || 'no llega'}</td>${celda(e.r.resumen.utilidad2027)}${celda(e.r.resumen.cajaMinima)}${celda(e.r.resumen.cajaFinal)}<td>${e.r.filas[15].rutas}</td></tr>`).join('')}</tbody></table>`;

// ── Datos para el texto
const d = {
  cajaMin: soles(R.cajaMinima), mesCajaMin: mesLargo(R.mesCajaMinima), cajaFinal: soles(R.cajaFinal),
  util27: soles(R.utilidad2027), ventas27: soles(R.ventas2027), util26: soles(R.utilidad2026),
  ganaDesde: mesLargo(R.ganaDesde), cajaPos: mesLargo(R.cajaPositivaDesde), lleno: mesLargo(R.llenoLocal),
  renta27: soles(R.renta2027), adelantos: soles(R.adelantos2027), saldoRenta: soles(R.saldoRenta2027),
  utilDic: soles(F[12].utilOper), utilMar28: soles(F[15].utilOper), utilNov: soles(F[11].utilOper),
  marzo27: soles(F[3].utilOper), abril27: soles(F[4].utilOper), hastaMarzo: soles(F[3].caja),
  porCobrar: soles(R.porCobrar), igvPorPagar: soles(R.igvPorPagar),
};
const e = n => esc(n).resumen;

const fecha = '24 de noviembre de 2026';

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>COOP-R14 · Plan del Primer Año v. alfa</title>
<style>
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
@page ancha { size: A4 landscape; margin: 12mm 10mm 12mm 10mm; }
@page alta { size: A4; margin: 10mm 10mm 12mm 10mm; }
:root { --tinta:#17211e; --tinta2:#45524d; --suave:#75817c; --linea:#d9dfdb; --fondo:#f3f6f4; --acento:#0f6b5c; --acento-suave:#e2efeb; --neg:#a8291f; --pos:#1d7a3a; --s1:#2a78d6; --s2:#eb6834; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; font: 10pt/1.55 "Inter", "DejaVu Sans", sans-serif; color: var(--tinta); font-variant-numeric: tabular-nums; }
h1,h2,h3 { font-family: "Inter Display", "Inter", sans-serif; line-height:1.2; margin:0; color: var(--tinta); text-wrap: balance; }
h2 { font-size: 17pt; font-weight: 700; margin: 0 0 10pt; padding-top: 4pt; break-after: avoid; }
h3 { font-size: 11.5pt; font-weight: 700; margin: 14pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; color: var(--tinta2); orphans: 3; widows: 3; }
p strong, li strong { color: var(--tinta); }
ul, ol { margin: 0 0 8pt; padding-left: 15pt; color: var(--tinta2); }
li { margin: 0 0 4pt; }
.seccion { break-before: page; }
.portada { height: 255mm; display:flex; flex-direction:column; justify-content: space-between; }
.portada .marca { font: 600 9pt "Inter"; letter-spacing: .12em; text-transform: uppercase; color: var(--acento); }
.portada h1 { font-size: 34pt; font-weight: 800; letter-spacing: -.01em; margin: 10pt 0 8pt; }
.portada .sub { font-size: 13pt; color: var(--tinta2); max-width: 130mm; }
.portada .ficha { border-top: 1.5pt solid var(--tinta); padding-top: 8pt; display:grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; font-size: 9pt; color: var(--tinta2); }
.portada .ficha b { display:block; color: var(--tinta); font-size: 9.5pt; }
.cifras { display:grid; grid-template-columns: repeat(3, 1fr); gap: 7pt; margin: 6pt 0 12pt; }
.cifra { border: 1px solid var(--linea); border-radius: 5pt; padding: 7pt 9pt; break-inside: avoid; }
.cifra .v { font: 700 15pt "Inter Display", "Inter"; color: var(--tinta); }
.cifra .v.neg { color: var(--neg); } .cifra .v.pos { color: var(--pos); }
.cifra .l { font-size: 8pt; color: var(--suave); line-height: 1.35; margin-top: 2pt; }
.nota { background: var(--fondo); border-left: 3pt solid var(--acento); padding: 8pt 11pt; margin: 8pt 0 10pt; break-inside: avoid; }
.nota p:last-child { margin-bottom: 0; }
.aviso { background: #fbf3e2; border-left: 3pt solid #b7791f; padding: 8pt 11pt; margin: 8pt 0 10pt; break-inside: avoid; }
.aviso p { color: #5c4210; } .aviso p:last-child { margin-bottom:0; }
table { border-collapse: collapse; width: 100%; }
table.simple { font-size: 8.8pt; margin: 4pt 0 10pt; break-inside: auto; }
table.simple th, table.simple td { border-bottom: 1px solid var(--linea); padding: 4pt 5pt; vertical-align: top; text-align: left; }
table.simple thead th { font-size: 7.8pt; color: var(--suave); font-weight: 600; text-transform: none; }
table.simple td { color: var(--tinta2); }
table.simple td.neg { color: var(--neg); }
table.simple tbody th { font-weight: 600; color: var(--tinta); width: 32%; }
table.simple tr { break-inside: avoid; }
table.simple.num td { text-align: right; }
table.mensual { font-size: 6.9pt; margin: 2pt 0 8pt; }
.resultados h2 { font-size: 14pt; margin-bottom: 4pt; } .resultados p { font-size: 8.5pt; margin-bottom: 4pt; }
.resultados { page: alta; } .resultados table.mensual { font-size: 6.5pt; line-height: 1.3; } .resultados table.mensual th, .resultados table.mensual td { padding: 1.1pt 2.4pt; }
.continua { margin-top: 18pt; }
table.mensual th, table.mensual td { padding: 2.2pt 3pt; border-bottom: 0.6pt solid var(--linea); white-space: nowrap; }
table.mensual thead th { color: var(--suave); font-weight: 600; text-align: right; border-bottom: 1pt solid var(--tinta); }
table.mensual thead th:first-child { text-align: left; }
table.mensual tbody th { text-align: left; font-weight: 500; color: var(--tinta); }
table.mensual td { text-align: right; color: var(--tinta2); }
table.mensual td.neg { color: var(--neg); }
table.mensual th.t, table.mensual tr td:nth-last-child(-n+3) { }
tr.fuerte th, tr.fuerte td { font-weight: 700; color: var(--tinta); }
tr.sub th, tr.sub td { font-weight: 700; color: var(--tinta); background: var(--acento-suave); }
tr.grupo th, tr.grupo td { font-weight: 600; color: var(--tinta); }
tr.hijo th { padding-left: 10pt; font-weight: 400; color: var(--suave); }
tr.hijo td { color: var(--suave); }
tr.hijo td.neg { color: #c4847c; }
.resultados tr.hijo th, table.mensual tr.hijo th { padding-left: 11pt; }
tr.total th, tr.total td { font-weight: 700; color: var(--tinta); border-top: 1pt solid var(--tinta); }
tr.dato-fila th, tr.dato-fila td { color: var(--suave); font-weight: 400; }
.ancha { page: ancha; break-before: page; }
.ancha h2 { font-size: 14pt; margin-bottom: 4pt; }
.ancha p { font-size: 8.5pt; margin-bottom: 4pt; }
figure { margin: 6pt 0 12pt; break-inside: avoid; }
figure svg { width: 100%; height: auto; display:block; }
figcaption { font-size: 8pt; color: var(--suave); margin-top: 3pt; }
.leyenda { font-size: 8pt; color: var(--tinta2); margin-bottom: 2pt; } .leyenda i { display:inline-block; width: 12pt; height: 2.5pt; vertical-align: middle; margin: 0 4pt 0 10pt; border-radius: 2pt; }
.rejilla { stroke: #e4e8e6; stroke-width: 0.8; } .cero { stroke: #75817c; stroke-width: 1; }
.eje { fill: #75817c; font: 8.5px "Inter"; } .dato { fill: #17211e; font: 600 9.5px "Inter"; } .valor { fill:#45524d; font: 7px "Inter"; }
.linea { fill: none; stroke-width: 2; stroke-linejoin: round; }
.barra { fill: #2f8f6b; } .barra-neg { fill: #c4625a; }
.rol { border: 1px solid var(--linea); border-radius: 5pt; padding: 9pt 11pt 4pt; margin: 0 0 9pt; break-inside: avoid; }
.rol h3 { margin: 0 0 2pt; }
.rol .ficha-rol { font-size: 8.5pt; color: var(--suave); margin-bottom: 5pt; }
.rol .cols { display:grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
.rol h4 { font: 600 8pt "Inter"; text-transform: uppercase; letter-spacing: .06em; color: var(--acento); margin: 0 0 3pt; }
.rol ul { font-size: 9pt; }
.pie { font-size: 8pt; color: var(--suave); }
</style></head><body>

<section class="portada">
  <div>
    <div class="marca">COOP-R14 · Control de flota para empresas de transporte</div>
    <h1>Plan del Primer Año<br>versión alfa</h1>
    <p class="sub">Plan financiero y de equipo de diciembre de 2026 a marzo de 2028, con los estados de resultados de cada mes, el flujo de caja, las funciones de cada persona y el análisis de sensibilidad.</p>
  </div>
  <div>
    <div class="aviso"><p><strong>Este es un plan teórico:</strong> cada número sale de un supuesto que todavía no se probó en la calle, así que el plan se corrige cada mes con lo que pase en el mercado. Para eso existe el simulador que acompaña a este documento.</p></div>
    <div class="ficha">
      <div><b>Fecha</b>${fecha}</div>
      <div><b>Empresa</b>EIRL en el Régimen MYPE Tributario</div>
      <div><b>Mercado inicial</b>Juliaca y Puno; después, Arequipa o Cusco</div>
    </div>
  </div>
</section>

<section class="seccion">
<h2>1. Resumen ejecutivo</h2>
<p>COOP-R14 cobra S/ 0,50 por unidad por día a las empresas de transporte, con el IGV incluido. Con ${S.unidadesPorRuta} unidades por ruta, cada ruta factura unos S/ 600 al mes y deja ${soles(ventaRutaMes)} sin IGV, mientras que el servidor que la atiende cuesta unos ${soles(servidorPorRuta)}. Como el costo de atender una ruta más es casi nulo, la utilidad crece con cada ruta que se firma y el límite real del negocio es la velocidad de venta.</p>
<div class="cifras">
  <div class="cifra"><div class="v neg">${d.cajaMin}</div><div class="l">Punto más bajo de la caja, en ${d.mesCajaMin}. Es el capital mínimo que se necesita.</div></div>
  <div class="cifra"><div class="v pos">${d.util27}</div><div class="l">Utilidad operativa de 2027, sobre ${d.ventas27} de ventas sin IGV.</div></div>
  <div class="cifra"><div class="v pos">${d.cajaFinal}</div><div class="l">Caja acumulada a marzo de 2028, ya pagada la renta de 2027.</div></div>
  <div class="cifra"><div class="v">${R.ganaDesde}</div><div class="l">Desde ${d.ganaDesde}, el negocio gana todos los meses.</div></div>
  <div class="cifra"><div class="v">60 → 100</div><div class="l">Rutas en julio de 2027 y en marzo de 2028, con una pausa de cuatro meses entre ambas.</div></div>
  <div class="cifra"><div class="v">S/ 50 000</div><div class="l">Capital recomendado: cubre el punto más bajo y deja un colchón de unos S/ 9700.</div></div>
</div>
<h3>Cómo crece</h3>
<p>La venta tiene un ritmo medido: una persona a tiempo completo firma una ruta por semana, porque cada ruta exige conversar con la empresa y conseguir que sus choferes instalen la app. Gerson vende en enero y febrero, y desde marzo un vendedor a tiempo completo toma su lugar para que él se dedique al sistema. Con tres vendedores, el equipo firma 10 rutas por mes desde abril y llena Juliaca y Puno, unas 60 rutas en total, en ${d.lleno}.</p>
<p>De agosto a noviembre de 2027 no se firman rutas nuevas, porque esos cuatro meses se usan para preparar la entrada a Arequipa o Cusco. Desde diciembre se vuelven a firmar 10 rutas por mes en la ciudad grande, y el plan cierra marzo de 2028 con 100 rutas y ${entero(F[15].unidades)} unidades.</p>
<h3>Qué tiene que salir bien</h3>
<ul>
<li><strong>La productividad de venta.</strong> Si cada vendedor trae la mitad de lo previsto, 2027 deja ${milesDeSoles(e('Todos traen la mitad de lo previsto').utilidad2027)} en vez de ${milesDeSoles(R.utilidad2027)}, y Juliaca y Puno recién se llenan en enero de 2028.</li>
<li><strong>El tamaño del mercado.</strong> El plan supone que casi todas las rutas de Juliaca y Puno aceptan el sistema; con 60 rutas se llega al tope de las dos ciudades.</li>
<li><strong>El sistema a cargo de una sola persona.</strong> Desde marzo, Gerson es el único responsable técnico de un servicio que en marzo de 2028 atiende ${entero(F[15].unidades)} combis.</li>
</ul>
<h3>Las tres decisiones que más mueven el resultado</h3>
<ol>
<li><strong>Facturar a inicio de mes.</strong> Baja el capital necesario de ${milesDeSoles(-R.cajaMinima)} a ${milesDeSoles(-e('Facturación a inicio de mes').cajaMinima)} sin cambiar nada más.</li>
<li><strong>Acortar la pausa.</strong> Con dos meses de pausa en vez de cuatro, 2027 deja ${milesDeSoles(e('Pausa de 2 meses en vez de 4').utilidad2027)}; sin pausa, ${milesDeSoles(e('Sin pausa: se pasa directo a Arequipa o Cusco').utilidad2027)}.</li>
<li><strong>Revisar el precio.</strong> Con S/ 0,60 por unidad por día, 2027 deja ${milesDeSoles(e('Precio de S/ 0,60 por unidad por día').utilidad2027)}; con S/ 0,50 más IGV, ${milesDeSoles(e('Precio de S/ 0,50 más IGV').utilidad2027)}.</li>
</ol>
</section>

<section class="seccion">
<h2>2. El negocio visto desde una ruta</h2>
<p>Una ruta tiene ${S.unidadesPorRuta} unidades y cada unidad paga S/ 0,50 por día, así que una ruta factura S/ 600 en un mes de 30 días y S/ 620 en uno de 31. De esa factura, el 18 % es IGV y se le paga a SUNAT, de modo que a la empresa le quedan ${soles(ventaRutaMes)} por ruta y por mes.</p>
<table class="simple num"><tbody>
<tr><th>Lo que paga una ruta en un mes de 30 días</th><td>S/ 600 con IGV</td></tr>
<tr><th>Lo que le queda a COOP-R14 sin IGV</th><td>${soles(ventaRutaMes)}</td></tr>
<tr><th>Lo que cuesta el servidor de esa ruta, con colchón</th><td>${soles(servidorPorRuta)}</td></tr>
<tr><th>Lo que cuesta firmarla una sola vez (comisión, cargas y kit)</th><td>${soles(costoEntrada)}</td></tr>
<tr><th>Lo que factura en su primer mes, que paga a medias</th><td>${soles(ventaRutaMes / 2)}</td></tr>
</tbody></table>
<p>La ruta que firma un vendedor cuesta unos ${soles(costoEntrada)} una sola vez y recupera ese costo en su segundo mes. Desde entonces, cada ruta deja unos S/ 450 al mes para cubrir los gastos fijos, que con el equipo completo y sin crecer suman unos ${soles(fijoMensual)} al mes. Por eso el negocio se sostiene solo a partir de unas ${equilibrio[0].rutas} rutas.</p>
<div class="nota"><p><strong>Una corrección al cálculo de 0,381:</strong> ese número salía de quitarle el IGV a S/ 0,50, lo que da S/ 0,4237, y de restarle después un 10 % de renta. El 10 % del Régimen MYPE Tributario se paga sobre la utilidad anual y no sobre lo que se factura, de modo que lo que entra a la empresa por unidad y por día son S/ 0,4237. Cada mes se adelanta solo el 1 % de las ventas, y la renta se ajusta en marzo del año siguiente.</p></div>
<h3>Rutas necesarias para cubrir los gastos fijos</h3>
<p>La tabla supone el equipo completo, con el sueldo de Gerson, y ninguna ruta nueva en el mes, de modo que no hay comisiones ni kits que pagar.</p>
<table class="simple num"><thead><tr><th>Precio por unidad y por día</th><th>Rutas</th><th>Unidades</th><th>Pago por micro al mes</th></tr></thead><tbody>
${equilibrio.map(q => `<tr><th>S/ ${decimal(q.precio)}</th><td>${q.rutas}</td><td>${entero(q.rutas * 40)}</td><td>S/ ${entero(q.precio * 30)}</td></tr>`).join('')}
</tbody></table>
</section>

<section class="seccion">
<h2>3. Supuestos</h2>
<p>Cada supuesto de esta tabla se puede cambiar en el simulador. Los que más pesan en el resultado son la productividad de venta, la duración de la pausa y el precio.</p>
<table class="simple"><tbody>
<tr><th>Precio</th><td>S/ 0,50 por unidad por día, con el IGV incluido, cobrado todos los días del mes.</td></tr>
<tr><th>Tamaño de una ruta</th><td>40 unidades por ruta, y cada empresa tiene una sola ruta.</td></tr>
<tr><th>Prueba</th><td>Las 2 rutas de diciembre de 2026 no pagan. En enero de 2027 todas las rutas pagan el mes completo, y desde febrero una ruta nueva paga la mitad de su primer mes.</td></tr>
<tr><th>Capacidad de venta</th><td>Una ruta por semana por jornada completa. Gerson trae 4 rutas por mes en enero y febrero. Un vendedor a tiempo completo trae 1 ruta su primer mes y 4 desde el segundo; uno a medio tiempo, 1 y después 2.</td></tr>
<tr><th>Mercado</th><td>Juliaca y Puno suman unas 60 rutas. Desde la ruta 26 se vende también en Puno, con S/ 500 al mes de viajes.</td></tr>
<tr><th>Pausa</th><td>Al llegar a 60 rutas se dejan de firmar rutas durante 4 meses para preparar Arequipa o Cusco, y después se vende allá. La ciudad grande cuesta S/ 1500 al mes en viajes y estadía desde que empieza la pausa.</td></tr>
<tr><th>Cobranza</th><td>Se factura a fin de mes. El 95 % se cobra al mes siguiente, el 3 % a los dos meses y el 2 % no se cobra.</td></tr>
<tr><th>Sueldos</th><td>S/ 1400 por jornada completa y S/ 700 por medio tiempo, más S/ 200 por cada ruta que firma un vendedor. Gerson no cobra hasta junio de 2027 y desde julio cobra S/ 2000 como programador.</td></tr>
<tr><th>Cargas laborales</th><td>Microempresa inscrita en el REMYPE: sin CTS ni gratificaciones, con EsSalud del 9 % y Vida Ley del 1 %.</td></tr>
<tr><th>Oficina</th><td>Prestada en diciembre de 2026. Desde enero de 2027, alquiler de S/ 500 con una garantía de S/ 1000, internet de S/ 120 y servicios que suben con el número de personas.</td></tr>
<tr><th>Equipo de trabajo</th><td>Por cada persona contratada, un celular de S/ 700 con un plan de S/ 50, una laptop de S/ 2200 y un escritorio con silla de S/ 650. Gerson usa su propia laptop y su propio celular.</td></tr>
<tr><th>Tecnología</th><td>Suscripción de IA de S/ 400 al mes y S/ 25 por persona en licencias. El servidor sale del archivo modelo-costos.js del repositorio, a S/ 3,75 por dólar y con un colchón del 25 %.</td></tr>
<tr><th>Otros gastos</th><td>Contador externo de S/ 350 al mes, que sube a S/ 500 en junio de 2027. Marketing de S/ 300 al mes y un kit de S/ 150 por ruta nueva. Constitución de la EIRL y abogado por S/ 1600, licencia municipal e ITSE por S/ 400 y un 5 % de imprevistos.</td></tr>
</tbody></table>
</section>

<section class="ancha">
<h2>4. Plan de crecimiento</h2>
<p>La tabla muestra cuántas rutas trae cada persona cada mes. Una ruta nueva entra a la cuenta de las rutas activas el mismo mes en que se firma.</p>
${tablaRutas()}
<h3>El equipo, mes a mes</h3>
<p>Los vendedores se cuentan en jornadas: ½ es medio tiempo, y 2 ½ son dos vendedores a tiempo completo y uno a medio tiempo.</p>
${tablaEquipo()}
<figure>${graficoBarras(F.map(f => f.rutas), { minimo: 0, maximo: 100, paso: 25, formato: entero, alto: 150 })}<figcaption>Rutas activas al cierre de cada mes. La meseta de agosto a noviembre de 2027 es la pausa para preparar la ciudad grande.</figcaption></figure>
</section>

<section class="seccion">
<h2>5. El equipo y sus funciones</h2>
<p>El primer nivel de soporte no lo da COOP-R14: lo da el despacho de cada empresa desde su panel, y el chofer administra a sus propios cobradores desde la app. Por eso el equipo es chico y casi todo su tiempo se va en vender, instalar y cobrar.</p>

<div class="rol"><h3>Gerson · titular gerente y programador</h3>
<div class="ficha-rol">Desde diciembre de 2026 · sin sueldo hasta junio de 2027, S/ 2000 desde julio · trae 4 rutas por mes en enero y febrero</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Vende en diciembre, enero y febrero: cierra las 2 rutas de prueba y 8 rutas más.</li>
<li>Desde marzo, se dedica al sistema: servidor, seguridad, respaldos y actualizaciones de la app.</li>
<li>Prepara el servidor antes de las 5000 unidades, que es el máximo que ya se probó.</li>
<li>Firma los contratos, aprueba los pagos y decide cuándo empieza y termina la pausa.</li>
</ul></div><div><h4>Cómo se mide</h4><ul>
<li>Horas al mes con el servicio caído y tiempo de respuesta ante una falla.</li>
<li>Respaldos probados una vez al mes, con una restauración completa.</li>
<li>Caja disponible frente al plan, revisada en la primera semana de cada mes.</li>
</ul></div></div></div>

<div class="rol"><h3>Vendedor A · tiempo completo</h3>
<div class="ficha-rol">Medio tiempo en diciembre de 2026 (S/ 700) y tiempo completo desde enero de 2027 (S/ 1400) · S/ 200 por ruta firmada · meta: 1 ruta en enero y 4 por mes desde febrero</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Acompaña las 2 rutas de prueba de diciembre y anota lo que piden los choferes y el despacho.</li>
<li>Busca empresas, presenta el sistema a la gerencia y, cuando hace falta, a la asamblea de socios.</li>
<li>Instala la app en los teléfonos de choferes y cobradores, y deja capacitado al despacho.</li>
<li>Acompaña a cada ruta nueva durante su primer mes, hasta que paga su primera factura completa.</li>
</ul></div><div><h4>Cómo se mide</h4><ul>
<li>Rutas firmadas en el mes, contra una meta de 4.</li>
<li>Teléfonos con la app activa una semana después de la firma.</li>
<li>Rutas que pagan su segunda factura a tiempo.</li>
</ul></div></div></div>

<div class="rol"><h3>Vendedor B · medio tiempo</h3>
<div class="ficha-rol">Desde febrero de 2027 · S/ 700 · S/ 200 por ruta firmada · meta: 1 ruta en febrero y 2 por mes desde marzo</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Vende a empresas chicas y hace el seguimiento de las que dijeron que lo pensarían.</li>
<li>Apoya las instalaciones de los vendedores a tiempo completo cuando una ruta tiene muchos choferes.</li>
<li>Visita a las rutas activas que dejan de usar la app, antes de que pidan dar de baja el servicio.</li>
</ul></div><div><h4>Cómo se mide</h4><ul>
<li>Rutas firmadas en el mes, contra una meta de 2.</li>
<li>Rutas activas con menos del 80 % de sus unidades reportando, y cuántas se recuperan.</li>
</ul></div></div></div>

<div class="rol"><h3>Vendedor D · tiempo completo, reemplaza a Gerson en ventas</h3>
<div class="ficha-rol">Desde marzo de 2027 · S/ 1400 · S/ 200 por ruta firmada · meta: 1 ruta en marzo y 4 por mes desde abril</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Recibe la cartera y los contactos de Gerson, que lo acompaña a sus reuniones en febrero.</li>
<li>Abre Puno desde abril, cuando se llega a la ruta 26.</li>
<li>Lidera la preparación de la ciudad grande durante la pausa y su primera venta en diciembre.</li>
</ul></div><div><h4>Cómo se mide</h4><ul>
<li>Rutas firmadas en el mes, contra una meta de 4.</li>
<li>Durante la pausa, reuniones agendadas en la ciudad grande y contratos listos para firmar en diciembre.</li>
</ul></div></div></div>

<div class="rol"><h3>Asistente de oficina · medio tiempo</h3>
<div class="ficha-rol">Desde abril de 2027 · S/ 700 · no vende</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Emite las facturas electrónicas, hace la cobranza y avisa a quien tiene un pago atrasado.</li>
<li>Atiende las llamadas de las empresas y deriva al despacho lo que el despacho puede resolver.</li>
<li>Archiva los contratos y los consentimientos firmados de choferes y cobradores.</li>
<li>Prepara para el contador la información de la planilla, las compras y las ventas del mes.</li>
</ul></div><div><h4>Cómo se mide</h4><ul>
<li>Facturas emitidas en los tres primeros días del mes.</li>
<li>Porcentaje cobrado al día 15 del mes siguiente, contra una meta del 95 %.</li>
</ul></div></div></div>

<div class="rol"><h3>Contador externo</h3>
<div class="ficha-rol">Desde diciembre de 2026 · S/ 350 al mes, S/ 500 desde junio de 2027 · con recibo por honorarios</div>
<div class="cols"><div><h4>Funciones</h4><ul>
<li>Inscribe a la EIRL en el REMYPE y en el Régimen MYPE Tributario.</li>
<li>Presenta cada mes el PDT 621 del IGV y la renta, y la planilla electrónica.</li>
<li>Lleva los libros electrónicos y prepara la declaración anual de marzo.</li>
</ul></div><div><h4>Qué confirma primero</h4><ul>
<li>Si el servicio entra en el sistema de detracciones del 12 %.</li>
<li>La UIT y la remuneración mínima de 2027, y cómo se paga el sueldo de Gerson.</li>
</ul></div></div></div>

<h3>Metas de la pausa, de agosto a noviembre de 2027</h3>
<p>Durante la pausa, la planilla de ventas sigue costando unos S/ 4300 al mes sin rutas nuevas. Por eso cada vendedor recibe metas propias para esos cuatro meses: elegir la ciudad grande en agosto, conseguir 30 reuniones con gerencias en septiembre y octubre, y dejar 10 contratos listos para firmar en diciembre. Mientras tanto, la cobranza de Juliaca y Puno tiene que mantenerse al día.</p>
</section>

<section class="seccion resultados">
<h2>6. Estados de resultados mensuales</h2>
<p>Las cifras están en soles y sin IGV, y las filas en gris muestran de qué está hecho cada gasto.</p>
${tablaMensual(0, 8, false, 'resultados')}
</section>
<section class="seccion resultados">
<h2>6. Estados de resultados mensuales (continuación)</h2>
<p>Las tres últimas columnas suman diciembre de 2026, todo 2027 y el primer trimestre de 2028.</p>
${tablaMensual(8, 16, true, 'resultados')}
</section>

<section class="seccion">
<h3 style="margin-top:0">Ingreso neto y gastos de cada mes</h3>
<div class="leyenda"><i style="background:#2a78d6"></i>Ingreso neto<i style="background:#eb6834"></i>Gastos y depreciación</div>
<figure>${graficoLineas([{ nombre: 'Ingreso', color: '#2a78d6', valores: F.map(f => f.venta - f.incobrable) }, { nombre: 'Gastos', color: '#eb6834', valores: F.map(f => f.totalGastos + f.depreciacion), abajo: true }], { maximo: 50000, paso: 10000 })}<figcaption>Las dos líneas se cruzan en mayo de 2027. El salto de diciembre en los gastos son las comisiones y los kits de las primeras rutas de la ciudad grande.</figcaption></figure>
<h3>Lo que dicen los resultados</h3>
<p>El negocio pierde de diciembre a abril, aunque cada vez menos, porque las rutas nuevas pagan medio mes y las comisiones se cobran al firmar. Marzo pierde ${d.marzo27} porque Gerson deja de vender y el vendedor D recién empieza, y abril pierde ${d.abril27} porque entra el asistente de oficina con su equipo.</p>
<p>Desde mayo de 2027 el negocio gana todos los meses, y durante la pausa la utilidad se estabiliza en unos S/ 15 000 al mes. En esos meses ya no se pagan comisiones ni kits, aunque sí se paga la preparación de la ciudad grande. En diciembre de 2027 baja a ${d.utilDic} porque se vuelve a firmar, y en marzo de 2028 llega a ${d.utilMar28}.</p>
</section>

<section class="ancha">
<h2>7. Flujo de caja</h2>
<p>Las cifras están con IGV, porque es plata que entra y sale de verdad. El IGV y el adelanto de renta de un mes se pagan a SUNAT el mes siguiente.</p>
${tablaMensual(0, 16, true, 'caja')}
<figure>${graficoBarras(F.map(f => f.caja), { minimo: -50000, maximo: 100000, paso: 25000, alto: 170 })}<figcaption>Caja acumulada sin aporte de capital. Toca fondo en abril de 2027 y vuelve a positivo en septiembre.</figcaption></figure>
</section>

<section class="seccion">
<h2>8. Capital, impuestos y cierre del período</h2>
<h3>Cuánto capital se necesita</h3>
<p>Sin aporte, la caja baja hasta ${d.cajaMin} en ${d.mesCajaMin}. Hasta marzo de 2027 ya se gastan ${soles(-F[3].caja)}, y el punto más bajo llega en abril, cuando entra el asistente de oficina con su equipo. Con un aporte de S/ 50 000, la caja nunca baja de unos S/ 9700, que alcanzan para cubrir un mes de cobranza atrasada. Si se factura a inicio de mes, el hueco baja a ${milesDeSoles(-e('Facturación a inicio de mes').cajaMinima)} y alcanzan unos S/ 35 000.</p>
<h3>Posición al 31 de marzo de 2028</h3>
<table class="simple num"><tbody>
<tr><th>Caja acumulada</th><td>${d.cajaFinal}</td></tr>
<tr><th>Facturación por cobrar, que entra en abril</th><td>${d.porCobrar}</td></tr>
<tr><th>IGV de marzo, que se paga en abril</th><td>${d.igvPorPagar}</td></tr>
<tr><th>Ventas sin IGV del primer trimestre de 2028</th><td>${soles(F.slice(13).reduce((s, f) => s + f.venta, 0))}</td></tr>
<tr><th>Utilidad operativa del primer trimestre de 2028</th><td>${soles(F.slice(13).reduce((s, f) => s + f.utilOper, 0))}</td></tr>
</tbody></table>
<h3>Impuestos</h3>
<ul>
<li><strong>IGV del 18 %.</strong> Se debe cuando se emite la factura, aunque el cliente todavía no haya pagado. Como microempresa, COOP-R14 puede acogerse al IGV Justo (Ley 30524) y postergar ese pago tres meses.</li>
<li><strong>Renta en el Régimen MYPE Tributario.</strong> Cada mes se adelanta el 1 % de las ventas sin IGV. La renta anual es del 10 % sobre los primeros 15 UIT de utilidad, que son S/ 82 500, y del 29,5 % sobre el resto. La utilidad de 2027 menos la pérdida de diciembre de 2026 deja una renta de ${d.renta27}; los adelantos cubren ${d.adelantos} y el saldo de ${d.saldoRenta} se paga en marzo de 2028.</li>
<li><strong>Detracción del 12 %.</strong> Se aplica a los servicios facturados por más de S/ 700. Una ruta factura entre S/ 600 y S/ 620 al mes y queda por debajo, pero una empresa de la ciudad grande con varias rutas en una sola factura sí tendría detracción.</li>
<li><strong>Régimen laboral de microempresa.</strong> Vale mientras las ventas anuales no pasen de 150 UIT, que son S/ 825 000. En 2027 se venden ${d.ventas27}, y en marzo de 2028 el ritmo anual ronda los S/ 600 000.</li>
<li><strong>Gerson en planilla.</strong> Desde julio cobra S/ 2000 con EsSalud. La utilidad que quede en la EIRL se puede retirar como dividendos, con una retención del 5 %.</li>
</ul>
</section>

<section class="seccion">
<h2>9. Análisis de sensibilidad</h2>
<p>Cada fila cambia un solo supuesto del plan base y deja todo lo demás igual. La caja mínima es el capital que necesitaría ese escenario.</p>
${tablaEscenarios()}
<h3>Lo que muestra la tabla</h3>
<p><strong>El riesgo más grande es vender menos de lo previsto.</strong> Si cada persona trae la mitad, el capital necesario sube a ${milesDeSoles(-e('Todos traen la mitad de lo previsto').cajaMinima)} y la caja de marzo de 2028 queda en ${milesDeSoles(e('Todos traen la mitad de lo previsto').cajaFinal)}. La señal llega pronto: si en marzo de 2027 no hay unas 20 rutas activas, el plan se tiene que corregir.</p>
<p><strong>La pausa reduce el crecimiento, pero no cambia el capital necesario.</strong> Con cuatro meses de pausa, 2027 deja ${milesDeSoles(R.utilidad2027)}; sin pausa, ${milesDeSoles(e('Sin pausa: se pasa directo a Arequipa o Cusco').utilidad2027)}. El capital necesario es el mismo en los dos casos, porque el punto más bajo de la caja llega antes de la pausa.</p>
<p><strong>Hasta marzo de 2028, quedarse en Juliaca y Puno deja un poco más.</strong> En ese escenario, 2027 cierra con ${milesDeSoles(e('Solo Juliaca y Puno, sin ciudad grande').utilidad2027)} y la caja de marzo de 2028 llega a ${milesDeSoles(e('Solo Juliaca y Puno, sin ciudad grande').cajaFinal)}, porque no se paga la preparación de la ciudad grande. Desde enero de 2028 el plan base ya gana más cada mes, y la diferencia crece con cada ruta nueva.</p>
<p><strong>Que Gerson deje de vender cuesta unos ${milesDeSoles(e('Gerson sigue vendiendo 4 rutas por mes').utilidad2027 - R.utilidad2027)} de utilidad en 2027.</strong> Es el precio de tener a una persona dedicada al sistema cuando el servicio pasa de unas pocas rutas a miles de combis.</p>
</section>

<section class="continua">
<h2>10. Riesgos y cómo vigilarlos</h2>
<table class="simple"><thead><tr><th>Riesgo</th><th>Señal temprana</th><th>Qué hacer</th></tr></thead><tbody>
<tr><th>Se vende menos de lo previsto</th><td>Menos de 20 rutas activas a fines de marzo de 2027.</td><td>Revisar el argumento de venta con las empresas que dijeron que no, antes de contratar más vendedores.</td></tr>
<tr><th>Las rutas firmadas no usan la app</th><td>Menos del 80 % de las unidades reportando una semana después de la firma.</td><td>Volver a instalar y capacitar al despacho; una ruta que no usa la app deja de pagar.</td></tr>
<tr><th>La cobranza se atrasa</th><td>Menos del 95 % cobrado al día 15 del mes siguiente.</td><td>Facturar a inicio de mes y suspender el servicio con un aviso claro al segundo mes impago.</td></tr>
<tr><th>El servidor no aguanta la escala</th><td>Informes que tardan más de un segundo con 4000 unidades.</td><td>Preparar el servidor antes de las 5000 unidades, como indica COSTOS.md.</td></tr>
<tr><th>El sistema depende de una sola persona</th><td>Una falla que nadie más puede atender.</td><td>Documentar los despliegues y tener un programador de confianza para pagarle por horas.</td></tr>
<tr><th>La ciudad grande tarda en arrancar</th><td>Menos de 10 contratos listos a fines de noviembre de 2027.</td><td>Alargar la pausa un mes, o volver a buscar rutas en Juliaca y Puno.</td></tr>
</tbody></table>

<h2 style="margin-top:16pt">11. Recomendaciones</h2>
<ol>
<li><strong>Tener S/ 50 000 disponibles antes de diciembre de 2026,</strong> o S/ 35 000 si se factura a inicio de mes. No hace falta todo el primer mes: hasta marzo se gastan unos ${milesDeSoles(-F[3].caja)}.</li>
<li><strong>Facturar a inicio de mes.</strong> Es la medida más barata del plan y la que más baja el capital necesario.</li>
<li><strong>Pasar la cartera de Gerson al vendedor D en febrero,</strong> llevándolo a las reuniones, para que marzo no caiga tanto.</li>
<li><strong>Medir la meta cada semana:</strong> quién firmó qué ruta y cuántos teléfonos quedaron con la app activa.</li>
<li><strong>Planificar la pausa desde mayo,</strong> para que en agosto ya esté elegida la ciudad grande y armado el trabajo de los cuatro meses.</li>
<li><strong>Cotizar S/ 0,50 más IGV,</strong> porque significa un 18 % más de ingreso con el mismo esfuerzo de venta.</li>
<li><strong>Firmar contratos por unidad inscrita,</strong> con un mínimo de 40 unidades por ruta y un plazo de 12 meses.</li>
<li><strong>Apartar cada mes un 10 % de la utilidad</strong> para la renta que se paga en marzo.</li>
<li><strong>Separar las cuentas:</strong> la EIRL con su propia cuenta bancaria, y los retiros de Gerson con un monto y una fecha fijos.</li>
</ol>
<h3>Qué evitar</h3>
<ul>
<li><strong>Dar pruebas gratis sin fecha de fin,</strong> porque cada mes gratis de una ruta cuesta unos S/ 500 y acostumbra al cliente a no pagar.</li>
<li><strong>Partir la factura de una empresa con varias rutas para esquivar la detracción,</strong> porque SUNAT mira la operación y no el papel.</li>
<li><strong>Que Gerson vuelva a vender cuando falte una ruta,</strong> porque desde marzo su trabajo es el sistema.</li>
<li><strong>Pagar a los vendedores durante la pausa sin metas propias,</strong> porque son unos S/ 17 000 en cuatro meses.</li>
<li><strong>Regalar celulares, soportes o datos a los choferes,</strong> porque S/ 15 por chofer equivalen al ingreso de un mes entero de la ruta.</li>
</ul>
</section>

<section class="continua">
<h2>12. Calendario de decisiones</h2>
<table class="simple"><thead><tr><th>Mes</th><th>Qué pasa</th><th>Qué se decide</th></tr></thead><tbody>
<tr><th>Diciembre de 2026</th><td>Dos rutas de prueba, oficina prestada y un vendedor a medio tiempo.</td><td>Constituir la EIRL, inscribirla en el REMYPE y abrir la cuenta bancaria.</td></tr>
<tr><th>Enero de 2027</th><td>Empieza el cobro y se alquila la oficina.</td><td>Confirmar con el contador la detracción y el pago a Gerson.</td></tr>
<tr><th>Febrero de 2027</th><td>Entra el vendedor B; Gerson vende su último mes.</td><td>Pasar la cartera de Gerson al vendedor D.</td></tr>
<tr><th>Marzo de 2027</th><td>Entra el vendedor D y Gerson pasa al sistema.</td><td>Comparar las rutas activas con el plan: la meta son 23.</td></tr>
<tr><th>Abril de 2027</th><td>Entra el asistente de oficina; la caja toca fondo.</td><td>Revisar el capital disponible frente a lo gastado.</td></tr>
<tr><th>Mayo de 2027</th><td>El negocio empieza a ganar todos los meses.</td><td>Armar el plan de la pausa y la lista de ciudades posibles.</td></tr>
<tr><th>Julio de 2027</th><td>Se llega a 60 rutas y Gerson empieza a cobrar.</td><td>Confirmar que Juliaca y Puno están llenas o seguir vendiendo allí.</td></tr>
<tr><th>Agosto a noviembre de 2027</th><td>Pausa para preparar la ciudad grande.</td><td>Elegir entre Arequipa y Cusco en agosto y dejar 10 contratos listos.</td></tr>
<tr><th>Diciembre de 2027</th><td>Primeras rutas en la ciudad grande.</td><td>Decidir si hace falta un cuarto vendedor para 2028.</td></tr>
<tr><th>Marzo de 2028</th><td>Se paga la renta de 2027 y cierra el período del plan.</td><td>Escribir el plan del segundo año con los números reales.</td></tr>
</tbody></table>

<h2 style="margin-top:16pt">Anexo: método y cifras por confirmar</h2>
<p>Los números salen del archivo plan-financiero/modelo/modelo.js del repositorio, y una prueba automática fija los resultados de este documento. El costo del servidor sale de modelo-costos.js, que lo midió con el servidor real, y se ajustó a 40 unidades por ruta. El simulador usa el mismo modelo, de modo que lo que se cambie allí se puede comparar con este plan.</p>
<p>Las cifras tributarias y laborales son de noviembre de 2026 y salen de memoria, así que el contador debe confirmarlas antes de usarlas: la UIT de 2027, tomada como S/ 5500; la remuneración mínima, tomada como S/ 1130; si el servicio entra en el sistema de detracciones; las condiciones del IGV Justo, y cómo se declaran EsSalud y la Vida Ley de los medios tiempos.</p>
<p class="pie">COOP-R14 · Plan del Primer Año, versión alfa · ${fecha}</p>
</section>
</body></html>`;

// Espacios fijos: ninguna cifra se parte al final de una línea.
const textoFinal = html.replace(/S\/ (?=[\d−])/g, 'S/' + NBSP).replace(/(\d) (\d{3})(?!\d)/g, '$1' + NBSP + '$2').replace(/(\d) %/g, '$1' + NBSP + '%');
const salidaHtml = path.join(AQUI, 'plan-primer-anio-alfa.html');
fs.writeFileSync(salidaHtml, textoFinal);

(async () => {
  const { chromium } = require('playwright');
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  await pagina.goto('file://' + salidaHtml);
  await pagina.waitForTimeout(400);
  await pagina.pdf({
    path: path.join(AQUI, 'plan-primer-anio-alfa.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:7px Inter,sans-serif;color:#75817c;padding:0 12mm;display:flex;justify-content:space-between"><span>COOP-R14 · Plan del Primer Año v. alfa</span><span><span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  });
  await navegador.close();
  console.log('Listo:', path.relative(process.cwd(), salidaHtml).replace('.html', '.pdf'));
})();
