# Repaso pendiente

Cola de revisión. Acá se anota lo que **ya está hecho, probado y mergeado**
pero todavía **no lo repasó otro par de ojos**. No es una lista de tareas: es
una lista de cosas de las que hay que dudar una vez más antes de darlas por
cerradas.

Existe por una razón concreta: la regresión dice que el código hace lo que el
código dice, y no dice nada sobre si eso era lo correcto. Las decisiones de
esta tanda —qué es un «día», qué significa el rol de una persona en un
período, qué se le muestra al chofer cuando algo no salió— son decisiones de
producto disfrazadas de arreglos, y ésas son las que conviene mirar dos veces.

**Cómo se identifica lo pendiente de repaso:** cada commit de esta tanda lleva
su firma en el trailer `Co-Authored-By`. Para listarlos:

```bash
git log --format='%h %s' --grep='Co-Authored-By: Claude' main..
```

Cuando algo de acá quede repasado, se tacha con una línea que diga qué se
miró y qué se cambió (o que no hizo falta cambiar nada, que también es un
resultado). Cuando no quede nada, el archivo se borra.

---

## ~~Tanda 6 — revisión del 10/9 (11 de septiembre)~~ — REPASADA el 21/9

Diez hallazgos: C6, C8, C10, C14, E9, E10, E12, E14, E15, E16. Detalle
completo en `REVISION-2026-09-10.md`, sección «Estado al cerrar».
Regresión completa verde.

**Repaso del 21/9**, con otro par de ojos (y tres lectores más, uno por
frente: el panel, la app y la medición). Cada punto queda tachado con lo que
se miró y lo que cambió. Lo que este repaso agregó de nuevo está abajo, en la
tanda 8.

### Lo que más conviene mirar, en orden

1. ~~**Los días de calendario (E14).**~~ **Repasado.** `desdeEnDias()` y su
   gemela `inicioDePeriodo` del panel hacen la misma cuenta byte por byte
   (`setDate` con negativo, sin horario de verano en el medio); el resumen,
   el perfil, paradas, huecos, anomalías y los CSV cortan igual. Lo único
   que faltaba era decirlo en una pantalla: el pie de Números ahora dice
   qué es un «día» del período y que el único partido es hoy. Nada más
   cambió.
   ~~`desdeEnDias()` en `server/index.js`.~~
   «7 días» pasó a ser *los últimos 7 días del calendario contando hoy*, y no
   *las últimas 168 horas*. Toca Números, el perfil del chofer y paradas,
   huecos y anomalías. **La duda:** el gerente que abre el panel a las 15:00
   ahora ve un período que arranca a la medianoche de hace seis días, con lo
   cual un «7 días» tiene menos horas que antes y los números bajan un
   escalón el día que se despliegue. Es lo correcto, pero alguien va a
   preguntar por qué le bajaron las vueltas, y eso no está escrito en ninguna
   pantalla.

2. ~~**El rol que dejó de ser uno solo (E12).**~~ **Repasado, se queda.**
   `role` no se mata: lo leen los CSV y cualquier pantalla vieja, y el panel
   nuevo lee `roles` con `role` de respaldo. `PROTOCOLO.md` §4sexies ya dice
   por qué se conserva y qué significa ahora. Se verificó que las vueltas
   por persona se atribuyen SÓLO con los turnos de chofer, así que un
   cobrador no hereda las vueltas de la combi en que iba. Nada cambió.
   ~~`roles` + `role` en~~
   `/gerencia/resumen` y `/admin/shifts`. Se conservó `role` para no romper a
   nadie, y ahora significa «en el que puso más horas» en vez de «el del
   primer turno». **La duda:** dos campos que dicen casi lo mismo es
   exactamente la clase de cosa que dentro de seis meses alguien usa mal. Si
   se puede matar `role`, mejor; si no, que quede escrito por qué no.

3. ~~**El aviso de cupo (C10).**~~ **Repasado, no hay amplificación.** Un
   mensaje de ~60 bytes, al que se pasó y sólo a él, una vez por ventana y
   por tipo, por socket; el socket sin identificar se cierra a los 15 s. La
   entrada siempre cuesta más que la salida. Nada cambió.
   ~~El servidor manda `{ type: 'cupo', … }` una~~
   vez por ventana al que se pasó. Es el **único** mensaje que el servidor
   manda sin que nadie lo pida. **La duda:** el cupo existe para frenar a un
   cliente descompuesto, y un cliente descompuesto ahora recibe una respuesta
   — poca (uno por minuto por tipo), pero recibe. Vale confirmar que no haya
   forma de convertir eso en amplificación.

