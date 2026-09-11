// Los paneles web, por lectura: lo que salió de la revisión del 8/9
// (REVISION-2026-09-08.md, P1–P7) y no se ve usándolos, sólo leyéndolos.
//
// Son comprobaciones sobre el código fuente —como `vendor` y `tiles` con el
// service worker—: no hay navegador acá. Lo que se defiende es que nadie
// "simplifique" una de estas líneas sin que una suite lo diga.
const RAIZ = require('path').join(__dirname, '..');
const fs = require('fs');
const leer = (f) => fs.readFileSync(RAIZ + '/' + f, 'utf8');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

const sw = leer('project/service-worker.js');
const despacho = leer('project/despacho.html');
const creador = leer('server/creador.html');
const prototipo = leer('project/Prototipo.html');
const realtime = leer('project/realtime.js');

console.log('\nP1. EL SERVICE WORKER NO GUARDA LO QUE ES DE ALGUIEN');
{
  // El orden importa: la regla de la credencial va ANTES de cualquier caché
  const iFetch = sw.indexOf("addEventListener('fetch'");
  const iAuth = sw.indexOf("req.headers.has('authorization')");
  const iTile = sw.indexOf('ES_TILE.test(url)');
  ok('toda petición con Authorization va a la red', iAuth > iFetch && iFetch > 0);
  ok('y se decide antes que las tiles y las librerías', iAuth < iTile);
  for (const ruta of ['marca', 'gerencia', 'perfil', 'grabacion', 'informe', 'creador']) {
    ok(`/${ruta} está en NUNCA_CACHEAR`, new RegExp('NUNCA_CACHEAR = \\[[\\s\\S]*?\\\\/' + ruta + '[\\s\\S]*?\\];').test(sw));
  }
  ok('/auth/ y /admin/ siguen ahí', /\/\\\/auth\\\/\//.test(sw) && /\/\\\/admin\\\/\//.test(sw));
  const v = (sw.match(/CACHE_NAME = 'coop-r14-v(\d+)'/) || [])[1];
  ok('CACHE_NAME subió (v54 o más)', Number(v) >= 54, v);
}

console.log('\nP2. BABEL CON INTEGRITY EN LOS TRES');
{
  const hash = (prototipo.match(/babel\.min\.js" integrity="(sha384-[^"]+)"/) || [])[1];
  ok('Prototipo.html lo tiene', !!hash, hash);
  for (const [n, h] of [['despacho.html', despacho], ['creador.html', creador]]) {
    const tag = (h.match(/<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]+"[^>]*>/) || [])[0] || '';
    ok(`${n} lleva el mismo hash`, !!hash && tag.includes(`integrity="${hash}"`), tag.slice(0, 90));
    ok(`${n} con crossorigin`, /crossorigin="anonymous"/.test(tag));
  }
  ok('y React/ReactDOM siguen con el suyo en Despacho',
     (despacho.match(/react(-dom)?@18\.3\.1[^>]*integrity="sha384-/g) || []).length === 2);
}

console.log('\nP3. EL GERENTE NO PIERDE LA SESIÓN AL RECARGAR');
{
  const m = despacho.match(/localStorage\.getItem\('r14_dispatch_session'\)[\s\S]{0,400}?return ([^\n]+);/);
  const linea = m ? m[1] : '';
  ok('la sesión guardada vale para dispatch Y manager',
     /role === 'dispatch'/.test(linea) && /role === 'manager'/.test(linea), linea);
}

console.log('\nP4. AL RECONECTAR SE VUELVE A LA RUTA QUE SE MIRABA');
{
  const onopen = (despacho.match(/ws\.onopen = \(\) => \{([\s\S]*?)\};/) || [])[1] || '';
  ok('onopen manda identify', /type: 'identify'/.test(onopen));
  ok('y vuelve a pedir la ruta mirada', /type: 'watch'/.test(onopen) && /rutaMiradaRef/.test(onopen), onopen.trim().slice(0, 160));
  ok('cambiarRuta la recuerda', /rutaMiradaRef\.current = routeId;/.test(despacho));
}

console.log('\nP5. SALIR REVOCA EL TOKEN EN EL SERVIDOR');
{
  const logout = (despacho.match(/const logout = \(\) => \{([\s\S]*?)\n  \};/) || [])[1] || '';
  ok('Despacho llama a POST /auth/logout', /\/auth\/logout/.test(logout) && /method: 'POST'/.test(logout));
  ok('con el token de la sesión', /Authorization: 'Bearer ' \+ session\.token/.test(logout));
  ok('y borra lo local igual', /removeItem\('r14_dispatch_session'\)/.test(logout));
  ok('la app web del chofer también (realtime.js)', /function logout\(\)[\s\S]*?\/auth\/logout/.test(realtime) && /\n    logout,\n/.test(realtime));
  ok('y la llama al salir', /RealtimeClient\.logout\(\)/.test(prototipo));
}

console.log('\nP6. «N EN RUTA» CUENTA LA CADENA, NO TODO LO QUE SE VE');
{
  ok('el panel guarda los conteos del servidor',
     /enRuta: msg\.totalOnRoute/.test(despacho) && /sinSenal: msg\.sinSenal/.test(despacho) &&
     /yendo: msg\.yendo/.test(despacho) && /ausentes: msg\.ausentes/.test(despacho));
  ok('y la cabecera los usa', /routeInfo\.enRuta \?\? units\.length/.test(despacho) && /SIN SEÑAL`/.test(despacho) && /YENDO`/.test(despacho));
  ok('con `units.length` sólo de respaldo para un servidor viejo', !/`EN VIVO · \$\{units\.length\} EN RUTA`/.test(despacho));
}

console.log('\nP7. LOS TIEMPOS RELATIVOS CORREN AUNQUE CAIGA EL SOCKET');
{
  ok('hay un reloj de 1 s en el panel', /setInterval\(\(\) => setAhora\(Date\.now\(\)\), 1000\)/.test(despacho));
  const iLista = despacho.indexOf('{units.map(u => {');
  const lista = despacho.slice(iLista, iLista + 20_000);   // la tarjeta de cada unidad
  ok('la lista existe', iLista > 0);
  ok('la lista de unidades no llama Date.now() en el render', !/Date\.now\(\)/.test(lista));
  ok('«EN TRÁFICO · N MIN» y «OÍDO HACE N S» usan el reloj', /ahora - \(u\.trafico \? u\.traficoDesde/.test(lista) && /ahora - u\.oidoEn/.test(lista));
  ok('y la lista se atenúa sin conexión', /opacity: connected \? 1 : 0\.55/.test(despacho));
  ok('el reloj atrasado del teléfono se dice', /EL RELOJ DEL TELÉFONO ATRASA/.test(lista) && /relojAtrasadoS >= 30/.test(lista));
}

console.log('\nA7. LA WEB DEL CHOFER VE EL TRÁFICO (Y LAS FOTOS)');
{
  ok('gapMeta lleva el tráfico de los dos lados',
     /aheadTrafico:\s*\{ enTrafico: !!myGaps\?\.aheadEnTrafico/.test(prototipo) && /behindTrafico:\s*\{ enTrafico: !!myGaps\?\.behindEnTrafico/.test(prototipo));
  ok('el modelo del HUD lo calcula por lado (traficoMin, traficoConfirmado)', /traficoMin: Math\.max\(0, Math\.round/.test(prototipo) && /\.\.\.trafico\(t\)/.test(prototipo));
  ok('la instrucción tiene la rama «mantené» hacia el embotellamiento', /Mantené: no te apures hacia el embotellamiento/.test(prototipo) && /hud\.front\.enTrafico/.test(prototipo));
  ok('y el rótulo del lado dice «en tráfico N min» / «parada N min»', /'en tráfico' : 'parada'\} \$\{lado\.traficoMin\} min/.test(prototipo));
  ok('realtime.js emite las fotos', /msg\.type === 'photo_msg'/.test(realtime) && /emit\('photo', msg\)/.test(realtime));
  ok('y la web las pone en el hilo (en vivo y del historial)',
     /RealtimeClient\.on\('photo'/.test(prototipo) && /it\.kind === 'photo'/.test(prototipo) && /<img src=\{msg\.photo\}/.test(prototipo));
  ok('Despacho dice cuando el GPS viene simulado', /u\.gpsSimulado && \(/.test(despacho) && /GPS SIMULADO/.test(despacho));
  // TRUCOS pasos 2 y 3: el sospechoso con su motivo, el impreciso con sus metros
  ok('y cuando es sospechoso, con el motivo', /u\.gpsSospechoso && !u\.gpsSimulado && \(/.test(despacho) && /GPS SOSPECHOSO · /.test(despacho) && /CLAVADO EN EL TRAZADO/.test(despacho));
  ok('y cuando es impreciso, con los metros', /u\.gpsImpreciso && \(/.test(despacho) && /GPS IMPRECISO · ±\{u\.precisionM\} M/.test(despacho));
  // Desde el 11/9 va «Paradas» entre GPS y Tráfico: las que MIDIÓ el servidor,
  // las haya avisado el chofer o no. Son dos columnas distintas a propósito y
  // la diferencia entre las dos es el dato (revisión del 10/9, E10).
  ok('la tabla «Señal y presencia» tiene GPS, Paradas y Tráfico',
     /'GPS', 'Paradas', 'Tráfico', 'Tardías'\]/.test(despacho) && /avisosSinParada \? `/.test(despacho) &&
     /s\.paradas \? `\$\{s\.paradas\}/.test(despacho));
  ok('la web del chofer también manda `precision` con cada posición', /precision: Math\.round\(accuracy\)/.test(realtime));
  // Tanda 4 de la revisión del 10/9: la web del chofer a la par de la app nativa
  ok('el SOS de la web va por POST /sos y sólo dice «enviada» si llegó', /HTTP_URL \+ '\/sos'/.test(realtime) && /async function sendSos/.test(realtime) && /if \(r && r\.ok\) setEmergencyFired\(true\); else setSosFallo\(true\);/.test(prototipo) && /NO SALIÓ/.test(prototipo));
  ok('el GPS simulado sólo existe en demo, y va marcado como simulado', /const DEMO = !!window\.MODO_DEMO/.test(realtime) && /if \(DEMO\) \{ startSimulatedGps\(\); return; \}/.test(realtime) && /simulado: true,/.test(realtime));
  ok('y el servidor le dice a la web si está en demo', /window\.MODO_DEMO = \$\{ES_DEMO\}/.test(leer('server/index.js')));
  ok('sin GPS la web lo dice en vez de inventar', /emit\('gps', \{ ok: false, motivo \}\)/.test(realtime) && /SIN GPS/.test(prototipo));
  ok('las unidades sin señal van huecas y apagadas en el mapa del chofer', /if \(unit\.sinSenal\) \{/.test(prototipo) && /function sinSenalPinHtml/.test(prototipo));
  ok('el watchPosition se guarda y se para; startGps no se duplica', /watchId = navigator\.geolocation\.watchPosition/.test(realtime) && /clearWatch\(watchId\)/.test(realtime) && /if \(watchId !== null \|\| gpsInterval\) return;/.test(realtime));
  ok('el chofer web puede avisar tráfico (WS o POST /trafico)', /function setTrafico/.test(realtime) && /HTTP_URL \+ '\/trafico'/.test(realtime) && /ESTOY EN TRÁFICO/.test(prototipo));
  ok('«EN VIVO · N» usa totalOnRoute del servidor', /state\.totalOnRoute/.test(prototipo) && /Number\.isFinite\(totalOnRoute\) \? totalOnRoute/.test(prototipo));
  // Tanda 5a: lo que el gerente y el creador no veían
  ok('Números elige la ruta y dice su alcance', /routeId=\$\{encodeURIComponent\(ruta\)\}/.test(despacho) && /Toda la cooperativa/.test(despacho));
  ok('Unidades activas sobre la flota, y la inactiva apagada con «hace N d»', /'Unidades activas'/.test(despacho) && /SIN ACTIVIDAD/.test(despacho));
  ok('vueltas, cumplimiento y salidas por persona', /'Persona', 'Rol', 'Turnos', 'Horas', 'Vueltas', 'Cumple', 'Salidas', 'Unidades'/.test(despacho) && /sinAtribuir/.test(despacho));
  ok('la tendencia por día se dibuja', /resumenGer\.porDia\.map\(d =>/.test(despacho));
  ok('el pie dice de cuántas vueltas sale el cumplimiento (sinBrecha)', /no tuvieron con quién/.test(despacho));
  ok('entradas tardías en «Señal y presencia» y el CSV de paradas', /'Tardías'\]/.test(despacho) && /\['paradas', 'paradas'\]/.test(despacho));
  ok('el creador ve unidades-día del mes y la última señal', /unidadesDiaMes/.test(leer('server/creador.html')) && /nunca reportó GPS/.test(leer('server/creador.html')));
  const v = (sw.match(/CACHE_NAME = 'coop-r14-v(\d+)'/) || [])[1];
  ok('CACHE_NAME subió (v62 o más)', Number(v) >= 62, v);
  // Tanda 1 de la revisión del 10/9: las horas por persona, en pantalla
  ok('Números tiene la tabla «Por persona» con las horas que se liquidan', /resumenGer\.porPersona\.map\(p =>/.test(despacho) && /'Persona', 'Rol', 'Turnos', 'Horas', 'Vueltas', 'Cumple', 'Salidas', 'Unidades'/.test(despacho));
}

console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
