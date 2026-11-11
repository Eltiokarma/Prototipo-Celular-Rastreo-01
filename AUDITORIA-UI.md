# Auditoría de UI: estilo, fluidez y calidez

**Fecha:** 11/11/2026 · **Alcance:** la web (Despacho, Gestión/Gerencia, login, creador, landing) y, de paso, la app del chofer.
**Qué es esto:** un diagnóstico de cómo está planteada la interfaz hoy. No trae código. Es el encargo para quien haga los retoques finales (Claude Design).
**Cómo se miró:** se levantó el servidor con datos sembrados (`pruebas/rediseno.js`, `gerencia-shot.js`, `chofer-shot.js`, `creador-ui-run.js`) y se recorrieron todas las secciones en tema día y noche, en escritorio (1440 px) y en celular (412 px).

> **Antes de tocar nada, leé `.claude/skills/diseno-coop/SKILL.md`.** Algunas cosas que acá parecen "frías" son decisiones de seguridad (contraste, tamaño de los números de brecha, rojo reservado, SOS deslizable, los avisos que no se pueden suavizar). La calidez tiene que salir de la **composición, el ritmo, el movimiento y el tono**, no de bajar contraste ni achicar números.

---

## 1. Diagnóstico general

La interfaz es **correcta, legible y honesta**, pero se siente como una **consola técnica**, no como una herramienta que acompaña a una persona durante un turno de 8 horas. La frialdad no viene de un solo error. Viene de cinco hábitos que se repiten en todas las pantallas:

| # | Hábito | Dónde se nota | Efecto |
|---|---|---|---|
| 1 | **Mayúsculas monoespaciadas con mucho tracking** en casi todos los rótulos (`UNIDADES EN RUTA`, `+1 ADELANTE`, `OPERACIÓN DEL DÍA`, `CORTES DE SEÑAL`, `NUNCA ENTRÓ`) | Despacho: `fontFamily: mono` aparece ~130 veces y `letterSpacing` 56 veces. Gestión y el creador, igual | Parece una terminal o una planilla de aduana. Todo "grita" en el mismo tono bajo y nada se siente conversado |
| 2 | **Cero iconografía** | `despacho.html` y `creador.html` no tienen ni un `<svg>`. Los únicos glifos son `☾`, `↪`, `↺`, `➤`, `◇` (Unicode) | El menú lateral, los botones y los estados se leen solo por texto. Es más lento de escanear y más impersonal |
| 3 | **Casi sin movimiento** | Despacho tiene **1** `transition` en 6100 líneas. El creador tiene 0. Las secciones, los modales, las tarjetas y el cambio de tema aparecen de golpe | Se siente "a saltos". Nada confirma visualmente lo que acabás de hacer |
| 4 | **Todo es una caja con borde de 1 px igual a la de al lado** | KPI de Números (13 cajas idénticas), filas de Personas, tarjetas de Rutas | No hay jerarquía: el 74 % de cumplimiento pesa lo mismo que "0 retornos" |
| 5 | **Textos explicativos largos y técnicos** como cierre de cada sección | Rutas ("vuelta promedio ÷ unidades en ruta…"), Personas, Empresa | Son buenos (explican el porqué), pero visualmente quedan como letra chica de contrato al pie |

Lo que **sí está bien** y conviene conservar: la paleta del tema día (limpia, con buen contraste), la tipografía `Archivo Black` para títulos y números héroe, el banner de SOS (inequívoco), el sistema de tokens `TEMAS`/`HUD`, y que cada sección diga en una línea para qué sirve.

---

## 2. Pantalla por pantalla

### 2.1 Login del panel (`project/despacho.html`, ~línea 498)

- **Defecto visible:** el fondo es `radial-gradient(… #0a1626 0%, ${HUD.bg} 70%)`. El `#0a1626` está fijo (es el azul noche) y el tema por defecto es **día**. Resultado: una **mancha oscura enorme** detrás de la tarjeta blanca, que parece un error de carga. Es lo primero que ve cualquiera que entra. Tiene que salir de un token por tema.
- La tarjeta es correcta pero anónima: "Panel de Despacho / CONTROL DE FLOTA". No tiene logo, ni nombre de la cooperativa, ni saludo. El chofer tiene un ícono de volante y el panel no tiene nada.
- El texto de ayuda ("¿Olvidaste la clave? La de un chofer…") es útil pero denso: cuatro líneas grises que compiten con el botón.
- El botón `INGRESAR` en Archivo Black con mucho tracking es más grito que invitación.

