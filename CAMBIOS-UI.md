# Retoque de UI — 11/11/2026

Qué cambió, por qué, y lo que me pareció mal pero no toqué. Las reglas de
`.claude/skills/diseno-coop/SKILL.md` se respetaron; donde algo choca con
ellas, está anotado abajo en vez de cambiado.

## La integración (11/11, Claude Code)

El paquete se armó sobre `main` (`6689a72`), **antes** de la auditoría del
mismo día. Copiarlo encima habría borrado sus arreglos (el SOS dentro de
Gestión, los dobles clics, el muro de errores, el diálogo de Baja, el pin
del SOS, el mapa gris sin conexión, la versión nueva de privacidad y
consentimiento). Se fusionó a tres vías (`main` + diseño + auditoría), con
tres conflictos en `despacho.html` y uno en el service worker. En lo que
difiere de lo de abajo:

- **Baja**: en lugar de «Confirmar baja de X» en la fila, va el diálogo de
  la auditoría, que nombra a la persona y lo que se pierde, con el botón
  armado a los 700 ms (un doble clic daba de baja). «Baja» sigue en «⋯».
- **«Clave» de una cuenta de Despacho**: sólo la ve la gerencia (la
  auditoría lo cerró también en el servidor).
- **Gestión como vista**: se quedó la del diseño, que deja el cartel del
  SOS arriba por construcción (la auditoría lo resolvía copiando el cartel
  adentro). Gestión va envuelta en el muro de errores de la auditoría, en
  línea y no como capa.
- **Pin del SOS** de la auditoría: tenía el mismo bug de comillas que el
  diseño encontró en los pines; corregido, y con el estilo de pin del
  diseño.
- **«Llamar a la central»** del ingreso del chofer (auditoría): usa
  `HUD.red`, como el resto del ingreso desde el retoque.
- **`CACHE_NAME`**: `coop-r14-v99` (la auditoría ya iba por v98), no v92.
- **Pruebas**: además de `combis-web` y `datos-persona`, se ajustaron
  `doble-clic` (Baja en «⋯»; el cartel con Gestión abierta) y `creador-ui`
  («vehículo(s)» ahora concuerda en número). Lo demás pasó como estaba:
  `contraste`, `sintaxis`, los cuatro bancos visuales y la regresión
  completa.

## Lo que cambié

