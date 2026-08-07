# Pendientes — COOP-R14

Lo que falta construir, con su tamaño y sus dependencias. El orden
importa: algunos ítems son cimiento de otros. Los tres más invasivos —separar
la persona del vehículo, poner la empresa arriba de las rutas y colgar el
recorrido de una variante— ya están hechos, así que cargar choferes,
cooperativas o trazados nuevos ya no compromete nada (ver *Ítems ya cerrados*
al final).

## PLAN DE DESARROLLO

Revisado contra el código, no contra la memoria. El orden es el que sigue:
primero lo que impide vender, después lo que impide escalar, después producto.

### 1 · Bloqueantes. Nada de esto puede quedar así con un cliente pagando

| # | Qué | Por qué bloquea | Tamaño |
| --- | --- | --- | --- |
| 1.1 | **Cambiar `CREATOR_PASSWORD`** | Estuvo escrita en un chat en texto plano y es la ÚNICA llave que abre TODAS las cooperativas. Todo lo demás de esta lista da lo mismo si esto queda | 10 minutos |
| 1.2 | ~~Respaldo automático de la base~~ | **HECHO.** Cada 6 h en el volumen, verificado (se abre y se lee, no solo se escribe) y con rotación. Desde el panel del creador: crear a pedido y **descargar** — el archivo en otra máquina es el respaldo que sobrevive a perder el servidor. Suite `respaldo` con restauración real | ✔ |
| 1.3 | **Medir un turno de 8 horas** | Toda la app nativa existe por una promesa —el GPS aguanta con la pantalla bloqueada— que solo está comprobada por *varios minutos*. Si a las 3 horas Android la mata, el producto no es lo que decimos que es. No se arregla programando: se mide | 1 turno |

### 2 · Para escalar de 1 cooperativa a varias, y de 6 combis a 20

| # | Qué | Por qué | Tamaño |
| --- | --- | --- | --- |
| 2.1 | **Bajar el peso del arranque** | ~~2.1a: React de producción~~ **HECHO** en los cuatro paneles (−1 MB por carga, con SRI). Lo que queda son los ~3 MB de Babel compilando en el navegador, que es una decisión más grande (ver 4.1) | resto: ver 4.1 |
| 2.2 | ~~Bajar Leaflet localmente~~ | **HECHO** en las cuatro pantallas. `server/vendor/leaflet/` es la copia única: el servidor la sirve en `/vendor/leaflet/` para Despacho y la app web (con caída al CDN por si el HTML se publicara en un hosting estático aparte), el panel del creador sigue con la suya, y el WebView del APK la lleva **adentro del bundle** (`app/vendor/leaflet.js`, generado por `herramientas/vendor-leaflet.js`) — la primera apertura en la calle ya no depende de que unpkg conteste. Suite `vendor`, que además falla si la copia del APK se separa de la del servidor | ✔ |
| 2.3 | ~~Guardar el objetivo con cada vuelta~~ | **HECHO.** Columna `laps.objetivoSec`, tomada al cerrar la vuelta. El cumplimiento del gerente y el CSV de vueltas se miden contra ella; las vueltas anteriores no la tienen y se siguen midiendo contra el objetivo de hoy, pero la pantalla **dice cuántas son** en vez de mezclarlas callada | ✔ |
| 2.4 | ~~Guardar los desvíos de ruta~~ | **HECHO.** Tabla `deviations`: una fila por salida, con cuándo empezó, cuándo volvió, la distancia máxima, el umbral con el que se la midió y si estaba silenciada (silenciar es "ya lo sé", no "esto no pasó"). Todo camino de salida la cierra —regreso, corte de señal, cambio de trazado— así que ninguna queda creciendo sola. Columna *Salidas* en el cuadro del gerente e informe `desvios.csv` | ✔ |
| 2.5 | ~~Retención del historial por tiempo~~ | **HECHO**, y era más grave de lo que parecía. Los topes eran de FILAS y globales: 2000 vueltas y 1000 mensajes. Con 6 combis son meses; **con 2000 unidades son 3 horas de vueltas**, y el chat se llevaba puestos los SOS —viven en la misma tabla—, así que el informe de emergencias salía vacío sin que nada lo dijera. Ahora: vueltas y desvíos 120 días, chat 30, **SOS 365**. Suite `retencion` | ✔ |

