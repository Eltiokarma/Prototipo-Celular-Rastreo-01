# Resultados de las pruebas en teléfono — APK 0.3.1

Lo que se va viendo al seguir `PRUEBAS-TELEFONO.md` (primera ronda, 18/11),
`PRUEBAS-TELEFONO-RONDA-2.md` (segunda ronda, 20/11) e
`informes/pruebas-telefono-ronda3.pdf` (tercera ronda, 23/11). **Solo se anota**: nada
de esto se corrige hasta terminar los casos que faltan. Al cerrar, pasa a
CAMBIOS-PARA-REVISAR.md como un bloque.

La única excepción es H22, que el probador pidió cambiar ya porque sin eso
el caso 1 no se puede hacer. Y al cerrar la segunda ronda, el probador pidió
arreglar antes de seguir probando: ver «Arreglado el 20/11» al final.

## Teléfonos

| | Teléfono 1 (T1) | Teléfono 2 (T2) |
|---|---|---|
| Marca y modelo | Poco X7 | Xiaomi Redmi 15C |
| Android | 15 (compilación AP3A.240905.015.A2) | 15 (compilación AP3A.240905.015.A2) |
| Capa de la marca | HyperOS 2.0.208.0 | HyperOS 2.0.217.0 |
| `X-App-Version` en Despacho | 0.3.1 | 0.3.1 |
| Fecha de la prueba | 18/11/2026 y 20/11/2026 | 18/11/2026 y 20/11/2026 |

---

## Caso 0. Comprobación inicial

| Paso | Resultado | Lo que se vio |
|---|---|---|
| Pantalla de arranque lisa, sin ícono | **FALLA** | Es azul oscuro, pero **aparece el ícono de la app** en el centro. |
| Presentación con «MICROS TEMPO» y «Control de ruta» | OK, pero no es lo que se quiere | Sale el ícono, «MICROS TEMPO» y «Control de ruta». Ver H3. |
| `X-App-Version` empieza con 0.3.1 | OK | Comprobado en Despacho. |
| Batería «Sin restricciones» | OK | En los dos teléfonos, con los permisos necesarios. |

## Caso 1. Cobrador cuando su combi no está en ruta

| Paso | Resultado | Lo que se vio |
|---|---|---|
| T1 en la puerta, T2 entra | OK | «ESPERANDO LA RUTA» y después «NO VEO A TU COMBI». |
| T1 sale a ruta lejos del trazado | **NO SE PUDO** | La prueba se hizo a una cuadra del paradero inicial: la app lo tomó como dentro de la ruta y mostró la brecha de frente. «TU COMBI VA HACIA LA RUTA» no salió, o salió un instante y se fue con la actualización automática. Hay que repetirlo más lejos. |
| T1 llega al trazado | OK | Aparece la brecha (ver el paso anterior). |
| T1 AUSENTE 5 s | OK | |
| T1 en modo avión ~2 min | OK | Sale «EL CHOFER NO TIENE SEÑAL». Ver H6. |
| T1 quita el modo avión | Sin anotar | |

## Caso 2. Permisos negados y concedidos después

| Paso | Resultado | Lo que se vio |
|---|---|---|
| Niega la ubicación al deslizar «Salir a ruta» | OK | Sale el diálogo de Android (permitir / permitir todo el tiempo). Despacho **no** lo muestra en ruta. En la app parece salir el aviso de que falta la ubicación (sin confirmar el texto). No deja salir a ruta sin la **ubicación precisa**. Ver H10. |
| En Ajustes, «Permitir todo el tiempo», vuelve y desliza | OK | El cartel de permisos desaparece y Despacho lo empieza a ver. |
| Ya en ruta, apaga las notificaciones de la app | **FALLA** | **Redmi, primera vez:** la app se cerró sola (crash) y desapareció de Despacho. **Redmi, segunda vez, y Poco:** la app se reinicia, vuelve a pedir el permiso de notificaciones y el chofer **desaparece de Despacho**. El SOS y el chat sí siguen llegando a la central. Ver H7 y H8. |
| Prende las notificaciones y vuelve a la app | **FALLA** | La app vuelve, pero **Despacho no lo ve**. Cerrar la app sola no basta, y salir de la cuenta y entrar enseguida tampoco. Vuelve a aparecer de dos maneras: (a) cierra la app (quitarla de recientes) **y** sale de la cuenta; (b) sale de la cuenta **sin cerrar la app** y deja la pantalla bloqueada (apagada) unos **2 min**. Ver H9. |

## Caso 3. AUSENTE, DESHACER y salir de sesión

| Paso | Resultado | Lo que se vio |
|---|---|---|
| Toca AUSENTE | OK | En los dos teléfonos. |
| DESHACER antes de 0 | OK | En los dos teléfonos. |
| AUSENTE y deja pasar los 5 s | OK | En los dos teléfonos. |
| Vuelve a ruta, AUSENTE y, antes de los 5 s, sale de la sesión | **FALLA en Despacho** | En el teléfono sale limpio. En Despacho sigue apareciendo unos segundos y después queda en **SIN SEÑAL**: no se actualizó al salir. Nota del probador: «recién al entrar en la app se pone en ausente». Ver H11 y H12. |
| Vuelve a entrar con chofer A | **FALLA** | En Despacho **arrastra el SIN SEÑAL** hasta que sale a ruta. Ver H11. |

