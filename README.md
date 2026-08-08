# COOP-R14 — Rastreo de combis (Juliaca)

App para el chofer de una cooperativa de transporte: muestra de un vistazo
la brecha de tiempo con la unidad de adelante y la de atrás, chat grupal de
la ruta y mapa en vivo. Diseñada para leerse en menos de 1 segundo con el
celular en soporte, sol lateral y el vehículo en movimiento.

Nació para la Cooperativa R-14 de Juliaca —de ahí el nombre del repo— pero
una misma instalación atiende a **varias cooperativas a la vez**, cada una
con sus rutas, su gente y sus informes, sin ver nada de las demás (ver
*Empresas*).

## Estructura

```
project/            La app (PWA servida como archivos estáticos)
  Prototipo.html      TODA la app del chofer: React + Babel inline (sin build)
                      (también la usa el cobrador, en modo acompañante)
  despacho.html       Panel web de Despacho (flota, chat, SOS) — desktop
  gerencia.html       Redirección al panel de Despacho: gerencia se FUSIONÓ
                      con Despacho (el gerente entra ahí, con más permisos)
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
  base.js             Piezas compartidas con las herramientas de consola
                      (abrir la base, hashear claves, validar identificadores)
  cooperativas.js     Alta, supervisor, rutas y suspensión de cooperativas.
                      Escritas una sola vez: las usan la consola y el panel
  empresa.js          Consola de cooperativas. El piso: funciona aunque el
                      panel del creador no se pueda abrir
  marca.js            La identidad de cada cooperativa: qué logo se acepta,
                      y las iniciales y el color para cuando no hay ninguno
  respaldo.js         El respaldo de la base: en caliente (db.backup, nunca
                      cp), verificado, con rotación, y descargable desde el
                      panel del creador
  creador.js          Panel del creador: el nivel de arriba de todas las
                      cooperativas. Apagado salvo que CREATOR_PASSWORD esté
                      en el entorno. En su propio archivo para que toda su
                      superficie se lea de una sentada
  creador.html        Su pantalla. NO vive en project/ a propósito: ahí se
                      serviría como estático aunque el panel esté apagado
  trazador.js         La lógica del trazador de la pestaña RUTAS (geometría,
                      insertar en el medio, selección, deshacer, GPX). Node
                      la prueba con require(); el panel la carga tal cual
  vendor/leaflet/     Leaflet 1.9.4, la ÚNICA copia del repositorio. La sirve
                      este servidor en /vendor/leaflet/ (Despacho y la app web)
                      y en la ruta del panel del creador. Ninguna pantalla se
                      lo baja de un CDN: unpkg ya falló una vez en producción
                      y dejó el panel del creador en blanco, sin un solo error

app/                La app del chofer, nativa (Expo). El servidor no cambia.
                    Ver app/README.md
  protocolo/cliente.js  El protocolo en JS puro: login, WebSocket, rol de
                      GPS, brechas, reconexión y freno de cadencia
  hud.js              Qué mostrarle al chofer a partir de las brechas
  chat.js             Qué mensaje va en qué canal y quién lo firma
  cola.js             Las posiciones cuando no hay datos
  margenes.js         Dónde terminan las barras de Android, que cambia por
                      teléfono. Un margen fijo dejó el botón de CHAT debajo
                      de los botones del sistema
  gestos.js           Pasar de pantalla deslizando, sin robarle el gesto al SOS
  imagen.js           Cuánto achicar una foto y cuánto pesa de verdad
  tema.js             Los colores, y cuándo pasan a los de noche
  mapa.js             Qué se dibuja en el mapa (Leaflet en un WebView, sin
                      clave de Google) y la página que lo dibuja
  vendor/leaflet.js   Leaflet como texto, para que el WebView lo tenga adentro
                      del APK: la primera apertura del mapa es en la calle.
                      GENERADO desde server/vendor/leaflet/ por
                      herramientas/vendor-leaflet.js — no se edita a mano
  voz.js / foto.js    Grabar audio y sacar fotos. Acá SÍ hay Expo
  gps/servicio.js     GPS en segundo plano: foreground service y cadencia
  App.js              Las pantallas. Solo dibujan
                    Todos menos los tres últimos son JS puro y sin React a
                    propósito: corren en Node, así que tienen suites de verdad
                    y no hace falta un teléfono para saber si andan. Es donde
                    vivieron todos los bugs de esta pantalla

herramientas/       Cosas que se corren a mano para trabajar, no pruebas.
  flota.js            Veinte combis falsas manejando la ruta de verdad, para
                      ver el mapa y las brechas con la flota llena sin tener
                      veinte teléfonos. Entra por la puerta: crea usuarios,
                      hace login y manda posiciones por el MISMO POST /gps que
                      el celular. Ver herramientas/README.md
  vendor-leaflet.js   Mete Leaflet adentro del bundle de la app nativa. Se
                      corre a mano y SOLO al subir la versión de Leaflet; la
                      suite `vendor` falla si alguien se olvida

pruebas/            Treinta y cuatro suites de regresión. La mayoría contra el servidor de verdad.
                    `npm test` desde la raíz. Ver pruebas/README.md
chats/              Transcripts históricos del diseño (solo referencia)
TEORIA.md           Teoría del sistema de brechas
PROTOCOLO.md        Lo que un cliente tiene que hablar para funcionar contra
                    el servidor, verificado contra una corrida real. Es de
                    donde parte la app nativa
PROMPT-DISENO.md    Encargo para rediseñar la interfaz: qué se puede tocar y,
                    sobre todo, qué parece estético y no lo es
PROMPT-REACT-NATIVE.md  Encargo para la app nativa: por qué, qué mantener y
                    qué leer primero
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
#   http://localhost:3001/despacho.html  → panel de Despacho (la gerencia
#                                          entra acá mismo, con más permisos)
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

**Pruebas:**

```bash
cd pruebas && npm install    # solo la primera vez
cd .. && npm test            # las treinta y cuatro suites, ~7 minutos
```

Corren contra el servidor de verdad —levantan el proceso, abren WebSockets,
mandan GPS y leen la base—, sin mocks: casi todo lo que se rompió en este
proyecto se rompió en la juntura entre esas tres cosas. Ver `pruebas/README.md`
para correr una sola, para el verificador de sintaxis de las pantallas (los
paneles no tienen paso de compilación) y para lo que las pruebas **no** cubren.

**Respaldos:** la base se respalda sola cada 6 horas en `respaldos/` junto al
archivo (verificado y con rotación), y desde el panel del creador se crea uno
a pedido y **se descarga** — bajarse el archivo a otra máquina es el respaldo
que sobrevive a perder el servidor. **Restaurar** es: parar el servidor,
copiar el respaldo sobre `DB_FILE` (borrando los `-wal`/`-shm` si quedaron), y
arrancar. Nada más: el respaldo ES la base.

Limitaciones conocidas del sistema: ver **LIMITACIONES.md**.
Plan de crecimiento a 20+ rutas con números: ver **ESCALABILIDAD.md**.
Lo que falta construir, ordenado: ver **PENDIENTES.md**.

**Variables de entorno**, todas opcionales salvo donde se aclare:

| Variable | Para qué |
| --- | --- |
| `DB_FILE` | Dónde vive la base. En Railway hay que montar un volumen y apuntarla ahí (`/data/r14.db`) o **un redeploy borra todo** |
| `PORT` | Puerto (3001 por defecto) |
| `DISPATCH_PASSWORD` | Crea o actualiza la cuenta `DESPACHO` al arrancar. Es la ruta de recuperación si esa clave se pierde |
| `GEOAPIFY_API_KEY` | La clave del proveedor de tiles del mapa (gratis en [myprojects.geoapify.com](https://myprojects.geoapify.com); el plan gratuito permite uso comercial). El servidor se la pasa a las pantallas en el momento — por `/config.js` a las web, con el login a la app nativa. Sin ella el fondo del mapa sale gris; los puntos y el trazado se dibujan igual |
| `TILES_RELEASE_URL` | De dónde bajar el **mapa propio** (PMTiles raster por ciudad) al arrancar: la URL de descargas del release `mapa-propio`, p. ej. `https://github.com/Eltiokarma/Prototipo-Celular-Rastreo-01/releases/download/mapa-propio`. Con esto, las tiles de la zona de operación salen de NUESTRO servidor y Geoapify queda de excepción (fuera de zona o falla). El release lo genera el workflow **mapa propio** (Actions) |
| `TILES_DIR` | Dónde guardar/leer esos archivos. Por defecto, `tiles/` junto a la base — en Railway eso cae dentro del volumen, que es donde deben vivir |

