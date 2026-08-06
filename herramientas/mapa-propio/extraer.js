#!/usr/bin/env node
// Extrae el mapa propio de una zona: PMTiles RASTER, claro y oscuro.
//
//   node extraer.js juliaca            → salida/juliaca-claro.pmtiles
//                                        salida/juliaca-oscuro.pmtiles
//   node extraer.js juliaca --solo-datos   (baja OSM y para)
//
// Pipeline: Overpass (datos OSM del bbox, cacheados en datos/) → dibujo de
// cada tile z11-18 con dibujar.js → MBTiles (SQLite) → PMTiles (CLI de
// go-pmtiles, se baja solo la primera vez). La conversión deduplica: todas
// las tiles idénticas (campo raso, puro fondo) se guardan UNA vez.
//
// Por qué renderizamos nosotros en vez de guardar tiles del proveedor: los
// términos de Geoapify permiten cachear para servir a TUS usuarios, no
// redistribuir su producto empaquetado. Los datos crudos de OSM son ODbL:
// dibujarlos nosotros es exactamente el uso que la licencia contempla, con
// la atribución que ya muestran las cuatro pantallas.
//
// Requiere: @napi-rs/canvas (npm install en esta carpeta) y el
// better-sqlite3 del servidor (ya está en server/node_modules).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ZONAS = require('./zonas');
const { dibujarTile, lonAX, latAY } = require('./dibujar');

const zonaId = process.argv[2];
const zona = ZONAS[zonaId];
if (!zona) {
  console.error('Uso: node extraer.js <zona>   — zonas:', Object.keys(ZONAS).join(', '));
  process.exit(1);
}
const [W, S, E, N] = zona.bbox;
const [ZMIN, ZMAX] = zona.zooms;
const DATOS = path.join(__dirname, 'datos');
const SALIDA = path.join(__dirname, 'salida');
fs.mkdirSync(DATOS, { recursive: true });
fs.mkdirSync(SALIDA, { recursive: true });

// ─── 1. DATOS DE OSM (Overpass, con caché y espejos) ─────────
const ESPEJOS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
// Overpass es un servicio comunitario: identificarse y no ametrallar.
const UA = 'COOP-R14-mapa-propio/1.0 (extraccion unica por zona; ODbL)';
const bbq = `(${S},${W},${N},${E})`;
const CONSULTAS = {
  vias: `way["highway"]${bbq};out geom;`,
  agua: `(way["natural"="water"]${bbq};relation["natural"="water"]${bbq};way["landuse"="reservoir"]${bbq};);out geom;`,
  aguaLineas: `way["waterway"~"river|stream|canal|drain"]${bbq};out geom;`,
  verde: `(way["leisure"~"park|pitch|garden|playground"]${bbq};way["landuse"~"grass|forest|meadow|recreation_ground|cemetery|village_green"]${bbq};);out geom;`,
  rieles: `way["railway"="rail"]${bbq};out geom;`,
  aero: `way["aeroway"~"runway|taxiway"]${bbq};out geom;`,
  lugares: `node["place"~"city|town|suburb|neighbourhood|village|hamlet"]${bbq};out;`,
};