## Caso 4. Cerrar sesión con un envío pendiente y entrar con otro chofer

| Paso | Resultado | Lo que se vio |
|---|---|---|
| Chofer A en ruta, modo avión ~1 min | OK | En la app: «GPS fallidos 16, esperando 16» (hay captura). En Despacho: SIN SEÑAL. |
| Quita el modo avión e inmediatamente sale de la sesión | OK | **Primer intento:** en vez de cerrar sesión se tocó el botón de inicio de Android (la app quedó de fondo); Despacho lo volvió a ver, que es lo esperado en ese caso porque salieron las posiciones guardadas. **Segundo intento:** quitó el modo avión y salió; sale limpio. |
| Entra con chofer B y sale a ruta con otra combi | OK | Limpio. También se intercambiaron las cuentas entre los dos celulares, sin problemas. |
| Mira Despacho | OK | Todo limpio. |
| Con B en ruta, pantalla apagada 5 min | OK | Todo normal. No apareció «oído hace», que es lo esperado: ese rótulo solo sale cuando el teléfono está SIN SEÑAL. |
| Prende la pantalla y vuelve a la app | OK | Todo normal. |

---

## Caso 5. Sesión revocada mientras la app estaba cerrada

| Paso | Resultado | Lo que se vio |
|---|---|---|
| T1: chofer A en la puerta, cierra la app | OK | Sin nada que observar. |
| T2: entra como chofer A y toca CERRAR TODAS MIS SESIONES | **NO SE PUDO** | El botón está (al final de Perfil, debajo de CAMBIAR), pero **se pasó por alto**. Hay que repetir el caso. Ver H14. |
| T1: abre la app | **NO SE PUDO** (no hubo revocación) | No sale «Tu sesión ya no vale», que es lo esperable si nunca se cerraron las sesiones. **Las dos sesiones del mismo chofer quedan abiertas a la vez.** En uno de los teléfonos no hay mapa: parece que solo uno tiene todo el funcionamiento. Después salió a ruta con el otro, sin problema. El chat funcionó en los dos. Ver H14 y H15. |
| Variante con T1 en ruta y la pantalla apagada | No se hizo | |

## Caso 6. Relevo de chofer en la misma combi

| Paso | Resultado | Lo que se vio |
|---|---|---|
| En T2, B elige la combi X | **FALLA** | B es otro usuario y entró con **su combi asignada**, que es la X: no hubo lista para elegir, así que la confirmación de relevo no podía salir (solo aparece en la lista «¿EN QUÉ COMBI SALES?», que se muestra cuando el chofer tiene **más de una** combi habilitada). Aun así, B tomó la combi que manejaba A **sin ninguna confirmación**. En el teléfono de A sale una notificación: «tu sesión siguió en otro dispositivo o ha dejado de reportar» (texto aproximado). En el mapa de Despacho **no aparece nada**. En la actividad de gestión sí aparece que se conectó el otro usuario, con la hora. Ver H16 y H17. |
| Toca ES UN RELEVO y sale a ruta | **NO SE PUDO** | El botón no aparece. |
| Mira T1 | Pendiente | El probador va a mandar capturas. |
| Mira Despacho | — | Ver el primer paso: no aparece nada de la doble conexión. |
| Repite con la pantalla de T1 apagada | **FALLA** | Con la pantalla apagada, T1 «ni se enteró». El SOS funcionó **en los dos teléfonos a la vez**, y AUSENTE también. Al mandar la app al fondo (botón de inicio de Android) y volver, sí sale «tu sesión siguió en otro dispositivo», pero **solo al refrescar la app**. Ver H16. |

---

# Segunda ronda — 20/11/2026

Sigue `PRUEBAS-TELEFONO-RONDA-2.md`, con la misma APK 0.3.1. Probó Gerson,
de 6:37 a 7:36 más o menos. Los pasos van con el número de la planilla.

- **Combi X:** M11111. **Combi Y:** M12345.
- **Chofer A:** «El Gordo». **Chofer B:** «Karma» (así salen en las capturas).
- **Capturas recibidas:** las de Despacho de los pasos 3.3 (dos) y 6.10, en el
  documento «SS de Pruebas Android v2 - 01», y cuatro del Poco X7 (T1): 7:09
  (paso 4.3), 7:15 (paso 5.8), 7:24 y 7:26 (paso 6.7), y una del Redmi 15C
  (T2) a las 7:36 (paso 6.15). Y una de Despacho → Gestión → **Actividad**
  del 20/11, de 7:13 a 7:35, que ordena los casos 5 y 6 (ver abajo).
- En la Actividad las personas aparecen por su usuario: **M11111 es el chofer
  A** (El Gordo) y **M12345 es el chofer B** (Karma), igual que las combis.

