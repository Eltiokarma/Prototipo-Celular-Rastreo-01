# Protocolo del servidor — COOP-R14

Lo que un cliente tiene que hablar para funcionar contra `server/index.js`.
Existe porque se viene una app nativa (`PROMPT-REACT-NATIVE.md`) y el
protocolo estaba solo en la cabeza de `project/realtime.js`: cada cosa de acá
está **observada de una corrida real**, no leída del código.

Para regenerar el volcado, ver *Cómo se verificó* al final.

---

## 1. Entrar: `POST /auth/login`

```json
{ "user": "M-12", "password": "chofer1234" }
```

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
  "created": false
}
```

- **El token dura 30 días** (`SESSION_DAYS`). Se guarda en el dispositivo y se
  reusa; no hace falta pedir contraseña cada turno.
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
| 1 | `gps_role` | **si esta conexión es la que reporta GPS** |
| 2 | `unit_joined` | aviso a la ruta de que la unidad entró |
| 3 | `state` | el estado completo de la ruta |
| 4 | `chat_history` | los últimos mensajes que le corresponde ver |
| 5 | `route_geometry` | el trazado dibujado de la ruta |

Después, `state` cada 3 s (`STATE_INTERVAL_MS`) mientras haya movimiento.

### 3.1 `gps_role` — leer esto antes de escribir el servicio de fondo

```json
{ "type": "gps_role", "reporting": true }
```

**Solo UNA conexión reporta la posición de cada vehículo.** El servidor
descarta el `gps` de cualquier otra, sin avisar. Las reglas:

- El cobrador nunca reporta → `reporting: false`, `reason: "Modo acompañante"`.
- Entre choferes **manda el último que entra** (es el relevo de turno). Al
  anterior le llega un `gps_role` con `reporting: false` y el motivo.

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

### 3.4 `chat_history`, `chat_msg`, `sos_alert`

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

`toVehicleId` distingue el canal: `null` es el grupo de la ruta, y con valor
es la conversación privada de esa unidad con Despacho.

## 4. Lo que el cliente manda

| Tipo | Cuerpo | Cupo por minuto |
|---|---|---|
| `identify` | `{ token }` | 60 |
| `gps` | `{ lat, lng, speed }` | **40** |
| `chat` | `{ text, timestamp, to? }` | 30 |
| `voice` | `{ data, timestamp, to? }` | 10 |
| `sos` | `{ lat, lng, timestamp }` | 6 |

**Pasado el cupo, el mensaje se descarta en silencio.** No hay respuesta de
error: el cliente cree que mandó y no mandó. El GPS a 3 s son 20/min, la mitad
del cupo — hay margen, pero un reintento agresivo tras una reconexión lo
puede quemar.

- `gps`: **el cliente NO manda `routeProgress`.** Se acepta como respaldo solo
  para rutas sin trazado cargado. Con geometría, el servidor lo ignora.
- `chat` privado: **un chofer solo puede escribirle a Despacho.** Cualquier
  `to` que mande se reemplaza por su propio vehículo. Chofer ↔ chofer privado
  no existe a propósito. Despacho sí elige destinatario.
- `voice`: data-URL (`data:audio/…;base64,…`), máximo 2 MB, y el servidor solo
  valida el prefijo y el tamaño — **no el formato**. La web graba webm/opus;
  una app nativa graba m4a/aac. Como quien lo escucha es Chrome en el panel,
  m4a funciona, pero conviene decidirlo antes y no descubrirlo en producción.

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
  que la persona se haya bajado.

## 6. Cómo se verificó

Levantando el servidor de verdad, entrando como chofer con otra unidad ya en
ruta, y volcando el primer mensaje de cada tipo. Los JSON de arriba son ese
volcado, recortado solo en los arreglos largos de geometría.

Los cupos, los plazos y las reglas de privacidad salen de
`server/index.js` (`CUPO`, la limpieza de inactivas, y los handlers de `chat`
y `voice`), y están cubiertos por las suites `seguridad`, `privado` y
`turnos` en `pruebas/`.
