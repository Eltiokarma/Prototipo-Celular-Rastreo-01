# Editor manual de rutas de Despacho

El trazador permite corregir un recorrido sin volver a dibujarlo entero:

- **Editar puntos:** arrastrar mueve un punto; tocar la línea inserta uno entre sus vecinos. Tocar un punto solo lo selecciona. **Eliminar punto** lo borra explícitamente.
- **Agregar tramo:** elegir **Desde A · inicio** o **Desde B · final** y marcar el camino. Desde A, cada punto nuevo se antepone para conservar el sentido de conducción.
- **Redibujar un tramo:** seleccionar sus dos extremos, marcar el nuevo camino y pulsar **Aplicar tramo**. Se conservan los extremos y todo lo que hay fuera de ellos. Sin puntos nuevos, se unen con una recta. **Cancelar tramo** abandona solo ese borrador.
- **Deshacer / Rehacer:** recuperan movimientos, inserciones, eliminaciones, importaciones y tramos completos. Atajos: Ctrl/Cmd+Z, Ctrl/Cmd+Mayús+Z y Ctrl+Y. Mientras se dibuja un tramo, deshacer quita primero sus puntos provisionales.
- **Ver recorrido:** encuadra la dirección elegida. En rutas densas, acercar el mapa permite editar los puntos de esa zona.

Los cambios no llegan al servidor hasta guardar. Cerrar o cambiar de variante con modificaciones pide confirmación. Guardar el trazado activo conserva la confirmación existente que avisa que se descartan las vueltas en curso. Sin modificaciones, Guardar está deshabilitado.

## Pruebas

Desde `pruebas`, instalar sus dependencias de desarrollo (`npm ci`) y ejecutar:

```sh
npm run trazador-ui
```

Si no hay Chromium instalado para Playwright, indicar el ejecutable con `COOP_TEST_BROWSER`. `COOP_TEST_MODULES` admite directorios adicionales de `node_modules`, separados por el delimitador del sistema (`;` en Windows, `:` en Linux).

La prueba monta el JSX real de Despacho con React 18.3.1 y Leaflet. Usa una API simulada y bloquea las solicitudes externas: no accede a datos de producción. Comprueba geometría, historial, cargas y guardado, y adaptación móvil. Las dependencias React de esta carpeta son solo para las pruebas; el panel conserva sus librerías y despliegue sin compilación.

También ejecutar `node pruebas/trazador.js`, `node pruebas/contraste.js` y `npm run sintaxis` desde `pruebas` (las dos primeras desde la raíz).
