'use strict';
// Leer una planilla para el alta de muchas personas de una vez (PENDIENTES
// 0.7, 04/11). Lo que la cooperativa tiene a mano es una planilla: de Excel,
// de LibreOffice, de Google Sheets, o un CSV que sacó de otro sistema. Se
// aceptan todas, sin dependencias (cada librería de planillas es un riesgo y
// un peso más en el servidor):
//
//   - CSV, con coma o con punto y coma (el Excel en castellano guarda con
//     «;»), y TSV; en UTF-8 o en el Windows-1252 que deja el Excel viejo;
//   - el texto que queda al copiar celdas de Excel o Google Sheets y pegar
//     (va separado por tabulaciones);
//   - .xlsx (Excel) y .ods (LibreOffice, y lo que exporta Google Sheets): los
//     dos son un ZIP con XML adentro, que se abre con el `zlib` de Node;
//   - .xls, el formato viejo de Excel (binario): se reconoce y se dice cómo
//     guardarlo, en vez de devolver basura.
//
// Devuelve las filas como listas de textos, tal cual; qué columna es qué lo
// decide quien llama (ver `index.js`, el alta masiva). Tira Error con un
// mensaje para mostrar.
const zlib = require('zlib');

const MAX_DESCOMPRIMIDO = 20 * 1024 * 1024;   // un ZIP que se infla más que esto no es una planilla
const MAX_FILAS = 2000;
const MAX_COLUMNAS = 200;

// ─── ZIP ─────────────────────────────────────────────────────
// Lo justo para leer un archivo de adentro: el directorio central al final,
// y cada entrada guardada (0) o comprimida con deflate (8).
function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo parece una planilla pero está dañado (no se pudo abrir)');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entradas = new Map();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28), largoExtra = buf.readUInt16LE(p + 30), largoComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    entradas.set(nombre, { metodo, comprimido, local });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return {
    nombres: () => [...entradas.keys()],
    leer(nombre) {
      const e = entradas.get(nombre);
      if (!e) return null;
      const inicio = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const datos = buf.subarray(inicio, inicio + e.comprimido);
      if (e.metodo === 0) return datos.toString('utf8');
      if (e.metodo === 8) return zlib.inflateRawSync(datos, { maxOutputLength: MAX_DESCOMPRIMIDO }).toString('utf8');
      throw new Error('La planilla usa una compresión que no se puede leer: guardala de nuevo como .xlsx o CSV');
    },
  };
}

const entidades = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// El texto de un nodo, juntando sus <t> (xlsx) o <text:p> y <text:span> (ods)
const textoDe = (xml, etiqueta) => {
  const partes = [];
  const re = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, 'g');
  let m;
  while ((m = re.exec(xml))) partes.push(entidades(m[1].replace(/<[^>]+>/g, '')));
  return partes.join('');
};

// ─── XLSX ────────────────────────────────────────────────────
// La primera hoja del libro. Los textos viven en sharedStrings y la celda
// guarda su número; las celdas vacías no figuran (por eso la columna sale de
// la referencia: «C7» es la tercera).
function columna(ref) {
  const letras = /^([A-Z]+)/.exec(ref || '');
  if (!letras) return null;
  let n = 0;
  for (const ch of letras[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function leerXlsx(buf) {
  const zip = leerZip(buf);
  const libro = zip.leer('xl/workbook.xml');
  if (!libro) throw new Error('No es un libro de Excel (.xlsx) válido');
  const primera = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro) || /<sheet\b[^>]*\bid="([^"]+)"/.exec(libro);
  let ruta = 'xl/worksheets/sheet1.xml';
  const rels = zip.leer('xl/_rels/workbook.xml.rels');
  if (primera && rels) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${primera[1]}"[^>]*Target="([^"]+)"`).exec(rels)
      || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${primera[1]}"`).exec(rels);
    if (rel) ruta = rel[1].startsWith('/') ? rel[1].slice(1) : 'xl/' + rel[1].replace(/^\.\//, '');
  }
  const hoja = zip.leer(ruta);
  if (!hoja) throw new Error('El libro de Excel no tiene hojas');
  const compartidos = [];
  const sst = zip.leer('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidos.push(textoDe(m[1], 't'));
  const filas = [];
  for (const fm of hoja.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    // Una fila OCULTA (o filtrada) no se importa: suele ser justo la gente
    // que la cooperativa escondió porque ya no está, y se daba de alta igual
    // (auditoría 11/11). Va vacía y no salteada, para que los números de
    // fila que ve Despacho sigan siendo los de su Excel.
    if (/\bhidden="(1|true)"/.test(fm[1])) { filas.push(fila); continue; }
    for (const cm of fm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], cuerpo = cm[2] || '';
      const col = columna((/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1]) ?? fila.length;
      // El tope ANTES de asignar: `r="ZZZZZ1"` es la columna 12 millones, y
      // asignarla primero armaba un arreglo de ese tamaño por fila —una
      // planilla de 628 bytes tiraba el proceso por memoria (revisión del
      // 04/11)—. Más allá de la columna 200 no hay nada que importar.
      if (col == null || col > MAX_COLUMNAS) continue;
      const tipo = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(cuerpo) || [])[1];
      let valor = '';
      if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo, 't');
      else if (v !== undefined) valor = entidades(v);
      if (tipo === 'b') valor = valor === '1' ? 'VERDADERO' : 'FALSO';
      fila[col] = valor;
    }
    filas.push(Array.from(fila, x => x ?? ''));
    if (filas.length > MAX_FILAS) break;
  }
  return filas;
}

