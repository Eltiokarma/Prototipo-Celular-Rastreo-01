# Protocolo del servidor — COOP-R14

Lo que un cliente tiene que hablar para funcionar contra `server/index.js`.
Existe porque se viene una app nativa (`PROMPT-REACT-NATIVE.md`) y el
protocolo estaba solo en la cabeza de `project/realtime.js`: cada cosa de acá
está **observada de una corrida real**, no leída del código.

Para regenerar el volcado, ver *Cómo se verificó* al final.

---

## 1. Entrar: `POST /auth/login`

```json
{ "user": "M-12", "password": "chofer1234", "app": { "version": "0.2.3", "versionCode": 5 } }
```

`app` es opcional y es lo que la app nativa manda de sí misma (leído de la
instalación con `expo-application`); el servidor lo anota en `users` y
Despacho lo ve en Unidades. Cualquier pedido autenticado puede traer lo
mismo en la cabecera `X-App-Version: 0.2.3/5` (el perfil y cada `POST /gps`
la llevan): así el que actualizó sin volver a entrar queda al día.

Devuelve, tal cual:

```json
{
  "token": "7c16d862c081…",
  "unitId": "M-12",
  "driverName": "Elmer Ccama",
  "name": "Elmer Ccama",
  "alias": null,
  "role": "driver",
  "vehicleId": "M-12",
  "routeId": "R-14",
  "routeName": "Cerro Colorado ⇄ Centro",
  "companyId": "R14",
  "companyName": "Señor de Huayllani",
  "supervisor": false,
  "app": { "versionCodeActual": 6, "versionCodeMin": 4, "url": "https://…/chofer.apk" },
  "created": false
}
```

- **`app` dice qué APK se reparte** (`APP_VERSION_ACTUAL`), cuál es el más
  viejo que sirve (`APP_VERSION_MIN`) y de dónde bajarlo (`APP_URL`). La app
  compara su `versionCode`: por debajo del actual avisa «hay una versión
  nueva»; por debajo del mínimo, en rojo, «esta app ya no sirve». Con las
  variables sin poner llega todo `null` y la app no dice nada
  (`app/version.js`).

- **El token dura 30 días** (`SESSION_DAYS`). Se guarda en el dispositivo y se
  reusa; no hace falta pedir contraseña cada turno. Desde el 31/10 **se
  renueva con el uso**: si le quedan menos de 7 días y se usa (una petición
  con el token, o la revisión periódica del socket abierto), vuelve a valer
  30. Antes, el chofer que trabajaba todos los días quedaba afuera el día 31
  en medio del turno. El que no la usa en 30 días, vence igual.
- **`unitId` es la PERSONA, `vehicleId` es el fierro.** No son lo mismo y
  confundirlos rompe el chat privado y las brechas. Todo lo del mapa y las
  brechas va por `vehicleId`; el chat y la auditoría, por `unitId`.
- Errores: `401` contraseña mal (con número de intento; a los 5 bloquea 5
  minutos), `403` cooperativa suspendida.

## 2. WebSocket: `identify` antes que nada

Mismo origen, `wss://`. **El primer mensaje tiene que ser `identify`.** Todo
lo que se mande antes se ignora en silencio.

```json
{ "type": "identify", "token": "…" }
```

Si el token no sirve, o si la cuenta es `manager`, llega `auth_error` y el
servidor **cierra la conexión**:

```json
{ "type": "auth_error", "error": "Sesión inválida o expirada" }
```

Las cuentas de gerencia no entran al tiempo real a propósito: su panel es
`gerencia.html` y no necesitan la calle.

## 3. Lo que llega al identificarse, en orden

Observado, en este orden:

| # | Tipo | Qué trae |
|---|---|---|
| 1 | `gps_role` | **si esta conexión es la que reporta GPS** (ver §3.1: al chofer sin el mando no le llega acá) |
| 2 | `unit_joined` | aviso a la ruta de que la unidad entró (ídem) |
| 3 | `state` | el estado completo de la ruta |
| 4 | `chat_history` | los últimos mensajes que le corresponde ver |
| 5 | `route_geometry` | el trazado dibujado de la ruta |
| 6 | `puerta` | **sólo a Despacho**: quién entró y no salió a ruta (ver §3.5) |
| 7 | `combi` | **chofer y cobrador**: su combi de hoy (ver §4octies). Desde el 31/10, en cada conexión: Despacho puede haberla cambiado con la app cerrada. Si es la que ya tiene, el cliente no hace nada |

Después, `state` cada 3 s (`STATE_INTERVAL_MS`) mientras haya movimiento.

### 3.1 `gps_role` — leer esto antes de escribir el servicio de fondo

```json
{ "type": "gps_role", "reporting": true }
```

**Solo UNA conexión reporta la posición de cada vehículo.** El servidor
descarta el `gps` de cualquier otra. Las reglas (desde el 30/10, «opción B»):

- El cobrador nunca reporta → al identificarse, `reporting: false`,
  `reason: "Modo acompañante"`.
- **Entrar no es salir.** El `identify` de un chofer que no tiene el mando
  —recién entrado y en la puerta, o el relevado que reconecta— no se lo da:
  no le llega `gps_role`, no se le abre turno y no le cambia el nombre a la
  combi del mapa. Sólo el MISMO chofer que tiene el mando vivo y reconecta
  (otra red, otra pestaña) lo conserva al identificarse, con
  `reporting: true`.
- **El mando se toma estando en ruta:**
  - declarar `ruta` lo toma **aunque otro lo tenga**: es el relevo. Al
    anterior le llega `gps_role` con `reporting: false` y el motivo, y se le
    cierra el turno;
  - declarar `ausente`, o mandar una posición (WS o HTTP), lo toma sólo si
    nadie lo tiene vivo (se lo oyó hace menos de `OLVIDAR_MS` o tiene el
    socket abierto).

  Al tomarlo, por el socket llega `gps_role` con `reporting: true`.
