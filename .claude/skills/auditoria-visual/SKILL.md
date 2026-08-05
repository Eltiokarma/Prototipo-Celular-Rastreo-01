---
name: auditoria-visual
description: Auditoría visual completa de las pantallas de COOP-R14 contra sus invariantes de diseño. Invocar explícitamente con /auditoria-visual, o cuando se pida auditar, revisar o verificar el diseño, el contraste, la accesibilidad o los temas de las pantallas antes de un release o después de un rediseño.
---

# Auditoría visual — COOP-R14

Corre la parte medible por script y después chequea a mano lo que un script
no puede ver. El resultado es un informe con dos secciones separadas — y esa
separación es la parte importante: una auditoría que mezcla «esto rompe una
invariante» con «a mí me gustaría otro gris» se vuelve ruido y se ignora.

Las invariantes completas están en el skill `diseno-coop`; cargalo si no lo
tenés presente.

## 1. Lo medible (script)

```bash
node pruebas/contraste.js
cd pruebas && npm run sintaxis
```

`contraste.js` cubre: pares WCAG por tema y pantalla, `sun` ≥ `day`, `day` de
fábrica, huecos en paletas, `#FF2D55` reservado, y que el `:root` del creador
coincida con `day` de despacho. Si está rojo, eso encabeza el informe y no
hace falta seguir hasta explicarlo.

## 2. Lo que el script no ve (a mano, uno por uno)

Sobre `project/Prototipo.html`, `project/despacho.html` y
`server/creador.html`:

1. **Los cuatro avisos de seguridad existen y no se suavizaron.** Buscar y
   verificar que ninguno quedó dentro de un `setTimeout` que lo borre, detrás
   de un ícono, ni condicionado a un estado que casi nunca se da:
   - despacho: «trazado que no es el que se está midiendo» y «FUERA DE RUTA»;
   - creador: «mismo disco que la aplicación» y «entra solo con clave».
2. **Las dos confirmaciones nombran sobre qué:** suspender cooperativa (el
   nombre de cuál), cambiar el trazado que se mide (que descarta las vueltas
   en curso). Un `confirm()` genérico o un modal que no dice el objeto es
   falla.
3. **El SOS sigue siendo slider** (deslizar, no tap) y usa el rojo reservado.
4. **Ninguna acción cruzó de panel** contra la tabla de `PROMPT-DISENO.md`
   §4 (estructura = creador, operación = Despacho).
5. **Literales de color esquivando los tokens:** grep de `#[0-9a-fA-F]{6}`
   dentro de los bloques JSX, fuera de las definiciones de `TEMAS`/`:root`.
   Un color hardcodeado en un `style={}` no cambia con el tema: en night
   queda un parche claro. (Excepciones legítimas: sombras/transparencias
   documentadas en el propio estilo.)
6. **La lista de externos no creció.** Permitidos hoy: React 18.3.1, Babel
   7.29.0, Leaflet 1.9.4, Google Fonts, tiles de Carto. Cualquier URL nueva
   en un `<script>`/`<link>` es falla — datos móviles caros y caché offline.
7. **`CACHE_NAME`** (`project/service-worker.js:9`): si el diff toca
   `project/`, tiene que venir subido.
8. **El creador sigue sobrio:** sin marca, sin gradientes, sin «recordarme»,
   sin guardar nada en el navegador.

## 3. El informe

```
## Rompe una invariante
(cada una: qué regla, dónde —archivo:línea—, y qué habría que hacer)

## Observaciones estéticas
(mejorables sin romper nada; son opinión y se marcan como tal)

## Verificación
(salida resumida de contraste.js y sintaxis: verde/rojo)
```

Si no hay nada en la primera sección, decirlo explícitamente: «ninguna
invariante rota» es el resultado más valioso que puede dar esta auditoría.
No arreglar nada de motu propio durante la auditoría: primero el informe,
los arreglos son otra tarea.
