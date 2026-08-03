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
| 2.1 | **Bajar el peso del arranque** | Medido hoy: la primera carga de un panel baja **4,4 MB**. De eso, 1,05 MB son `react-dom.development.js` — la build de DESARROLLO en producción, que además corre más lento. Cambiar a las de producción son dos líneas y ahorra **1 MB**. Los otros 3 MB son Babel compilando en el navegador, que es una decisión más grande (ver 4.1) | 2.1a: 15 minutos |
| 2.2 | **Bajar Leaflet localmente** | El mapa del chofer lo carga de `unpkg` DENTRO del WebView. Sin señal en la primera apertura, el mapa queda en blanco — y la primera apertura de un chofer suele ser en la calle. Son 144 kB que pueden ir incrustados en el APK | 2 horas |
| 2.3 | **Guardar el objetivo con cada vuelta** | El cumplimiento se mide contra el objetivo de HOY, no contra el que regía cuando se cerró la vuelta. Con objetivo automático eso cambia solo, así que los informes de la semana pasada mienten un poco. Una columna en `laps` | 2 horas |
| 2.4 | **Guardar los desvíos de ruta** | Se detectan y se gestionan en vivo pero no se guardan: no se puede decir cuántas veces se salió una unidad la semana pasada. Es lo que le falta al panel del gerente para cerrar el cuadro | medio día |

### 2bis · El trazador se muda al panel del creador

Decisión tomada usándolo: **las rutas las carga el nivel de arriba al dar de
alta la cooperativa**, igual que el logo — la cooperativa recibe el sistema ya
configurado. Despacho a lo sumo corrige. Hoy el trazador vive en el panel de
Despacho y se queda ahí mientras tanto, pero el destino es el creador.

Y al moverlo, dárselo con las herramientas que le faltan (pedido de quien lo
usó: "más herramientas de desplazamiento y selección"):

| Herramienta | Para qué |
| --- | --- |
| **Arrastrar un punto** | Hoy un punto mal puesto se borra y se vuelve a poner; moverlo es lo natural |
| **Seleccionar un tramo** (dos clics: desde acá hasta acá) | Borrar o rehacer una cuadra entera sin tocar el resto |
| **Insertar en el medio** | Hoy solo se agrega al final: densificar una curva obliga a rehacer desde ahí |
| **Deshacer** (Ctrl+Z) | Sin esto, cada error cuesta minutos |
| **Mover el mapa sin dibujar** (modo mano / barra espaciadora) | Desplazarse por una ruta larga sin sembrar puntos por accidente |
| **Importar GPX** | Lo que salga del grabador de rutas (3.4) entra directo |

Tamaño: 1-2 días. Va DESPUÉS del respaldo (1.2): es más horas de las que
parece y nada de esto bloquea la calle.

### 3 · Producto — lo que pidieron los que lo usaron

| # | Qué | Por qué | Tamaño |
| --- | --- | --- | --- |
| 3.1 | **Tipo de emergencia en el SOS** | "Falla mecánica", "accidente" y "policía" no movilizan lo mismo: uno pide una grúa, otro una ambulancia, el tercero es otra llamada. El deslizar tiene que seguir siendo lo primero —en una emergencia real nadie elige de un menú—: el tipo se elige DESPUÉS de disparar, con la alerta ya enviada, y sin elegir queda como SOS genérico | medio día |
| 3.2 | **La palabra al lado del color en Despacho** | Verde y ámbar son el mismo color para un daltónico rojo-verde (medido: ΔE 5,4). En gerencia ya está resuelto; en la fila de unidad de Despacho el juicio «va bien / se está yendo» todavía depende solo del color | 1 hora |
| 3.3 | **La brecha en vivo en la notificación** | Hoy se refresca solo al pasar la app a segundo plano. Para tenerla viva hace falta una notificación aparte con `expo-notifications`, sin tocar el servicio de ubicación — colgarla del servicio lo reiniciaba cada 3 s y quemaba la batería | medio día |
| 3.4 | **Grabador de rutas** | Del prototipo viejo: subirse a una combi, grabar el recorrido manejando y exportar los puntos. Hoy el trazado se dibuja a ojo sobre el mapa, y manejarlo es más fiel. Guarda un punto cada 30 m recorridos, no cada N segundos, así parar en un semáforo no genera puntos repetidos | medio día |

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

## Lo que queda por construir

**Nada, hasta que alguien lo use.** Los tres cambios de esquema invasivos están
hechos, el rediseño está hecho y el panel del gerente está hecho. Lo que sigue
en esta lista ya no sale de mirar el código: sale de la calle.

Hay dos cosas que **sí** aparecieron con el panel del gerente y valen la pena
cuando haya datos reales:

| Qué | Por qué | Tamaño |
| --- | --- | --- |
| **Guardar el objetivo con cada vuelta** | Hoy el cumplimiento se mide contra el objetivo de HOY, no contra el que regía cuando se cerró la vuelta. Con objetivo automático eso puede haber cambiado dentro del mismo período. Una columna en `laps`, y empieza a valer el día que se enciende | 2 horas |
| **Guardar los desvíos de ruta** | Se detectan y se gestionan en vivo, pero no se guardan: no se puede decir cuántas veces se salió una unidad la semana pasada. Es lo que le falta al panel del gerente para cerrar el cuadro | medio día |

Y una que salió de usar el SOS en un teléfono de verdad:

| Qué | Por qué | Tamaño |
| --- | --- | --- |
| **Tipo de emergencia en el SOS** | Hoy el SOS es uno solo. "Falla mecánica", "accidente" y "policía" no movilizan lo mismo: uno pide una grúa, otro una ambulancia, el tercero es otra llamada. Despacho podría priorizar y avisar distinto, y el informe de emergencias dejaría de ser una lista plana. El deslizar tiene que seguir siendo lo primero —en una emergencia real nadie elige de un menú—: elegir el tipo va DESPUÉS de disparar, con la alerta ya enviada, y si no elige queda como SOS genérico | medio día, tocando servidor, app y los dos paneles |

Y una que apareció midiendo, no usando:

| Qué | Por qué | Tamaño |
| --- | --- | --- |
| **La palabra al lado del color en Despacho** | Verde y ámbar son el mismo color para un daltónico rojo-verde (medido: ΔE 5,4). En gerencia ya está resuelto —número y palabra siempre—; en la fila de unidad de Despacho el juicio «va bien / se está yendo» todavía depende solo del color. Ver `LIMITACIONES.md`, sección *Accesibilidad* | 1 hora |

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