- **El relevado no recupera solo.** Al que le sacaron el mando le queda la
  app en `ruta`, que la re-declara en cada reconexión. Mientras dure su
  marca, ni su `ruta`, ni su `ausente`, ni sus posiciones le devuelven ESA
  combi — ni siquiera si el que la manejaba termina el turno. Le llega
  `reporting: false` con el motivo, que dice cómo volver: *«… Para volver a
  manejarla: SALIR DE RUTA y después SALIR A RUTA.»* (por HTTP,
  `gpsRole: false` y el mismo `motivo`). La marca se va con un acto suyo
  —declarar `fuera`, o volver a entrar con usuario y clave—. Pasadas las
  `RELEVO_MAX_MS` (6 h) se va sola **sólo si nadie está manejando esa
  combi**: mientras el otro siga, la marca sigue (31/10; antes, a las seis
  horas el relevado se la volvía a sacar). Está en la base (tabla
  `relevos`), no sólo en memoria: un reinicio del servidor ya no la borra.
  El `gps_role` del relevado trae `"relevado": true`.
- **La salida automática y la re-declaración no relevan** (31/10). `ruta`
  con `motivo: "auto"` (el vigía de la puerta) o con `redeclara: true` (la
  conexión que vuelve) encuentra la combi con otro manejando: no la toma.
  Le llega `reporting: false` con *«Juan está manejando esta combi: la app
  no la toma sola. Si es un relevo, tocá SALIR A RUTA vos.»* (por HTTP,
  `ignorada: true`, `gpsRole: false`). Relevo es sólo `ruta` sin esas dos
  marcas: el chofer que tocó SALIR A RUTA.
- **Dos conexiones de la misma persona** (el teléfono y la web) no se roban
  el GPS en cada posición: el socket que reporta sigue siéndolo mientras
  esté abierto.
- **`fuera` suelta el mando y el socket.** Antes el socket quedaba apuntado
  como el que reporta, y al cerrarse otra conexión de la misma persona se lo
  heredaba.
- Un chofer conectado no hereda el mando de otro al cerrarse el socket de
  éste: sólo otra conexión de la MISMA persona.

Para la app nativa esto es lo más importante de toda la página: **el servicio
de fondo no puede mandar GPS si `reporting` es `false`**, y una reconexión
puede cambiar ese valor en cualquier momento. Hay que tratarlo como estado
vivo, no como algo que se lee una vez al entrar.

### 3.2 `state` — el corazón

```json
{
  "type": "state",
  "routeId": "R-14",
  "routeName": "Cerro Colorado ⇄ Centro",
  "targetGapMin": 2,
  "objetivo": { "modo": "manual", "motivo": null,
                "vueltas": 0, "unidades": 0, "dia": null, "manual": 2 },
  "desvio": { "umbralM": 300, "mudoHasta": null },
  "units": [ { "unitId": "M-08", "driverName": "Rufino Quispe", "label": null,
               "lat": -15.4838, "lng": -70.1283, "speed": 24,
               "routeProgress": 0.1000, "tramo": "ida", "progresoTramo": 0.2000,
               "rumbo": null, "desvioM": 1,
               "fueraDeRuta": false, "fueraDesde": null,
               "routeId": "R-14", "timestamp": 1785562730930 } ],
  "gaps": { "M-08": { "toAhead": null, "toBehind": null,
                      "aheadUnit": null, "behindUnit": null } },
  "totalOnRoute": 1,
  "timestamp": 1785562731536
}
```

Lo que hay que tener claro:

- **`gaps` se indexa por `vehicleId`**, no por persona.
- **Cada lado tiene TRES estados, no dos**, y confundir los dos últimos hace
  que la pantalla mienta:

  | `aheadUnit` | `toAhead` | `aheadSinSenal` | Qué significa |
  |---|---|---|---|
  | `null` | `null` | `false` | no hay nadie adelante |
  | `"M-08"` | `"02:24"` | `false` | hay alguien y se sabe a cuánto |
  | `"M-08"` | `null` | `true` | **hay alguien y no se sabe a cuánto** |

  El tercero es una unidad que dejó de reportar. Su última posición es de hace
  minutos, así que medirse contra ella sería inventar; pero tampoco se la saca
  de la fila, porque entonces este lado se mediría contra la que sigue —el
  doble de lejos— y la pantalla diría *"apurá"* hacia una combi que el chofer
  tiene justo adelante. Está medido; ver la sección 5.
- **La unidad sin señal tampoco tiene brechas propias** (desde el 28/10):
  sus `toAhead` y `toBehind` vienen en `null`, con `aheadUnit`/`behindUnit`
  igual. Su posición es la de hace minutos, así que contra quien sea el número
  mentiría; Despacho la mostraba como «SIN SEÑAL» con dos brechas en rojo
  debajo.
- **Los vecinos son del mismo tramo.** La cadena es por tramo (ida o
  vuelta), no un anillo: la primera de la vuelta no tiene «atrás» a la última
  de la ida, y la primera de la ida no tiene «adelante» a nadie de la vuelta.
  Ambos lados en `null` puede querer decir «sola en su tramo» con cinco
  unidades en el otro.

  **Taparlo con un `||` fue el bug que la app web tuvo hasta hace poco**: le
  mostraba al chofer una unidad inventada con el mismo tamaño y color que el
  dato real. Si el tiempo viene `null`, la pantalla no muestra un tiempo.
- **`units` trae solo las de esa ruta y con GPS**, ordenadas por
  `routeProgress` descendente (la de más avance primero). Una unidad con
  `sinSenal: true` sigue en la lista con su **última posición conocida** y
  `sinSenalDesde` diciendo de cuándo es. Dibujarla como una posición actual
  manda a Despacho a donde la combi estuvo hace tres minutos.
- `sinSenal` en la raíz del estado cuenta cuántas están calladas.
  `totalOnRoute` **las sigue contando**: la combi está en la calle igual.
- **`routeProgress` lo calcula el servidor**, proyectando la posición sobre el
  trazado. El cliente no lo calcula ni lo necesita.
- `tramo` es `"ida"` o `"vuelta"`; `progresoTramo` va de 0 a 1 dentro del tramo.
- `gpsSimulado`: la última posición vino marcada por Android como salida de
  una app de «ubicación simulada» (fake GPS). La app la manda como
  `simulado: true` en la posición del `POST /gps` (o del mensaje `gps`); el
  servidor no la descarta, la marca y la anota en la auditoría
  (`gps_simulado`). Ver `TRUCOS-2026-09-10.md`.
- `gpsSospechoso`: las últimas doce posiciones tienen la firma de un
  simulador sin el flag de Android (`server/farsa.js`): `'velocidad_constante'`,
  `'sin_ruido'`, `'velocidad_incoherente'`, o `null`. Es una sospecha con
  motivo, anotada una vez por episodio (`gps_sospechoso`); no bloquea nada.
