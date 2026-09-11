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

## Tanda 6 — revisión del 10/9 (11 de septiembre)

Diez hallazgos: C6, C8, C10, C14, E9, E10, E12, E14, E15, E16. Detalle
completo en `REVISION-2026-09-10.md`, sección «Estado al cerrar».
Regresión completa verde.

### Lo que más conviene mirar, en orden

1. **Los días de calendario (E14).** `desdeEnDias()` en `server/index.js`.
   «7 días» pasó a ser *los últimos 7 días del calendario contando hoy*, y no
   *las últimas 168 horas*. Toca Números, el perfil del chofer y paradas,
   huecos y anomalías. **La duda:** el gerente que abre el panel a las 15:00
   ahora ve un período que arranca a la medianoche de hace seis días, con lo
   cual un «7 días» tiene menos horas que antes y los números bajan un
   escalón el día que se despliegue. Es lo correcto, pero alguien va a
   preguntar por qué le bajaron las vueltas, y eso no está escrito en ninguna
   pantalla.

2. **El rol que dejó de ser uno solo (E12).** `roles` + `role` en
   `/gerencia/resumen` y `/admin/shifts`. Se conservó `role` para no romper a
   nadie, y ahora significa «en el que puso más horas» en vez de «el del
   primer turno». **La duda:** dos campos que dicen casi lo mismo es
   exactamente la clase de cosa que dentro de seis meses alguien usa mal. Si
   se puede matar `role`, mejor; si no, que quede escrito por qué no.

3. **El aviso de cupo (C10).** El servidor manda `{ type: 'cupo', … }` una
   vez por ventana al que se pasó. Es el **único** mensaje que el servidor
   manda sin que nadie lo pida. **La duda:** el cupo existe para frenar a un
   cliente descompuesto, y un cliente descompuesto ahora recibe una respuesta
   — poca (uno por minuto por tipo), pero recibe. Vale confirmar que no haya
   forma de convertir eso en amplificación.

4. **Qué se le dice al chofer cuando el tipo de SOS no sale (C8).** El
   diálogo se cierra igual y el aviso queda arriba. **La duda:** es una
   emergencia; el texto («Tu SOS salió, pero no pudo decir QUÉ pasó. Avisá
   por el chat…») hay que leerlo de reojo, a 3800 m, con sol. Puede ser
   demasiado largo.

5. **La pantalla «Dónde se traba» (E9).** Franjas de 5 % del circuito.
   **La duda:** el 5 % es un número elegido a mano. En una ruta de 12 km una
   franja son 600 m, que es razonable; en una de 40 km son 2 km, que
   probablemente sea demasiado grueso para decir «acá». Si la franja tuviera
   que ser por metros y no por porcentaje, esto hay que rehacerlo.

6. **La suite `numeros`, que sembraba mal.** Sembraba el día de trabajo con
   `ahora - (24 - h) × 3600000`, que cruza la medianoche: la suite sólo
   pasaba de noche y fallaba el resto del día, en `main`, desde el 10/9. Se
   ancló a la medianoche de hoy y se comprimió a minutos. **La duda:** vale
   revisar si alguna otra suite tiene la misma trampa — esta se encontró de
   casualidad.

---

## Tanda 7 — las bajas de la revisión del 10/9 (11 de septiembre)

Veinticuatro hallazgos: L14–L22, C18–C22, P8–P13, E17–E20. Con esto la
revisión del 10/9 queda cerrada entera. Regresión completa verde.

### Lo que más conviene mirar, en orden

1. **La tabla `objetivo_log` (L22).** Es lo único de esta tanda que agrega
   ESTADO NUEVO al sistema: una fila por cada cambio de objetivo de cada
   ruta, para poder contestar «cuál era la vara cuando se cerró esta
   vuelta». **La duda:** se escribe desde `objetivoDe()`, que se llama en
   cada emisión de estado; el suavizado y `RECALCULO_MS` hacen que cambie
   pocas veces por día, pero nadie midió cuántas filas son con veinte rutas
   y un objetivo automático que oscila. Vale mirar el conteo después de una
   semana de uso real.

2. **Quién gana entre dos aparatos del mismo chofer (C20).** Se decidió NO
   cambiar quién gana —la posición más nueva es la más nueva— y sólo DECIR
   lo que pasa. **La duda:** es una decisión de producto disfrazada de
   arreglo. La alternativa era que el dueño del GPS fuera un aparato y no
   una persona, y eso choca con el diseño de la tanda 2, donde la app usa
   WebSocket y HTTP a la vez a propósito. Si alguna vez pasa de verdad en la
   calle, esto se vuelve a discutir con datos.

3. **La poda de los mapas en memoria (L20), sin suite.** Los plazos —seis
   horas para `salidas`, un día para `presencias`, una hora para los
   antirrebotes— salieron del razonamiento de para qué sirve cada mapa, no
   de una medición. El de `presencias` es el que puede molestar: el que se
   declara ausente y vuelve 25 horas después tiene que declarar «ruta» otra
   vez. **La duda:** no hay forma de mirar esto desde afuera, así que si el
   plazo está mal nadie se va a enterar. Se aceptó a propósito: inventarle
   una puerta al servidor para poder probarlo sería peor.

4. **El alias único por ruta (P9).** Ahora un alias repetido da 409.
   **La duda:** la comparación incluye el NOMBRE REAL de los demás, no sólo
   sus alias. Es lo correcto para el mapa —lo que se ve es `driverName`—
   pero significa que si en la ruta hay un «Elmer Ccama», nadie más puede
   ponerse ese alias, y el mensaje de error no distingue los dos casos.

5. **El privado a una combi de otra ruta (C19).** Cambió DÓNDE se guarda el
   mensaje y a quién se le reparte. **La duda:** el reparto ahora incluye
   siempre al emisor, que es un camino nuevo en `enviarPrivado`; el caso
   normal (misma ruta) no cambia, pero conviene releer esa función entera y
   no sólo el diff.

6. **El informe de mensajes (E18).** Deja fuera el contenido de la voz y de
   la foto a propósito. **La duda:** alguien va a pedir las fotos. La
   respuesta correcta probablemente sea un ZIP o un enlace por mensaje, no
   meter base64 en un CSV — pero eso hay que decidirlo, no improvisarlo
   cuando lo pidan.

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
  No es un bug, es alcance: la decisión es del dueño del producto.
- **P13**, la grabación sin enviar que se pierde al reinstalar el APK. Se
  decidió NO arreglarlo: `allowBackup: false` está puesto a propósito. Lo que
  se hizo fue decirlo, en la pantalla y en `LIMITACIONES.md` §F.
- **Todo lo que necesita el teléfono y la calle**: el APK 5, el relevo con
  dos aparatos, el GPS impreciso, una parada real, el botón de tráfico, el
  tipo de SOS con el socket caído y una grabación que falla al enviarse.
  Está en `REVISION-2026-09-10.md`.