async function bajar(nombre, consulta) {
  const cache = path.join(DATOS, `${zonaId}-${nombre}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const data = `[out:json][timeout:180];${consulta}`;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    for (const url of ESPEJOS) {
      try {
        process.stdout.write(`  ${nombre} ← ${new URL(url).host}… `);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': UA,
          },
          body: 'data=' + encodeURIComponent(data),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.elements) throw new Error('respuesta sin elements');
        fs.writeFileSync(cache, JSON.stringify(json));
        console.log(`${json.elements.length} elementos`);
        // Pausa de cortesía entre temas: los 429 de recién fueron por esto
        await new Promise(r => setTimeout(r, 5000));
        return json;
      } catch (e) {
        console.log('falló (' + e.message + ')');
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    console.log(`  (vuelta ${vuelta + 1} sin suerte — 30 s de espera y de nuevo)`);
    await new Promise(r => setTimeout(r, 30000));
  }
  throw new Error('No se pudo bajar ' + nombre + ' de ningún espejo');
}

// Overpass → nuestras capas planas. Las relaciones (multipolígonos) se
// aproximan dibujando cada anillo exterior; para agua y parques alcanza.
function aCapa(json, esLinea) {
  const out = [];
  for (const el of json.elements) {
    if (el.type === 'way' && el.geometry) {
      out.push({ coords: el.geometry.map(g => [g.lon, g.lat]), clase: el.tags?.highway || el.tags?.place || null });
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.type === 'way' && m.geometry && (esLinea || m.role !== 'inner')) {
          out.push({ coords: m.geometry.map(g => [g.lon, g.lat]), clase: null });
        }
      }
    }
  }
  return out;
}

// ─── 2. ÍNDICE ESPACIAL ──────────────────────────────────────
// Celdas z13: cada elemento se anota en las que toca; cada tile pregunta
// por su celda ancestro. 19 000 tiles × 40 000 vías sin esto no termina.
function indexar(capa) {
  const celdas = new Map();
  const idx = { celdas, capa };
  capa.forEach((f, i) => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of (f.coords || [f.punto])) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    f.bb = [minLon, minLat, maxLon, maxLat];
    const x0 = Math.floor(lonAX(minLon, 13) / 256), x1 = Math.floor(lonAX(maxLon, 13) / 256);
    const y0 = Math.floor(latAY(maxLat, 13) / 256), y1 = Math.floor(latAY(minLat, 13) / 256);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = x + ':' + y;
      if (!celdas.has(k)) celdas.set(k, []);
      celdas.get(k).push(i);
    }
  });
  return idx;
}
function buscar(idx, bb) {
  const [w, s, e, n] = bb;
  const x0 = Math.floor(lonAX(w, 13) / 256), x1 = Math.floor(lonAX(e, 13) / 256);
  const y0 = Math.floor(latAY(n, 13) / 256), y1 = Math.floor(latAY(s, 13) / 256);
  const vistos = new Set(), out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const i of idx.celdas.get(x + ':' + y) || []) {
      if (vistos.has(i)) continue;
      vistos.add(i);
      const f = idx.capa[i];
      if (f.bb[0] <= e && f.bb[2] >= w && f.bb[1] <= n && f.bb[3] >= s) out.push(f);
    }
  }
  return out;
}

// ─── 3. PMTILES CLI (se baja solo si falta) ──────────────────
function pmtilesBin() {
  const local = path.join(__dirname, 'pmtiles');
  if (fs.existsSync(local)) return local;
  try { execFileSync('pmtiles', ['version']); return 'pmtiles'; } catch {}
  console.log('bajando go-pmtiles (una sola vez)…');
  const url = 'https://github.com/protomaps/go-pmtiles/releases/download/v1.22.1/go-pmtiles_1.22.1_Linux_x86_64.tar.gz';
  execFileSync('bash', ['-c', `curl -sL --max-time 120 "${url}" | tar xz -C "${__dirname}" pmtiles`]);
  return local;
}

// ─── 4. A TRABAJAR ───────────────────────────────────────────
(async () => {
  console.log(`Zona ${zona.nombre} · bbox ${zona.bbox.join(', ')} · z${ZMIN}-${ZMAX}`);
  const crudo = {};
  for (const [nombre, consulta] of Object.entries(CONSULTAS)) {
    crudo[nombre] = await bajar(nombre, consulta);
  }
  if (process.argv.includes('--solo-datos')) return;

  const capas = {
    vias: aCapa(crudo.vias),
    agua: aCapa(crudo.agua),
    aguaLineas: aCapa(crudo.aguaLineas, true),
    verde: aCapa(crudo.verde),
    rieles: aCapa(crudo.rieles, true),
    aero: aCapa(crudo.aero, true),
    lugares: crudo.lugares.elements
      .filter(el => el.tags?.name)
      .map(el => ({ punto: [el.lon, el.lat], clase: el.tags.place, nombre: el.tags.name })),
  };
  const indices = {};
  for (const [k, capa] of Object.entries(capas)) indices[k] = indexar(capa);
  const elegir = (capa, bb) => buscar(indices[Object.keys(capas).find(k => capas[k] === capa)], bb);
  console.log('capas:', Object.entries(capas).map(([k, v]) => `${k}=${v.length}`).join(' · '));

  const { createCanvas } = require(fs.existsSync(path.join(__dirname, 'node_modules', '@napi-rs', 'canvas'))
    ? '@napi-rs/canvas'
    : process.env.CANVAS_DIR || '@napi-rs/canvas');
  const Database = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'better-sqlite3'));

  for (const estilo of ['claro', 'oscuro']) {
    const mb = path.join(SALIDA, `${zonaId}-${estilo}.mbtiles`);
    fs.rmSync(mb, { force: true });
    const db = new Database(mb);
    db.pragma('journal_mode = OFF');
    db.exec(`CREATE TABLE metadata (name TEXT, value TEXT);
             CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
             CREATE UNIQUE INDEX t ON tiles (zoom_level, tile_column, tile_row);`);
    const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    meta.run('name', `${zona.nombre} ${estilo} — COOP-R14`);
    meta.run('format', 'png');
    meta.run('bounds', zona.bbox.join(','));
    meta.run('minzoom', String(ZMIN));
    meta.run('maxzoom', String(ZMAX));
    meta.run('attribution', '© OpenStreetMap contributors');
    const ins = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');

    let total = 0;
    const t0 = Date.now();
    for (let z = ZMIN; z <= ZMAX; z++) {
      const x0 = Math.floor(lonAX(W, z) / 256), x1 = Math.floor(lonAX(E, z) / 256);
      const y0 = Math.floor(latAY(N, z) / 256), y1 = Math.floor(latAY(S, z) / 256);
      const lote = db.transaction(() => {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const png = dibujarTile(createCanvas, capas, elegir, estilo, z, x, y);
          // MBTiles usa el eje Y de TMS (invertido respecto del XYZ web)
          ins.run(z, x, 2 ** z - 1 - y, png);
          total++;
        }
      });
      lote();
      console.log(`  ${estilo} z${z}: ${(x1 - x0 + 1) * (y1 - y0 + 1)} tiles (${total} acumuladas, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    db.close();

    const pm = path.join(SALIDA, `${zonaId}-${estilo}.pmtiles`);
    fs.rmSync(pm, { force: true });
    execFileSync(pmtilesBin(), ['convert', mb, pm]);
    const mbSize = fs.statSync(mb).size, pmSize = fs.statSync(pm).size;
    console.log(`  → ${path.basename(pm)}: ${(pmSize / 1024 ** 2).toFixed(1)} MB (mbtiles ${(mbSize / 1024 ** 2).toFixed(1)} MB, ${total} tiles)`);
  }
  // El índice que el servidor sirve en /tiles/zonas.json: qué zonas hay,
  // su bbox y sus archivos. La cascada (fase 3) decide con esto si una tile
  // sale del mapa propio o del proveedor. Se actualiza, no se pisa: una
  // zona nueva se suma a las que ya estaban extraídas.
  const idxPath = path.join(SALIDA, 'zonas.json');
  const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : {};
  idx[zonaId] = {
    nombre: zona.nombre, bbox: zona.bbox, zooms: zona.zooms,
    archivos: { claro: `${zonaId}-claro.pmtiles`, oscuro: `${zonaId}-oscuro.pmtiles` },
    extraido: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));

  console.log('\nListo. Los .pmtiles y zonas.json están en herramientas/mapa-propio/salida/');
  console.log('El tamaño decide dónde viven — ver PENDIENTES.md / COSTOS.md.');
})().catch(e => { console.error(e); process.exit(1); });
