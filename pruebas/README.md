# Pruebas — COOP-R14

Cuarenta y cuatro suites. La mayoría corre contra el servidor de verdad: levantan un proceso,
abren WebSockets, mandan posiciones GPS y leen la base. **No hay mocks.** Es a
propósito: casi todo lo que se rompió en este proyecto se rompió en la juntura
entre el servidor, la base y el tiempo real, y un mock de cualquiera de los
tres habría tapado justo eso.

## Correr todo

```bash
cd pruebas && npm install     # solo la primera vez
npm test
```

Sale una línea por suite y un veredicto:

```
tramos     ok
objetivo   ok
...
=== REGRESIÓN VERDE ===
```

Una suite en rojo imprime sus fallas debajo. El código de salida es 1 si algo
falló, así que sirve en CI tal cual.

## Correr una sola

Ocho suites **esperan un servidor ya levantado en 3001** con la base a la que
ellas van a mirar. Las demás levantan el suyo solas, y trece no necesitan
ninguno: prueban lógica pura —de la app nativa, del trazador del creador y
las versiones—.

```bash
# las que necesitan servidor: tramos objetivo informes desvio turnos privado seguridad empresas
DB=/tmp/una.db
PORT=3001 DB_FILE=$DB DISPATCH_PASSWORD=despacho99 node ../server/index.js &
DBFILE=$DB DB_FILE=$DB node turnos.js

# las que se arman solas: variantes brecha creador gerencia cliente senal gpshttp presencia foto marca respaldo
# las que se arman solas (cont.): vendor retencion renovacion cascada mapa-shot compresion sos perfil grabador cobradores metidos
# las que no necesitan servidor: trazador ausencia hud chat cola margenes gestos imagen tema contraste mapa teclado nativas
node gerencia.js
```

Dos detalles que cuestan una tarde si no están escritos:

- **Se pasan `DBFILE` y `DB_FILE`**, las dos. Unas suites leen una y otras la
  otra; unificarlas es un cambio de una línea que nadie hizo todavía.
- **Las suites no son re-entrantes entre sí.** Cada una asume una base recién
  creada: `turnos` cuenta los turnos que hay y `objetivo` cuenta las vueltas.
  Corridas todas contra la misma base dan rojo por motivos que no tienen nada
  que ver con el código. Por eso `regresion.js` le da a cada una su propio
  servidor y su propio archivo, y **espera a que el puerto 3001 quede libre**
  entre una y otra: sin esa espera el servidor nuevo no puede atarse al puerto,
  se muere, y la suite le habla al de la suite anterior.

## Qué cubre cada una