- `precisionM` y `gpsImpreciso`: los metros de error que declaró el aparato
  en la última posición (`precision` en `POST /gps` / mensaje `gps`; `null`
  con un APK que no lo manda) y si son más de los que se aceptan para juzgar
  (100 m, `PRECISION_MAX_M`). Con `gpsImpreciso` el servidor **no evaluó
  desvío ni parada** con esa posición: `fueraDeRuta` y `parado` quedan como
  estaban.
- `relojAtrasadoS`: cuánto atrasa el reloj del teléfono, en segundos, si el
  servidor lo pudo estimar (0 si no). Sus `timestamp` vienen con ese atraso;
  el servidor ya lo descuenta para el gris de «sin señal».
- `desvioM` es la distancia al trazado en metros, o `null` si la ruta no tiene
  geometría cargada. `fueraDeRuta` ya viene evaluado y sostenido por el
  servidor: **no lo recalcules con `desvioM > umbral`**, porque el servidor
  exige que se sostenga y respeta el silenciado.

### 3.3 `route_geometry`

```json
{ "type": "route_geometry", "routeId": "R-14",
  "tramos": { "ida": [[-15.4823, -70.1333], …], "vuelta": [[…]] },
  "largoM": 5652, "variante": "Recorrido normal" }
```

**Los puntos vienen como pares `[lat, lng]`, no como `{lat, lng}`.** Es
asimétrico con el `PUT /admin/routes/:id/points`, que sí recibe objetos. Es
así hoy; si se toca, se rompen las dos pantallas web.

### 3.4 `chat_history`, `chat_msg`, `voice_msg`, `photo_msg`, `sos_alert`

```json
{ "type": "chat_msg", "role": "driver",
  "unitId": "M-12", "driverName": "Elmer Ccama", "vehicleId": "M-12",
  "toVehicleId": null, "routeId": "R-14",
  "text": "probando", "timestamp": 1785562735036 }
```

```json
{ "type": "sos_alert", "unitId": "M-12", "driverName": "Elmer Ccama",
  "vehicleId": "M-12", "routeId": "R-14",
  "lat": -15.4828, "lng": -70.1302, "timestamp": 1785562735837 }
```

```json
{ "type": "photo_msg", "role": "driver",
  "unitId": "M-08", "driverName": "Rufino Quispe", "vehicleId": "M-08",
  "toVehicleId": null, "routeId": "R-14",
  "text": "se rompió el eje", "data": "data:image/jpeg;base64,…",
  "timestamp": 1785728569716 }
```

El canal lo dicen dos campos, y nunca vienen los dos (desde el 31/10):

| `toVehicleId` | `toPersonId` | Canal |
|---|---|---|
| `null` | `null` | el grupo de la ruta |
| `"M-05"` | `null` | Despacho ↔ esa **combi**: la ven los que van arriba hoy (chofer y cobrador) y los que la manejen después |
| `null` | `"pedro"` | Despacho ↔ esa **persona**: la sigue a cualquier combi y ruta, y no la ve nadie más |

El `chat_history` de un chofer o cobrador trae el grupo de su ruta, el privado
de su combi de hoy y su privado personal **de cualquier ruta**. El de
Despacho, todo lo de la ruta que mira (los personales guardados con la ruta
que la persona tenía en ese momento).

El privado PERSONAL que llega en vivo le llega a todo panel que puede mirar la
ruta de la persona —el Despacho de esa ruta y los supervisores de la empresa—,
aunque en ese momento esté mirando otra (31/10: lo que contestaba alguien de
otra ruta no le llegaba nunca a Despacho). Con «personal» y sin `toPerson`,
lo de Despacho no sale (antes salía al grupo). Y la baja de una persona borra
su privado personal: el usuario reusado no lee lo del anterior.

**El contenido pesado caduca, la burbuja no.** El servidor conserva el `data`
de las **30** notas de voz y las **20** fotos más recientes; pasado eso lo
pone en `NULL` y el mensaje sigue llegando sin él. El cliente lo muestra como
expirado, que es honesto: existió, ya no está.

Se poda **por tipo y no en conjunto**, a propósito: si el presupuesto fuera
compartido, una ráfaga de fotos le borraría el audio a la nota de voz que
justamente hace falta escuchar.

### 3.5 `puerta` — sólo a Despacho

Desde el 30/10 («opción A»). Quién entró y no salió a ruta en la ruta que se
mira: el chofer que se identificó o puso la clave y desde entonces no declaró
nada ni mandó una posición. Llega al identificarse un supervisor, con cada
`watch`, y cada vez que la lista cambia (con un segundo de espera, para no
parpadear con la web, que entra y declara en el mismo instante). A todo panel
que mira esa ruta —también al Despacho atado a una ruta, que hasta el 31/10
no la recibía nunca—. Nunca a los teléfonos de los choferes.

```json
{ "type": "puerta", "routeId": "R-14",
  "items": [{ "personId": "pedro", "nombre": "Pedro", "vehicleId": "M-05", "desde": 1793393000000 }] }
```

Sale de la lista con cualquier declaración (`ruta`, `ausente` o `fuera`), una
posición aceptada, cerrar sesión o la baja. Y deja de mostrarse si no tiene la
app conectada y pasaron `PUERTA_SIN_SOCKET_MS` (30 min) de su última señal —que
cuenta también el momento en que se le cerró el socket—: la
web en la puerta no tiene socket, y la nativa lo pierde con la pantalla
apagada. El servidor no sabe dónde está: en la puerta la app no manda la
ubicación.

## 4. Lo que el cliente manda

| Tipo | Cuerpo | Cupo por minuto |
|---|---|---|
| `identify` | `{ token }` | 60 |
| `gps` | `{ lat, lng, speed }` | **40** |
| `chat` | `{ text, timestamp, to? }` | 30 |
| `voice` | `{ data, timestamp, to? }` | 10 |
| `photo` | `{ data, text?, timestamp, to? }` | 6 |
| `sos` | `{ lat, lng, timestamp }` | 6 |

**Pasado el cupo, el mensaje se descarta** — pero ya no en silencio. Desde el
11/9 el servidor manda, UNA vez por ventana y por tipo:

