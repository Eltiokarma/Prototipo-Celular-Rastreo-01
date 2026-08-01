# Prompt para nueva sesión — React Native

Copia y pega esto completo en un chat nuevo con Claude Code, **con el repo
abierto**. El detalle del protocolo está en `PROTOCOLO.md`, verificado contra
el servidor real: no hay que adivinarlo ni releer `server/index.js`.

---

## El prompt

Hola. Estoy construyendo una app de rastreo en tiempo real para cooperativas
de combis en Juliaca, Perú (3800 m de altitud). La usan los choferes para ver
la brecha de tiempo con la unidad de adelante y la de atrás, y no amontonarse.

**Qué existe y funciona hoy** (todo probado, `npm test` corre doce suites
contra el servidor de verdad):

- **Servidor** Node + Express + `ws` + SQLite (`server/index.js`). Calcula el
  progreso sobre el trazado real, las brechas, las vueltas, los turnos y los
  desvíos. **No lo voy a cambiar para esto.**
- **Panel de Despacho** (`project/despacho.html`) — opera el día.
- **Panel de gerencia** (`project/gerencia.html`) — solo lectura, informes.
- **Panel del creador** (`server/creador.html`) — alta de cooperativas.
- **App del chofer** (`project/Prototipo.html`) — es la que quiero reemplazar.

Lo que ya funciona de verdad en la app del chofer, y que la versión nativa
tiene que mantener: login contra el servidor, brechas en vivo, mapa con las
otras unidades, chat de ruta, **mensaje privado con Despacho**, SOS real
(llega a Despacho y a los supervisores), notas de voz, modo acompañante y
modo demo sin servidor.

**El problema que motiva todo esto:**

Los navegadores cortan la geolocalización cuando se apaga la pantalla o la app
pasa a segundo plano. A los 30 segundos sin GPS el servidor saca la unidad del
mapa. Está medido y es peor de lo que parece: **el de atrás pasa a medirse
contra la unidad que sigue, ve el doble de brecha, y la pantalla le dice
"apurá" hacia una combi que tiene justo adelante y que no ve.** El sistema
provoca el pelotón que existe para evitar. Además le borra la vuelta en curso,
así que el historial nace con agujeros.

**Lo que quiero construir:**

Una app React Native con Expo que reemplace **solo la pantalla del chofer**.
Los tres paneles siguen siendo web. El servidor no cambia.

Requisitos:

- **GPS en segundo plano** con `expo-location` + `expo-task-manager`, con
  *foreground service* y su notificación permanente (Android la exige).
- **La notificación tiene que mostrar la brecha en vivo** — "+1 M-08 · 2:24" —
  porque va a existir igual y así el chofer la ve sin desbloquear.
- **Cadencia adaptativa**: 3 s con la pantalla encendida, 10 s con la pantalla
  apagada. A 30 km/h son ~83 m de deriva, ~8 % contra un objetivo de 2 min:
  aceptable, y baja mucho el consumo.
- Pantallas: brecha adelante/atrás con semáforo, mapa con las otras unidades,
  chat con los dos canales (grupo y privado con Despacho), SOS deslizable.
- Distribuible como APK sin tienda (EAS Build). Play viene después.

**Lo primero que tenés que leer: `PROTOCOLO.md`.** Está verificado contra una
corrida real. Tres cosas de ahí que si se ignoran cuestan una semana:

1. **`gps_role`** decide si esta conexión reporta GPS. Solo una por vehículo, y
   cambia solo cuando entra otro chofer. El servicio de fondo tiene que
   respetarlo como estado vivo, no leerlo una vez.
2. **`toAhead` / `toBehind` son `"MM:SS"` o `null`.** `null` es "no hay nadie
   de ese lado". Taparlo con un `||` fue un bug real de la app web que le
   mostraba al chofer unidades inventadas.
3. **`unitId` es la persona, `vehicleId` es el fierro.** `gaps` va por
   vehículo, el chat por persona.

**Diseño visual:** el chrome (login, inicio de turno) usa la paleta oscura de
abajo. La pantalla de ruta tiene **tres temas** —día (por defecto), sol
extremo y noche— definidos en `TEMAS` dentro de `project/Prototipo.html`.
Está pensada para leerse en un segundo bajo sol directo: por eso el dígito
gigante y el color de estado tiñendo el fondo.

- Azul marca `#2580CF` · brillante `#2E9DFF` · fondo `#0A1A2E` · panel `#16304A`
- Verde `#3DD685` · amarillo `#F5C542` · rojo `#FF4D6D` · blanco `#F5F9FF`

**Mi nivel:** estoy aprendiendo a programar. Entiendo React básico
(componentes, `useState`, `useEffect`, props). **No tengo experiencia con
React Native.** Explicame el porqué de cada decisión importante, no solo el
código.

**Cómo quiero trabajar:** este repo tiene una cultura de pruebas sin mocks
—todo corre contra el servidor real— y de comentarios que explican el porqué,
no el qué. Mantenela. Antes de escribir código, planifiquemos la estructura
del proyecto Expo.

---

## Lo que este prompt reemplaza

La versión anterior estaba desactualizada y habría hecho perder tiempo: decía
que el chat era hardcodeado y el SOS solo visual (las dos cosas funcionan hace
rato), apuntaba a un deploy en Vercel que ya no se usa, y no sabía nada de lo
que se construyó después — identidad persona/vehículo, varias cooperativas,
rutas alternas, panel de gerencia, mensaje privado, turnos ni el trazado real
de la ruta.