| Suite | Qué defiende |
| --- | --- |
| `tramos` | El circuito es ida + vuelta: progreso, tramo en el que va cada unidad y brechas sobre el circuito entero |
| `objetivo` | El objetivo de brecha automático: cuándo confía en el historial, cuándo cae al manual, y que el día de la semana no se mezcle |
| `informes` | Los CSV: que las horas salgan de los turnos y que un nombre con `;` o comillas no parta el archivo |
| `desvio` | Que el desvío se marque solo si se sostiene, y que se pueda silenciar |
| `turnos` | Que un corte de señal no parta el turno y que un reinicio no deje turnos abiertos para siempre |
| `privado` | El mensaje directo Despacho ↔ unidad: que lo vean los dos y nadie más |
| `seguridad` | Inyección por identificadores, fuerza bruta y cupo de mensajes por conexión |
| `empresas` | Que dos cooperativas no se vean **nada**: ni panel, ni mapa, ni chat, ni SOS. Incluido el privado de Despacho, que era la puerta que faltaba mirar: el código de vehículo es único en TODO el servidor y el envío solo comprobaba que existiera, así que acertar el código de una combi ajena alcanzaba para escribirle a su chofer — medido cruzando un mensaje de una empresa a otra, hoy cerrado y con la prueba puesta |
| `cobradores` | Que el chofer administre a los cobradores de SU combi —clave y baja—, y que ahí termine. Lo que se prueba no es que funcione sino dónde corta: **el alta por esta puerta no existe** (se le pega al endpoint, no se mira la pantalla: que un botón no esté no prueba nada), el cobrador del de al lado no se toca (404, y el error no confirma que exista), un cobrador no administra cobradores ni a su compañero, y el vecino no ve lo que no es suyo. Más lo que queda escrito: clave y baja auditadas —del cambio de clave, QUE la cambió y nunca cuál—, ninguna alta a nombre de un chofer, y la gerencia siguiendo viendo a todos |
| `variantes` | Rutas alternas: que cambiar el trazado descarte las vueltas en curso y no mezcle geometrías en el promedio |
| `brecha` | Que la brecha promedio por vuelta se guarde, sea creíble, y quede vacía cuando no hay con qué compararse |
| `creador` | Las cuatro barreras del nivel de arriba, incluido que sin `CREATOR_PASSWORD` responda 404 y no 403 |
| `gerencia` | La fusión de los dos paneles: el gerente entra a `/admin/*` y al tiempo real como un panel más, y puede lo que Despacho no — vehículos con placa, chofer-con-combi de una, datos de la empresa, logo. Despacho recibe 403 en todo eso (y el error dice quién sí), no le puede tocar la cuenta al gerente, y `/gerencia/*` sigue siendo solo del gerente |
| `presencia` | Salir a ruta, ausente, fuera — y la CONFIRMACIÓN física. El caso tiene nombre: Ignacio marca "en ruta" desde su casa a las 5:30; Despacho lo ve "yendo", pero NO entra a la cadena de brechas hasta que el GPS lo ve **sobre el trazado** (el mismo umbral del desvío). AUSENTE (comer, un repuesto) lo saca de la cadena sin echarlo del mapa y los vecinos se recomponen; FUERA lo borra del mapa en el acto, sin esperar al olvido; y la presencia viaja pegada al `POST /gps`, así sobrevive a la pantalla apagada y a un reinicio del servidor. Sin declarar nada, todo sigue como siempre — la compatibilidad también se prueba |
| `ausencia` | El vigía de la ausencia (`app/ausencia.js`): que el que arranca después de almorzar **vuelva a ruta solo** (dos posiciones seguidas lejos del ancla), que un salto de GPS de alguien sentado comiendo NO lo devuelva, que media hora de zigzag parado no dispare nada, y que pasadas 2 horas la ausencia se convierta en **fuera** — aunque se esté moviendo. Lógica pura: vive en la tarea de fondo y se prueba sin teléfono |
| `senal` | Que una unidad que deja de reportar quede **sin señal** y no borrada: que la de atrás no salte a medirse contra la que sigue, que vuelva sola al reaparecer, que se olvide recién a los 3 min, y que ninguna brecha salga con los segundos en 60 |
| `gpshttp` | `POST /gps`: que la posición pueda entrar **sin WebSocket vivo**, que un atraso entero se mida con la hora de cada posición y no la de llegada, que el cobrador y los relojes mal puestos no pasen, que **la brecha vuelva en la respuesta** (es lo que mantiene viva la notificación con la pantalla apagada), y que **vaciar atraso no sea estar muerto**: al que llega con posiciones viejas se lo oye — queda en gris, jamás borrado |
| `hud` | Qué se le muestra al chofer en la app nativa: los tres estados de un lado, cuál es el dígito grande, los colores y el texto de la notificación. Sin servidor — es lógica pura |
| `chat` | El chat de la app nativa: que un privado no aparezca en el grupo, que Despacho se lea como Despacho, que el hilo no repita al reconectar y que lo propio no cuente como sin leer |
| `cola` | Las posiciones guardadas cuando no hay datos: orden, tope, y que un corte a la mitad de la descarga no las pierda |
| `foto` | Las fotos contra el servidor de verdad: que una de más no pase, que el tope del cliente y el del servidor sean **el mismo número** (el servidor descarta en silencio: si se separan, el chofer ve su foto salir y nunca llega), que una privada no se filtre al grupo, y que una ráfaga de fotos no le borre el audio a las notas de voz |
| `margenes` | Dónde terminan las barras de Android en cada configuración —botones, gestos, muesca, horizontal, y un Android viejo que reporta 0—. Existe por un bug medido: el botón de CHAT quedaba **debajo** de los botones del sistema |
| `gestos` | Pasar de pantalla deslizando **sin** robarle el gesto al SOS ni al scroll del chat. Un falso SOS moviliza gente; un scroll que cambia de pantalla hace el chat inusable |
| `imagen` | Las cuentas de la foto: a qué medida se achica según sea vertical u horizontal, que una chica no se AGRANDE, y que el peso no se confunda con el largo del base64 (infla 4/3, y confundirlos rechaza fotos que entraban) |
| `tema` | Los colores de día y de noche: que la regla horaria sea la de Juliaca, que la de noche sea más oscura y **menos azul** (el azul es lo que arruina la visión nocturna del chofer), que verde/ámbar/rojo sigan siendo reconocibles, y que ninguna paleta tenga huecos |
| `contraste` | Las paletas de las tres pantallas **web** (`tema` cubre la nativa): que cada par tinta/fondo que el código realmente compone mida AA 4.5:1 —o 3:1 solo en el número gigante de brecha—, que el tema `sun` lea **mejor** que `day` en todos los pares, que `day` siga siendo el de fábrica, que `#FF2D55` aparezca solo como rojo de emergencia de `night`, y que el `:root` del creador no se separe en silencio de la paleta `day` de Despacho, de la que es copia. Lo que pasa su piso pero no llega a AA se lista en cada corrida, informativo |
| `mapa` | Qué se dibuja en el mapa del chofer: que la unidad sin señal siga apareciendo pero apagada, que una sin coordenadas no termine en el Golfo de Guinea, y que un apellido con comilla o con `<` no rompa la página del WebView — los nombres los tipea Despacho a mano |
| `marca` | La identidad de cada cooperativa: qué logo se acepta (los SVG NO — son documentos con scripts adentro y esto se pinta en el panel y en el WebView del chofer), qué se muestra cuando no hay logo, y sobre todo que **una cooperativa no le pueda pisar el logo a la de al lado** mandando el companyId ajeno. Ahí adentro está también la prueba de que un trazado real de 2000+2000 puntos entra por el cable: el tope de cuerpo de express venía más chico que lo que el servidor decía aceptar |
| `trazador` | La lógica del trazador del panel del creador (`server/trazador.js`), sin mapa ni navegador: que un clic **sobre la línea** inserte en el segmento correcto y uno lejos agregue al final, que borrar entre dos puntos respete los elegidos y no le importe el orden, que **deshacer** devuelva el estado de antes aunque el presente se haya seguido mutando, que simplificar borre el zigzag del GPS pero no las esquinas, y que un GPX o GeoJSON se lea con lat y lng en su lugar. El mismo archivo que corre en el navegador, probado con `require()` |
| `respaldo` | El respaldo de la base, juzgado por lo único que importa: **la restauración**. Respalda una base real en caliente, la abre de vuelta y lee las filas; rechaza la basura y la base equivocada; rota borrando los más viejos; y por el panel del creador crea, lista y **descarga** — y lo descargado se abre y tiene el DESPACHO adentro. Un `../` en el nombre no es un nombre |
| `teclado` | Cuánto levantar la pantalla cuando sale el teclado de Android. Existe porque el campo de escribir quedaba DEBAJO del teclado: `KeyboardAvoidingView` sin `behavior` no hace nada en Android, y lo que sí resolvía el sistema —achicar la ventana— no ocurre con edge-to-edge. La cuenta fina es no contar dos veces la barra de navegación, que la pantalla ya reservó |
| `nativas` | Las versiones de los módulos nativos de la app: que ningún `expo-*` venga de otro SDK, que no haya un módulo duplicado, que el lockfile no quede viejo, y que no se use una API que Expo dejó como stub que revienta. Lee el lockfile: sin teléfono, sin red, un segundo. Existe porque un `expo-asset` del SDK 57 al lado de un `expo-modules-core` del 54 dejó la app sin abrir, y eso solo se veía con el APK ya instalado, veinte minutos de build después |
| `vendor` | Que **ninguna pantalla dependa de un CDN para poder dibujar el mapa**. No es una precaución teórica: unpkg no le entregó `leaflet.js` al navegador del creador y elegir una ruta dejaba la página en blanco, sin un solo error a la vista — `L` no existía y el script se cortaba en la primera línea. Verifica que el servidor entregue Leaflet de verdad (y no un 404 con forma de página), que los tres HTML lo pidan a su propio origen, que el WebView del APK lo lleve adentro del bundle, y que **la copia del APK y la del servidor sigan siendo la misma**: si alguien sube la versión en `server/vendor/` y se olvida de correr `herramientas/vendor-leaflet.js`, la app se queda con la vieja y nadie se entera hasta ver algo raro en el teléfono |
| `retencion` | Cuánto historial se guarda, y que **el tamaño de la flota no lo decida**. Los topes eran de filas y globales —2000 vueltas, 1000 mensajes—: con seis combis son meses, con 2000 unidades son tres horas de vueltas, y como el SOS vive en la misma tabla que el chat, una tarde de conversación activa borraba las emergencias del mes y el informe salía vacío sin que nada lo dijera. Siembra filas con fecha puesta a mano —para no esperar cuatro meses—, reinicia el servidor y mira qué sobrevivió: la vuelta de hace 119 días sí y la de 200 no, la charla de hace dos meses no y **el SOS de ese mismo día sí** | 
| `cliente` | El cliente del protocolo que va a usar la app nativa (`app/protocolo/`): el rol de GPS cuando hay relevo, las brechas que respetan el null, el freno de cadencia y el privado que no se filtra |
| `tiles` | De dónde vienen las tiles del mapa — y de dónde NO pueden venir. CARTO y el CDN de OSM quedaron fuera de licencia para uso comercial: la suite busca los hosts prohibidos como host completo (un comentario también falla) y exige que las URLs de tiles sean del propio origen o del proveedor con clave, con la clave fuera del código |
| `renovacion` | **Renovar el mapa propio en un servidor que ya lo tiene.** Era un procedimiento manual —vaciar la carpeta del volumen y redesplegar— porque los archivos se llamaban siempre igual y el servidor solo bajaba lo que le faltaba: como no le faltaba nada, el mapa nuevo no llegaba nunca. Ahora la versión va en el nombre, y la suite lo corre entero contra el servidor real con un release de mentira: arranque en frío, mapa renovado que **baja solo y borra el que reemplazó** (si no, cada renovación deja tirada una copia entera del mapa viejo en un volumen que se paga por GB), el estilo que no cambió que no se vuelve a bajar, y un reinicio sin release nuevo que no mueve un byte. Más las dos URLs de tile (la versionada inmutable y la de siempre, que es la que piden los APK ya instalados) y la punta que no se ve corriendo: que el extractor ponga la versión en el nombre y las dos pantallas la pongan en la URL |
| `cascada` | La cascada de tiles vista desde el navegador del chofer: en los zooms cubiertos, las tiles salen del mapa propio y el proveedor no recibe **ni un pedido**; la tile que el propio no tiene —y solo esa— cae al proveedor; los contadores (`window.TILES_STATS`) cuentan la verdad, porque son la evidencia de que el proveedor es la excepción; y cada tile propia se pide **con la versión del mapa adentro de la URL**, que es lo que hace que una renovación le llegue al celular en vez de quedarse con la copia guardada |
| `mapa-shot` | Banco visual del MAPA en las cuatro pantallas, que **falla si el lienzo sale vacío**: la vara es tiles efectivamente cargadas (no pedidas) y algo dibujado encima. Un mapa en blanco no avisa — se descubre arriba de la combi |
| `compresion` | Las dos palancas de ahorro con código (`COSTOS.md` §5). El índice de vueltas existe y el plan de consulta lo usa; y la compresión del WebSocket se mide en el cable: dos espectadores reciben los MISMOS estados y el que negoció permessage-deflate tiene que recibir menos de la mitad de los bytes (medido: −90 %). El que no ofrece la extensión —la app nativa— sigue funcionando sin comprimir, y un chat mandado comprimido llega intacto al que no comprime |
| `sos` | El tipo de emergencia y el orden de las cosas: **deslizar manda la alerta YA**, sin preguntar nada; el tipo ("falla mecánica", "accidente", "policía") va después, con la emergencia ya sonando en Despacho. Los bordes: solo quien disparó puede calificar la suya, solo mientras la ventana está abierta, un tipo inventado no entra, y el historial y el CSV cuentan lo mismo que se vio en vivo — sin elegir queda "SOS" a secas, que es como nace cada uno |
| `perfil` | El perfil del conductor: **lo SUYO y nada más** (no hay parámetro de unidad: todo sale de la sesión). El espejo usa el mismo criterio que el gerente —vueltas del vehículo, horas de la persona, cumplimiento contra la vara que regía—, el alias que se edita llega **en vivo** al mapa de Despacho sin que nadie vuelva a entrar, y la contraseña se cambia con la actual en la mano, auditando QUE la cambió y nunca cuál es |
| `metidos` | El que **se mete a la ruta empezada** y el que hace **media vuelta**, sobre el circuito duro (ida y vuelta por la misma calle). Del primero: se lo confirma en ruta igual, pero marcado (`entradaTardia` con el punto por el que entró) y auditado; su primera vuelta se guarda con `parcial = 1` y queda fuera de todo promedio —resumen, acumulado por unidad, objetivo— **sin desaparecer de la lista**, y la siguiente, ya desde el inicio, sí cuenta. Del segundo: hace la ida, declara "fuera" arriba, y la ida **queda guardada** en `legs` aunque no haya cerrado ninguna vuelta; Despacho la ve con 1 ida y 0 retornos, y el perfil del chofer dice lo mismo. Más el informe `tramos.csv` y la columna que dice cuál vuelta no es entera |
| `grabador` | El grabador de recorridos, en sus dos mitades. La pura: **un punto cada 30 m RECORRIDOS** (el semáforo no genera un nudo de puntos), el paso medido desde el último guardado, retomar tras un proceso muerto, y el GeoJSON con las coordenadas [lng, lat] que el formato exige. La del servidor: la grabación sube por POST /grabacion (el largo lo calcula el servidor, no se le cree al teléfono), el panel la lista y la baja como GeoJSON —la puerta que el trazador ya importa—, un chofer no lista las ajenas, y las viejas se podan solas al tope de 25 por empresa |