De 50 pasos: 42 OK, 1 FALLA (6.13), 1 que falló una vez de dos (3.3) y 6 sin
hacer (todo el caso 1).

## Preparación

| Paso | Resultado | Lo que se vio |
|---|---|---|
| P.1 a P.5 | OK | Empezó a las 6:37. B quedó con las dos combis a las 6:41. |

## Caso 2. El texto del aviso de permisos

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 2.1 Quita el permiso de ubicación | OK | |
| 2.2 Desliza y toca «No permitir» | OK | Primero sale la pregunta de Android («¿Permite que Control de ruta acceda a la ubicación de este dispositivo?»). Si se sigue sin dar el permiso, sale el aviso de la app. El texto del aviso de la app no se copió. |
| 2.3 Devuelve el permiso | OK | |

## Caso 1. El cobrador cuando su combi va hacia la ruta

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 1.1 a 1.6 | **Sin hacer** | Los seis pasos quedaron en blanco. Con el radio de 300 m había que alejarse cinco cuadras del trazado; el probador pidió bajarlo a 20 m. Ver H22. |

## Caso 3. AUSENTE cortado por el cierre de sesión

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 3.1 T1 en ruta | OK | Despacho lo muestra en ruta. |
| 3.2 AUSENTE y enseguida Salir | OK | T1 en el ingreso. |
| 3.3 Mira Despacho 2 minutos | **FALLA la primera vez, OK la segunda** | En la planilla quedó marcado NO SE PUDO, con la nota «falló la primera vez y después funcionó». **Primera vez** (captura): la tarjeta de M11111 sigue en la lista, con «Sin señal desde 06:53», «Sin noticias del teléfono hace 124 s» y «Ausente — fuera de la cadena»; arriba dice «0 en ruta · 1 ausente» y el mapa la rotula «M11111 · AUSENTE». **Segunda vez** (captura): «Todavía no hay combis en ruta», que es lo esperado. Ver H11 y H12. |
| 3.4 Entra otra vez con A | OK | La puerta, sin AUSENTE. |
| 3.5 Mira Despacho | OK | Ni AUSENTE ni SIN SEÑAL. |

## Caso 4. Cerrar sesión con el botón Salir

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 4.1 Modo avión 1 minuto | OK | «En Despacho apareció la notificación a los 30 segundos, con el tiempo correcto». |
| 4.2 Quita el modo avión y toca Salir | OK | |
| 4.3 Entra con B y sale con la Y | OK | «Soy la única unidad en la Ruta, desde el loggeo ya me aparecía la combi X disponible» (la nota estaba en el 4.2 de la planilla; el probador aclaró que es de este paso). Captura de T1 a las 7:09: la lista «¿EN QUÉ COMBI SALES?» con M12345 «libre», ELEGIDA, y M11111 «libre». Es lo esperado: A ya había cerrado sesión. |
| 4.4 Con B en ruta, toca Salir | OK | |

## Caso 5. Cerrar todas las sesiones

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 5.1 a 5.7 | OK | Esta vez el botón se encontró: recuadro al final de Perfil, se pone rojo al primer toque y al segundo T2 vuelve al ingreso. En la Actividad, a las 7:14 A **cambió su propia contraseña** («1 sesión(es) cerradas») y en el mismo minuto **cerró todas sus sesiones** («1 sesión(es)»). Cambiar la contraseña ya cierra las otras sesiones: la de T1 se cerró ahí, y CERRAR TODAS MIS SESIONES sólo encontró la de T2. El resultado en T1 es el mismo, pero el camino probado fue el de la contraseña. El cambio fue a propósito, y **lo indujo la planilla**: el paso 5.4 nombraba el botón **CAMBIAR**, y en el PDF iba en azul, que según la propia planilla es «lo que tocas». Corregido en `PRUEBAS-TELEFONO-RONDA-2.md`. |
| 5.8 T1 abre la app | OK, **con otro texto** | Vuelve al ingreso, pero el aviso dice **«Sesión inválida o expirada»**, en rojo, no «Tu sesión ya no vale: entra de nuevo». Captura de T1 a las 7:15, con «app 0.3.1 (4)» al pie. Ver H19. |
| 5.9 T1 en ruta, pantalla apagada | OK | |
| 5.10 T2 cierra todas las sesiones | OK | En la Actividad, 7:18: «cerró todas sus sesiones · 2 sesión(es)». Esta vez sí por el botón. |
| 5.11 Mira Despacho 2 minutos | OK | «Diría que después de un minuto, pero el reloj decía 30 segundos, no problema». |
| 5.12 T1 prende la pantalla | OK, **con otro texto** | El ingreso, con **«Sesión cerrada»** nada más. Ver H19. |

