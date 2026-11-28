# Resultados de las pruebas en teléfono — APK 0.3.1

Lo que se va viendo al seguir `PRUEBAS-TELEFONO.md` (primera ronda, 18/11),
`PRUEBAS-TELEFONO-RONDA-2.md` (segunda ronda, 20/11) e
`informes/pruebas-telefono-ronda3.pdf` (tercera ronda, 23/11) e
`informes/pruebas-telefono-ronda4.pdf` (cuarta ronda, 25/11) e
`informes/pruebas-telefono-ronda5.pdf` (quinta ronda, 26/11). **Solo se anota**: nada
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

# Cuarta ronda — 25/11/2026

Sigue `informes/pruebas-telefono-ronda4.pdf`. La app tenía el arreglo
publicado el 25/11 a las 06:55 (Perfil → LA APP). La cabecera del formulario
quedó en blanco; por las capturas, se probó en T1 (Poco X7) con El Gordo, en
la M11111, entre las 20:28 y las 20:53. **T1 estaba con 9 a 10 % de
batería**: Despacho mostraba «SE ESTÁ POR APAGAR: QUE LO ENCHUFE».

- **Capturas:** de T1, 8:28 p. m. (paso 7.3), 8:38 (Perfil sano, antes de
  quitar las notificaciones: sirve como la del 2.2), 8:42 (2.4), 8:43 y
  8:44 (2.6), 8:45 (2.7) y 8:53 (2.8); de Despacho, 20:42 (2.5), en el
  documento de Drive.
- De 23 pasos: 17 OK y 6 NO SE PUDO (2.5, 2.8, 2.9, 2.10 y, de hecho, todo
  lo que dependía de que el GPS volviera).

## Caso 7, Salir y Perfil; caso 6, el botón después de Cancelar

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 7.1 a 7.5 | OK | Perfil responde al primer toque; Salir pide dos toques («¿SALIR?», y vuelve solo a los 5 s). «Sale, demora unos milisegundos, pero va.» H25 y H26 comprobados. |
| 7.3 | OK | Captura 8:28: «Servicio de GPS: sin arrancar · Lecturas del GPS 0 · todavía ninguna · sin sesión guardada ×3». Pedido: el «Cerrar» de Perfil tiene que responder al toque igual que Perfil (H31). |
| 7.1 | OK | Pedido de diseño: una imagen animada en la puerta para salir a ruta, «algo así como picar el reloj del poste» (H30). |
| 6.1 a 6.3 | OK | El botón **IR** vuelve solo al inicio después de Cancelar. H27 comprobado. |
| 6.4 | OK, con una nota | «Cuando empecé a hacer las pruebas del caso 2, salió T1 con Chofer A sin señal. Tuve que salir de la cuenta y luego salir deslizando hacia arriba la app, si no, en Despacho no aparecía chofer A en T1.» Sin captura de Perfil de ese momento; por lo que arregló el problema (que el proceso de la app muriera), es probable que sea la misma causa que H8 y H9. |
| P.2 | OK, con una nota | «La casilla de contraseña permite espacios y cuando pongo el botón de ver se activa el teclado con diccionario y recuerda palabras.» Ver H29. |

## Caso 2. Las notificaciones quitadas en ruta: **la causa, a la vista**

| Paso | Resultado | Lo que se vio |
|---|---|---|
| 2.1 a 2.3 | OK | 8:38: «Servicio de GPS: corriendo · Lecturas del GPS 5 · última hace 1s · GPS enviadas 5». Notificaciones apagadas a las 8:40 p. m. |
| 2.4 | OK | La app volvió a la ruta sin pasar por la puerta. |
| 2.5 | **NO SE PUDO** (es una falla) | Despacho, 20:42: la M11111 «Sin señal desde 20:40». |
| 2.6 | OK | Capturas 8:42 a 8:44: «Servicio de GPS: corriendo · Lecturas del GPS 4 · última hace 77s… 200s · 1 repetidas · rearrancado 1 vez… 2 veces», y en rojo: **«Error del servicio: Call to function 'ExpoLocation.startLocationUpdatesAsync' has been rejected. → Caused by: Couldn't start the foreground service. Foreground service cannot be started when the application is in the background»**. |
| 2.7 | OK | 8:45: sale el aviso «El GPS no está dando tu ubicación. Cierra la app desde recientes…». |
| 2.8 | NO SE PUDO | «Creo que debí salir completamente de la app, así sí funcionaba.» 8:53: el mismo error, «rearrancado 2 veces», última lectura hace 735 s, y arriba «Tu sesión siguió en otro dispositivo o pestaña; esta dejó de reportar el GPS» (ver H32). |
| 2.9 y 2.10 | NO SE PUDO | La bandeja mostraba «Hace 2 min, tu GPS dejó de funcionar. Estás en ruta y hace 10 minutos que el GPS no lee tu ubicación…» y «Modo acompañante: tu GPS no se usa». Al salir, la combi se fue de Despacho bien. |

