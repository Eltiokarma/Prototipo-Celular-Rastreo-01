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

La cola de la tanda 8 quedó vacía; lo que ella dice que es «del teléfono»
—el socket medio muerto, la grabación tras un reinicio, la notificación de
relevo— sigue esperando al APK 5. Lo nuevo está en la tanda 9.

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

---

## ~~Tanda 9 — el barrido completo del 22/9~~ — REPASADA el 28/10

**Repaso del 28/10**, con tres lectores de ojos frescos (el servidor, los
clientes y la tanda 10), cada hallazgo verificado contra un servidor de
verdad antes de tocarlo. Lo que se arregló, con su caso en `barrido`,
`mover-combi` o `chat` (los quince casos nuevos fallan sin el arreglo):

1. ~~**Los bordes.**~~ Se sostienen. La duda de la migración: no quedó
   ninguna escritura del creador o del sistema con la empresa equivocada.
   Faltaba una puerta: el alta de cooperativa (y el auto-registro de la demo)
   aceptaba `SISTEMA` como usuario de Despacho. Cerrada.
2. ~~**El mando del GPS.**~~ Tenía un agujero de verdad: al cerrarse el
   socket dueño, el mando VIVO de otra persona se le pasaba a un tercero (el
   relevado con la web abierta), y el que manejaba por HTTP quedaba mudo. Ahora
   sólo lo hereda la persona que tiene el mando (otra pestaña suya sí, que
   antes tampoco), y tomar el mando sin dueño suelta el socket ajeno.
3. ~~**La vuelta.**~~ Dos bugs: un salto suelto HACIA ADELANTE (0,06 → 0,90,
   el rebote por la misma calle) quedaba como «lo alto» y las dos lecturas
   siguientes cerraban una vuelta de segundos; y la vuelta siguiente nacía en
   la lectura mala y quedaba «parcial», con una entrada tardía falsa en la
   auditoría. Ver tanda 11, punto 1.
4. ~~**El SOS.**~~ Se sostiene. Faltaba el del cobrador: salía sin
   coordenadas (no prende el GPS). Ahora lleva la posición de su combi si es
   de menos de un minuto.
5. ~~**Los números.**~~ Se sostienen, pero sacar el tope dejó `?desde=0`
   armando 120 días de vueltas y 365 de turnos en el hilo único: 2,8 s con
   todo congelado. Turnos y Vueltas acotan a 8 días; lo largo es de los
   informes.
6. ~~**La app nativa.**~~ Se sostiene; tres arreglos chicos: «Modo
   acompañante» se pintaba como un aviso fijo; en un teléfono compartido
   pasaban la marca, lo leído y el estado vivo al siguiente; y el «fuera»
   que reintentaba por HTTP podía llegar después de un «ruta» y sacar de ruta
   al que volvía.
7. ~~**La web y el creador.**~~ Se sostienen; lo mismo del estado compartido
   en la web, y el «fuera» por HTTP sólo cuando el socket puede estar medio
   muerto.

También: `POST /gps` abría el turno y fijaba la presencia con la ruta de la
PERSONA mientras el `identify` usaba la de la COMBI; con datos viejos donde
no coinciden, los turnos se partían y se solapaban. Ahora los dos usan la de
la combi.

**Lo que se dejó como estaba, a conciencia:** el `identify` toma el mando
sin condición —el relevado que deja la app abierta en su casa y reconecta le
saca el mando al que maneja—. Arreglarlo cambia `PROTOCOLO.md` §3.1 (tomar
una combi ocupada pasaría a ser sólo declarar «ruta») y es una decisión del
dueño, no un arreglo: queda en la tanda 11 para decidir.

### Lo que decía antes del repaso

No un diff: el código ENTERO, por primera vez desde la revisión del 10/9,
repartido en seis frentes (el servidor en tres partes, la app nativa, la web
del chofer con el panel del creador, y Despacho), cada hallazgo verificado
contra el código antes de tocarlo. Unos setenta hallazgos; los que se
descartaron o se dejaron a propósito están abajo. Suite nueva `barrido`
(servidor), `creador`, `envio` y `nativas` ampliadas. Regresión completa
verde.

### Lo que más conviene mirar, en orden