## Caso 6. Relevo de chofer en la misma combi

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 6.1 T1 sale a ruta con la X | OK | |
| 6.2 T2 entra con B y mira la lista | OK | Sale «la maneja el gordo». Pedido: el nombre, en negrita. Ver H21. |
| 6.3 Toca la fila de la X | OK | |
| 6.4 Cancelar | OK | |
| 6.5 ES UN RELEVO | OK | «Sale sombreada, no es una x, me gusta como está». |
| 6.6 T2 sale a ruta | OK | |
| 6.7 Mira T1 | OK | Dos capturas de T1. **7:24**, antes de que B saliera a ruta: en ruta, sin aviso, con el ícono de ubicación en la barra de Android. **7:26:** el aviso, palabra por palabra como en la planilla: «El GPS se apagó: Otro chofer tomó la unidad. Sigues viendo todo, pero tu GPS ya no se usa. Para volver a manejarla: SALIR DE RUTA y después SALIR A RUTA.» Debajo, en rojo, «Servicio de GPS: detenido: sin rol de GPS», y «GPS enviadas 134 · fallidas 0 · último hace 6s». El ícono de ubicación ya no está en la barra. |
| 6.8 Barra de notificaciones de T1 | OK | Queda una notificación que dice «MODO ACOMPAÑANTE», otro chofer tomó la unidad. Es la que pone la app al perder el mando, en lugar de la del GPS: la planilla no lo decía. |
| 6.9 SOS desde T1 | OK | Sin nota. En la captura de Despacho del paso 6.10 se ve que el SOS salió a las 7:27. Ver H23. |
| 6.10 Despacho, la X en el mapa | OK | Captura de las 7:29: la M11111 con Karma (B), un solo punto, «1 en ruta». |
| 6.11 T1 sale de ruta, T2 con la pantalla apagada | OK | |
| 6.12 A queda con dos combis | OK | |
| 6.13 T1 toca la X → ES UN RELEVO | **FALLA** (es H16) | Nota del probador: «Seguí el paso 6.11 en T1, así que mi pantalla estaba en RUTA para ese paso. Luego salí y volví a entrar para intentar que me salga ES UN RELEVO, pero no, todas las combis están libres». T2 llevaba entre 2 y 5 minutos con la pantalla apagada, en la lista de T1 no aparecía el otro chofer, y T1 salió a ruta con la X sin la confirmación. **La Actividad lo ordena:** 7:31, A «tomó la combi que manejaba M12345 · M11111»; **7:32**, Despacho le habilita las combis (paso 6.12); 7:33, A inicia sesión otra vez. A tomó la combi **un minuto antes** del paso 6.12, cuando todavía tenía **una sola** combi: sin lista, no hay confirmación. Cuando volvió a entrar, B ya estaba relevado desde las 7:31, así que «libre» era lo correcto. Ver H18. |
| 6.14 Espera 2 minutos y mira Despacho | OK | La X con A, un solo punto. |
| 6.15 T2 prende la pantalla | OK | Captura del Redmi 15C a las 7:36: el mismo aviso del 6.7, ahora para B, con «Servicio de GPS: detenido: sin rol de GPS» y «GPS enviadas 137 · fallidas 0 · 1 no usadas · último hace 287s». Batería en 14 %. Las 7:31 de ese «último» son las del relevo: el Redmi mandó hasta que A tomó la combi, y la respuesta siguiente lo apagó, que es lo esperado. |

# Tercera ronda — 23/11/2026

Sigue `informes/pruebas-telefono-ronda3.pdf`, llenado por el probador
(Gerson). La APK es la 0.3.1 con el arreglo publicado el 23/11 a las 14:54:
la captura de Despacho del paso 3.3 lo muestra en la tarjeta de la combi
(«APP 0.3.1 · 23/11 14:54»).

- **Teléfonos:** T1, Poco X7; T2, Redmi 15C.
- **Usuarios:** chofer A, El Gordo; chofer B, Karma; cobrador de la X, Cocas.
- **Combis:** X, M11111; Y, M12345.
- **Horas:** el caso 3 se hizo hacia las 18:57 y el caso 6 hacia las 20:45.
- **Capturas recibidas:** la de Despacho del paso 3.3 (18:59), en el documento
  «SS de Pruebas Android v2 - 01», y dos del Redmi 15C (T2, con el tema
  oscuro): 20:35 (paso 6.7) y 20:46 (paso 6.16). La del paso 2.5 llegó
  **descrita en texto**. **Falta** la del paso 6.8 (Despacho: el mapa y la
  Actividad). Con ellas llegaron otra vez tres del Poco X7 (7:09, 7:15 y
  7:24), pero son las de la segunda ronda, del 20/11: ya están anotadas allá.

De 56 pasos: 50 OK, 4 FALLA (2.5, 2.6, 3.3 y 3.4), 1 NO SE PUDO (2.4) y 1 sin
marcar (6.12).

## Preparación

| Paso | Resultado | Lo que se vio |
|---|---|---|
| P.1 a P.7 | OK | El arreglo llegó a los dos teléfonos. |