### 2bis · ~~El trazador se muda al panel del creador~~ — HECHO

Decisión tomada usándolo: **las rutas las carga el nivel de arriba al dar de
alta la cooperativa**, igual que el logo — la cooperativa recibe el sistema ya
configurado. Despacho a lo sumo corrige (su trazador sigue existiendo).

Quedó así: pestaña **RUTAS** en el panel del creador, con la lógica de
edición en `server/trazador.js` — el mismo archivo que Node prueba con
`require()` (suite `trazador`) llega al navegador como `window.Trazador`.
Guarda por la MISMA función que Despacho (`guardarRecorrido`): validación,
transacción, recarga de geometría y broadcast, escritos una sola vez. Y las
herramientas pedidas ("más herramientas de desplazamiento y selección"):

| Herramienta | Cómo quedó |
| --- | --- |
| **Arrastrar un punto** | Igual que en Despacho, con A y B marcados |
| **Seleccionar un tramo** (dos clics) | Modo SELECCIONAR: dos clics y se borra la cuadra entre ellos; el hueco queda en línea recta y se rellena haciendo clic encima |
| **Insertar en el medio** | El clic decide solo: sobre la línea inserta en ese segmento, lejos agrega al final (`dondeVa`, umbral de 12 px convertido a metros según el zoom) |
| **Deshacer** (Ctrl+Z) | Historial de estados enteros, inmune a mutaciones, tope 60 |
| **Modo mano** | Botón MANO, y la barra espaciadora lo activa mientras se la tenga apretada |
| **Importar GPX** | GPX y GeoJSON, simplificados con Douglas-Peucker a ~10 m |

Una ruta recién dada de alta recibe su variante base al preguntarle
(`varianteActiva`), así siempre hay sobre qué dibujar.

### 2ter · ~~Fusionar Gerencia y Despacho~~ — HECHO

Pedido usándolo: un solo panel (`despacho.html`), dos niveles de permiso.
El gerente (`manager`) entra ahí con su misma cuenta y puede lo que el
administrador del día no: los ACTIVOS — vehículos con su placa (y el
chofer-con-combi de una), los datos de la empresa, el logo — más la pestaña
**Números** (la vieja gerencia.html, que quedó como redirección). Los
límites nuevos quedaron suite en mano (`gerencia`): Despacho recibe 403 en
todo eso y el error dice quién sí puede.

### 2quater · ~~La presencia: salir a ruta, ausente, fuera~~ — HECHO

La pantalla del medio es ahora la puerta ("¿Salís a ruta?", deslizable como
el SOS). Declarar "en ruta" no mete a nadie en la cadena: el servidor
confirma con el GPS sobre el trazado — el caso de Ignacio marcando desde su
casa quedó cubierto con la suite `presencia`. AUSENTE (comer, repuestos)
saca de la cadena sin salir del mapa; FUERA borra del mapa en el acto. La
flota fantasma declara igual que la app (los que almuerzan van AUSENTE) y
Despacho muestra YENDO/AUSENTE en fila y mapa.

Y los dos olvidos humanos se resuelven solos (`app/ausencia.js`, suite
`ausencia`, corriendo en la tarea de fondo con la pantalla apagada): el que
arranca después de almorzar vuelve a ruta al alejarse 300 m de donde se
quedó (dos posiciones seguidas — un salto de GPS no cuenta), y una ausencia
de más de 2 horas pasa a FUERA sola, apagando el GPS — sin emitir la
ubicación de la casa toda la noche. Marcar AUSENTE automáticamente se
descartó a conciencia: un embotellamiento parece un almuerzo, y esconderle
a Despacho una combi trabada es esconder justo lo que tiene que ver.

**Verificado en un teléfono real** (APK compilado y probado el 4/8): puerta,
confirmación, ausente y salir de ruta funcionando contra producción.

### 3 · Producto — lo que pidieron los que lo usaron

