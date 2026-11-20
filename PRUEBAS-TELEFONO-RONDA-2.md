# Pruebas en teléfono — segunda ronda (APK 0.3.1)

Esta ronda repite solo lo que en la primera quedó como **NO SE PUDO** o con
dudas (ver `RESULTADOS-TELEFONO.md`). Lo que salió OK no se repite.

Cada paso dice **qué haces**, con el nombre exacto del botón, y **qué tiene
que verse**, en el teléfono y en Despacho. Al lado de cada paso anota:

- **OK**: se vio exactamente lo que dice la columna «Qué tiene que verse».
- **FALLA**: se vio otra cosa. Anota la **hora exacta** y saca **dos
  capturas**, una del teléfono y otra de Despacho, en ese mismo minuto.
- **NO SE PUDO**: no se llegó a hacer el paso, y anota por qué.

Si un paso no coincide con lo que ves en pantalla (un botón que no está, un
texto distinto), **para ahí y anótalo**: no sigas improvisando, porque el resto
del caso deja de valer.

Para pasarme los resultados, usa el número de paso: «paso 5.4: FALLA, 10:42».

---

## Preparación (una sola vez, antes de empezar)

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| P.1 | Abre Despacho en la PC y déjalo abierto en **Mapa** todo el tiempo. | El mapa con las combis. | |
| P.2 | Ten a mano tres usuarios: **chofer A**, **chofer B** (otro usuario, no el mismo A) y el **cobrador** cargado en la combi **X**. | — | |
| P.3 | En Despacho → **Gestión** → **Personas**, busca la fila de **chofer B**. Toca **⋯** (más acciones) → **Combis**. | Se abre «Combis que puede manejar» con la lista de combis. | |
| P.4 | Marca la combi **X** y **otra combi más** (la Y). Toca **Guardar**. | B queda con **dos** combis habilitadas. Sin esto, el caso 6 no se puede hacer. | |
| P.5 | En los dos teléfonos, cierra sesión si había una abierta: arriba a la derecha, **Salir**. | Los dos en la pantalla de ingreso. | |

---

## Caso 2, paso A otra vez: el texto del aviso de permisos

Solo para leer el aviso. **T1** (Poco X7).

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 2.1 | En Ajustes → Apps → **Control de ruta** → Permisos → Ubicación, elige **No permitir**. | — | |
| 2.2 | Abre la app, entra con chofer A y en la puerta desliza **DESLIZA PARA SALIR A RUTA →**. Cuando Android pregunte, toca **No permitir**. | En la app, un aviso que dice **«Falta el permiso de ubicación en …»**. **Copia el texto completo** o saca captura. | |
| 2.3 | Devuelve el permiso: Ajustes → Ubicación → **Permitir todo el tiempo**, con **Usar ubicación precisa** prendido. | — | |

---

## Caso 1, pasos que faltan: el cobrador cuando su combi va hacia la ruta

**T1:** chofer A con la combi X. **T2:** el cobrador de la combi X.
Necesitas empezar **fuera del recorrido**: la combi entra a la ruta cuando
está a **20 m** o menos del trazado, el ancho de la calle. Ponte a **una
cuadra o más** del trazado de la ruta, no del paradero.

Hasta el 20/11 eran 300 m (tres cuadras), y por eso este caso no se pudo
hacer en la primera ronda. Los 20 m valen recién cuando el servidor tenga el
cambio publicado: antes de eso, este caso sigue sin poder hacerse.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 1.1 | Con T1 a una cuadra o más del recorrido, entra con chofer A y desliza **DESLIZA PARA SALIR A RUTA →**. | En T2: **TU COMBI VA HACIA LA RUTA**, y **se queda** (no aparece y desaparece). | |
| 1.2 | Espera **2 minutos** sin moverte. | En T2 sigue **TU COMBI VA HACIA LA RUTA**. Si se va y vuelve, es FALLA: anota cada cuántos segundos. | |
| 1.3 | Camina o maneja hasta pisar la calle del recorrido. | En T2 el aviso se va y aparecen las brechas de X. | |
| 1.4 | En T1 pon el **modo avión** 2 minutos. | En T2: **EL CHOFER NO TIENE SEÑAL** «desde las HH:MM». | |
| 1.5 | En T1 **quita** el modo avión. No toques nada en T2. | En T2 el aviso se va solo en menos de un minuto. | |
| 1.6 | En T1, mantén apretado **SALIR DE RUTA** hasta que salga (más de medio segundo). | En T2: **NO VEO A TU COMBI**. | |

