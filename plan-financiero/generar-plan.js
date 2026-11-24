#!/usr/bin/env node
// Genera el Plan del Primer Año v. alfa en LaTeX y lo compila a PDF.
//
//   node plan-financiero/generar-plan.js
//
// El texto vive en latex/plan.plantilla.tex. Este script pone donde dice
// «clave» las cifras, las tablas y los datos de los gráficos, que salen
// todos de modelo/modelo.js, escribe latex/plan-primer-anio-alfa.tex y lo
// compila con latexmk. El PDF queda en esta carpeta.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { simular, SUPUESTOS: S } = require('./modelo/modelo');

const AQUI = __dirname;
const LATEX = path.join(AQUI, 'latex');
const BASE = simular();
const F = BASE.filas;
const R = BASE.resumen;
const FECHA = '24 de noviembre de 2026';

// ── Formato de la casa: coma decimal, miles con espacio fino desde 5 cifras,
//    signo menos verdadero.
function entero(n) {
  const r = Math.round(n), s = String(Math.abs(r));
  return (r < 0 ? '−' : '') + (s.length >= 5 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, '\\,') : s);
}
const soles = n => 'S/~' + entero(n);
const mil = n => 'S/~' + (Math.round(n / 100) / 10).toLocaleString('es-PE', { maximumFractionDigits: 1 }).replace('.', ',') + '~mil';
const MES = { ene: 'enero', feb: 'febrero', mar: 'marzo', abr: 'abril', may: 'mayo', jun: 'junio', jul: 'julio', ago: 'agosto', sep: 'septiembre', oct: 'octubre', nov: 'noviembre', dic: 'diciembre' };
const mesLargo = m => m ? MES[m.slice(0, 3)] + ' de 20' + m.slice(4) : 'fuera del período';
const suma = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const tex = s => String(s).replace(/%/g, '\\%').replace(/S\/ /g, 'S/~');

// ── Escenarios
const ESCENARIOS = [
  ['Plan base', {}],
  ['Sin pausa', { pausaMeses: 0 }],
  ['Pausa de 2 meses', { pausaMeses: 2 }],
  ['Solo Juliaca y Puno', { ciudadGrande: false }],
  ['Facturación a inicio de mes', { cobroAdelantado: true }],
  ['Gerson sigue vendiendo', { duenoVendeHasta: 99 }],
  ['Todos traen la mitad', { rutasDueno: 2, rampaTiempoCompleto: [1, 2], rampaMedioTiempo: [0, 1] }],
  ['Ciudad grande a S/ 3000 al mes', { costoCiudadGrande: 3000 }],
  ['Gerson sin sueldo', { sueldoDueno: 0 }],
  ['Se cobra el 85 % de las unidades', { utilizacion: 0.85 }],
  ['Primer mes gratis por ruta', { mesGratisNuevas: true }],
  ['Servidor al doble del costo', { colchonInfraestructura: 2.5 }],
  ['Precio de S/ 0,60', { precio: 0.6 }],
  ['Precio de S/ 0,50 más IGV', { precioIncluyeIGV: false }],
].map(([nombre, cambios]) => ({ nombre, r: simular(cambios) }));
const esc = n => ESCENARIOS.find(e => e.nombre === n).r.resumen;

// ── Economía de una ruta y punto de equilibrio
const ventaRutaMes = S.unidadesPorRuta * S.precio * 30 / (1 + S.igv);
const infra = f => suma(Object.values(f.desglose['Infraestructura'] || {}), x => x);
const servidorPorRuta = infra(F[15]) / F[15].rutas;
const costoEntrada = S.comisionPorRuta * (1 + S.cargasSociales) + S.kitPorRuta / (1 + S.igv);
const agosto = F[8];
const fijoMensual = agosto.totalGastos - (infra(agosto) + (agosto.gastos['Ciudad grande'] || 0)) * (1 + S.imprevistos) + agosto.depreciacion;
const variablePorRuta = infra(agosto) / agosto.rutas * (1 + S.imprevistos);
const equilibrio = [0.5, 0.6, 0.7, 0.8].map(p => ({ precio: p, rutas: Math.ceil(fijoMensual / (S.unidadesPorRuta * p * 30.4 / (1 + S.igv) * (1 - S.incobrable) - variablePorRuta)) }));

