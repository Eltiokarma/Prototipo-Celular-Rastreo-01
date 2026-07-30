# Pendientes — COOP-R14

Lo que falta construir, con su tamaño y sus dependencias. El orden
importa: algunos ítems son cimiento de otros. El más invasivo —separar la
persona del vehículo— ya está hecho, así que cargar más choferes ya no
compromete nada (ver *Ítems ya cerrados* al final).

## Orden recomendado

| # | Qué | Por qué en ese lugar | Tamaño |
| --- | --- | --- | --- |
| 1 | **Ruta como puntos GPS** | Cimiento de la precisión: sin geometría real las brechas son aproximaciones, y el objetivo automático necesita datos buenos | 3–4 días |
| 2 | **Objetivo de brecha automático** (y por día de semana) | Depende de 1 y del historial de vueltas | 1–2 días |
| 3 | **Mensaje directo Despacho → unidad** | Autocontenido, valor inmediato, no depende de nada | 1 día |
| 4 | **Turnos** (quién maneja qué unidad y cuándo) | Ahora que la persona existe aparte del vehículo, es el paso natural: habilita horas trabajadas y relevos planificados | 1–2 días |
| 5 | **Empresas (multi-cooperativa)** | Nivel de agrupación arriba de las rutas; lo pide la venta, no la operación | 2 días |
| 6 | **Informes exportables** | Necesita que 1 y 2 estén bien para que los números sirvan | 1–2 días |
| 7 | **Panel del gerente de ruta** | Vive de los datos de 2 y 6 | 2 días |
| 8 | **Panel del creador (nuestro)** | Encima de todo; sin 5 no tiene mucho que mostrar | 2–3 días |

---

## 1. Ruta como puntos GPS

**Hoy:** el progreso en la ruta es una proyección lineal entre dos puntos
(Terminal Sur → Huancané). No sigue las calles, así que las brechas son
aproximaciones útiles pero no medidas.

**Propuesta:**

- Guardar la geometría de cada ruta como polilínea de puntos GPS
  (`route_points`, o un JSON en `routes`).
- Calcular el progreso **proyectando** la posición de cada unidad sobre
  la polilínea (segmento más cercano + distancia recorrida hasta ahí).
  Eso da progreso real, y con él brechas reales.
- Detección de vueltas más confiable: se sabe cuándo se pasó por el
  final de verdad, no por una heurística de "el progreso bajó".

**Cómo se cargan los puntos** (tres opciones, se pueden combinar):

1. **Dibujar en el mapa** desde una ventana nuestra: clics sobre Leaflet
   → lista de puntos. Simple y suficiente.
2. **Importar GPX/GeoJSON**: sirve si alguien graba la ruta manejando con
   una app de GPS. Probablemente el camino más práctico y preciso.
3. **Grabar desde la app**: un chofer hace una vuelta en "modo
   grabación" y el recorrido queda como geometría. Elegante, y no
   necesita que nadie dibuje nada.

**Beneficio extra:** con geometría real se puede detectar que una unidad
**se salió de la ruta** (desvío, atajo) y avisarle a Despacho.

## 2. Objetivo de brecha automático (y por día de semana)

**Hoy:** es un número fijo por ruta, cargado a mano.

**La matemática de la rueda:** el objetivo natural es
`duración de la vuelta ÷ unidades activas`. Con 12 unidades y vueltas de
60 minutos, el objetivo son 5 minutos. Eso el sistema **ya lo puede
calcular solo**: tiene el historial de vueltas (tabla `laps`) y sabe
cuántas unidades hay en ruta.

**Por día de semana:** el tráfico de un domingo no es el de un lunes, así
que la duración media de vuelta cambia. Guardar el promedio por día
(o por franja horaria) y usar el del día en curso.

**Detalles que hay que resolver:**

- **Arranque en frío:** sin historial no hay promedio. Hace falta un
  valor manual de respaldo y un mínimo de vueltas antes de confiar en el
  cálculo.
- **Override manual:** Despacho debe poder fijar un objetivo distinto
  (un día con desvío, un feriado) sin que el automático lo pise.
- **Que no oscile:** si el objetivo se recalcula a cada rato, los colores
  del HUD parpadean. Conviene suavizarlo y recalcular cada tanto, no en
  cada vuelta.
