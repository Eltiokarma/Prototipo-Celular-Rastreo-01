# Pendientes — COOP-R14

Lo que falta construir, con su tamaño y sus dependencias. El orden
importa: algunos ítems son cimiento de otros. Los dos más invasivos —separar
la persona del vehículo, y poner la empresa arriba de las rutas— ya están
hechos, así que cargar choferes o cooperativas nuevas ya no compromete nada
(ver *Ítems ya cerrados* al final).

## Orden recomendado

| # | Qué | Por qué en ese lugar | Tamaño |
| --- | --- | --- | --- |
| 1 | **Panel del creador (nuestro)** | Ya existe la capa que administra (`server/empresa.js`); falta la pantalla, con su credencial aparte y su barrera fuera de la app | 2–3 días |
| 2 | **Rutas alternas** | Los desvíos programados (una obra de tres meses) no se resuelven silenciando: el trazado cambió. Se diseñan desde el panel del creador, así que van después de 1 | 2–3 días |
| 3 | **Cumplimiento de brecha** | El único número que la cooperativa querría y todavía no existe: cuánto tiempo estuvo cada unidad en verde, ámbar y rojo. Hace falta guardarlo, no se puede reconstruir — pero mientras nadie use la app no se está perdiendo nada | 1 día |
| 4 | **Panel del gerente de ruta** | Vive de los informes, que ya existen. Es el que más se beneficia de esperar: hoy estaríamos adivinando qué mira un gerente | 2 días |

**Rutas alternas** va arriba porque es el cambio de esquema que queda, y el
esquema es lo único que se encarece con el uso: mover tablas con seis meses
de datos adentro es una migración con riesgo, y hoy no. El resto se suma
encima y cuesta lo mismo después.

---

## 1. Panel del creador (nuestro)

El nivel que hoy vive en la consola del servidor (`server/empresa.js` y la
sección "Niveles de seguridad" del README), hecho pantalla:

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

Hoy esa barrera es el acceso al servidor, que es fuerte pero no escala:
cada alta de cooperativa necesita a alguien con consola. La pantalla es
para que deje de necesitarlo **sin** aflojar la barrera.

## 2. Rutas alternas

**El caso real:** una ruta no siempre se maneja igual. Hay desvíos
**programados** (una obra que dura tres meses, un feriado con desfile, el
mercado de los domingos que cierra dos cuadras) y desvíos **del momento** (un
embotellamiento, un bloqueo). Hoy el recorrido de una ruta es uno solo: si el
trazado real cambia por un mes, o se corrige a mano o todas las unidades
figuran fuera de ruta.

**Propuesta:** que una ruta pueda tener **variantes** de su recorrido, cada
una con sus tramos de ida y vuelta. Una es la vigente; las demás quedan
guardadas para activarlas cuando corresponda.

- `route_variants` (routeId, nombre, activa) y `route_points` colgando de la
  variante en vez de la ruta.
- Activar una variante recalcula progreso y brechas al instante — la
  infraestructura ya está, porque el cálculo vive en el servidor.
- **Se diseña desde el panel del creador** (ítem 1), no desde Despacho: es
  cartografía, no operación del día. Despacho **elige** entre las variantes
  cargadas; nosotros las dibujamos.

**Lo que hay que pensar bien:**

- **Las vueltas en curso:** si se cambia la variante a mitad del turno, las
  unidades que venían midiendo sobre la anterior tienen su progreso corrido.
  Probablemente convenga cerrar la vuelta en curso y arrancar de nuevo, y
  dejar constancia de que ese tramo del historial se midió con otra
  geometría.
- **Vigencia:** una variante por obra tiene fecha de fin. Vale la pena poder
  programarla (del 1 al 30) en vez de tener que acordarse de desactivarla.
- **El objetivo automático:** si la variante es más larga, la vuelta dura más
  y el objetivo sube solo — eso ya funciona. Pero el promedio histórico
  mezcla vueltas de geometrías distintas; habría que guardar con qué variante
  se midió cada vuelta.
