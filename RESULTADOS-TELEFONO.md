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

## Lo que falta

- Caso 1: repetir «sale a ruta lejos del trazado» a varias cuadras, y anotar
  el último paso (quitar el modo avión).
- Casos 2, 3, 4, 5 y 6.