| # | Qué | Por qué | Tamaño |
| --- | --- | --- | --- |
| 3.0 | ~~La puerta de presencia en la app web del chofer~~ | **HECHO** (6/8). La web ya tenía la puerta visual ("¿Salir a ruta ahora?") — lo que no hacía era DECLARAR. Ahora habla el mismo protocolo que la nativa: SALIR A RUTA declara `ruta` (la cadena espera igual a que el GPS pise el trazado), el botón de descanso entra AUSENTE, en el HUD están AUSENTE y SALIR DE RUTA (con segundo toque), salir o cerrar sesión declara `fuera` —la combi se va del mapa en el acto, no a los 3 min del olvido—, la presencia se re-declara en cada reconexión y un recargo de página retoma sola la guardada. Verificado de punta a punta con `chofer-shot` | ✔ |
| 3.1 | ~~Tipo de emergencia en el SOS~~ | **HECHO** (6/8). El deslizar quedó intacto y primero: la alerta sale YA, genérica. Después aparece "¿qué pasó?" —tres botones grandes en la app (y en la web)— y el tipo elegido actualiza la MISMA emergencia en Despacho (cartel e hilo), la base y el CSV; sin elegir, o pasados 5 min de barra (15 de ventana del servidor), queda "SOS" a secas. Solo quien disparó puede calificar la suya, y solo mientras la emergencia está viva. Suite `sos` | ✔ |
| 3.2 | ~~La palabra al lado del color en Despacho~~ | **HECHO.** Cada brecha de la fila de unidad lleva debajo *EN OBJETIVO* / *AL LÍMITE* / *CRÍTICA*: las mismas tres bandas que ya usaba el color y los mismos términos de la leyenda del mapa. El juicio ya no depende del color en ninguna de las dos pantallas | ✔ |
| 3.3 | ~~La brecha en vivo en la notificación~~ | **HECHO** (7/8). Notificación aparte con `expo-notifications` (canal de importancia baja, sin sonido, se reemplaza por identidad) — el servicio de ubicación no se toca. El dato viaja por el único canal que sobrevive a la pantalla apagada: **la respuesta del POST /gps** ahora trae la brecha (del cache del último estado emitido, ~80 B más, cero cálculo por pedido). El texto lo arma el MISMO `hud.js` de la pantalla (`avisoDesdeRespuesta`), se re-emite solo cuando cambia, y al salir de ruta se limpia — nada de un número de hace una hora colgado en la bandeja. Suites: `hud` (el aviso), `gpshttp` (la respuesta), `nativas` (el módulo del SDK). Falta verlo en el teléfono con el APK nuevo | ✔ |
| 3.4 | ~~Grabador de rutas~~ | **HECHO** (7/8). App: Perfil → GRABAR RECORRIDO — la tarea de fondo come de las mismas posiciones que ya manda, guarda **un punto cada 30 m recorridos** (`app/grabador.js`, puro y con suite; el semáforo no genera un nudo) y sobrevive a que Android mate el proceso (puntos a disco, flag en SecureStore). TERMINAR la sube por `POST /grabacion`; si falla el envío, la vuelta manejada NO se pierde — queda en disco y se reintenta. Del otro lado: **Trazador de Despacho → "Grabaciones de la calle"** lista las de la empresa y las carga con un clic por el MISMO import (y su simplificación) que un GPX. Tope de 25 por empresa, las viejas se van solas. Suite `grabador`. Falta verlo en el teléfono con el APK nuevo | ✔ |
| 3.5 | ~~Perfil del conductor en la app~~ | **HECHO** (7/8), con el alcance que definió el dueño: métricas, alias y contraseña. Pantalla PERFIL en la app (desde la cabecera): quién es, en qué anda, y sus números de 7 días con el MISMO criterio que el gerente — vueltas del vehículo, horas de la persona, cumplimiento contra la vara que regía en cada vuelta. `GET /perfil` contesta solo lo del que pregunta (no hay parámetro de unidad: no existe "pedir el de al lado"). El **alias** lo edita el dueño del alias y llega EN VIVO a Despacho (perfil en memoria + mapa + estado) — el nombre no, con ese se liquidan las horas. La **contraseña** se cambia con la actual en la mano, sin voltear la sesión propia, auditando QUE la cambió y nunca cuál. Suite `perfil`. Falta verlo en el teléfono con el APK nuevo | ✔ |

### 3.6 · ~~El chofer administra a los cobradores de su combi~~ — HECHO (7/8)

Pedido usándolo. El problema real no era quién carga al cobrador sino que,
esperando a que Despacho atienda un olvido de contraseña, **el cobrador
terminaba entrando con la cuenta del chofer** — que es justo lo que rompe
las horas por persona, el reporte de turnos y el «un solo reportero de GPS
por vehículo».