**La causa.** El mensaje es de expo-location (`LocationModule.kt`, versión
19.0.8). Sólo deja arrancar el GPS con la notificación fija si una marca suya,
`AppForegroundedSingleton.isForegrounded`, dice que la app está al frente. La
marca nace apagada y sólo se prende cuando la pantalla de la app «vuelve al
frente». Después de que Android mata la app al quitarle un permiso, al
reabrirla la marca puede quedar apagada aunque el chofer la esté mirando, y
cada arranque se rechaza, rearranques incluidos, hasta que la app pase de
verdad por atrás y vuelva o el proceso muera. Encaja con las cuatro rondas:
salir de la cuenta no lo arreglaba y cerrar la app con la pantalla apagada sí.
Arreglo en el bloque 36.

---

# Quinta ronda — 26/11/2026

Sigue `informes/pruebas-telefono-ronda5.pdf`. Solo T1 (Poco X7), con El Gordo,
de 7:20 a 7:27 p. m., con 53 % de batería y cargando. La app tenía el arreglo
publicado el 26/11 a las 07:14 (Perfil → LA APP).

| Paso | Resultado | Lo que se vio |
|---|---|---|
| P.1 a P.5 | OK | |
| 8.1, 8.2 y 8.4 | OK | El Cerrar de Perfil responde al toque (H31). |
| 8.3 | **FALLA** | Con VER, «el teclado sigue mostrando palabras sugeridas»: pedirle a Android el teclado de clave a la vista no alcanzó con el teclado de Xiaomi (H29). |
| 2.1 a 2.4 | OK | 7:20, antes de quitar las notificaciones: «Lecturas del GPS 7 · última hace 2s · GPS enviadas 6». Notificaciones apagadas a las 7:20-7:21; la app volvió a la ruta sin pasar por la puerta, y el permiso se aceptó. |
| 2.5 | **FALLA** | «Despacho pasó más de 120 segundos sin recibir señal. Cuando salí de la app a Yape, creo que Despacho dejó de recibir cualquier cosa.» |
| 2.6 y 2.7 | **FALLA** | 7:26 y 7:27: «Servicio de GPS: corriendo · Lecturas del GPS 4 · última hace 298s… 348s · 1 repetidas · **rearrancado 2 veces** · GPS enviadas 2 · 1 no usadas». **Sin ninguna línea de error ni de aviso**, y arriba de la ruta ningún aviso. |
| 2.8 a 2.11 | NO SE PUDO | «Siempre estuvo sin señal.» |

Observación del probador: «Repetimos el mismo error. Creo que no haremos más
pruebas escritas, cazaremos esos errores de forma más rápida. Ya no usamos dos
teléfonos.»

**Qué dice esto de H8 y H9.** El arranque de respaldo no alcanzó. Esta vez
ningún arranque dio error: los dos rearranques terminaron bien (el primero
seguramente sin la notificación fija y el segundo, al volver de Yape, con
ella, que borra el aviso; por eso no queda ninguna línea en ámbar). Aun así,
después de las cuatro primeras lecturas no llegó ninguna más. O sea que en ese
proceso Android acepta el pedido de ubicación y no entrega posiciones a la
app, o las entrega a otra parte. Sigue siendo cierto que lo único que lo cura
es que el proceso muera. Sin ver lo que hace Android por dentro (`adb shell
dumpsys location` y `adb logcat`), los arreglos desde JavaScript son a ciegas.