- **Unidades activas cambia durante el día:** si tres unidades salen de
  ruta al mediodía, el objetivo debería subir. Decidir si se recalcula en
  vivo o por turno.

## 3. Mensaje directo Despacho → unidad

**Hoy:** todo el chat es grupal por ruta.

**Propuesta:** mensajes con destinatario (`toUnitId`). En el panel, un
botón en cada unidad de la lista abre la conversación directa; en la app
del chofer se distingue visualmente del grupo (y conviene que suene o
avise distinto, porque es para él).

**Reglas coherentes con los roles:** Despacho ↔ chofer en privado sí;
chofer ↔ chofer en privado no (el grupo es el canal entre choferes, y
abrir mensajería privada entre 1 000 personas trae problemas de
moderación que no queremos). El historial privado se guarda igual y solo
lo ven las dos partes.

## 4. Turnos

**Hoy:** la asignación persona → vehículo vive en la cuenta y es fija. El
relevo funciona en la práctica (el último chofer que entra toma el mando
del GPS y al anterior se le avisa), pero no queda registrado: no se sabe
quién manejó qué unidad y por cuánto tiempo.

**Propuesta:** una tabla `assignments` (persona, vehículo, desde, hasta).
Con eso salen las horas trabajadas, quién iba en la unidad cuando pasó
algo, y Despacho puede planificar el relevo en vez de descubrirlo.

**Cuidado:** no convertirlo en un sistema de RRHH. Alcanza con registrar
lo que el sistema ya ve solo (quién entró, en qué unidad, cuándo salió) y
dejar la edición manual para las excepciones.

## 5. Empresas (multi-cooperativa)

Un nivel arriba de las rutas: `companies` → `routes` → unidades. Cada
empresa ve solo lo suyo; el panel del creador ve todas. Incluye los datos
de la empresa (nombre, RUC, contacto, logo) y, cuando exista, su plan o
licencia.

Es el cambio que convierte esto de "sistema de la R-14" en "producto que
se le vende a cualquier cooperativa".

## 6. Informes exportables

CSV y PDF de: vueltas por unidad y por período, cumplimiento de brecha
(cuánto tiempo estuvo cada unidad en verde/ámbar/rojo), historial de SOS,
horas trabajadas por persona (necesita el ítem 4, turnos) y actividad de
administración.

Cuidado con una tentación: los informes son fáciles de hacer y difíciles
de hacer *bien*. Un informe con brechas aproximadas (ítem 1 sin resolver)
da números que parecen precisos y no lo son — y eso es peor que no tener
informe.

## 7. Panel del gerente de ruta

Distinto del de Despacho a propósito: **Despacho opera, el gerente
mira**. Sin botones de administración ni chat operativo; con métricas,
tendencias, cumplimiento, comparación entre unidades y descarga de
informes. Rol nuevo (`manager`) con alcance a una ruta o a la empresa.

## 8. Panel del creador (nuestro)

El nivel que hoy vive fuera de la app (ver "Niveles de seguridad" en el
README), hecho pantalla:

- Alta de empresas y de rutas, carga de geometrías.
- Estado del sistema: unidades conectadas por empresa, uso, errores.
- Salud del servidor y de la base, tamaño, backups.
- Reseteo de cuentas de Despacho.
- Uso por empresa (para facturar, si se cobra por unidad).

**Cómo protegerlo, que es lo importante:** no debe ser un rol más del
mismo login. Conviene una credencial aparte y, además, una barrera fuera
de la aplicación — que solo funcione con una variable de entorno activa,
o en una URL no adivinable, o con doble factor. Si el panel que puede
todo se abre con una contraseña más, el nivel de arriba deja de existir.

---

## Ítems ya cerrados

- **Identidad: persona ≠ unidad.** Personas (chofer/cobrador) con nombre
  obligatorio y alias opcional, vehículos aparte, un solo reportero de
  GPS por vehículo y modo acompañante para el que no maneja. Las bases
  existentes migraron solas. Ver README, sección Identidad.
- Multi-ruta con brechas, chat, vueltas y auditoría por ruta.
- Autenticación con roles, altas por Despacho, auditoría de cada acción.
- Consumo de datos: de 5,2 GB a 98 MB por turno (ver `ESCALABILIDAD.md`).
- Panel de Despacho responsivo e instalable, con gestión de unidades.