Perfil ahora lista a los cobradores de la combi (nombre, alias, si están en
línea y sus horas de 7 días), y el chofer **les cambia la clave y los
saca**. El **alta quedó afuera por decisión del dueño del producto**: crear
una cuenta es dar acceso al sistema y se queda en Despacho o la gerencia,
que además cargan el nombre real con el que se liquidan las horas.

Lo que se abrió igual es un permiso nuevo para el eslabón más bajo de la
cadena, así que el borde está escrito y probado a contrapelo: solo sobre SU
vehículo (sale de la sesión, nunca del pedido), solo sobre rol cobrador, al
del de al lado no se lo toca (404 que no confirma que exista), un cobrador
no administra cobradores, y el alta por esta puerta **no existe** — la suite
lo verifica pegándole al endpoint, no mirando la pantalla. Todo auditado
—del cambio de clave queda QUE la cambió y nunca cuál— y Despacho y la
gerencia los siguen viendo enteros. Suite `cobradores`.

### 3.7 · ~~El que se mete a mitad de ruta y el que hace media vuelta~~ — HECHO (8/8)

Dos preguntas del dueño, y las dos apuntaban al mismo lugar: cosas que el
servidor **veía en vivo y tiraba**.

**«Si un chofer no inicia en el paradero inicial y se mete en la ruta, cómo
lo detectamos?»** — No se detectaba. La confirmación de presencia sólo exige
pisar el trazado, y el trazado son veinte kilómetros: pisarlo en el paradero
y pisarlo a mitad de ruta daban el mismo resultado. Y el daño no era el hueco
de detección sino lo que hacía callado: su **primera vuelta** —que es el
pedazo que le faltaba al circuito— se cerraba como una vuelta entera con una
duración que es una fracción, bajaba la duración promedio de la ruta, movía
el objetivo automático y le sumaba una vuelta que no dio. La fila era
idéntica a las demás y **nadie podía notarlo mirando la pantalla**, que es lo
que lo hacía caro.

Ahora, al confirmar, se mira por dónde entró (el progreso ya estaba
calculado, sólo faltaba mirarlo): más allá del 15 % del circuito la unidad
queda marcada en vivo en Despacho (`↳ ENTRÓ 62%`) y el hecho se audita, para
poder contestar «¿cuántas veces esta semana?» sin haber estado mirando. La
vuelta se guarda con `parcial = 1` y el progreso de entrada — **no se
descarta**, borrarla sería perder justo el dato que se busca —, queda fuera de
todos los promedios (resumen, acumulado por unidad, objetivo automático,
cumplimiento) y se lista marcada. Al chofer se le dice lo mismo que ve
Despacho; mientras maneja no se le avisa nada, mismo criterio que el desvío.

**«A veces un chofer sólo hace la ida, cómo se ve eso?»** — No se veía. Una
vuelta de `laps` es el circuito entero, así que el que hacía la ida y se iba
no cerraba **ninguna** fila: quedaban sus horas y ningún dato que dijera qué
hizo con ellas. Ahora cada tramo terminado se guarda por su cuenta (tabla
`legs`), con dos guardas contra el ruido —el cambio de tramo se confirma en
cuatro posiciones y hay que haber recorrido más del 80 % del tramo— y, sobre
todo, **cerrando el tramo también cuando la unidad se baja**: declarar
«fuera» o dejar de reportar no borra la ida que ya estaba hecha. Se ve como
columnas *Idas* y *Retornos* en Despacho y en el cuadro del gerente (el
retorno en ámbar cuando queda por debajo), en el perfil del chofer, y en el
informe nuevo `tramos.csv`.

Ni la app ni el chofer cambian: todo sale de datos que el servidor ya
calculaba. Suite `metidos`.

### 3bis · ~~Los bancos visuales fotografiaban pantallas vacías~~ — HECHO

Salió de mirar las capturas antes de desplegar, y es la clase de rotura que
**no se ve en la regresión**: los dos bancos terminaban en verde mostrando
nada.