// ── Tablas
const MESES = F.map(f => f.mes);
const num = (n, hijo) => { const r = Math.round(n); if (r === 0) return ''; return r < 0 ? (hijo ? `\\nmh{${entero(r)}}` : `\\nm{${entero(r)}}`) : entero(r); };
const GRUPOS = ['Sueldos y comisiones', 'Cargas sociales', 'Infraestructura', 'Alquiler de oficina', 'Servicios de oficina', 'Planes de datos', 'Movilidad y viajes', 'Ciudad grande', 'Marketing y rutas nuevas', 'Contador externo', 'IA y software', 'Equipos menores', 'Trámites y legal', 'Útiles y bancos', 'Imprevistos'];

function tablaMeses(desde, hasta, totales, tipo) {
  const fs_ = F.slice(desde, hasta);
  const tot = (fn, a) => suma(F.filter(f => f.anio === a), fn);
  let t = 'Concepto & ' + fs_.map(f => f.mes).join(' & ') + (totales ? ' & 2026 & 2027 & T1 2028' : '') + ' \\\\\n\\midrule\n';
  const linea = (nombre, fn, estilo = '') => {
    const hijo = estilo === 'hijo';
    const celdas = fs_.map(f => num(fn(f), hijo)).concat(totales ? [2026, 2027, 2028].map(a => num(tot(fn, a), hijo)) : []);
    const et = hijo ? `\\hijo{${nombre}}` : nombre;
    if (estilo === 'sub') return `\\rowcolor{verdefondo}\\textbf{${et}} & ${celdas.map(c => c ? `\\textbf{${c}}` : '').join(' & ')} \\\\\n`;
    if (estilo === 'fuerte' || estilo === 'total') return (estilo === 'total' ? '\\midrule\n' : '') + `\\textbf{${et}} & ${celdas.map(c => c ? `\\textbf{${c}}` : '').join(' & ')} \\\\\n`;
    if (hijo) return `${et} & ${celdas.map(c => c ? `{\\color{tenue}${c}}` : '').join(' & ')} \\\\\n`;
    return `${et} & ${celdas.join(' & ')} \\\\\n`;
  };
  const vacias = ' & '.repeat(totales ? 3 : 0);
  if (tipo === 'resultados') {
    t += `{\\color{tenue}Rutas activas} & ${fs_.map(f => `{\\color{tenue}${f.rutas}}`).join(' & ')}${vacias} \\\\\n`;
    t += linea('Ventas netas (sin IGV)', f => f.venta, 'fuerte');
    t += linea('Rutas que pagan el mes completo', f => f.ventaCompletas, 'hijo');
    t += linea('Rutas nuevas, medio mes', f => f.ventaMedias, 'hijo');
    t += linea('(−) Cobranza dudosa', f => -f.incobrable);
    t += linea('Ingreso neto', f => f.venta - f.incobrable, 'sub');
    for (const g of GRUPOS) {
      const det = [...new Set(F.flatMap(f => Object.keys(f.desglose[g] || {})))];
      t += linea('(−) ' + g, f => -(f.gastos[g] || 0), det.length > 1 ? 'fuerte' : '');
      if (det.length > 1) for (const d of det) t += linea(d, f => -((f.desglose[g] || {})[d] || 0), 'hijo');
    }
    t += linea('Total de gastos', f => -f.totalGastos, 'sub');
    t += linea('EBITDA', f => f.ebitda, 'fuerte');
    t += linea('(−) Depreciación de laptops', f => -f.depreciacion);
    t += linea('Utilidad operativa', f => f.utilOper, 'sub');
    t += linea('(−) Impuesto a la renta', f => -f.renta);
    t += linea('Utilidad neta', f => f.utilNeta, 'total');
  } else {
    t += linea('Cobranza (con IGV)', f => f.cobros, 'fuerte');
    t += linea('Facturas del mes anterior (95\\,\\%)', f => f.cobro1, 'hijo');
    t += linea('Saldo de hace dos meses (3\\,\\%)', f => f.cobro2, 'hijo');
    t += linea('(−) Pagos de gastos', f => -f.pagosOperativos, 'fuerte');
    t += linea('Gastos del mes, sin IGV', f => -f.totalGastos, 'hijo');
    t += linea('IGV de las compras', f => -f.igvCompras, 'hijo');
    t += linea('(−) IGV pagado a SUNAT', f => -f.pagaIGV);
    t += linea('(−) Adelanto de renta (1\\,\\%)', f => -f.pagaAdelanto);
    t += linea('(−) Saldo de la renta de 2027', f => -f.pagaRentaAnual);
    t += linea('Flujo operativo', f => f.flujoOperativo, 'sub');
    t += linea('(−) Compra de laptops', f => -f.compraLaptops);
    t += linea('(−) Garantía del alquiler', f => -f.garantia);
    t += linea('Flujo del mes', f => f.flujo, 'fuerte');
    t += '\\midrule\n' + `\\textbf{Caja acumulada, sin aporte} & ${fs_.map(f => `\\textbf{${num(f.caja)}}`).join(' & ')}${vacias} \\\\\n`;
    t += `{\\color{tenue}Caja con aporte de S/~50\\,000} & ${fs_.map(f => `{\\color{tenue}${num(f.caja + 50000)}}`).join(' & ')}${vacias} \\\\\n`;
  }
  return t.replace(/ \\\\\n$/, ' \\\\');
}