## Sintaxis de las pantallas

Los paneles no tienen paso de compilación: Babel corre en el navegador, así que
un error de sintaxis solo aparece al abrir la página. Esto lo adelanta:

```bash
npm run sintaxis
```

Compila el bloque `<script type="text/babel">` de cada `.html` con el mismo
Babel que usa el navegador y dice en qué línea del archivo está el error.

Corre además `chk-rn.js`, que hace lo mismo con los archivos de la app nativa
(`app/`). Hace falta porque usan JSX e `import` —`node -c` no los parsea— y
porque las suites solo cargan los módulos puros: un error de tipeo en
`App.js` o en el servicio de GPS no aparecería hasta tener el teléfono.

## Bancos visuales

No son pruebas: levantan el servidor con datos sembrados, abren las pantallas
en Chromium y sacan capturas en `pruebas/shots/`. Sirven para mirar el
resultado y —esto es lo que más valió— para enterarse de que la página reventó,
porque listan cualquier error de JavaScript al final.

```bash
node rediseno.js        # Despacho, Gestión y el trazador
node gerencia-shot.js   # los números del gerente, con tres semanas de historial
                        # (entra por despacho.html: gerencia se fusionó con Despacho)
node creador-ui-run.js  # el panel del creador (esta sí verifica, no solo mira)
node chofer-shot.js     # la app del chofer (esta también verifica)
```