1. **Los bordes que se cruzaban.** Un Despacho daba de alta un chofer con el
   código de una combi de OTRA cooperativa y quedaba subido a ella (el
   camino sin vehículo explícito no miraba la empresa). El Despacho atado a
   una ruta mandaba privados a otras. Una cuenta llamada `CREADOR` recibía
   la auditoría de la plataforma, y el arranque asignaba las filas sin dueño
   —el login del creador con su IP, los respaldos— a la cooperativa inicial:
   su Despacho las veía. Ahora hay un casillero `__plataforma__` y los nombres
   `CREADOR` y `SISTEMA` no se dan de alta. **La duda:** la migración mueve
   sólo cuatro acciones conocidas del creador; si alguna otra quedó con
   `companyId` de la cooperativa inicial, sigue ahí.

2. **El mando del GPS entre dos personas.** El relevado que apretaba «Salir
   de ruta» sacaba del mapa la combi que manejaba el otro. Al caerse el
   socket del que tenía el mando (pantalla apagada, sigue por HTTP), el
   socket pasaba a otro chofer conectado: dos teléfonos alimentando la misma
   combi. Y el cierre de un socket viejo le cerraba el turno a alguien que ya
   había reconectado por otro. `otroTieneElMando()` es ahora la única
   prueba, usada por `/gps`, la presencia, el tráfico y el socket. **La
   duda:** es la pieza con más caminos del servidor; conviene mirarla con
   un relevo de verdad en la calle.

3. **La vuelta que cerraba una sola lectura mala** (`trackLap`). Una posición
   que proyectaba hacia atrás —trazado que se cruza, ida y vuelta por la
   misma calle— cerraba la vuelta un 15 % corta y acusaba al chofer de entrar
   tarde. Ahora la caída se sostiene dos posiciones (`VUELTA_MUESTRAS`) y se
   cierra con la hora de la primera. **La duda:** dos y no cuatro (el tramo
   usa cuatro) es un número elegido: filtra UNA lectura mala suelta, no dos
   seguidas. Se probó con tres y rompía `brecha`, que cruza el inicio con
   una sola posición detrás; en la calle hay muchas más.

4. **El SOS.** Por el socket lo podía disparar Despacho. La hora era la del
   teléfono, y uno con el reloj atrasado nacía con la ventana del tipo ya
   cerrada. La web mandaba la posición de hace veinte minutos como si fuera
   la de ahora, y la app también; un segundo deslizamiento mientras el
   primero estaba en vuelo lo colgaba y duplicaba la alerta. En Despacho, un
   segundo SOS pisaba al primero en el cartel y el de un cobrador nunca
   pintaba su combi.

5. **Los números.** El resumen de Vueltas salía de las últimas 300 y el de
   Turnos de los últimos 500 turnos; «Ayer» contaba horas de hoy; un turno
   podía quedar abierto dos veces (ir y volver de combi) y contar doble; el
   CSV de Números no llevaba la ruta elegida.

6. **La app nativa.** La presencia vieja se re-declaraba en cada reconexión
   y el servidor tiraba la vuelta en curso cada vez que se prendía la
   pantalla. La nota de voz quedaba grabando sola si se soltaba antes de que
   arrancara, y se mandaba a toda la ruta a los 60 s. La cola mandaba las
   150 más viejas en vez de la posición de ahora. Un reloj adelantado y
   corregido dejaba el GPS mudo. El cobrador no tenía SOS. **La duda:** todo
   esto se probó por lectura y con las piezas puras; el teléfono lo dice.

7. **La web del chofer y el panel del creador.** Latido `ping`/`pong` para
   el socket medio muerto, «fuera» siempre también por HTTP, la sesión
   restaurada que no reconocía el eco de su SOS, estado que pasaba de un
   usuario al siguiente en un teléfono compartido. El creador: el bloqueo de
   intentos se esquivaba en paralelo, el código TOTP se podía reusar, el
   recorrido que no cargaba se guardaba vacío encima del real, y un 401 a
   mitad de un dibujo lo borraba.

### Lo que se miró y se dejó como estaba, a conciencia

- **El tiempo del login** ahora es parejo entre cuenta existente y no
  existente, pero sólo en el camino normal: el bootstrap de `DESPACHO` sigue
  siendo distinto, a propósito (sólo existe en un sistema sin administración).
- **La carrera de respuestas tardías** en las pestañas de Despacho (ya
  anotada en la tanda 8): igual, salvo en el trazador, donde sí se arregló
  porque ahí la respuesta vieja se GUARDABA encima de otra variante.
- **La franja de 5 %** de «Dónde se traba» se queda; la pantalla ya dice
  cuántos metros son.
- **El `LIMIT 500`** de paradas, huecos y anomalías sigue en el servidor; la
  pantalla ahora avisa cuando lo toca.

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

