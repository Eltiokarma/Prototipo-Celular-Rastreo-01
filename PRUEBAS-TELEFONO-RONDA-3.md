# Pruebas en teléfono — tercera ronda (APK 0.3.1 + arreglo)

Esta ronda comprueba los arreglos de la segunda (`RESULTADOS-TELEFONO.md`,
H11, H12, H16, H19, H21, H22 y H24) y hace lo que todavía no se pudo: el
caso 1. No hace falta instalar otra APK: el arreglo llega solo.

Se anota igual que antes: **OK**, **FALLA** (con la hora exacta y dos
capturas, del teléfono y de Despacho, en el mismo minuto) o **NO SE PUDO**
(con el motivo). Si lo que ves no coincide con lo que dice el paso, para ahí
y anótalo.

En las tablas, **lo que está en negrita y en mayúsculas** es lo que tocas o
lees en pantalla. Los botones que sólo sirven para ubicarse se nombran entre
comillas y **no se tocan**.

---

## Antes de empezar

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| A.1 | Fusiona a `main` la rama `claude/youthful-mccarthy-odb1vp` (pull request). Espera a que Railway termine de desplegar el servidor. | En Railway, el despliegue en verde. | |
| A.2 | Corre `publicar-arreglo.bat` y elige **[1] PRUEBA**. | Termina sin errores. | |
| A.3 | En cada teléfono, abre la app y quédate en la puerta o en el ingreso un minuto. Ciérrala desde recientes y ábrela otra vez. | El arreglo se aplica al abrir. | |
| A.4 | Comprueba que llegó: en T1 entra con el chofer A **teniendo una sola combi** y con otro chofer en ruta con ella. Si no puedes armarlo ahora, sigue: el caso 6 lo comprueba. | — | |
| A.5 | Despacho abierto en **Mapa**. A con **una sola** combi (la X); B con dos (la X y la Y). Quítale a A la M-00 y la Y. | — | |

---

## Caso 1: el cobrador cuando su combi va hacia la ruta

**T1:** chofer A con la combi X. **T2:** el cobrador de la combi X.
La combi entra a la ruta cuando está a **20 m** o menos del trazado. Empieza a
**una cuadra o más** de la calle del recorrido.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 1.1 | Con T1 a una cuadra o más del recorrido, entra con A y desliza **DESLIZA PARA SALIR A RUTA →**. | En T2: **TU COMBI VA HACIA LA RUTA**, y se queda. | |
| 1.2 | Espera **2 minutos** sin moverte. | En T2 sigue **TU COMBI VA HACIA LA RUTA**. Si se va y vuelve, es FALLA: anota cada cuántos segundos. | |
| 1.3 | Camina o maneja hasta **pisar la calle** del recorrido. | En T2 el aviso se va y aparecen las brechas de X. Anota a cuántos metros de la calle estabas cuando cambió, más o menos. | |
| 1.4 | En T1 pon el **modo avión** 2 minutos. | En T2: **EL CHOFER NO TIENE SEÑAL** «desde las HH:MM». | |
| 1.5 | En T1 quita el modo avión. No toques T2. | En T2 el aviso se va solo en menos de un minuto. | |
| 1.6 | En T1, mantén apretado **SALIR DE RUTA** hasta que salga. | En T2: **NO VEO A TU COMBI**. | |

---

## Caso 3: AUSENTE cortado por el cierre de sesión (H11 y H12)

Antes falló una vez de dos, así que se hace **tres veces**. T1 con A.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 3.1 | T1 en ruta. | Despacho: A en ruta, **EN VIVO**. | |
| 3.2 | Toca **AUSENTE** y, apenas salga «Pasas a AUSENTE en 5 s», toca **Salir** (arriba a la derecha). | T1: el ingreso. | |
| 3.3 | Mira Despacho **2 minutos**. | La combi **se va del mapa** y no vuelve: ni AUSENTE ni SIN SEÑAL. | |
| 3.4 | Repite 3.1 a 3.3 dos veces más. | Las tres veces igual. Anota las tres. | |
| 3.5 | Lo mismo, pero sin AUSENTE: en ruta, toca **Salir** directamente. | La combi se va del mapa y no vuelve. | |

---