**project/despacho.html**
- **Login**: el fondo usa un token por tema (`fondoLogin`), y la mancha
  oscura del tema día desaparece. La tarjeta lleva el ícono, el nombre de la
  cooperativa recordada y un saludo según la hora. Los rótulos van en la sans
  y el botón dice «Ingresar» con peso normal. La ayuda de la clave queda
  plegada. El error usaba `rgba(255,45,85,.1)` (el #FF2D55 reservado); ahora
  usa `rojoFondo/rojoBorde/rojoTinta`.
- **Tokens nuevos** en `day` y `night`: `fondoLogin`, `realce`, `anillo`,
  `sombra`, `sombraAlta`, `avatares`. Root copia los que necesita el CSS
  global a variables (`--acento`, `--realce`, …), así el `<style>` no tiene
  ningún color propio. No toqué ningún color medido por `contraste.js`.
- **Tipografía**: `rotulo()` pasa de mono en mayúscula con tracking a la sans
  del cuerpo en caja normal. Para datos está `dato()`, que es mono. Los
  estados se siguen escribiendo en mayúscula en el código, porque las suites
  los buscan así, y se muestran en caja normal con `oracion()`.
- **Íconos**: unos 45 de trazo en SVG inline (`ICONOS` + `<Icono>`), sin
  archivos nuevos. Están en el menú de Gestión, las pestañas del celular, las
  acciones de fila, los estados, el tema, el chat y los avisos.
- **Movimiento**: transiciones de 160–200 ms en hover y foco, entrada de
  modales, cambio de sección, mensajes nuevos y cambio de estado de la brecha
  (el número late una vez). `:focus-visible` usa el acento. Todo se apaga con
  `prefers-reduced-motion`.
- **Personas antes que placas**: `<Avatar>` con las iniciales y un color que
  sale del nombre. Está en las tarjetas, el chat, Personas y el privado. La
  paleta de avatares es un token y no incluye rojo.
- **Barra superior**: el nombre de la cooperativa va en dos líneas con más
  aire, y el chip «Despacho» y el separador desaparecen. La alarma muda pasa
  a ser un estado: la campana tachada con un punto ámbar, siempre visible.
  Gestión es un botón secundario que alterna con «Mapa en vivo». El tema y
  Salir llevan ícono. Entre 900 y 1280 px cede el nombre de la ruta.
- **Tarjetas de unidad**: tienen una sola señal fuerte, el número en su color
  con la palabra. Ya no llevan fondo rosado ni borde rojo por brecha; el
  borde rojo queda solo para el SOS. Los dos privados pasan a íconos con
  contador. «FUERA DE RUTA» sigue en mayúscula, con ícono y sobre fondo ámbar,
  así que pesa más que antes. Las columnas laterales se adaptan al ancho.
- **Mapa**: las etiquetas de las unidades salían como texto suelto por un
  bug: `font-family:${black}` metía comillas dobles dentro de `style="…"` y
  el atributo se cortaba. Ahora van con comillas simples, borde y sombra. Los
  controles +/− y la atribución usan los tokens. En el celular la leyenda
  sube para no quedar debajo de la atribución.
- **Chat**: burbujas redondeadas, las propias a la derecha con
  `burbujaPropia`, avatar, hora discreta dentro de la burbuja y fondo `bg`
  para que se distingan. «Guardar como evidencia» aparece al pasar el
  puntero (en pantallas táctiles queda siempre visible). El envío es un ícono
  y la bandeja de privados va sobre fondo ámbar. El hilo vacío tiene un
  estado vacío propio.
- **Pestañas del celular**: ícono más nombre, y se suma «Gestión» como
  cuarta vista. El chat muestra cuántos mensajes hay sin leer.
- **Gestión**: es una vista del mismo panel y ya no un overlay. La cabecera
  y el banner de SOS quedan arriba; antes el overlay tapaba el banner. El
  mapa sigue montado. El riel lleva íconos, «Volver al mapa» y contadores
  solo cuando son números (se fueron «hoy» y «↺»). El ancho llega a
  1200 px, o 1440 en Números.
- **Personas**: «Escribir» queda visible (o «Clave» para Despacho) y el resto
  va en «⋯». La baja sigue en rojo y su confirmación ahora nombra a quién da
  de baja. «Nunca entró» ya no aparece en ámbar.
- **Rutas**: «sin recorrido» pasa a «Todavía sin recorrido dibujado», en
  tinta normal. En ese caso «Abrir trazador» es el botón principal.
- **Empresa**: los KPI decorativos pasan a una línea de resumen. Los
  placeholders ya no van en mono y dicen «Ej.: …». El texto del teléfono de
  emergencias es una nota azul en el tamaño del cuerpo.
- **Números**: Cumplimiento es el número héroe y está al lado de un gráfico
  de barras por día (sale de `porDia`). Los demás indicadores van compactos y
  los ceros atenuados. Los 9 CSV quedan en un solo «Descargar CSV ▾». El
  período es un control segmentado. Cada tarjeta mantiene la estructura
  `{número, rótulo}` que mira `numeros-ui.js`.
- **Notas y vacíos**: `Pie` pasa de letra chica gris a una nota con ícono en
  el tamaño del cuerpo. `Vacio` ahora tiene ícono, título opcional y acción.
- **Bug**: `Marca` usaba `HUD.brand`, que no existe, y sin `marca.color` las
  iniciales blancas quedaban sin fondo. Ahora cae a `HUD.bright`.

**server/creador.html**: los rótulos y los encabezados de tabla pasan a la
sans en caja normal. Las pestañas usan sans de 12 px; siguen en mayúscula
porque `creador-ui.js` busca `/COOPERATIVAS/` distinguiendo mayúsculas. El
subtítulo y los metadatos usan sans legible. Agregué hover, foco y
transiciones, y `--realce/--anillo`, que son copia exacta de `day`.
«vehículo(s)», «persona(s)» y «aviso(s)» ahora concuerdan en número.

**project/gerencia.html**: usa el tema día (valores de `day`), el ícono de
Despacho, Archivo Black en el título y un botón para abrir el panel.

**server/landing.html**: los títulos van en Archivo Black y los `h2` dejan
de estar en mayúscula con tracking. Agregué «Ya soy cliente: entrar» en la
cabecera, íconos en los tres roles y foco visible.

**project/Prototipo.html** (app web del chofer): el ingreso dejó la paleta
oscura fija `P` y lee de `HUD`. Con el tema de fábrica queda en día, igual
que el ingreso de Despacho, y sigue el tema que el chofer elija (auto de
noche). Los rótulos van en la sans y en caja normal, el error usa
`burbujaSos`, y el botón conserva tamaño y peso pero pierde el tracking.
Hay tokens nuevos en `day`, `sun` y `night`: `fondoLogin`, `acento`,
`acentoInk`, `acentoTexto`. Ninguno es un par medido. Agregué foco con
teclado (`currentColor`). No toqué el HUD, el SOS, el mapa ni el chat del
chofer: «INGRESAR», «MODO DEMO» y los textos que buscan las pruebas quedan
igual.

**server/privacidad.html y server/consentimiento.html**: los encabezados de
tabla y de sección dejan la mayúscula con tracking, y los enlaces tienen
color y foco. A propósito, no sumé ninguna fuente externa.

**Peso en el celular**: los íconos son SVG en línea y no hay ningún archivo
ni dependencia nueva. La única fuente agregada es Archivo Black en la landing
(con `display=swap`, no frena la carga). La app del chofer y los documentos
legales no suman nada.

**project/service-worker.js**: `CACHE_NAME` sube de v91 a v92.

**pruebas/combis-web.js y pruebas/datos-persona.js**: «Combis» y «Editar»
ahora viven en el menú «⋯» de la fila, así que las dos pruebas abren primero
`[data-acciones="pedro"]`.

## Lo que NO pude correr
No corrí `node pruebas/contraste.js` ni `npm run sintaxis` (no hay Node en
mi entorno). Lo que sí hice:
- Reproduje la lógica de `contraste.js` sobre los archivos: mismas claves en
  `day` y `night`, `day` primero, `#FF2D55` solo en `night.red`, y las 27
  variables compartidas con el creador iguales.
- Repasé todas las expresiones de `paneles.js` contra el fuente: todas dan
  verde.
- Compilé despacho.html y creador.html con Babel en el navegador sin
  errores, y miré el panel con datos simulados.

Hay que correr las dos suites y la regresión con navegador antes de publicar.

## Lo que me pareció mal y no toqué
- **El chip «Conectado» del ingreso del chofer** aparece antes de conectar
  y siempre dice «Conectado». Lo restilé pero no lo saqué: es una afirmación
  que la pantalla no comprueba.
- **El resto de la app del chofer** (HUD, chat, mapa) quedó como estaba: es
  la pantalla con más restricciones físicas y la que más pruebas tiene
  atadas al texto en mayúscula.
- **La raíz «/» sirve la demo del celular**: es una decisión de enrutado en
  `server/index.js`, fuera de la UI. La landing ya tiene la puerta «Ya soy
  cliente».
- **Marca de la landing**: usa «Micros Tempo» con Poppins, y el panel usa
  «COOP-R14 / Control de flota». Unificar la marca es una decisión de
  producto.
- **Textos de ayuda plegables**: los dejé visibles como nota. Varias suites
  leen `innerText`, que no incluye el contenido de un `<details>` cerrado, y
  algunos de esos textos están en las pruebas.
- **Ámbar `#A67300` en texto chico** (la palabra «Al límite» bajo la brecha,
  «↳ entró»): pasa el piso de 3:1 del héroe, pero no AA para texto chico.
  Donde era una etiqueta (tráfico, sin señal) usé `ambarTinta2`; en la
  palabra de la brecha queda el color de la brecha, como estaba.
- **Bloque de batería y app de la tarjeta**: sigue en mono y en mayúscula
  porque `telefono.js` busca `BATERÍA 62 % · CARGANDO · APP 0.3.0`
  distinguiendo mayúsculas.