---

## ~~Tanda 10 — pasar una combi de una ruta a otra (29/9)~~ — REPASADA el 28/10

**Repaso del 28/10.** Los permisos, lo que se lleva la combi, los clientes y
la pantalla se sostienen. Lo que se arregló (suite `mover-combi`, que además
ahora corre sin la gracia del arranque —con ella, «vuelve como reanudación»
pasaba aunque se borrara el arreglo—):

- **El turno no se reabría** para quien seguía conectado por el socket: el
  chofer de la web y el cobrador quedaban sin turno hasta reconectar, y esas
  horas faltaban en Turnos y en el CSV. Ahora arrancan su turno en la ruta
  nueva en el mismo momento.
- **Ida y vuelta en menos de 15 minutos** (A → B → A) reabría el turno de A,
  que pasaba a cubrir también el de B: horas dobles. Se retoma sólo el último
  turno de la persona.
- La presencia queda «perdida» sólo si estaba confirmada (la que iba
  «yendo» no tenía corrida que cortar), y la marca de entrada tardía de la
  ruta vieja no viaja a la nueva.
- El Despacho de la ruta de origen ve el cambio en su auditoría, y el pedido
  de grabación pendiente va con la combi.

Lo de «no se tocó» (el tronco compartido de la 18A y la 18B, los códigos
únicos en todo el servidor) sigue igual.

### Lo que decía antes del repaso

La 18A y la 18B son dos rutas de una misma cooperativa y a veces rotan
combis. Hasta ahora `vehicles.routeId` se fijaba al crear la combi y no había
cómo cambiarlo. Ahora el supervisor la cambia desde la columna Ruta de
Vehículos (`POST /admin/vehicles/:vehicleId/ruta`). Suite nueva
`mover-combi`, con navegador.

### Lo que más conviene mirar, en orden

1. **Quién puede.** Sólo el supervisor (`requireSupervisor`): un Despacho
   atado a la 18A no puede llevarse combis de la 18B ni traérselas. Es una
   decisión, no un límite técnico: si en Juliaca o Puno lo hace el Despacho
   de la terminal, hay que abrirlo con cuidado (que sólo mueva entre SUS
   rutas).
2. **Lo que se lleva la combi.** Todas las personas con `vehicleId` de esa
   combi pasan a la ruta nueva (`users.routeId`), porque la persona sigue a
   su combi desde el barrido del 22/9. Un chofer que manejaba esa combi pero
   tiene otra asignada no se mueve.
3. **Con la combi andando.** Sale del mapa de la ruta vieja, entra al de la
   nueva, la vuelta a medias se DESCARTA (no se guarda con ninguna ruta:
   medida en una y cerrada en otra no es una vuelta de ninguna), el tramo,
   el desvío, la parada y el hueco se cierran con la hora de su última
   señal. La presencia queda como perdida, así que al volver a la cadena en
   la ruta nueva es una reanudación y no una «entrada tardía».
4. **El turno se corta.** `abrirTurno` ahora sólo retoma un turno cerrado
   hace menos de 15 min si es de la MISMA ruta; si no, abre otro. Así las
   horas quedan repartidas por ruta, que es como las liquida cada una.
5. **Los clientes.** Los sockets abiertos de la gente asignada pasan a mirar
   la ruta nueva y reciben su trazado y su hilo. La app nativa no guarda la
   ruta en ningún lado que muestre; la web del chofer sí la guardaba en la
   sesión (la puerta la mostraba) y ahora la corrige con el `state`.

### Lo que NO se tocó, y por qué

- **El tronco compartido de la 18A y la 18B.** Donde las dos rutas van por
  la misma calle, cada una mide sus brechas por separado; una combi de la
  18A no cuenta como «la de adelante» de una 18B. Es lo correcto para el
  HUD (cada una sigue su propio circuito), pero no se miró si Despacho
  querría ver las dos juntas en ese tramo.
- **Los códigos únicos en todo el servidor** (rutas, combis, personas). Para
  Juliaca y Puno alcanza; el prefijo de ciudad o cooperativa con el número
  corto visible queda para después, como se habló.

---

## Tanda 11 — recorrer las pantallas para el manual (28/10, sin repasar)

Se armó el manual de usuario (`manual/`) usando cada pantalla con un
navegador, con una cooperativa de demostración dada de alta por las
pantallas y una flota andando por calles de Juliaca. Lo que apareció se
arregló antes de sacar las capturas. Regresión completa verde.

### Lo que más conviene mirar, en orden