### 2.2 Despacho: mapa en vivo (pantalla principal, 8 h por día)

**Estructura:** barra superior, banner de SOS (si hay), tres columnas: lista de unidades (≈440 px), mapa y canal de chat (≈530 px).

- **Barra superior saturada.** En una sola fila conviven el logo, el nombre de la cooperativa, la etiqueta `DESPACHO`, el selector de ruta, la píldora EN VIVO, el objetivo de brecha, *Activar alarma de SOS*, *Gestión*, el tema y *Salir*: once elementos, todos con borde y casi todos del mismo alto. A 1400 px el nombre ya se corta ("Señor de Hua…"). En celular "5 EN RU…".
  - *Activar alarma de SOS* es una configuración puntual y ocupa el lugar más visible, en ámbar, como si fuera una alerta permanente. Se lee como "algo anda mal" todo el día.
  - *Gestión* es el único botón azul relleno de la barra, así que parece la acción principal, aunque la acción principal de esta pantalla es mirar.
- **Tarjetas de unidad.** Están bien pensadas (código, chofer, adelante/atrás, estado), pero:
  - Cada tarjeta repite dos botones con borde (*Mensaje directo*, *Solo a Nilda*) que se llevan un tercio de la altura. Con 5 unidades ya hay scroll, y con 15 va a ser una pared de botones.
  - El fondo rosado completo de las tarjetas críticas, más el borde izquierdo rojo, más los números rojos, más la palabra `CRÍTICA`, son cuatro señales para lo mismo. Cuando tres de cinco unidades están en crítico, la columna entera queda rosada y pierde valor de alerta.
  - "18 KM/H" en mono gris pegado al código compite con él.
  - No hay foto, avatar ni iniciales del chofer. Es la oportunidad más barata de "humanizar": el despachador trata con personas, no con placas.
- **Mapa.** Las etiquetas de las unidades son texto suelto sobre el mapa, sin chip ni fondo, y se pisan con el trazado. La leyenda está bien. Los controles `+ / −` son los de Leaflet sin estilo y desentonan con el resto. *(En las capturas el mapa sale gris porque el entorno de prueba no tiene clave de tiles. No es un defecto de diseño.)*
- **Chat.** Es la parte más "humana" y la más plana: burbujas rectangulares grandes, encabezado en mono mayúscula (`ELMER CCAMA · M-12 · 12:32`), sin avatar, y los mensajes propios sin diferenciar a simple vista. "Guardar como evidencia" aparece como link subrayado en cada mensaje. Un chat de WhatsApp, que es la referencia mental de estos usuarios, se siente mucho más cercano.
- **Estado vacío** ("Sin unidades conectadas.", visto en noche): una línea gris arriba a la izquierda y el resto vacío. Es un momento ideal para un estado vacío con ilustración o con una explicación breve de qué esperar.

### 2.3 Despacho en celular (412 px)

- La barra superior se trunca ("5 EN RU…") y el aviso de *Activar alarma de SOS* pasa a ser una franja ámbar de dos líneas que empuja el mapa hacia abajo.
- La leyenda del mapa queda **tapada por la atribución** de OpenStreetMap ("Crítica · pelotón" cortado).
- Las pestañas inferiores (`UNIDADES (5) / MAPA / CHAT`) son solo texto en mayúscula, sin íconos, y el indicador activo es una raya fina arriba.

### 2.4 Gestión (Personas, Vehículos, Turnos, Rutas, Vueltas, Dónde se traba, Informes, Empresa, Números, Actividad)

**Estructura:** encabezado "Gestión · SEÑOR DE HUAYLLANI · R-14" + *✕ Volver al mapa*, menú lateral con tres grupos y contenido a la derecha con título, bajada y contenido.

