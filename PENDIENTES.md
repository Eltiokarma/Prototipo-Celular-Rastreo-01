# Pendientes — COOP-R14

Lo que falta construir, con su tamaño y sus dependencias. El orden
importa: algunos ítems son cimiento de otros. Los tres más invasivos —separar
la persona del vehículo, poner la empresa arriba de las rutas y colgar el
recorrido de una variante— ya están hechos, así que cargar choferes,
cooperativas o trazados nuevos ya no compromete nada (ver *Ítems ya cerrados*
al final).

## Puesta en producción — lo que queda pendiente hoy

- [ ] **Cambiar `CREATOR_PASSWORD`.** La que está puesta se generó para la
      primera prueba y **estuvo escrita en un chat en texto plano**. Es la
      única clave que abre TODAS las cooperativas del servidor. Reemplazarla
      por una de un gestor de contraseñas (24 caracteres) y aplicar: al
      reiniciarse se cierran solas las sesiones de creador que hubiera.
- [x] Volumen montado y `DB_FILE` apuntando ahí — comprobado con un
      despliegue real: los datos sobrevivieron al cambio de contenedor.
- [x] Segundo factor del panel del creador activo (`CREATOR_TOTP_SECRET`).
- [ ] Cargar el recorrido real de la R-14 con el trazador.

## Orden recomendado

| # | Qué | Por qué en ese lugar | Tamaño |
| --- | --- | --- | --- |
| 1 | **Cumplimiento de brecha** | El único número que la cooperativa querría y todavía no existe: cuánto tiempo estuvo cada unidad en verde, ámbar y rojo. Hace falta guardarlo, no se puede reconstruir | 1 día |
| 2 | **Panel del gerente de ruta** | Vive de los informes, que ya existen. Es el que más se beneficia de esperar: hoy estaríamos adivinando qué mira un gerente | 2 días |

**Los cambios de esquema ya están hechos.** Eran los únicos que se encarecían
con el uso —mover tablas con seis meses de datos adentro es una migración con
riesgo—, y lo que queda se suma encima y cuesta lo mismo antes que después.

Dicho de otro modo: **el diseño ya llegó hasta donde puede llegar sin que
nadie lo use.** Lo de abajo se hace mejor después de una semana en la calle.

---

## 1. Cumplimiento de brecha

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

## 2. Panel del gerente de ruta

Distinto del de Despacho a propósito: **Despacho opera, el gerente
mira**. Sin botones de administración ni chat operativo; con métricas,
tendencias, cumplimiento, comparación entre unidades y descarga de
informes. Rol nuevo (`manager`) con alcance a una ruta o a la empresa.

---

## Lo que ningún diseño resuelve

Hay preguntas que no se contestan construyendo: si el celular aguanta un
turno con el GPS prendido a 3800 m, si el chofer efectivamente mira el HUD
manejando, si Despacho usa el chat o levanta el teléfono igual, si el
trazado real coincide con lo que dibujemos. **Ya hay algo que se puede poner
en dos o tres unidades una semana**, y esa semana va a reordenar esta lista
mejor que nosotros.

---

## Ítems ya cerrados

- **Rutas alternas.** Variantes del recorrido por ruta, con ida y vuelta cada
  una: se crean desde el panel del creador, Despacho elige con cuál se mide y
  la dibuja con su trazador. Al cambiar, las vueltas en curso se descartan
  (venían medidas con otro trazado), el promedio histórico no mezcla
  geometrías y la vigencia programada activa y desactiva sola. Ver README,
  sección Rutas alternas.
- **Panel del creador.** El nivel de arriba de todas las cooperativas, hecho
  pantalla: alta de empresas, cuentas de Despacho, rutas, suspensión, salud
  del servidor y actividad de todas juntas. Apagado salvo que
  `CREATOR_PASSWORD` esté en el entorno —sin eso las rutas dan 404, no 403—,
  con credencial fuera de la tabla `users`, ruta configurable y segundo
  factor opcional. La consola (`empresa.js`) sigue siendo el piso, y las dos
  puertas comparten operaciones. Ver README, sección Panel del creador.
- **Empresas (multi-cooperativa).** `companies` arriba de las rutas, con la
  empresa como borde de todo lo que se consulta —rutas, gente, flota,
  turnos, vueltas, auditoría, informes, chat, mapa y SOS—, alta de
  cooperativas solo desde el nivel de arriba, y suspensión que cierra las
  sesiones en el momento. Toda cuenta pertenece a una empresa: no hay "sin
  empresa = ve todo". Ver README, sección Empresas.
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