## Caso 1. El cobrador cuando su combi va hacia la ruta

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 1.1 a 1.7 | OK | Por primera vez en las tres rondas, el caso completo: **TU COMBI VA HACIA LA RUTA** fijo, las brechas al pisar la calle, **EL CHOFER NO TIENE SEÑAL** con el modo avión y **NO VEO A TU COMBI** al salir de ruta. Confirma H22 (el radio de entrada de 20 m). La nota del 1.4, a cuántos metros de la calle cambió T2, quedó en blanco. |
| 1.8 | OK | Nota: «Hay que agregar un botón para la confirmación de Salir, también un botón más animado cuando se hace click en perfil, no sé si es lento o si mi dedo no es reconocido por el táctil». Ver H25 y H26. |

## Caso 3. AUSENTE cortado por el cierre de sesión

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 3.1 y 3.2 | OK | |
| 3.3 | **FALLA** (ver 3.4) | «A las 6:57 salí de la App marcando Ausente como dijiste, me quedé mirando la pantalla de despacho». Captura de las 18:59: la M11111 de El Gordo sigue **en ruta, EN VIVO** («En vivo · 1 en ruta», 0 km/h, ida), no AUSENTE ni SIN SEÑAL. |
| 3.4 | **FALLA** (de preparación) | «Cuando volví a entrar con ese chofer, no me permitió escoger el micro, supongo que se quedó anotado con el micro anterior. Cuando volví a hacer las pruebas, funcionó, resulta que en **T2 estaba abierta la sesión de Chofer 1**». Con otra sesión de A abierta, el servidor no baja la combi al cerrar sesión en T1: es lo pedido para no sacar del mapa al teléfono que maneja (bloque 34). Que A no pudiera elegir combi es lo esperado: desde el paso P.5 tiene una sola, y con una sola no hay lista. |
| 3.5 | OK | Con la sesión de T2 cerrada, la combi se va del mapa y no vuelve. |
| 3.6 | OK | Salir sin AUSENTE: igual. |

## Caso 5. Cerrar todas las sesiones

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 5.1 a 5.11 | OK | Actividad con **2 sesión(es)**, el aviso **«Tu sesión ya no vale: entra de nuevo»** (H19 y H24 arreglados) y, con T1 en ruta y la pantalla apagada, la combi se va del mapa «casi al momento» (5.10). |

## Caso 6. Relevo de chofer en la misma combi

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 6.1 a 6.11 | OK | El relevo pide confirmación también con **una sola** combi (6.3 a 6.6) y no la pide dos veces si ya se confirmó en la lista (6.10 y 6.11). H16 arreglado. |
| 6.7 | OK | Captura de T2 a las 20:35: el aviso «El GPS se apagó: Otro chofer tomó la unidad…», palabra por palabra, con «Servicio de GPS: detenido: sin rol de GPS» y «GPS enviadas 4782 · fallidas 13 · último hace 15s · sin red ×13». |
| 6.5 | OK, con un detalle | «El botón de deslizamiento Deslizar para salir a Ruta se quedó pegado en IR y a la derecha, no es problema, regresó al tocarlo.» Ver H27. |
| 6.12 | Sin marcar | Sin nota. Los pasos siguientes salieron bien, así que se hizo. |
| 6.13 a 6.17 | OK | Con la pantalla de T2 apagada (20:45), la lista de T1 sigue diciendo **la maneja Karma** y el relevo pide confirmación. Captura de T2 a las 20:46 (paso 6.16): el mismo aviso, «detenido: sin rol de GPS» y «enviadas 4846 · 1 no usadas · último hace 17s». Al prender la pantalla, T2 mandó lo que tenía guardado, el servidor le contestó que ya no tiene el mando y el servicio se apagó: es lo esperado, y Despacho siguió con la X en A. |

## Caso 2. Las notificaciones quitadas en ruta

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 2.1 y 2.2 | OK | |
| 2.3 | OK | «Se reinició y volvió a pedir el permiso de notificaciones. Se aceptaron las notificaciones y se volvió a entrar.» |
| 2.4 | **NO SE PUDO** (es una falla) | «En Despacho no aparece la Combi A, en el celular sale "Sin Señal".» |
| 2.5 | **FALLA** | Perfil → EL GPS, copiado a mano: «Servicio de GPS: Corriendo, GPS enviadas 0, fallidas 0, 1 no usadas, 1 esperando, último hace 412 s». |
| 2.6 | **FALLA** | Apagar y prender las notificaciones otra vez no lo arregla: sigue sin señal. |
| 2.7 | OK | Al salir de ruta, la combi se va de Despacho. Al volver a entrar, A aparece en Despacho en la puerta («como alguien que no terminó de entrar»), que es lo esperado; pero al salir a ruta, **la combi no aparece**. Lo que lo arregla, como en la primera ronda: salir de la app y dejar la pantalla apagada un minuto. Ver H8 y H9. |

---

## Hallazgos (pendientes de analizar)