1. **La vuelta que salta hacia adelante** (`trackLap`). Un salto de más de
   medio circuito en una sola lectura se confirma con una segunda antes de
   creerlo. **La duda:** una combi que reaparece tras un corte largo justo una
   lectura antes de cruzar el paradero pierde esa vuelta (antes la contaba).
   Es raro y la vuelta con un hueco así es dudosa igual, pero es un cambio de
   conteo. La suite `brecha` hacía exactamente ese salto —la ida hasta el
   40 % y de ahí al final de la vuelta— y se rehízo para recorrer el circuito
   entero.
2. **La unidad sin señal no tiene brechas propias** (`calculateGaps`). Antes
   se medía su posición congelada contra los vecinos y Despacho la mostraba
   «sin señal» con brechas en rojo. `PROTOCOLO.md` §3 lo dice.
3. **La web del chofer a pantalla completa en el teléfono** (hasta 600 px de
   ancho, o instalada como app). Se dibujaba dentro de un teléfono de
   mentira, con un reloj falso. **La duda:** una tablet en horizontal sigue
   viendo el marco de vitrina.
4. **AUSENTE y YENDO A LA RUTA en la web**, como en la nativa. El ausente
   leía «Sos la única unidad en ruta». Mientras está ausente no se ven
   «Estoy en tráfico» ni «Ausente».
5. **«El teléfono sigue mandando»** en Despacho ahora exige que se lo oiga
   15 s después de su última posición; con «oído hace menos de 60 s» a secas,
   el que se calló del todo figuraba 30 s como que seguía mandando.
6. **La velocidad de la web** sale de la posición anterior cuando el
   navegador no la da (`coords.speed` nulo): el chofer andando veía «0 km/h».
7. **Lo inventado de la maqueta, fuera**: «48 min · 42 pasajeros», el nombre
   de reserva, «· TERMINAL» en el mapa, «Juliaca · Puno · 3 824 m». El conteo
   del mapa es el de la cadena (C17), y la tarjeta ya no tapa la atribución.
8. **Lo chico de los paneles**: el login de Despacho hablaba de
   `DISPATCH_PASSWORD`; «Dónde se traba» mandaba a leer un `.md`; el alta de
   persona le prometía a Despacho crear la combi (el servidor contesta 403);
   «Respaldar ahora» era invisible (`var(--brand)` no existe); un botón de
   Informes se salía de su tarjeta; Números cortaba sus tablas; los mensajes
   de otro día no decían el día; la tarjeta de la unidad mostraba la
   velocidad con decimales o, sin señal, la última que tuvo.
9. **Herramientas**: `flota.js` no lograba meter ni una combi (las crea la
   gerencia: `--gerencia USUARIO:CLAVE`), y la consola describía la cuenta de
   gerencia como la de antes de la fusión.
10. **La optimización del hilo** (`PENDIENTES.md` §4.20). **Las dudas:**
    `lastSeenAt` del que reporta por HTTP pasa a tener resolución de un
    minuto, igual que por el socket: un turno puede cerrar hasta un minuto más
    corto. `db.prepare` queda memoizado por texto: es seguro mientras nadie
    use `.iterate()`, `.pluck()` o `.raw()` sobre una sentencia compartida —si
    algún día hace falta, que sea con un `preparar` aparte—. Y las ventanas de
    turnos (7 días) y de presencia (2 días) suponen que nada dura más que eso
    sin cerrarse o anotarse.

### Para decidir (no es un arreglo)

- **El `identify` que toma el mando sin condición** (repaso de la tanda 9,
  hallazgo 7). Si se cambia, tomar una combi ocupada pasa a ser sólo declarar
  «ruta», y hay que reescribir `PROTOCOLO.md` §3.1.
- ~~**El tema de la web del chofer**~~: decidido y hecho (28/10). La web tiene
  ahora el botón DÍA / NOCHE / AUTO arriba a la derecha, en las tres
  pantallas, con la regla horaria de la nativa (noche de 18:30 a 5:30) y el
  mismo ciclo. **La diferencia que queda:** de fábrica la web sigue en DÍA
  (invariante de diseño) y la nativa en AUTO; la NOCHE de la web es la OLED
  original con resplandor, no la ámbar de poco azul de la nativa. SOL EXTREMO
  sigue sólo en el panel de diseño. Suite nueva `tema-web`.

- ~~**El `identify` que toma el mando sin condición**~~: decidido (30/10),
  opción B. Ver tanda 12.

## Tanda 12 — el mando es de SALIR A RUTA (30/10, sin repasar)

