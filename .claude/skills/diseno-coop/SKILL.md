---
name: diseno-coop
description: Invariantes de diseño de las pantallas de COOP-R14. Cargar SIEMPRE antes de tocar project/Prototipo.html, project/despacho.html o server/creador.html, o cuando se hable de rediseñar, colores, temas, paleta, tipografía, layout, contraste o estética de la app del chofer o los paneles. Estas reglas parecen decisiones estéticas y no lo son; un cambio que las viole no queda feo, queda ROTO.
---

# Invariantes de diseño — COOP-R14

Este es el contrato para tocar cualquiera de las tres pantallas. Viene de
`PROMPT-DISENO.md` (el encargo original) más lo que está en el código y no en
el documento. Si algo de acá te parece mal, **escribilo en tu nota en vez de
cambiarlo**: la decisión es del dueño del producto.

## Las tres pantallas y su exigencia física

| Archivo | Quién | Dónde |
| --- | --- | --- |
| `project/Prototipo.html` | Chofer y cobrador | Celular al parabrisas, sol directo a 3800 m, se mira **de reojo y en movimiento** |
| `project/despacho.html` | Despacho | Escritorio, 8 horas seguidas |
| `server/creador.html` | Nosotros | Herramienta interna, sobria a propósito |

## Restricciones técnicas, y son firmes

- **Sin build.** React + Babel standalone inline en cada `.html`. Si tu cambio
  necesita compilar, no sirve.
- **Sin frameworks de CSS ni dependencias nuevas.** Los únicos externos
  permitidos: React 18.3.1, Babel standalone 7.29.0, Leaflet 1.9.4, Google
  Fonts (`Archivo Black` + `JetBrains Mono`), tiles de Carto. Cada archivo
  nuevo es costo real en datos móviles.
- **Trabajá por partes.** Los archivos miden 2600–3300 líneas; no se
  reescriben de cero.
- **Si tocás `project/`, subí `CACHE_NAME`** en `project/service-worker.js`
  (línea ~9) o los celulares siguen viendo lo viejo. Es un paso de salida
  obligatorio, no opcional.

## El sistema de tokens, como es de verdad

- `Prototipo.html` (~línea 207): `const TEMAS = { day, sun, night }`.
- `despacho.html` (~línea 71): `const TEMAS = { day, night }`.
- `creador.html` (~línea 22): **NO usa TEMAS** — variables CSS en `:root`, un
  solo tema claro, cuyos valores son una **copia a mano** de `day` de
  despacho. Si retocás una paleta, retocá la otra: la suite `contraste` las
  compara y falla si se separan.
- `HUD` **se muta** (`Object.assign`), no se reemplaza (`Prototipo.html:292`,
  `despacho.html:136`). Todo el archivo referencia `HUD.*` directo; cambiar
  eso a props rompe todo.
- El número héroe de brecha se dibuja con `color` en day/sun y con `ink`
  cuando `resplandor` es `true` (solo night). Medí el par que el código
  compone.
- Los componentes leen tokens, no colores literales. Si necesitás un color,
  agregalo como token en TODOS los temas del archivo.

## Lo que no se toca

1. **El tema día es el de fábrica** y `day` va primero en `TEMAS`. Un oscuro
   elegante es ilegible al mediodía en Juliaca. El night existe y está bien;
   no es el default.
2. **Nada de bajar contraste ni achicar la tipografía** de los números de
   brecha. Mejorá composición, no legibilidad. La vara ejecutable:
   `node pruebas/contraste.js` tiene que quedar verde después de tu cambio.
3. **`#FF2D55` está reservado** a emergencia y brecha crítica (rojo de
   `night`). No lo uses de decorativo en ningún rol ni pantalla.
4. **El SOS** sigue imposible de confundir y difícil de apretar sin querer.
   Hoy es un slider ("deslizá para SOS"): no lo conviertas en botón de un tap.
5. **Cuatro avisos son de seguridad, no ruido.** Se pueden rediseñar; no se
   pueden suavizar, esconder tras un ícono ni convertir en toast que
   desaparece solo:
   - «Estás dibujando un trazado que no es el que se está midiendo»
     (despacho, trazador, ~línea 767).
   - «La base está en el mismo disco que la aplicación» (creador, SISTEMA,
     ~línea 1513).
   - «Este panel entra solo con clave» (creador, SISTEMA).
   - «FUERA DE RUTA» (despacho, mapa, ~línea 3165).
6. **Dos confirmaciones nombran sobre qué**, y lo siguen haciendo: suspender
   una cooperativa (dice cuál) y cambiar el trazado con el que se mide una
   ruta (dice que descarta las vueltas en curso).
7. **Las acciones no cruzan de panel.** La estructura la define el creador;
   la operación del día es de Despacho. La tabla completa de permisos está en
   `PROMPT-DISENO.md` §4. Si algo parece estar en el panel equivocado,
   decilo, no lo muevas.
8. **El creador es sobrio a propósito** y no guarda nada en el navegador:
   nada de "recordarme", nada de marca, nada vendedor.

## Al terminar

- `node pruebas/contraste.js` — verde.
- `cd pruebas && npm run sintaxis` — los tres HTML compilan.
- `CACHE_NAME` subido si tocaste `project/`.
- Nota corta: qué cambiaste, por qué, y qué te pareció mal pero no tocaste.

Para una revisión completa contra esta lista: skill `auditoria-visual`.