function tablaRutas() {
  let t = 'Quién & ' + MESES.join(' & ') + ' \\\\\n\\midrule\n';
  const p = [['Rutas de prueba', f => f.i === 0 ? f.nuevas : 0], ['Gerson', f => f.aportes.tu], ['Vendedor A', f => f.aportes.a], ['Vendedor B', f => f.aportes.b], ['Vendedor D', f => f.aportes.d]];
  for (const [n, fn] of p) t += `${n} & ${F.map(f => fn(f) || '').join(' & ')} \\\\\n`;
  t += `\\rowcolor{verdefondo}\\textbf{Rutas nuevas} & ${F.map(f => f.nuevas ? `\\textbf{${f.nuevas}}` : (f.enPausa ? '{\\color{ambar}pausa}' : '')).join(' & ')} \\\\\n`;
  t += `\\textbf{Rutas activas} & ${F.map(f => `\\textbf{${f.rutas}}`).join(' & ')} \\\\\n`;
  t += `{\\color{tenue}Unidades} & ${F.map(f => `{\\color{tenue}${entero(f.unidades)}}`).join(' & ')} \\\\\n`;
  t += `{\\color{tenue}Ciudades} & ${F.map(f => `{\\color{tenue}${f.ciudades}}`).join(' & ')} \\\\`;
  return t;
}
function tablaEquipo() {
  const j = v => v ? String(v).replace(/^0\.5$/, '½').replace('.5', '~½') : '';
  let t = 'Puesto & ' + MESES.join(' & ') + ' \\\\\n\\midrule\n';
  t += `Vendedores, en jornadas & ${F.map(f => j(f.equipo.vendedores)).join(' & ')} \\\\\n`;
  t += `Asistente de oficina & ${F.map(f => j(f.equipo.oficina)).join(' & ')} \\\\\n`;
  t += `Gerson en planilla & ${F.map(f => f.equipo.dueno ? '1' : '').join(' & ')} \\\\`;
  return t;
}