---

## Caso 3, pasos D y E otra vez: AUSENTE cortado por el cierre de sesión

Esta vez mira **las dos pantallas a la vez** en cada paso. **T1** con chofer
A en ruta.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 3.1 | T1 en ruta. Anota cómo lo muestra Despacho. | Despacho: en ruta, **EN VIVO**. | |
| 3.2 | Toca **AUSENTE**. Apenas salga «Pasas a AUSENTE en 5 s», toca **Salir** (arriba a la derecha). | T1: la pantalla de ingreso. | |
| 3.3 | Mira Despacho durante **2 minutos** sin tocar nada. Anota qué muestra y a qué hora cambia. | Despacho: A **deja de estar en ruta**. **No** debe quedar en SIN SEÑAL ni marcarse AUSENTE. | |
| 3.4 | En T1, entra otra vez con chofer A. **No** toques AUSENTE. | T1: la puerta, con **DESLIZA PARA SALIR A RUTA →**. **No** dice AUSENTE. | |
| 3.5 | Mira Despacho. | Despacho: A **no** aparece AUSENTE ni SIN SEÑAL. Si aparece AUSENTE, anota **dónde** (teléfono o Despacho) y a qué hora. | |

---

## Caso 4, paso B otra vez: cerrar sesión con el botón Salir

Solo para confirmar el segundo intento de la primera ronda. **T1**.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 4.1 | Chofer A en ruta. Pon el **modo avión** 1 minuto. | En la app: posiciones esperando. En Despacho: SIN SEÑAL. | |
| 4.2 | Quita el modo avión y, **en menos de 5 segundos**, toca **Salir** (arriba a la derecha). **No** uses el botón de inicio de Android ni quites la app de recientes. | T1: la pantalla de ingreso. | |
| 4.3 | Entra con **chofer B** y sal a ruta con la combi **Y**. | La bandeja de B **no** muestra nada de A. Despacho: B en la Y, sin saltos, y A ya no en ruta. | |
| 4.4 | Con B en ruta, toca **Salir**. | T1 en el ingreso. | |

---

## Caso 5 completo: cerrar todas las sesiones

**T1** y **T2**, los dos con **chofer A**.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 5.1 | **T1:** entra con chofer A. Quédate en la puerta (no salgas a ruta). | T1 en la puerta. | |
| 5.2 | **T1:** sácala de recientes (botón de recientes de Android → desliza la app hacia arriba). | La app cerrada. | |
| 5.3 | **T2:** entra con chofer A. Toca **Perfil** (arriba a la derecha, al lado de Salir). | Se abre Perfil: la semana, los cobradores, etc. | |
| 5.4 | **T2:** baja **hasta el final**, pasando **CAMBIAR CONTRASEÑA** y su botón **CAMBIAR**. | Debajo hay un recuadro de borde fino y letra gris: **CERRAR TODAS MIS SESIONES**. | |
| 5.5 | **T2:** tócalo **una vez**. | Cambia a rojo: **¿SEGURO? TAMBIÉN CIERRA ESTA — TOCA DE NUEVO**. | |
| 5.6 | **T2:** tócalo **otra vez**. | T2 vuelve a la pantalla de ingreso. | |
| 5.7 | **Espera 1 minuto.** El servidor tarda hasta un minuto en cortar las sesiones. | — | |
| 5.8 | **T1:** abre la app. | **«Tu sesión ya no vale: entra de nuevo»** y la pantalla de ingreso. No sale a ruta sola. No queda notificación del GPS en la barra. | |