- **Se siente como otra aplicación.** Al entrar a Gestión desaparece todo el contexto del panel (logo, cooperativa, estado en vivo) y aparece un encabezado nuevo con una "✕" como si fuera un modal. Conviene que se perciba como una sección del mismo panel y no como una ventana superpuesta.
- **Menú lateral** sin íconos. Los contadores (`7`, `5`, `hoy`, `1`, `31`, `↺`) están en mono gris y no se entiende qué miden: "hoy" junto a Turnos y "↺" junto a Actividad son crípticos. El ítem activo (barra azul + fondo blanco) está bien.
- **El contenido queda angosto y a la izquierda.** En 1440 px queda una franja vacía a la derecha (≈300 px) en Personas, Rutas y Empresa. En "Dónde se traba", con el estado vacío, la pantalla es una sola oración gris en un mar de nada.
- **Personas:** tabla densa con **cinco botones con borde por fila** (*Clave, Escribir, Combis, Editar, Baja*). Visualmente es un muro gris. "nunca entró" en ámbar mono parece una advertencia, aunque en una cooperativa nueva es lo normal. Los encabezados de columna en mono espaciado (`ÚLTIMA CONEXIÓN`) se leen como planilla.
- **Rutas:** tres tarjetas iguales. "sin recorrido" en ámbar Archivo Black grande es lo más llamativo de la pantalla y no tiene llamado a la acción claro (*Abrir trazador* es un botón secundario chico). El párrafo de abajo es largo y técnico.
- **Empresa:** los cinco KPI de arriba (1 ruta, 5 vehículos…) son decorativos en esta pantalla. El formulario es correcto. Los placeholders en mono (`20123456789`, `+51 951 234 567`) se confunden con valores ya cargados. El texto sobre el teléfono de emergencias es importante y queda como letra chica.
- **Números (gerencia):** es la pantalla con más potencial y la más fría:
  - Las 13 tarjetas KPI son iguales en tamaño, peso y color: *Cumplimiento 74 %* (el número que le importa al gerente) pesa lo mismo que *0 retornos*, *0 idas*, *0.0 h ausente* o *0 SOS*. Los ceros ocupan media pantalla.
  - **No hay ni un solo gráfico.** El banco de prueba siembra tres semanas de historia "para mirar tendencias", pero la tendencia no se ve: todo son cifras y tablas. Una línea de cumplimiento por día o una barra por unidad cambiarían la pantalla por completo.
  - Nueve botones `CSV …` con el mismo peso que los filtros de período (*7 / 14 / 30 días*) se mezclan en dos filas. Exportar es una acción secundaria y debería agruparse (por ejemplo, un solo "Descargar ▾").
  - Tabla: el color de *Cumple* (verde, ámbar, rojo) es la única señal visual. Funciona, pero un mini-indicador de barra lo haría escaneable.
  - "MEJOR 45:34" debajo de la duración, en mono diminuto, es ruido.

### 2.5 Creador (`server/creador.html`)

Es sobrio **a propósito** (es interno, ver invariante 8). Igual hay detalles que no son de marca sino de calidad:
- Pestañas superiores en mono de 11 px muy espaciadas: chicas para ser la navegación principal.
- Tarjeta de cooperativa: la línea `RUC — · contacto — · alta 11/11/2026` en mono diminuto. "0 vehículo(s) · 0 persona(s)": los "(s)" son de sistema, no de persona.
- Mucho espacio vacío debajo cuando hay una sola cooperativa, sin estado vacío ni orientación.
- No requiere calidez de marca. Requiere el mismo pulido de ritmo y tamaños que el resto.

### 2.6 Página `/` (landing) y redirecciones

- `/` muestra "Pantalla del conductor · PROTOTIPO · JULIACA · 3800 M" con un celular falso. Es una página de demo, no una puerta de entrada al producto. Para alguien que llega por primera vez no explica qué es COOP-R14 ni lleva al panel.
- `gerencia.html` (aviso "el panel se mudó") usa una paleta propia escrita a mano (`#0B1220`, `#4DA3FF`), oscura, distinta del tema día del panel al que redirige. Es un salto visual innecesario de 4 segundos.

### 2.7 App del chofer (`project/Prototipo.html`): solo para coherencia

No era el foco, y es la pantalla más trabajada (tiene transiciones, animaciones, SVG y sombras: todo lo que le falta a la web). Dos cosas:
- **El login del chofer es oscuro** (azul noche con degradado) y el de Despacho es claro. La misma empresa, con dos marcas de entrada distintas. El tema de fábrica es día; el login debería respetarlo o, al menos, ser coherente entre los dos productos.
- La pantalla en ruta tiene mucho aire muerto entre "EN VIVO" y "ADELANTE" y entre "ATRÁS" y los botones. No hay que achicar el número héroe, pero la composición vertical puede repartirse mejor.

---

## 3. Recomendaciones (por impacto, de mayor a menor)

Todas respetan los invariantes de `diseno-coop`: no bajan contraste, no tocan el tamaño de los números de brecha, no usan `#FF2D55` como decoración y no suavizan el SOS ni los cuatro avisos de seguridad.

