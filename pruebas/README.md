# Pruebas — COOP-R14

Doce suites que corren contra el servidor de verdad: levantan un proceso,
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
ellas van a mirar. Las otras cuatro levantan la suya.

```bash
# las que necesitan servidor: tramos objetivo informes desvio turnos privado seguridad empresas
DB=/tmp/una.db
PORT=3001 DB_FILE=$DB DISPATCH_PASSWORD=despacho99 node ../server/index.js &
DBFILE=$DB DB_FILE=$DB node turnos.js

# las que se arman solas: variantes brecha creador gerencia
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

## Sintaxis de las pantallas

Los paneles no tienen paso de compilación: Babel corre en el navegador, así que
un error de sintaxis solo aparece al abrir la página. Esto lo adelanta:

```bash
npm run sintaxis
```

Compila el bloque `<script type="text/babel">` de cada `.html` con el mismo
Babel que usa el navegador y dice en qué línea del archivo está el error.

## Bancos visuales

No son pruebas: levantan el servidor con datos sembrados, abren las pantallas
en Chromium y sacan capturas en `pruebas/shots/`. Sirven para mirar el
resultado y —esto es lo que más valió— para enterarse de que la página reventó,
porque listan cualquier error de JavaScript al final.

```bash
node rediseno.js        # Despacho, Gestión y el trazador
node gerencia-shot.js   # el panel del gerente, con tres semanas de historial
node creador-ui-run.js  # el panel del creador (esta sí verifica, no solo mira)
```

Necesitan Chromium. En este entorno está en `/opt/pw-browsers/chromium`; en otro,
cambiar el `executablePath` o instalar el de Playwright.

`cdn.js` guarda en disco lo que se baja de CDN (React, Babel, Leaflet, fuentes,
tiles) para que una caída de red no deje la página en blanco a mitad de una
corrida.

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
