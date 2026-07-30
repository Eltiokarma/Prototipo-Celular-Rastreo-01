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
  creador.js          Panel del creador: el nivel de arriba de todas las
                      cooperativas. Apagado salvo que CREATOR_PASSWORD esté
                      en el entorno. En su propio archivo para que toda su
                      superficie se lea de una sentada
  creador.html        Su pantalla. NO vive en project/ a propósito: ahí se
                      serviría como estático aunque el panel esté apagado

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

**Variables de entorno**, todas opcionales salvo donde se aclare:

| Variable | Para qué |
| --- | --- |
| `DB_FILE` | Dónde vive la base. En Railway hay que montar un volumen y apuntarla ahí (`/data/r14.db`) o **un redeploy borra todo** |
| `PORT` | Puerto (3001 por defecto) |
| `DISPATCH_PASSWORD` | Crea o actualiza la cuenta `DESPACHO` al arrancar. Es la ruta de recuperación si esa clave se pierde |
| `DEFAULT_ROUTE` / `DEFAULT_COMPANY` / `DEFAULT_COMPANY_NAME` | Código de la ruta y de la cooperativa iniciales, y su nombre visible. Solo se usan la primera vez |
| `CREATOR_PASSWORD` | **Enciende el panel del creador.** Sin esta variable, ese panel no existe. Mínimo 12 caracteres |
| `CREATOR_PATH` | Mueve el panel del creador a una ruta propia (por defecto `/creador`) |
| `CREATOR_TOTP_SECRET` | Segundo factor del panel del creador (base32) |
| `OPEN_REGISTRATION` | `1` deja que cualquiera se registre. **Solo para demos** |
| `STATE_INTERVAL_MS` | Cada cuánto se emite el estado (3000 por defecto) |

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

**Cómo se carga** — panel → Gestión → RUTAS → botón *Recorrido*:

- **Tocando el mapa**, un tramo a la vez: se elige IDA o VUELTA arriba y se
  marca en el orden en que se maneja; el primer punto de cada tramo es la
  salida (**A**) y el último el final (**B**). El tramo que no se está
  editando queda punteado de fondo, para poder calzarlos. Se arrastra un
  punto para corregirlo y se lo toca para borrarlo; hay *Deshacer* y *Borrar*,
  y arriba se ven los puntos y los km de cada tramo. Funciona igual con el
  mouse en PC que con el dedo en un celular.
- **Importando un GPX o GeoJSON** al tramo activo, por ejemplo de esa mitad
  grabada manejando. Se simplifica con Douglas-Peucker (tolerancia 10 m): un
  GPX de 600 puntos queda en unas decenas **sin cambiar la forma**. Tope:
  2000 puntos por tramo.

Una ruta sin recorrido cargado sigue funcionando con la estimación lineal de
siempre, así que se puede ir cargando ruta por ruta. El trazado se dibuja en
el mapa del panel y en el del chofer —la vuelta punteada, para distinguirla
de la ida cuando comparten calle— y **viaja una sola vez** (al conectar, al
cambiar de ruta o cuando se edita), nunca dentro del estado, que sale cada
3 s: mandar ahí una ruta de 300 puntos serían ~7 KB por emisión y tiraría por
la borda el ahorro de datos de `ESCALABILIDAD.md`.

## Objetivo de brecha automático

**La matemática de la rueda:** si la vuelta dura 60 minutos y hay 12 unidades
repartidas, la separación natural entre una y otra es 60/12 = 5 minutos. El
sistema ya tiene los dos datos (historial de vueltas en `laps` y unidades en
ruta), así que puede calcular el objetivo en vez de que se cargue a mano.

Se prende por ruta desde el panel (Gestión → RUTAS → **Automático**). Usa el
promedio de vuelta del **mismo día de la semana** —el tráfico de un domingo no
es el de un lunes— y si ese día todavía no juntó vueltas, cae al promedio
general. El chip de la fila dice siempre de dónde sale el número: `AUTO · 12
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
y el supervisor puede corregir nombre, RUC y contacto. El código no se
toca: de él cuelga todo lo demás.

## Panel del creador

El nivel que está por encima de todas las cooperativas, hecho pantalla. Es
donde se dan de alta las empresas, se les crea o restablece la cuenta de
Despacho, se les agregan rutas y se las suspende; además muestra la salud
del servidor y la actividad de todas juntas — el único lugar del sistema
donde se ven así.

**Está apagado.** Se enciende con variables de entorno, y sin ellas las
rutas ni siquiera se registran:

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

## Turnos

Quién manejó qué unidad y cuánto tiempo. Se registra **solo lo que el sistema
ya ve solo**: el turno se abre cuando alguien entra a su unidad y se cierra
cuando se va. Panel → Gestión → **TURNOS**: horas por persona arriba, y el
detalle de cada turno abajo con hora de entrada, de salida y unidad.

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

Panel → Gestión → **INFORMES**. Cuatro informes, cada uno con período de hoy,
7 o 30 días:

| Informe | Qué trae |
| --- | --- |
| **Vueltas por unidad** | Cuántas vueltas hizo cada combi, cuánto tardó y a qué velocidad |
| **Horas por persona** | Turnos: entrada, salida y horas de cada chofer y cobrador |
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
de la suya.

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
