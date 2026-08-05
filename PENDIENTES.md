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
| 3.0 | **La puerta de presencia en la app web del chofer** | `Prototipo.html` no declara presencia: emite desde el login, como siempre (compatibilidad a propósito). Si alguien sigue usando la web en vez del APK, dejarla igual que la nativa — o decidir retirarla | medio día |
| 3.1 | **Tipo de emergencia en el SOS** | "Falla mecánica", "accidente" y "policía" no movilizan lo mismo: uno pide una grúa, otro una ambulancia, el tercero es otra llamada. El deslizar tiene que seguir siendo lo primero —en una emergencia real nadie elige de un menú—: el tipo se elige DESPUÉS de disparar, con la alerta ya enviada, y sin elegir queda como SOS genérico | medio día |
| 3.2 | ~~La palabra al lado del color en Despacho~~ | **HECHO.** Cada brecha de la fila de unidad lleva debajo *EN OBJETIVO* / *AL LÍMITE* / *CRÍTICA*: las mismas tres bandas que ya usaba el color y los mismos términos de la leyenda del mapa. El juicio ya no depende del color en ninguna de las dos pantallas | ✔ |
| 3.3 | **La brecha en vivo en la notificación** | Hoy se refresca solo al pasar la app a segundo plano. Para tenerla viva hace falta una notificación aparte con `expo-notifications`, sin tocar el servicio de ubicación — colgarla del servicio lo reiniciaba cada 3 s y quemaba la batería | medio día |
| 3.4 | **Grabador de rutas** | Del prototipo viejo: subirse a una combi, grabar el recorrido manejando y exportar los puntos. Hoy el trazado se dibuja a ojo sobre el mapa, y manejarlo es más fiel. Guarda un punto cada 30 m recorridos, no cada N segundos, así parar en un semáforo no genera puntos repetidos | medio día |

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

### 4 · Deuda conocida que NO es urgente

| # | Qué | Estado |
| --- | --- | --- |
| 4.1 | **Babel compila en el navegador** | 3 MB y arranque lento. Es el precio de no tener paso de build, y ese precio se eligió a conciencia. Se paga una vez por dispositivo (el service worker lo guarda). Vale revisarlo cuando la app del chofer sea 100 % nativa y los paneles queden solo en desktop |
| 4.2 | **Una sola instancia, SQLite compartido** | Alcanza de sobra para decenas de cooperativas. El día que no alcance, `ESCALABILIDAD.md` tiene el plan con números |
| 4.3 | **iPhone** | Todo el desarrollo asume Android, que es lo que usan los choferes. Nada está probado en iOS |
| 4.4 | **Nombres cosméticos con "R-14"** | "Servidor COOP-R14", títulos de páginas, la descripción del `package.json`. El modelo de datos ya es multi-cooperativa; esto es solo texto que suena a un solo cliente |

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

### Lo que todavía no se midió, y no se arregla programando

Para 2000 unidades quedan dos preguntas que solo contesta la calle, y las dos
siguen abiertas (ver 1.3): **el turno de 8 horas** con el GPS y la pantalla
bloqueada, y **las tiles del mapa**. Esta última tiene número: el CDN gratuito
de CARTO no está pensado para 2000 usuarios diarios, y sin caché son 20–50 MB
por turno y por chofer. El service worker ya las guarda —la segunda visita no
gasta un byte—, pero la primera de cada dispositivo sí, y a esa escala conviene
mirar el plan de `ESCALABILIDAD.md` antes de encender todo junto.

## Lo que queda por construir

**Nada, hasta que alguien lo use.** Los tres cambios de esquema invasivos están
hechos, el rediseño está hecho y el panel del gerente está hecho. Lo que sigue
en esta lista ya no sale de mirar el código: sale de la calle.

Las dos que aparecieron con el panel del gerente —**guardar el objetivo con
cada vuelta** y **guardar los desvíos**— ya están hechas (2.3 y 2.4), y la que
apareció midiendo —**la palabra al lado del color**— también (3.2).

Queda una, que salió de usar el SOS en un teléfono de verdad:

| Qué | Por qué | Tamaño |
| --- | --- | --- |
| **Tipo de emergencia en el SOS** | Hoy el SOS es uno solo. "Falla mecánica", "accidente" y "policía" no movilizan lo mismo: uno pide una grúa, otro una ambulancia, el tercero es otra llamada. Despacho podría priorizar y avisar distinto, y el informe de emergencias dejaría de ser una lista plana. El deslizar tiene que seguir siendo lo primero —en una emergencia real nadie elige de un menú—: elegir el tipo va DESPUÉS de disparar, con la alerta ya enviada, y si no elige queda como SOS genérico | medio día, tocando servidor, app y los dos paneles |

---

## Lo que quedó afuera del rediseño, y por qué

Tres cosas de la propuesta de Design no se implementaron. Ninguna es una
omisión: cada una pedía un dato o un comportamiento que no existe.

- **«Último respaldo» y «errores en 24 h»** en el panel del creador. No hay
  respaldos automáticos ni registro de errores. Son features de operación, no
  de interfaz, y una tarjeta que muestre un número inventado es peor que no
  tenerla.
- **«7 / 9 unidades»** en la cabecera de la lista de Despacho. El total de la
  flota no viaja en el estado de tiempo real; traerlo es un endpoint nuevo.
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
