# Pruebas — COOP-R14

Veintisiete suites. La mayoría corre contra el servidor de verdad: levantan un proceso,
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
ellas van a mirar. Las otras ocho levantan la suya, y siete (`hud`, `chat`,
`cola`, `margenes`, `gestos`, `imagen` y `nativas`) no necesitan ninguno:
prueban lógica pura de la app nativa y sus versiones.

```bash
# las que necesitan servidor: tramos objetivo informes desvio turnos privado seguridad empresas
DB=/tmp/una.db
PORT=3001 DB_FILE=$DB DISPATCH_PASSWORD=despacho99 node ../server/index.js &
DBFILE=$DB DB_FILE=$DB node turnos.js

# las que se arman solas: variantes brecha creador gerencia cliente senal gpshttp foto marca
# las que no necesitan servidor: hud chat cola margenes gestos imagen tema mapa nativas
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
| `empresas` | Que dos cooperativas no se vean **nada**: ni panel, ni mapa, ni chat, ni SOS |
| `variantes` | Rutas alternas: que cambiar el trazado descarte las vueltas en curso y no mezcle geometrías en el promedio |
| `brecha` | Que la brecha promedio por vuelta se guarde, sea creíble, y quede vacía cuando no hay con qué compararse |
| `creador` | Las cuatro barreras del nivel de arriba, incluido que sin `CREATOR_PASSWORD` responda 404 y no 403 |
| `gerencia` | Que el gerente vea lo suyo y **no toque nada**: 403 en todo `/admin/*`, rechazo en el WebSocket, y que Despacho no le pueda tocar la cuenta |
| `senal` | Que una unidad que deja de reportar quede **sin señal** y no borrada: que la de atrás no salte a medirse contra la que sigue, que vuelva sola al reaparecer, que se olvide recién a los 3 min, y que ninguna brecha salga con los segundos en 60 |
| `gpshttp` | `POST /gps`: que la posición pueda entrar **sin WebSocket vivo**, que un atraso entero se mida con la hora de cada posición y no la de llegada, y que el cobrador y los relojes mal puestos no pasen |
| `hud` | Qué se le muestra al chofer en la app nativa: los tres estados de un lado, cuál es el dígito grande, los colores y el texto de la notificación. Sin servidor — es lógica pura |
| `chat` | El chat de la app nativa: que un privado no aparezca en el grupo, que Despacho se lea como Despacho, que el hilo no repita al reconectar y que lo propio no cuente como sin leer |
| `cola` | Las posiciones guardadas cuando no hay datos: orden, tope, y que un corte a la mitad de la descarga no las pierda |
| `foto` | Las fotos contra el servidor de verdad: que una de más no pase, que el tope del cliente y el del servidor sean **el mismo número** (el servidor descarta en silencio: si se separan, el chofer ve su foto salir y nunca llega), que una privada no se filtre al grupo, y que una ráfaga de fotos no le borre el audio a las notas de voz |
| `margenes` | Dónde terminan las barras de Android en cada configuración —botones, gestos, muesca, horizontal, y un Android viejo que reporta 0—. Existe por un bug medido: el botón de CHAT quedaba **debajo** de los botones del sistema |
| `gestos` | Pasar de pantalla deslizando **sin** robarle el gesto al SOS ni al scroll del chat. Un falso SOS moviliza gente; un scroll que cambia de pantalla hace el chat inusable |
| `imagen` | Las cuentas de la foto: a qué medida se achica según sea vertical u horizontal, que una chica no se AGRANDE, y que el peso no se confunda con el largo del base64 (infla 4/3, y confundirlos rechaza fotos que entraban) |
| `tema` | Los colores de día y de noche: que la regla horaria sea la de Juliaca, que la de noche sea más oscura y **menos azul** (el azul es lo que arruina la visión nocturna del chofer), que verde/ámbar/rojo sigan siendo reconocibles, y que ninguna paleta tenga huecos |
| `mapa` | Qué se dibuja en el mapa del chofer: que la unidad sin señal siga apareciendo pero apagada, que una sin coordenadas no termine en el Golfo de Guinea, y que un apellido con comilla o con `<` no rompa la página del WebView — los nombres los tipea Despacho a mano |
| `marca` | La identidad de cada cooperativa: qué logo se acepta (los SVG NO — son documentos con scripts adentro y esto se pinta en el panel y en el WebView del chofer), qué se muestra cuando no hay logo, y sobre todo que **una cooperativa no le pueda pisar el logo a la de al lado** mandando el companyId ajeno. Ahí adentro está también la prueba de que un trazado real de 2000+2000 puntos entra por el cable: el tope de cuerpo de express venía más chico que lo que el servidor decía aceptar |
| `nativas` | Las versiones de los módulos nativos de la app: que ningún `expo-*` venga de otro SDK, que no haya un módulo duplicado, que el lockfile no quede viejo, y que no se use una API que Expo dejó como stub que revienta. Lee el lockfile: sin teléfono, sin red, un segundo. Existe porque un `expo-asset` del SDK 57 al lado de un `expo-modules-core` del 54 dejó la app sin abrir, y eso solo se veía con el APK ya instalado, veinte minutos de build después |
| `cliente` | El cliente del protocolo que va a usar la app nativa (`app/protocolo/`): el rol de GPS cuando hay relevo, las brechas que respetan el null, el freno de cadencia y el privado que no se filtra |

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
node gerencia-shot.js   # el panel del gerente, con tres semanas de historial
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
