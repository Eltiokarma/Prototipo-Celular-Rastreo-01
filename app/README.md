# App del chofer (nativa) — COOP-R14

Reemplaza **solo la pantalla del chofer**. Los tres paneles —Despacho,
gerencia y creador— siguen siendo web, y **el servidor no cambia**: esta app
habla el mismo protocolo, escrito y verificado en `PROTOCOLO.md`.

Existe por una sola razón, medida: los navegadores cortan el GPS al apagar la
pantalla, y hasta hace poco eso hacía que la de atrás recibiera *"apurá"*
hacia una combi que tenía justo adelante. Ver `LIMITACIONES.md`.

## Lo que ya está medido

En un teléfono real, con la pantalla bloqueada, **el GPS siguió reportando
varios minutos**. Es lo que la versión web no pudo hacer nunca y la razón por
la que esta app existe.

Hicieron falta tres cosas, y ninguna se dedujo leyendo — las tres aparecieron
fallando:

1. El **foreground service** nativo, con su notificación permanente.
2. Que las posiciones salgan **por HTTP y desde la propia tarea**, no desde
   React: con la app atrás, Android suspende el JavaScript y se lleva puesto
   el WebSocket y la pantalla.
3. Que el teléfono tenga la app **sin restricción de batería**. Sin eso, Doze
   le corta la red a la app de fondo: se medía un 43 % de envíos fallidos con
   "sin red". Esto no se arregla en el código.

**Lo que falta medir es un turno entero**: batería en 8 horas, y si Android
lo mata más tarde. Varios minutos no dicen nada de eso.

## Qué hay hoy

Tres pantallas —**mapa · ruta · chat**— con la ruta en el medio, así las
otras dos quedan a un solo deslizamiento. Entrar → brecha en vivo → mapa de
la ruta → chat con los dos canales → notas de voz → fotos → SOS deslizable →
GPS en segundo plano con la brecha en la notificación. Modo día/noche
automático.

## Cómo correrla

**No hay nada que "exportar".** VSCode es solo el editor: todo pasa en su
terminal. Y **el GPS en segundo plano NO funciona en Expo Go** —Expo Go no
trae el módulo nativo de ubicación en segundo plano—, así que hace falta
compilar una vez.

```bash
cd app
npm install
npx expo login          # tu cuenta de Expo
npx eas build --profile development --platform android
```

Ese build corre **en la nube de Expo**, tarda unos 10-20 minutos, y al
terminar da un link para bajar el APK al teléfono. **Se hace una sola vez**:
mientras no agregues librerías nativas nuevas, ese mismo APK sirve siempre.

Con el APK instalado, el ciclo de todos los días es:

```bash
npm start               # levanta el servidor de desarrollo
```

Se abre la app en el teléfono, se conecta, y a partir de ahí **cada vez que
guardás un archivo la app se recarga sola**. Igual que la web. El teléfono y
la PC tienen que estar en la misma wifi.

Por defecto la app le pega al **servidor que ya está en la nube**, así que la
primera prueba no depende de tu red. Para pegarle a uno local:

```bash
EXPO_PUBLIC_SERVIDOR=http://192.168.1.X:3001 npm start
```

con la IP de tu máquina en la wifi — **el celular no resuelve `localhost`**,
que para él es él mismo.

Para un APK repartible a los choferes, sin tienda:

```bash
npx eas build --profile apk --platform android
```

## Lo que hay que hacer en CADA teléfono

Y no se arregla desde el código:

- **Permitir la ubicación "todo el tiempo"**, no "solo mientras se usa".
- **Sacar la app de la optimización de batería.**
- En **Xiaomi, Huawei y Oppo**: habilitar *inicio automático* y fijar la app
  en recientes. Esos fabricantes matan servicios en segundo plano aunque
  tengan foreground service, y es justo el parque de teléfonos que se va a
  encontrar.

Si esto no se hace, el GPS se corta igual que en la web y volvemos al
problema del principio.

## Cómo está armado

