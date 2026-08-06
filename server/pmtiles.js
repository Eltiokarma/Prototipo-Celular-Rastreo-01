// Lector de PMTiles v3 — solo lectura, solo lo que este servidor necesita.
//
// Un PMTiles es un archivo único e inmutable con miles de tiles adentro y un
// índice para encontrarlas. Este módulo abre el archivo UNA vez, se queda
// con el índice en memoria (unos cientos de KB) y de ahí en más cada tile es
// una lectura puntual de disco: el celular pide /tiles/xyz/.../z/x/y.png y
// acá se le encuentra su pedacito. Nadie baja nunca el archivo entero.
//
// Implementado a mano y no con una dependencia por la misma razón que todo
// en este servidor: son ~150 líneas contra un paquete más en el árbol, y el
// formato está congelado por especificación (v3). Referencia:
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md

const fs = require('fs');
const zlib = require('zlib');

// ─── VARINT (LEB128) ─────────────────────────────────────────
// Los índices del archivo se codifican como enteros de largo variable.
function leerVarint(buf, pos) {
  let resultado = 0, corrimiento = 1;
  for (;;) {
    const b = buf[pos.i++];
    resultado += (b & 0x7f) * corrimiento;
    if (b < 0x80) return resultado;
    corrimiento *= 128;
  }
}

// ─── HILBERT ─────────────────────────────────────────────────
// PMTiles ordena las tiles por curva de Hilbert: vecinas en el mapa quedan
// vecinas en el archivo. Algoritmo clásico (el mismo de la librería de
// referencia). Los `&` sobre x,y son seguros: en z=18, x,y < 2^18. El id
// acumulado sí supera 2^32, pero se arma con sumas, no con bits.
function idDeTile(z, x, y) {
  // Cuántas tiles hay en todos los zooms anteriores: (4^z - 1) / 3
  let acumulado = 0;
  for (let i = 0; i < z; i++) acumulado += 4 ** i;
  let d = 0;
  let px = x, py = y;
  for (let s = 2 ** z / 2; s >= 1; s = s / 2) {
    const rx = (px & s) > 0 ? 1 : 0;
    const ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {                 // rotar el cuadrante
      if (rx === 1) { px = s - 1 - px; py = s - 1 - py; }
      const t = px; px = py; py = t;
    }
  }
  return acumulado + d;
}

// ─── DIRECTORIOS ─────────────────────────────────────────────
function leerDirectorio(buf) {
  const pos = { i: 0 };
  const n = leerVarint(buf, pos);
  const entradas = new Array(n);
  let id = 0;
  for (let k = 0; k < n; k++) { id += leerVarint(buf, pos); entradas[k] = { id }; }
  for (let k = 0; k < n; k++) entradas[k].corrida = leerVarint(buf, pos);
  for (let k = 0; k < n; k++) entradas[k].largo = leerVarint(buf, pos);
  for (let k = 0; k < n; k++) {
    const v = leerVarint(buf, pos);
    entradas[k].offset = v === 0 ? entradas[k - 1].offset + entradas[k - 1].largo : v - 1;
  }
  return entradas;
}

// La entrada cuyo rango contiene el id, o null. Búsqueda binaria: el
// directorio raíz de Juliaca tiene ~13 000 entradas y esto corre por tile.
function buscarEntrada(entradas, id) {
  let lo = 0, hi = entradas.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (entradas[m].id <= id) lo = m + 1; else hi = m - 1;
  }
  const e = entradas[hi];
  if (!e) return null;
  if (e.corrida === 0) return e;                    // apunta a un subdirectorio
  return id < e.id + e.corrida ? e : null;          // corrida de tiles idénticas
}

// ─── EL ARCHIVO ──────────────────────────────────────────────
function descomprimir(buf, modo) {
  return modo === 2 ? zlib.gunzipSync(buf) : buf;   // 1 = sin comprimir, 2 = gzip
}

class PMTiles {
  constructor(ruta) {
    this.fd = fs.openSync(ruta, 'r');
    const cab = Buffer.alloc(127);
    fs.readSync(this.fd, cab, 0, 127, 0);
    if (cab.toString('latin1', 0, 7) !== 'PMTiles' || cab[7] !== 3) {
      throw new Error(ruta + ' no es un PMTiles v3');
    }
    const u64 = (o) => Number(cab.readBigUInt64LE(o));
    this.raizOffset = u64(8); this.raizLargo = u64(16);
    this.hojasOffset = u64(40);
    this.datosOffset = u64(56);
    this.compresionInterna = cab[97];               // de los directorios
    this.compresionTiles = cab[98];                 // de las tiles (png: ninguna)
    this.zooms = [cab[100], cab[101]];
    this.raiz = leerDirectorio(descomprimir(this.leer(this.raizOffset, this.raizLargo), this.compresionInterna));
    this.hojas = new Map();                         // subdirectorios ya leídos
  }

  leer(offset, largo) {
    const buf = Buffer.alloc(largo);
    fs.readSync(this.fd, buf, 0, largo, offset);
    return buf;
  }

  // El PNG de la tile, o null si no está en el archivo.
  tile(z, x, y) {
    if (z < this.zooms[0] || z > this.zooms[1]) return null;
    const id = idDeTile(z, x, y);
    let e = buscarEntrada(this.raiz, id);
    if (e && e.corrida === 0) {                     // un nivel de hojas alcanza (spec)
      let hoja = this.hojas.get(e.offset);
      if (!hoja) {
        hoja = leerDirectorio(descomprimir(this.leer(this.hojasOffset + e.offset, e.largo), this.compresionInterna));
        this.hojas.set(e.offset, hoja);
      }
      e = buscarEntrada(hoja, id);
      if (e && e.corrida === 0) return null;        // más profundo no existe en v3
    }
    if (!e) return null;
    return descomprimir(this.leer(this.datosOffset + e.offset, e.largo), this.compresionTiles);
  }
}

// Un caché de archivos abiertos: el servidor sirve varias zonas y estilos.
const abiertos = new Map();
function abrir(ruta) {
  if (!abiertos.has(ruta)) abiertos.set(ruta, new PMTiles(ruta));
  return abiertos.get(ruta);
}
// Para las pruebas y para la descarga al arrancar: soltar un archivo viejo.
function cerrar(ruta) {
  const p = abiertos.get(ruta);
  if (p) { try { fs.closeSync(p.fd); } catch {} abiertos.delete(ruta); }
}

module.exports = { abrir, cerrar, idDeTile, PMTiles };
