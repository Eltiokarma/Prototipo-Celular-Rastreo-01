# COSTOS.md — Auditoría de costos y capacidad para 2000 unidades

**Fecha:** 2026-08-05 · **Precios consultados:** 2026-08-05 (fuentes en §4)
**Método:** todo lo afirmado sale de leer el código (con archivo:línea) o de
medir contra el servidor real levantado en local. Los payloads en bytes se
midieron con clientes de verdad (login + WebSocket + POST), no se estimaron.
El modelo es `modelo-costos.js` (raíz): `node modelo-costos.js` imprime los
tres escenarios; `node modelo-costos.js bench` corre el benchmark del §3.

**El resumen en tres líneas:**

1. **La base de datos NO es el cuello de botella.** Con WAL, la carga de
   escritura de 2000 unidades usa el 0,8 % del segundo. El costo dominante es
   **egress del WebSocket de estado: ~10 TB/mes ≈ $518/mes** en el escenario
   de 2000 — el 88 % del costo total es variable y casi todo es eso.
2. **El mismo estado les cuesta a los choferes ~89 MB de datos móviles por
   turno.** A escala, la palanca más rentable (comprimir el WS) arregla las
   dos cosas a la vez. **Implementada el 2026-08-06** con −90 % medido por
   estado (ver §5): los números de egress de §2 y §4 son los de ANTES de la
   compresión — el escenario 2000 real queda en ~$190-210/mes.
3. **Costo marginal por cooperativa de 100 unidades: ~$26/mes.**
   Total del escenario 2000/20: **~$658/mes** ($0,33/unidad).

---

## 1. Inventario del gasto real (leído del código)

### 1.1 Lo que escribe a base de datos