- **Cuándo NO usar una variante:** para un embotellamiento de dos horas no
  vale la pena — para eso está silenciar el desvío, que ya existe. La
  variante es para cuando el recorrido cambia de verdad.

## 3. Cumplimiento de brecha

**Lo que falta para cerrar los informes.** Hoy se puede sacar cuántas vueltas
hizo cada unidad y cuántas horas trabajó cada persona, pero no *qué tan bien
mantuvo la brecha*, que es lo que mide si la rueda funciona.

**Por qué no está:** la brecha se calcula en vivo y no se guarda. Reconstruir
el pasado es imposible — habría que rehacer el cálculo posición por posición,
y las posiciones tampoco se guardan (a propósito: serían millones de filas).

**Propuesta:** acumular en memoria, por unidad y por día, cuántos segundos
estuvo en verde, en ámbar y en rojo, y volcarlo a una tabla cada tanto (y al
apagarse). Son tres contadores por unidad: nada de peso.

**Lo que hay que resolver:**

- **Qué cuenta como "en ruta":** una unidad detenida en el terminal no debería
  sumar rojo. Probablemente haya que contar solo mientras se mueve.
- **Con qué objetivo se compara:** si el objetivo automático cambió durante el
  día, el porcentaje del día mezcla dos varas. Conviene guardar también contra
  qué objetivo se midió.
- **Que el número no sea injusto:** una unidad sola en la ruta no tiene con
  quién compararse. Esos tramos no deberían contar ni a favor ni en contra.

## 4. Panel del gerente de ruta

Distinto del de Despacho a propósito: **Despacho opera, el gerente
mira**. Sin botones de administración ni chat operativo; con métricas,
tendencias, cumplimiento, comparación entre unidades y descarga de
informes. Rol nuevo (`manager`) con alcance a una ruta o a la empresa.

---

## Lo que ningún diseño resuelve

Hay preguntas que no se contestan construyendo: si el celular aguanta un
turno con el GPS prendido a 3800 m, si el chofer efectivamente mira el HUD
manejando, si Despacho usa el chat o levanta el teléfono igual, si el
trazado real coincide con lo que dibujemos. Cuando estén los ítems 1 y 2
hay algo que se puede poner en dos o tres unidades una semana, y esa semana
va a reordenar esta lista mejor que nosotros.

---

## Ítems ya cerrados

- **Empresas (multi-cooperativa).** `companies` arriba de las rutas, con la
  empresa como borde de todo lo que se consulta —rutas, gente, flota,
  turnos, vueltas, auditoría, informes, chat, mapa y SOS—, alta de
  cooperativas desde el servidor (`server/empresa.js`) y no desde una
  pantalla, y suspensión que cierra las sesiones en el momento. Toda cuenta
  pertenece a una empresa: no hay "sin empresa = ve todo". Ver README,
  sección Empresas.
- **Informes exportables** en CSV: vueltas, horas por persona, emergencias y
  actividad de administración, cada uno declarando con qué se midió. Ver
  README, sección Informes.
- **Desvío de ruta**, tratado como gestión y no como alarma: solo si se
  sostiene, umbral por ruta, y Despacho puede silenciarlo cuando el desvío ya
  se sabe. Ver README, sección Desvío de ruta.
- **Turnos.** Se abre cuando la persona entra a su unidad y se cierra cuando
  se va, tolerando cortes de señal y reinicios del servidor. Panel → TURNOS,
  con horas por persona. Ver README, sección Turnos.
- **Revisión de seguridad**: inyección de HTML por identificadores, fuerza
  bruta por origen, cupo de mensajes por conexión. Ver README, sección Qué
  frena cada cosa.
- **Objetivo de brecha automático.** Vuelta promedio del mismo día de la
  semana ÷ unidades en ruta, con arranque en frío que respeta el valor manual,
  suavizado para que el HUD no parpadee y topes de cordura. Ver README,
  sección Objetivo de brecha automático.
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