```json
{ "type": "cupo", "que": "voice", "max": 10, "ventanaSec": 60 }
```

Lo descartado no vuelve: el aviso no es un reintento, es una explicación. Sin
él, el chofer grababa una nota de voz de cuarenta segundos, la veía salir y no
pasaba nada —el mensaje entra al hilo sólo por el eco— sin nada en ninguna
pantalla que lo dijera (revisión del 10/9, C10). Un cliente que no conozca el
tipo `cupo` lo ignora y queda como antes.

El GPS a 3 s son 20/min, la mitad del cupo — hay margen, pero un reintento
agresivo tras una reconexión lo puede quemar.

- `gps`: **el cliente NO manda `routeProgress`.** Se acepta como respaldo solo
  para rutas sin trazado cargado. Con geometría, el servidor lo ignora.
- `chat` privado: **un chofer solo puede escribirle a Despacho.** Cualquier
  `to` que mande se reemplaza por su propio vehículo. Chofer ↔ chofer privado
  no existe a propósito. Con `"personal": true` (en vez de `privado`) va a su
  privado PERSONAL —siempre el suyo, pida lo que pida—. Despacho escribe a
  una combi con `to` o a una persona con `toPerson` (chofer o cobrador de su
  cooperativa; el Despacho de ruta, sólo a la gente de su ruta). Lo mismo vale
  para `voice` y `photo`. Despacho sí elige destinatario, y el mensaje se
  guarda y se reparte con **la ruta de la combi de destino**, no con la que
  Despacho está mirando: el historial del chofer se filtra por SU ruta, así
  que con la del emisor el privado a una combi de otra ruta se veía en vivo y
  desaparecía al reconectar (C19). El que lo manda recibe siempre su propio
  eco, esté mirando la ruta que esté.
- `voice`: data-URL (`data:audio/…;base64,…`), máximo 2 MB, y el servidor solo
  valida el prefijo y el tamaño — **no el formato**. La web graba webm/opus;
  una app nativa graba m4a/aac. Como quien lo escucha es Chrome en el panel,
  m4a funciona, pero conviene decidirlo antes y no descubrirlo en producción.
- `photo`: data-URL (`data:image/…;base64,…`), máximo **1,2 MB** — o sea
  MENOS que el audio, y no es un descuido. Una foto de celular sale de 3 a
  8 MB, y en este canal el que la manda paga una vez y **los que la reciben
  pagan cada uno**: lo caro es el reparto. El cliente la achica a 1280 px en
  el lado largo y JPEG al 50 % antes de mandarla (`app/imagen.js`); este tope
  es la red por si algún cliente no lo hace. `text` es el pie de foto, hasta
  200 caracteres, y es opcional. Se descarta en silencio como todo lo demás,
  así que el cliente tiene que medirla ANTES: si no, el chofer ve su foto
  salir y nunca se entera de que no llegó.

## 4bis. Posiciones por HTTP: `POST /gps`

**El camino que usa la app nativa con la pantalla apagada.** Existe por una
medición en un teléfono real: al bloquear la pantalla, Android suspende el
JavaScript y **el WebSocket se cae**, aunque el servicio de ubicación nativo
siga corriendo —la notificación permanente sigue ahí—. La combi seguía
sabiendo dónde estaba y no tenía por dónde decirlo.

```json
POST /gps
Authorization: Bearer <token>
{ "posiciones": [ { "lat": -15.48, "lng": -70.13, "speed": 22,
                    "timestamp": 1785649191992,
                    "precision": 12, "simulado": false }, … ] }
```

`precision` (metros de error, opcional) y `simulado` (opcional, sólo `true`
cuando Android marca la posición como de una app de ubicación simulada) son
de `TRUCOS-2026-09-10.md`; un cliente que no los manda se trata como siempre.

Devuelve `{ ok, aceptadas, yaVistas, descartadas, routeId, gpsRole }` (más
`brecha` y `grabar` cuando corresponde). **`aceptadas` es lo que el servidor
usó**: lo repetido (`yaVistas`) y lo de hora imposible (`descartadas`) no
cuentan, y la app lo muestra aparte de «enviadas».

**Lo que el cliente pega al lote**, además de las posiciones: `presencia`
(ver 4ter) y `grabando` (ver 4septies). `grabando` es `true` mientras se está
grabando **y también mientras hay una grabación parada que todavía no se
envió**: el pedido de Despacho se levanta cuando la grabación LLEGA o cuando
el chofer la descarta, no cuando aprieta PARAR. Mandando `false` ahí, con el
envío fallado por mala señal, el servidor daba el pedido por cumplido y no
llegaba nada nunca (revisión del 10/9, C21).

**Quién manda la posición de una combi (el mando del GPS).** Una sola
persona por vehículo, por cualquier canal. Se toma con un acto explícito:
identificarse por WebSocket, o declarar `ruta` (`POST /presencia` o el
mensaje `presencia`); o, sin acto, cuando el dueño lleva `OLVIDAR_MS` sin
mandar una posición, o no hay dueño. La presencia pegada al lote de
`POST /gps` NO toma el mando (viaja en cada envío). Al relevado se le avisa
por su socket si lo tiene (`gps_role: false`), se le cierra el turno, y
**su próximo `POST /gps` recibe `200 { gpsRole: false, aceptadas: 0 }`**: la
app apaga el servicio al leerlo y no lo rearranca hasta que el rol vuelva.
Antes del 10/9 dos teléfonos en la misma combi entraban los dos y la unidad
saltaba entre ambos.

**El reloj adelantado.** Si TODO el lote viene del futuro (más de 2 min), la
respuesta es `400 { reloj: 'adelantado', adelantoSec }`: la app lo muestra
(«el reloj del teléfono está N min adelantado: activá la hora automática») y
no reintenta ese lote. El atrasado se compensa solo (`relojAtrasadoS`), y ese
sesgo **sobrevive al «fuera»**: es del teléfono, y el teléfono es el mismo en
el turno siguiente. Olvidarlo ahí hacía que los primeros N segundos del turno
que empezaba cayeran en el filtro de salidas y se descartaran con un `200` que
parecía un envío perfecto (revisión del 10/9, C6).