**Renovar el mapa** es correr el workflow **mapa propio** de nuevo con la
misma zona, y nada más. Cada archivo lleva su versión en el nombre
(`juliaca-claro-3f9a1c02.pmtiles`: los 8 primeros hex del sha256 de su
contenido), y de ahí salen las tres cosas que antes había que hacer a mano:
el servidor baja el mapa nuevo al reiniciar **y borra el que reemplazó**
(sin eso, cada renovación deja tirada una copia entera del mapa anterior en
un volumen que se paga por GB, y se acumulan); si el
mapa no cambió, el nombre es el mismo y nadie baja nada; y como la versión
viaja también en la URL de cada tile, el mapa nuevo le llega al celular del
chofer, que tiene las tiles cacheadas sin expiración. Antes de esto la única
forma era entrar al volumen, vaciar la carpeta `tiles/` y redesplegar —
servidor por servidor, y sin que nada avisara si te lo olvidabas. La URL de
tile sin versión sigue atendida: es la que piden los APK que ya están en la
calle. Suite `renovacion`.
| `DEFAULT_ROUTE` / `DEFAULT_COMPANY` / `DEFAULT_COMPANY_NAME` | Código de la ruta y de la cooperativa iniciales, y su nombre visible. Solo se usan la primera vez |
| `CREATOR_PASSWORD` | **Enciende el panel del creador.** Sin esta variable, ese panel no existe. Mínimo 12 caracteres |
| `CREATOR_PATH` | Mueve el panel del creador a una ruta propia (por defecto `/creador`) |
| `CREATOR_TOTP_SECRET` | Segundo factor del panel del creador (base32) |
| `OPEN_REGISTRATION` | `1` deja que cualquiera se registre. **Solo para demos**, y ahora el servidor lo hace cumplir: sin `MODO=demo` **se niega a arrancar** y explica por qué |
| `MODO` | `demo` declara que la instancia es descartable. Es lo único que habilita `OPEN_REGISTRATION`. Cualquier otro valor —o ninguno— es producción |
| `TRUST_PROXY` | Cuántos proxies hay adelante (**1** por defecto, que es Railway). El bloqueo por intentos fallidos cuenta la IP desde la derecha de `X-Forwarded-For`: si el servidor se expone **sin** proxy hay que poner `0`, o la cabecera la escribe el cliente y el bloqueo no bloquea |
| `REVISAR_SESIONES_MS` | Cada cuánto se revalidan las sesiones de los WebSocket abiertos (60 000). Es el retardo máximo de una revocación |
| `TURNOS_DIAS` | Cuántos días se guardan los turnos cerrados (365: con ellos se liquidan horas) |
| `STATE_INTERVAL_MS` | Cada cuánto se emite el estado (3000 por defecto) |
| `SIN_SENAL_MS` | A los cuántos ms sin GPS una unidad queda marcada **sin señal** (30 000). Sigue en la fila y en el mapa con su última posición, pero nadie se mide contra ella |
| `RESPALDO_CADA_H` | Cada cuántas horas se respalda la base sola (6). `0` lo apaga |
| `RESPALDO_CONSERVAR` | Cuántos respaldos se guardan antes de rotar (28 ≈ una semana) |
| `RESPALDO_DIR` | Dónde se guardan (por defecto `respaldos/` junto a la base, adentro del volumen) |
| `OLVIDAR_MS` | A los cuántos ms se la borra de verdad y se descarta su vuelta en curso (180 000). El número bueno sale de la calle: tres minutos aguantan una llamada o un semáforo largo |

**Persistencia:** el historial del grupo (últimos 200 mensajes: texto, notas
de voz y SOS) vive en SQLite (`server/r14.db`). En Railway, para que
sobreviva redeploys, montar un volumen y apuntar la base ahí:
`DB_FILE=/data/r14.db`. Las notas de voz viajan como data-URL base64
(webm/opus, tope 60 s / ~1.5 MB); solo las 30 más recientes conservan su
audio — las más viejas quedan "expiradas" (burbuja sin reproducción).

**Autenticación:** `POST /auth/login` con `{ user, password }` devuelve un
token de sesión (30 días) que el WebSocket exige en el `identify` — sin
token válido no hay estado, historial ni chat. Contraseñas con scrypt+salt
en la tabla `users` (roles `driver`/`collector`/`dispatch`/`manager`); 5 intentos fallidos
bloquean la unidad 5 minutos. **El alta de choferes la hace Despacho**
(panel → Unidades): el login rechaza unidades no registradas. Solo se
auto-registran DESPACHO —y **sólo mientras el sistema no tenga ninguna cuenta
de administración**: en cuanto existe un despacho o una gerencia en cualquier
cooperativa, esa puerta se cierra, porque ya hay a quién pedirle el alta— y,
para demos sin administración, cualquier unidad si `OPEN_REGISTRATION=1`. La app guarda
la sesión en el celular y la restaura al abrir; si el servidor no
responde, ofrece un modo demo local.

## Pantallas

Carrusel de 3 páginas (swipe horizontal): **CHAT ← RUTA → MAPA**.

- **RUTA** — HUD "Temporizador": un dato dominante (la unidad más desviada
  del objetivo), color de estado por tolerancia relativa (verde ≤ ±15 %,
  ámbar ≤ ±30 %, rojo por encima) y slider SOS de deslizar para disparar.
- **CHAT** — dos canales: **GRUPO** (toda la ruta en vivo por WebSocket) y
  **DESPACHO**, la conversación privada de esa unidad con Despacho. Lo
  privado llega con la etiqueta *DESPACHO · PARA TU UNIDAD* y burbuja ámbar,
  y la pestaña marca cuántos mensajes faltan ver. El SOS de otra unidad entra
  al hilo del grupo y como aviso a pantalla completa.
- **MAPA** — Leaflet con tiles reales, pines de las unidades ±1 con burbuja
  de brecha y barra inferior que replica el HUD.

El rojo de emergencia está reservado a SOS y brecha crítica — nada más lo usa.

**Modo día por defecto.** El celular va en soporte contra el parabrisas y en
Juliaca, a 3800 m, el sol pega fuerte: una pantalla clara se lee mucho mejor.
Las tres pantallas (RUTA, CHAT y MAPA) y el panel de Despacho arrancan en
claro, con tiles de mapa claros. Hay tres modos y la elección se recuerda en
el dispositivo:

| Modo | Para qué |
| --- | --- |
| **Día** (de fábrica) | Uso normal, con luz |
| **Sol extremo** | Contraste máximo: blanco puro, tinta casi negra |
| **Noche** | El diseño OLED original, con resplandor, para madrugada |

En claro el resplandor se apaga (no se ve sobre fondo blanco) y el dígito
héroe usa el color de estado como tinta, que es lo que da la lectura de un
vistazo. Los colores son tokens conmutables (`TEMAS` → `HUD`), así que
cambiar de modo no recarga la app: hasta los tiles del mapa se cambian en
caliente. El panel tiene su propio botón ☾/☀ en la cabecera.

## Panel de Despacho

`project/despacho.html`: mapa de toda la flota en vivo, lista de
unidades con brechas ±1 coloreadas —encabezada por un **«N de M»**: cuántas
están reportando sobre cuántas combis tiene la ruta dadas de alta, porque a
las 6 de la mañana la pregunta no es cuántas se ven sino cuántas faltan—,
chat del grupo hablando como
**DESPACHO** (chip azul en la app del chofer) y recepción de SOS con banner
persistente hasta marcarlo ATENDIDO. **Funciona en PC y en celular**: bajo
900 px pasa a vista única (Unidades / Mapa / Chat) con navegación
inferior, y se instala como app fija vía PWA (`manifest-despacho.json`,
"Agregar a pantalla de inicio") — pensado para un encargado sin
computadora. Usa el mismo servidor y el mismo login;
el usuario reservado `DESPACHO` siempre recibe rol `dispatch` y **no**
aparece como unidad en ruta. En producción fijar su clave con la variable
de entorno `DISPATCH_PASSWORD` (crea/actualiza la cuenta al arrancar).

**Administración (botón Gestión):** un espacio de trabajo aparte, con un
riel a la izquierda que agrupa las ocho secciones por para qué sirven —
*operación del día* (Personas, Vehículos, Turnos), *ruta y medición*
(Rutas, Vueltas, Informes) y *la cooperativa* (Empresa, Actividad). Cada
sección abre diciendo qué se hace ahí. Bajo 900 px el riel se convierte en
un desplegable. Todo contra los endpoints `/admin/*` del servidor
(protegidos por rol `dispatch` vía `Authorization: Bearer`).

- **Personas** — alta con nombre obligatorio, alias opcional, rol
  chofer/cobrador y vehículo asignado; corrección de nombre/alias, reset de
  contraseña y bajas. Al dar de alta un chofer sin elegir vehículo se le
  crea uno con su mismo código; un cobrador **necesita** un vehículo ya
  existente. Resetear la clave o dar de baja revoca las sesiones de esa
  unidad y la desconecta al instante — el celular vuelve al login con el
  motivo.
- **Vehículos** — alta de combis con su placa y quién va arriba de cada una.
- **Rutas** — una tarjeta por ruta con el objetivo de brecha, el recorrido
  cargado y con cuál de los trazados se está midiendo.
