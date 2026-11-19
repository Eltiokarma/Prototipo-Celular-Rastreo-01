# Resultados de las pruebas en teléfono — APK 0.3.1

Lo que se va viendo al seguir `PRUEBAS-TELEFONO.md`. **Solo se anota**: nada
de esto se corrige hasta terminar los casos que faltan. Al cerrar, pasa a
CAMBIOS-PARA-REVISAR.md como un bloque.

## Teléfonos

| | Teléfono 1 (T1) | Teléfono 2 (T2) |
|---|---|---|
| Marca y modelo | Poco X7 | Xiaomi Redmi 15C |
| Android | 15 (compilación AP3A.240905.015.A2) | 15 (compilación AP3A.240905.015.A2) |
| Capa de la marca | HyperOS 2.0.208.0 | HyperOS 2.0.217.0 |
| `X-App-Version` en Despacho | 0.3.1 | 0.3.1 |
| Fecha de la prueba | 18/11/2026 | 18/11/2026 |

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

## Por aclarar con el probador

- Caso 2, primer paso: el texto exacto del aviso de permisos en la app.
- Caso 3, H12: ¿dónde se pone en AUSENTE al volver a entrar, en Despacho o en
  el teléfono? ¿Y sin haber tocado AUSENTE en esa entrada?
- Caso 4, segundo intento: ¿se salió con el botón **Salir** de la app (cerrar
  sesión) o quitándola de recientes?

## Lo que falta

- Caso 1: repetir «sale a ruta lejos del trazado» a varias cuadras, y anotar
  el último paso (quitar el modo avión).
- Casos 5 y 6.