**Todo el lote «ya visto» y nada aceptado.** Es lo normal cuando el mismo
chofer tiene la web abierta —que manda por WebSocket, sellado con la hora del
SERVIDOR— y la app en el teléfono —que manda por HTTP, con la hora del
APARATO—: si el del teléfono atrasa unos segundos, todo lo que manda queda por
detrás de la última posición conocida y vuelve `200 { aceptadas: 0 }` para
siempre. No se cambia quién gana (la posición más nueva es la más nueva), pero
la respuesta lo DICE:

```json
{ "ok": true, "aceptadas": 0, "yaVistas": 3,
  "motivo": "Otro aparato tuyo está reportando esta combi, y sus posiciones son más nuevas" }
```

El campo es opcional y sólo aparece en ese caso (revisión del 10/9, C20).

- **Un POST no necesita nada vivo del lado del cliente**, así que la tarea de
  fondo puede mandar con la app dormida.
- **Acepta varias posiciones con su hora**, así que sirve para vaciar el
  atraso juntado en una zona sin datos. La hora que vale es la de la
  posición, no la de llegada: con la de llegada la unidad se teletransporta
  por el recorrido y las vueltas salen infladas por lo que duró el corte.
- Se ordenan por hora antes de procesarse. La **última** queda como posición
  en vivo.
- Se descartan las del futuro (más de 2 min de adelanto: un reloj mal puesto)
  y las de más de 6 h. Máximo 200 por envío.
- Mismas reglas de rol que por WebSocket: **solo el chofer**; `403` para el
  cobrador. El relevo ya no es `409`: ver «el mando del GPS» arriba.
- La coordenada se valida igual que por WebSocket (`lat` en ±90, `lng` en
  ±180); `routeProgress` se acepta como respaldo para una ruta sin trazado,
  igual que por WebSocket.

El WebSocket queda para **recibir** el estado mientras la pantalla está
encendida. Mandar posición por ahí sigue funcionando y es lo que hace la app
web, pero una app nativa debería usar el POST.

## 4ter. La presencia: `presencia` (WS), `POST /presencia` y el campo en `/gps`

El chofer declara su estado: `'ruta'`, `'ausente'` o `'fuera'`.

```json
{ "type": "presencia", "estado": "ruta" }
```

- Por HTTP: `POST /presencia` con `{ "estado": "ruta" }` (Bearer). Solo el
  CHOFER — el cobrador y Despacho reciben 403: la presencia es de la unidad
  y la unidad la lleva el que maneja.
- Pegada al GPS: `POST /gps` acepta `"presencia": "ruta" | "ausente"` junto
  a las posiciones. Es el canal con la pantalla apagada, y hace que el
  estado sobreviva a un reinicio del servidor.

**Declarar `ruta` NO mete a la unidad en la cadena de brechas.** Eso lo
confirma el servidor cuando una posición cae sobre el trazado (el umbral del
desvío). Hasta entonces la unidad viaja en el estado con `presencia: 'ruta'`
y `enRuta: false`, sin entrada en `gaps`. `ausente` la saca de la cadena sin
sacarla de `units`; `fuera` la borra en el acto (llega `unit_left`). El
cliente debe RE-DECLARAR su presencia al reconectar el WebSocket: el
servidor la guarda en memoria. Un cliente que no declara nada se comporta
como siempre: en cadena desde la primera posición.

**`motivo: "auto"`** (desde el 30/10, opcional, sólo con `ruta`): la
declaró el vigía de la puerta de la app, no el chofer —lo vio manejando sin
haber salido y nadie contestó el aviso—. El servidor lo anota en la
Actividad de Despacho (`salio_solo`). Viaja una sola vez: la re-declaración
al reconectar no lo lleva. Por HTTP va en el cuerpo: `{ "estado": "ruta",
"motivo": "auto" }`. Con otro manejando esa combi no la toma (§3.1).

**`redeclara: true`** (desde el 31/10, opcional): esta declaración no la
eligió nadie ahora —es la que el cliente re-manda al reconectar, o la que
retoma la app al reabrirse—. Con otro manejando la combi, no es un relevo
(§3.1). Los clientes la mandan en toda re-declaración; la primera, la del
toque en SALIR A RUTA, va sin ella. Un APK viejo no la manda: lo cubre la
marca del relevado, que ahora sobrevive al reinicio.

**El relevado no declara por la combi** (desde el 22/9; y desde el 30/10, ni
`ruta` le devuelve la combi mientras dure su marca: ver §3.1). Si OTRA persona
tiene el mando del GPS de ese vehículo y se la oye —la misma prueba con la
que `POST /gps` le contesta `gpsRole: false`—, su `ausente` y su tráfico se
ignoran, y su `fuera` sólo le cierra el turno a ÉL: `POST /presencia` y
`POST /trafico` contestan `200 { ok: true, ignorada: true, motivo }`, y por el
socket no pasa nada. Antes, el relevado que al terminar su turno apretaba
«Salir de ruta» sacaba del mapa la combi que estaba manejando el otro y le
tiraba la vuelta en curso. `ruta` sí vale: declararla es tomar el mando.
Y la presencia y el tráfico se anotan con la ruta de la COMBI, no con la de
la persona.

## 4sexies. Señal y presencia: `GET /admin/huecos`, `GET /admin/anomalias`

Lo de `TRUCOS-2026-09-10.md`, para Despacho y el gerente (nunca para el
chofer, y nunca en vivo). `GET /admin/huecos?dias=N` lista los cortes de
señal de la cooperativa (o de la ruta del despachador atado a una): dónde
se cortó (`latDesde`, `lngDesde`, `progresoDesde`), dónde reapareció
(`…Hasta`), `durationSec`, `metros` y `kmh` entre los dos puntos, la
`presencia` que tenía, cuántas posiciones DEL corte llegaron después
(`recuperadas`: si son más de cero fue la red, no el teléfono apagado) y
cómo terminó (`cierre`: `volvio`, `no_volvio`, `fuera`, `trazado`, `corte`).
El registro de presencia guarda `ruta`, `ausente`, `fuera` y `olvido` (se
dejó de oír estando ausente: la ausencia termina en la última posición, no
al fin del rango). `GET /admin/anomalias?dias=N` lista lo puntual: `tipo` en `salto` (más de
120 km/h entre dos posiciones; `valor` en km/h), `ausente_en_marcha`,
`reloj` (segundos), `descartadas` (posiciones con hora imposible),
`gps_simulado`, `gps_sospechoso` (la heurística sin flag, con el motivo en
`detalle`) y `gps_impreciso` (`valor` en metros). Los mismos datos bajan como
`senal.csv` y `anomalias.csv`, y `/gerencia/resumen` trae un bloque `senal`
por unidad y en los totales — con `gpsSospechoso`, `gpsImpreciso`,
`avisosTrafico`, `avisosSinParada` (avisos de tráfico del chofer sin que el
servidor midiera la parada: `paradas.medida = 0`; `GET /admin/paradas`
también trae `medida`) y `entradasTardias`. El resumen trae además la flota
entera (`porUnidad[].activa`, `ultimaVez`; `totales.flota`,
`totales.unidadesActivas`), las vueltas por persona (`porPersona[].vueltas`,
`brechaProm`, `cumplimiento`, `desvios`: las de la combi mientras la persona
tenía el turno de chofer; `totales.sinAtribuir` las que no cayeron en ningún
turno), `porDia` y `alcance`. Y el CSV `paradas`.