## Caso 5: cerrar todas las sesiones, sin cambiar la contraseña (H24)

T1 y T2 con A. **No cambies la contraseña** en este caso: también cierra las
otras sesiones, y entonces no se prueba el botón.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 5.1 | **T1:** entra con A. Quédate en la puerta. Sácala de recientes. | — | |
| 5.2 | **T2:** entra con A → **Perfil** → baja hasta el final, pasando la sección «Cambiar contraseña» → **CERRAR TODAS MIS SESIONES**, dos toques. | T2 en el ingreso. En Despacho → Gestión → Actividad: «cerró todas sus sesiones · **2** sesión(es)». | |
| 5.3 | Espera 1 minuto. **T1:** abre la app. | El ingreso con **«Tu sesión ya no vale: entra de nuevo»**. Ya no «Sesión inválida o expirada» (H19). | |

---

## Caso 6: el relevo, con una sola combi y con dos (H16)

**T1:** chofer A, **una sola** combi (la X). **T2:** chofer B, con la X y la Y.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 6.1 | **T2:** entra con B, elige la **X** en la lista (si pide confirmar, no hay nadie: es un error, anótalo) y sal a ruta. | Despacho: X en ruta con B. | |
| 6.2 | **T1:** entra con A y mira la puerta. | Sin lista (A tiene una sola combi), pero encima del deslizador: **«X: la maneja B»**, con el nombre de B más fuerte. | |
| 6.3 | **T1:** desliza **DESLIZA PARA SALIR A RUTA →**. | **No sale a ruta todavía.** Aparece: «X la está manejando B. Si es un relevo, la tomas tú y a B se le avisa.», con **ES UN RELEVO** y **Cancelar**. | |
| 6.4 | **T1:** toca **Cancelar**. | Sigue en la puerta. Despacho: la X sigue con B. | |
| 6.5 | **T1:** desliza otra vez y toca **ES UN RELEVO**. | T1 en ruta con la X. En T2, el aviso «El GPS se apagó: Otro chofer tomó la unidad…». Despacho: la X con A, un solo punto. | |
| 6.6 | **T2:** mantén **SALIR DE RUTA** hasta salir. Mira la lista de B. | En la X: **«la maneja A»**, con el nombre más fuerte. | |
| 6.7 | **T2:** toca la **X**. | Pide confirmar: **ES UN RELEVO** / **Cancelar**. Toca **ES UN RELEVO** y desliza para salir. | |
| 6.8 | Mira T2 y Despacho. | T2 sale a ruta **sin preguntar otra vez** (ya lo confirmó en la lista). Despacho: la X con B. | |
| 6.9 | **Variante con la pantalla apagada:** con B en ruta en la X, apaga la pantalla de T2. Espera **2 minutos**. **T1** (A, en la puerta) mira encima del deslizador. | Sigue diciendo **«X: la maneja B»**. Si dice otra cosa, anota la hora y mira en Despacho si la X está en SIN SEÑAL. | |

---

## Caso 2: notificaciones quitadas en ruta (H8 y H9)

El arreglo de este caso es por la causa **más probable**, que no está
confirmada. Si vuelve a fallar, lo que importa es la captura de Perfil.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 2.1 | T1 en ruta con A. Despacho lo ve EN VIVO. | — | |
| 2.2 | En Ajustes → Apps → Control de ruta → Notificaciones, **apágalas**. Vuelve a la app. | Android puede reiniciar la app: es normal. Anota si se reinició. | |
| 2.3 | Con la app **abierta y adelante**, espera **2 minutos**. Mira Despacho. | Despacho lo vuelve a ver EN VIVO (la app rearranca el GPS sola si en un minuto no le llega ninguna lectura). | |
| 2.4 | Si en 2.3 **no** volvió: abre **Perfil** → baja hasta «EL GPS» y saca **captura**. Anota la hora. | (La captura dice qué pasa con el GPS.) | |
| 2.5 | Prende las notificaciones de nuevo y vuelve a la app. | En menos de un minuto vuelve la notificación de la brecha. Despacho lo ve. | |

---

## Al terminar

Pásame los resultados por número de paso, con las capturas de toda FALLA y,
si el caso 2 falla, la de Perfil del paso 2.4. Después quítales a A y a B las
combis extra.