Decisión del dueño sobre el `identify` (tanda 9, hallazgo 7): opción B, y
para el olvido de SALIR A RUTA, las opciones A y C. Probado contra el
servidor de verdad antes de tocar nada: la app nativa se conecta al poner la
clave, así que el turno y el mando arrancaban en la PUERTA —Pedro llegando al
relevo ya le sacaba la combi a Juan— y el relevado que reconectaba desde su
casa la recuperaba sola.

### Lo que más conviene mirar, en orden

1. **Entrar no es salir** (`identify`, `asumirMando`). El `identify` de un
   chofer sin el mando ya no da mando, ni turno, ni le pone su nombre a la
   combi. Lo da declarar `ruta` (aunque otro la tenga: el relevo) o, si nadie
   la tiene viva, declarar `ausente` o mandar una posición. **La duda:** las
   horas de la nativa ahora cuentan desde SALIR A RUTA y no desde la clave —
   es lo pedido, pero cambia los números de Turnos y Números desde hoy—.
2. **El relevado no recupera solo** (`relevados`). Marcado al perder el mando
   contra otra persona; mientras dure, su `ruta`, su `ausente` y sus
   posiciones no le devuelven esa combi, **ni cuando el otro termina el
   turno**. Se va con un acto suyo (`fuera`, volver a entrar con la clave) o
   a las 6 h. **La duda:** la marca vive en memoria; un reinicio del servidor
   la borra y el relevado con la app en `ruta` puede retomar si el otro no
   está vivo. Es el mismo alcance que `duenoDe`.
3. **El relevo del socket** (cierre): ya no pasa el mando a otro chofer
   conectado aunque el mando esté muerto; sólo a otra conexión de la misma
   persona.
4. **La puerta en Despacho** (opción A, mensaje `puerta` sólo a
   supervisores). Sin ubicación: entró y no declaró. Vence a los 30 min sin
   app. **La duda:** la nativa con la pantalla apagada pierde el socket y
   figura 30 min; el que puso la clave sólo para leer el chat también figura.
5. **El vigía de la puerta** (opción C, `app/puerta.js` y su copia web). Mira
   el GPS sin mandarlo, sólo con la app abierta y el permiso ya dado; avisa y
   sale solo al minuto; queda `salio_solo` en la Actividad. **Las dudas:** la
   nativa necesita APK nueva; con la pantalla apagada en la puerta no mira
   (haría falta el servicio de fondo, que es emitir); la política de
   privacidad cambió (vigente desde el 30/10) y habría que avisarlo en la
   ficha de Google Play.
6. **El relevo en la Actividad** (`relevo`): sólo si el otro estaba vivo.

Suites nuevas: `relevo`, `vigia-puerta`, `puerta-web`.

## Tanda 13 — varias combis por persona (30/10, sin repasar)

La propuesta de `PENDIENTES.md` («varias combis por chofer»), decidida por el
dueño y hecha como estaba escrita.

### Lo que más conviene mirar, en orden

1. **`users.vehicleId` sigue siendo «la combi de hoy»** y lo cambia la puerta
   (`POST /combi`) o Despacho (`actual`). Todo lo demás lo sigue leyendo de
   ahí. **La duda:** las pantallas guardan la sesión con la combi; la web y
   la nativa la corrigen con el mensaje `combi` o con la respuesta, pero una
   app vieja (APK sin esto) que esté conectada cuando Despacho le cambia la
   combi no se entera hasta volver a entrar.
2. **`cambiarCombiDe`**: cierra el turno abierto, suelta un mando muerto a su
   nombre en la combi de antes, mueve la entrada de la puerta, y pasa los
   sockets de la persona a la ruta nueva con su privado. **La duda:** el
   privado es por COMBI —así era—: el de hoy en M-05 ve lo que Despacho le
   escribió al de ayer.
3. **En ruta no se cambia** (`enRutaEn`: el mando vivo de su combi de hoy):
   ni la puerta ni Despacho.
4. **«Cualquiera de su ruta»** (`users.todaLaRuta`): la ruta es la de su
   combi de hoy; si elige una de otra ruta habilitada a mano, «su ruta»
   pasa a ser esa.
5. **La migración** habilita la combi de cada uno en cada arranque (`INSERT
   OR IGNORE`): idempotente, y la de hoy está siempre en la lista de la
   puerta aunque Despacho la sacara (el editor no deja sacarla).

Suites nuevas: `combis`, `combis-web`; `cliente` ampliada.