- **`rediseno.js`** daba de alta choferes sin combi. Desde que la persona dejó
  de ser la unidad, eso es un 403 de Despacho —crear la combi al vuelo es del
  gerente— y el servidor descarta el GPS de un chofer sin vehículo. Las cinco
  altas fallaban en silencio, nadie reportaba posición y las capturas salían
  con el panel vacío, sin un solo error a la vista. Ahora crea los vehículos
  primero, **grita si un alta falla**, verifica que la flota se vea en pantalla
  y manda un latido de GPS mientras arranca el navegador (si no, las cinco
  salían como SIN SEÑAL y sin brechas, que es lo contrario de lo que el banco
  existe para mostrar).
- **`gerencia-shot.js`** entraba por `gerencia.html`, que desde la fusión con
  Despacho es una redirección con un cartel: el banco fotografiaba el cartel y
  después se caía buscando un formulario que ya no existe. Ahora entra por
  `despacho.html` → Gestión → Números, como el gerente de verdad.
- **El botón «CSV turnos» del gerente devolvía 404.** Pedía `turnos.csv` y el
  informe se llama `horas`. La pantalla decía "No se pudo descargar", que se
  lee igual que un servidor caído. Los tres botones quedaron con el nombre del
  servidor y con suite propia.

### 3ter · Dos bugs que salieron de mirar, no de usar — HECHO (7/8)

Los dos estaban en la misma pantalla y ninguno se veía en la regresión.

- **El privado de Despacho cruzaba el borde de empresa.** El código de
  vehículo es único en TODO el servidor, y el envío privado solo comprobaba
  que el vehículo *existiera*. Con eso, al Despacho de una cooperativa le
  alcanzaba con acertar el código de una combi ajena para escribirle a su
  chofer — y le llegaba, porque el reparto solo miraba el vehículo, sin ruta
  ni empresa. **Medido**: un mensaje cruzado de una cooperativa a otra, en
  una base con las dos. Es la misma frontera que defiende la suite
  `empresas` entera, por la única puerta que nadie había mirado. Ahora una
  combi de otra empresa se trata como inexistente —el criterio que ya usaba
  el alta de personas— y la prueba quedó puesta en esa suite.
- **Cambiar de ruta no cerraba la conversación privada abierta.** El código
  quería hacerlo y no podía: preguntaba por la ruta anterior desde adentro
  de un `setRouteInfo(prev => …)` puesto DESPUÉS del `setRouteInfo(…)` que
  ya la había pisado. React aplica la cola en orden, así que `prev` era
  siempre el valor nuevo, la condición nunca daba verdadera y la
  conversación quedaba abierta apuntando a una combi de la ruta anterior —
  con sus no leídos. Sumado al bug de arriba, es la forma realista de
  mandarle un privado a quien no era. Va contra un ref, que es lo que
  guarda el valor viejo de verdad.

### 4 · Deuda conocida que NO es urgente

| # | Qué | Estado |
| --- | --- | --- |
| 4.1 | **Babel compila en el navegador** | 3 MB y arranque lento. Es el precio de no tener paso de build, y ese precio se eligió a conciencia. Se paga una vez por dispositivo (el service worker lo guarda). Vale revisarlo cuando la app del chofer sea 100 % nativa y los paneles queden solo en desktop |
| 4.2 | **Una sola instancia, SQLite compartido** | Alcanza de sobra para decenas de cooperativas. El día que no alcance, `ESCALABILIDAD.md` tiene el plan con números |
| 4.3 | **iPhone** | Todo el desarrollo asume Android, que es lo que usan los choferes. Nada está probado en iOS |
| 4.4 | **Nombres cosméticos con "R-14"** | "Servidor COOP-R14", títulos de páginas, la descripción del `package.json`. El modelo de datos ya es multi-cooperativa; esto es solo texto que suena a un solo cliente |
| 4.5 | **Despacho no puede PEDIR una grabación de recorrido** | Preguntado por el dueño (8/8). Grabar sale sólo de la app del que va arriba (Perfil → GRABAR RECORRIDO) y come del GPS de ese teléfono; Despacho únicamente **consume** —lista las grabaciones de su empresa y las importa al trazador—. Que Despacho apriete "grabar" en su panel no puede existir: no tiene GPS en la calle. Lo que sí sería implementable es que **pida** una: un flag que la app levanta en su próximo POST y arranca sola, con aviso al chofer. Chico, y sin nada que lo bloquee |

---

## Puesta en producción — la lista corta