1. **Corregir el fondo del login de Despacho** (la mancha oscura en tema día). Es un defecto, no un gusto, y es la primera impresión.
2. **Bajar el uso de mono + mayúscula + tracking** a lo que realmente es dato (horas, brechas, placas, códigos). Rótulos, encabezados de columna, grupos del menú y estados ("nunca entró", "conectado") deberían ir en la sans del cuerpo, en caja normal o versalita suave. Es el cambio que más "humaniza" con menos riesgo.
3. **Sistema de íconos mínimo** (un set de trazo, inline SVG, sin dependencias): menú de Gestión, pestañas del celular, acciones de fila (mensaje, clave, editar, baja), estados (en vivo, sin señal, fuera de ruta) y tema. Sin dependencia nueva: SVG inline.
4. **Microinteracciones**: transición suave (150–200 ms) en hover/foco de botones, entrada de modales y paneles, cambio de sección de Gestión, aparición de mensajes nuevos en el chat y cambio de estado de una tarjeta de unidad (de "en objetivo" a "crítica"). Respetar `prefers-reduced-motion`, que ya se usa.
5. **Personas antes que placas**: iniciales o foto del chofer en las tarjetas de unidad, en el chat y en la tabla de Personas. Avatar con color derivado del nombre (sin usar el rojo reservado).
6. **Números con jerarquía y un gráfico**: un KPI héroe (Cumplimiento) más grande, los secundarios en una fila compacta, ocultar o atenuar los que dan cero, y al menos una tendencia diaria del período. Agrupar las exportaciones CSV en un solo menú.
7. **Despejar la barra superior de Despacho**: mover *Activar alarma de SOS* a un ajuste o a un estado discreto ("Alarma: apagada ▸") que no parezca una alerta, y dejar *Gestión* como botón secundario. Darle aire al nombre de la cooperativa.
8. **Tarjetas de unidad más livianas**: un solo indicador fuerte de "crítica" (borde o fondo, no los cuatro), y las acciones de mensaje como íconos o en hover/menú contextual.
9. **Acciones por fila en tablas** (Personas, Vehículos): una acción principal visible y el resto en un menú "⋯". *Baja* sigue en rojo y con su confirmación.
10. **Estados vacíos con intención**: "Sin unidades conectadas", "Nada que mostrar en los últimos 7 días", creador con una cooperativa. Que tengan una ilustración simple o un ícono, una frase cálida y, si aplica, la siguiente acción.
11. **Chat más cercano**: burbujas con radio, las propias alineadas a la derecha con su color (`burbujaPropia` ya existe), avatar e iniciales, y la hora discreta. "Guardar como evidencia" como acción en hover y no como link fijo.
12. **Gestión como parte del panel**: mantener el encabezado del panel (logo, cooperativa, en vivo) y que Gestión sea una vista, no un overlay con "✕". Aprovechar el ancho disponible en pantallas grandes.
13. **Tono de los textos**: los párrafos explicativos son valiosos. Conviene darles forma de nota o ayuda plegable (con ícono "i") en vez de letra chica al pie, y revisar giros de sistema ("vehículo(s)", "0 · 0 min").
14. **Coherencia entre productos**: login del chofer, login de Despacho, `gerencia.html` y la landing con la misma identidad (tema día de fábrica, mismo logo y misma tipografía de títulos).

---

## 4. Restricciones para quien implemente

Resumen de `.claude/skills/diseno-coop/SKILL.md`, que es el contrato completo:

- Sin build: React + Babel standalone inline. Sin frameworks de CSS ni dependencias nuevas (los íconos van como SVG inline).
- Colores solo como **tokens en `TEMAS`**, en todos los temas del archivo. El creador copia a mano el `day` de despacho: si cambia una paleta, cambia la otra.
- `HUD` se muta con `Object.assign`; no pasarlo a props.
- Tema **día** es el de fábrica y va primero.
- No bajar contraste ni achicar los números de brecha. `#FF2D55` solo para emergencia y brecha crítica.
- El SOS sigue siendo deslizable. Los cuatro avisos de seguridad no se suavizan ni se esconden.
- Si se toca `project/`, subir `CACHE_NAME` en `project/service-worker.js`.
- Al terminar: `node pruebas/contraste.js` en verde y `cd pruebas && npm run sintaxis`.

**Repositorio:** https://github.com/Eltiokarma/Prototipo-Celular-Rastreo-01
