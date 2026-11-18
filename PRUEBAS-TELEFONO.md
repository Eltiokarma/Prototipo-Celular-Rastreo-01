# Pruebas en teléfono — APK 0.3.1 (con todo hasta `1bdf57e`)

Las ocho revisiones con ChatGPT (bloques 21–31 de CAMBIOS-PARA-REVISAR.md)
se cerraron con pruebas en Node: el servicio completo con lo nativo
**simulado**. Nada de eso corrió todavía en un Android. Esta planilla es para
conseguir esa evidencia: qué hacer, qué tiene que verse y qué anotar.

Una prueba que «parece que anda» no cuenta. Cada caso termina en **OK**,
**FALLA** o **NO SE PUDO**. Si es FALLA, anota la **hora exacta** y saca una
captura del teléfono y otra de Despacho en ese mismo minuto.

## Antes de empezar

1. Fusiona a `main` los commits de la rama hasta `1bdf57e`.
   `compilar-app.bat` compila lo que está en `main`.
2. Corre `compilar-app.bat` y elige **[3] APK de PRUEBA DE ACTUALIZACIONES**.
   Instálala en los dos teléfonos. Tiene que ser la **0.3.1**: la 0.3.0 no
   compila (falta la imagen de arranque; CAMBIOS, bloque 32). Con esa APK, si sale un arreglo, llega con
   `publicar-arreglo.bat` → [1] PRUEBA, sin compilar de nuevo.
3. Usuarios: **chofer A**, **chofer B** y un **cobrador** cargado en la
   **combi X**. Ten Despacho abierto en una PC.
4. En los dos teléfonos deja la batería en «Sin restricciones», la hora
   automática y los permisos como dice el manual. La excepción es el caso 2,
   que empieza sin permisos.

| | Teléfono 1 (T1) | Teléfono 2 (T2) |
|---|---|---|
| Marca y modelo | | |
| Versión de Android | | |
| Capa de la marca (One UI, MIUI/HyperOS, etc.) | | |
| `X-App-Version` que muestra Despacho en Personas | | |
| Fecha de la prueba | | |

## En qué orden

Los casos están numerados por tema, pero **se hacen en este orden**:

| Orden | Caso | Por qué ahí |
|---|---|---|
| 1.º | **0. Comprobación inicial** (abajo) | Si falla, no tiene sentido seguir. |
| 2.º | **2. Permisos** | Recién instalada, la app todavía no tiene permisos. |
| 3.º | **3. AUSENTE y DESHACER** | Un teléfono, rápido. |
| 4.º | **1. Cobrador** | Los dos teléfonos y salir a la calle (lejos del trazado y después llegar a él). |
| 5.º | **4. Cerrar sesión con un envío pendiente** | Tiene la pantalla apagada 5 min: ahí se ve si Android mata la app. |
| 6.º | **6. Relevo** | Los dos teléfonos. |
| 7.º | **5. Sesión revocada** | Al final: «CERRAR TODAS MIS SESIONES» saca al chofer A de todos lados. |

Cuando me mandes un resultado, nómbralo por el **número de caso** y el paso
(por ejemplo, «caso 4, paso 3: FALLA»), no por el orden.