4. ~~**Qué se le dice al chofer cuando el tipo de SOS no sale (C8).**~~
   **Repasado, se acortó** y, de paso, se encontró que el aviso casi nunca
   iba a salir: ver tanda 8. El texto pasó a «SOS ENVIADO. El tipo no salió:
   decí por chat si es ambulancia o grúa» (app y web).
   ~~El~~
   diálogo se cierra igual y el aviso queda arriba. **La duda:** es una
   emergencia; el texto («Tu SOS salió, pero no pudo decir QUÉ pasó. Avisá
   por el chat…») hay que leerlo de reojo, a 3800 m, con sol. Puede ser
   demasiado largo.

5. ~~**La pantalla «Dónde se traba» (E9).**~~ **Repasado, y tenía un bug
   de verdad**: agrupaba por franja SIN la ruta, así que en una cooperativa
   con varias rutas el 40 % de la ida de una y el 40 % de la ida de otra
   eran una sola fila. Ahora cada lugar es de una ruta (columna Ruta cuando
   hay más de una), la ruta sin trazado va entera a «Sin recorrido cargado»
   —lo que estimó la app no es un punto del circuito—, y el pie dice cuánto
   mide una franja en metros en cada ruta, que era la duda: el 5 % se queda
   (en una ruta de 12 km son 600 m), pero ahora el que lee sabe cuánto es.
   También: el contador de la pestaña contaba avisos sin parada medida, y se
   dice cuando el servidor recortó a 500. Suite `trabas` ampliada.
   ~~Franjas de 5 % del circuito.~~
   **La duda:** el 5 % es un número elegido a mano. En una ruta de 12 km una
   franja son 600 m, que es razonable; en una de 40 km son 2 km, que
   probablemente sea demasiado grueso para decir «acá». Si la franja tuviera
   que ser por metros y no por porcentaje, esto hay que rehacerlo.

6. ~~**La suite `numeros`, que sembraba mal.**~~ **Repasado.** La misma
   trampa está en `semana` (`hoy(h) = ahora − (24 − h) h`), pero esa suite
   nunca pregunta por «hoy» ni por `porDia`, así que a cualquier hora todo
   lo sembrado cae dentro de los 7 días de calendario: no falla. Quedó
   escrito en la suite para que nadie le agregue un `dias=1` sin saberlo.
   `grabador` (13 h), `metidos` (2–3 h), `gpshttp` (24 h) e `informes`
   (48 h) no cortan por calendario. Nada más cambió.
   ~~Sembraba el día de trabajo con~~
   `ahora - (24 - h) × 3600000`, que cruza la medianoche: la suite sólo
   pasaba de noche y fallaba el resto del día, en `main`, desde el 10/9. Se
   ancló a la medianoche de hoy y se comprimió a minutos. **La duda:** vale
   revisar si alguna otra suite tiene la misma trampa — esta se encontró de
   casualidad.

---

## ~~Tanda 7 — las bajas de la revisión del 10/9 (11 de septiembre)~~ — REPASADA el 21/9

Veinticuatro hallazgos: L14–L22, C18–C22, P8–P13, E17–E20. Con esto la
revisión del 10/9 queda cerrada entera. Regresión completa verde.

### Lo que más conviene mirar, en orden

1. ~~**La tabla `objetivo_log` (L22).**~~ **Repasado, y el «pocas veces por
   día» no se sostenía.** El suavizado sólo frena cambios chicos en modo
   automático; una combi con mala cobertura que entra y sale de «sin señal»
   cada minuto mueve la cuenta de unidades y, con una sola combi, alterna
   «esperando» y «auto» en cada cálculo: una fila por minuto, 1440 por día y
   por ruta en el peor caso, acotadas sólo por la poda a `LAPS_DIAS`. Ahora
   un ida y vuelta en menos de cinco minutos borra la fila del medio en vez
   de sumar otra (`PARPADEO_MS`): la vuelta que cerró en ese minuto se lleva
   la vara de antes, que es la que rigió de verdad. Y una ruta que no existe
   ya no deja filas. Suite `objetivo` (7b, 7c). El conteo tras una semana
   real sigue valiendo la pena mirarlo.
   ~~Es lo único de esta tanda que agrega~~
   ESTADO NUEVO al sistema: una fila por cada cambio de objetivo de cada
   ruta, para poder contestar «cuál era la vara cuando se cerró esta
   vuelta». **La duda:** se escribe desde `objetivoDe()`, que se llama en
   cada emisión de estado; el suavizado y `RECALCULO_MS` hacen que cambie
   pocas veces por día, pero nadie midió cuántas filas son con veinte rutas
   y un objetivo automático que oscila. Vale mirar el conteo después de una
   semana de uso real.

