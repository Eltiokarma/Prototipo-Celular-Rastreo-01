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

```bash
cd app && npm install
```

**El GPS en segundo plano NO funciona en Expo Go.** Hace falta una
*development build* — se compila una vez y después se recarga como siempre:

```bash
npx eas login
npx eas build --profile development --platform android
# instalás el APK en el teléfono, y después:
npm start
```

Apuntá `SERVIDOR` a tu máquina editando `EXPO_PUBLIC_SERVIDOR`, o dejá el
valor por defecto y cambiá la IP en `App.js`. **El celular no resuelve
`localhost`**: tiene que ser la IP de tu máquina en la red del wifi.

Para un APK repartible sin tienda:

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
- **La notificación permanente lleva la brecha.** Android la exige para el
  GPS de fondo, así que va a existir igual: que diga `ADELANTE M-08 · 2:24`
  en vez de "la app está corriendo" sale gratis y es lo que el chofer lee sin
  desbloquear.
- **`gps_role` manda.** Solo una conexión reporta la posición de cada
  vehículo y cambia sola cuando entra otro chofer. Si `reporting` es `false`,
  el servicio no manda: el servidor lo descartaría igual, en silencio.
- **La cola todavía no se puede vaciar entera.** El servidor le pone la hora
  de llegada a cada `gps`, así que mandarle posiciones viejas haría que la
  unidad se teletransporte. Por ahora al reconectar se manda solo la más
  fresca. Ver el comentario grande de `cola.js`.

## Lo que falta

- Mapa (`react-native-maps`), chat con los dos canales, SOS deslizable.
- Ingreso histórico en el servidor, para aprovechar la cola entera.
- Medir un turno completo en la calle. Nada de acá lo reemplaza.