## Con adb, 26/11 a las 21:12: dónde se pierden las posiciones

El probador conectó T1 a la PC y, con la app en SIN SEÑAL después de quitar
las notificaciones, sacó `dumpsys location`, `dumpsys activity services` y 18 s
de `logcat`.

- **El GPS del teléfono anda.** `dumpsys location`: el proveedor «gps» está
  prendido para `com.microstempo.chofer` (a través del fused provider de Google)
  desde 50 s antes, con una posición cada 2 s y 2 m de precisión.
- **El proceso de la app es nuevo** (creado 49 s antes de la captura) y **no
  tiene el servicio con la notificación fija**: solo corre `TaskJobService` de
  Expo.
- **Las posiciones llegan a Expo y nadie las procesa.** En el `logcat`, el
  `TaskService` de Expo dice «Handling intent» y «Handling job» para la tarea
  `coop-r14-gps` cada 2 s, y **nunca** «Finished task». Ningún JavaScript las
  toma.

**El mecanismo**, leído en `expo-task-manager` 14.0.9 (`TaskService.java`):
- **La copia sin pantalla:** cuando llega una posición y no hay ningún
  JavaScript anotado para la tarea, Expo arranca una copia «sin pantalla» del
  JavaScript (`HeadlessAppLoader`).
- **La tabla equivocada:** si el JavaScript de la pantalla se anota mientras esa
  copia corre, `setTaskManager` lo guarda en la tabla de las copias sin
  pantalla.
- **El borrado:** cuando la copia termina sus eventos, `invalidateAppRecord`
  borra esa tabla, y con ella la anotación de la pantalla.
- **Por qué no se recupera:** la pantalla solo se anota al crearse su
  JavaScript (`onCreate`), así que desde ahí no recibe nada.

Encaja con las cinco rondas: algunas lecturas al principio (4, en la cuarta y
la quinta) y después ninguna. Rearrancar el GPS no lo arregla; matar el proceso
sí, porque crea un JavaScript nuevo.

## Con adb, 26/11 a las 22:33: la recarga del JavaScript, probada

Con la recarga del bloque 37 publicada. T1 (Poco, El Gordo) conectado a la PC,
y además el Redmi con Karma.

- **T1, logcat:**

  | Hora | Qué pasó |
  |---|---|
  | 22:33 a 22:37 | Expo recibe posiciones cada 3 s («Handling job») y ninguna llega al JavaScript (cero «[gps] tarea», cero «Finished task»). |
  | 22:35:30 | «[gps] mudo: se rearranca». |
  | 22:37:31 | «[gps] se recarga el JavaScript» y «Running "main"». |
  | 22:37:32 | El JavaScript nuevo recibe de golpe la cola acumulada: 63 eventos con 1893 posiciones, casi todas repetidas. |
  | Desde las 22:37:34 | Otra vez nada; a las 22:38:36, «[gps] mudo». |

  La recarga anota al JavaScript nuevo, pero cae en la misma trampa y a los
  2 s Expo lo vuelve a borrar. Foto de Perfil: «Lecturas del GPS 1893 · 1830
  repetidas · rearrancado 1 vez · GPS enviadas 14 · 49 no usadas».
- **Redmi, Karma:** «Servicio de GPS: caído, rearrancando», y en rojo:
  «startLocationUpdatesAsync has been rejected → NullPointerException: Attempt
  to invoke interface method 'java.util.Map
  android.content.SharedPreferences.getAll()' on a null object reference». El
  GPS de B no arranca. **Causa**, en `expo-task-manager` 14.0.9: el servicio de
  tareas es un singleton por proceso (`TaskManagerPackage.mTaskService`) que
  guarda una referencia débil al contexto del primer JavaScript. Después de
  una recarga (la del GPS mudo, o la que aplica un arreglo publicado con la
  app abierta), ese contexto muere y registrar la tarea revienta hasta que el
  proceso muera.

**Conclusión:** desde JavaScript no hay arreglo para H8 y H9, y recargar hace
daño. Bloque 38: se saca la recarga del GPS y la app deja de aplicar los
arreglos recargándose (se aplican en el próximo arranque en frío). El arreglo
de fondo es un parche nativo a `expo-task-manager`, en una APK nueva.

---