- [ ] **Cambiar `CREATOR_PASSWORD`** (ver 1.1).
- [x] Respaldo automático de la base, con descarga desde el panel del creador (ver 1.2).
- [x] Volumen montado y `DB_FILE` apuntando ahí — comprobado con un
      despliegue real: los datos sobrevivieron al cambio de contenedor.
- [x] Segundo factor del panel del creador activo (`CREATOR_TOTP_SECRET`).
- [ ] Cargar el recorrido real con el trazador.
- [x] Marca de cada cooperativa (logo y nombre) configurable desde el panel
      del creador y corregible desde Despacho.
- [x] **Ninguna pantalla depende de un CDN para dibujar el mapa** (ver 2.2).
      A 2000 unidades son 2000 navegadores contra un servicio gratuito que no
      se comprometió a atendernos — y que ya falló una vez en producción.
- [x] **El historial aguanta el tamaño de la flota** (ver 2.5): la retención
      es por días y no por filas, así que significa lo mismo con 6 combis que
      con 2000.
- [x] **El estado viaja comprimido** (`permessage-deflate`). El WebSocket de
      estado era el 90 % del egress a 2000 unidades (~$518/mes, `COSTOS.md`)
      y los ~89 MB de datos móviles que el chofer paga por turno: la suite
      `compresion` mide **−90 % de bytes por estado** contra el servidor
      real. La app nativa no ofrece la extensión y sigue exactamente igual.
      Del mismo viaje: el índice `laps(finishedAt)`, que saca los 142 ms de
      bloqueo del hilo único en cada carga de la pestaña de vueltas.

### Lo que todavía no se midió, y no se arregla programando

Para 2000 unidades quedan dos preguntas que solo contesta la calle, y las dos
siguen abiertas (ver 1.3): **el turno de 8 horas** con el GPS y la pantalla
bloqueada. La otra —**las tiles del mapa**— quedó resuelta en tres capas:

1. **Licencia**: las cuatro pantallas dejaron CARTO (su CDN es solo
   enterprise y sin fines de lucro — cobrando pasaje estábamos fuera de
   licencia). El proveedor con clave es Geoapify (`GEOAPIFY_API_KEY`), cuyo
   plan gratuito sí permite uso comercial. La suite `tiles` vigila que
   ningún host sin licencia vuelva a entrar al código.
2. **Mapa propio**: el área de operación se dibuja de datos de OSM
   (`herramientas/mapa-propio/`, una entrada por ciudad en `zonas.js`) y se
   publica como PMTiles raster en el release `mapa-propio` (workflow de
   Actions). El servidor la baja a su volumen al arrancar
   (`TILES_RELEASE_URL`) y la sirve tile por tile.
3. **La cascada** (pantallas del chofer, web y nativa): caché del service
   worker → mapa propio → Geoapify de excepción, con rescate por tile si el
   propio falla y contadores (`window.TILES_STATS`) para verificar que el
   proveedor es la excepción. Despacho y el creador usan Geoapify directo a
   propósito: el mapa propio v1 no tiene nombres de calles y ahí se trazan
   rutas; son ~30 pantallas contra 2000.

**Renovar el mapa en servidores ya poblados** era lo más urgente de esta
lista y quedó **HECHO** (7/8). Era un procedimiento manual disfrazado de
pendiente menor: los archivos se llamaban siempre igual
(`juliaca-claro.pmtiles`) y el servidor bajaba solo lo que le faltaba —
como no le faltaba nada, el mapa nuevo **no llegaba nunca**. La única forma
era entrar al volumen, vaciar `tiles/` y redesplegar, servidor por
servidor, sin que nada avisara si te lo olvidabas. Y aun haciéndolo, el
chofer seguía viendo el mapa viejo: el service worker guarda las tiles
caché-primero y sin expiración.

Ahora cada archivo lleva su versión en el nombre
(`juliaca-claro-3f9a1c02.pmtiles`, los 8 primeros hex del sha256 de su
contenido, que pone el extractor), y de ahí salen las cuatro propiedades
solas: el mapa que cambió **baja solo** al reiniciar, el que reemplazó **se
borra** (sin eso cada renovación deja tirada una copia entera del mapa
anterior en un volumen que se paga por GB, y se acumulan),
el que no cambió **no se vuelve a bajar**, y como la versión viaja también
en la URL de cada tile, **el mapa nuevo le llega al celular**. La URL de
tile sin versión sigue atendida a propósito: es la que piden los APK que ya
están en la calle. Renovar es correr el workflow de nuevo y nada más. Suite
`renovacion`, que lo corre entero contra el servidor real con un release de
mentira — incluido el reinicio que no debe mover un byte.

