# COOP-R14 — Rastreo de combis (Juliaca)

App para el chofer de la Cooperativa R-14: muestra de un vistazo la brecha
de tiempo con la unidad de adelante y la de atrás, chat grupal de la ruta
y mapa en vivo. Diseñada para leerse en menos de 1 segundo con el celular
en soporte, sol lateral y el vehículo en movimiento.

## Estructura

```
project/            La app (PWA servida como archivos estáticos)
  Prototipo.html      TODA la app del chofer: React + Babel inline (sin build)
                      (también la usa el cobrador, en modo acompañante)
  despacho.html       Panel web de Despacho (flota, chat, SOS) — desktop
  realtime.js         Cliente WebSocket: GPS, estado, chat y SOS
  service-worker.js   Caché offline + caché de tiles del mapa
                      (bump CACHE_NAME en cada release; tiles y librerías
                      se conservan entre versiones a propósito.
                      El HTML de las apps va a la RED primero, con 4 s de
                      tope: una versión nueva se ve en la primera recarga
                      y sin señal igual abre de la copia guardada)
  manifest.json       Manifest PWA
  index.html          Redirect a Prototipo.html
  uploads/            Referencias de diseño (tema de color)

server/             Servidor de tiempo real (Node + Express + ws)
  index.js            Estado en memoria, cálculo de brechas, broadcast,
                      historial de chat/voz/SOS en SQLite (better-sqlite3)

chats/              Transcripts históricos del diseño (solo referencia)
TEORIA.md           Teoría del sistema de brechas
PROMPT-REACT-NATIVE.md  Guía para una futura migración a React Native
```

**Importante:** no hay archivos `.jsx` sueltos ni paso de build — todos los
componentes están inline en `project/Prototipo.html` y Babel standalone los
compila en el navegador. Cualquier cambio de UI se hace ahí.

## Cómo correr

**Requiere Node 22** (lo pide `better-sqlite3`, que es un módulo nativo).
Está fijado en `engines` y en `.nvmrc`: con otra versión el proceso puede
morir con `Segmentation fault` sin dar mensaje.

```bash
cd server && npm install && npm start
# una sola URL para todo:
#   http://localhost:3001/               → app del chofer
#   http://localhost:3001/despacho.html  → panel de Despacho
#   http://localhost:3001/ping           → health check
```

El servidor Node sirve también los estáticos de `project/` y entrega un
`config.js` que apunta el tiempo real al mismo origen. En Railway eso
significa que la URL pública (`*.up.railway.app`, HTTPS incluido) sirve
app + panel + WebSocket sin hosting aparte ni dominio comprado — un
dominio propio es opcional (CNAME hacia Railway). **Ojo:** el Root
Directory del servicio en Railway debe ser la raíz del repo (start:
`cd server && npm install && npm start`); si apunta a `server/`, el
deploy no incluye `project/` y queda solo la API.

También se puede servir `project/` desde cualquier hosting estático:
`config.js` dará 404 (inofensivo) y la app usará el servidor por defecto
de `realtime.js`, o el que se fije con `window.REALTIME_SERVER_URL`.

Limitaciones conocidas del sistema: ver **LIMITACIONES.md**.
Plan de crecimiento a 20+ rutas con números: ver **ESCALABILIDAD.md**.
Lo que falta construir, ordenado: ver **PENDIENTES.md**.

**Persistencia:** el historial del grupo (últimos 200 mensajes: texto, notas
de voz y SOS) vive en SQLite (`server/r14.db`). En Railway, para que
sobreviva redeploys, montar un volumen y apuntar la base ahí:
`DB_FILE=/data/r14.db`. Las notas de voz viajan como data-URL base64
(webm/opus, tope 60 s / ~1.5 MB); solo las 30 más recientes conservan su
audio — las más viejas quedan "expiradas" (burbuja sin reproducción).

**Autenticación:** `POST /auth/login` con `{ user, password }` devuelve un
token de sesión (30 días) que el WebSocket exige en el `identify` — sin
token válido no hay estado, historial ni chat. Contraseñas con scrypt+salt
en la tabla `users` (roles `driver`/`collector`/`dispatch`); 5 intentos fallidos
bloquean la unidad 5 minutos. **El alta de choferes la hace Despacho**
(panel → Unidades): el login rechaza unidades no registradas. Solo se
auto-registran DESPACHO (bootstrap del sistema) y, para demos sin
administración, cualquier unidad si `OPEN_REGISTRATION=1`. La app guarda
la sesión en el celular y la restaura al abrir; si el servidor no
responde, ofrece un modo demo local.

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

## Panel de Despacho

`project/despacho.html`: mapa de toda la flota en vivo, lista de
unidades con brechas ±1 coloreadas, chat del grupo hablando como
**DESPACHO** (chip azul en la app del chofer) y recepción de SOS con banner
persistente hasta marcarlo ATENDIDO. **Funciona en PC y en celular**: bajo
900 px pasa a vista única (Unidades / Mapa / Chat) con navegación
inferior, y se instala como app fija vía PWA (`manifest-despacho.json`,
"Agregar a pantalla de inicio") — pensado para un encargado sin
computadora. Usa el mismo servidor y el mismo login;
el usuario reservado `DESPACHO` siempre recibe rol `dispatch` y **no**
aparece como unidad en ruta. En producción fijar su clave con la variable
de entorno `DISPATCH_PASSWORD` (crea/actualiza la cuenta al arrancar).