// ─── ODS ─────────────────────────────────────────────────────
// La primera tabla de content.xml. LibreOffice comprime las celdas y filas
// vacías repetidas con `number-columns-repeated` / `number-rows-repeated`
// (una hoja «vacía» declara un millón de filas): se expanden con tope.
function leerOds(buf) {
  const zip = leerZip(buf);
  const contenido = zip.leer('content.xml');
  if (!contenido) throw new Error('No es una hoja de cálculo .ods válida');
  const tabla = /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/.exec(contenido);
  if (!tabla) throw new Error('La hoja de cálculo no tiene tablas');
  const filas = [];
  for (const fm of tabla[1].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const fila = [];
    // Oculta o filtrada: vacía, como en el .xlsx (ver arriba)
    if (/table:visibility="(collapse|filter)"/.test(fm[1])) {
      const repetidaOculta = Math.min(Number((/number-rows-repeated="(\d+)"/.exec(fm[1]) || [])[1] || 1), 50);
      for (let i = 0; i < repetidaOculta; i++) filas.push([]);
      continue;
    }
    for (const cm of (fm[2] || '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const veces = Math.min(Number((/number-columns-repeated="(\d+)"/.exec(cm[1]) || [])[1] || 1), 50);
      const valor = cm[2] ? textoDe(cm[2], 'text:p') : '';
      for (let i = 0; i < veces && fila.length <= MAX_COLUMNAS; i++) fila.push(valor);
      if (fila.length > MAX_COLUMNAS) break;
    }
    while (fila.length && fila[fila.length - 1] === '') fila.pop();
    const repetida = Math.min(Number((/number-rows-repeated="(\d+)"/.exec(fm[1]) || [])[1] || 1), fila.length ? 50 : 1);
    for (let i = 0; i < repetida; i++) filas.push(fila.slice());
    if (filas.length > MAX_FILAS) break;
  }
  return filas;
}

// ─── TEXTO: CSV, TSV, PEGADO ─────────────────────────────────
// El separador sale de la primera línea con algo: tabulación (pegado de una
// planilla), punto y coma (Excel en castellano) o coma. Con comillas a la
// manera de CSV (las comillas dobles se duplican adentro).
function leerTexto(texto) {
  texto = String(texto || '').replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/).find(l => l.trim()) || '';
  const cuenta = (c) => primera.split(c).length - 1;
  const sep = cuenta('\t') > 0 ? '\t' : cuenta(';') > cuenta(',') ? ';' : ',';
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === '') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
      if (filas.length > MAX_FILAS) break;
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// Bytes de un archivo de texto → texto. UTF-8 si lo es; si no, el
// Windows-1252 del Excel viejo (las «ñ» y tildes salían como «�»).
function decodificar(buf) {
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return buf.toString('latin1');
}