## Con adb, 27/11 a las 06:20: la APK 0.3.2, con el parche

Redmi 15C, chofer A (M11111), APK 0.3.2 (Despacho: «APP 0.3.2»). En ruta, se
quitan las notificaciones y se vuelve a la app.

- **Perfil:** 7 lecturas, la última hace 103 s, rearrancado 1 vez. Mudo.
- **Logcat:** el mismo error que antes del parche, al segundo. El proceso
  nuevo recibe cuatro tandas (06:22:40 y 06:22:42); a los 2 s de vaciarse la
  cola Expo borra la «app sin pantalla» y desde las 06:22:44 ninguna posición
  llega al JavaScript, aunque Expo las sigue recibiendo cada 2 o 3 s. El
  rearranque de las 06:23:47 registra la tarea sin error y no cambia nada.

**Causa:** el parche no estaba en la APK. Expo 54 enlaza `expo-task-manager`
ya compilado (un `.aar` que viene en el paquete) y no el código parchado de
`node_modules`. Bloque 40: se compila desde la fuente, en la APK 0.3.3, y el
parche deja «COOP-R14 parche activo» en el logcat para comprobarlo.

---

## Con adb, 27/11 a las 08:33: la APK 0.3.3, el GPS ya no queda mudo

Redmi 15C, la APK nueva instalada a las 08:33. En ruta, se quitan las
notificaciones.

| Hora | Qué pasó |
|---|---|
| 08:37:55 | Android mata la app (PermissionHelper), como siempre. |
| 08:38:00 | Proceso nuevo. |
| 08:39 a 08:50 | «[gps] tarea» sin cortes: 20 por minuto (una cada 3 s), 221 «Finished task», ningún «COOP-R14: sin TaskManager». Con la 0.3.2, en el mismo paso, dejaban de llegar a los 7 s del relanzamiento. |

El logcat guardado empieza a las 08:38:58 (el teléfono descarta lo más
viejo), así que no alcanza a mostrar «COOP-R14 parche activo», que se escribe
en los primeros segundos después de abrir. Lo demuestra el comportamiento.
Para verlo escrito: cerrar la app desde recientes, abrirla y correr en
seguida `adb logcat -d | findstr COOP-R14`.

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
| H29 | Con **VER** prendido, el campo de contraseña usa el teclado normal: sugiere palabras y **aprende la clave**. Además acepta espacios. | Falla (seguridad) | Ronda 4, paso P.2 |
| H30 | Una imagen animada en la puerta para salir a ruta, como «picar el reloj del poste». El botón actual se ve muy plano. | Pedido de diseño | Ronda 4, paso 7.1 |
| H31 | El **Cerrar** de Perfil tiene que responder al toque como Perfil y Salir. | Pedido | Ronda 4, paso 7.3 |
| H32 | Con T2 fuera de la cuenta, T1 recibió «Tu sesión siguió en otro dispositivo o pestaña»: el servidor vio otro socket del mismo chofer. La app ya silencia su socket viejo al abrir uno nuevo, así que la causa no está clara. | Falla, causa por confirmar | Ronda 4, paso 2.8 |
| H33 | Bajar la cadencia del GPS a 10 s al apagar la pantalla **nunca funcionó**: expo-location rechaza el cambio porque la app ya está atrás, y el error se tragaba en silencio. El GPS sigue a 3 s con la pantalla apagada, que gasta más batería. **Arreglado el 27/11 en la APK 0.3.4** (bloque 42, parche a expo-location): falta comprobarlo con adb. | Falla (batería), **arreglada en el código** | Descubierto leyendo expo-location, ronda 4 |
| H34 | La app no pedía los permisos al entrar: ubicación, notificaciones y batería salían recién al deslizar SALIR A RUTA (en el Poco, los tres de golpe al arrancar; en el Redmi el probador fue a Ajustes a mano antes). El probador prefiere que se pidan apenas se entra, como en la mayoría de las apps. **Hecho el 27/11** (bloque 41) y **comprobado en el teléfono** el mismo día: con la app recién instalada y el arreglo aplicado, al entrar pidió ubicación, notificaciones y batería. Ojo: una APK recién instalada arranca con lo que trae adentro; el arreglo publicado recién vale después de bajarlo (un minuto en el ingreso) y de cerrar y abrir la app. | Pedido, **arreglado y comprobado** | APK 0.3.3, 27/11 |
| H35 | En el Redmi, Despacho lo mostró SIN SEÑAL un rato a las 08:41. El logcat: después de que Android relanzó la app (al quitar las notificaciones), el GPS andaba **sin la notificación fija** (bloque 36); el probador tocó Inicio a las 08:40:42 y Android cortó las posiciones 60 s, hasta que volvió a la app a las 08:41:40. Al volver, la app arrancó la notificación fija y el GPS siguió en segundo plano sin cortes hasta las 08:50. Es lo que el aviso «Toca el botón de inicio de Android y vuelve a abrir la app» resuelve. Coincidió con la desinstalación del Poco, pero no tiene que ver. **Causa y arreglo en la APK 0.3.4** (bloque 42): la tarea restaurada al relanzar corría sin la notificación fija porque expo-location creía que la app estaba atrás; ahora le pregunta a Android, y la app pide la notificación aunque la tarea ya corra. | Falla, **arreglada en el código** | APK 0.3.3, 27/11 |
| H36 | Al desinstalar la app del Poco con el chofer en ruta, Despacho siguió mostrando su combi SIN SEÑAL hasta que la app nueva entró. Es a propósito: el servidor no distingue un teléfono desinstalado de una combi en una zona sin señal, y esa combi no se le puede perder a Despacho. Se retira al salir de ruta, cerrar sesión o entrar de nuevo. | Observación (así está diseñado) | APK 0.3.3, 27/11 |
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