Lo que queda pendiente de esto: **nombres de calles** en el mapa propio si
Despacho los extraña, y correr el workflow al agregar cada ciudad nueva
(Cusco, Arequipa, La Paz: una línea en `zonas.js` + Run workflow).

## Lo que queda por construir

**Nada, hasta que alguien lo use.** Los tres cambios de esquema invasivos están
hechos, el rediseño está hecho y el panel del gerente está hecho. Lo que sigue
en esta lista ya no sale de mirar el código: sale de la calle.

Las dos que aparecieron con el panel del gerente —**guardar el objetivo con
cada vuelta** y **guardar los desvíos**— ya están hechas (2.3 y 2.4), la que
apareció midiendo —**la palabra al lado del color**— también (3.2), y la que
salió de usar el SOS en un teléfono de verdad —**el tipo de emergencia**—
quedó cerrada el 6/8 (ver 3.1).

---

## Lo que quedó afuera del rediseño, y por qué

Tres cosas de la propuesta de Design no se implementaron. Ninguna es una
omisión: cada una pedía un dato o un comportamiento que no existe. De las
tres, **la primera ya está hecha** (7/8) y queda abajo tachada.

- **«Último respaldo» y «errores en 24 h»** en el panel del creador. No hay
  respaldos automáticos ni registro de errores. Son features de operación, no
  de interfaz, y una tarjeta que muestre un número inventado es peor que no
  tenerla.
- ~~**«7 / 9 unidades»** en la cabecera de la lista de Despacho~~ **HECHO**
  (7/8). No hizo falta el endpoint nuevo que se temía: el total viaja en el
  mismo estado de tiempo real (`flota`), que ya sale cada 3 s por ruta, con
  un índice sobre `vehicles(routeId)` para que contarlo no toque el hilo
  único de SQLite. La cabecera dice **«N de M»**. El número solo nunca
  contestaba la pregunta de las 6 de la mañana, que no es cuántas se ven
  sino **cuántas faltan**. Un detalle que sí apareció construyéndolo: el
  numerador cuenta por la ruta de la PERSONA y el denominador por la del
  VEHÍCULO, y un supervisor puede dejar a alguien de una ruta arriba de una
  combi de otra; si los números quedan incoherentes se muestra el de
  siempre, antes que un «10 de 9» que se lee como pantalla rota.
- **El segmentado «Dibujar | Mover | Borrar» y «Simplificar a 10 m»** del
  trazador. La herramienta no tiene modos —se dibuja tocando, se corrige
  arrastrando, se borra tocando el punto— y la simplificación pasa al
  importar. Agregarlos habría sido cambiar comportamiento.

## Lo que ningún diseño resuelve

Hay preguntas que no se contestan construyendo: si el celular aguanta un
turno con el GPS prendido a 3800 m, si el chofer efectivamente mira el HUD
manejando, si Despacho usa el chat o levanta el teléfono igual, si el
trazado real coincide con lo que dibujemos. **Ya hay algo que se puede poner
en dos o tres unidades una semana**, y esa semana va a reordenar esta lista
mejor que nosotros.

---

## Ítems ya cerrados

- **Panel del gerente de ruta.** Despacho opera el día, el gerente mira:
  pantalla aparte, rol `manager` con alcance a una ruta o a toda la
  cooperativa, y **ni un solo endpoint que escriba**. Cumplimiento de la
  brecha como cifra que encabeza, tendencia por día, comparación unidad por
  unidad con las horas al lado de las vueltas, horas por persona e informes.
  Las cuentas las crea el nivel de arriba y no Despacho: buena parte de lo que
  el gerente mira es el trabajo de Despacho. Ver README, sección Panel del
  gerente de ruta.
- **Rediseño de la interfaz.** Panel de Despacho, Gestión como espacio de
  trabajo con riel (en vez de ocho pestañas en un modal de 760 px), trazador y
  panel del creador. Ningún cambio de comportamiento, de endpoints ni de
  permisos: los cuatro avisos de seguridad quedaron sin suavizar, las dos
  confirmaciones nombran sobre qué actúan, y ninguna acción cambió de panel.
  La app del chofer quedó fuera de esta vuelta a propósito. Ver README,
  secciones Panel de Despacho, El recorrido de la ruta y Panel del creador.