2. ~~**Quién gana entre dos aparatos del mismo chofer (C20).**~~
   **Repasado, nada cambió.** Una imprecisión anotada: `canalDe` se marca
   'ws' antes de saber si esa posición se aceptó, así que en el caso raro de
   un lote HTTP repetido con la web abierta el motivo dice «otro aparato»
   cuando en realidad es un duplicado. Inofensivo: el otro aparato SÍ está
   reportando. Se discute con datos de la calle, como estaba dicho.
   ~~Se decidió NO~~
   cambiar quién gana —la posición más nueva es la más nueva— y sólo DECIR
   lo que pasa. **La duda:** es una decisión de producto disfrazada de
   arreglo. La alternativa era que el dueño del GPS fuera un aparato y no
   una persona, y eso choca con el diseño de la tanda 2, donde la app usa
   WebSocket y HTTP a la vez a propósito. Si alguna vez pasa de verdad en la
   calle, esto se vuelve a discutir con datos.

3. ~~**La poda de los mapas en memoria (L20), sin suite.**~~ **Repasado,
   faltaban dos mapas.** `ultimaImprecisaAnotada` (el cuarto antirrebote) y
   `ausenteEnMarcha` (la ventana del ausente que se mueve, que la combi
   olvidada moviéndose no cierra nunca) no estaban en la lista. Se
   agregaron con el mismo plazo de una hora. Los plazos de los demás se
   releyeron y se sostienen. Sigue sin suite, por la misma razón.
   ~~Los plazos —seis~~
   horas para `salidas`, un día para `presencias`, una hora para los
   antirrebotes— salieron del razonamiento de para qué sirve cada mapa, no
   de una medición. El de `presencias` es el que puede molestar: el que se
   declara ausente y vuelve 25 horas después tiene que declarar «ruta» otra
   vez. **La duda:** no hay forma de mirar esto desde afuera, así que si el
   plazo está mal nadie se va a enterar. Se aceptó a propósito: inventarle
   una puerta al servidor para poder probarlo sería peor.

4. ~~**El alias único por ruta (P9).**~~ **Repasado, tenía un agujero y
   el mensaje se arregló.** La comparación iba en SQL con `LOWER`, que en
   SQLite sólo baja las mayúsculas ASCII: «ÑATO» no chocaba con «ñato» ni
   «JOSÉ» con «josé». Ahora se compara en el servidor plegando mayúsculas,
   acentos y espacios («Jose» es «José» en cualquier pantalla), y el 409
   dice CUÁL de las dos cosas chocó (`choca: 'alias' | 'nombre'`, con su
   texto). Suite `perfil` ampliada; `PROTOCOLO.md` §4septies.
   ~~Ahora un alias repetido da 409.~~
   **La duda:** la comparación incluye el NOMBRE REAL de los demás, no sólo
   sus alias. Es lo correcto para el mapa —lo que se ve es `driverName`—
   pero significa que si en la ruta hay un «Elmer Ccama», nadie más puede
   ponerse ese alias, y el mensaje de error no distingue los dos casos.

5. ~~**El privado a una combi de otra ruta (C19).**~~ **Repasado entero,
   nada cambió.** `destinoPrivado` + `enviarPrivado` + los tres llamadores
   (texto, voz, foto) releídos de punta a punta: el reparto va a los que
   están arriba de esa combi, a Despacho mirando la ruta de la combi y al
   emisor, una vez cada uno; el borde de empresa está en `destinoPrivado`.
   ~~Cambió DÓNDE se guarda el~~
   mensaje y a quién se le reparte. **La duda:** el reparto ahora incluye
   siempre al emisor, que es un camino nuevo en `enviarPrivado`; el caso
   normal (misma ruta) no cambia, pero conviene releer esa función entera y
   no sólo el diff.

