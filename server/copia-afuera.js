'use strict';
// La copia de los respaldos FUERA del servidor (PENDIENTES 0.3, 03/11).
//
// El respaldo automático queda en el mismo volumen que la base: cubre una
// base rota o un borrado por error, pero no perder el volumen. Esto sube cada
// respaldo recién verificado a un almacenamiento aparte, compatible con S3
// (Cloudflare R2, Backblaze B2, AWS S3, Wasabi…), sin dependencias: la firma
// de AWS (SigV4) es HMAC-SHA256 y está acá abajo, probada contra los ejemplos
// publicados por AWS (suite `copia-afuera`).
//
// CIFRADO, SIEMPRE. La base tiene nombres, teléfonos, posiciones y chats:
// datos personales (Ley 29733). Sale comprimida y cifrada con AES-256-GCM, con
// una clave derivada (scrypt) de una frase que vive SOLO en las variables del
// servidor y en el gestor de contraseñas de quien opera. El proveedor guarda
// bytes que no puede leer. Sin la frase, el respaldo no sirve: por eso sin
// frase no se sube nada (y /salud lo dice).
//
// Formato del archivo `.db.gz.enc`:
//   'FLOTA1' (6) · sal (16) · iv (12) · etiqueta GCM (16) · datos cifrados
// y los datos son la base comprimida con gzip.
const crypto = require('crypto');
const zlib = require('zlib');

const MAGIA = Buffer.from('FLOTA1');
const FRASE_MINIMA = 16;