- **Brecha promedio por vuelta.** Cada vuelta guarda la brecha que mantuvo,
  medida contra la unidad de adelante. Es lo que faltaba para saber no solo
  cuántas vueltas dio cada unidad sino si las dio bien. Empieza a existir el
  día que se enciende — no se puede reconstruir. Ver README, sección Brecha
  promedio por vuelta.
- **Rutas alternas.** Variantes del recorrido por ruta, con ida y vuelta cada
  una: se crean desde el panel del creador, Despacho elige con cuál se mide y
  la dibuja con su trazador. Al cambiar, las vueltas en curso se descartan
  (venían medidas con otro trazado), el promedio histórico no mezcla
  geometrías y la vigencia programada activa y desactiva sola. Ver README,
  sección Rutas alternas.
- **Panel del creador.** El nivel de arriba de todas las cooperativas, hecho
  pantalla: alta de empresas, cuentas de Despacho, rutas, suspensión, salud
  del servidor y actividad de todas juntas. Apagado salvo que
  `CREATOR_PASSWORD` esté en el entorno —sin eso las rutas dan 404, no 403—,
  con credencial fuera de la tabla `users`, ruta configurable y segundo
  factor opcional. La consola (`empresa.js`) sigue siendo el piso, y las dos
  puertas comparten operaciones. Ver README, sección Panel del creador.
- **Empresas (multi-cooperativa).** `companies` arriba de las rutas, con la
  empresa como borde de todo lo que se consulta —rutas, gente, flota,
  turnos, vueltas, auditoría, informes, chat, mapa y SOS—, alta de
  cooperativas solo desde el nivel de arriba, y suspensión que cierra las
  sesiones en el momento. Toda cuenta pertenece a una empresa: no hay "sin
  empresa = ve todo". Ver README, sección Empresas.
- **Informes exportables** en CSV: vueltas, horas por persona, emergencias y
  actividad de administración, cada uno declarando con qué se midió. Ver
  README, sección Informes.
- **Desvío de ruta**, tratado como gestión y no como alarma: solo si se
  sostiene, umbral por ruta, y Despacho puede silenciarlo cuando el desvío ya
  se sabe. Ver README, sección Desvío de ruta.
- **Turnos.** Se abre cuando la persona entra a su unidad y se cierra cuando
  se va, tolerando cortes de señal y reinicios del servidor. Panel → TURNOS,
  con horas por persona. Ver README, sección Turnos.
- **Revisión de seguridad**: inyección de HTML por identificadores, fuerza
  bruta por origen, cupo de mensajes por conexión. Ver README, sección Qué
  frena cada cosa.
- **Objetivo de brecha automático.** Vuelta promedio del mismo día de la
  semana ÷ unidades en ruta, con arranque en frío que respeta el valor manual,
  suavizado para que el HUD no parpadee y topes de cordura. Ver README,
  sección Objetivo de brecha automático.
- **Mensaje directo Despacho ↔ unidad.** Conversación privada por vehículo
  (la ven el chofer y su cobrador), con canal aparte en la app del chofer,
  historial que solo reciben las dos partes y chofer ↔ chofer bloqueado a
  propósito. Ver README, sección Mensaje directo a una unidad.
- **Ruta como puntos GPS.** Trazado real por ruta (`route_points`), progreso
  calculado en el servidor proyectando la posición sobre la polilínea, y un
  trazador en el panel para cargarlo tocando el mapa o importando un GPX.
  Ver README, sección El recorrido de la ruta.
- **Identidad: persona ≠ unidad.** Personas (chofer/cobrador) con nombre
  obligatorio y alias opcional, vehículos aparte, un solo reportero de
  GPS por vehículo y modo acompañante para el que no maneja. Las bases
  existentes migraron solas. Ver README, sección Identidad.
- Multi-ruta con brechas, chat, vueltas y auditoría por ruta.
- Autenticación con roles, altas por Despacho, auditoría de cada acción.
- Consumo de datos: de 5,2 GB a 98 MB por turno (ver `ESCALABILIDAD.md`).
- Panel de Despacho responsivo e instalable, con gestión de unidades.