- **Turnos** — entradas y salidas de la jornada, con hoy / ayer / esta semana.
- **Vueltas** — cada vuelta cerrada con su duración y su brecha promedio, más
  el acumulado por unidad. El servidor detecta cada vuelta solo —cuando el
  `routeProgress` llega cerca del final y vuelve al inicio— y la guarda en la
  tabla `laps`. Al lado van las **medias vueltas** (idas y retornos, tabla
  `legs`), que es lo que queda del chofer que hizo la ida y no volvió, y las
  vueltas **parciales**, que son las del que se metió a mitad de ruta: se
  listan marcadas y no entran en ningún promedio.
- **Actividad** — la auditoría: quién inició sesión, quién dio de alta/baja o
  reseteó claves, bloqueos por intentos fallidos y SOS.

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

### El chofer administra a los cobradores de su combi

Desde **PERFIL** en la app, el chofer ve a los cobradores que van arriba de
su combi —con sus horas de 7 días y si están en línea—, **les cambia la
clave y los saca**. Es lo del día a día: se olvidó la contraseña, cambió de
teléfono, o ya no sube más. Esperar a que Despacho atienda para eso es lo
que termina en que los dos entren con la misma cuenta — que es exactamente
lo que rompe las horas por persona y el reportero único de GPS.

**El alta NO es del chofer**, y es una decisión tomada, no un olvido: crear
una cuenta es dar acceso al sistema, y eso se queda en Despacho o la
gerencia (`POST /admin/users`), que además cargan el nombre real con el que
se liquidan las horas. El chofer administra a los que ya están; no fabrica
cuentas.

El borde de lo que sí puede: solo sobre **su** vehículo (sale de la sesión,
nunca del pedido), solo sobre gente con rol `collector`, y del cobrador de
otra combi no puede ni saber si existe (404 que no lo confirma). El
**nombre** tampoco lo edita. Todo queda auditado (`clave_cobrador`,
`baja_cobrador` — del cambio de clave, QUE la cambió y nunca cuál) y
**Despacho y la gerencia los siguen viendo enteros** en su panel. Suite
`cobradores`.

## El recorrido de la ruta (ida y vuelta)

Antes el progreso de cada unidad era una **proyección lineal** entre dos
puntos (Terminal Sur → Huancané): no seguía las calles, así que las brechas
eran aproximaciones útiles pero no medidas. Ahora cada ruta tiene su
**trazado real** como puntos GPS, y el progreso se calcula proyectando la
posición sobre esa línea.

**Una combi no recorre una línea: hace un circuito.** Sale por un lado y
vuelve por otro, y muchas veces la vuelta va por calles distintas (mano
única) o por la misma calle en sentido contrario. Por eso el recorrido se
guarda en **dos tramos, IDA y VUELTA**, cada uno con su polilínea
(`route_points.leg`).

- El progreso se mide dentro del tramo y después se convierte a una
  **coordenada del circuito completo** (0 = salida de la ida, 1 = fin de la
  vuelta). Esa es la que usan las brechas: dos combis se comparan sobre la
  misma rueda aunque una vaya de ida y la otra de vuelta.
- **Una vuelta pasa a ser el circuito entero** — salir y volver, que es lo
  que la cooperativa llama una vuelta. Es también lo que corresponde para el
  objetivo automático, porque la rueda que se reparte entre las combis es el
  circuito completo.
- Una ruta puede tener **solo ida**: ahí el circuito es ese tramo y funciona
  como antes. Lo que no se puede es cargar la vuelta sin la ida.

**Cómo se decide en qué tramo va cada combi**, que es lo delicado cuando ida
y vuelta comparten calle:

1. **Cercanía**: si un tramo está claramente más cerca (más de 25 m de
   diferencia), es ese — son calles distintas.
2. **Sentido de marcha**: si empatan, van por la misma calle. Gana el tramo
   cuya dirección coincide con hacia dónde se está moviendo la combi.
3. **Continuidad**: si está parada y no hay rumbo, se queda en el tramo en el
   que venía.

**El cálculo vive en el servidor**, no en el celular. Cargar o corregir un
recorrido tiene efecto al instante, sin actualizar la app de nadie. De paso
el servidor sabe **a cuántos metros del trazado** va cada unidad (`desvioM`),
que es la base para detectar que una combi se salió de la ruta.

**Cómo se carga** — panel → Gestión → Rutas → botón *Abrir trazador*:

- **Tocando el mapa**, un tramo a la vez: se elige *Ida* o *Vuelta* en el
  panel de la izquierda y se marca en el orden en que se maneja; el primer
  punto de cada tramo es la salida (**A**) y el último el final (**B**). El
  tramo que no se está editando queda punteado de fondo, para poder
  calzarlos. Se arrastra un punto para corregirlo y se lo toca para borrarlo;
  hay *Deshacer último punto* y *Borrar la ida/vuelta*, y al lado los puntos y
  los km del tramo. Funciona igual con el mouse en PC que con el dedo en un
  celular. Si el trazado que se está dibujando **no es el que mide hoy**, una
  franja ámbar fija bajo el título lo dice, nombra los dos y explica dónde se
  cambia la medición — no se puede descartar.
- **Importando un GPX o GeoJSON** al tramo activo, por ejemplo de esa mitad
  grabada manejando. Se simplifica con Douglas-Peucker (tolerancia 10 m): un
  GPX de 600 puntos queda en unas decenas **sin cambiar la forma**. Tope:
  2000 puntos por tramo.

### Medias vueltas: la ida que no tuvo retorno

"Vuelta" quiere decir dos cosas y conviene tener las dos escritas: el **tramo
`vuelta`** es la mitad geométrica del circuito, la que se opone a la ida; una
**vuelta de `laps`** es el circuito entero.

De ahí salía un agujero. El chofer que hace la ida y se va —termina el turno,
se le rompe algo, lo mandan a otro lado— no completa el circuito, así que no
cerraba **ninguna** fila. En vivo Despacho lo veía (la unidad dice `↪ IDA` o
`↩ VUELTA`), pero al día siguiente esa media rutina no existía en ningún
lado: ni en el informe, ni en el perfil del chofer, ni en el cuadro del
gerente. Quedaban sus horas y nada que dijera qué hizo con ellas.

Ahora **cada tramo terminado se guarda por su cuenta** (tabla `legs`):

- Una vuelta entera son dos filas de tramo (una ida y un retorno) más una en
  `laps`. No se reemplazan: cuentan cosas distintas.
- El cambio de tramo tiene que **sostenerse** cuatro posiciones, y hay que
  haber recorrido el tramo (>80 %) para decir que se terminó. Cuando la ida y
  la vuelta comparten calle la proyección puede dudar en una esquina, y sin
  esto esas dudas se guardarían como medias vueltas.
- El tramo se cierra **también cuando la unidad se baja**: declarar "fuera",
  irse a almorzar o dejar de reportar no borra la ida que ya estaba hecha.
  Ése es exactamente el caso que esto existe para no perder.
- Si el trazado cambia abajo (otra variante) el tramo en curso **se descarta**
  sin guardarlo: cambió contra qué se lo medía a mitad de camino, y de ése no
  se puede afirmar ni que se completó.
- En una ruta cargada **solo con ida** el circuito es ese tramo y las dos
  tablas dan el mismo número, que es lo correcto: ahí una ida sí es una
  vuelta.

Se ve en el acumulado por unidad de Despacho (columnas **Idas** y
**Retornos**, el retorno en ámbar cuando queda por debajo de las idas), en el
cuadro del gerente, en el perfil del chofer y en el informe `tramos.csv`.

### El que no sale del paradero inicial

La confirmación de presencia sólo exige **pisar el trazado**, y el trazado son
veinte kilómetros: pisarlo en el paradero inicial y pisarlo a mitad de ruta
eran la misma cuenta y daban el mismo resultado. El chofer que se "mete" en el
medio entraba a la cadena de brechas como cualquiera.

Que entre no es el problema —puede tener mil motivos, y el sistema no está
para juzgarlos—. El problema era que esa **primera vuelta no es una vuelta**:
es el pedazo que le faltaba al circuito. Se cerraba igual (llega al final,
cruza el inicio) con una duración que es una fracción de la real, y entraba a
los promedios como entera: bajaba la duración promedio de la ruta, movía el
objetivo automático y le sumaba una vuelta que no dio. **Y no se notaba
mirando la pantalla**, que es lo que lo hacía caro: la fila era idéntica a las
demás.

Ahora, en el momento en que la unidad pisa el trazado, se mira **por dónde**:

- Si entró más allá del 15 % del circuito, la unidad queda marcada en vivo en
  Despacho (`↳ ENTRÓ 62%`, en ámbar) y el hecho se **audita**, para poder
  contestar "¿cuántas veces esta semana?" sin haber estado mirando la pantalla
  en el momento.
- **Salvo que esté reanudando.** El olvido desconfirma a los 3 minutos sin oír
  al teléfono, y una zona muerta más larga que eso es común: un cerro, un
  sótano, la batería agotada. Al reaparecer, el que venía desde el paradero se
  ve idéntico al que se acaba de meter. Si la unidad estaba confirmada y
  vuelve dentro de las 2 h, es la misma corrida cortada: la vuelta sigue
  siendo parcial —no se la midió entera, y eso es aritmética— pero **no se
  audita a nadie ni se lo marca en el mapa**. Una acusación automática y falsa
  es peor que no tener la detección: se descubre discutiendo con un chofer que
  tiene razón.
