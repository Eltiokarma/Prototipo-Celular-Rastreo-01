# App del chofer (nativa) — COOP-R14

Reemplaza **solo la pantalla del chofer**. Los tres paneles —Despacho,
gerencia y creador— siguen siendo web, y **el servidor no cambia**: esta app
habla el mismo protocolo, escrito y verificado en `PROTOCOLO.md`.

Existe por una sola razón, medida: los navegadores cortan el GPS al apagar la
pantalla, y hasta hace poco eso hacía que la de atrás recibiera *"apurá"*
hacia una combi que tenía justo adelante. Ver `LIMITACIONES.md`.

## Qué hay hoy

Un **corte vertical**: entrar → brecha en vivo → GPS en segundo plano con la
brecha en la notificación permanente.

Faltan el mapa, el chat y el SOS **a propósito**. Esto existe para contestar
la pregunta que ninguna pantalla contesta —si el celular aguanta un turno con
el GPS prendido a 3800 m y si Android deja vivo el servicio— y para eso
alcanza. Lo demás es portar interfaz que ya funciona en la web.

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
hud.js                 Qué mostrarle al chofer a partir de las brechas.
                       JS puro y sin React. Probado en pruebas/hud.js
cola.js                Las posiciones cuando no hay datos. Probada en
                       pruebas/cola.js
gps/servicio.js        expo-location + expo-task-manager: el foreground
                       service y la cadencia
App.js                 Las dos pantallas. Solo dibuja lo que le dan
```

**La lógica está afuera de los componentes a propósito.** `cliente.js`,
`hud.js` y `cola.js` son JavaScript puro y corren en Node, así que tienen
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
- **La cola todavía no se puede vaciar entera.** El servidor le pone la hora
  de llegada a cada `gps`, así que mandarle posiciones viejas haría que la
  unidad se teletransporte. Por ahora al reconectar se manda solo la más
  fresca. Ver el comentario grande de `cola.js`.

## Si EAS te pide instalar algo

Al primer `eas build` puede ofrecerte instalar `expo-dev-client` o crear el
proyecto en tu cuenta: decile que sí a las dos. La segunda escribe un
`projectId` en `app.json` — **conviene commitearlo**, así el próximo clon
apunta al mismo proyecto en vez de crear otro.

El keystore que genera Expo queda guardado en tu cuenta. **No lo regeneres**
sin necesidad: es lo que firma la app, y cambiarlo obliga a desinstalar y
reinstalar en cada teléfono.

## Lo que falta

- La brecha en vivo en la notificación, sin reiniciar el GPS.
- Mapa (`react-native-maps`), chat con los dos canales, SOS deslizable.
- Ingreso histórico en el servidor, para aprovechar la cola entera.
- Medir un turno completo en la calle. Nada de acá lo reemplaza.