6. ~~**El informe de mensajes (E18).**~~ **Repasado, sigue igual a
   propósito.** La decisión (ZIP o enlace por mensaje, nunca base64 en un
   CSV) quedó anotada como pendiente de decidir en `PENDIENTES.md` §4.19,
   que es donde se va a buscar el día que alguien pida las fotos.
   ~~Deja fuera el contenido de la voz y de~~
   la foto a propósito. **La duda:** alguien va a pedir las fotos. La
   respuesta correcta probablemente sea un ZIP o un enlace por mensaje, no
   meter base64 en un CSV — pero eso hay que decidirlo, no improvisarlo
   cuando lo pidan.

---

## ~~Tanda 8 — el repaso del 21/9~~ — REPASADA el 22/9

Lo que el repaso encontró y arregló, con suite. Es trabajo nuevo, así que
entra a la cola. Regresión completa verde.

**Segundo repaso, 22/9**, sobre el diff entero de esta tanda. Dos cosas
cambiaron, las dos en la app:

- **La notificación de relevo (punto 3) se llevaba también la brecha.** El
  arreglo la borraba cuando el rol de GPS volvía, pero ese aviso (`gps_role`
  con `reporting: true`) llega en CADA identificación del socket, no sólo al
  terminar un relevo: cada reconexión borraba la notificación de la brecha
  y la volvía a poner en el envío siguiente. Ahora `limpiarSiSinRol()` borra
  sólo si lo puesto es «MODO ACOMPAÑANTE». Suite `nativas`.
- **La hidratación de la grabación (punto 2) tenía una carrera chica**: si
  el chofer apretaba GRABAR mientras se leía el disco, la grabación vieja
  pisaba el rótulo de la nueva. Se vuelve a mirar antes de escribir.

Lo demás se releyó y se sostiene: el eco del tipo de SOS en la app y en la
web (un tipo que el servidor rechaza por el socket ahora cae a HTTP y
vuelve con su error, que es mejor que antes), la idempotencia del servidor,
`PARPADEO_MS`, el alias con acentos, la poda, y la agrupación por ruta de
«Dónde se traba» (con la lista de rutas todavía sin cargar, cae al
comportamiento viejo, no rompe). Una anotación: el aviso de tráfico del
que declaró «ruta» sin confirmar vuelve a durar hasta que confirme y ande,
el «fuera» o el olvido — es el comportamiento de antes de la tanda 7, no
uno nuevo.

**La cola de repaso queda vacía.** El archivo se conserva hasta que lo
que la tanda 8 dice que es «del teléfono» —el socket medio muerto, la
grabación tras un reinicio, la notificación de relevo— se vea con el APK 5;
después se borra.

### Lo que más conviene mirar, en orden

1. **El tipo de SOS con el socket medio muerto** (`app/protocolo/cliente.js`
   `marcarTipoSos`, `project/realtime.js` `sendSosTipo`). Era el bug real de
   la tanda: `enviar()` devuelve true con el socket en `readyState` 1 aunque
   esté muerto —el estado en que queda tras la pantalla apagada hasta que el
   servidor lo termina a los dos pings—, así que en el escenario exacto de
   C8 «accidente» se escribía en la nada y la pantalla no avisaba. Ahora el
   tipo espera su eco (`sos_tipo` con mi `sosId`, 5 s en la app y 4 en la
   web) y sin eco va por HTTP; si el disparo ya tuvo que salir por HTTP no
   insiste con el socket. El servidor contesta `200` sin volver a avisar si
   el tipo ya estaba puesto, para que un eco perdido no duplique. **La
   duda:** el socket medio muerto no se puede fabricar en una suite; lo que
   está probado es el camino con eco (`cliente`) y la idempotencia (`sos`).
   El caso real se ve en la calle con el APK 5.