- La vuelta que cierre se guarda con `parcial = 1` y el progreso por el que
  entró. **No se descarta**: borrarla sería perder justo el dato que se busca.
- Todo lo que promedia la filtra —resumen de Despacho, acumulado por unidad,
  objetivo automático, cumplimiento del gerente y del perfil— y todo lo que
  lista la muestra **marcada como PARCIAL**, con el porcentaje por el que
  entró. Al chofer se le dice lo mismo que ve Despacho: esconderlo sería la
  versión amable de mentir, y además le saca la posibilidad de explicarlo.
- Al chofer **no se le avisa mientras maneja**: mismo criterio que el desvío
  —esto es gestión, no alarma—.

Al chofer no se le pide nada nuevo y la app no cambió: todo sale de datos que
el servidor ya calculaba y tiraba.

Una ruta sin recorrido cargado sigue funcionando con la estimación lineal de
siempre, así que se puede ir cargando ruta por ruta. El trazado se dibuja en
el mapa del panel y en el del chofer —la vuelta punteada, para distinguirla
de la ida cuando comparten calle— y **viaja una sola vez** (al conectar, al
cambiar de ruta o cuando se edita), nunca dentro del estado, que sale cada
3 s: mandar ahí una ruta de 300 puntos serían ~7 KB por emisión y tiraría por
la borda el ahorro de datos de `ESCALABILIDAD.md`.

## Brecha promedio por vuelta

Hasta acá se sabía **cuántas** vueltas hizo cada unidad, pero no **si las hizo
bien**. Ahora cada vuelta guarda la brecha promedio que mantuvo: es el número
que mide si la rueda funciona.

- Se mide contra la unidad de **adelante**, que es la que el chofer regula:
  uno controla cuánto se despega del de adelante, no cuánto se le pega el de
  atrás.
- Se toma una muestra en cada emisión de estado (cada 3 s) y se promedia al
  cerrar la vuelta. El número crudo **no viaja al celular**: mandarlo serían
  varios MB por turno y por unidad para un dato que el cliente no usa.
- Queda en `laps.brechaProm`, en segundos, y **NULL cuando no hubo con quién
  compararse** — una unidad sola en la ruta no cuenta ni a favor ni en contra.
- `GET /admin/vueltas` devuelve las vueltas cerradas con su brecha y el
  resumen del día: cuántas, duración promedio (con la de ayer al lado), brecha
  promedio y cuántas se hicieron **en pelotón**. Pelotón se cuenta contra la
  **mitad del objetivo de la ruta**, no contra un minuto fijo: en una ruta con
  objetivo de 8 minutos, 1 minuto de brecha es un pelotón; en una de 2, no.
- El informe de vueltas gana la columna, vacía en las que no tienen dato.

**Empieza el día que se enciende.** No se puede reconstruir hacia atrás: la
brecha se calcula contra dónde están las otras unidades en ese instante, y
esas posiciones no se guardan. Ver `LIMITACIONES.md` para el resto de los
bordes.

### Y con qué objetivo se la juzga

Una brecha sin objetivo al lado es un número sin vara. El cumplimiento se
medía contra el objetivo de **hoy**, y con objetivo automático ese número se
mueve solo: depende de cuántas unidades hay en ruta, así que un lunes con 12
combis y un jueves con 6 no tienen la misma vara. El informe de la semana
pasada juzgaba las vueltas del lunes con la vara del jueves, y **nadie podía
notarlo mirando la pantalla** — que es lo que lo hacía caro.

Ahora cada vuelta guarda en `laps.objetivoSec` el objetivo que regía cuando se
cerró, tomado en ese momento porque es el único en que existe: dentro de un
mes nadie puede reconstruir cuántas unidades había este martes a las 7. El
cuadro del gerente y el CSV de vueltas se miden contra ése.

Las vueltas anteriores a que esto existiera no lo tienen y no hay forma de
reconstruirlo: se siguen midiendo contra el objetivo de hoy, pero **la
pantalla dice cuántas son** en vez de mezclarlas callada. Con el tiempo ese
número llega solo a cero y el aviso desaparece solo.

## Rutas alternas (variantes del recorrido)

Una ruta no siempre se maneja igual. Hay desvíos **programados** —una obra
que dura tres meses, un feriado con desfile, el mercado de los domingos que
cierra dos cuadras— donde el trazado real cambió y va a seguir cambiado un
tiempo. Con un solo recorrido por ruta eso obligaba a redibujarlo y perder el
original, o a que todas las unidades figuraran fuera de ruta.

Por eso una ruta tiene **variantes**: cada una con su ida y su vuelta. Una
está activa y es la que mide; las demás quedan guardadas para el día que
haga falta.

- Tabla `route_variants` (`routeId`, `name`, `activa`, `desde`, `hasta`) y
  `route_points` colgando de la **variante**, no de la ruta. Las bases
  existentes migran solas: el recorrido que había pasa a ser la variante
  activa, llamada *Recorrido normal*. Toda ruta tiene al menos una.
- **Activar otra recalcula todo al instante**: progreso, brechas y desvíos
  se miden con el trazado nuevo sin tocar la app de nadie, porque el cálculo
  vive en el servidor. Las unidades en la calle reciben la línea nueva y el
  nombre de la variante, para que el chofer vea que el mapa cambió a
  propósito y no piense que el sistema se equivocó.

**Quién hace qué**, que es la parte que importa:

| | |
| --- | --- |
| **Nosotros** (panel del creador) | Creamos y borramos variantes, y las **dibujamos** en la pestaña RUTAS: las rutas se entregan ya trazadas al dar de alta la cooperativa, igual que el logo. Decidir que una ruta puede manejarse de dos maneras es cartografía, no operación del día |
| **Despacho** | **Elige** con cuál se mide, y puede corregir el dibujo con su propio trazador. No puede inventar una variante: solo llenar y elegir entre las que existen |

Cuatro cosas que hubo que resolver, y cómo:

- **Las vueltas en curso.** Al cambiar de variante, las que venían a medias
  se midieron con el trazado anterior y su progreso quedó corrido: se
  **descartan** y se arranca de nuevo. Perder una vuelta es mejor que guardar
  una medida hecha con dos geometrías. Queda dicho en la auditoría y el panel
  lo avisa antes de cambiar.
- **El promedio histórico.** Cada vuelta guarda con qué variante se midió
  (`laps.variantId`), y el objetivo automático **solo promedia las de la
  variante activa**. Al activar una nueva vuelve al valor manual hasta juntar
  historial propio — correcto: un trazado más largo tarda más. Al volver a la
  de siempre, su historial vuelve a valer.
- **La vigencia.** Una variante por obra puede tener fecha de inicio y de
  fin: se activa y se desactiva sola el día que corresponde, y también al
  arrancar el servidor (si estuvo apagado el día del cambio). Cuando la
  vigente se vence, vuelve la que no tiene fechas.
- **Dibujar sin romper nada.** Editar una variante guardada **no** le mueve
  el mapa a nadie ni recalcula ninguna brecha, que es medio el punto: se
  prepara el desvío antes de que empiece la obra. El trazador lo avisa en
  amarillo mientras se está dibujando una que no es la activa.

**Cuándo NO usar una variante:** para un embotellamiento de dos horas no vale
la pena — para eso está silenciar el desvío, que ya existe. La variante es
para cuando el recorrido cambió de verdad.

## Objetivo de brecha automático

**La matemática de la rueda:** si la vuelta dura 60 minutos y hay 12 unidades
repartidas, la separación natural entre una y otra es 60/12 = 5 minutos. El
sistema ya tiene los dos datos (historial de vueltas en `laps` y unidades en
ruta), así que puede calcular el objetivo en vez de que se cargue a mano.

Se prende por ruta desde el panel (Gestión → Rutas → **Automático**). Usa el
promedio de vuelta del **mismo día de la semana** —el tráfico de un domingo no
es el de un lunes— y si ese día todavía no juntó vueltas, cae al promedio
general. El chip de la tarjeta dice siempre de dónde sale el número: `AUTO · 12
vueltas · lunes`, `AUTO · faltan vueltas (2/3)`, `AUTO · sin unidades en ruta`
o `A MANO`.

Tres cuidados, que son la diferencia entre útil y molesto:

1. **Arranque en frío:** con menos de 3 vueltas **no se inventa nada** — vale
   el número cargado a mano, que queda siempre como respaldo. Igual si no hay
   ninguna unidad en ruta: sin combis no hay vuelta que repartir.
2. **Que no parpadee:** el objetivo tiñe los colores del HUD del chofer, así
   que se recalcula como máximo cada minuto y solo se mueve si el cambio pasa
   los 6 segundos.
3. **Topes:** el resultado queda entre 30 segundos y 30 minutos, por más raro
   que venga el historial.

