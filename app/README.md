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

Entrar → brecha en vivo → chat con los dos canales → notas de voz → SOS
deslizable → GPS en segundo plano con la brecha en la notificación.

**Falta el mapa.** Necesita `react-native-maps`, y en Android eso pide una
**clave de Google Maps**: crear un proyecto en Google Cloud, habilitar "Maps
SDK for Android" y generar la clave. Son unos diez minutos y es gratis en
este volumen, pero es una cuenta tuya y no lo puedo hacer yo. Cuando la
tengas, va en `app.json` y se compila.

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
cola.js                Las posiciones cuando no hay datos. Probada en
                       pruebas/cola.js
gps/servicio.js        expo-location + expo-task-manager: el foreground
                       service, la cadencia, y el ENVÍO de las posiciones
App.js                 Las pantallas. Solo dibujan lo que les dan
```

**La lógica está afuera de los componentes a propósito.** `cliente.js`,
`hud.js`, `chat.js` y `cola.js` son JavaScript puro y corren en Node, así que tienen
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

## Si Metro dice "Cannot find module ..."

Casi siempre es una librería que usa la configuración pero nadie declaró en
`package.json`. `babel-preset-expo` fue una: lo usa `babel.config.js`, en un
proyecto hecho con `create-expo-app` viene solo, y al escribir este a mano se
pasó por alto. El bundle falla en el primer intento, con la app ya instalada.

La forma correcta de agregarlo es siempre la misma, porque elige la versión
que corresponde al SDK:

```bash
npx expo install <lo-que-falte>
```

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
- **El chat tiene dos canales**: la ruta y el directo con Despacho. Chofer ↔
  chofer privado no existe, y eso lo decide el servidor: el canal entre
  choferes es el grupo.

## Lo que falta

- **El mapa** (`react-native-maps`), que además necesita la clave de Google.
- La brecha en vivo en la notificación, sin reiniciar el GPS.
- Medir un turno completo en la calle. Nada de acá lo reemplaza.