// ── Datos de los gráficos
const coords = fn => F.map((f, i) => `(${i},${Math.round(fn(f))})`).join(' ');
const coordsMil = fn => F.map((f, i) => `(${i},${(fn(f) / 1000).toFixed(2)})`).join(' ');
const coordsSim = fn => F.map(f => `(${f.mes},${fn(f) || 0})`).join(' ');
const gastos27 = GRUPOS.map(g => ({ g, v: suma(F.filter(f => f.anio === 2027), f => f.gastos[g] || 0) })).filter(x => x.v > 0).sort((a, b) => a.v - b.v);
const total27 = suma(gastos27, x => x.v);
const planilla27 = suma(gastos27.filter(x => x.g === 'Sueldos y comisiones' || x.g === 'Cargas sociales'), x => x.v);
const barrasH = items => items.map((x, i) => `(${(x.v / 1000).toFixed(2)},${i}) [${mil(x.v)}]`).join(' ');
const ticksH = items => `ytick={0,...,${items.length - 1}}, yticklabels={${items.map(x => `{${tex(x.g)}}`).join(',')}}`;
const escUtil = ESCENARIOS.map(e => ({ g: e.nombre, v: e.r.resumen.utilidad2027 })).sort((a, b) => a.v - b.v);
const escCaja = ESCENARIOS.map(e => ({ g: e.nombre, v: -e.r.resumen.cajaMinima })).sort((a, b) => b.v - a.v);
const idxMin = F.findIndex(f => f.caja === R.cajaMinima);

const tablaEscenarios = ESCENARIOS.map(e => {
  const r = e.r.resumen, b = e.nombre === 'Plan base';
  const c = x => b ? `\\textbf{${x}}` : x;
  return `${c(tex(e.nombre))} & ${c(r.ganaDesde || 'no llega')} & ${c(num(r.utilidad2027))} & ${c(num(r.cajaMinima))} & ${c(num(r.cajaFinal))} \\\\`;
}).join('\n');

