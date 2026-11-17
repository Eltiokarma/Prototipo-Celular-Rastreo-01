# Fuente del flyer de Micros Tempo

El flyer se genera con código (Node). VectorCraft recibe el resultado con el
texto en curvas, así que **los cambios de texto se hacen aquí**, no en VectorCraft.

- `codigo/front.js` → cara 01 (frente). `codigo/back.js` → cara 02 (dorso).
- `codigo/combi.js` → la combi (Urvan con pintado Micros Tempo) y el reloj del logo.
- `codigo/card.js` → la tarjeta de presentación (ver `tarjeta/LEEME.md`).
- `codigo/lib.js` → semilla, ruido, filtros, medición de texto.
- `svg-texto-vivo/` → los SVG con texto editable (necesitan Poppins y Archivo instaladas).
- `piezas/` → la combi, el reloj y el logotipo sueltos.
- `vectorcraft/` → los fuentes de VectorCraft de la versión impresa: frente v17 y dorso v14.
- `codigo/fonts/` → Poppins y Archivo (licencia SIL OFL, libres).

## Regenerar
    cd codigo
    npm install
    node front.js 11     # escribe out/frente-11.svg (semilla 11)
    node back.js 4       # escribe out/dorso-4.svg (semilla 4)
    node card.js         # tarjeta: out/tarjeta-frente.svg y out/tarjeta-dorso.svg
    node render.js out/frente-11.svg 1440 frente.png

Luego en VectorCraft: importar el SVG con texto en curvas, al grupo `paisaje`
aplicar Underpainting (sandstone, relieve 2, luz arriba-derecha) y agregar las
cinco nubes (elipses blancas con Roughen 3–4 % y Gaussian Blur 3–4).
