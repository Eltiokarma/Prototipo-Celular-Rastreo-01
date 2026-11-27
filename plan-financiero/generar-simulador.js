#!/usr/bin/env node
// Arma simulador.html: mete modelo/modelo.js dentro de simulador.src.html
// para que el simulador sea un solo archivo que se abre con doble clic.
//
//   node plan-financiero/generar-simulador.js [ruta-de-salida-sin-envoltura]
const fs = require('fs');
const path = require('path');
const aqui = __dirname;
const modelo = fs.readFileSync(path.join(aqui, 'modelo', 'modelo.js'), 'utf8');
const cuerpo = fs.readFileSync(path.join(aqui, 'simulador.src.html'), 'utf8').replace('/*MODELO*/', () => modelo);
const completo = `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${cuerpo}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(aqui, 'simulador.html'), completo);
if (process.argv[2]) fs.writeFileSync(process.argv[2], cuerpo);
console.log('Listo: simulador.html');