No existe tabla de posiciones GPS: las posiciones viven en un `Map` en
memoria (decisión explícita, `server/index.js:1200` — *"serían millones de
filas"*). Las tablas son 12: `messages, routes, companies, route_variants,
route_points, users, sessions, vehicles, audit, deviations, shifts, laps`.

| # | Escritura | Tabla | Disparo | Frecuencia a 2000 unidades | ¿Escala con unidades × tiempo? |
|---|---|---|---|---|---|
| **P3** | `abrirTurno` (`server/index.js:1615` vía `POST /gps`) | `shifts` 2 SELECT + 1 UPDATE | **cada POST /gps** — la app nativa postea cada 3 s (pantalla encendida) o 10 s (apagada) | **~500 UPDATE/s** promedio, 1500/s en punta | **SÍ — la peor del sistema** |
| P1 | `marcarVivo` (`:1173`) | `shifts` UPDATE | cada posición, con freno de 60 s (`:1170`) | ~33/s | SÍ (mitigada por el freno) |
| P2 | `trackLap` (`:1382`) | `laps` INSERT | cierre de vuelta | ~16 000/día ≈ 0,3/s | SÍ (lenta) |
| P7+P8 | `remember` (`:632` + `:652`) | `messages` 1 INSERT + **2 UPDATE de poda** | cada mensaje (texto, voz, foto, SOS) | ~2,5/s | con el volumen de chat |
| P9 | `audit` (`:908-914`) | `audit` INSERT + **1 DELETE con subconsulta** | cada login, desvío, acción admin | ~4,4/s | con reconexiones |
| P4-P6 | desvíos (`:1009,1021,1074`) | `deviations` | desvío sostenido / regreso | esporádico | mitigado a propósito |
| — | acciones humanas (altas, claves, trazados, logos) | varias | clicks de admin | despreciable | no |

> P8 y P9 son **escrituras ocultas**: un chat de texto dispara 3 escrituras;
> un login auditado, 2. No dominan hoy, pero son barridos de tabla que corren
> en línea con cada evento.

### 1.2 Polling de los frontends: NO HAY

Verificado por búsqueda exhaustiva de `setInterval`/`setTimeout` en los
cuatro HTML y `realtime.js`: **ningún frontend hace polling HTTP periódico**.
Los paneles cargan al montar y al cambiar de pestaña
(`project/despacho.html:1232-1240`, `server/creador.html:1635-1641`); todo lo
vivo llega por **WebSocket push**. `project/gerencia.html` es un redirect de
40 líneas a despacho.html. Los únicos `setInterval` de los clientes son:

| Cliente | Qué | Cadencia | Red |
|---|---|---|---|
| Chofer web (`project/realtime.js:193`) | WS `{type:'gps'}` | 3 s | 82 B/envío |
| App nativa (`app/gps/servicio.js:299,324`) | `POST /gps` (lote de 1, tope 150) | 3 s pantalla encendida / 10 s apagada | 81 B + 59 B resp. |
| Ambos | reconexión WS | 3 s fijo (web) / backoff 3→30 s (nativa) | login 334 B |

### 1.3 Payloads medidos (servidor real, 2026-08-05)

| Mensaje / endpoint | Request | Response | Nota |
|---|---|---|---|
| `POST /auth/login` | 38 B | 334 B | |
| WS `gps` (cliente→srv, cada 3 s) | 82 B | — | ingress: Railway no lo cobra |
| **WS `state` (srv→cada cliente, cada 3 s)** | — | **765 B con 1 unidad · 2 580 con 5 · 4 861 con 10 · 9 410 con 20** | ≈ 310 B de sobre + **455 B por unidad** (17 campos, `server/index.js:3964`) |
| `POST /gps` (1 posición) | 81 B | 59 B | lote de 20: 1 494 B req |
| WS `chat` (40 chars) → rebote | 107 B | 202 B × cada miembro de la ruta | |
| WS `voice` 12 s (opus→base64) | 27 105 B | ídem × miembros | tope 2 MB (`:3654`) |
| `GET /admin/users` (21 cuentas) | — | 3 855 B | por cambio de pestaña |
| `GET /admin/shifts` (21 turnos) | — | 6 358 B | ídem |
| `GET /admin/vueltas` | — | 225 B + ~90 B/vuelta (tope 300) | ídem |
| `GET /config.js` | — | 266 B | |
| `GET /ping` | — | 108 B | |

**El que explota** (escala con unidades × tiempo × destinatarios): el WS
`state`. Cada ruta lo emite cada 3 s a **todos** sus clientes (choferes +
panel mirándola, `broadcastToRoute`, `server/index.js:4090`), y cada cliente
recibe el estado **completo** de la ruta. Con rutas de 20 unidades: 9,4 KB ×
21 clientes cada 3 s por ruta. Un panel mira UNA ruta a la vez (`watching`,
`:4074`); el único broadcast a supervisores es el SOS, acotado a su empresa.

### 1.4 Terceros con cuota o costo

| Servicio | Uso | Cuota/costo |
|---|---|---|
| **Geoapify** (tiles del mapa, desde hoy) | 4 pantallas | free 3 000 créditos/día = 12 000 tiles; API 10 $59/mes = 40 000/día |
| unpkg (React/Babel), Google Fonts | runtime paneles | gratis, sin cuota — pero dependencia en caliente |
| ~~CARTO~~ | — | eliminado (fuera de licencia para uso comercial) |

No hay geocoding, ni push notifications, ni SMS/email, ni analytics
(verificado en `package.json` y por grep).

---

## 2. Modelo de carga (`modelo-costos.js`)

Parámetros: unidades, coops, unidades/ruta (20), horas de operación (16),
cadencia GPS (mezcla 4 s), cadencia de estado (3 s), paneles/coop (1,5),
retenciones actuales (vueltas y desvíos 120 d, chat 30 d, SOS 365 d).
Punta = 3× promedio.

| | **Piloto (20 u / 1 coop)** | **500 u / 5 coops** | **2000 u / 20 coops** |
|---|---|---|---|
| Rutas / paneles | 1 / 2 | 25 / 8 | 100 / 30 |
| Requests/s (prom → punta) | 5 → 15 | 126 → 378 | **503 → 1 510** |
| Escrituras SQLite/s (prom → punta) | 5 → 15 | 127 → 381 | **508 → 1 523** |
| Base: crecimiento bruto | +0,04 GB/mes | +0,97 GB/mes | +3,9 GB/mes |
| Base: régimen con retención | 0,03 GB | 0,21 GB | **0,76 GB** |
| **Egress/mes** | **112 GB** | **2 594 GB** | **10 364 GB** |
| — WS state | 111 | 2 564 | 10 247 |
| — chat + voz (rebotes) | 0,7 | 16,5 | 66 |
| — respuestas /gps | 0,5 | 11,9 | 47 |
| — paneles + logins + app | 0,1 | 0,9 | 3,5 |
| Datos móviles del chofer | ~89 MB/turno 8 h | ídem | ídem |
| Tiles Geoapify/día | ~130 | ~3 300 | **~13 200** (supera el free) |

Notas:
- La base es **diminuta** gracias a que el GPS no se persiste y a las
  retenciones: 0,76 GB de régimen a 2000 unidades. El disco no es tema.
  (`shifts` no se poda nunca — hoy irrelevante, ~35 MB/año a 2000.)
- El egress es **lineal en unidades** (más unidades = más rutas emitiendo ×
  más clientes escuchando) y no depende de cuántos paneles haya: los
  choferes son el 98 % de los destinatarios del estado.
- Los ~89 MB/turno de datos móviles del chofer salen del mismo estado: no es
  un costo de Railway, pero es un costo del sistema (recarga prepago) y una
  amenaza de adopción.

---

## 3. Cuello de botella: ¿aguanta la base?

**Motor:** SQLite vía better-sqlite3 (sincrónico, un solo proceso Node), en
**WAL si el disco lo permite, con caída silenciosa a `journal=delete` si no**
(`server/base.js:34-39`). El servidor real intercala escrituras y lecturas en
un único hilo, así que la pregunta correcta es: ¿cuánto del segundo se come
un segundo de carga?

**Benchmark** (`node modelo-costos.js bench`, esquema real, base poblada con
1,92 M de vueltas = 120 días de régimen a 2000 unidades, índices idénticos a
producción; corrido en este sandbox — el vCPU de Railway rendirá parecido u
algo menos):

| Carga | En WAL | Sin WAL (journal=delete) |
|---|---|---|
| 1× (2000 u, 508 esc/s) | **7,7 ms → 0,8 % del segundo** | 347 ms → 35 % |
| 3× punta (1 523 esc/s) | 31,7 ms → 3,2 % | **>100 % — SE ROMPE** |
| 10× (20 000 u eq.) | 96 ms → 9,6 % | — |
| 100× (200 000 u eq.) | 1 016 ms → **saturación** | — |

**Respuesta:**
- **En WAL, la base aguanta 2000 unidades con margen ~30×.** El umbral de
  quiebre por escritura está en ~60 000-200 000 unidades equivalentes —
  no lo vamos a tocar.
- **Sin WAL, el umbral es ~1 400 escrituras/s ≈ 1 900 unidades en hora
  punta**: el escenario de 2000 **ya no entra**, y en un volumen de red más
  lento que este disco, menos todavía. Como la caída a journal es silenciosa
  (un `console.warn`), el primer paso operativo es **verificar en el deploy
  real de Railway que el volumen quedó en WAL** — es un `PRAGMA
  journal_mode` de un minuto.
- La lectura pesada del panel (pestaña de vueltas) cuesta **142 ms por carga
  a base de régimen** porque `laps` no tiene índice por `finishedAt` (los
  únicos índices reales: `deviations(routeId,startedAt)` en `:991` y
  `shifts(personId,startedAt)` en `:1117`). Con el índice: 33 ms (4×). Esos
  142 ms **bloquean el hilo** que también atiende los 500 POST/s.
- **Y había una lectura peor que no estaba medida: el acumulado por unidad**
  (`/admin/metrics`, la tabla de abajo de esa misma pestaña). A diferencia de
  la lista de vueltas, **no tiene corte por fecha** —el acumulado es de todo
  lo retenido—, así que agrupa las vueltas de la empresa entera, y adentro
  lleva una subconsulta correlacionada (la última vuelta de cada unidad) que
  sin índice recorre la tabla **una vez por unidad**. Medido sobre una base
  sintética con la retención real (2000 unidades × 120 días × 8 vueltas =
  1,92 M de vueltas y 3,84 M de tramos, 538 MB):

  | | vueltas | tramos | base |
  | --- | --- | --- | --- |
  | como estaba | **10 368 ms** | 1125 ms | 538 MB |
  | + `laps(unitId,parcial,id)` | 303 ms | 1118 ms | 576 MB |
  | + `legs(routeId,parcial)` | 306 ms | 208 ms | 629 MB |
  | + `laps(routeId,parcial)` | **88 ms** | **205 ms** | 655 MB |

  De 11,5 s a 293 ms — **39×** por +117 MB (+22 % de base). Los tres índices
  están puestos. Diez segundos de agrupamiento son diez segundos en los que
  2000 combis no reportan posición: **un despachador abriendo una pestaña
  congelaba el mapa de todos**, y no aparecía en ninguna métrica porque el
  endpoint se llama al abrir la pestaña y no en bucle.

  **El costo es CUADRÁTICO con la flota**, no lineal, y eso es lo que hay que
  entender antes de crecer. La subconsulta corre una vez por unidad sobre las
  filas de la empresa: al multiplicar la flota por 10, las unidades y las
  filas se multiplican por 10 cada una, y el producto por 100. Medido con la
  misma base sintética a 20 000 unidades (19,2 M de vueltas, 38,4 M de
  tramos, 5,7 GB):

  | | 2000 unidades | 20 000 unidades | factor |
  | --- | --- | --- | --- |
  | como estaba | 9 580 ms | **996 954 ms** (16,6 min) | 104× |
  | con los tres índices | 288 ms | 1 089 ms | 3,8× |

  Sin los índices, a 20 000 el servidor **parece muerto durante diecisiete
  minutos** cuando alguien abre esa pestaña. Con ellos, el crecimiento vuelve
  a ser casi lineal.

- **Y después se midieron TODAS las lecturas del panel, no sólo ésa**
  (`node herramientas/escala.js`, que arranca el servidor de verdad y
  pregunta por HTTP). El patrón resultó ser uno solo y estaba en cuatro
  lugares: **el motor elegía el índice por fecha para ahorrarse un `ORDER BY`
  o un `GROUP BY`, y con él se traía el rango de TODAS las cooperativas para
  descartar el 98 % filtrando por ruta.** 1,44 M de filas leídas para
  devolver 28 800.

  | lectura (2000 unidades, base de 731 MB) | antes | después |
  | --- | --- | --- |
  | `/gerencia/resumen` · 90 días | 2 253 ms | **289 ms** |
  | `/gerencia/resumen` · 30 días | 977 ms | 178 ms |
  | CSV informe tramos · 30 días | 787 ms | **111 ms** |
  | CSV informe vueltas · 30 días | 401 ms | **52 ms** |
  | `/admin/vueltas` | 62 ms | 18 ms |
  | el resto (users, vehicles, routes, audit, shifts, company…) | < 60 ms | igual |

  Tres cambios, ninguno de arquitectura:

  1. **Sacar el `ORDER BY finishedAt` del cuadro del gerente.** No lo usaba
     nadie —abajo todo reagrupa por día y por unidad, y ordena sus claves al
     final— y era lo que empujaba al motor al índice equivocado. 1398 → 44 ms.
  2. **`GROUP BY routeId, unitId, leg`** en vez de `unitId, leg`, por lo
     mismo: agrupando sólo por unidad, el motor usaba el índice por unidad y
     barría todo. 1195 → 74 ms. La suma se hace en JS porque una combi que
     cambió de ruta aparece en dos filas.
  3. **Los CSV ordenan en JS**, no en SQL. Ordenar 28 000 filas en JS cuesta
     **1 ms**; pedírselo al motor costaba cientos.

  Y el orden de las columnas del índice, que no es cosmético:
  `(routeId, finishedAt, parcial)` y no `(routeId, parcial, finishedAt)`.
  Con la fecha tercera, una consulta que no filtra por `parcial` —los CSV los
  listan todos, marcados— no puede acotar por rango: 484 ms contra 15.

  Queda como deuda, medida y no resuelta: **a 20 000 unidades el acumulado
  sigue costando ~3,7 s** entre las dos consultas (1089 + 2654), y eso es
  tiempo con la ingesta de GPS parada. La salida NO es seguir agregando
  índices —ya no compran nada— sino **acotar el acumulado a un rango**, que
  es lo que ya hace el resto del panel; el "total histórico" sin fecha es la
  única lectura del sistema que no lo hace. Con la base en 7,6 GB de índices
  incluidos, también hay que mirar el volumen contratado antes de llegar ahí.

  > **CORRECCIÓN (9/8): los números de arriba están tomados sobre una base más
  > chica de la que decían.** El sembrado del banco no pasaba
  > `routes.createdAt`, que es `NOT NULL` sin valor por defecto, y como usaba
  > `INSERT OR IGNORE` el fallo se tragaba en silencio: **no entraba ninguna
  > ruta**. Todas las unidades quedaban asignadas a rutas inexistentes salvo
  > las que caían en la única ruta real —la que crea el servidor al arrancar—,
  > así que la cooperativa medida tenía 1 ruta y 40 unidades en vez de las
  > decenas que se creían. Las **mejoras relativas siguen siendo válidas** (se
  > midió la misma consulta antes y después contra los mismos datos), pero los
  > absolutos estaban subestimados unas 5 veces. La tabla de abajo los rehace,
  > y el sembrado ahora verifica sus propios conteos y falla ruidosamente.

### El barrido completo: la forma de la curva, no el milisegundo

`node herramientas/escala.js` mide ahora **500, 2000 y 5000 unidades** y
reporta el factor de crecimiento. La regla: entre 2000 y 5000 la flota crece
2,5×, así que **2,5× es lo lineal**; ~6× es cuadrático y >10× es peor.

Una consulta de 400 ms que crece lineal es sana — al triple de flota tarda el
triple y se ve venir. Una de 25 ms que crece 5,5× **no** se ve venir, y es la
que hay que cazar.

Medido con la retención real (turnos 365 días, el resto 120; base de 192 MB /
782 MB / **2,0 GB**):

| lectura | 500 | 2000 | 5000 | factor | forma |
| --- | --- | --- | --- | --- | --- |
| `/admin/shifts` | 2 ms | 5 ms | 25 ms | **5,5×** | **cuadrático** |
| `/admin/routes` | 2 ms | 3 ms | 11 ms | **3,3×** | peor que lineal |
| `/gerencia/resumen` 90 d | 349 | 1011 | **1746 ms** | 1,7× | lineal |
| `/admin/metrics` | 364 | 661 | **1003 ms** | 1,5× | lineal |
| CSV tramos 30 d | 222 | 557 | 827 ms | 1,5× | lineal |
| `/gerencia/resumen` 30 d | 102 | 350 | 660 ms | 1,9× | lineal |
| CSV vueltas 30 d | 94 | 264 | 431 ms | 1,6× | lineal |
| el resto (users, vehicles, audit, creador…) | | | ≤ 28 ms | ~2× | lineal |

**Las dos que crecían mal, y por qué.** `/admin/shifts` no tenía índice por
fecha —el único de `shifts` es `(personId, startedAt)`, que a esa consulta no
le sirve— así que recorría las 2,4 M de filas, y por cada una evaluaba
`routeId IN (rutas de la empresa)`, lista que también engorda con la flota:
filas × rutas. `/admin/routes` hacía una consulta `COUNT(*) FROM users` **por
cada ruta**, y `users` no tiene ningún índice: rutas × personas.

**Los arreglos, medidos uno por uno a 5000 unidades:**

| | antes | después | qué se hizo | costo |
| --- | --- | --- | --- | --- |
| `/admin/shifts` (ventana de 7 d) | 53 ms | **6 ms** | índice `shifts(routeId, startedAt)` | 49,2 MB |
| informe de horas 30 d | 156 ms | **38 ms** | (el mismo índice) | — |
| `/admin/routes` (el N+1) | 8 ms | **1 ms** | una consulta agrupada | 0 |

En `/admin/routes` **no se agregó índice a propósito**: agrupar ya lo arregla,
y `users(routeId, role)` compraba 1 ms → 0 ms. La regla de la casa es que un
índice que no compra un orden de magnitud no se gana el disco.

**Y el orden de las columnas del índice de turnos se eligió midiendo, porque
la primera opción estaba mal.** Un índice por `startedAt` solo arregla la
pestaña —que lleva `LIMIT 500`, así que camina el índice y frena— pero
**empeora el informe de horas 2,6×**, que trae las 22 410 filas del período
sin límite y con ese índice paga una búsqueda en la tabla por cada una:

| | informe de horas | pestaña de turnos |
| --- | --- | --- |
| sin índice nuevo | 156 ms | 53 ms |
| `shifts(startedAt)` | **393 ms** ← rompe uno | 5 ms |
| `shifts(routeId, startedAt)` | **38 ms** | **6 ms** |

Es exactamente para lo que sirve medir de a uno: el índice "obvio" arreglaba
una pantalla y rompía otra, y el banco lo mostró antes de que llegara a
producción.

### El daño real: cuánto se frena la ingesta de GPS

Los milisegundos de una consulta son el diagnóstico. El daño es otra cosa, y
se mide poniendo las dos cargas a la vez (`escala.js --carga 5000`): 12
choferes reales reportando sin parar mientras alguien abre una pantalla.

Con 5000 unidades, la línea de base del `POST /gps` es **p50 9 ms**. Y:

| al abrir… | la consulta tardó | **el GPS de toda la flota esperó** |
| --- | --- | --- |
| Números a 90 días | 2432 ms | **2493 ms** |
| el acumulado por unidad | 1208 ms | **1211 ms** |
| el CSV de tramos | 854 ms | 855 ms |
| Gestión → Rutas | 20 ms | 43 ms |

La correspondencia es casi exacta, y era la hipótesis: **el tiempo de la
consulta ES el tiempo que la flota entera deja de reportar**, porque SQLite es
sincrónico y comparte hilo con la ingesta. No es una pantalla lenta: es el
mapa de 5000 combis congelado dos segundos y medio porque un gerente eligió
90 días.

Repetida con los arreglos puestos:

| al abrir… | el GPS esperaba | **ahora espera** |
| --- | --- | --- |
| Números a 90 días | 2493 ms | **1467 ms** |
| el acumulado por unidad | 1211 ms | **1017 ms** |
| el CSV de tramos | 855 ms | 936 ms |
| Gestión → Rutas | 43 ms | **29 ms** |
| línea de base del `POST /gps` | p50 9 ms | p50 7 ms |

El peor caso baja de 2,5 s a 1,5 s. **Lo que queda no se arregla con índices**:
son las dos lecturas de `PENDIENTES 4.6` y `4.8`, y las dos esperan una
decisión del dueño.

> **UNA ADVERTENCIA SOBRE ESTE NÚMERO.** La prueba usa **12 choferes**
> reportando, no 5000. Mide correctamente cuánto bloquea una consulta al hilo
> —eso no depende de cuántos escriban— pero la línea de base de 7 ms es la de
> un servidor casi ocioso. Con la flota entera encima (≈1250 req/s de promedio
> a 5000, §2) la cola de escritura ya está cargada y **el atraso se acumula
> sobre eso, no reemplaza a eso**. El número real de un despacho ocupado es
> peor que 1467 ms; cuánto peor, no se midió.

### Después de los arreglos: ninguna crece peor que la flota

El barrido completo repetido con los dos arreglos puestos (500 / 2000 / 5000):

| lectura | 2000 | 5000 | factor | antes era |
| --- | --- | --- | --- | --- |
| `/admin/shifts` | 1 ms | **1 ms** | **1,0×** | 5,5× cuadrático |
| `/admin/routes` | 3 ms | **6 ms** | **2,1×** | 3,3× |
| CSV horas 30 d | 45 ms | **102 ms** | 2,3× | 195 ms (mejoró de rebote) |
| `/gerencia/resumen` 90 d | 794 ms | **1244 ms** | 1,6× | 1746 ms (ídem) |
| `/admin/metrics` | 673 ms | 1032 ms | 1,5× | sin cambios, a propósito |

**Las 21 lecturas del panel quedaron lineales.** Las dos que mejoraron "de
rebote" lo hicieron por el índice de turnos: las dos leían `shifts` sin un
índice que les sirviera.

#### Barrido final (9/8), con el período de `/admin/metrics` puesto

Las 22 lecturas —21 más la segunda punta del selector de período— medidas de
punta a punta. **Es el primer barrido en el que la etapa de 5000 llega a
correr**: hasta acá el arnés le daba 50 s al servidor para levantar y contra la
base de 2,0 GB tarda **55 s**, así que 5000 no fallaba a veces, fallaba
siempre. Los absolutos NO son comparables con la tabla de arriba: el equipo
estaba ~1,5× más lento este día, y se ve en las lecturas que nadie tocó. Lo
que sí es comparable —y es lo que importa— es la **forma**:

| lectura | 2000 | 5000 | factor |
| --- | --- | --- | --- |
| `/gerencia/resumen` 90 d | 1075 ms | 1970 ms | 1,8× |
| `/admin/metrics` **todo** (elección expresa) | 942 ms | 1621 ms | 1,7× |
| CSV tramos 30 d | 719 ms | 1017 ms | 1,4× |
| CSV vueltas 30 d | 385 ms | 830 ms | 2,2× |
| `/gerencia/resumen` 30 d | 355 ms | 800 ms | 2,3× |
| **`/admin/metrics` 7 d (el default)** | **219 ms** | **335 ms** | **1,5×** |
| las otras 16 (vueltas, turnos, rutas, CSV, creador…) | ≤ 58 ms | ≤ 129 ms | ≤ 2,3× |

**Ninguna crece peor que la flota** (2,5× entre esos dos tamaños). Base:
804 MB a 2000, 2054 MB a 5000.

Un dato operativo que apareció al arreglar el arnés y que no estaba escrito en
ningún lado: **arrancar contra la base de 5000 unidades tarda 55 s**. Es el
tiempo que el sistema está caído después de un reinicio o un despliegue, y
crece con la base — a 2000 son 5 s. Conviene tenerlo en cuenta al planificar
una ventana de mantenimiento.

Con qué frecuencia pasa importa tanto como el número: la pestaña de Números
**abre con 7 días por defecto** (`despacho.html:1194`), y ahí la consulta trae
19 054 filas en 61 ms en vez de 244 980 en 404. Los 90 días son una elección
deliberada y ocasional, no el camino de todos los días.

### El cuadro por unidad ahora muestra un período (y lo dice)

`/admin/metrics` era la única lectura del sistema que agrupaba **todo lo
retenido** —120 días de la cooperativa entera— y lo cobraba en cada apertura
de la pestaña. Acotarlo estaba medido y sin hacer desde el barrido anterior
(`PENDIENTES` 4.6) porque **cambia lo que se ve**, y eso es decisión del dueño,
no de quien optimiza. Con la decisión tomada, medido a 5000 unidades sobre el
mismo servidor y la misma base:

| lo que se pide | 5000 unidades |
| --- | --- |
| `?todo=1` — lo que costaba ANTES en cada apertura | 1627 ms |
| `?dias=90` | 1173 ms |
| `?dias=30` | 971 ms |
| **sin parámetros: 7 días, el nuevo default** | **343 ms** → **4,7×** |

Es la palanca que Números no tenía (ver la sección anterior): acá **acotar el
alcance sí gana**, y gana casi cinco veces, sin reescribir ninguna cuenta ni
agregar un índice. Es el orden de preferencia del proyecto funcionando —
primero acotar, después reescribir, el índice último.

El corte se aplica a las tres consultas de la pantalla, no sólo a la de
vueltas: también a `legs` y a la subconsulta correlacionada de "Última". Si esa
última no se acotara, una unidad sin vueltas en la semana mostraría la duración
de una vuelta de hace tres meses en una fila que dice "últimos 7 días".

**Y la parte que no es de rendimiento, que es la que importa más.** Una
pantalla acotada que sigue diciendo "acumulado" es peor que una sin acotar: el
despachador lee un total y está viendo una semana. Así que cambió el rótulo en
todos lados —encabezado (`Por unidad · últimos 7 días`), la columna que decía
`Total` y ahora dice `Vueltas`, el pie, el `README`— y el servidor devuelve un
campo `periodo` con lo que sirvió **de verdad**: recorta el pedido a [1, 365],
y la pantalla rotula con esa respuesta y no con lo que ella creyó pedir. La
suite `periodo` verifica las dos mitades: que el recorte se aplique **a los
datos** (una vuelta de hace 20 días no aparece a 7 días y sí a 30) y que lo que
el servidor dice haber servido coincida con lo que sirvió.

### Agregar en SQL el cuadro del gerente: se hizo, se midió, se tiró

`PENDIENTES` 4.8 decía que agregar en SQL bajaba la pantalla de 654 ms a
182 ms. **Ese 182 estaba mal medido**: la prueba de la que salió agrupaba
sumas y cuentas pero **no calculaba `cumplimiento`**, que es la columna cara —
compara la brecha de CADA vuelta contra la vara de SU ruta. Es un error fácil
de repetir: al escribir las variantes de abajo, dos de ellas volvieron a
"ganar" por lo mismo, y sólo se notó al comparar cuántas columnas traían.

Las dos implementaciones se corrieron **sobre la misma base y en el mismo
proceso**, que es la única forma de no confundir "mi código es lento" con "la
máquina está lenta hoy" — comparar contra una tabla medida otro día no
distingue las dos cosas, y en este caso el equipo estaba ~1,5× más lento que
cuando se escribió la tabla de arriba. A 5000 unidades, 245 252 vueltas, 90 d:

| variante | 90 d | contra la de producción |
| --- | --- | --- |
| sólo LEER las filas, sin agrupar (el piso) | 423 ms | — |
| **JS: leer + agrupar (la de producción)** | **832 ms** | — |
| SQL en tres pasadas (la que se había escrito) | 2186 ms | **2,6× PEOR** |
| SQL en una pasada, con `strftime` | 1483 ms | 1,8× peor |
| SQL en una pasada, día por aritmética entera | **687 ms** | 1,21× mejor |

**Por qué no se sube ninguna:**

- **El techo no era la agregación, era leer las filas.** 423 de los 832 ms son
  sólo traerlas a JavaScript. Agrupar cuesta 409 ms; aunque agrupar saliera
  gratis, la pantalla no bajaría de la mitad. Toda la premisa de 4.8 —"el
  problema es que agrupa en JavaScript"— era falsa, y eso no se veía sin medir.
- **La única versión que gana lo hace con `strftime` afuera**, reemplazando el
  día por `(finishedAt - offset) / 86400000`. Eso **asume que el huso horario
  del servidor nunca cambia de offset**. Perú no tiene horario de verano hoy,
  pero es una suposición sobre el despliegue escondida adentro de un número
  que el gerente usa para hablar con un chofer. Con `strftime`, que es lo
  correcto en cualquier huso, SQL **pierde** contra JS.
- **Y lo que compra es poco y en el lugar equivocado**: 1,21× a 90 días
  (145 ms), **0,96× a 30 días** —o sea que ahí es más lenta— y 11 ms a 7 días,
  que es como la pantalla abre. Se pagaría una suposición de zona horaria y una
  reescritura de la lógica de cumplimiento para acelerar el caso que casi nadie
  pide.

**Lo que queda escrito para el que vuelva a intentarlo:** la palanca de esta
pantalla es **acotar el rango**, no reescribir la cuenta. Y si algún día hace
falta bajar el piso de 423 ms, lo que hay que atacar es la lectura —un índice
que cubra las columnas del `SELECT`, para que no haya que ir a la tabla fila
por fila—, no el agrupado.
- **No hace falta migrar de motor.** El cuello real del sistema no es la
  base: es (a) el egress del estado y (b) el CPU de serializar+emitir por
  WS a 2000 conexiones — presupuestado con 2 vCPU en §4. Si algún día se
  migra (Postgres en Railway), estimo 2-3 semanas de trabajo (reescribir la
  capa sincrónica de better-sqlite3 a async, transacciones, deploy) y
  +$10-30/mes de servicio — **no lo recomiendo con estos números**.

---

## 4. Costo en dinero

**Fuentes de precios (consultadas 2026-08-05):**
- Railway — [railway.com/pricing](https://railway.com/pricing): vCPU
  $20/mes, RAM $10/GB/mes, volumen $0,15/GB/mes, **egress $0,05/GB**. (Hay
  fuentes secundarias que citan hasta $0,10/GB; usé el oficial. Si Railway
  cobrara $0,10, duplicá la línea de egress: el escenario 2000 pasa de $658
  a ~$1 176.)
- Vercel — [vercel.com/pricing](https://vercel.com/pricing): Pro
  $20/asiento/mes con 1 TB de transferencia incluido. El plan Hobby prohíbe
  uso comercial. Los HTML pesan ~100 KB: el egress de Vercel queda dentro de
  lo incluido, y hoy el propio backend sirve las mismas páginas — Vercel es
  prescindible si se quiere ahorrar el asiento.
- Geoapify — [geoapify.com/pricing](https://www.geoapify.com/pricing).

| $/mes | Piloto | 500 / 5 | 2000 / 20 |
|---|---|---|---|
| vCPU (0,5 / 1 / 2) | 10 | 20 | 40 |
| RAM (0,5 / 1 / 2 GB) | 5 | 10 | 20 |
| Volumen | 0,15 | 0,15 | 0,30 |
| **Egress** | **5,61** | **129,68** | **518,21** |
| Vercel Pro | 20 | 20 | 20 |
| Geoapify | 0 | 0 | 59 |
| **TOTAL** | **$41** | **$180** | **$658** |
| Fijo / variable | 86 % / 14 % | 28 % / 72 % | **12 % / 88 %** |

**Los números que pediste:**

- **Costo marginal por cooperativa de 100 unidades: $26/mes** (egress de sus
  5 rutas + su tajada de Geoapify; el panel agrega centavos).
- **Costo marginal por unidad: ~$0,26/mes** dentro de una ruta existente.
  Una unidad que inaugura ruta cuesta más (su ruta emite estado propio);
  una que se suma a una ruta llena cuesta menos. $0,26 es el promedio.
- **A 2000 unidades el 88 % del costo escala con el uso** — y de ese 88 %,
  el 90 % es una sola cosa: el WebSocket de estado. Toda optimización que no
  toque eso es decorativa.

---

## 5. Palancas, ordenadas por ahorro ÷ esfuerzo (escenario 2000)

| # | Palanca | Ahorro/mes | Horas | Qué se degrada |
|---|---|---|---|---|
| 1 | **`STATE_INTERVAL_MS` 3000→5000** (ya es env var, `server/index.js:4121`) | **~$207** (egress del estado −40 %) y −36 MB/turno al chofer | **0** (cambiar una variable) | el mapa y las brechas se refrescan cada 5 s en vez de 3. Para regular brechas de 8-10 min, probablemente nadie lo note |
| 2 | ~~Compresión del WebSocket~~ | **HECHO** (2026-08-06). `permessage-deflate` en el servidor (`server/index.js`, creación del `WebSocketServer`); los navegadores la negocian solos y la app nativa (OkHttp) no la ofrece, así que sigue sin comprimir sin tocarla. Medido en la suite `compresion` con el servidor real: **−90 % de bytes por estado** (3 287 B → 335 B con 6 unidades) — mejor que el 70-85 % estimado, gracias al contexto entre mensajes (cada estado se comprime contra el anterior, que es casi idéntico). Config acotada en memoria: ventana de 4 KB y `level: 1` (~50-100 KB por conexión; ~100-200 MB a 2000, dentro de los 2 GB presupuestados) | ✔ | el CPU por conexión queda por medir con ~500 conexiones reales (supuesto 9) |
| 3 | **Adelgazar el estado** (455 B/unidad: 17 campos con nombres largos; mandar solo lo que cambió o acortar claves) | ~$250-350 solo, menos si ya está la #2 | 8-20 h | riesgo de bugs de sincronización (el estado completo es lo que hace simple la reconexión) |
| 4 | ~~Índice `laps(finishedAt)`~~ | **HECHO** (2026-08-06). `idx_laps_cierre`, creado junto a las migraciones de `laps`; la suite `compresion` verifica que existe y que la consulta del panel lo usa (`EXPLAIN QUERY PLAN`) | ✔ | +unos MB de disco |
| 5 | **Cadencia GPS 3→5 s** (pantalla encendida) | ~$9 (las respuestas de /gps) − escrituras −40 % (que sobran) | 1 h | brecha se recalcula más lento; el ahorro real es batería y datos del chofer |
| 6 | **Batching de escrituras** (agrupar UPDATEs de turno en transacción periódica) | ~$0 (SQLite usa 0,8 % del segundo) | 4-8 h | **no vale la pena hoy** — solo si el deploy queda sin WAL, y ahí lo correcto es arreglar el WAL |
| 7 | **Polling → WebSocket/SSE** | $0 — **ya es todo push**; no hay polling que matar | — | — |
| 8 | **Recortar retención** (120→60 d vueltas, etc.) | ~$0,10 (la base entera es 0,76 GB) | 0 | perder historial. **No vale nada: no tocar** |
| 9 | **Comprimir responses HTTP (gzip)** | ~$0,05 (los paneles casi no pesan) | 1 h | no vale la pena |
| 10 | **Bajar Vercel** (el backend ya sirve los mismos HTML) | $20 | 0,5 h | un solo origen para todo (menos redundancia) |

**Estado de la secuencia** (2026-08-06): **#4 y #2 están hechas** — el índice
y la compresión, las dos con la suite `compresion` vigilándolas. Con el −90 %
medido en el estado, el egress del WS a 2000 unidades baja de ~$512 a ~$50-60
y el chofer de ~89 a ~10-15 MB/turno — **el escenario 2000 queda en
~$190-210/mes** sin tocar nada más. #1 sigue siendo una variable de entorno
(`STATE_INTERVAL_MS`) para probar en el piloto si hiciera falta; #3 pierde
casi todo el sentido con la compresión puesta (los nombres repetidos ya no
viajan); #10 (bajar Vercel) sigue siendo una decisión operativa de $20.

---

## Supuestos a validar con Gerson

Los medibles están medidos; esto es lo que tuve que inventar. Cada uno es una
línea de `modelo-costos.js` (objeto `P`):

1. **Horas de operación: 16 h/día** (5:00-21:00), 30 días/mes, y **punta =
   3× promedio**. Si la flota entera opera en dos turnos solapados, la punta
   real puede ser más chata (mejor) o más aguda.
2. **Unidades por ruta: 20.** Gobierna el tamaño del estado (455 B/unidad) y
   cuánta gente recibe cada rebote de chat. Si tus rutas son de 40, el
   egress del estado casi se duplica; si son de 10, baja a la mitad.
3. **Mezcla de cadencia GPS: 4 s** (3 s pantalla encendida / 10 s apagada —
   ¿cuánto tiempo va la pantalla apagada de verdad?).
4. **Chat: 1,5 textos/unidad/hora · 2 notas de voz/unidad/día · 0,3
   fotos/unidad/día.** La voz pesa 27 KB y rebota a los ~20 de la ruta: si
   el grupo es charlatán, esta línea crece rápido.
5. **Reconexiones: 4/unidad/hora** (cortes de señal en ruta). Afecta logins,
   audit y el reenvío de historial (200 mensajes) al reconectar — ese
   reenvío NO está en el modelo y con mala señal podría pesar.
6. **Paneles: 1,5 por coop** (Despacho fijo + gerencia a ratos) y **6
   cambios de pestaña/hora** por panel.
7. **3 % de choferes por día** reinstalan la app o limpian caché (vuelven a
   bajar HTML + librerías + tiles).
8. **Tiles: 120 por primera carga, 25 KB promedio**, 10 % de choferes/día
   mirando zonas no cacheadas. Gobierna la cuota Geoapify (13 200/día ≈
   apenas arriba del free). Con la Fase 2 (PMTiles propio) esta línea de
   $59 baja a ~$0 y aparece ~3 GB/mes de egress propio (~$0,17).
9. **vCPU/RAM presupuestados a mano** (0,5/1/2 vCPU por escenario): el
   benchmark cubre SQLite, no el costo de serializar y emitir por WS a 2000
   conexiones. Antes de 2000 hay que medir CPU real con ~500 conexiones
   (el piloto de 500 lo va a decir solo).
10. **Egress a $0,05/GB** (oficial Railway). Si tu factura dice $0,10,
    todos los números de egress se duplican.
