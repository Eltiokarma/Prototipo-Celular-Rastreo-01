# Plan financiero

Esta carpeta guarda el Plan del Primer Año de COOP-R14, versión alfa, y el simulador que permite corregirlo con los datos que vayan llegando del mercado. Los dos usan el mismo modelo, así que un número del PDF y el mismo número en el simulador siempre coinciden.

| Archivo | Qué es |
| --- | --- |
| `plan-primer-anio-alfa.pdf` | El plan, con el resumen ejecutivo, las funciones del equipo, los estados de resultados de cada mes, el flujo de caja y el análisis de sensibilidad. |
| `simulador.html` | El simulador. Se abre con doble clic en cualquier navegador y no necesita internet. |
| `modelo/modelo.js` | El modelo financiero. Todo supuesto que cambia el resultado está en `SUPUESTOS`. |
| `modelo/modelo.test.js` | Las pruebas que fijan los números del plan alfa. |
| `generar-plan.js` | Rehace el HTML y el PDF del plan a partir del modelo. |
| `generar-simulador.js` | Mete el modelo dentro de `simulador.src.html` y produce `simulador.html`. |

## Cómo se rehace

Si cambia un supuesto del plan, se cambia en `modelo/modelo.js` y se corren estos tres comandos desde la raíz del repositorio. La prueba va a fallar a propósito, porque los números del plan alfa cambiaron: se actualiza la prueba solo si el cambio es la nueva versión del plan.

```bash
node --test plan-financiero/modelo/modelo.test.js
```

```bash
node plan-financiero/generar-plan.js
```

```bash
node plan-financiero/generar-simulador.js
```

El PDF se imprime con el Chromium de Playwright y usa las fuentes Inter e Inter Display, que tienen que estar instaladas en la máquina.

## Cómo se usa el simulador

Cada control de la izquierda es un supuesto del plan, y al moverlo se recalculan al momento los indicadores, los gráficos y las tablas. La línea punteada y las cifras en gris muestran el plan alfa para comparar. La fila de rutas reales sirve para cargar cuántas rutas se firmaron de verdad cada mes: un mes con número reemplaza a la capacidad del equipo y el resto del año se recalcula desde ahí.

Los escenarios se guardan en el navegador de cada persona. Para compartir uno, se usa «Copiar escenario» y quien lo recibe lo pega con «Pegar escenario».

## Qué falta confirmar

Las cifras tributarias y laborales son de noviembre de 2026 y salen de memoria, así que el contador debe confirmarlas: la UIT de 2027 (tomada como S/ 5500), la remuneración mínima (S/ 1130), si el servicio entra en el sistema de detracciones, las condiciones del IGV Justo y cómo se declaran EsSalud y la Vida Ley de los medios tiempos.
