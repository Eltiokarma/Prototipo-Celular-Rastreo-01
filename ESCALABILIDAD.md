# Escalabilidad — de 1 ruta a 20+ rutas

Plan por etapas con números, no con intuición. La pregunta concreta:
**20 rutas y 1 000 micros (o el doble). ¿Aguanta?** Respuesta corta: el
servidor sí; **el diseño de mensajería no**, y hay que cambiarlo antes de
cualquier piloto grande — de hecho ya conviene cambiarlo hoy.

## Supuestos del modelo

- GPS cada 3 s por unidad (como está hoy).
- Turno de 8 h.
- Una unidad en el JSON de estado ≈ 230 bytes (posición + su objeto de brechas).
- Estimaciones de orden de magnitud, para decidir arquitectura.

## Estado: optimizaciones 1b y 2 aplicadas

Medido con unidades reales conectadas al servidor, una sola ruta:

| Unidades | Antes | Después | Mejora |
| --- | --- | --- | --- |
| 20 | 839 MB | **40 MB** | 21× |
| 50 | 5 194 MB (5,2 GB) | **98 MB** | 53× |

Más el caché de tiles: la segunda visita en adelante **no gasta un byte**
en el mapa (medido: 12 tiles la primera vez, 0 la segunda).

Cómo: el estado se emite como máximo una vez cada `STATE_INTERVAL_MS`
(3 s por defecto, configurable) en vez de una vez por cada GPS recibido,
y las altas/bajas de unidades siguen emitiéndose al instante. Sin pérdida
de funcionalidad: las brechas se siguen actualizando (verificado en
navegador con 50 unidades) porque cada unidad reporta cada 3 s de todas
formas.

## Medición real (no modelo)

Con el servidor corriendo y unidades simuladas conectadas de verdad,
midiendo los bytes que **recibe cada chofer** en **una sola ruta**:

| Unidades en la ruta | Mensajes/s | Bajada | Por turno de 8 h |
| --- | --- | --- | --- |
| 5 | 1,6/s | 1,9 KB/s | **54 MB** |
| 10 | 3,3/s | 7,1 KB/s | **208 MB** |
| 20 | 6,0/s | 28,5 KB/s | **839 MB** |

Crece al cuadrado **dentro de una misma ruta**: duplicar las unidades
cuadruplica el consumo. Que las rutas sean independientes evita que el
problema se multiplique por 20 — un chofer nunca recibe datos de las
otras rutas — pero **no cambia estos números**, porque ya son de una
ruta sola.

## El problema que ya existe hoy

Hoy **cada posición GPS dispara el envío del estado completo a todos los
conectados**. Eso crece al cuadrado: con N unidades son N²/3 mensajes por
segundo, cada uno con las N unidades adentro.

| Unidades | Entra | Sale | Payload | Total | Datos por chofer / turno |
| --- | --- | --- | --- | --- | --- |
| 20 (1 ruta) | 7/s | 133/s | 4,5 KB | 0,6 MB/s | **885 MB** |
| 80 (4 rutas) | 27/s | 2 133/s | 18 KB | 39 MB/s | 14 GB |
| 300 | 100/s | 30 000/s | 67 KB | 2 GB/s | 194 GB |
| 1 000 | 333/s | 333 333/s | 225 KB | 77 GB/s | 2,1 TB |

La fila crítica es la primera: **con una sola ruta de 20 micros, cada
chofer descarga ~885 MB por turno** (~100 MB/hora). Con un plan prepago
peruano eso es inviable — el chofer desinstala la app el primer día. No es
un problema de escala futura: es un problema de hoy que el prototipo no
mostró porque se probó con 2-3 unidades.

## El diseño que sí escala

Tres cambios, todos en el servidor y en cómo se emite el estado:

1. **Alcance por ruta** — un chofer solo recibe datos de su ruta.
2. **Cadencia limitada** — como máximo un envío por segundo por chofer,
   en vez de uno por cada GPS de cualquier unidad.
3. **Payload personalizado** — a cada chofer se le manda *lo suyo*: sus
   brechas ±1/±2 y las unidades cercanas para el mapa, no la flota entera.

Con eso, el tráfico deja de crecer al cuadrado y pasa a ser lineal:

| Escala | Entra | Sale | Total servidor | Datos por chofer / turno |
| --- | --- | --- | --- | --- |
| 1 ruta × 20 | 7/s | 20/s | 0,03 MB/s | 46 MB baja + 1,4 MB sube |
| 4 rutas × 20 = 80 | 27/s | 80/s | 0,13 MB/s | igual |
| **20 rutas × 50 = 1 000** | 333/s | 1 000/s | **1,6 MB/s** | igual |
| 40 rutas × 50 = 2 000 | 667/s | 2 000/s | 3,2 MB/s | igual |

El dato importante: **el costo por chofer deja de depender del tamaño del
sistema**. Da igual si hay 20 o 2 000 micros — cada uno recibe lo suyo.
Y con envíos "solo al cambiar" (deltas de ~400 B) baja de 46 MB a
**~3,8 MB por turno**.

Del lado del servidor, 1 000 unidades son **1,6 MB/s y 333 mensajes de
entrada por segundo**: eso lo mueve **una sola instancia de Node** sin
transpirar (aguanta 10 000 WebSockets; 1 000 sockets son ~60 MB de RAM).

## Etapas, esfuerzo y qué se cambia

| Etapa | Alcance | Cambios | Esfuerzo |
| --- | --- | --- | --- |
| **0. Hoy** | 1 ruta, pocas unidades | — | listo |
| **1. Multi-ruta** | 4–8 rutas | `routeId` en usuarios, mensajes, vueltas y auditoría; brechas y chat por ruta; Despacho por ruta o supervisor con selector | ~1 día |
| **2. Mensajería eficiente** | 20 rutas / 1 000 micros | Cadencia limitada + payload personalizado + deltas. **Es lo que baja el consumo de datos**, y conviene hacerlo junto con la etapa 1 | ~1 día |
| **3. Operación** | piloto real | Backups de la base, métricas de carga, 2ª instancia para redundancia (requiere Postgres + Redis pub/sub para estado compartido) | ~1 semana |
| **4. Multi-ciudad / multi-cooperativa** | 2 000+ | Postgres, varias instancias, servidor de tiles propio, panel por cooperativa | mes+ |

## Lo que se rompía a 2 000 y no era el servidor

Tres cosas que funcionaban con seis combis y dejaban de funcionar con dos mil,
las tres por el mismo motivo: un límite escrito en unidades que no escalan.

- **El historial de vueltas se guardaba por filas, no por tiempo.** El tope
  era global: las últimas 2 000 vueltas. Con seis combis eso son meses. Con
  2 000 unidades, cada una cerrando unas ocho vueltas por turno, son **16 000
  vueltas por día** — o sea que el tope cubría **tres horas**, y el informe de
  la semana pasada habría salido vacío mientras el objetivo automático se
  quedaba sin promedio del que salir. Ahora la retención es de **120 días**
  (`LAPS_DIAS`), que cubre con margen los 90 del rango máximo de un informe.
  Son ~2 millones de filas de unos 100 bytes: unos 200 MB, que SQLite mueve
  sin despeinarse. El techo de filas quedó como cinturón, no como el límite de
  todos los días. Y la poda pasó a correr cada 6 h en vez de en cada cierre de
  vuelta: a 16 000 vueltas diarias eran 16 000 recorridas de tabla al día.
- **El historial de mensajes también, y ahí viven los SOS.** El tope eran las
  últimas 1000 filas de toda la base. Cada cliente recibe hasta 200 mensajes
  **de su ruta** al conectarse, así que 40 rutas necesitan 8000 filas solo
  para que nadie abra el chat en blanco. Y como el SOS se guarda en la misma
  tabla que el chat, una tarde de conversación activa borraba las emergencias
  del mes: el informe de emergencias y el contador del gerente salían vacíos
  sin que nada lo dijera. Ahora la conversación se guarda **30 días**
  (`CHAT_DIAS`) y el SOS **365** (`SOS_DIAS`) — no son la misma clase de dato:
  un "¿espero en el paradero?" de hace dos meses no le importa a nadie, un
  accidente sí. La poda de filas de texto pasó a la barrida de cada 6 h; lo
  pesado (audio y fotos) se sigue podando en el acto, porque ocupa lugar de
  verdad y no puede esperar.
- **El mapa se bajaba de un CDN gratuito.** Leaflet venía de unpkg en tres de
  las cuatro pantallas. A seis combis nadie lo nota; a 2 000 son 2 000
  navegadores por día contra un servicio que no se comprometió a atendernos
  —y ya falló una vez en producción, dejando el panel del creador en blanco—.
  Ahora lo sirve el propio servidor (`/vendor/leaflet/`) y el APK lo lleva
  adentro del bundle, así que la primera apertura del mapa, que es en la calle,
  no depende de la red de nadie más.