Se recalcula cuando se cierra una vuelta y cuando cambia la cantidad de
unidades en ruta: si tres combis salen de servicio al mediodía, el objetivo
sube solo. Despacho puede volver a manual en cualquier momento, y cada cambio
queda en la auditoría.

## Empresas (varias cooperativas)

Arriba de las rutas hay un nivel más: la **empresa**. El modelo completo es
`empresa → rutas → vehículos y personas`, y la empresa es el borde de todo
lo que se consulta: rutas, gente, flota, turnos, vueltas, auditoría,
informes, chat, mapa y SOS. Ninguna cooperativa ve nada de otra.

Es lo que convierte esto de "el sistema de la R-14" en un producto que se
le puede vender a cualquier cooperativa sin levantar un servidor por cada
una.

- Tabla `companies` (`companyId`, `name`, `ruc`, `contacto`, `activa`) y
  columna `companyId` en `routes`, `users`, `vehicles` y `audit`. Lo que
  cuelga de una ruta —vueltas, turnos, mensajes, puntos del recorrido—
  hereda la empresa de su ruta y no repite el dato.
- Las bases existentes **migran solas**: todo lo que había pasa a la
  empresa inicial (`DEFAULT_COMPANY`, por defecto `R14`; su nombre visible
  sale de `DEFAULT_COMPANY_NAME`). Lo que cuelga de una ruta hereda la
  empresa de esa ruta, no la inicial.
- Los códigos de **ruta**, **vehículo** y **usuario** son únicos en todo el
  servidor, no por empresa: si dos cooperativas tuvieran una "R-14",
  cualquier consulta por `routeId` sería ambigua. Cuando un código está
  tomado, el error no dice de quién es.
  **Y por eso mismo, todo endpoint que reciba uno de esos códigos tiene que
  chequear la empresa aparte.** Se pagó una vez: el mensaje privado de
  Despacho solo comprobaba que el vehículo *existiera*, así que acertar el
  código de una combi ajena alcanzaba para escribirle a su chofer, y le
  llegaba. Hoy una combi de otra empresa se trata como inexistente y la
  suite `empresas` cruza un mensaje a propósito para que no vuelva.
- Pedir algo de otra empresa responde **404, no 403**: distinguirlos
  convertiría los endpoints en un buscador de rutas y usuarios ajenos.
- `activa = 0` suspende la cooperativa entera: nadie de esa empresa entra,
  y las sesiones abiertas se cierran en el momento. Es la palanca para
  cuando exista un plan o una licencia.
- El panel muestra **el nombre de su cooperativa**, no una marca fija, y
  los informes salen encabezados con ese nombre. La app del chofer lo
  recuerda en el celular: después del primer ingreso, la pantalla de login
  ya dice de qué cooperativa es. Un equipo recién instalado no muestra
  ninguna.

**Dar de alta una cooperativa no se hace desde el panel de Despacho.** Se
hace desde el nivel de arriba: el *panel del creador* (ver más abajo) o, si
ese no se puede abrir, la consola del servidor con `server/empresa.js`:

```bash
node server/empresa.js listar
node server/empresa.js alta COOP-15 "Cooperativa Santa Rosa" \
     --ruc 20123456789 --contacto "Juan Pérez 951..." \
     --ruta R-15 --nombre-ruta "Plaza ↔ Salida Cusco" \
     --despacho DESPACHO-15 --clave unaclavelarga
node server/empresa.js despacho COOP-15 DESPACHO-15 otraclave   # crea o resetea
node server/empresa.js ruta COOP-15 R-16 "Circunvalación"
node server/empresa.js desactivar COOP-15                       # suspender
node server/empresa.js activar COOP-15
```

El porqué está en *Niveles de seguridad*: quien puede crear una empresa
puede crearse un supervisor y mirar lo que quiera. Esa barrera no puede ser
una contraseña más.

Desde el panel, la pestaña **EMPRESA** muestra la ficha de la cooperativa y
su tamaño (rutas, flota, personas, cuentas de despacho, unidades en línea),
y la gerencia puede corregir nombre, RUC y contacto. El código no se
toca: de él cuelga todo lo demás.

## Quién puede qué (la línea entre los dos paneles)

Hay dos paneles y **no se pisan**. La regla que ordena todo: **la estructura
la define el nivel de arriba, la operación del día es de la cooperativa.**

Adentro de la cooperativa hay a su vez dos niveles en el MISMO panel: el
administrador del día (`dispatch`) y el gerente (`manager`) — ver *El
gerente*, más abajo.

Y hay un tercer lugar donde se administra algo, chico y acotado a
conciencia: **el chofer, sobre los cobradores de SU combi** (columna
*Chofer*). Puede cambiarles la clave y sacarlos — lo del día a día, que
esperando a Despacho termina en los dos usando la misma cuenta. **El alta
no**: crear una cuenta es dar acceso al sistema y se queda arriba. Es la
misma regla de siempre, no una excepción — la estructura la define el nivel
de arriba, la operación del día es de abajo.

| | Chofer | Despacho (admin) | Gerente | Creador |
| --- | :---: | :---: | :---: | :---: |
| Cobradores **de su propia combi**: baja y clave | ✅ | ✅ | ✅ | — |
| **Alta** de un cobrador (crear la cuenta) | — | ✅ | ✅ | — |
| Su **propio** alias y su **propia** contraseña, desde la app | ✅ | — | — | — |
| Personas: alta sobre vehículos existentes, baja, claves, identidad | — | ✅ | ✅ | — |
| Vehículos (el activo, con su placa) | — | — | ✅ | — |
| Objetivo de brecha (manual o automático) | — | ✅ | ✅ | — |
| Umbral de desvío y silenciarlo | — | ✅ | ✅ | — |
| Dibujar el recorrido (trazador) | — | ✅ | ✅ | ✅ |
| **Elegir** con qué trazado se mide | — | ✅ | ✅ | — |
| Turnos, vueltas, informes | — | ✅ | ✅ | — |
| Datos de su cooperativa (nombre, RUC, contacto) y logo | — | — | ✅ | — |
| Números del período (cumplimiento) | — | — | ✅ | — |
| Actividad **de su cooperativa** | — | ✅ | ✅ | — |
| | | | | |
| **Crear** una cooperativa | — | — | — | ✅ |
| **Crear** una ruta | — | — | — | ✅ |
| **Crear y borrar** trazados de una ruta | — | — | — | ✅ |
| Suspender una cooperativa | — | — | — | ✅ |
| Crear o restablecer cuentas de Despacho y de gerencia | — | — | — | ✅ |
| Salud del servidor y de la base | — | — | — | ✅ |
| Actividad de **todas** las cooperativas | — | — | — | ✅ |

Tres detalles que explican los casos raros:

- **Crear rutas era de Despacho y se movió arriba.** Quedaba incoherente que
  no pudiera crear una *variante* de un recorrido —eso es cartografía— pero
  sí una ruta entera, que es un acto más grande. Además la ruta es la unidad
  por la que se cuenta y se factura una cooperativa.
- **Dibujar sí es de Despacho**, aunque los trazados los creemos nosotros. El
  mapa vive en su panel y el trabajo de marcar calles se puede delegar; lo
  que no pueden es decidir qué trazados existen.
- **Restablecer claves está en los dos, y está bien.** Despacho resetea a su
  gente; el creador puede resetear la cuenta de Despacho, que es la salida
  cuando una cooperativa se queda afuera de su propio panel. Queda registrado
  en la actividad de esa cooperativa.

## La presencia: salir a ruta, ausente, fuera

La app del chofer ya no emite desde el login. Después de entrar, la pantalla
del medio es una puerta: **"¿Salís a ruta?"**, con el mismo deslizar del SOS
— un gesto deliberado, no un toque al pasar. Hasta ahí no se emite señal, el
mapa está vedado (es el mapa DE LA RUTA) y el chat queda abierto.

Tres estados, declarados desde la app:

| Estado | Qué pasa |
| --- | --- |
| **En ruta** | Se emite posición. Pero declarar NO mete a la unidad en la cadena de brechas: eso lo **confirma el servidor** cuando el GPS la ve sobre el trazado (mismo umbral que el desvío). Hasta entonces está "yendo": visible para Despacho, invisible para las brechas — Ignacio marcando desde su casa a las 5:30 no le mueve la brecha a nadie que pase cerca |
| **Ausente** | Comer, un repuesto, un descanso. Se sigue emitiendo (Despacho ve dónde está la combi, apagada en el mapa) pero fuera de la cadena: nadie se mide contra ella, su vuelta a medias se descarta, y los vecinos se recomponen. Volver exige reconfirmar sobre el trazado. Y los dos olvidos humanos se resuelven solos (`app/ausencia.js`, en la tarea de fondo): si el GPS lo ve **alejarse** del lugar donde se quedó, vuelve a ruta solo; si la ausencia pasa las **2 horas**, ya no es un almuerzo y pasa a fuera — sin emitir la ubicación de la casa toda la noche |
| **Fuera** | Terminó. Deja de emitir y se va del mapa EN EL ACTO, sin esperar al olvido de 3 minutos. La app sigue sirviendo para chatear |