| # | Qué | Tipo | Dónde se vio |
|---|---|---|---|
| H1 | La pantalla nativa de arranque muestra el **ícono de la app**, aunque la imagen del plugin es transparente. | Falla | Caso 0, los dos teléfonos |
| H2 | El arranque es **~25 % más lento** en el Redmi 15C que en el Poco X7. | Observación | Caso 0 |
| H3 | En la presentación debe salir **solo el logo de Micros Tempo**. Hoy sale el ícono, «MICROS TEMPO» y «Control de ruta». | Pedido | Caso 0 |
| H4 | El **nombre de la app** debe ser **Micros Tempo**, no «Control de ruta». | Pedido | Caso 0 |
| H5 | Si un chofer entró a la app pero **no salió a ruta**, Despacho no puede escribirle. Si el chofer le escribe, Despacho abre ese mensaje, pero después **no puede volver a abrir la conversación**. Pasa en el chat de la ruta, en el de la combi y en el personal. | Falla | Durante el caso 0 |
| H6 | Cuando el chofer se queda sin señal, el teléfono del cobrador podría **ofrecer usar su propia posición** para la combi. | Idea | Caso 1 |
| H7 | En el Redmi, la primera vez que se quitaron las notificaciones con el chofer en ruta, **la app se cerró sola**. El probador sospecha la RAM. | Falla | Caso 2, Redmi |
| H8 | Al quitar las notificaciones en ruta, la app se reinicia y el chofer **desaparece de Despacho**, aunque el SOS y el chat siguen llegando. Hay que ver si es Android cerrando la app al quitarle un permiso y por qué la ruta no se retoma después. | Falla | Caso 2, los dos teléfonos |
| H9 | Con las notificaciones devueltas, el chofer **no vuelve a Despacho** hasta que sale de la cuenta y además cierra la app o deja la pantalla bloqueada unos 2 min. | Falla | Caso 2, los dos teléfonos |
| H10 | No se puede salir a ruta sin la **ubicación precisa**. Hay que confirmar si es lo que se busca y si la app lo explica. | Observación | Caso 2 |
| H11 | Cerrar sesión en ruta **no saca al chofer de Despacho**: queda en SIN SEÑAL, y al volver a entrar lo arrastra hasta salir a ruta. | Falla | Caso 3 |
| H12 | Un AUSENTE tocado y cortado por el cierre de sesión parece aplicarse **al volver a entrar** («recién al entrar en la app se pone en ausente»). | Falla probable | Caso 3 |
| H13 | Crear el perfil **Dueño** en gerencia: el dueño de la combi. Puede ser el chofer, el cobrador o alguien de afuera que solo quiere ver su unidad desde lejos. | Pedido | Durante el caso 3 |
| H14 | El botón CERRAR TODAS MIS SESIONES **pasa desapercibido**: está al final de Perfil, debajo de CAMBIAR, como un recuadro de borde fino con letra gris, y el probador no lo vio aunque Perfil cargó bien. Funciona (está en la app 0.3.1); el problema es que no se encuentra. Es el remedio para un teléfono perdido o prestado. | Diseño | Caso 5 |
| H15 | El **mismo chofer puede tener dos sesiones abiertas a la vez** en dos teléfonos. En uno no aparece el mapa. Despacho no lo marca. | Falla | Caso 5 |
| H16 | El **relevo no funciona**: un chofer con la misma combi asignada la toma **sin confirmación**, y los **dos teléfonos siguen activos** para la misma combi (SOS y AUSENTE andan en los dos). El de A solo se entera («tu sesión siguió en otro dispositivo») al volver al frente; con la pantalla apagada, nunca. | Falla | Caso 6 |
| H17 | Despacho **no muestra** la doble conexión ni el relevo en el mapa. Solo aparece en la actividad de gestión. | Falla | Caso 6 |
| H18 | El paso 6.13 falló, pero **no por la lista**. La Actividad muestra que A tomó la combi a las 7:31, un minuto **antes** de que Despacho le habilitara la segunda combi (7:32). Con una sola combi la app no muestra la lista ni la confirmación: es **H16**, ahora con registro. El Redmi estaba vivo (el servidor lo anotó como relevo, cosa que sólo hace si el otro todavía mandaba) y se apagó por el relevo, no por la batería. La lista de las 7:33 decía «libre» con razón: B ya estaba relevado. Queda por probar el 6.13 en el orden de la planilla, con la segunda combi habilitada **antes** de deslizar. | Resuelto: **es H16** | Ronda 2, pasos 6.13 y 6.15, y la Actividad |
| H24 | Cambiar la propia contraseña **cierra las otras sesiones** del chofer (Actividad, 7:14). Está bien que lo haga, pero el teléfono que queda afuera no sabe por qué: le sale «Sesión inválida o expirada», igual que en H19. De paso quedó probado: funciona. | Observación | Ronda 2, caso 5 |
| H25 | Pedir confirmación al tocar **Salir** (cerrar sesión), como ya la pide SALIR DE RUTA. | Pedido | Ronda 3, paso 1.8 |
| H26 | Tocar **Perfil** no da ninguna señal de que se tocó: el probador no sabe si la app está lenta o si el táctil no tomó el dedo. | Pedido | Ronda 3, paso 1.8 |
| H27 | Después de deslizar **SALIR A RUTA**, si sale la confirmación del relevo y se toca **Cancelar**, el botón se queda al final, en «IR». Vuelve al tocarlo. Antes no se notaba porque la pantalla cambiaba enseguida a la ruta. | Falla menor | Ronda 3, paso 6.5 |
| H28 | El mismo chofer con **dos sesiones abiertas** (H15) también hace que cerrar sesión no baje su combi: el servidor no la toca mientras quede otra sesión, por si el otro teléfono es el que maneja. En la ronda 3 eso hizo fallar el 3.3 y el 3.4. | Observación | Ronda 3, pasos 3.3 y 3.4 |
| H19 | Cuando la sesión se cierra desde otro teléfono, el aviso del ingreso no es «Tu sesión ya no vale: entra de nuevo». Sale **«Sesión inválida o expirada»** con la app cerrada y **«Sesión cerrada»** con la app en ruta. Son los textos que manda el servidor; el de la app solo sale por otro camino. Funciona, pero el chofer lee tres textos distintos para lo mismo. | Observación | Ronda 2, pasos 5.8 y 5.12 |
| H20 | En el paso 3.3 de la segunda ronda, lo mismo falló una vez y anduvo la siguiente: el arreglo de H11 y H12, sea cual sea, tiene que cubrir un caso que **no pasa siempre**. | Observación | Ronda 2, paso 3.3 |
| H21 | En «la maneja …» de la lista de combis, el **nombre del chofer en negrita**. | Pedido | Ronda 2, paso 6.2 |
| H22 | El radio en el que una combi cuenta como **en el paradero inicial** debe ser de **20 m**: «después de eso, ya no están ahí. 50 metros es mucho, 300 metros es demasiado». Lo que hoy decide si una combi está «en el recorrido» es el umbral de desvío de la ruta: 300 m si no se cambia, y Despacho no deja bajarlo de 50 m. **Cambiado el 20/11**, a pedido del probador: entrar a la ruta ya no usa el umbral del desvío sino un radio propio de **20 m** (`ENTRADA_M` en el servidor). El aviso de desvío sigue en 300 m, que es lo que el manual le promete al chofer. Falta publicarlo y probarlo en la calle con el caso 1. | Pedido, **hecho en el código** | Ronda 2, observaciones generales |
| H23 | El SOS del chofer **relevado** sale con la combi que ya no maneja: «EL GORDO · M11111 pide ayuda», y Despacho pinta en rojo la tarjeta y el punto de la M11111, que en ese momento lleva Karma. Hay que decidir si el SOS de un relevado nombra la combi y qué posición usa. | Observación (de la captura) | Ronda 2, pasos 6.9 y 6.10 |