const V = {
  fecha: FECHA,
  unidades: S.unidadesPorRuta,
  ventaRutaMes: soles(ventaRutaMes), servidorPorRuta: soles(servidorPorRuta), costoEntrada: soles(costoEntrada), primerMes: soles(ventaRutaMes / 2),
  fijoMensual: soles(fijoMensual), equilibrio50: equilibrio[0].rutas,
  tablaEquilibrio: equilibrio.map(q => `S/~${q.precio.toFixed(2).replace('.', ',')} & ${q.rutas} & ${entero(q.rutas * S.unidadesPorRuta)} & S/~${entero(q.precio * 30)} \\\\`).join('\n'),
  cajaMin: soles(R.cajaMinima), mesCajaMin: mesLargo(R.mesCajaMinima), cajaFinal: soles(R.cajaFinal),
  util27: soles(R.utilidad2027), util27Mil: mil(R.utilidad2027), ventas27: soles(R.ventas2027),
  ganaDesde: mesLargo(R.ganaDesde), ganaDesdeCorto: mesLargo(R.ganaDesde).replace(' de 20', ' '), lleno: mesLargo(R.llenoLocal),
  rutasFinal: F[15].rutas, unidadesFinal: entero(F[15].unidades), colchon: soles(50000 + R.cajaMinima),
  utilMitad: mil(esc('Todos traen la mitad').utilidad2027), capitalMitad: mil(-esc('Todos traen la mitad').cajaMinima), cajaMitad: mil(esc('Todos traen la mitad').cajaFinal),
  capitalMil: mil(-R.cajaMinima), capitalAdelantado: mil(-esc('Facturación a inicio de mes').cajaMinima),
  utilPausa2: mil(esc('Pausa de 2 meses').utilidad2027), utilSinPausa: mil(esc('Sin pausa').utilidad2027),
  utilPrecio60: mil(esc('Precio de S/ 0,60').utilidad2027), utilMasIGV: mil(esc('Precio de S/ 0,50 más IGV').utilidad2027),
  utilSoloJP: mil(esc('Solo Juliaca y Puno').utilidad2027), cajaSoloJP: mil(esc('Solo Juliaca y Puno').cajaFinal),
  costoDejarVender: mil(esc('Gerson sigue vendiendo').utilidad2027 - R.utilidad2027),
  marzo27Abs: soles(Math.abs(F[3].utilOper)), abril27Abs: soles(Math.abs(F[4].utilOper)), completasMarzo: F[3].rutasCompletas,
  abrilSinOficina: 'S/~' + entero(Math.round(simular({ oficina_desde: 99 }).filas[4].utilOper / 100) * 100),
  cobroAbril: soles(F[4].cobros), aporteCubre: 'S/~' + entero(Math.ceil((-R.cajaMinima + F[4].cobros) / 1000) * 1000),
  marzo27: soles(F[3].utilOper), abril27: soles(F[4].utilOper), utilDic: soles(F[12].utilOper), utilMar28: soles(F[15].utilOper),
  gastadoMarzo: soles(-F[3].caja), gastadoMarzoMil: mil(-F[3].caja),
  porCobrar: soles(R.porCobrar), igvPorPagar: soles(R.igvPorPagar),
  ventasT1: soles(suma(F.slice(13), f => f.venta)), utilT1: soles(suma(F.slice(13), f => f.utilOper)),
  renta27: soles(R.renta2027), adelantos: soles(R.adelantos2027), saldoRenta: soles(R.saldoRenta2027),
  ritmoAnual: 'S/~' + entero(Math.round(F[15].venta * 12 / 10000) * 10000),
  tablaRutas: tablaRutas(), tablaEquipo: tablaEquipo(),
  tablaResultados1: tablaMeses(0, 8, false, 'resultados'), tablaResultados2: tablaMeses(8, 16, true, 'resultados'),
  tablaCaja: tablaMeses(0, 16, true, 'caja'),
  tablaEscenarios,
  xMeses: MESES.join(','),
  serPrueba: coordsSim(f => f.i === 0 ? f.nuevas : 0), serGerson: coordsSim(f => f.aportes.tu), serA: coordsSim(f => f.aportes.a), serB: coordsSim(f => f.aportes.b), serD: coordsSim(f => f.aportes.d),
  serActivas: coords(f => f.rutas),
  serIngreso: coordsMil(f => f.venta - f.incobrable), serGastos: coordsMil(f => f.totalGastos + f.depreciacion),
  serCajaNeg: coordsMil(f => Math.min(0, f.caja)), serCajaPos: coordsMil(f => Math.max(0, f.caja)),
  idxMin, cajaMinNum: (R.cajaMinima / 1000).toFixed(2),
  ticksGrupos: ticksH(gastos27), serGrupos: barrasH(gastos27), nGruposMax: gastos27.length - 0.3,
  pctPlanilla: Math.round(planilla27 / total27 * 100) + '\\,\\%',
  ticksEscUtil: ticksH(escUtil), serEscUtil: barrasH(escUtil), util27Num: (R.utilidad2027 / 1000).toFixed(2),
  ticksEscCaja: ticksH(escCaja), serEscCaja: barrasH(escCaja), capitalNum: (-R.cajaMinima / 1000).toFixed(2),
  nEscMax: ESCENARIOS.length - 0.3,
};

let plantilla = fs.readFileSync(path.join(LATEX, 'plan.plantilla.tex'), 'utf8');
const faltan = [];
plantilla = plantilla.replace(/«(\w+)»/g, (m, k) => { if (!(k in V)) { faltan.push(k); return m; } return String(V[k]); });
if (faltan.length) throw new Error('Faltan valores en la plantilla: ' + [...new Set(faltan)].join(', '));
plantilla = plantilla.replace(/^% NO SE EDITA A MANO.*\n%.*\n/m, '% NO SE EDITA A MANO: este archivo sale de plan.plantilla.tex con\n');
fs.writeFileSync(path.join(LATEX, 'plan-primer-anio-alfa.tex'), plantilla);

execFileSync('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'plan-primer-anio-alfa.tex'], { cwd: LATEX, stdio: 'ignore' });
fs.copyFileSync(path.join(LATEX, 'plan-primer-anio-alfa.pdf'), path.join(AQUI, 'plan-primer-anio-alfa.pdf'));
console.log('Listo: plan-financiero/plan-primer-anio-alfa.pdf');
