# Tarjeta de presentación — Micros Tempo

**v1, con datos de ejemplo.** El celular, el correo y el QR (a `wa.me/51951234567`)
son inventados: no imprimir hasta cambiarlos por los reales.

- `Tarjeta_Micros_Tempo_v1.pdf` → para imprenta: 2 páginas (frente y dorso),
  90 × 50 mm + 3 mm de sangrado por lado (96 × 56 mm), con TrimBox y BleedBox.
- `Tarjeta Micros Tempo v1 - vista previa.png` → las dos caras recortadas.
- `vectorcraft/` → los fuentes de VectorCraft (texto en curvas).
- `fuente/` → los SVG con texto editable.

## Cambiar los datos
Los datos están en el objeto `D`, al principio de `flyer/fuente/codigo/card.js`
(la tarjeta usa el logotipo y la combi del flyer, por eso vive con su código):

    cd flyer/fuente/codigo
    npm install
    node card.js

## Decisiones
- Frente: la marca (logotipo + «Minutos exactos entre combis») sobre navy.
  Dorso: la persona y el contacto, sobre el plomo-celeste #E6EDF3 del flyer.
- Firma: las franjas del pintado de la combi (navy, azul, celeste, amarillo)
  en diagonal, en las dos caras y en la combi del flyer.
- Contrastes medidos: navy sobre el fondo 13,65:1; cargo en #1668C4 4,66:1.
  El azul de marca #2580CF (3,51:1) y el verde (3,71:1) no se usan para texto chico.
- Texto mínimo 2,4 mm (≈ 7 pt). QR de 20,4 mm.