Nota sobre la base de datos: a 1 000 unidades **SQLite sigue alcanzando**,
porque el GPS no se escribe en disco (vive en memoria) y las escrituras
reales — chat, vueltas, auditoría — son de 1 a 5 por segundo, contra los
miles que SQLite soporta. El motivo para pasar a Postgres **no es el
volumen sino correr más de una instancia** a la vez (redundancia), porque
un archivo SQLite no se comparte entre servidores.

## Los cuellos reales a escala (no son el servidor)

1. **Datos móviles del chofer** — lo de arriba. Es el bloqueador #1 de
   adopción y se resuelve con la etapa 2.
2. **Tiles del mapa** — sin caché, panear el mapa puede costar
   **20–50 MB por turno**, más que todo el tiempo real. Además el CDN
   gratuito de tiles no tolera 1 000 usuarios diarios (límites de uso):
   habría que cachear agresivamente en el service worker y/o pagar un
   proveedor.
3. **GPS en segundo plano** — con 1 000 choferes usando una app web, las
   unidades desaparecen del mapa cada vez que alguien bloquea la pantalla.
   A esta escala **la app nativa deja de ser opcional** (ver
   `LIMITACIONES.md`).
4. **Batería** — GPS continuo 8 h; hay que medirlo en campo.
5. **Soporte humano** — 1 000 choferes generan altas, olvidos de clave y
   celulares nuevos todos los días. El panel de Despacho necesita, a esa
   escala, que cada cooperativa administre lo suyo.

## Qué se sacrifica en cada optimización

Nada sale gratis. Ordenado de mejor a peor relación beneficio/costo, con
una ruta de 20 unidades como referencia:

| Optimización | Queda en | Qué se sacrifica | Esfuerzo |
| --- | --- | --- | --- |
| **1. Limitar la cadencia** a 1 envío/s (hoy: uno por cada GPS de cualquiera) | 137 MB | **Prácticamente nada.** Cada unidad reporta cada 3 s: emitir más seguido reenvía lo mismo. Se pierde ≤1 s de frescura en números que cambian en minutos | 1–2 h |
| **1b. Cadencia de 1 cada 3 s** (igual al GPS) | 46 MB | Igual que arriba; ≤3 s de retraso al cruzar un umbral de color | 1–2 h |
| **2. Cachear los tiles** del mapa | −20 a −50 MB extra | ~50–100 MB de espacio en el celular; mapa desactualizado si cambian las calles (no cambian). Primera carga más pesada | ½ día |
| **3. Payload personalizado** (mis brechas + unidades cercanas) | ~19 MB | El chofer **deja de ver toda la flota** de su ruta en el mapa, solo las cercanas. Y aparecen **dos formatos de mensaje** (Despacho necesita todo): cada función futura debe contemplar ambos, y app y panel dejan de compartir el mismo contrato — más código, más pruebas, más lugares donde romper | 1 día |
| **4. Deltas** (enviar solo lo que cambió) | ~5 MB | **Fragilidad seria:** el cliente mantiene estado y aplica parches; si un delta se pierde o llega desordenado, el chofer ve un número **equivocado sin enterarse**. Exige numeración y resincronización periódica. En la red móvil de Juliaca, donde perder mensajes es normal, es el peor lugar para esto. Y depurar se vuelve mucho más difícil | 2 días + deuda permanente |
| **5. Bajar la frecuencia de GPS** (3 s → 10 s) | ÷3 la subida | **Costo visible:** a 30 km/h la combi avanza ~83 m entre reportes; el pin del mapa se mueve a saltos y las brechas quedan más viejas | 10 min |

## Recomendación

Hacer **la 1b y la 2**: juntas llevan el consumo de ~840 MB a menos de
50 MB por turno **sin sacrificar ninguna funcionalidad** — solo se deja
de reenviar información repetida. Son unas horas de trabajo y bajo riesgo.

Dejar la **3** para cuando una ruta pase de ~30 unidades (ahí el payload
completo empieza a pesar de verdad). **No hacer la 4** salvo que el costo
de datos se vuelva crítico: cambiar robustez por 14 MB es mal negocio en
una red inestable. La **5** solo si el cliente reporta problemas de
batería o datos de subida, porque sí se nota.

La etapa **multi-ruta (`routeId`)** sigue siendo necesaria para 4+ rutas,
pero es un tema aparte del consumo de datos: hace falta para que las
brechas y el chat no se mezclen entre rutas, no para ahorrar megas.