Desde el 11/9 el bloque `senal` trae además las **paradas medidas** por el
servidor, las haya avisado el chofer o no (`paradas`, `paradasSec`,
`paradaMaxSec`, `paradasAvisadas`, y los mismos en `totales`): la consulta que
había llevaba `confirmado = 1` —los avisos del botón de tráfico— así que un
embotellamiento real que nadie avisó no aparecía en ninguna tarjeta ni columna
(revisión del 10/9, E10). Son dos cosas distintas y la diferencia entre las dos
es el dato. Y `porPersona[]` trae `roles[]` (todo lo que la persona hizo en el
período) además de `role`, que se conserva y ahora es aquel en el que puso más
horas y no el del primer turno que devolvió la consulta (E12): con uno solo, al
que manejó media jornada se le tapaban las vueltas.

## 4quinquies. El SOS por HTTP: `POST /sos`

El SOS por el WebSocket (`{ "type": "sos", "lat", "lng", "timestamp" }`)
sigue igual. Pero el socket no siempre está: con la pantalla recién
desbloqueada murió y el reintento espera de 3 a 30 s, y ése es justo el
momento en que alguien desliza SOS. `POST /sos` con `{ "lat", "lng",
"timestamp" }` (Bearer, chofer o cobrador; Despacho recibe 403; más de 5 por
minuto, 429) dispara exactamente lo mismo —la alerta a la ruta y a los
supervisores, la auditoría, la fila en `messages`— y **contesta con la
alerta y su `sosId`**: es el eco que el socket no va a dar, y el ancla para
el `sos_tipo` de después.

El cliente (`app/protocolo/cliente.js`, `mandarSos`) devuelve `{ ok, via,
sosId }` y `ok` quiere decir que LLEGÓ: por el socket espera el eco propio
(`sos_alert` con mi unidad) hasta 8 s; sin socket o sin eco, va por HTTP. La
pantalla no dice «ALERTA ENVIADA» hasta ese `ok`.

**Y el TIPO también tiene camino HTTP: `POST /sos/:id/tipo`** con
`{ "tipo": "mecanica" | "accidente" | "policia" }`. El escenario para el que
existe `POST /sos` —el socket caído— era exactamente aquel en el que el tipo
no salía: `sos_tipo` viajaba sólo por el socket, devolvía `'sin-conexion'` y
la app cerraba el diálogo como si hubiera salido, así que quien moviliza veía
un SOS genérico y tenía que adivinar entre una ambulancia y una grúa
(revisión del 10/9, C8). Los bordes son los mismos que por el socket, pero
acá se CONTESTAN, que es todo el punto (y desde el 22/9 la hora del SOS es la
del SERVIDOR: se manda siempre en vivo, y con la del teléfono uno con el reloj
atrasado nacía con la ventana del tipo ya cerrada):

| Caso | Respuesta |
|---|---|
| Salió | `200 { ok: true, sosId, tipo }` |
| Un tipo que no existe | `400` |
| La emergencia de otro, o una que no existe | `404` (el error no confirma que exista) |
| Pasada la ventana de `SOS_TIPO_VENTANA_MS` | `409` — después es editar historia |
| Despacho o gerencia | `403`; sin sesión, `401` |

El aviso `sos_tipo` sale a la ruta y a los supervisores igual que por el
socket. El cliente manda por el socket si lo tiene y cae a HTTP si no; si no
salió por ninguno de los dos, **lo dice**.

Desde el 21/9 el cliente **espera el eco** también para el tipo: manda el
`sos_tipo` por el socket y lo da por salido recién cuando vuelve el aviso con
su `sosId` (hasta 5 s en la app, 4 en la web); sin eco, HTTP. Un socket en
`readyState` abierto no es un socket vivo —tras la pantalla apagada queda
abierto y muerto hasta que el servidor lo termina—, y era justo ahí donde el
tipo se escribía en la nada. Y si el disparo mismo ya tuvo que salir por
HTTP, el tipo no insiste con el socket. Del lado del servidor, **el mismo
tipo dos veces es una sola cosa**: contesta `200 { ok: true }` y no vuelve a
avisar a la ruta, así que un eco perdido no duplica nada.

Y una regla del lado de `/gps` que va con la presencia: **un lote cuyas
posiciones son todas anteriores al último «fuera» de la unidad se descarta
entero, presencia incluida**. Es el `POST /gps` que venía en vuelo con
`presencia: 'ruta'` y llegó después del «fuera»: sin esto volvía a poner en
el mapa a una combi que acababa de irse.

## 4quater. Tráfico: `parado`, `trafico` (WS) y `POST /trafico`

Dos cosas, y viajan juntas en cada unidad del `state`:

| Campo | Quién lo pone | Qué es |
| --- | --- | --- |
| `parado`, `paradoDesde` | el servidor | lleva N minutos (`PARADA_MS`, 3 por defecto) sin avanzar más de 150 m por la ruta. Un hecho. No cuenta en los extremos del tramo (el terminal), fuera de ruta, ni fuera de la cadena (yendo, ausente). Se apaga solo al andar 100 m en un minuto |
| `trafico`, `traficoDesde` | el chofer | avisó que está en tráfico. También se apaga solo al andar (pasado un minuto de gracia desde que lo marcó) |

El chofer lo dice así, y sólo el chofer (cobrador y Despacho reciben 403):