La presencia viaja por el WebSocket y **pegada a cada `POST /gps`**: con la
pantalla apagada no hay WebSocket, y así el estado declarado sobrevive hasta
a un reinicio del servidor. Si Android mata la app a mitad de turno, al
reabrirla retoma sola el estado guardado. Los clientes que no declaran nada
(la flota fantasma vieja, un APK anterior) se comportan como siempre: en
cadena desde la primera posición. Suite `presencia`.

## El gerente: la cuenta de arriba del panel de Despacho

**Gerencia y Despacho se fusionaron: un solo panel, dos niveles.** El gerente
entra por `despacho.html` con su cuenta de rol `manager` y ve todo lo que ve
Despacho —el mapa en vivo, el chat, la gestión— más lo que es solo suyo. La
diferencia no es la pantalla: son los PERMISOS. El administrador del día
opera lo que existe; el gerente decide **qué existe** — los activos de la
cooperativa:

| | Despacho (admin) | Gerente |
| --- | :---: | :---: |
| Mapa en vivo, chat, SOS, turnos | ✅ | ✅ |
| Alta de personas (choferes y cobradores) sobre vehículos existentes | ✅ | ✅ |
| Objetivo de brecha, umbral de desvío, elegir trazado | ✅ | ✅ |
| Informes CSV | ✅ | ✅ |
| **Vehículos** (alta, con su placa) | — | ✅ |
| Chofer nuevo **con combi nueva** de una | — | ✅ |
| **Datos de la empresa** (nombre, RUC, contacto) | — | ✅ |
| **Logo** | — | ✅ |
| Pestaña **Números** (cumplimiento del período) | — | ✅ |

La pestaña **Números** (Gestión → Números) es la vieja pantalla de gerencia:
cumplimiento contra el objetivo de cada ruta (la misma tolerancia del 15 %
que pinta de verde el mapa), vueltas, brecha promedio, horas y SOS del
período, unidad por unidad, y los CSV para llevar a una reunión. Solo el
gerente la ve: los números miden, entre otras cosas, el trabajo de Despacho,
y nadie audita su propio trabajo. Por lo mismo, `/gerencia/*` sigue
respondiendo 403 a un token de Despacho.

**Las cuentas de gerencia las crea el nivel de arriba**, no Despacho — desde
el panel del creador o con `empresa.js gerencia`, con alcance a una ruta o a
toda la cooperativa. Despacho **ve** al gerente en su lista de personas —que
esté a la vista es parte de que se sepa quién mira— pero no le puede tocar
la clave, el nombre ni darlo de baja. Un gerente acotado a UNA ruta tampoco
toca lo que es de toda la empresa (datos, logo).

`gerencia.html` quedó como una redirección al panel, para los marcadores
viejos.

## Panel del creador

El nivel que está por encima de todas las cooperativas, hecho pantalla. Es
donde se dan de alta las empresas, se les crea o restablece la cuenta de
Despacho, se les agregan rutas y se las suspende; además muestra la salud
del servidor y la actividad de todas juntas — el único lugar del sistema
donde se ven así. Lo que se cargó también se **corrige** sin dar nada de
baja: nombre, RUC y contacto de la cooperativa, y el nombre de cada ruta —
los códigos no, porque de ellos cuelga todo lo demás. La tarjeta muestra lo
que se necesita al hablar con la cooperativa: RUC, contacto, fecha de alta,
rutas con su nombre y el último ingreso de las cuentas de Despacho y
gerencia.

**Es sobrio a propósito, no oscuro.** Usa los mismos tokens claros que el
panel de Despacho; lo que lo hace herramienta interna es que no tiene marca,
ni gradientes, ni "recordarme", y que la cabecera dice en la cara que la
sesión muere al cerrar la pestaña. En *Sistema*, los avisos —dónde vive la
base, si falta el segundo factor— van **arriba** de las tarjetas de salud:
son lo único de esa pantalla que pide hacer algo hoy, y un número más entre
doce no lo es. Suspender una cooperativa abre una confirmación que nombra
cuál y cuenta la consecuencia en gente concreta: cuántas cuentas de Despacho
y cuántos choferes y cobradores pierden el acceso en el acto.

**Está apagado.** Se enciende con variables de entorno, y sin ellas las
rutas ni siquiera se registran:

Desde acá también se manejan los **trazados de cada ruta**: crear una
variante, copiarla de otra (un desvío suele ser el recorrido de siempre con
dos cuadras distintas), programarle vigencia y borrarla. Ver *Rutas
alternas*.

Y se **dibujan**, en la pestaña RUTAS: las rutas se entregan ya trazadas al
dar de alta la cooperativa, igual que el logo. El mapa (Leaflet) lo sirve el
**propio panel** desde `server/vendor/` — no un CDN: pasó que unpkg no
entregó `leaflet.js` y elegir una ruta dejaba la página en blanco. Y si aun
así algo no llega o se rompe, el panel lo **dice** en un cartel con el error
a la vista (muro de contención de React) en vez de quedar mudo en blanco.
El trazador de acá tiene las
herramientas que al de Despacho le faltan — un clic **sobre la línea**
inserta en el medio (densificar una curva sin rehacer desde ahí), modo
SELECCIONAR (dos clics y se borra la cuadra que quedó entre ellos), deshacer
con Ctrl+Z, modo mano (o la barra espaciadora, mientras se la tenga
apretada) e importar GPX o GeoJSON. La geometría y la edición viven en
`server/trazador.js`, que Node prueba con `require()` y el navegador carga
tal cual; el guardado pasa por la **misma función** que usa el trazador de
Despacho — validación, transacción, recarga de geometría y aviso a los mapas,
escritos una sola vez. Lo guardado sobre el trazado que está midiendo sale
en el mapa de esa cooperativa al instante.

| Variable | Qué hace |
| --- | --- |
| `CREATOR_PASSWORD` | **Enciende el panel.** Mínimo 12 caracteres: con menos, el panel queda apagado y el arranque dice por qué. Sin esta variable no hay panel |
| `CREATOR_PATH` | Mueve el panel a una ruta propia (`/gestion-x9k2`). Por defecto `/creador` |
| `CREATOR_TOTP_SECRET` | Segundo factor: además de la clave, el código de 6 dígitos de una app de autenticación. Base32. Si el valor está mal escrito, el panel queda **apagado** en vez de arrancar sin el factor que se pidió |

**Por qué no es un rol más del login**, que era la condición. Son cuatro
barreras que se suman:

1. **Apagado por defecto.** Sin `CREATOR_PASSWORD`, las rutas del creador no
   existen: responden **404**, no 401 ni 403. Un panel apagado es
   indistinguible de un servidor que nunca lo tuvo — no se puede atacar lo
   que no está.
2. **Credencial aparte.** No es un usuario de la tabla `users`. No hay
   ninguna fila de la base que dé este acceso, así que no se llega acá desde
   una cuenta de Despacho ni comprometiéndola.
3. **Ruta no adivinable.** `CREATOR_PATH` lo saca de cualquier barrido
   automático de URLs conocidas. No alcanza solo —por eso hay clave— pero
   suma.
4. **Segundo factor opcional.** TOTP implementado con `crypto`, sin
   librerías: son veinte líneas que no cambian nunca, y una dependencia
   menos en el camino de la puerta principal.

Y encima: las sesiones viven **solo en memoria** y duran 2 horas sin
renovarse; reiniciar el servidor las cierra todas. El token del creador no
sirve en `/admin` y el de Despacho no sirve acá. La pantalla no guarda nada
en el navegador —ni `localStorage` ni `sessionStorage`—, no se cachea y no
se indexa: cerrar la pestaña es cerrar la sesión.

**Fuerza bruta:** 5 intentos fallidos desde un origen lo bloquean 15
minutos, y *cada* intento tarda medio segundo fijo, acierte o no. Eso hace
inviable adivinar en línea y de paso aplana el tiempo de respuesta, que si
no cuenta cosas. Cuando hay segundo factor, el error no dice si falló la
clave o el código: decirlo confirmaría media credencial.

**Lo que hace el creador queda registrado, y no a escondidas.** Restablecer
la clave de un Despacho o crearle una ruta a una cooperativa aparece en la
pestaña ACTIVIDAD **de esa cooperativa**, firmado `CREADOR`. Lo único que no
ven es el login del creador, que no es de nadie. El nivel de arriba puede
todo, pero deja rastro para abajo.

**`empresa.js` sigue existiendo** y conviene que siga: es el piso. Es la
salida cuando el panel no se puede abrir —clave perdida, deploy a medias,
base a mano—. Las dos puertas comparten las mismas operaciones y las mismas
validaciones (`cooperativas.js`): escritas dos veces se habrían separado, y
son justamente las que no pueden.

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
- **Un SOS escala**: llega a su ruta y además a todos los supervisores de
  **esa cooperativa**, aunque estén mirando otra ruta (el banner marca de
  cuál viene). No cruza de empresa: el supervisor de al lado no tiene nada
  que hacer con esa emergencia y vería la ubicación exacta de una unidad
  ajena.