```
protocolo/cliente.js   El protocolo. JS puro: login, WebSocket, reconexión,
                       rol de GPS y brechas. Probado contra el servidor de
                       verdad en pruebas/cliente.js
hud.js                 Qué brecha se muestra y qué se le dice al chofer.
                       JS puro y sin React. Probado en pruebas/hud.js
chat.js                Qué mensaje va en qué canal y quién lo firma.
                       JS puro. Probado en pruebas/chat.js
voz.js                 Grabar y reproducir notas de voz. Acá SÍ hay Expo:
                       tiene permiso, grabador y reproductor con su ciclo
                       de vida, y mezclarlo con el render es la forma más
                       segura de dejar el micrófono abierto
foto.js                Sacar o elegir una foto. También con Expo
imagen.js              Cuánto achicarla y cuánto pesa. JS puro, probado
                       en pruebas/imagen.js
margenes.js            Dónde terminan las barras de Android. JS puro,
                       probado en pruebas/margenes.js
tema.js                Los colores y cuándo cambian a los de noche. JS
                       puro, probado en pruebas/tema.js
mapa.js                Qué se dibuja en el mapa y la página del WebView.
                       JS puro, probado en pruebas/mapa.js
gestos.js              Pasar de pantalla deslizando, sin robarle el gesto
                       al SOS. JS puro, probado en pruebas/gestos.js
cola.js                Las posiciones cuando no hay datos. Probada en
                       pruebas/cola.js
gps/servicio.js        expo-location + expo-task-manager: el foreground
                       service, la cadencia, y el ENVÍO de las posiciones
App.js                 Las pantallas. Solo dibujan lo que les dan
```

**La lógica está afuera de los componentes a propósito.** `cliente.js`,
`hud.js`, `chat.js`, `cola.js`, `margenes.js`, `gestos.js`, `imagen.js`,
`tema.js` y `mapa.js` son JavaScript puro y corren en Node, así que tienen
suites de verdad y no hace falta un teléfono para saber si andan. Es donde
vivieron todos los bugs de esta pantalla —la unidad inventada, el lado vacío,
el "sin señal" confundido con "no hay nadie", el `02:60`—, y ahora cada uno
tiene una prueba que lo defiende. Los componentes solo dibujan: si algo se ve
mal, primero mirá si es `hud.js`.

Corren con el resto: `npm test` desde la raíz.

## Decisiones que conviene no re-descubrir

- **La cadencia cambia con la pantalla**: 3 s encendida, 10 s apagada. Con la
  pantalla apagada el chofer no mira el HUD y la posición solo le sirve a la
  brecha de los demás. A 30 km/h son ~83 m entre reportes, un 8 % contra un
  objetivo de 2 minutos, y el gasto de GPS baja a un tercio.
- **La notificación permanente lleva la brecha, pero NO en vivo.** Se refresca
  cuando la app pasa a segundo plano, que es justo cuando el chofer la va a
  mirar. No puede refrescarse más seguido: `expo-location` no deja cambiarle
  el texto a una tarea en curso, hay que reiniciarla, y colgar eso de la
  brecha reiniciaba el GPS **cada 3 segundos**. Ya pasó una vez y es
  exactamente lo que arruinaría la medición de batería. Para tenerla viva hay
  que ir por otro lado: una notificación aparte con `expo-notifications`, sin
  tocar el servicio de ubicación.
- **Que la tarea esté REGISTRADA no quiere decir que el servicio esté
  CORRIENDO.** Son dos preguntas distintas y confundirlas costó caro:

  ```
  isTaskRegisteredAsync            ¿existe el registro de la tarea?
  hasStartedLocationUpdatesAsync   ¿el servicio está corriendo?
  ```

  El registro lo guarda Android y **sobrevive a que el servicio muera**: a
  una reinstalación del APK, a que Xiaomi mate la app, a un reinicio. Con un
  registro huérfano dando vueltas, `arrancar` volvía enseguida sin arrancar
  nada. La app se veía perfecta —entraba, chateaba, mandaba fotos y SOS— y el
  GPS, que es el punto de todo esto, no existía: `enviadas 0 · fallidas 0`,
  ni un error. Y lo disparaba el caso más común de todos: **instalar una
  versión nueva**, o sea que le iba a pasar a cada chofer en cada
  actualización. Lo vigila `pruebas/nativas.js`.