### Cómo quedan los hallazgos de la primera ronda después de la segunda

| # | Cómo queda |
|---|---|
| H11 | **Se repite, pero no siempre**: una vez de dos (paso 3.3). Al volver a entrar ya no arrastra el SIN SEÑAL (pasos 3.4 y 3.5 OK). |
| H12 | **Confirmado y aclarado**: el AUSENTE cortado por el cierre de sesión sí se aplica, y se ve **en Despacho**, sin haber vuelto a entrar. Una vez de dos. |
| H14 | Sigue siendo de diseño. Con la planilla diciendo dónde está, el botón se encontró y funcionó (pasos 5.4 a 5.8). |
| H15 | Sin repetir. |
| H16 | Con B habilitado en **dos** combis, el relevo funciona completo: confirmación, aviso al relevado y un solo teléfono mandando (pasos 6.2 a 6.10). Con **una sola** combi **se repitió** (paso 6.13, 7:31): A la tomó sin confirmación. Ahora hay registro: la Actividad lo anota como «tomó la combi que manejaba», así que el servidor sabía que el otro estaba manejando y aun así no se le preguntó nada al chofer. **Confirmado; es lo próximo a arreglar del relevo.** |
| H17 | Con el relevo hecho por la lista, Despacho muestra la combi con el chofer nuevo y un solo punto (paso 6.10). |

## Por aclarar con el probador

- De la primera ronda sigue sin respuesta: en el caso 6, el texto exacto de la
  notificación en el teléfono de A cuando otro chofer tomó su combi **sin**
  pasar por la lista («tu sesión siguió en otro dispositivo…»).

Ya aclarado en la segunda ronda: dónde aparece el AUSENTE de H12 (en
Despacho), con qué botón se cierra la sesión en el caso 4 (con **Salir**,
pasos 4.2 a 4.4 OK), de qué paso era la nota del 4.2 (del 4.3), qué aviso
sale en el 2.2 (primero el de Android, después el de la app), por qué falló
el 6.13 (la Actividad: A tomó la combi antes del paso 6.12), que el cambio de
contraseña de las 7:14 fue a propósito y que la M-00 se la habilitó el
probador.

## Arreglado el 20/11, sin probar todavía en teléfono

Todo esto se comprueba con `PRUEBAS-TELEFONO-RONDA-3.md`. Es JavaScript de la
app y código del servidor: llega con `publicar-arreglo.bat` y el despliegue,
sin APK nueva. Bloques 33 y 34 de CAMBIOS-PARA-REVISAR.md.