**Dos tipos de cuenta de despacho**, según `users.routeId` — siempre dentro
de su empresa:

| | Alcance |
| --- | --- |
| **Supervisor** (`routeId` NULL) | Todas las rutas **de su empresa**: las ve, las administra, cambia con el selector del panel y crea rutas nuevas. Es lo que queda la cuenta `DESPACHO` inicial |
| **Despachador de ruta** (`routeId` con valor) | Solo su ruta: no ve, ni administra, ni recibe nada de las demás |

Y una regla dura, que es la que sostiene el aislamiento: **toda cuenta
pertenece a una empresa**. No existe la cuenta sin empresa que ve todo —
una así no pasa de `/admin`. El nivel de arriba vive fuera de la
aplicación.

## Desvío de ruta

Con el recorrido cargado, el servidor sabe a cuántos metros del trazado va
cada unidad. Está pensado como **gestión y no como alarma**, porque en una
ciudad siempre hay desvíos —una obra, un desfile, un embotellamiento— y un
sistema que grita en cada uno se apaga el primer día.

- **Solo cuenta si se sostiene:** 10 posiciones seguidas por afuera (unos 30
  segundos). Un salto de GPS no alcanza; doblar en la esquina equivocada sí.
  Para volver bastan 4.
- **El umbral es por ruta** (`routes.desvioMaxM`): **300 m por defecto**, que
  en la traza de Juliaca son unas **tres cuadras**. Un chofer puede tomarse un
  desvío de esa magnitud sin que sea un problema —esquivar un embotellamiento,
  una calle cortada— y marcarlo sería ruido; recién más allá deja de ser "el
  camino de siempre con una vuelta" y pasa a ser otro recorrido. Se ajusta
  entre 50 y 1500 m: no es lo mismo el centro que la salida a Huancané.
- **Despacho puede silenciarlo** 1 h, 3 h o el turno, cuando el desvío ya se
  sabe. Silenciar **no es quedar ciego**: las unidades se siguen viendo fuera
  de ruta en el panel; lo que se corta es el registro repetido en la
  auditoría.
- **Al chofer no se le dice nada.** Puede tener un motivo, y un cartel
  acusándolo mientras maneja es peor que el problema.

En el panel, los desvíos se agrupan en un aviso arriba de la lista de
unidades (cuál y a cuántos metros), y cada fila lleva su chip
`FUERA DE RUTA · 150 m`. **Mientras la ruta no tenga recorrido cargado no se
marca nada** — no hay con qué comparar.

### Y quedan guardados

El desvío se veía en vivo y se perdía: al día siguiente no había forma de
contestar *"¿cuántas veces se salió M-17 la semana pasada, y por cuánto
tiempo?"*. Un desvío aislado es una obra; el mismo desvío todos los días es
otra cosa, y mientras no se guarden las dos se ven igual.

Ahora cada salida queda en `deviations`, **una fila por episodio y no por
posición**: cuándo empezó, cuándo volvió, a cuánto llegó como máximo, contra
qué umbral se la midió —cambia por ruta y se puede editar, así que "340 m" no
significa lo mismo en dos rutas— y si estaba silenciada.

- **Silenciado se guarda igual**, marcado como silenciado. Silenciar es "ya lo
  sé, no me avises más", no "esto no pasó": si el silencio borrara el
  registro, la forma de que un desvío no apareciera en el informe sería
  apretar el botón de silencio.
- **Ningún episodio queda abierto.** Lo cierran los tres caminos posibles, y
  cada uno queda anotado porque no significan lo mismo: *volvió al recorrido*,
  *dejó de reportar* (se quedó sin señal o terminó el turno estando afuera) y
  *le cambiaron el trazado* — de este último ni siquiera se puede afirmar
  cuánto duró el desvío, porque a mitad de camino cambió contra qué se lo
  medía. Los que quedaron abiertos por un apagón del servidor se cierran al
  arrancar. Sin esto una fila crecería sola y el informe del mes diría que una
  combi estuvo cuatro días fuera de ruta.

Se ven en el cuadro del gerente (columna **Salidas**: cuántas y cuántos
minutos en total) y en el informe `desvios.csv`.

## Turnos

Quién manejó qué unidad y cuánto tiempo. Se registra **solo lo que el sistema
ya ve solo**: el turno se abre cuando alguien entra a su unidad y se cierra
cuando se va. Panel → Gestión → **Turnos**, con hoy, ayer o esta semana: por unidad,
quién iba arriba, hora de entrada, de salida y cuánto llevó en ruta.

Dos cosas que lo hacen utilizable en la calle y no solo en la demo:

- **Un corte de señal no parte el turno.** Si la misma persona vuelve a la
  misma unidad dentro de los 15 minutos, se retoma el turno que estaba en vez
  de abrir otro. En ruta se pierde señal todo el tiempo; sin esto, un turno de
  8 horas quedaría partido en veinte pedazos.
- **Si el servidor se reinicia**, los turnos que quedaron abiertos se cierran
  con la última señal que se les vio (`lastSeenAt`, que se marca una vez por
  minuto). Sin eso quedarían abiertos para siempre y las horas darían
  cualquier cosa.

A propósito **no es un sistema de recursos humanos**: no hay corrección
manual, ni fichaje, ni aprobación. Para las excepciones —se olvidó de salir de
la app, prestó el celular— hace falta edición a mano, y eso es otra discusión.
Lo que hay sirve para saber quién iba en la unidad cuando pasó algo y para el
informe de horas trabajadas.

## Informes

Panel → Gestión → **Informes**. Se elige un rango de fechas y se bajan los
seis informes de ese período:

| Informe | Qué trae |
| --- | --- |
| **Vueltas por unidad** | Cuántas vueltas hizo cada combi, cuánto tardó, a qué velocidad, y la brecha que mantuvo **con el objetivo de esa vuelta al lado**. Dos columnas dicen si la vuelta es entera y, si no, por qué punto del circuito entró esa unidad |
| **Medias vueltas** | Cada ida y cada retorno que se completó. Es el informe que contesta "hizo la ida y se fue": un día con muchas más idas que retornos tiene una explicación |
| **Horas por persona** | Turnos: entrada, salida y horas de cada chofer y cobrador |
| **Salidas del recorrido** | Cada desvío: cuándo salió, cuándo volvió, cuánto duró, a cuánto llegó y cómo terminó |
| **Emergencias** | Cada SOS con quién lo disparó, desde qué unidad y dónde |
| **Actividad de administración** | Altas, bajas, reseteos de clave y cambios de configuración |

Bajan en **CSV** y no en PDF a propósito: se abren en Excel, se pueden sumar y
filtrar, y no hace falta ninguna librería en el servidor. Van con separador
punto y coma y BOM, que es lo que el Excel en español abre bien de una.

**Cada informe arranca diciendo con qué se midió.** Es la parte más
importante: si la ruta no tiene recorrido cargado, la primera línea aclara que
las vueltas son estimaciones y no medidas. Un informe con números que parecen
precisos y no lo son es peor que no tener informe.

El período máximo son 90 días, y un despachador de ruta solo puede sacar los
de la suya. El gerente tiene los cuatro que más mira —vueltas, medias vueltas,
turnos y salidas— como botón directo arriba de sus números.

## Qué frena cada cosa

Repasado antes de salir a la calle con cuentas reales:

| Ataque | Qué lo frena |
| --- | --- |
| Adivinar la clave de una cuenta | 5 fallos → 5 minutos bloqueada |
| Probar una clave contra muchas cuentas | 30 fallos desde un mismo origen en 10 minutos → 10 minutos bloqueado. Un usuario inexistente también suma, así que probar nombres no sale gratis |
| Meter HTML en un identificador para ejecutar código en el navegador de otro encargado | Los identificadores solo admiten letras, números, punto, guion y guion bajo, y además se escapan al pintarlos |
| Inundar el chat o mandar notas de voz sin parar con una sesión válida | Cupo por conexión: 30 chats, 10 notas y 40 posiciones por minuto |
| Mandar un mensaje enorme para tumbar el servidor | Se descarta por encima de 2,1 MB, antes de intentar leerlo |
| Un chofer entrando a la administración | `/admin/*` exige rol de Despacho (403) y un despachador de ruta solo toca lo suyo |
| Un despachador pidiendo datos de otra cooperativa (por URL, por parámetro o cambiando de ruta en el panel) | Todo `/admin` y todo el tiempo real filtran por empresa. Lo ajeno responde **404**, igual que lo inexistente: no sirve para averiguar qué rutas o usuarios hay del otro lado |
| Una cuenta creada a mano en la base, sin empresa | No pasa de `/admin` (403). No hay "sin empresa = ve todo" |
| Buscar el panel del creador | Si `CREATOR_PASSWORD` no está, no existe (404). Si está, `CREATOR_PATH` lo saca de las URLs conocidas |
| Adivinar la clave del creador | 5 fallos desde un origen → 15 minutos bloqueado, y cada intento tarda 500 ms fijos aunque acierte |
| Llegar al creador desde una cuenta de Despacho robada | No hay camino: la credencial del creador no está en la tabla `users`, y su token vive en otro lado. Un token de Despacho da 401 en el panel del creador, y al revés |
| Un token inventado o vencido | 401, y el cliente vuelve al login |

