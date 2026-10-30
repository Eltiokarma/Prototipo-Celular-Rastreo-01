// La cooperativa de demostración del manual. Inventada de punta a punta:
// los nombres, las placas y el RUC no son de nadie.
//
// Las rutas son calles de verdad de Juliaca (sacadas de OSM con un ruteador,
// en `rutas-demo.json`) para que las capturas se vean como se ve el sistema
// en la calle, y no un anillo dibujado a mano.
'use strict';

module.exports = {
  CLAVE_CREADOR: 'creador-manual-2026',
  EMPRESA: 'ALTIPLANO',
  NOMBRE_EMPRESA: 'Transportes Altiplano',
  RUC: '20601234567',
  CONTACTO: 'Jr. Moquegua 410 · 951 000 111',
  DESPACHO: 'despacho-alt',
  CLAVE_DESPACHO: 'despacho-alt-2026',
  GERENTE: 'gerencia-alt',
  CLAVE_GERENTE: 'gerencia-alt-2026',
  CLAVE_CHOFER: 'chofer2026',

  RUTAS: {
    '18A': { nombre: 'Norte ⇄ Taparachi', objetivoMin: 6, duracionMin: 50 },
    '18B': { nombre: 'Oeste ⇄ Santa Bárbara', objetivoMin: 15, duracionMin: 60 },
  },

  VEHICULOS: [
    { id: 'M-01', placa: 'Z1A-701', ruta: '18A' }, { id: 'M-02', placa: 'Z1A-702', ruta: '18A' },
    { id: 'M-03', placa: 'Z1A-703', ruta: '18A' }, { id: 'M-04', placa: 'Z1A-704', ruta: '18A' },
    { id: 'M-05', placa: 'Z1A-705', ruta: '18A' }, { id: 'M-06', placa: 'Z1A-706', ruta: '18A' },
    { id: 'M-07', placa: 'Z1A-707', ruta: '18A' }, { id: 'M-08', placa: 'Z1A-708', ruta: '18A' },
    { id: 'M-21', placa: 'Z1B-221', ruta: '18B' }, { id: 'M-22', placa: 'Z1B-222', ruta: '18B' },
    { id: 'M-23', placa: 'Z1B-223', ruta: '18B' }, { id: 'M-24', placa: 'Z1B-224', ruta: '18B' },
  ],

  // Rufino es el protagonista: su teléfono es el navegador del manual.
  PERSONAS: [
    { usuario: 'ch-rufino', nombre: 'Rufino Quispe Mamani', alias: 'Rufo', rol: 'driver', combi: 'M-01', ruta: '18A' },
    { usuario: 'ch-elmer', nombre: 'Elmer Ccama Huanca', rol: 'driver', combi: 'M-02', ruta: '18A' },
    { usuario: 'ch-julia', nombre: 'Julia Mamani Colque', rol: 'driver', combi: 'M-03', ruta: '18A' },
    { usuario: 'ch-wilber', nombre: 'Wilber Apaza Ticona', rol: 'driver', combi: 'M-04', ruta: '18A' },
    { usuario: 'ch-nilda', nombre: 'Nilda Arapa Cutipa', rol: 'driver', combi: 'M-05', ruta: '18A' },
    { usuario: 'ch-fredy', nombre: 'Fredy Choquehuanca Pari', alias: 'Choque', rol: 'driver', combi: 'M-06', ruta: '18A' },
    { usuario: 'ch-rosa', nombre: 'Rosa Ticona Larico', rol: 'driver', combi: 'M-07', ruta: '18A' },
    { usuario: 'ch-edwin', nombre: 'Edwin Larico Vilca', rol: 'driver', combi: 'M-08', ruta: '18A' },
    { usuario: 'ch-gladys', nombre: 'Gladys Chambi Turpo', rol: 'driver', combi: 'M-21', ruta: '18B' },
    { usuario: 'ch-hernan', nombre: 'Hernán Coaquira Machaca', rol: 'driver', combi: 'M-22', ruta: '18B' },
    { usuario: 'ch-lucio', nombre: 'Lucio Vilca Sucasaca', rol: 'driver', combi: 'M-23', ruta: '18B' },
    { usuario: 'ch-delia', nombre: 'Delia Machaca Aroquipa', rol: 'driver', combi: 'M-24', ruta: '18B' },
    // El suplente de M-02: entra por la web y se queda en la puerta, para
    // que el panel muestre «entró y no salió a ruta» y el aviso del vigía.
    // No maneja en la flota ni tiene historial.
    { usuario: 'ch-ruben', nombre: 'Rubén Condori Ticona', rol: 'driver', combi: 'M-02', ruta: '18A', suplente: true },
    { usuario: 'co-yeny', nombre: 'Yeny Apaza Condori', rol: 'collector', combi: 'M-01', ruta: '18A' },
    { usuario: 'co-saturnino', nombre: 'Saturnino Pari Chambi', rol: 'collector', combi: 'M-03', ruta: '18A' },
  ],

  // Dónde arranca cada combi (fracción del circuito: la ida primero, después
  // la vuelta), a cuántos km/h, y si hace algo raro. Elegido para que en una
  // misma pantalla se vean los casos que el manual explica: brechas en
  // objetivo y al límite, una fuera del recorrido, una sin señal, una en
  // tráfico y una ausente.
  FLOTA: {
    'M-01': { desde: 0.14, kmh: 24 },                   // Rufino (el navegador)
    'M-02': { desde: 0.02, kmh: 24 },
    'M-03': { desde: 0.26, kmh: 24 },
    'M-05': { desde: 0.36, kmh: 24 },
    'M-04': { desde: 0.60, kmh: 24, raro: 'fuera' },
    'M-06': { desde: 0.70, kmh: 24, raro: 'muda' },
    'M-08': { desde: 0.86, kmh: 22, raro: 'trafico' },
    'M-07': { desde: 0.00, kmh: 0, raro: 'ausente' },
    'M-21': { desde: 0.05, kmh: 24 }, 'M-22': { desde: 0.30, kmh: 24 },
    'M-23': { desde: 0.55, kmh: 24 }, 'M-24': { desde: 0.80, kmh: 24 },
  },
};
