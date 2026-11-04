// Un ZIP armado a mano, sin librerías (PENDIENTES 0.14, 04/11).
//
// Para entregarle a una persona todo lo que el sistema tiene de ella: varios
// CSV, sus fotos y sus notas de voz en un solo archivo. El formato ZIP es
// chico de escribir —cabecera local, datos, directorio central, fin— y Node
// trae lo que hace falta: `deflateRawSync` y `crc32` (Node 22). El lector es
// el de `planilla.js`, que se usa en la prueba para leerlo de vuelta.
'use strict';

const zlib = require('zlib');

// Fecha y hora en el formato de MS-DOS que piden las cabeceras (hora local)
function fechaDos(d = new Date()) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const fecha = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, fecha };
}

// archivos: [{ nombre: 'turnos.csv', datos: Buffer | string }]
function crearZip(archivos, { cuando = new Date() } = {}) {
  const { hora, fecha } = fechaDos(cuando);
  const locales = [], centrales = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(String(a.datos), 'utf8');
    const crc = zlib.crc32(datos) >>> 0;
    // Lo que ya viene comprimido (una foto JPEG, un audio) se guarda tal
    // cual: comprimirlo de nuevo gasta tiempo y no achica nada
    const yaComprimido = /\.(jpe?g|png|webp|m4a|mp4|aac|mp3|ogg|webm)$/i.test(a.nombre);
    const comprimido = yaComprimido ? datos : zlib.deflateRawSync(datos);
    const metodo = yaComprimido ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // versión necesaria
    local.writeUInt16LE(0x0800, 6);          // nombres en UTF-8 (tildes)
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);            // hecho por
    central.writeUInt16LE(20, 6);            // versión necesaria
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);
    desplazamiento += 30 + nombre.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

module.exports = { crearZip };