```json
{ "type": "trafico", "activo": true }
```

o por HTTP, `POST /trafico` con `{ "activo": true | false }` (Bearer). `false`
retira la palabra a mano; el episodio automático, si existe, sigue.

A los vecinos les llega en `gaps`: `aheadEnTrafico`, `aheadTraficoDesde`,
`aheadTraficoConfirmado` (y los tres `behind…`). `EnTrafico` es "parado O
avisó"; `Confirmado` distingue la palabra del chofer del hecho medido. **Al
de atrás esto le cambia la instrucción**: con el de adelante trabado, el HUD
dice "mantené" y nunca "apurá" — la brecha crece sola mientras el otro está
parado, y apurar hacia un embotellamiento es el pelotón que el sistema
existe para evitar. Los mismos campos vuelven en el `brecha` de la
respuesta del `POST /gps`, así la notificación con la pantalla apagada lo
dice igual.

Cada episodio queda en la tabla `paradas` (unidad, ruta, dónde, en qué punto
del circuito, cuánto duró, si el chofer lo confirmó, y cómo terminó:
`movio` | `chofer` | `ausente` | `corte` | `trazado`). `GET /admin/paradas?dias=N`
los lista para la cooperativa (o la ruta del despachador atado a una), y desde
el 11/9 Despacho los lee en **Gestión ▸ Dónde se traba**, agrupados por franja
del circuito y por hora del día.

`ausente` es de la revisión del 10/9 (L14): salir de la cadena —declararse
ausente, dejar de estar confirmado— no es «volvió a andar», y el CSV lo
afirmaba. El aviso de tráfico se retira junto con el hecho (L15).

## 4septies. El perfil: `GET /perfil?dias=7`

Lo del que pregunta y nada más (sin parámetro de unidad ni de persona; sólo
chofer y cobrador, los paneles reciben 403). `dias` de 1 a 31, 7 por defecto,
y son días de **calendario** contando hoy: el único día parcial es hoy, que lo
es porque todavía no terminó (revisión del 10/9, E14). Es la misma cuenta que
usa el panel del gerente — si acá dijera otra cosa, alguien tendría razón y
alguien no, y no habría forma de saber quién.

Devuelve `persona`, `vehiculo`, `ruta`, `periodo { desde, hasta, dias }` y:

- `metricas`: `vueltas` (de la COMBI, la maneje quien la maneje),
  `vueltasPropias` (las que se cerraron con esta persona arriba: al chofer
  con su turno de chofer y la regla de relevo del gerente; al cobrador, las
  de la combi mientras iba arriba), `vueltasHoy`, `parciales`, `idas`,
  `retornos`, `duracionProm`, `brechaProm`, `cumplimiento`, `juzgables`,
  `objetivoSec` y `objetivoModo` (la vara que rige hoy), `varaMin`/`varaMax`
  (entre qué anduvo la vara de las vueltas de la ventana), `horasSec`,
  `horasHoySec`.
- `combi { vehicleId, senal, desvios }`: lo de la combi en la ventana con la
  MISMA cuenta que `porUnidad[]` del resumen del gerente (`senal` es el mismo
  objeto; `desvios { veces, segundos, maxM, aparte }`).
- `propios { vueltas, desvios, sos, grabaciones }`: lo de la persona
  (las salidas de ruta atribuidas a su turno, sus SOS, sus grabaciones).
- `turnos[]`: los suyos en la ventana, del más nuevo al más viejo (tope
  100): `{ id, vehicleId, role, startedAt, endedAt, abierto, duracionSec,
  vueltas }`. `duracionSec` va recortado a la ventana: la suma es
  `horasSec`, el mismo número de Turnos y del CSV.
- `cobradores[]`: al chofer con `unitId`, `horasSec`, `ultimoIngreso`,
  `enLinea`; al cobrador sólo `name`, `alias`, `enLinea`.
- `app`: lo que se reparte (como en el login) más `version`/`versionCode`
  que el servidor tiene anotados de este teléfono.

`ruta` puede venir **vacía** (`{ routeId: null, name: null }`): un usuario sin
`routeId` no tiene ruta, y antes se le mostraba el nombre de la ruta por
defecto —que en un servidor con varias cooperativas puede ser de otra
empresa— como si fuera la suya (revisión del 10/9, P8).

Dos cosas más del perfil, por HTTP y con la misma regla de «lo suyo y nada
más»: `POST /perfil/alias` contesta **409** si en su ruta ya hay alguien con
ese nombre —alias o nombre real, sin distinguir mayúsculas (tampoco las que
no son ASCII: «ÑATO» es «ñato»), acentos ni espacios de sobra—, porque el
alias pisa `driverName` y dos iguales son dos unidades con el mismo nombre en
el mapa (P9). El cuerpo del 409 trae `choca: "alias" | "nombre"` y un `error`
que lo dice en castellano: no es lo mismo «ese apodo ya lo usa alguien» que
«alguien se llama así de nombre» (repaso del 21/9). Y `POST /auth/logout` con `{ "todas": true }`
cierra TODAS las sesiones de esa persona, incluida la que lo pide, y corta sus
WebSocket abiertos. Es el remedio para el teléfono perdido: lo que da acceso
no es la contraseña sino el token, que vive 30 días (P11).

## 4octies. La combi, en la puerta: `GET /mis-combis`, `POST /combi`

Desde el 30/10 (habilitaciones). Una persona puede tener **varias combis
habilitadas** —las elige Despacho, o «cualquiera de su ruta» para el
suplente— y en la puerta, antes de salir a ruta, elige en cuál sale. Lo
demás del protocolo no cambia: todo sigue leyendo «la combi de hoy»
(`vehicleId` de la sesión).

`GET /mis-combis` (Bearer, chofer o cobrador; Despacho recibe 403):

```json
{ "actual": "M-05", "todaLaRuta": false, "enRuta": false,
  "combis": [
    { "vehicleId": "M-05", "label": "Z1A-705", "routeId": "R-14", "routeName": "…", "estado": "libre", "quien": null, "desde": null },
    { "vehicleId": "M-01", "label": "Z1A-701", "routeId": "R-14", "routeName": "…", "estado": "ocupada", "quien": "Juan", "desde": 1793393000000 }
  ] }
```