El detalle de lo que **no** cubre está en `LIMITACIONES.md`, sección E.

## Niveles de seguridad

1. **Chofer y cobrador** — su clave abre solo su sesión; no pueden tocar
   `/admin`. Dar de baja a un cobrador no toca al chofer ni al vehículo,
   y un cobrador no hereda permisos del chofer.
2. **Despacho** — administra las claves de los choferes **de su
   cooperativa**; cada uso de ese poder queda en la tabla `audit`. No puede
   eliminar su propia cuenta. Un supervisor manda sobre todas las rutas de
   su empresa y sobre ninguna de otra.
3. **Creador (nosotros)** — puede crear cooperativas, y quien puede crear
   una puede crearse un supervisor adentro y mirar lo que quiera. Es el
   poder más grande del sistema, y por eso **no se llega desde el login de
   siempre**: hace falta una clave que no está en la base, un panel que solo
   existe si una variable de entorno lo enciende y, si se configura, un
   segundo factor. Ver *Panel del creador*.
4. **Operador (dueño de la infraestructura)** — está por encima de todo
   **sin clave ninguna**: controla el deploy, las variables de entorno y el
   archivo de la base. Es quien decide si el nivel 3 existe.

### Lo que se cerró en la revisión del 8/8

Una revisión de seguridad del sistema entero —no de un cambio— encontró ocho
cosas. Ninguna se veía usando la app, y ésa es la parte que conviene recordar:

- **El bootstrap de `DESPACHO` era una puerta abierta con nombre conocido.**
  Si esa fila no existía —y `DISPATCH_PASSWORD` es opcional, y una cooperativa
  provisionada desde el panel del creador recibe su supervisor con otro
  nombre— el primer `POST /auth/login` anónimo del mundo se creaba la cuenta
  que administra a todos, con la clave que el atacante mandara. Ahora el
  bootstrap sólo corre si **no existe ninguna cuenta de administración**: si
  ya hay a quién pedirle el alta, la puerta no tiene por qué existir.
- **El bloqueo por origen no bloqueaba nada.** Leía el primer elemento de
  `X-Forwarded-For`, que es justo el pedazo que escribe el cliente: una
  cabecera distinta por pedido y cada intento estrenaba contador. Era el único
  freno contra probar una contraseña en las 2000 cuentas, y el único del login
  del panel del creador. Ahora se cuenta desde la derecha, con `TRUST_PROXY`
  diciendo cuántos proxies hay adelante (**1 por defecto, Railway; poner 0 si
  se corre sin proxy**).
- **No existía cerrar sesión.** El "salir" de las pantallas borraba el token
  del navegador y nada más: en el servidor seguía valiendo 30 días. Ahora hay
  `POST /auth/logout`, con variante `{todas:true}` para el teléfono perdido.
- **Cambiar la contraseña propia no cerraba las otras sesiones**, así que no
  servía contra la amenaza que la justifica —un token copiado de un teléfono
  desbloqueado—. Ahora las cierra, menos la del que la está cambiando.
- **Las grabaciones y el logo se saltaban el alcance por ruta**: una gerencia
  atada a una ruta bajaba los trazados de las otras y podía cambiarle la marca
  a toda la cooperativa.
- **El WebSocket se autenticaba una sola vez.** Suspender una cooperativa por
  falta de pago borraba las filas de sesión y no cortaba a nadie que dejara la
  conexión abierta: seguía recibiendo el mapa y el chat. Ahora se revalida cada
  minuto y se cierra.
- **Lo que manda el teléfono no se miraba** en el WebSocket, aunque el POST sí
  lo mirara. Un `routeProgress: 999` no le arruinaba los números al que lo
  mandaba sino **al de adelante** (la brecha se acumula en la vuelta del de
  atrás); una latitud `"x"` llegaba hasta Leaflet y dejaba en blanco la
  pantalla de todos los despachadores de esa ruta; y un SOS con coordenadas
  basura mataba el proceso en el `toFixed` de la auditoría.
- **La hora de los mensajes la ponía el cliente.** Un SOS con `timestamp: 1`
  sonaba en Despacho y quedaba guardado en 1970: no salía en el informe de
  emergencias, no salía en el conteo del gerente, y la poda lo borraba por
  viejo. La emergencia ocurría y no dejaba rastro. Ahora la hora declarada se
  acota a la misma ventana que las posiciones.

Todo con prueba puesta: suite `puertas`. Lo que la revisión verificó como sano
está en su informe — vale la pena saber que la parte más grande salió limpia:
el aislamiento entre cooperativas, el hash de contraseñas, los tokens, los
bordes de rol, el panel del creador y las rutas de archivos.

### El registro abierto ya no depende de que alguien se acuerde

Quedaba una puerta cruzada entre cooperativas, y la única que quedaba:
`OPEN_REGISTRATION=1`. Quien se auto-registra **elige su código de usuario** y
queda **sin vehículo**, y "mi combi" se resolvía como `vehicleId || unitId`
buscando después por un `unitId` que es único en todo el servidor. Registrarse
con el código de una combi ajena —son cortos y predecibles— alcanzaba para
cambiarle la clave y dar de baja a los cobradores de **otra cooperativa**.
Medido: sin el arreglo, el ataque devuelve 200 y el cobrador desaparece.

Se cerró por los dos lados:

- **El servidor se niega a arrancar** si encuentra `OPEN_REGISTRATION=1` sin
  `MODO=demo`, con un mensaje que nombra la variable, explica el riesgo y dice
  cómo seguir. Antes era un cartel en el log, y un cartel depende de que
  alguien lo lea: las variables de un deploy se copian del deploy anterior.
- **`cobradorDeSuCombi` compara también la empresa.** El arranque ya impide
  que un auto-registrado exista en producción; esto hace que la regla "un
  chofer sólo toca a los suyos" valga sola, sin depender de qué variables
  tenga el deploy.

**Qué cuenta como producción**: todo lo que no esté marcado explícitamente
como demo. El repo no tenía ningún criterio —no usa `NODE_ENV` ni mira las
variables de Railway— así que se eligió el conservador. Al revés (suponer
desarrollo salvo que digan producción) el olvido sale barato en la máquina del
que programa y caro en el servidor de la cooperativa, que es donde el olvido
de verdad ocurre.

### Qué viaja adentro del APK

Un APK es un archivo comprimido: cualquiera de los 2000 choferes puede abrirlo
y leerlo. Se revisó una sola pregunta —¿hay credenciales adentro?— y la
respuesta es **no**. Lo que sí viaja, y por qué está bien:

| Qué | Veredicto |
| --- | --- |
| `EXPO_PUBLIC_SERVIDOR` (la URL del servidor) | Público por necesidad: la app tiene que saber a dónde hablar. El prefijo `EXPO_PUBLIC_` es justamente la convención de Expo para "esto se incrusta en el paquete" |
| `extra.eas.projectId` | Identificador del proyecto de compilación, no una credencial |
| La URL de las tiles de Geoapify | Sólo el **host**; la clave no |
| `https://localhost` en el WebView del mapa | Es la etiqueta de origen del HTML embebido, no un servidor |

**La clave del mapa NO va compilada en el APK, a propósito** — rotarla
obligaría a repartir una app nueva a toda la flota. Viaja en la respuesta del
login, que exige autenticación (`server/index.js:2057-2062`). No hay keystore,
ni `google-services.json`, ni claves de push o SMS, ni cadenas de conexión, ni
la ruta del panel del creador (que sólo aparece en comentarios). El historial
de git tampoco tiene ninguna clave de mapas commiteada.

Queda **una cosa para decidir, y no es de código**: los paneles web reciben esa
misma clave por `GET /config.js`, que es **público** — tiene que serlo, porque
el navegador la necesita antes de que alguien inicie sesión. Es normal en
cualquier mapa web y no expone datos de nadie, pero es una clave que se
factura: conviene restringirla por dominio en el panel de Geoapify. Eso se
hace allá, no acá.

   **Rutas de recuperación**: si la clave de Despacho de la cooperativa
   inicial se pierde o filtra, setear/cambiar `DISPATCH_PASSWORD` y
   reiniciar — la cuenta se resetea al arrancar. Para las demás,
   `node server/empresa.js despacho <empresa> <usuario> <clave>`. Si se
   pierde la del creador, cambiar `CREATOR_PASSWORD` y reiniciar (eso
   además cierra todas sus sesiones abiertas, que viven en memoria).

   Quien accede al repo o al archivo `r14.db` puede todo; ese es el "root"
   real del sistema, y ninguna clave de la aplicación lo detiene.

## Panel de tweaks

La página expone un panel de escenarios (tiempos, objetivo, modo de luz)
que se activa con `postMessage({ type: '__activate_edit_mode' })` desde la
ventana padre (lo usa el entorno de diseño).