| # | Qué se hizo | Seguro de la causa |
|---|---|---|
| H16 (y H18) | Deslizar SALIR A RUTA en la combi de hoy mientras otro la maneja pide confirmar el relevo, con una combi o con varias. Con una sola, la puerta dice «X: la maneja …». En la APK y en la web del chofer. | Sí: el código sólo preguntaba al tocar **otra** combi en la lista. |
| H11 y H12 (y H20) | La app para el GPS **antes** de declarar «fuera» (al salir de ruta y al cerrar sesión). Y el servidor baja la combi al cerrarse la última sesión de su chofer. | Sí: reproducido en un servidor local, un lote tomado después del «fuera» la devolvía al mapa como AUSENTE. |
| H8 y H9 | Si Android da el GPS por corriendo y en un minuto no llega ninguna lectura con la app adelante, se para y se arranca de nuevo. | **No.** Es la causa más probable, pero no se pudo comprobar sin el teléfono. La ronda 3 pide la captura de Perfil si vuelve a pasar. |
| H19 y H24 | Un solo texto cuando la sesión dejó de valer: «Tu sesión ya no vale: entra de nuevo». | Sí. |
| H21 | El nombre del que maneja, más fuerte en la lista (APK y web). | — |
| H22 | El radio de entrada a la ruta, 20 m (bloque 33). | — |

**Sin tocar, a propósito:**
- H1, H3 y H4 (la pantalla de arranque, el logo y el nombre de la app): son
  nativos, piden APK nueva. Conviene juntarlos con lo que salga de la ronda 3.
- H23 (el SOS del chofer relevado nombra la combi que ya no maneja): hay que
  decidir qué debe decir antes de cambiarlo.
- H5 (Despacho no puede escribirle al chofer que está en la puerta), H15 (dos
  sesiones del mismo chofer a la vez) y H17 (Despacho no muestra la doble
  conexión): quedan para la próxima tanda.
- H14 (el botón CERRAR TODAS MIS SESIONES se encuentra mal), H6 y H13: son de
  diseño o pedidos nuevos.

### Cómo quedaron en la ronda 3

| # | Cómo quedó |
|---|---|
| H16 y H18 | **Arreglado y comprobado** (caso 6 entero). |
| H11, H12 y H20 | **Arreglado y comprobado** (3.5 y 3.6). Las fallas del 3.3 y el 3.4 fueron por la sesión de A abierta en T2 (H28). |
| H19 y H24 | **Arreglado y comprobado** (5.6 y 5.7). |
| H21 | Comprobado (6.3 y 6.9). |
| H22 | **Comprobado**: el caso 1 salió entero por primera vez. |
| H8 y H9 | **No se arregló.** El rearranque del GPS mudo no alcanzó. El diagnóstico del 2.5 dice «corriendo» con nada enviado desde hace 412 s: el servicio está anotado como corriendo, pero no da posiciones. Dos caminos del código dejan pasar ese estado sin rearrancar nada: `arrancar` vuelve enseguida si Android dice que el servicio corre, y el rearranque del vigilante sigue de largo si parar falla. Es una hipótesis, no está comprobada. Lo que sí está comprobado es lo que lo arregla: que Android mate el proceso de la app (salir y dejar la pantalla apagada un minuto). Salir de la cuenta y volver a entrar no alcanza. |

## Arreglado el 24/11, sin probar todavía en teléfono

Se comprueba con `informes/pruebas-telefono-ronda4.pdf`. Bloque 35 de
CAMBIOS-PARA-REVISAR.md. Es JavaScript de la app: llega con
`publicar-arreglo.bat`.

| # | Qué se hizo | Seguro de la causa |
|---|---|---|
| H8 y H9 | El GPS mudo se rearranca **a la fuerza** (sin preguntarle a Android si ya corre), la fila de arrancar y parar tiene un plazo de 20 s, y Perfil muestra las lecturas que entrega Android, los rearranques y el último error. Si sigue mudo, la app le dice al chofer que cierre la app y apague la pantalla un minuto. | **No.** Ataca las dos explicaciones que encajan con lo visto. La captura de Perfil de la ronda 4 dirá cuál era. |
| H25 | Salir pide dos toques («¿SALIR?»). | — |
| H26 | Perfil y Salir con margen para el dedo y más claros al apretarlos. | Probable: Perfil ya se abría al instante, lo que fallaba era acertarle a la palabra. |
| H27 | El botón para salir a ruta vuelve solo al inicio un segundo después de disparar. | Sí. |

## Lo que falta

- **Captura de la ronda 3:** la del paso 6.8 (Despacho: el mapa y la
  Actividad). Opcional: el paso salió OK sin ella.
- **Ronda 4** (`informes/pruebas-telefono-ronda4.pdf`): el caso 2 con
  capturas de Perfil, y H25, H26 y H27.
- **Sin tocar desde antes:** H1, H3 y H4 (piden APK nueva), H5, H15, H17 y
  H23 (decidir qué dice el SOS del chofer relevado).
- **Opcional:** a cuántos metros de la calle cambió T2 en el paso 1.4.