- **El servicio se vigila y se rearranca solo**, cada 2 s mientras la app está
  abierta, preguntándole al sistema y no a una variable nuestra. Los
  fabricantes matan servicios; arrancarlo una vez no alcanza.
- **La pantalla muestra el estado del servicio, no solo los contadores.**
  "enviadas 0 · fallidas 0" no distingue entre "todavía no llegó la primera
  posición" y "el servicio ni siquiera existe". Esa ambigüedad se llevó una
  sesión entera de diagnóstico.
- **`gps_role` manda.** Solo una conexión reporta la posición de cada
  vehículo y cambia sola cuando entra otro chofer. Si `reporting` es `false`,
  el servicio no manda: el servidor lo descartaría igual, en silencio.
- **Las posiciones van por HTTP, NO por el WebSocket.** Es la corrección más
  importante que salió de probar en un teléfono: al bloquear la pantalla,
  Android suspende el JavaScript y el socket se cae, aunque el servicio de
  ubicación siga vivo. La combi quedaba muda apenas se bloqueaba la pantalla
  —justo lo que la app nativa venía a evitar—. Un `POST /gps` no necesita
  nada vivo del lado del cliente. El WebSocket queda solo para **recibir** el
  estado mientras el chofer mira el HUD.
- **La cola ya se puede vaciar entera.** `POST /gps` acepta varias posiciones
  con su hora, y el servidor mide con esa hora y no con la de llegada.

## Las versiones de los módulos nativos NO se adivinan

Cada librería nativa tiene una versión por SDK, y mezclarlas rompe la app
**después** de compilar. Pasó, y costó un build entero: la app dejó de abrir
con

```
Failed resolution of: Lexpo/modules/kotlin/types/AnyTypeCache;
  at expo.modules.asset.AssetModule.definition(AssetModule.kt:125)
```

Nadie había declarado `expo-asset`. Lo pedía `expo-audio` como
peerDependency con el rango `*`, npm lo tomó literal y bajó la última —la del
SDK 57— al lado de un `expo-modules-core` del SDK 54. El autolinking de
Android compila lo que encuentra, y ese Kotlin le habla a una clase que en el
54 no existe.

Lo caro es **cuándo** se entera uno: `npm install` no dice nada, el bundle de
JavaScript arma bien, el build en la nube sale verde, y el error recién
aparece con el APK ya instalado en el teléfono. Veinte minutos por intento.

Por eso:

- **`expo-asset` está declarado en `package.json` aunque el código no lo
  importe.** No es basura: es lo que impide que el `*` de `expo-audio` se
  resuelva a la última. Si alguien lo saca por "no se usa", vuelve el crash.
- **El `package-lock.json` se commitea.** Es lo que decide qué se compila.
- **`pruebas/nativas.js` lo verifica en un segundo**, sin teléfono ni red: lee
  el lockfile y falla si algún `expo-*` viene de otro SDK, si hay un módulo
  nativo duplicado, o si el lockfile quedó viejo respecto del `package.json`.
  Corre con el resto de la regresión.

Para agregar una librería, siempre así — elige la versión del SDK:

```bash
npx expo install <lo-que-falte>
```

Y para revisar todo el árbol de una:

```bash
npx expo install --check
```

Si se sube de SDK, la lista de versiones sale del mismo índice que usa
`expo install`, y hay que pegarla en `pruebas/nativas.js`:

```bash
curl https://api.expo.dev/v2/sdks/54.0.0/native-modules
```

### Y las APIs tampoco

En el SDK 54 `expo-file-system` cambió de API y dejó las funciones viejas
como **stubs que tipan bien y revientan al ejecutarse**. `readAsStringAsync`
es una: no falla al compilar ni al abrir la app, falla la primera vez que un
chofer manda una nota de voz. Por eso `voz.js` usa `new File(uri).base64()` y
`pruebas/nativas.js` chequea que siga siendo así. La API anterior sigue
disponible en `expo-file-system/legacy` si alguna vez hace falta.

