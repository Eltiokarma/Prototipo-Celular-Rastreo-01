# COOP-R14 — Rastreo de combis (Juliaca)

App para el chofer de la Cooperativa R-14: muestra de un vistazo la brecha
de tiempo con la unidad de adelante y la de atrás, chat grupal de la ruta
y mapa en vivo. Diseñada para leerse en menos de 1 segundo con el celular
en soporte, sol lateral y el vehículo en movimiento.

## Estructura

```
project/            La app (PWA servida como archivos estáticos)
  Prototipo.html      TODA la app vive acá: React + Babel inline (sin build)
  realtime.js         Cliente WebSocket: GPS, estado, chat y SOS
  service-worker.js   Caché offline (bump CACHE_NAME en cada release)
  manifest.json       Manifest PWA
  index.html          Redirect a Prototipo.html
  uploads/            Referencias de diseño (tema de color)

server/             Servidor de tiempo real (Node + Express + ws)
  index.js            Estado en memoria, cálculo de brechas, broadcast

chats/              Transcripts históricos del diseño (solo referencia)
TEORIA.md           Teoría del sistema de brechas
PROMPT-REACT-NATIVE.md  Guía para una futura migración a React Native
```

**Importante:** no hay archivos `.jsx` sueltos ni paso de build — todos los
componentes están inline en `project/Prototipo.html` y Babel standalone los
compila en el navegador. Cualquier cambio de UI se hace ahí.

## Cómo correr

```bash
# servidor de tiempo real
cd server && npm install && npm start   # puerto 3001, health check en /ping

# app (cualquier servidor estático)
cd project && python3 -m http.server 8080
# abrir http://localhost:8080/Prototipo.html
```

En producción el cliente apunta al servidor vía `window.REALTIME_SERVER_URL`
(por defecto, el deploy de Railway configurado en `realtime.js`).

## Pantallas

Carrusel de 3 páginas (swipe horizontal): **CHAT ← RUTA → MAPA**.

- **RUTA** — HUD "Temporizador": un dato dominante (la unidad más desviada
  del objetivo), color de estado por tolerancia relativa (verde ≤ ±15 %,
  ámbar ≤ ±30 %, rojo por encima) y slider SOS de deslizar para disparar.
- **CHAT** — grupo de la ruta en vivo por WebSocket; el SOS de otra unidad
  entra al hilo y como aviso a pantalla completa.
- **MAPA** — Leaflet con tiles reales, pines de las unidades ±1 con burbuja
  de brecha y barra inferior que replica el HUD.

El rojo `#FF2D55` está reservado a emergencia/brecha crítica — nada más lo usa.

## Panel de tweaks

La página expone un panel de escenarios (tiempos, objetivo, modo de luz)
que se activa con `postMessage({ type: '__activate_edit_mode' })` desde la
ventana padre (lo usa el entorno de diseño).
