// Qué APK es éste, y si hay uno nuevo (REVISION-2026-09-10.md, P5).
//
// El número lo lee la app de la INSTALACIÓN (`expo-application`), no de
// `app.json`: con `appVersionSource: remote` en eas.json el `versionCode` lo
// pone EAS al compilar, y el del archivo puede no ser el del teléfono. Acá
// no se importa nada nativo a propósito: esto es la lógica, y se prueba en
// Node (`pruebas/nativas.js`). Quien la usa le pasa `{ version, versionCode }`.

// La cabecera que va en cada pedido al servidor, para que anote quién tiene
// cuál. Sin versión (Expo Go, un build raro) no se manda nada.
//
// Desde 0.11 (actualizaciones sin reinstalar, 04/11) lleva además, si el
// JavaScript que corre llegó por una actualización y no venía en la APK,
// cuándo se publicó: `0.3.0/6+20261104-1530`. Así Despacho ve quién ya tomó
// el último arreglo.
function cabeceraDeApp(mia) {
  if (!mia || !mia.versionCode) return {};
  const act = mia.actualizacion ? `+${mia.actualizacion}` : '';
  return { 'X-App-Version': `${mia.version || '?'}/${mia.versionCode}${act}` };
}

// La etiqueta de la actualización que corre: la fecha y hora en que se
// publicó (`AAAAMMDD-HHmm`, hora del teléfono). `null` si es el JavaScript
// que vino adentro de la APK, o si el módulo de actualizaciones no está
// (Expo Go, desarrollo). Recibe lo que dice `expo-updates` y no lo importa:
// esto se prueba en Node.
function actualizacionDe(u) {
  if (!u || !u.isEnabled || u.isEmbeddedLaunch || !u.createdAt) return null;
  const d = u.createdAt instanceof Date ? u.createdAt : new Date(u.createdAt);
  if (isNaN(d.getTime())) return null;
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}`;
}

// «Hay una nueva» o «ésta ya no sirve», contra lo que el servidor reparte
// (`app` de la respuesta del login y del perfil: `versionCodeActual`,
// `versionCodeMin`, `url`). Si el servidor no dice versiones, nada: no se
// inventa un aviso. `grave` es «por debajo del mínimo»: lo que manda esta
// app ya no es lo que el servidor espera.
function avisoDeApp(app, mia) {
  if (!app || !mia || !mia.versionCode) return null;
  const donde = app.url ? ` — ${app.url}` : '';
  if (app.versionCodeMin && mia.versionCode < app.versionCodeMin) {
    return {
      grave: true,
      texto: `ESTA APP (versión ${mia.versionCode}) YA NO SIRVE: pedile la nueva a Despacho${donde}`,
    };
  }
  if (app.versionCodeActual && mia.versionCode < app.versionCodeActual) {
    return {
      grave: false,
      texto: `Hay una versión nueva de la app (${app.versionCodeActual}); tenés la ${mia.versionCode}${donde}`,
    };
  }
  return null;
}

module.exports = { cabeceraDeApp, avisoDeApp, actualizacionDe };