## Arreglado el 26/11, sin probar todavía en teléfono

Bloque 36 de CAMBIOS-PARA-REVISAR.md. Es JavaScript de la app: llega con
`publicar-arreglo.bat`.

| # | Qué se hizo | Seguro de la causa |
|---|---|---|
| H8 y H9 | Si expo-location rechaza arrancar con la notificación fija «porque la app está atrás», el GPS arranca **sin** ella: da posiciones mientras la app está en pantalla. Al primer «vuelta al frente» se rearranca con la notificación. Mientras tanto, la app le dice al chofer: «Tu GPS anda, pero se va a cortar cuando apagues la pantalla. Toca el botón de inicio de Android y vuelve a abrir la app para que quede fijo». | **Sí**: el mensaje de Perfil y el código de expo-location coinciden. Falta comprobar en el teléfono que el arranque sin notificación sí da posiciones. |
| H29 | Con VER, el teclado de contraseña a la vista, sin sugerencias ni diccionario. Los espacios se siguen aceptando. | Sí. |
| H31 | El Cerrar de Perfil, con margen y respuesta al apretar. | — |
| H33 | El cambio de cadencia rechazado ya no se anota como error del servicio. **Bajar a 10 s con la pantalla apagada sigue sin funcionar**: hay que hacerlo antes de que la app pase atrás, o con otro mecanismo. | Sí (la causa); el ahorro, pendiente. |

## Lo que falta

- **H8 y H9:** la causa está vista con adb y es de `expo-task-manager`. La
  recarga del bloque 37 no sirvió e hizo daño; el bloque 38 la saca. El
  parche de la APK 0.3.2 (bloque 39) no llegó a compilarse: la 0.3.2 siguió
  muda (27/11). Con la 0.3.3 (bloque 40), compilado desde la fuente, el GPS
  sigue dando posiciones después de quitar las notificaciones (adb, 27/11,
  08:38 a 08:50). Falta: verlo en Despacho y con la pantalla apagada.
- **H29:** con VER, el campo ahora sigue siendo de contraseña y lo escrito se
  muestra en una línea aparte (en la rama, sin publicar).
- **H32** (el aviso de «otro dispositivo»).
- **H33** (la cadencia con la pantalla apagada): arreglado en la APK 0.3.4
  (bloque 42). Falta compilarla y ver con adb «[gps] cadencia 10000 ms» al
  apagar la pantalla.
- **H30** (la imagen animada de la puerta): pedido de diseño, para decidir.
- **Despacho:** `paneles` falla en `main` desde el #83 (C3, texto bajo 12 px,
  y N4, borrar un tramo).
