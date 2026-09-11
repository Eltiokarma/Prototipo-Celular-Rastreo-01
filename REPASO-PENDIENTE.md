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

### Lo que NO se tocó, y por qué

- **Las 24 bajas** de la revisión del 10/9 (C18–C22, L14–L22, P8–P13,
  E17–E20). Siguen abiertas y anotadas en su archivo.
- **El legajo** (DNI, brevete, placa, SOAT, revisión técnica, propietario).
  No es un bug, es alcance: la decisión es del dueño del producto.
- **Todo lo que necesita el teléfono y la calle**: el APK 5, el relevo con
  dos aparatos, el GPS impreciso, una parada real, el botón de tráfico y el
  tipo de SOS con el socket caído. Está en `REVISION-2026-09-10.md`.