**Administración (botón Gestión):** pestañas **PERSONAS** (alta con
nombre obligatorio, alias opcional, rol chofer/cobrador y vehículo
asignado; corrección de nombre/alias, reset de contraseña y bajas),
**VEHÍCULOS** (alta de combis con su placa y quién va en cada una),
**RUTAS**, **VUELTAS** y **ACTIVIDAD** — contra los endpoints `/admin/*`
del servidor (protegidos por rol `dispatch` vía `Authorization: Bearer`).
Al dar de alta un chofer sin elegir vehículo se le crea uno con su mismo
código; un cobrador **necesita** un vehículo ya existente. Resetear la
clave o dar de baja revoca las sesiones de esa unidad y la desconecta al
instante — el celular vuelve al login con el motivo. La pestaña
**Actividad** muestra la auditoría: quién inició sesión, quién dio de
alta/baja o reseteó claves, bloqueos por intentos fallidos y SOS.
La pestaña **Vueltas** muestra el historial por unidad (vueltas de hoy,
última, promedio, mejor y velocidad): el servidor detecta cada vuelta
solo — cuando el `routeProgress` llega cerca del final y vuelve al
inicio — y la guarda en la tabla `laps` (últimas 2000).

## Identidad: la persona no es la combi

Antes la cuenta *era* la unidad: `M-05` era el vehículo, el login y quien
reportaba GPS. Ahora son dos cosas distintas.

- **Personas** (tabla `users`): cada chofer y cada cobrador tiene su
  cuenta, con **nombre y apellido obligatorio** —es lo que queda en los
  registros de la empresa— y un **alias opcional**, que es lo que se
  muestra en el chat y en el mapa si está puesto. `role` es `driver`,
  `collector` o `dispatch`.
- **Vehículos** (tabla `vehicles`): la combi física, con su placa
  opcional. Es la clave del mapa, de las brechas y de las vueltas.
- Una persona se asigna a un vehículo (`users.vehicleId`). Pueden ir dos
  arriba: el chofer y su cobrador.

**Un solo celular por vehículo reporta la posición.** El servidor lleva
esa designación (`gpsOwner`) y se la avisa al cliente con `gps_role`:

| | Qué pasa |
| --- | --- |
| **Chofer** | Tiene el mando: su GPS es el de la unidad |
| **Cobrador** | Modo **acompañante**: ve brechas, mapa y chat, pero su app deja de mandar posición (se ahorra datos, y la unidad no salta entre dos celulares) |
| **Relevo de turno** | El último chofer que entra toma el mando y al anterior se le avisa en pantalla; si el que tenía el mando se va, lo hereda un chofer que siga conectado |

El vehículo sale del mapa recién cuando se desconecta **la última**
persona que iba arriba: que el cobrador cierre la app no borra la combi.

Cada mensaje del chat viaja firmado con la persona (`driverName`) **y**
su vehículo (`vehicleId`): el nombre dice quién habla, el código dice
desde qué combi.

**Bases existentes migran solas:** cada cuenta de chofer anterior genera
su vehículo con el mismo código, conserva su contraseña y toma su propio
código como nombre provisional. Despacho lo corrige después con el botón
**Nombre** de la lista de personas, sin dar de baja a nadie — el cambio
se ve en vivo, incluso con el chofer conectado.

## Multi-ruta

Cada ruta es independiente: sus unidades, sus brechas, su chat y su
historial. Una ruta define **su** objetivo de brecha y **su** duración de
recorrido, y con esos dos números se convierte distancia en minutos — por
eso dos rutas con la misma separación física dan brechas distintas.

- Tabla `routes` (`routeId`, `name`, `targetGapMin`, `durationMin`) y
  columna `routeId` en `users`, `messages`, `laps` y `audit`. Las bases
  existentes migran solas: todo lo que había pasa a la ruta inicial
  (`DEFAULT_ROUTE`, por defecto `R-14`).
- El estado, el chat y las brechas se calculan y emiten **por ruta**: un
  chofer nunca ve unidades ni mensajes de otro recorrido.
- **Un SOS escala**: llega a su ruta y además a todos los supervisores,
  aunque estén mirando otra (el banner marca de qué ruta viene).

**Dos tipos de cuenta de despacho**, según `users.routeId`:

| | Alcance |
| --- | --- |
| **Supervisor** (`routeId` NULL) | Ve y administra todas las rutas, cambia con el selector del panel, crea rutas nuevas. Es lo que queda la cuenta `DESPACHO` inicial |
| **Despachador de ruta** (`routeId` con valor) | Solo su ruta: no ve, ni administra, ni recibe nada de las demás |

## Niveles de seguridad

1. **Chofer y cobrador** — su clave abre solo su sesión; no pueden tocar
   `/admin`. Dar de baja a un cobrador no toca al chofer ni al vehículo,
   y un cobrador no hereda permisos del chofer.
2. **Despacho** — administra las claves de los choferes; cada uso de ese
   poder queda en la tabla `audit`. No puede eliminar su propia cuenta.
3. **Operador (dueño del sistema)** — está por encima sin clave dentro de
   la app: controla el deploy, las variables de entorno y la base.
   **Ruta de recuperación**: si la clave de Despacho se pierde o filtra,
   setear/cambiar `DISPATCH_PASSWORD` en Railway y reiniciar — la cuenta
   se resetea al arrancar. Quien accede al repo o al archivo `r14.db`
   puede todo; ese es el "root" real del sistema.

## Panel de tweaks

La página expone un panel de escenarios (tiempos, objetivo, modo de luz)
que se activa con `postMessage({ type: '__activate_edit_mode' })` desde la
ventana padre (lo usa el entorno de diseño).