`estado` es `libre`, `tuya` (el mando vivo es tuyo) u `ocupada` (otro la
maneja ahora, con `quien` y la hora en que se lo oyó por última vez). La de
hoy va primero.

`POST /combi` con `{ "vehicleId": "M-01" }` la pasa a ser la de hoy:
`200 { ok, vehicleId, routeId, routeName, label }`. La ruta va con la combi.
**Elegir no toma nada**: la combi se toma al declarar `ruta` (§3.1), y si
otro la maneja eso es un relevo —la app pide confirmarlo antes, nombrando a
quién la tiene—. Una combi que no tiene habilitada (o de otra cooperativa)
contesta `404`; estando en ruta en la de hoy, `409` («tocá SALIR DE RUTA
antes de cambiar de combi»). Por el socket, a todas las conexiones de la
persona les llega:

```json
{ "type": "combi", "vehicleId": "M-01", "routeId": "R-14", "routeName": "…" }
```

Y también al identificarse (§3). Si cambia con la pantalla EN RUTA (el que iba
de acompañante, o el relevado), el chofer vuelve a la puerta: salir en la combi
nueva es tocar SALIR A RUTA. El cobrador se queda donde está.

seguido del `state`, el `chat_history` (el privado de COMBI es de la combi:
el de hoy en M-01 ve lo que Despacho le escribió a M-01; lo suyo va por el
privado PERSONAL, que lo sigue) y el `route_geometry` de su ruta. El cliente
corrige su sesión con eso.

Despacho: `POST /admin/users/:unitId/combis` con `{ "combis": ["M-01",
"M-05"], "todaLaRuta": false, "actual": "M-05" }` (la lista entera; `actual`
opcional cambia la de hoy, con la misma regla de no estar en ruta). Un
Despacho de ruta sólo habilita combis de su ruta: una de otra que no tenía,
`403`; las de otras rutas que ya tenía se conservan aunque no vengan en la
lista. Elegir una combi con «cualquiera de su ruta» no la habilita: el que la
eligió así no administra a sus cobradores. `GET /admin/users` trae
`combis` y `todaLaRuta` de cada persona; `GET /admin/vehicles`, los
`habilitados` de cada combi.

## 5. Reconexión y caídas

- La app web reconecta **cada 3 s** (`project/realtime.js`) y al volver a
  identificarse recibe estado e historial de nuevo. Lo emitido durante el corte
  **se pierde**: no hay cola de reenvío ni acuse por mensaje.
Una unidad que deja de reportar pasa por **dos etapas**, no una:

| Cuándo | Qué pasa |
|---|---|
| **30 s** (`SIN_SENAL_MS`) | queda `sinSenal: true`. Sigue en la fila y en el mapa con su última posición. Las brechas contra ella pasan a `null` con `aheadSinSenal`/`behindSinSenal` en `true` |
| **3 min** (`OLVIDAR_MS`) | se borra de verdad: llega `unit_left` y se descarta su vuelta en curso |

Vale para las dos formas de desaparecer —dejar de mandar `gps` con el socket
abierto, y que el socket se caiga—, porque son el mismo hecho: dejamos de
saber dónde está. Con la pantalla apagada lo normal es lo segundo.

Antes se borraba a los 30 s de una sola vez, y eso producía algo peor que un
fantasma en el mapa: el de atrás pasaba a medirse contra el que sigue, veía
una brecha del doble y la pantalla le decía *"apurá"* hacia una combi que
tenía justo adelante y que ya no veía. Sin haberse movido un metro. Está
medido y cubierto por la suite `senal`.

Esto **no arregla** el problema de fondo —el navegador sigue cortando el GPS
con la pantalla apagada, y por eso viene la app nativa— pero convierte una
falla peligrosa y muda en una visible y honesta.

- Los **turnos** toleran cortes de 15 minutos (`RECONEXION_MS`) antes de
  cerrarse: más que la posición, porque perder la señal un rato no significa
  que la persona se haya bajado. Y el cierre de un socket **no** cierra el
  turno si la misma persona sigue conectada por otro (el viejo se cierra
  con el barrido de pings, a veces un minuto después de que el nuevo ya
  entró).

- **El latido de la web** (desde el 22/9): `{ "type": "ping" }` por el
  socket se contesta `{ "type": "pong" }`, y nada más. `project/realtime.js`
  lo manda cada 15 s y, si en 40 s no llegó NADA del servidor, da el socket
  por muerto y reconecta. Un socket medio muerto —la red cambió, una zona
  sin señal— sigue en `OPEN` hasta que el sistema se entera, que pueden ser
  minutos; el ping de protocolo del servidor no lo ve el JavaScript del
  navegador. La app nativa no lo usa: su canal con la pantalla apagada es
  `POST /gps`.

- **La combi puede cambiar de ruta con la sesión abierta** (desde el 29/9).
  El supervisor la pasa de una ruta a otra de la misma cooperativa —la 18A
  y la 18B rotan combis— con `POST /admin/vehicles/:vehicleId/ruta`
  `{ routeId }`. A cada socket abierto de la gente asignada le llegan, sin
  volver a entrar, el `route_geometry` y el `chat_history` de la ruta
  nueva, y desde ahí los `state` son de ésa: el cliente toma la ruta de lo
  que le llega, **nunca** de la sesión que guardó al ingresar. Los que
  miraban la ruta vieja reciben `unit_left`. La vuelta en curso se
  descarta y el turno se corta; el siguiente abre en la ruta nueva. La web
  del chofer además corrige su sesión guardada, que es la que muestra la
  puerta al día siguiente.

- **Un socket que no está abierto no actúa.** Al revocar una sesión se le
  manda `auth_error` y se lo cierra; lo que llegue mientras el cierre no
  termina se descarta. Y un `type` que no es de la tabla de cupos cuenta como
  `otro`: antes cada tipo inventado abría su propio casillero.

## 6. Cómo se verificó

Levantando el servidor de verdad, entrando como chofer con otra unidad ya en
ruta, y volcando el primer mensaje de cada tipo. Los JSON de arriba son ese
volcado, recortado solo en los arreglos largos de geometría.

Los cupos, los plazos y las reglas de privacidad salen de
`server/index.js` (`CUPO`, la limpieza de inactivas, y los handlers de `chat`
y `voice`), y están cubiertos por las suites `seguridad`, `privado` y
`turnos` en `pruebas/`.