`chofer-shot.js` es la que más tardó en existir y la que más encontró: entra
como chofer con dos unidades en ruta, le mueve el GPS al navegador y revisa
que lo que se ve sea del servidor. Lo que atrapó la primera vez fue una
familia entera de datos de maqueta que se colaban como si fueran en vivo —una
unidad de atrás que no existía, una velocidad de 28 km/h con la combi parada,
un tramo de dos ciudades de la costa— porque el cliente tapaba con `||` los
`null` que el servidor manda bien.

Necesitan Chromium. En este entorno está en `/opt/pw-browsers/chromium`; en otro,
cambiar el `executablePath` o instalar el de Playwright.

`cdn.js` guarda en disco lo que se baja de CDN (React, Babel, Leaflet, fuentes,
tiles) para que una caída de red no deje la página en blanco a mitad de una
corrida. Baja **de a una y con reintento**: el proxy del sandbox contesta 503
cuando le entran varias juntas, y el navegador pide React, React-DOM, Babel,
Leaflet y las fuentes en paralelo. Sin eso el caché nunca llegaba a poblarse
en la primera corrida y los bancos morían con la página en blanco.

## Lo que estas pruebas NO cubren

Y conviene tenerlo escrito, porque verde acá no significa que funcione en la
calle:

- **Nada de lo que pasa en un celular de verdad**: batería con el GPS prendido
  a 3800 m, la app en segundo plano, señal que va y viene, el chofer mirando o
  no la pantalla. Eso solo lo contesta una semana en ruta.
- **La precisión del GPS real.** Las suites mandan coordenadas perfectas; en la
  calle hay rebote entre edificios y derivas de decenas de metros.
- **Carga.** Todo corre con un puñado de unidades. Los números de 20+ rutas
  están estimados en `ESCALABILIDAD.md`, no medidos.