## Si Metro dice "Cannot find module ..."

Casi siempre es una librería que usa la configuración pero nadie declaró en
`package.json`. `babel-preset-expo` fue una: lo usa `babel.config.js`, en un
proyecto hecho con `create-expo-app` viene solo, y al escribir este a mano se
pasó por alto. El bundle falla en el primer intento, con la app ya instalada.
Se agrega con `npx expo install`, igual que todo lo demás.

## Si EAS te pide instalar algo

Al primer `eas build` puede ofrecerte instalar `expo-dev-client` o crear el
proyecto en tu cuenta: decile que sí a las dos. La segunda escribe un
`projectId` en `app.json` — **conviene commitearlo**, así el próximo clon
apunta al mismo proyecto en vez de crear otro.

El keystore que genera Expo queda guardado en tu cuenta. **No lo regeneres**
sin necesidad: es lo que firma la app, y cambiarlo obliga a desinstalar y
reinstalar en cada teléfono.

## Decisiones de las pantallas nuevas

- **El SOS se desliza, no se toca.** Un botón de emergencia que se dispara con
  un roce es peor que no tenerlo: el celular va en un soporte, en una combi
  que se mueve, y un falso SOS que moviliza gente quema la confianza en el
  sistema entero. Hay que llegar al 85 % del recorrido, vibra al disparar, y
  vuelve solo a los 6 s por si hace falta repetirlo.
- **El SOS manda la última posición conocida.** Es lo primero que pregunta
  quien sale a ayudar.
- **La nota de voz se graba manteniendo apretado**, como en WhatsApp. No es
  imitación: el chofer tiene una mano en el volante, y mantener es un gesto
  que no pide precisión ni mirar la pantalla. Menos de un segundo se descarta
  —es un toque sin querer— y a los 60 s se corta sola.
- **El formato del audio no es el mismo que en la web.** La web graba
  webm/opus y Android graba m4a/aac. El servidor solo mira el prefijo
  `data:audio` y el tamaño, así que los dos pasan, y quien las escucha es
  Chrome en el panel de Despacho, que reproduce m4a sin problema.
- **Las notas viejas pierden el audio a propósito**: el servidor conserva solo
  las 30 últimas. Quedan como burbuja sin reproducción, que es honesto —
  existió, ya no está.
- **El fondo del mapa es oscuro y sin detalle** (tiles `dark_all` de CARTO), no
  el mapa de calles a todo color. Un mapa a color tiene cientos de nombres,
  íconos y manchas de parque compitiendo con lo único que el chofer necesita
  ver: tres puntos y una línea. Sale del prototipo viejo (`Micros-Tracking`),
  donde ya estaba resuelto así. **La atribución se muestra**: OSM y CARTO la
  piden en sus condiciones de uso y esto se va a repartir.
- **Ida llena, vuelta punteada, y de colores distintos.** Una sola línea de un
  solo color no dice para qué lado va ese trazo, que es justo lo que hace
  falta para entender dónde está la de adelante.
- **Solo se rotulan tres unidades: la mía, la de adelante y la de atrás.** Con
  veinte combis, veinte etiquetas permanentes tapan el mapa y no dicen nada.
  Las tres salen de la MISMA brecha que alimenta el HUD, así el mapa y el
  número grande no pueden contar cosas distintas. El resto se toca.
- **Los marcadores se MUEVEN, no se rehacen.** Borrar y recrear veinte
  marcadores cada 3 s hace parpadear el mapa y tira las etiquetas justo
  cuando el chofer las está leyendo. Es lo que hace viables veinte unidades.
- **El mapa es Leaflet en un WebView, NO `react-native-maps`.** El nativo usa
  Google Maps y en Android **exige una clave de Google Cloud**: cuenta,
  tarjeta, consola, un trámite antes de ver un solo punto. Leaflet sobre
  OpenStreetMap no pide nada y usa las **mismas tiles que los tres paneles
  web**, así que la ruta se ve igual en el celular del chofer que en la
  pantalla de Despacho. Si algún día hace falta el nativo, lo único que
  cambia es quién dibuja la lista que arma `mapa.js`.