2. **La grabación parada que sobrevivía al reinicio sólo en el disco**
   (`app/gps/servicio.js` `hidratarGrabacionGuardada`). Con una grabación
   parada sin enviar y Android matando el proceso, Perfil mostraba «GRABAR
   RECORRIDO» como si no hubiera nada —y apretarlo borraba la vuelta—,
   mientras cada `POST /gps` decía `grabando: true` y un pedido de Despacho
   se daba por arrancado sin arrancar. Se lee el archivo una vez al arrancar
   y la pantalla vuelve a ofrecer ENVIAR / Descartar. **La duda:** sólo se
   probó por lectura (`nativas`); es del teléfono.

3. **La notificación «MODO ACOMPAÑANTE» que no se iba** (`app/App.js`,
   `rolGps`). La ponía el relevo (C22) y sólo la reemplazaba la próxima
   brecha, que al que va solo en la ruta no le llega nunca: la bandeja
   seguía diciendo «tu GPS ya no se usa» al que había vuelto a ser el que
   reporta. Se borra al volver el rol. Por lectura también.

4. **El aviso de tráfico del que declaró «ruta» sin confirmar**
   (`evaluarParada`). La primera versión de L15 retiraba el aviso con
   CUALQUIER causa de inactividad; el que declaró «ruta» desde fuera del
   trazado lo perdía en la posición siguiente, cerrado como «dejó de
   reportar» con el teléfono reportando bien. Ahora sólo el ausente retira
   la palabra. Suite `trafico` (con el anillo cargado como trazado, que
   hasta ahora la suite corría sin ninguno).

5. **Lo chico**: `ausenteEnMarcha` y `ultimaImprecisaAnotada` en la poda;
   `alta_ruta` repetida en el mapa de acciones de la auditoría; el pie de «A
   qué hora» decía «hora del servidor» y es la del navegador; `app/README.md`
   todavía listaba `cola.js`.

### Lo que se miró y se dejó como estaba, a conciencia

- La carrera de respuestas tardías al cambiar rápido de período en «Dónde
  se traba» (30 días → Hoy): el mismo patrón que `loadGerencia` y
  `loadShifts` tienen desde siempre. Si se arregla, se arregla en los tres.
- `paradas` cerradas por `trazado` cuentan en el resumen mientras los
  desvíos por `trazado` no: asimetría vieja, no de esta tanda.
- El reloj adelantado del teléfono puede elegir una vara hasta dos minutos
  «futura» para una vuelta: acotado por el rechazo de posiciones a más de
  120 s en el futuro, y el estimador no ve un reloj adelantado de todos
  modos.

### Lo que se revisó después, y salió limpio

- **Auditoría visual** (skill `auditoria-visual`) sobre las tres pantallas:
  ninguna invariante rota. `contraste.js` verde, los tres HTML compilan, los
  cuatro avisos de seguridad en pie, el SOS sigue siendo deslizable, ningún
  color literal nuevo esquivando los tokens, ningún externo nuevo, `CACHE_NAME`
  subido. Los pares de color que agregué —rótulo sobre el fondo hueco de los
  rótulos por día— dan 5,06 en día y 5,23 en noche, sobre AA.
- **Revisión de seguridad** de la rama entera: sin hallazgos nuevos. Lo que se
  miró con nombre y apellido: el endpoint nuevo (`POST /sos/:id/tipo`), la
  tabla nueva (`objetivo_log`), el informe de mensajes —que expone texto de
  chat, así que se verificó que el borde de empresa y de ruta sea el mismo que
  el de los otros ocho informes—, la consulta del alias, el cambio de ruta del
  privado, y si la poda de los mapas en memoria reabre algún control. Nada.

### Lo que NO se tocó, y por qué

- **El legajo** (DNI, brevete, placa, SOAT, revisión técnica, propietario).
  **Decidido el 11/9: no se hace**, al menos no a esta escala — no se guardan
  datos personales. No es una deuda: es el alcance del sistema. En
  `LIMITACIONES.md` §F y en `PENDIENTES.md`.
- **P13**, la grabación sin enviar que se pierde al reinstalar el APK. Se
  decidió NO arreglarlo: `allowBackup: false` está puesto a propósito. Lo que
  se hizo fue decirlo, en la pantalla y en `LIMITACIONES.md` §F.
- **Todo lo que necesita el teléfono y la calle**: el APK 5, el relevo con
  dos aparatos, el GPS impreciso, una parada real, el botón de tráfico, el
  tipo de SOS con el socket caído y una grabación que falla al enviarse.
  Está en `REVISION-2026-09-10.md`.
