// El pedido HTTP de la tarea de fondo (app/pedido.js): sin fetch, sin timers.
//
// Lo que se defiende: que la tarea se ENTERE de la respuesta con la
// pantalla apagada. `fetch` en React Native resuelve con setTimeout(0), y en
// bridgeless ningún timer corre con la actividad pausada — medido: 1 h 47 min
// de POST que llegaban al servidor y la app reencolaba como si nada. Esto va
// por XMLHttpRequest, cuyos eventos salen directo del evento nativo, y con
// el timeout nativo de OkHttp.
const RAIZ = require('path').join(__dirname, '..');
const fs = require('fs');
const { crearPedidor } = require(RAIZ + '/app/pedido.js');

let fallas = 0;
const ok = (n, c, e) => {
  if (c !== true) fallas++;
  console.log((c === true ? '  ok   ' : '  FALLA') + '  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : ''));
};

// Un XMLHttpRequest de mentira que se maneja desde la prueba: anota lo que
// le piden y dispara los eventos cuando se le dice. Como el de React Native,
// dispara `onabort` en el acto al llamar `abort()`.
let ultimo = null;
class XhrFalso {
  constructor() {
    this.headers = {}; this.timeout = 0; this.status = 0; this.responseText = '';
    this.abortado = 0; this.enviado = null;
    ultimo = this;
  }
  open(m, u) { this.method = m; this.url = u; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(b) { this.enviado = b; }
  abort() { this.abortado++; this.onabort && this.onabort(); }
  // Lo que el nativo haría
  responder(status, texto) { this.status = status; this.responseText = texto; this.onload(); }
  fallar() { this.onerror(); }
  vencer() { this.ontimeout(); }
}
const { pedir } = crearPedidor({ XHR: XhrFalso });

// Sin ningún timer de por medio: se comprueba resolviendo SOLO microtareas.
const microtareas = () => Promise.resolve().then(() => {}).then(() => {});

(async () => {
  console.log('\nLA RESPUESTA LLEGA SIN NINGÚN TIMER');
  {
    let resultado = null;
    const p = pedir('https://x/gps', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: '{"posiciones":[]}', timeoutMs: 15000,
    }).then(r => { resultado = r; });
    ok('abre con el método y la URL', ultimo.method === 'POST' && ultimo.url === 'https://x/gps');
    ok('manda los headers', ultimo.headers.Authorization === 'Bearer t' && ultimo.headers['Content-Type'] === 'application/json');
    ok('manda el cuerpo', ultimo.enviado === '{"posiciones":[]}');
    ok('y el timeout es NATIVO: se lo pasa al xhr', ultimo.timeout === 15000, ultimo.timeout);
    ultimo.responder(200, '{"ok":true,"aceptadas":3}');
    await microtareas(); await p;
    ok('resuelve con la respuesta', resultado?.ok === true && resultado.status === 200);
    ok('y el JSON se lee', resultado.json()?.aceptadas === 3, resultado.json());
  }

  console.log('\nLO QUE NO SALIÓ BIEN TIENE NOMBRE');
  {
    let r = null;
    let p = pedir('https://x/gps', { method: 'POST' }).then(x => { r = x; });
    ultimo.responder(409, '{"error":"Otro chofer tomó esta unidad"}');
    await p;
    ok('un 4xx resuelve con ok=false y el cuerpo', r.ok === false && r.status === 409 && r.json()?.error === 'Otro chofer tomó esta unidad');

    let e = null;
    p = pedir('https://x/gps', { method: 'POST' }).catch(x => { e = x; });
    ultimo.fallar();
    await p;
    ok('sin red rechaza como fetch: TypeError', e?.name === 'TypeError', e?.name);

    e = null;
    p = pedir('https://x/gps', { method: 'POST', timeoutMs: 15000 }).catch(x => { e = x; });
    ultimo.vencer();
    await p;
    ok('el timeout nativo rechaza con su propio nombre', e?.name === 'TimeoutError', e?.name);

    e = null;
    p = pedir('https://x/gps', { method: 'POST' }).then(x => { r = x; }).catch(x => { e = x; });
    ultimo.responder(200, 'esto no es json');
    await p;
    ok('un cuerpo que no es JSON no revienta: json() da null', e === null && r.ok && r.json() === null);
  }

  console.log('\nEL CORTE DESDE AFUERA LLEGA EN EL ACTO');
  {
    const control = new AbortController();
    let e = null;
    const p = pedir('https://x/gps', { method: 'POST', control }).catch(x => { e = x; });
    const xhr = ultimo;
    control.abort();
    await p;
    ok('abortar el control aborta el xhr', xhr.abortado === 1);
    ok('y rechaza con AbortError, sin esperar a nadie', e?.name === 'AbortError', e?.name);
    // Una respuesta que llegue después del corte no resuelve nada
    let tarde = false;
    p.then(() => { tarde = true; });
    xhr.onload && xhr.onload();
    await microtareas();
    ok('lo que llegue después del corte se ignora', e?.name === 'AbortError' && tarde === true);

    const ya = new AbortController(); ya.abort();
    let e2 = null;
    await pedir('https://x/gps', { method: 'POST', control: ya }).catch(x => { e2 = x; });
    ok('un control ya abortado no manda nada', e2?.name === 'AbortError');
  }

  console.log('\nSIN fetch Y SIN TIMERS, A PROPÓSITO');
  {
    const fuente = fs.readFileSync(RAIZ + '/app/pedido.js', 'utf8');
    const codigo = fuente.replace(/\/\/[^\n]*/g, '');
    ok('pedido.js no usa fetch', !/\bfetch\(/.test(codigo));
    ok('ni setTimeout ni setInterval', !/setTimeout|setInterval/.test(codigo));
    ok('ni importa nada de React Native ni de Expo', !/require\(|^import /m.test(codigo));

    // Y la tarea de fondo lo USA: si alguien vuelve a `fetch` ahí, la app
    // vuelve a quedarse muda con la pantalla apagada.
    const servicio = fs.readFileSync(RAIZ + '/app/gps/servicio.js', 'utf8').replace(/\/\/[^\n]*/g, '');
    ok('gps/servicio.js no llama fetch', !/\bfetch\(/.test(servicio));
    ok('y pide por pedido.js', /crearPedidor/.test(servicio) && /XMLHttpRequest/.test(servicio));
    ok('con el timeout nativo del corte', /timeoutMs: FETCH_CORTE_MS/.test(servicio));
  }

  console.log(fallas === 0 ? '\nTODO EN ORDEN' : `\n${fallas} FALLAS`);
  process.exit(fallas ? 1 : 0);
})();