- **La página del mapa se arma una vez** y después solo recibe datos por
  `postMessage`. Recargarla en cada estado —cada 3 s— tiraría el zoom y el
  desplazamiento que el chofer acaba de hacer con el dedo.
- **El mapa solo recibe datos mientras está a la vista**, y aun así no se
  desmonta. Empujar una vista cada 3 s con la app en otra pantalla es
  batería tirada; recargarlo al volver lo haría inútil justo cuando se lo
  necesita rápido.
- **La que perdió señal SIGUE en el mapa, apagada y rotulada.** Sacarla hace
  creer que la combi no está —y está, con gente arriba—; dibujarla igual que
  las demás hace creer que ese punto es de ahora. Es el mismo error que costó
  caro en las brechas, y en un mapa se ve peor: un punto se cree más que un
  número.
- **Los nombres se escapan antes de entrar al WebView.** Los tipea Despacho a
  mano, y un apellido con comilla o con `<` rompe la página entera — en el
  celular eso es una pantalla en blanco sin ningún mensaje.
- **Modo noche ≠ modo oscuro.** La app ya era oscura. De noche, en la cabina,
  lo que encandila es el AZUL: es lo que más dilata la pupila y lo que más
  tarda en soltar la vista, o sea tiempo manejando con los ojos todavía
  adaptándose. La paleta de noche baja la luminancia y se va al ámbar, como
  el tablero de un auto. Verde, ámbar y rojo se bajan pero no se cambian: son
  información. Automático por hora —a 15° de latitud sur el día casi no
  cambia con la estación— y con manual, porque un túnel o una tormenta no los
  sabe el reloj.
- **El chat tiene dos canales**: la ruta y el directo con Despacho. Chofer ↔
  chofer privado no existe, y eso lo decide el servidor: el canal entre
  choferes es el grupo.
- **La foto se achica siempre antes de salir**: 1280 px en el lado largo y
  JPEG al 50 %. Una de celular sale de 3 a 8 MB, y acá el que la manda paga
  una vez y **los que la reciben pagan cada uno** — una foto sin achicar en
  una ruta de veinte combis son veinte descargas, en Juliaca y con prepago.
  Después de mandarla se muestra cuánto pesó, que es lo que hace que un
  chofer siga usándola en vez de apagarla.
- **Un toque abre la cámara, mantener apretado abre la galería.** La fila de
  escribir ya está llena; dos gestos sobre un botón cuestan menos que otro
  botón.
- **El tope de la foto lo saben los dos lados y tiene que ser el mismo
  número.** El servidor descarta en silencio: si el cliente permitiera más, la
  foto saldría y se perdería sin que nadie se entere. `pruebas/foto.js` manda
  una de más y una de menos contra el servidor de verdad para que no se
  separen.
- **Las pantallas no tienen márgenes fijos.** Los pone `margenes.js` a partir
  de lo que reporta Android, porque el espacio de las barras cambia por
  teléfono y por cómo lo configuró cada chofer. Un `paddingTop: 56` escrito a
  mano fue lo que dejó el botón de CHAT debajo de los botones del sistema.
- **El deslizamiento lateral NO le puede robar el gesto al SOS.** Son los dos
  horizontales. La pantalla usa `onMoveShouldSetPanResponder` —sin
  `Capture`—, así el hijo reclama primero; y el SOS declara
  `onPanResponderTerminationRequest: () => false`, así una vez que tomó el
  dedo no lo suelta. Un falso SOS moviliza gente y quema la confianza en el
  sistema entero.

## Lo que falta

- La brecha en vivo en la notificación, sin reiniciar el GPS.
- Medir un turno completo en la calle. Nada de acá lo reemplaza.
- Probarlo en teléfonos de verdad con las tres configuraciones de navegación
  de Android (botones, gestos, y alguno viejo sin insets). `pruebas/margenes.js`
  cubre la cuenta, no el vidrio.