**Variante con la ruta empezada** (después de lo anterior):

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 5.9 | **T1:** entra con chofer A y desliza **DESLIZA PARA SALIR A RUTA →**. Apaga la pantalla (botón de encendido). | Despacho: A en ruta, EN VIVO. | |
| 5.10 | **T2:** entra con chofer A → **Perfil** → al final → **CERRAR TODAS MIS SESIONES**, dos toques. | T2 en el ingreso. | |
| 5.11 | Mira Despacho **2 minutos**. Anota a qué hora deja de recibir a A. | Despacho deja de recibir a A en **un minuto, más o menos**. | |
| 5.12 | **T1:** prende la pantalla y abre la app. | El ingreso, con «Tu sesión ya no vale: entra de nuevo». Sin notificación del GPS. | |

---

## Caso 6 completo: relevo de chofer en la misma combi

Necesita la **preparación P.3 y P.4** (B con dos combis habilitadas).
**T1:** chofer A. **T2:** chofer B.

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 6.1 | **T1:** entra con chofer A y sal a ruta con la combi **X**. | Despacho: X en ruta con A. | |
| 6.2 | **T2:** entra con chofer B. Mira la puerta, **encima** de DESLIZA PARA SALIR A RUTA. | La lista **¿EN QUÉ COMBI SALES?** con las dos combis. En la X dice **«la maneja A»** (con el nombre de A), en ámbar. | |
| 6.3 | **T2:** toca la fila de la **X**. | Un recuadro: **«X la está manejando A. Si es un relevo, al salir a ruta la tomas tú y a A se le avisa.»**, con los botones **ES UN RELEVO** y **Cancelar**. | |
| 6.4 | **T2:** toca **Cancelar**. | El recuadro se cierra. B **no** tomó la X. | |
| 6.5 | **T2:** toca otra vez la X y ahora **ES UN RELEVO**. | La X queda marcada como la de B. | |
| 6.6 | **T2:** desliza **DESLIZA PARA SALIR A RUTA →**. | T2 en ruta con la X. | |
| 6.7 | **T1:** mira la pantalla (sin tocar nada). Saca captura. | Un aviso: **«El GPS se apagó: Otro chofer tomó la unidad. Sigues viendo todo, pero tu GPS ya no se usa. Para volver a manejarla: SALIR DE RUTA y después SALIR A RUTA.»** | |
| 6.8 | **T1:** mira la barra de notificaciones. | La notificación del GPS de A **ya no está**. | |
| 6.9 | **T1:** intenta deslizar **DESLIZA PARA SOS →**. **Avísale antes a Despacho que es una prueba.** | Anota qué pasa: el SOS de A **puede** seguir saliendo (es una emergencia), pero A ya no manda posición de la X. | |
| 6.10 | Despacho: mira la combi X en el mapa. Saca captura. | La X con **B**, **un solo punto**, sin saltos. | |

**Variante con la pantalla apagada** (después de lo anterior, al revés:
ahora A le hace el relevo a B):

| Paso | Qué haces | Qué tiene que verse | Resultado |
|---|---|---|---|
| 6.11 | **T1:** mantén apretado **SALIR DE RUTA** y sal. **T2** sigue en ruta con la X. **Apaga la pantalla de T2.** | — | |
| 6.12 | En Despacho → Gestión → Personas, habilita a **A** dos combis (la X y otra), como en P.3 y P.4. | — | |
| 6.13 | **T1:** en la puerta, toca la **X** → **ES UN RELEVO** → desliza para salir a ruta. | T1 en ruta con la X. | |
| 6.14 | Espera **2 minutos**. Mira Despacho. | La X con **A**, un solo punto. | |
| 6.15 | **T2:** prende la pantalla y abre la app. | El mismo aviso del paso 6.7, ahora para B. B **no** vuelve a mandar posición de la X. | |

---

## Al terminar

Pásame los resultados por número de paso, con las capturas de los pasos
6.7, 6.10 y de toda FALLA. Los anoto en `RESULTADOS-TELEFONO.md`.

Al final, quítale a A y a B las combis extra que habilitaste en P.4 y 6.12.
