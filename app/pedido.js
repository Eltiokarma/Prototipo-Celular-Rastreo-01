// El pedido HTTP de la tarea de fondo, SIN `fetch`.
//
// POR QUÉ NO SE USA fetch
//
// En React Native `fetch` es whatwg-fetch encima de XMLHttpRequest, y
// whatwg-fetch resuelve y rechaza su promesa con `setTimeout(fn, 0)`. Y en la
// arquitectura nueva (bridgeless, la que usa esta app) TODO setTimeout —el
// de 0 ms también— espera al próximo frame del Choreographer: está en
// `TimerManager.cpp` → `JavaTimerManager.createTimer`, que documenta "the
// timer will not be invoked until the next frame, regardless of whether it
// has already expired (i.e. the delay is 0)". Con la actividad pausada
// —pantalla apagada— el callback de frames se quita y no hay frames.
//
// Lo que eso produce, medido en producción durante 1 h 47 min: cada POST
// /gps llegaba al servidor en un segundo, el servidor contestaba en el acto,
// y la app NUNCA se enteraba: ni ok, ni error, ni abort. Reencolaba todo y
// lo mandaba de nuevo a los 20 s («150 posiciones, 150 ya vistas»). Al
// prender la pantalla, todas las promesas se resolvieron juntas.
//
// XMLHttpRequest de React Native no tiene ese problema: `load`, `error`,
// `timeout` y `abort` se despachan DIRECTO desde el evento nativo
// (`__didCompleteResponse` → `setReadyState(DONE)`), sin ningún timer en el
// medio. Y `xhr.timeout` es un timeout NATIVO (OkHttp `callTimeout`), así
// que un pedido que no vuelve se corta solo aunque ningún timer de
// JavaScript corra. Las promesas sí funcionan: sus continuaciones son
// microtareas y se vacían al terminar cada llamada de JavaScript.
//
// La clase XMLHttpRequest se inyecta, así esto se prueba en Node con una de
// mentira (`pruebas/pedido.js`) y en el teléfono usa la global.

'use strict';

function crearPedidor({ XHR } = {}) {
  if (!XHR) throw new Error('falta la clase XMLHttpRequest');

  // Devuelve { ok, status, texto, json() }, o rechaza con un Error cuyo
  // `name` dice qué pasó: 'AbortError' (lo cortaron), 'TimeoutError' (el
  // timeout nativo), 'TypeError' (sin red, como fetch).
  function pedir(url, { method = 'GET', headers = {}, body = null, timeoutMs = 0, control = null } = {}) {
    return new Promise((resolve, reject) => {
      if (control?.signal?.aborted) {
        return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }
      const xhr = new XHR();
      let terminado = false;
      const fin = (fn) => (...a) => { if (terminado) return; terminado = true; fn(...a); };

      xhr.onload = fin(() => {
        const status = Number(xhr.status) || 0;
        const texto = typeof xhr.responseText === 'string' ? xhr.responseText : '';
        resolve({
          ok: status >= 200 && status < 300,
          status,
          texto,
          json() { try { return JSON.parse(texto); } catch { return null; } },
        });
      });
      xhr.onerror = fin(() => reject(Object.assign(new TypeError('Network request failed'), { name: 'TypeError' })));
      xhr.ontimeout = fin(() => reject(Object.assign(new Error('Network request timed out'), { name: 'TimeoutError' })));
      xhr.onabort = fin(() => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));

      // El abort de afuera —el vigía del envío, desde el disparo del GPS—
      // cancela la llamada nativa y dispara `onabort` en el acto.
      if (control?.signal?.addEventListener) {
        control.signal.addEventListener('abort', () => { try { xhr.abort(); } catch {} });
      }

      xhr.open(method, url, true);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, String(v));
      // Nativo. 0 = sin timeout, que es justo lo que no se quiere.
      xhr.timeout = timeoutMs > 0 ? timeoutMs : 0;
      xhr.send(body);
    });
  }

  return { pedir };
}

module.exports = { crearPedidor };
