# Pendientes — COOP-R14

Lo que falta construir, con su tamaño y sus dependencias. El orden
importa: algunos ítems son cimiento de otros. El más invasivo —separar la
persona del vehículo— ya está hecho, así que cargar más choferes ya no
compromete nada (ver *Ítems ya cerrados* al final).

## Orden recomendado

| # | Qué | Por qué en ese lugar | Tamaño |
| --- | --- | --- | --- |
| 1 | **Objetivo de brecha automático** (y por día de semana) | Ya hay geometría real y historial de vueltas: es lo que falta para que el objetivo deje de cargarse a mano | 1–2 días |
| 2 | **Aviso de desvío de ruta** | El servidor ya sabe a cuántos metros del trazado va cada unidad; falta decidir umbral, antirrebote y a quién se le avisa | 1 día |
| 3 | **Turnos** (quién maneja qué unidad y cuándo) | Ahora que la persona existe aparte del vehículo, es el paso natural: habilita horas trabajadas y relevos planificados | 1–2 días |
| 4 | **Empresas (multi-cooperativa)** | Nivel de agrupación arriba de las rutas; lo pide la venta, no la operación | 2 días |
| 5 | **Informes exportables** | Necesita que el objetivo automático esté bien para que los números sirvan | 1–2 días |
| 6 | **Panel del gerente de ruta** | Vive de los datos de 1 y 5 | 2 días |
| 7 | **Panel del creador (nuestro)** | Encima de todo; sin 4 no tiene mucho que mostrar | 2–3 días |

---

## 1. Objetivo de brecha automático (y por día de semana)

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

## 2. Aviso de desvío de ruta

**Ya está la mitad hecha:** con el recorrido cargado, el servidor calcula en
cada posición a cuántos metros del trazado va la unidad (`desvioM`). Falta
convertir eso en un aviso útil.

**Lo que hay que decidir, que es lo difícil:**

- **Umbral:** en Juliaca el GPS tiene error de 5–30 m y hay calles paralelas
  a 40 m. Un umbral chico llena de falsas alarmas; uno grande no detecta un
  atajo de una cuadra.
- **Antirrebote:** avisar solo si el desvío se sostiene (varias muestras
  seguidas, o N segundos), no en el primer salto de GPS.
- **A quién se le avisa:** a Despacho seguro; al chofer probablemente no
  (puede tener un motivo, y un cartel acusándolo mientras maneja es peor que
  el problema).
- **Qué es un desvío legítimo:** un desvío por obra o por bloqueo es normal y
  no debería sonar toda la mañana. Conviene poder silenciarlo por turno.

## 3. Turnos

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

## 4. Empresas (multi-cooperativa)

Un nivel arriba de las rutas: `companies` → `routes` → unidades. Cada
empresa ve solo lo suyo; el panel del creador ve todas. Incluye los datos
de la empresa (nombre, RUC, contacto, logo) y, cuando exista, su plan o
licencia.

Es el cambio que convierte esto de "sistema de la R-14" en "producto que
se le vende a cualquier cooperativa".

## 5. Informes exportables

CSV y PDF de: vueltas por unidad y por período, cumplimiento de brecha
(cuánto tiempo estuvo cada unidad en verde/ámbar/rojo), historial de SOS,
horas trabajadas por persona (necesita el ítem 3, turnos) y actividad de
administración.

Cuidado con una tentación: los informes son fáciles de hacer y difíciles
de hacer *bien*. Un informe con brechas aproximadas (una ruta sin
recorrido cargado, o el objetivo automático sin resolver) da números que
parecen precisos y no lo son — y eso es peor que no tener
informe.

## 6. Panel del gerente de ruta

Distinto del de Despacho a propósito: **Despacho opera, el gerente
mira**. Sin botones de administración ni chat operativo; con métricas,
tendencias, cumplimiento, comparación entre unidades y descarga de
informes. Rol nuevo (`manager`) con alcance a una ruta o a la empresa.

## 7. Panel del creador (nuestro)

El nivel que hoy vive fuera de la app (ver "Niveles de seguridad" en el
README), hecho pantalla:

- Alta de empresas y de rutas. (La carga de geometrías ya existe en el
  panel de Despacho.)
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

- **Mensaje directo Despacho ↔ unidad.** Conversación privada por vehículo
  (la ven el chofer y su cobrador), con canal aparte en la app del chofer,
  historial que solo reciben las dos partes y chofer ↔ chofer bloqueado a
  propósito. Ver README, sección Mensaje directo a una unidad.
- **Ruta como puntos GPS.** Trazado real por ruta (`route_points`), progreso
  calculado en el servidor proyectando la posición sobre la polilínea, y un
  trazador en el panel para cargarlo tocando el mapa o importando un GPX.
  Ver README, sección El recorrido de la ruta.
- **Identidad: persona ≠ unidad.** Personas (chofer/cobrador) con nombre
  obligatorio y alias opcional, vehículos aparte, un solo reportero de
  GPS por vehículo y modo acompañante para el que no maneja. Las bases
  existentes migraron solas. Ver README, sección Identidad.
- Multi-ruta con brechas, chat, vueltas y auditoría por ruta.
- Autenticación con roles, altas por Despacho, auditoría de cada acción.
- Consumo de datos: de 5,2 GB a 98 MB por turno (ver `ESCALABILIDAD.md`).
- Panel de Despacho responsivo e instalable, con gestión de unidades.
