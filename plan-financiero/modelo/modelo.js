// Modelo financiero de COOP-R14: Plan del Primer Año, versión alfa.
//
// Un solo archivo para Node y para el navegador. En Node:
//   const { simular, SUPUESTOS } = require('./modelo');
//   const r = simular({ precio: 0.6 });
// En el navegador queda como window.CoopModelo.
//
// Todo número que cambia el resultado está en SUPUESTOS. Los meses se
// cuentan desde diciembre de 2026 (mes 0) hasta marzo de 2028 (mes 15).
(function (raiz) {
  'use strict';

  const SUPUESTOS = {
    // Precio y mercado
    precio: 0.50,              // S/ por unidad por día
    precioIncluyeIGV: true,    // false: se cobra precio + IGV
    unidadesPorRuta: 40,
    utilizacion: 1.0,          // fracción de unidades-día que se cobran
    rutasPrueba: 2,            // rutas gratis de diciembre de 2026
    eneroPagaCompleto: true,   // las rutas de enero pagan el mes entero
    fraccionMesNuevas: 0.5,    // una ruta nueva paga esta fracción en su primer mes
    mesGratisNuevas: false,    // cada ruta nueva no paga su primer mes
    techoLocal: 60,            // rutas de Juliaca + Puno
    rutasParaPuno: 26,         // desde aquí se vende también en Puno
    pausaMeses: 4,             // meses sin firmar al llenar Juliaca + Puno
    ciudadGrande: true,        // después de la pausa se vende en Arequipa o Cusco
    costoCiudadGrande: 1500,   // S/ al mes de viajes y estadía, desde la pausa
    viajesPuno: 500,           // S/ al mes desde que se vende en Puno

    // Capacidad de venta: rutas por mes de cada persona
    rutasDueno: 4,             // tú, mientras vendes
    duenoVendeDesde: 1,        // enero de 2027
    duenoVendeHasta: 3,        // deja de vender en marzo de 2027
    rampaTiempoCompleto: [1, 4],
    rampaMedioTiempo: [1, 2],

    // Equipo: mes de entrada (0 = dic-26, 1 = ene-27, ...)
    vendedorA_medioDesde: 0,   // A empieza a medio tiempo
    vendedorA_completoDesde: 1,// y pasa a tiempo completo
    vendedorB_desde: 2,        // B, medio tiempo
    vendedorD_desde: 3,        // D, tiempo completo: te reemplaza en ventas
    oficina_desde: 4,          // medio tiempo de oficina
    oficinaVende: false,
    sueldoTiempoCompleto: 1400,
    sueldoMedioTiempo: 700,
    comisionPorRuta: 200,      // solo por las rutas que traen los vendedores
    cargasSociales: 0.10,      // EsSalud 9 % + Vida Ley 1 %
    sueldoDueno: 2000,         // tu sueldo como programador
    duenoCobraDesde: 7,        // julio de 2027

    // Gastos
    alquiler: 500,
    alquilerDesde: 1,          // diciembre es en oficina prestada
    garantiaAlquiler: 1000,
    suscripcionIA: 400,
    licenciaPorPersona: 25,
    contador: 350,
    contadorDesdeMes6: 500,
    marketingFijo: 300,
    kitPorRuta: 150,
    movilidadPorPersona: 150,
    celular: 700,
    planDatos: 50,
    laptop: 2200,
    escritorio: 650,
    acondicionamientoOficina: 1500,
    constitucionYAbogado: 1600,
    licenciaMunicipal: 400,
    imprevistos: 0.05,
    tipoCambio: 3.75,
    colchonInfraestructura: 1.25,

    // Cobranza
    cobroAdelantado: false,    // true: se factura a inicio de mes
    cobroMes1: 0.95,
    cobroMes2: 0.03,
    incobrable: 0.02,

    // Impuestos
    uit: 5500,
    igv: 0.18,

    // Rutas reales: si un mes tiene número, reemplaza a la capacidad
    rutasReales: [],
    meses: 16,
  };

  const NOMBRES_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Costo de servidor y mapas en dólares al mes, sacado de modelo-costos.js
  // con 40 unidades por ruta.
  function infraestructuraUSD(rutas) {
    if (rutas <= 2) return 50;
    if (rutas <= 14) return 50 + (rutas - 2) * (152 - 50) / 12;
    return 211 + (rutas - 18) * 7.3;
  }

  function simular(cambios) {
    const P = Object.assign({}, SUPUESTOS, cambios || {});
    const IGV = P.igv;
    const rampa = (arr, k) => arr[Math.min(k, arr.length - 1)];

    // 1. Meses
    const meses = [];
    for (let i = 0; i < P.meses; i++) {
      const m = (11 + i) % 12, a = 2026 + Math.floor((11 + i) / 12);
      meses.push({ i, mes: NOMBRES_MES[m] + '-' + String(a).slice(2), dias: new Date(a, m + 1, 0).getDate(), anio: a });
    }

    // 2. Rutas: quién trae cuántas cada mes
    const rutas = [], aportes = [];
    let pausaDesde = null, pausaHasta = null;
    for (let i = 0; i < P.meses; i++) {
      const v = {
        tu: (i >= P.duenoVendeDesde && i < P.duenoVendeHasta) ? P.rutasDueno : 0,
        a: i >= P.vendedorA_completoDesde ? rampa(P.rampaTiempoCompleto, i - P.vendedorA_completoDesde) : 0,
        b: i >= P.vendedorB_desde ? rampa(P.rampaMedioTiempo, i - P.vendedorB_desde) : 0,
        d: i >= P.vendedorD_desde ? rampa(P.rampaTiempoCompleto, i - P.vendedorD_desde) : 0,
        c: (P.oficinaVende && i >= P.oficina_desde) ? rampa(P.rampaMedioTiempo, i - P.oficina_desde) : 0,
      };
      if (i === 0) { v.tu = v.a = v.b = v.d = v.c = 0; }
      const enPausa = pausaDesde !== null && i >= pausaDesde && (i < pausaHasta || !P.ciudadGrande);
      if (enPausa) { v.tu = v.a = v.b = v.d = v.c = 0; v.pausa = true; }
      v.total = i === 0 ? P.rutasPrueba : v.tu + v.a + v.b + v.d + v.c;
      const real = P.rutasReales[i];
      if (real !== undefined && real !== null && real !== '' && !isNaN(real)) { v.real = true; v.total = Number(real); }
      const previas = i ? rutas[i - 1] : 0;
      let r = previas + v.total;
      if (pausaDesde === null && i > 0 && r >= P.techoLocal) {
        if (!v.real) {
          let sobra = r - P.techoLocal;
          for (const k of ['c', 'b', 'd', 'a', 'tu']) { const q = Math.min(sobra, v[k]); v[k] -= q; sobra -= q; }
          v.total = P.techoLocal - previas; r = P.techoLocal;
        }
        pausaDesde = i + 1; pausaHasta = i + 1 + P.pausaMeses;
      }
      rutas.push(r); aportes.push(v);
    }

    // 3. Mes a mes
    const filas = [];
    let caja = 0, cajaMin = 0, mesCajaMin = meses[0].mes, saldoIGV = 0, igvPorPagar = 0, pacPorPagar = 0;
    let utilAnio = 0, rentaAnio = 0, perdidaArrastre = 0, renta2027 = null;
    const facturado = [], laptops = [], antes = {};
    for (let i = 0; i < P.meses; i++) {
      const { mes, dias, anio } = meses[i];
      const R = rutas[i], ap = aportes[i], nuevas = ap.total;
      const cobra = i >= 1;

      // Equipo en jornadas
      const vend = (i >= P.vendedorA_completoDesde ? 1 : i >= P.vendedorA_medioDesde ? 0.5 : 0)
        + (i >= P.vendedorB_desde ? 0.5 : 0) + (i >= P.vendedorD_desde ? 1 : 0);
      const personasVenta = (i >= P.vendedorA_medioDesde ? 1 : 0) + (i >= P.vendedorB_desde ? 1 : 0) + (i >= P.vendedorD_desde ? 1 : 0);
      const equipo = { vendedores: vend, personasVenta, oficina: i >= P.oficina_desde ? 0.5 : 0, dueno: (P.sueldoDueno > 0 && i >= P.duenoCobraDesde) ? 1 : 0 };
      const contratados = personasVenta + (equipo.oficina ? 1 : 0);
      const altas = Math.max(0, contratados - (antes.contratados || 0));
      antes.contratados = contratados;
      const enPlanilla = contratados + equipo.dueno;
      const enOficina = contratados + 1; // tú siempre

      // Ingresos
      let completas = 0, medias = 0;
      if (cobra) {
        if (i === 1 && P.eneroPagaCompleto) completas = R;
        else { completas = rutas[i - 1]; medias = P.mesGratisNuevas ? 0 : nuevas * P.fraccionMesNuevas; }
      }
      const precioConIGV = P.precioIncluyeIGV ? P.precio : P.precio * (1 + IGV);
      const porRuta = P.unidadesPorRuta * P.utilizacion * precioConIGV * dias;
      const ventaConIGV = (completas + medias) * porRuta;
      const venta = ventaConIGV / (1 + IGV);

      // Gastos, con su desglose
      const L = {}, D = {}, credito = {};
      const add = (grupo, monto, conIGV, detalle) => {
        if (!monto) return;
        const neto = conIGV ? monto / (1 + IGV) : monto;
        L[grupo] = (L[grupo] || 0) + neto;
        if (conIGV) credito[grupo] = (credito[grupo] || 0) + monto - neto;
        const d = detalle || grupo; D[grupo] = D[grupo] || {}; D[grupo][d] = (D[grupo][d] || 0) + neto;
      };
      const sVend = (i >= P.vendedorA_completoDesde ? P.sueldoTiempoCompleto : i >= P.vendedorA_medioDesde ? P.sueldoMedioTiempo : 0)
        + (i >= P.vendedorB_desde ? P.sueldoMedioTiempo : 0) + (i >= P.vendedorD_desde ? P.sueldoTiempoCompleto : 0);
      const sOfi = equipo.oficina ? P.sueldoMedioTiempo : 0;
      const sDueno = equipo.dueno ? P.sueldoDueno : 0;
      const comision = P.comisionPorRuta * (i === 0 ? nuevas : Math.max(0, nuevas - ap.tu));
      add('Sueldos y comisiones', sVend, false, 'Vendedores');
      add('Sueldos y comisiones', sOfi, false, 'Asistente de oficina');
      add('Sueldos y comisiones', sDueno, false, 'Tú (programación)');
      add('Sueldos y comisiones', comision, false, 'Comisiones por ruta firmada');
      add('Cargas sociales', sVend * P.cargasSociales, false, 'Vendedores');
      add('Cargas sociales', sOfi * P.cargasSociales, false, 'Asistente de oficina');
      add('Cargas sociales', sDueno ? Math.max(sDueno, 1130) * 0.09 + sDueno * 0.01 : 0, false, 'Tú (programación)');
      add('Cargas sociales', comision * P.cargasSociales, false, 'Sobre las comisiones');
      const infra = infraestructuraUSD(R) * P.tipoCambio;
      add('Infraestructura', infra, false, 'Servidor y mapas');
      add('Infraestructura', infra * (P.colchonInfraestructura - 1), false, 'Colchón por incertidumbre');
      add('IA y software', P.suscripcionIA, false, 'Suscripción de IA');
      add('IA y software', P.licenciaPorPersona * enPlanilla, false, 'Licencias por persona en planilla');
      const enLocal = i >= P.alquilerDesde;
      add('Alquiler de oficina', enLocal ? P.alquiler : 0, false);
      add('Servicios de oficina', enLocal ? (enOficina > 6 ? 180 : 120) : 0, true, 'Internet');
      add('Servicios de oficina', enLocal ? 60 + 12 * enOficina : 0, true, 'Luz, agua y arbitrios');
      add('Servicios de oficina', enLocal ? 40 + 10 * enOficina : 0, true, 'Mantenimiento y limpieza');
      add('Planes de datos', P.planDatos * contratados, true, 'Celulares del personal contratado');
      add('Movilidad y viajes', P.movilidadPorPersona * personasVenta, false, 'Movilidad de vendedores');
      add('Movilidad y viajes', equipo.oficina ? P.movilidadPorPersona : 0, false, 'Movilidad del asistente de oficina');
      add('Movilidad y viajes', R >= P.rutasParaPuno ? P.viajesPuno : 0, false, 'Viajes a Puno');
      const enCiudadGrande = P.ciudadGrande && pausaDesde !== null && i >= pausaDesde;
      add('Ciudad grande', enCiudadGrande ? P.costoCiudadGrande : 0, false, i < pausaHasta ? 'Preparación de Arequipa o Cusco' : 'Viajes para vender en Arequipa o Cusco');
      add('Marketing y rutas nuevas', P.marketingFijo, true, 'Material y publicidad');
      add('Marketing y rutas nuevas', P.kitPorRuta * nuevas, true, 'Kits de entrada');
      add('Contador externo', i < 6 ? P.contador : P.contadorDesdeMes6, false);
      add('Equipos menores', P.celular * altas, true, 'Celulares del personal nuevo');
      add('Equipos menores', i === P.alquilerDesde ? P.escritorio * enOficina : (i > P.alquilerDesde ? P.escritorio * altas : 0), true, 'Escritorios y sillas');
      add('Equipos menores', i === P.alquilerDesde ? P.acondicionamientoOficina : 0, true, 'Acondicionamiento de la oficina');
      add('Trámites y legal', i === 0 ? P.constitucionYAbogado : 0, false, 'Constitución de la EIRL y abogado');
      add('Trámites y legal', i === P.alquilerDesde ? P.licenciaMunicipal : 0, false, 'Licencia municipal e ITSE');
      add('Útiles y bancos', 30 + 20 * enOficina, true, 'Artículos de oficina');
      add('Útiles y bancos', 40, false, 'Bancos');
      const subtotal = Object.values(L).reduce((s, x) => s + x, 0);
      add('Imprevistos', subtotal * P.imprevistos, false);

      const compraLaptops = P.laptop * altas;
      if (compraLaptops) laptops.push(compraLaptops / (1 + IGV));
      const depreciacion = laptops.reduce((s, x) => s + x, 0) * 0.25 / 12;
      const incobrable = venta * P.incobrable;
      const gastos = Object.values(L).reduce((s, x) => s + x, 0);
      const ebitda = venta - incobrable - gastos;
      const utilOper = ebitda - depreciacion;

      // Renta: Régimen MYPE Tributario
      let renta = 0;
      if (anio === 2026) perdidaArrastre += utilOper;
      else {
        if (meses[i].mes.startsWith('ene') && i > 1) {
          renta2027 = rentaAnio; const r = utilAnio + Math.min(0, perdidaArrastre);
          perdidaArrastre = r < 0 ? r : 0; utilAnio = 0; rentaAnio = 0;
        }
        utilAnio += utilOper;
        const base = Math.max(0, utilAnio + Math.min(0, perdidaArrastre));
        const t = Math.min(base, 15 * P.uit) * 0.10 + Math.max(0, base - 15 * P.uit) * 0.295;
        renta = t - rentaAnio; rentaAnio = t;
      }

      // IGV
      const igvCompras = Object.values(credito).reduce((s, x) => s + x, 0);
      const debito = venta * IGV, creditoMes = igvCompras + compraLaptops - compraLaptops / (1 + IGV);
      let igvMes = debito - creditoMes - saldoIGV;
      if (igvMes < 0) { saldoIGV = -igvMes; igvMes = 0; } else saldoIGV = 0;

      // Caja
      facturado.push(ventaConIGV);
      const cobro1 = P.cobroAdelantado ? facturado[i] * P.cobroMes1 : (facturado[i - 1] || 0) * P.cobroMes1;
      const cobro2 = P.cobroAdelantado ? (facturado[i - 1] || 0) * P.cobroMes2 : (facturado[i - 2] || 0) * P.cobroMes2;
      const pagosOperativos = gastos + igvCompras;
      const garantia = i === P.alquilerDesde ? P.garantiaAlquiler : 0;
      const pagaIGV = igvPorPagar, pagaAdelanto = pacPorPagar;
      igvPorPagar = igvMes; pacPorPagar = venta * 0.01;
      const adelantos2027 = filas.filter(f => f.anio === 2027).reduce((s, f) => s + f.venta * 0.01, 0);
      const pagaRentaAnual = (meses[i].mes === 'mar-28' && renta2027 !== null) ? Math.max(0, renta2027 - adelantos2027) : 0;
      const flujoOperativo = cobro1 + cobro2 - pagosOperativos - pagaIGV - pagaAdelanto - pagaRentaAnual;
      const flujoInversion = -compraLaptops - garantia;
      const flujo = flujoOperativo + flujoInversion;
      caja += flujo;
      if (caja < cajaMin) { cajaMin = caja; mesCajaMin = mes; }

      filas.push({
        i, mes, dias, anio, rutas: R, nuevas, aportes: ap, unidades: R * P.unidadesPorRuta,
        ciudades: (R >= P.rutasParaPuno ? 2 : 1) + (P.ciudadGrande && pausaHasta !== null && i >= pausaHasta ? 1 : 0), enPausa: !!ap.pausa, equipo,
        rutasCompletas: completas, rutasMedias: medias, ventaCompletas: completas * porRuta / (1 + IGV), ventaMedias: medias * porRuta / (1 + IGV),
        ventaConIGV, venta, incobrable, gastos: L, desglose: D, totalGastos: gastos, ebitda, depreciacion, utilOper, renta, utilNeta: utilOper - renta,
        cobro1, cobro2, cobros: cobro1 + cobro2, pagosOperativos, igvCompras, pagaIGV, pagaAdelanto, pagaRentaAnual,
        flujoOperativo, compraLaptops, garantia, flujoInversion, flujo, caja,
      });
    }

    const de = a => filas.filter(f => f.anio === a);
    const suma = (arr, k) => arr.reduce((s, f) => s + f[k], 0);
    const ultimo = filas[filas.length - 1];
    const gananciaSostenida = filas.find((f, i) => i > 0 && filas.slice(i).every(g => g.utilOper > 0));
    const cajaPositiva = filas.find((f, i) => f.caja > 0 && filas.slice(i).every(g => g.caja > 0));
    return {
      supuestos: P, filas,
      resumen: {
        cajaMinima: cajaMin, mesCajaMinima: mesCajaMin, cajaFinal: ultimo.caja,
        ventas2027: suma(de(2027), 'venta'), utilidad2027: suma(de(2027), 'utilOper'), utilidad2026: suma(de(2026), 'utilOper'),
        renta2027: renta2027 !== null ? renta2027 : rentaAnio, adelantos2027: suma(de(2027), 'venta') * 0.01,
        saldoRenta2027: suma(filas, 'pagaRentaAnual'),
        ganaDesde: gananciaSostenida ? gananciaSostenida.mes : null,
        cajaPositivaDesde: cajaPositiva ? cajaPositiva.mes : null,
        llenoLocal: pausaDesde !== null ? filas[pausaDesde - 1].mes : null,
        pausa: pausaDesde !== null && pausaDesde < P.meses ? { desde: filas[pausaDesde].mes, hasta: filas[Math.min(pausaHasta, P.meses) - 1].mes } : null,
        porCobrar: facturado[P.meses - 1] * (P.cobroMes1 + P.cobroMes2) + facturado[P.meses - 2] * P.cobroMes2,
        igvPorPagar,
      },
    };
  }

  const api = { simular, SUPUESTOS, infraestructuraUSD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.CoopModelo = api;
})(typeof window !== 'undefined' ? window : this);