## 0. Comprobación inicial

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| Abre la app en cada teléfono. | La pantalla de arranque es **lisa, azul oscuro, sin ícono**. Después, la presentación con «MICROS TEMPO» y «Control de ruta». | |
| Entra con un usuario. En Despacho → Personas, mira su `X-App-Version`. | Empieza con **0.3.1/**. Anótala en la tabla de arriba. | |
| Revisa la batería de la app (Ajustes → Apps → Control de ruta → Batería). | **Sin restricciones** en los dos teléfonos. Si no, los casos con pantalla apagada fallan por Android y no por la app. | |

---

## 1. Cobrador cuando su combi no está en ruta

**T1:** chofer A con la combi X. **T2:** el cobrador de la combi X.

| Paso | Qué tiene que verse en T2 | Resultado |
|---|---|---|
| T1 entra, pero se queda en la puerta (no sale a ruta). T2 entra. | Unos segundos «ESPERANDO LA RUTA» y después **NO VEO A TU COMBI**. Nunca brechas inventadas. | |
| T1 sale a ruta **lejos del trazado**. | **TU COMBI VA HACIA LA RUTA**. | |
| T1 llega al trazado. | El aviso se va y aparecen las brechas de X. | |
| T1 toca AUSENTE y deja pasar los 5 s. | **TU COMBI ESTÁ AUSENTE**. | |
| T1 vuelve a ruta y después pone el **modo avión** ~2 min. | **EL CHOFER NO TIENE SEÑAL** «desde las HH:MM». No dice «no está». | |
| T1 quita el modo avión. | El aviso se va solo, sin tocar nada en T2. | |

La falla que se busca: que T2 muestre brechas viejas como si fueran de
ahora, o que diga «no está» cuando en realidad no sabe.

## 2. Permisos negados y concedidos después

**T1**, recién instalado (o con los permisos quitados en Ajustes → Apps).

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| Entra con chofer A. Al deslizar «Salir a ruta», **niega** la ubicación. | «Falta el permiso de ubicación en …». **Despacho no lo muestra en ruta**. | |
| Ve a Ajustes y elige ubicación **Permitir todo el tiempo**. Vuelve a la app y desliza otra vez. | Entra a ruta. El cartel de permisos **desaparece**. Despacho lo ve. | |
| Ya en ruta: en Ajustes, **apaga las notificaciones** de la app. Vuelve. | No hay notificación de brecha en la barra. La app sigue andando. | |
| En Ajustes, **préndelas** de nuevo y vuelve a la app (sin cerrarla). | En menos de un minuto vuelve la notificación de la brecha, **sin reiniciar la app**. | |

## 3. AUSENTE, DESHACER y salir de sesión

**T1** en ruta con chofer A. **T2** como cobrador o solo Despacho.

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| Toca AUSENTE. | «Pasas a AUSENTE en 5 s», contando, con **DESHACER**. | |
| Toca DESHACER antes de que llegue a 0. | Sigue en ruta. **Ni Despacho ni T2 lo vieron ausente** en ningún momento. | |
| Toca AUSENTE y deja pasar los 5 s. | T1 ausente. Despacho y T2 lo ven ausente. | |
| Vuelve a ruta. Toca AUSENTE y, **antes de los 5 s**, sal de la sesión. | Sale limpio. | |
| Vuelve a entrar con chofer A. | No arrastra un AUSENTE fantasma. Despacho no lo marca ausente por ese toque. | |

## 4. Cerrar sesión con un envío pendiente y entrar con otro chofer

Es lo que cubren las pruebas de la octava revisión, ahora en el aparato.
Todo en **T1**.

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| Chofer A en ruta. Pon el **modo avión** ~1 min (se juntan posiciones sin mandar). | «SIN SEÑAL» en A. Es lo esperado. | |
| Quita el modo avión e **inmediatamente** sal de la sesión. | Sale. | |
| Entra con **chofer B** y sal a ruta con otra combi. | La bandeja de B **no** muestra brecha ni «SIN SEÑAL» de A. El diagnóstico de B no dice «sin red». | |
| Mira Despacho. | Las posiciones de A **no** aparecen como de B. La combi de B arranca desde donde está. | |
| Con B en ruta, **apaga la pantalla 5 min**. | Despacho sigue recibiendo a B (la hora de «oído hace» no pasa de ~1 min). | |
| Prende la pantalla y vuelve a la app. | El HUD se pone al día solo. Nada de A reaparece. | |

## 5. Sesión revocada mientras la app estaba cerrada

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| **T1:** chofer A en la puerta. Cierra la app (sácala de recientes). | — | |
| **T2:** entra como chofer A. Perfil → **CERRAR TODAS MIS SESIONES** (dos toques). | T2 vuelve al ingreso. | |
| **T1:** abre la app. | «Tu sesión ya no vale: entra de nuevo» y la pantalla de ingreso. No queda notificación del GPS. No sale a ruta solo. | |
| Variante: lo mismo, pero con **T1 en ruta y la pantalla apagada** al revocar. Espera 2 min y prende. | El GPS de T1 se cortó (Despacho deja de recibirlo en ~1 min). Al volver, el ingreso y la bandeja limpia. | |

## 6. Relevo de chofer en la misma combi

**T1:** chofer A en ruta con la combi X. **T2:** chofer B.

| Paso | Qué tiene que verse | Resultado |
|---|---|---|
| En T2, B elige la combi X. | «X la está manejando A. Si es un relevo…» con **ES UN RELEVO**. | |
| Toca ES UN RELEVO y sale a ruta. | T2 en ruta con X. | |
| Mira T1. | «El GPS se apagó: otro chofer tomó la unidad». La notificación del GPS se va. T1 **no vuelve** a mandar. | |
| Mira Despacho. | X sigue con B, sin saltos ni dos puntos para X. | |
| Repite, pero con la **pantalla de T1 apagada** al hacer el relevo. Prende T1 a los 2 min. | El mismo aviso en T1. No reanuda el GPS al volver al frente. | |

---

## Al terminar

Pasa los resultados a CAMBIOS-PARA-REVISAR.md (un bloque nuevo) con el
modelo, Android y `X-App-Version`. Toda FALLA va con su hora y sus dos
capturas. Con eso se decide qué se arregla antes de repartir la APK a los
choferes.