// ─── CIFRADO ────────────────────────────────────────────────
function claveDe(frase, sal) {
  return crypto.scryptSync(String(frase), sal, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function cifrar(plano, frase) {
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', claveDe(frase, sal), iv);
  const datos = Buffer.concat([c.update(zlib.gzipSync(plano, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIA, sal, iv, c.getAuthTag(), datos]);
}
function descifrar(cifrado, frase) {
  if (!Buffer.isBuffer(cifrado) || cifrado.length < 50 || !cifrado.subarray(0, 6).equals(MAGIA)) {
    throw new Error('No es un respaldo cifrado de este sistema');
  }
  const sal = cifrado.subarray(6, 22), iv = cifrado.subarray(22, 34), etiqueta = cifrado.subarray(34, 50);
  const d = crypto.createDecipheriv('aes-256-gcm', claveDe(frase, sal), iv);
  d.setAuthTag(etiqueta);
  let comprimido;
  try {
    comprimido = Buffer.concat([d.update(cifrado.subarray(50)), d.final()]);
  } catch {
    // GCM no distingue «frase equivocada» de «archivo alterado»: los dos son
    // «no se puede confiar en esto»
    throw new Error('La frase de cifrado no es la de este respaldo, o el archivo está dañado');
  }
  return zlib.gunzipSync(comprimido);
}

// ─── LA FIRMA DE AWS (SigV4) ────────────────────────────────
const sha256hex = (x) => crypto.createHash('sha256').update(x).digest('hex');
const hmac = (clave, x) => crypto.createHmac('sha256', clave).update(x).digest();
// RFC 3986, como lo pide AWS: todo menos A-Z a-z 0-9 - _ . ~
const codificar = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Genérica: sirve para el estilo de ruta (endpoint/bucket/clave) que usa
// esto y para los ejemplos de AWS (bucket en el host). `ruta` ya viene
// codificada por segmentos; `consulta` es un objeto.
function firmarV4({ metodo, host, ruta, consulta = {}, cabeceras = {}, hashCuerpo, fecha, region, servicio = 's3', idClave, secreto }) {
  const amzFecha = fecha.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dia = amzFecha.slice(0, 8);
  const todas = { ...cabeceras, host, 'x-amz-content-sha256': hashCuerpo, 'x-amz-date': amzFecha };
  const nombres = Object.keys(todas).map(k => k.toLowerCase()).sort();
  const minus = Object.fromEntries(Object.entries(todas).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const cabecerasCanon = nombres.map(k => `${k}:${minus[k]}\n`).join('');
  const firmadas = nombres.join(';');
  const consultaCanon = Object.keys(consulta).sort()
    .map(k => `${codificar(k)}=${codificar(String(consulta[k]))}`).join('&');
  const pedido = [metodo, ruta, consultaCanon, cabecerasCanon, firmadas, hashCuerpo].join('\n');
  const alcance = `${dia}/${region}/${servicio}/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amzFecha, alcance, sha256hex(pedido)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + secreto, dia), region), servicio), 'aws4_request');
  const firma = crypto.createHmac('sha256', k).update(aFirmar).digest('hex');
  return {
    firma,
    cabeceras: {
      ...cabeceras, 'x-amz-content-sha256': hashCuerpo, 'x-amz-date': amzFecha,
      Authorization: `AWS4-HMAC-SHA256 Credential=${idClave}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`,
    },
  };
}

// ─── LA CONFIGURACIÓN ───────────────────────────────────────
// De las variables de entorno. Devuelve null si no está configurada, o
// { error } si está a medias (eso se dice, no se adivina).
function configDe(env = process.env) {
  const campos = {
    endpoint: env.RESPALDO_S3_ENDPOINT, bucket: env.RESPALDO_S3_BUCKET,
    idClave: env.RESPALDO_S3_KEY_ID, secreto: env.RESPALDO_S3_SECRET,
  };
  const puestos = Object.values(campos).filter(Boolean).length;
  if (!puestos && !env.RESPALDO_CIFRADO) return null;
  if (puestos < 4) return { error: 'Faltan variables de la copia afuera (RESPALDO_S3_ENDPOINT, _BUCKET, _KEY_ID y _SECRET van juntas)' };
  if (!env.RESPALDO_CIFRADO || String(env.RESPALDO_CIFRADO).length < FRASE_MINIMA) {
    return { error: `Falta RESPALDO_CIFRADO (una frase de ${FRASE_MINIMA} caracteres o más): sin cifrar, los respaldos no salen del servidor` };
  }
  let url;
  try { url = new URL(campos.endpoint); } catch { return { error: 'RESPALDO_S3_ENDPOINT no es una URL' }; }
  return {
    ...campos, url, frase: env.RESPALDO_CIFRADO,
    region: env.RESPALDO_S3_REGION || 'auto',
    prefijo: (env.RESPALDO_S3_PREFIJO ?? 'respaldos/').replace(/^\/+/, ''),
  };
}

// ─── EL ALMACENAMIENTO ──────────────────────────────────────
async function pedirS3(cfg, { metodo = 'GET', clave = '', consulta = {}, cuerpo = null, cabeceras = {} }, fetchImpl = globalThis.fetch) {
  const base = cfg.url.pathname.replace(/\/+$/, '');
  const ruta = `${base}/${codificar(cfg.bucket)}${clave ? '/' + clave.split('/').map(codificar).join('/') : '/'}`;
  const datos = cuerpo || Buffer.alloc(0);
  const { cabeceras: firmadas } = firmarV4({
    metodo, host: cfg.url.host, ruta, consulta, cabeceras,
    hashCuerpo: sha256hex(datos), fecha: new Date(),
    region: cfg.region, idClave: cfg.idClave, secreto: cfg.secreto,
  });
  const qs = Object.keys(consulta).length
    ? '?' + Object.keys(consulta).sort().map(k => `${codificar(k)}=${codificar(String(consulta[k]))}`).join('&') : '';
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 120_000);
  try {
    const r = await fetchImpl(`${cfg.url.protocol}//${cfg.url.host}${ruta}${qs}`, {
      method: metodo, headers: firmadas, body: metodo === 'PUT' ? datos : undefined, signal: control.signal,
    });
    const cuerpoResp = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ok: r.ok, cuerpo: cuerpoResp };
  } finally { clearTimeout(t); }
}
const errorDe = (r) => {
  const txt = r.cuerpo.toString('utf8');
  const codigo = (txt.match(/<Code>([^<]+)<\/Code>/) || [])[1];
  return `el almacenamiento contestó ${r.status}${codigo ? ' (' + codigo + ')' : ''}`;
};

// Sube un respaldo (el .db verificado) cifrado. Devuelve { ok, clave, bytes }
// o { ok: false, motivo }.
async function subir(cfg, nombre, plano, fetchImpl) {
  if (!cfg || cfg.error) return { ok: false, motivo: cfg ? cfg.error : 'no configurada' };
  try {
    const cifrado = cifrar(plano, cfg.frase);
    const clave = `${cfg.prefijo}${nombre}.gz.enc`;
    const r = await pedirS3(cfg, { metodo: 'PUT', clave, cuerpo: cifrado,
      cabeceras: { 'content-type': 'application/octet-stream' } }, fetchImpl);
    if (!r.ok) return { ok: false, motivo: errorDe(r) };
    return { ok: true, clave, bytes: cifrado.length };
  } catch (e) {
    return { ok: false, motivo: e.name === 'AbortError' ? 'el almacenamiento no contestó a tiempo' : e.message };
  }
}

// Las que hay, la más nueva primero: [{ clave, bytes, cuando }]
async function listar(cfg, fetchImpl) {
  const r = await pedirS3(cfg, { consulta: { 'list-type': '2', prefix: cfg.prefijo, 'max-keys': '1000' } }, fetchImpl);
  if (!r.ok) throw new Error(errorDe(r));
  const xml = r.cuerpo.toString('utf8');
  const items = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const campo = (n) => (m[1].match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1];
    const clave = (campo('Key') || '').replace(/&amp;/g, '&');
    items.push({ clave, bytes: Number(campo('Size') || 0), cuando: Date.parse(campo('LastModified') || '') || null });
  }
  return items.sort((a, b) => (b.cuando || 0) - (a.cuando || 0) || (a.clave < b.clave ? 1 : -1));
}

// Baja una y la devuelve lista para usar: descifrada si es `.enc`, tal cual
// si es un `.db` subido a mano (un respaldo bajado del panel, por ejemplo)
async function bajar(cfg, clave, fetchImpl) {
  const r = await pedirS3(cfg, { clave }, fetchImpl);
  if (!r.ok) throw new Error(r.status === 404 ? `No existe «${clave}» en el almacenamiento` : errorDe(r));
  return /\.enc$/.test(clave) ? descifrar(r.cuerpo, cfg.frase) : r.cuerpo;
}

module.exports = { cifrar, descifrar, firmarV4, configDe, pedirS3, subir, listar, bajar, FRASE_MINIMA };