// La entrada: los bytes del archivo (con su nombre, si se sabe) o el texto
// pegado. Se decide por el contenido, no por el nombre: un .csv que en
// realidad es un .xlsx renombrado se lee igual.
function leerPlanilla({ bytes = null, nombre = '', texto = null } = {}) {
  let filas;
  if (texto != null) filas = leerTexto(texto);
  else {
    if (!bytes || !bytes.length) throw new Error('El archivo está vacío');
    const ext = String(nombre).toLowerCase().split('.').pop();
    if (bytes.readUInt32BE(0) === 0xD0CF11E0) {
      // Es un contenedor OLE2: el .xls viejo, o un .xlsx protegido con
      // contraseña (Excel los cifra adentro de uno de éstos)
      throw new Error('Ese es el formato viejo de Excel (.xls), o una planilla protegida con contraseña. Abrila en Excel, sacale la contraseña si tiene, y guardala como «Libro de Excel (.xlsx)» o como CSV');
    }
    if (bytes.readUInt32LE(0) === 0x04034b50) {
      const zip = leerZip(bytes);
      const nombres = zip.nombres();
      if (nombres.includes('xl/workbook.xml')) filas = leerXlsx(bytes);
      else if (nombres.includes('content.xml')) filas = leerOds(bytes);
      else throw new Error('Ese archivo comprimido no es una planilla (.xlsx u .ods)');
    } else if (['numbers', 'pdf', 'doc', 'docx'].includes(ext)) {
      throw new Error('Ese formato no es una planilla que se pueda leer. Guardala como .xlsx, .ods o CSV');
    } else {
      filas = leerTexto(decodificar(bytes));
    }
  }
  // Sin filas vacías y con los espacios recortados
  filas = filas.map(f => f.map(c => String(c ?? '').trim())).filter(f => f.some(c => c !== ''));
  if (filas.length > MAX_FILAS) throw new Error(`La planilla tiene más de ${MAX_FILAS} filas: partila en varias`);
  return filas;
}

// La planilla la manda cualquiera con una cuenta de Despacho, y el lector
// es código propio sobre expresiones regulares: un archivo armado a propósito
// (o simplemente dañado) puede pedir memoria o tiempo sin fin. Por eso se lee
// en un hilo APARTE, con techo de memoria y de tiempo: si se pasa, muere ese
// hilo y el servidor sigue — el GPS, el SOS y las demás cooperativas no se
// enteran (revisión del 04/11: un .xlsx de 628 bytes tiraba el proceso, y uno
// de 2 kB lo congelaba 14 s).
const LECTOR_MEMORIA_MB = 256;
const LECTOR_TIEMPO_MS = Number(process.env.PLANILLA_TIEMPO_MS || 5000);
function leerPlanillaAislada(entrada) {
  const { Worker } = require('worker_threads');
  return new Promise((resolver, rechazar) => {
    const w = new Worker(__filename, {
      workerData: { entrada: { ...entrada, bytes: entrada.bytes ? new Uint8Array(entrada.bytes) : null } },
      resourceLimits: { maxOldGenerationSizeMb: LECTOR_MEMORIA_MB, maxYoungGenerationSizeMb: 32 },
    });
    let listo = false;
    const fin = (f, x) => { if (listo) return; listo = true; clearTimeout(reloj); f(x); };
    const reloj = setTimeout(() => {
      w.terminate();
      fin(rechazar, new Error('La planilla tardó demasiado en leerse: puede estar dañada. Guardala de nuevo como .xlsx o CSV'));
    }, LECTOR_TIEMPO_MS);
    w.on('message', (m) => m.error ? fin(rechazar, new Error(m.error)) : fin(resolver, m.filas));
    w.on('error', (e) => fin(rechazar, new Error(e && e.code === 'ERR_WORKER_OUT_OF_MEMORY'
      ? 'La planilla es demasiado grande o está dañada. Guardala de nuevo como .xlsx o CSV'
      : 'No se pudo leer la planilla: ' + (e && e.message))));
    w.on('exit', (codigo) => fin(rechazar, new Error('No se pudo leer la planilla (el lector se cerró: ' + codigo + ')')));
  });
}

// Adentro del hilo aparte
{
  const { isMainThread, parentPort, workerData } = require('worker_threads');
  if (!isMainThread && workerData && workerData.entrada) {
    const e = workerData.entrada;
    try {
      parentPort.postMessage({ filas: leerPlanilla({ ...e, bytes: e.bytes ? Buffer.from(e.bytes) : null }) });
    } catch (err) {
      parentPort.postMessage({ error: err.message });
    }
  }
}

module.exports = { leerPlanilla, leerPlanillaAislada, leerTexto, leerXlsx, leerOds, leerZip, MAX_FILAS };
