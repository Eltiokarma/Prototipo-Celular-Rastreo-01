# Auditoría de UI y plan de mejoras — 16/11/2026

Qué se revisó, qué se encontró y en qué orden conviene arreglarlo. Los
prototipos visuales de cada propuesta están en
[`auditoria-ui/prototipos.html`](auditoria-ui/prototipos.html) (se abre con
doble clic; varios se pueden tocar).

**No se cambió ninguna pantalla.** Esto es el informe y el plan; los arreglos
son otra tarea, un commit por cambio.

## En corto

- **Ninguna invariante de `diseno-coop` está rota** en las tres pantallas web.
  `contraste.js` y `sintaxis` están en verde.
- **Lo más serio está en la app del chofer, no en los paneles.** La web del
  chofer ignora «reducir movimiento», hace latir el SOS cuando la brecha está
  en rojo, y sus botones de acción miden 42 px con letra de 12 px a 3,95:1.
- **La APK quedó atrás de la web.** Su tema de «día» sigue siendo azul oscuro
  y el color `tenue` escribe botones enteros a 3,0:1 (2,4:1 de noche). La web
  ya resolvió esto; el repo tiene las dos respuestas a la misma pregunta.
- **Despacho está bien de estructura** después del retoque del 11/11. Lo que
  queda es densidad: entran 4 de 7 unidades sin desplazar, y hay 46 textos de
  11 px en una pantalla de ocho horas.
- **Creador, privacidad, consentimiento y gerencia: sin hallazgos de peso.**
- **Lo más grave no es visual** (segunda pasada, de comportamiento): sin
  señal, el HUD del chofer sigue mostrando la brecha vieja en verde con
  «Mantené el ritmo». A los 30 s todavía dice «EN VIVO»; a los 90 s dice
  «SIMULADO». Despacho ya resuelve esto; el chofer no.
- **Otra cosa que no es visual y pesa:** la app le habla de «vos» (Deslizá,
  Mantené, Aflojá) a choferes de Juliaca. Decisión tuya; si se cambia, el
  costo está contado abajo.

## Cómo se hizo

| Qué | Cómo se vio |
| --- | --- |
| `project/Prototipo.html` (chofer web) | Corriendo, con la cooperativa de demostración del manual y la flota reportando. 54 capturas y medición en el navegador. |
| `project/despacho.html` | Corriendo, a 1440×900 y a 390×844 (celular). Todas las secciones de Gestión. |
| `server/creador.html` | Corriendo, las cinco pestañas. |
| `server/landing.html`, `privacidad.html`, `consentimiento.html`, `project/gerencia.html` | Corriendo, escritorio y celular. |
| `app/` (APK nativa) | **Solo el código.** No se pudo correr aquí: todo lo que se dice de ella es lectura de `tema.js` y `crearEstilos()`, con el contraste calculado. |

Las cifras salen de [`auditoria-ui/medir.js`](auditoria-ui/medir.js): recorre
cada pantalla y anota el tamaño de cada control, el tamaño de cada texto, su
contraste contra el fondo real y las animaciones vivas, con y sin
`prefers-reduced-motion`.

Criterio: los skills `refactoring-ui` (ubicar cada problema en su nivel antes
de pulir) y `design-interface-animation` (cada movimiento tiene que ganarse su
lugar), sobre las invariantes de `diseno-coop`, que mandan.

**Segunda pasada, de comportamiento**, con el skill `design-of-everyday-things`
(Norman): no cómo se ve cada pantalla sino dónde se rompe la actividad. Qué
cree la persona que pasó, qué estado le confirma el sistema, qué ocurre si se
corta la red, si toca dos veces o si borra sin querer. Se leyó el código de
cada flujo y se hizo una prueba en vivo: cortar la red con el chofer en ruta
y mirar la pantalla a los 5, 15, 30, 60 y 90 segundos
([`auditoria-ui/corte.js`](auditoria-ui/corte.js)). Son la sección N.

**Lo que este informe no puede afirmar:** que algo se lea mejor al sol, que el
chofer se equivoque menos o que Despacho detecte antes un pelotón. Nada se
probó con personas ni en la calle. Donde una propuesta depende de eso, dice
«hipótesis» y qué prueba la decide.

---

## Hallazgos

Prioridad: **P1** = acceso, seguridad o un estado que confunde. **P2** =
jerarquía, orientación, legibilidad. **P3** = acabado.

### A. App del chofer — APK (`app/`) · vista solo en código

| ID | P | Qué pasa | Cambio | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| A1 | P1 | El tema `dia` es oscuro (`fondo #0A1A2E`). `Prototipo.html` dice que «una pantalla clara se lee mucho mejor» al sol y `app/README.md` dice que lo oscuro es el rasgo de diseño. Las dos no pueden ser ciertas al mediodía. | Llevar a `app/tema.js` los tres temas de la web (`day`, `sun`, `night`). | **Prueba de campo antes de decidir**: el mismo teléfono en el parabrisas al mediodía, con las dos paletas, leyendo la brecha de reojo. |
| A2 | P1 | `tenue` como color de texto: 3,90:1 sobre el fondo y 3,01:1 sobre los paneles; de noche 2,57 y 2,37. Escribe «SALIR DE RUTA», «DESLIZÁ PARA SOS», «MAPA», «CHAT» y los subtítulos (29 usos). Blanco sobre `brillante` («INGRESAR», enviar, contadores): 2,84:1 de día y 2,42:1 de noche. | Texto secundario con un token que pase 4,5:1 en las dos paletas; tinta oscura sobre `brillante`. | Sumar la paleta nativa a `pruebas/contraste.js`. Hoy `pruebas/tema.js` comprueba claves y que la noche sea más oscura, no pares de texto. |
| A3 | P2 | Seis colores escritos a mano en `crearEstilos()` (`#A9C0D6`, `#93AAC2`, `#1D598F`, `#4A0D1B`, `#fff`, `#08131F`) no cambian de noche. La burbuja propia sigue azul brillante, contra lo que `tema.js` explica sobre el azul en la cabina. | Pasarlos a tokens en las dos paletas. | `grep` de `#[0-9a-fA-F]{6}` en `App.js` fuera de `tema.js` queda vacío. |
| A4 | P2 | Rótulos de 10 px en mono con tracking (placa, «ELEGIDA», etiquetas del perfil) y 11 px en el pie. | Piso de 12 px; sans para rótulos, mono solo para datos. | Revisión del stylesheet. |
| A5 | P2 | Dos renglones de diagnóstico de GPS («Servicio de GPS: corriendo», «enviadas 412 · fallidas 0…») viven arriba del HUD. El propio código dice que están «mientras se mide en la calle». | Mostrarlos solo si hay algo que avisar (servicio caído, batería optimizada, fallidas > 0); el resto, a Perfil. | Con todo normal, la pantalla de ruta no muestra diagnóstico. |
| A6 | P3 | No se consulta `AccessibilityInfo.isReduceMotionEnabled()`. El carrusel usa resorte sin rebote, que está bien; solo falta el interruptor. | Con la preferencia activa, cambio de pantalla sin resorte. | En un teléfono con «quitar animaciones». **No verificado.** |

### B. App del chofer — web (`project/Prototipo.html`)

| ID | P | Qué pasa | Cambio | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| B1 | P1 | Ignora `prefers-reduced-motion`. Medido con la preferencia activa: `combiEdge` y `combiRing` siguen corriendo en bucle. Es la única pantalla sin ese apagado. | `tweaks.microAnims` (línea 2397) arranca leyendo la preferencia y la escucha. | `medir.js` con `reducido`: 0 animaciones infinitas. |
| B2 | P1 | Con la brecha en rojo, un anillo rojo late sobre el SOS (`suggestSos = status === 'red'`, línea 1581). Una brecha crítica es un pelotón, no una emergencia: la señal invita a deslizar el SOS por algo que no lo es. | Quitar el anillo. El SOS no necesita llamar la atención; necesita estar siempre en el mismo lugar. | El SOS se ve igual en los tres estados de brecha. |
| B3 | P1 | Las tres acciones del HUD miden **42 px** de alto con texto de **12 px**. «ESTOY EN TRÁFICO» y «AUSENTE» van en ámbar `#A67300` sobre `#F7FAFD`: **3,95:1** (mínimo 4,5). Las dos comparten el contorno ámbar. «AUSENTE» descarta la vuelta con un toque; «SALIR DE RUTA» pide dos. Mientras tanto sobran ~150 px arriba del número. | 56 px y 16 px; texto en `amberInk` (11,47:1); ámbar solo para tráfico, contorno neutro para las dos que sacan de la cadena; «Deshacer» de 5 s en AUSENTE. | `medir.js`: 0 controles bajo 44 px y 0 textos bajo piso en el HUD. Prototipo 1. |
| B4 | P2 | La barra superior late **siempre**, también en verde (2,4 s; 1,4 s en ámbar; 0,8 s en rojo). Un énfasis que nunca se apaga deja de avisar, y es movimiento permanente en el borde de la vista de alguien que maneja. | Fija. Al cambiar de estado late tres veces y se queda quieta con el color nuevo. | **Hipótesis H1.** Prototipo 2. |
| B5 | P2 | Cada dígito que cambia salta 2 px y baja a 0,85 de opacidad (`AnimatedDigit`, línea 2424). La brecha cambia cada pocos segundos todo el turno: el número se atenúa justo cuando trae el dato nuevo. Además `prev.current` no se actualiza cuando sí anima, así que compara contra un valor viejo. | Quitar el salto. Que el número crezca una vez (320 ms) solo cuando cambia el **estado**. | Prototipo 2. |
| B6 | P2 | Cuando el lado que manda cambia (ATRÁS ↔ ADELANTE), los rótulos se intercambian sin señal. De reojo, el número grande pasa a hablar de la otra combi y nada lo marca. | Resaltar el rótulo 1,6 s al cambiar (fundido, sin desplazamiento). | **Hipótesis H2.** La alternativa a probar es dejar cada lado en un lugar fijo. |
| B7 | P2 | «Salir a ruta» usa la paleta oscura fija `P` (~30 referencias, líneas 2105–2395). «SALIR A RUTA →»: blanco sobre `#2E9DFF` = **2,69:1**. Párrafo, «Salir» y «Entrar AUSENTE»: `#5A7A99` sobre `#0A1A2E` = 3,90:1. Ocho textos de 9 a 11 px. «Salir» mide 48×29. `LIMITACIONES.md:330` dice que login y puerta son oscuras «a propósito»; desde el 11/11 el login ya no lo es. | Que lea de `HUD` como el ingreso. Botón con `acento`/`acentoInk` (5,51:1). | Prototipo 3. Actualizar esa línea de `LIMITACIONES.md`. |
| B8 | P2 | Al disparar el SOS, el pulgar muestra **✓** mientras el rótulo dice «ENVIANDO…» (línea 1651). Es una confirmación antes del resultado, en la acción más delicada del sistema. | «…» mientras envía; ✓ cuando la promesa de `onFire` resuelve. Si falla, ya existe «SOS NO SALIÓ», que está bien. | Con la red cortada, nunca se ve ✓. |
| B9 | P3 | Pestaña activa del chat: blanco sobre `#2E9DFF` a 13 px = 2,69:1. Ícono de enviar: 2,84:1. «Tú ✓✓»: 4,17:1. Pestañas de 40 px de alto. | `acento` del tema para el estado activo; `greenInk` para «Tú». | `medir.js` en el chat. |
| B10 | P3 | La tarjeta del mapa muestra las coordenadas crudas («-15.4869, -70.1358») en mono. No hay nada que el chofer haga con ellas. | Quitarlas de la vista del chofer. | — |
| B11 | P3 | Puntos de página de 44×36 y selector de tema de 64×36. `transition: 'all 0.3s'` (línea 2983). El deslizador anima `left` y `width` en vez de `transform`. | Zonas de 44 px; listar las propiedades. | `medir.js`. |
| B12 | P3 | Colores fuera de `TEMAS` dentro del JSX: `sun ? '#3D5C7A' : '#93AAC2'`, `'#C9D8E6'`, `'#5A7A99'`. No rompen ningún tema porque van condicionados, pero esquivan los tokens y a `contraste.js`. | Volverlos tokens (`ins`, `secundario`…) en los tres temas. | `contraste.js` los mide. |
| B13 | P3 | El chip «Conectado» del ingreso aparece antes de conectar (ya anotado en `CAMBIOS-UI.md`; sigue). | Mostrarlo solo con conexión comprobada, o quitarlo. | Sin red, el ingreso no dice «Conectado». |

### C. Panel de Despacho (`project/despacho.html`)

| ID | P | Qué pasa | Cambio | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| C1 | P2 | A 1440×900 entran **4 de 7** unidades. Cada tarjeta mide 130–160 px; las celdas de brecha vacías («—») ocupan lo mismo que las llenas; «+1 adelante / −1 atrás» se repite en cada una y los números no quedan en columna. El nombre se corta para mostrar la placa. | Fila compacta: brechas en dos columnas alineadas, línea de estado solo si hay algo que decir. | **Hipótesis H3.** Prototipo 5: entran las 7 con espacio de sobra. |
| C2 | P2 | Palabras chicas en el color de la brecha: verde `#1F8A4F` sobre blanco **4,37:1** («en ruta», brechas de Vueltas) y ámbar `#A67300` **4,14:1** («en línea», «Al límite», «PARCIAL» a 9 px). `contraste.js` mide el número grande, no estas. | En texto de menos de 18 px usar `verdeTinta` / `ambarTinta2` / `rojoTinta`, que ya existen. El color de brecha queda para números grandes y puntos. | Sumar esos pares a `contraste.js`. |
| C3 | P2 | **46 textos de 11 px** en el panel principal (22 en mono con tracking). Es la pantalla que se mira ocho horas. | Piso de 12 px; mono solo para datos. | `medir.js`: 0 textos bajo 12 px. |
| C4 | P2 | Las tarjetas de unidad son `div` con `onClick` (línea 6320): centran el mapa, pero no reciben foco ni responden al teclado. | `role="button"`, `tabIndex`, Enter y Espacio. | Recorrer la lista con Tab. |
| C5 | P3 | Controles bajos para un panel que también se instala en tablet: «Silenciar 1 h / 3 h / el turno» 26 px; «Corregir» 27 px; filtros 27–30 px; «¿Olvidaste la clave?» 16 px. | 32 px como mínimo en escritorio, 44 en la vista de celular. | `medir.js`. |
| C6 | P3 | KPI con huérfano: Vueltas arma 5 + 1 y Números 7 + 5. | Grilla de 3 o 6 columnas. | — |
| C7 | P3 | Informes: diez botones de ancho desigual; uno va de principal sin que la tarea lo pida. | Lista con una línea de descripción y el mismo botón «CSV» en cada fila. | — |
| C8 | P3 | Pines atenuados del mapa (ausente, sin señal): 11 px a 3,02:1. `@keyframes latido` quedó sin uso. | Tinta más oscura; borrar el keyframe. | — |

### D. Panel del creador (`server/creador.html`)

Sobrio a propósito, y lo está. Solo detalles:

| ID | P | Qué pasa | Cambio |
| --- | --- | --- | --- |
| D1 | P3 | SISTEMA dice dos veces lo mismo: «ATENCIÓN · La base está en el mismo disco…» (ámbar) y «RIESGO DE PÉRDIDA · La base está en el mismo disco…» (rojo). Compiten entre sí. | **No se toca sin tu visto bueno** (es uno de los cuatro avisos de seguridad). Si se une, queda el rojo, que es el que explica. |
| D2 | P3 | 14 rótulos de 9 px en SISTEMA. Iniciales blancas sobre naranja `#FF8A3D`: 2,35:1. «nunca reportó GPS» en ámbar: 4,14:1. | 12 px; tinta oscura en avatares claros; `ambarTinta2`. |
| D3 | P3 | «Suspender» va en rojo en reposo en cada fila. Es grave, pero no es la acción principal de la lista. | Contorno neutro en reposo; el rojo queda para la confirmación, que ya nombra a la cooperativa. Opinión. |

### E. Páginas públicas

| ID | P | Qué pasa | Cambio |
| --- | --- | --- | --- |
| E1 | P2 | La landing vende «la brecha en grande» y no muestra el sistema: es todo texto. | Dibujar el HUD en HTML y CSS junto al titular (~1 KB, sin imágenes ni JavaScript). Prototipo 6. |
| E2 | P2 | El único contacto es un `mailto:`. | WhatsApp como acción principal y el correo como alternativa. **Hipótesis H4**; hace falta el número. |
| E3 | P3 | Botón principal: blanco sobre `#2580CF` a 17 px = 4,14:1. «Ya soy cliente» mide 40 px. | `#1668C4` (5,51:1); 44 px. |

`privacidad.html`, `consentimiento.html` y `gerencia.html`: ningún texto bajo
el mínimo, ningún control chico, sin movimiento. Nada que cambiar.

### X. Transversal

| ID | P | Qué pasa | Cambio |
| --- | --- | --- | --- |
| X1 | P2 | La landing trata de «usted» y las pantallas usan voseo rioplatense: «Deslizá para SOS», «Mantené el ritmo», «Apurá / Aflojá un poco», «¿En qué combi salís?». El público son choferes y despachadores de Juliaca. | Pasar todo a «tú» de una sola vez, con la tabla del prototipo 7. **Si el voseo es a propósito, se descarta este punto.** |

### N. Comportamiento: dónde se rompe la actividad

| ID | P | Qué pasa | Cambio | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| N1 | **P1** | **Sin señal, la brecha vieja se ve igual que una viva.** Medido en la web: a los 30 s sin red sigue «EN VIVO · 7»; entre 30 y 60 s el rótulo pasa a «SIMULADO»; a los 90 s el 5:12 sigue grande, verde y con «Mantené el ritmo». La cabecera del chat repite la misma brecha vieja (ahí sí dice «sin conexión»). En la APK el rótulo sí dice «○ SIN CONEXIÓN», pero los dígitos quedan (leído en código). | Reloj en el cliente sobre el último estado recibido: a los 10 s, «SIN SEÑAL» con su tiempo y el número en gris; a los 60 s, el número se retira. Despacho ya lo hace (líneas 6190 y 6578). | Prototipo 8. Prueba de navegador que corte la red; casos nuevos en `pruebas/hud.js`. |
| N2 | P1 | **«Salir de ruta» se confirma con un doble toque.** El primer toque arma al instante y el botón cambia de función en el mismo lugar; un segundo toque inmediato sale (web línea 2746, APK línea 1499). Un rebote del dedo en una combi en marcha alcanza. Salir borra la combi del mapa y descarta la vuelta. | Ignorar toques los primeros 0,6 s después de armar. Despacho ya aprendió esto: la baja se arma a los 700 ms y «ATENDIDO» a los 1200 ms. | Doble toque rápido no sale; dos toques separados sí. Prototipo 1. |
| N3 | P2 | **El mensaje del chofer no tiene estado «enviando», y sin señal el borrador se pierde.** En la web el campo se vacía al tocar enviar y la burbuja aparece recién con el eco del servidor. Sin señal queda una burbuja verde, igual a una enviada, con el rótulo «NO SALIÓ», sin forma de reintentar. Despacho conserva el borrador y lo dice; la APK deshabilita el envío y avisa. Son tres respuestas distintas al mismo corte. Además «Tú ✓✓» copia la marca de «entregado» de WhatsApp y aquí solo significa que llegó al servidor. | Que la web haga lo de Despacho: el borrador se queda y se dice. Un solo ✓, o la palabra «Enviado». | Sin red, el texto escrito sigue en el campo. |
| N4 | P2 | **Trazador: «Borrar la ida» vacía el tramo de un clic y no se puede deshacer.** Está pegado a «Deshacer último punto», del mismo tamaño; «Deshacer» no recupera el borrado. La única salida es cancelar y perder lo demás sin guardar. | Que borrar guarde el tramo anterior y ofrezca recuperarlo. No un «¿Seguro?». | Prototipo 9. |
| N5 | P2 | **Despacho: a quién le escribo solo lo dice la cabecera.** El hilo privado queda abierto hasta volver al grupo; el campo y el botón son iguales para «toda la ruta» y para «solo Rufo», y el texto de ayuda desaparece con la primera letra. Un mensaje enviado al hilo equivocado no se puede retirar. | El destino escrito junto al campo y en el botón. | **Hipótesis H6**: no consta que el desliz ocurra. Prototipo 10. |
| N6 | P3 | **«Entrar AUSENTE» está bloqueado 15 s** al abrir la puerta («· en 12s») y la pantalla no dice qué se espera (líneas 2153 y 2366). Un bloqueo que no se explica se lee como falla. | Decir la razón en el botón, o quitar la espera. Falta saber para qué se puso. | — |
| N7 | P3 | **Hora y duración con el mismo formato en la misma tarjeta** de Despacho: la brecha «08:04» (ocho minutos) al lado de «Sin señal desde 14:58» (una hora del día). | Sin cero adelante, como en el HUD del chofer, y la unidad en la cabecera de la columna. | Entra con la lista compacta (C1). |
| N8 | P3 | **La web no tiene el vigía de la ausencia** que sí tiene la APK (`app/ausencia.js`): quien almuerza, arranca y olvida «VOLVER A RUTA» trabaja invisible. El servidor lo anota como `ausente_en_marcha`, pero a la pantalla no le llega. | Llevar esa lógica a la web (es JavaScript puro) o que el servidor lo mande en el estado. | Ausente y en marcha: la web avisa o vuelve sola. |
| N9 | P3 | **«ATENDIDO» en Despacho le llega al chofer como «DESPACHO VIO TU SOS · Lo marcó atendido».** «Visto» y «atendido» prometen cosas distintas a quien espera ayuda. | Elegir una: lo que el botón garantiza hoy es «visto». | Preguntarle a un chofer qué entiende que va a pasar. |

**N1, en detalle** (es el único que puede terminar en una maniobra):

- **Actividad:** el chofer regula su marcha contra las combis de adelante y de
  atrás, mirando un número de reojo.
- **Observado:** lo de la tabla, con la red cortada en el navegador. El
  cliente tarda entre 30 y 60 s en notar que el socket murió.
- **Inferido:** en una zona sin cobertura el chofer puede recibir «Apurá» o
  «Mantené» de un dato de hace varios minutos. No se observó a nadie hacerlo.
- **No sé:** cuánto tarda un teléfono real en notar el corte, y qué muestra la
  notificación de la APK con la pantalla apagada.
- **Mecanismo:** el silencio se lee como normalidad. El color de estado
  afirma algo que el sistema ya no sabe, y «SIMULADO» es vocabulario de la
  maqueta, no del chofer.
- **Qué se podría perder:** con umbrales muy cortos, la pantalla parpadea en
  cada bache de señal. Por eso los primeros 10 s no cambian nada.
- **Ya está escrito** en `LIMITACIONES.md` (sección B) que «las brechas se
  congelan». Lo que falta es que la pantalla lo diga.

---

## Lo que funciona y no hay que romper

- **El número de brecha**: 118 px, un solo dato dominante, color más frase.
  Es el corazón del producto y está bien resuelto.
- **El SOS**: deslizable, con «SOS NO SALIÓ» y salida por llamada o SMS cuando
  no hay red. Lo único que se propone es el ✓ adelantado (B8) y el anillo (B2).
- **«Salir de ruta» con segundo toque que caduca a los 4 s.**
- **Despacho**: Gestión como vista con riel, el cartel de SOS siempre arriba,
  los diálogos de baja y de trazado que nombran sobre qué y se arman a los
  700 ms, el número que crece una vez al cambiar de estado (`cambio .22s`), y
  el apagado global con `prefers-reduced-motion`.
- **Los cuatro avisos de seguridad** están, fijos y a la vista.
- **La cadena del SOS** está bien pensada de punta a punta: «ALERTA ENVIADA»
  solo si el servidor contestó, «SOS NO SALIÓ» con llamada y SMS si no, la
  cola cuando llegan dos, «ATENDIDO» que avisa si no salió, y el aviso de
  vuelta al chofer.
- **Lo que el sistema decide no adivinar:** «sin nadie» y «sin señal» son
  estados distintos; «YENDO A LA RUTA» en vez de una brecha inventada; el
  relevo nombra a quién le quitas la combi; el tráfico se apaga solo al andar;
  el vigía de la puerta cuenta en voz alta y deja cancelar.
- **Despacho sin conexión**: atenúa la lista y el mapa, dice «Reconectando…»
  y conserva el borrador del mensaje. Es el modelo para N1 y N3.
- **El tema día de fábrica** y la reserva de `#FF2D55`.

---

## Plan

Un commit por punto, pruebas en verde antes de subir. Cada cambio en
`project/` sube `CACHE_NAME`.

### Paso 0 — Que la medición sea repetible (medio día)

1. `manual/capturas.js`: opción `VIVO=1` que deja el servidor y la flota
   andando al terminar. Hoy los apaga, y `medir.js` necesita algo que medir.
2. `pruebas/contraste.js`: sumar los pares chicos de Despacho (C2), los
   literales del chofer vueltos tokens (B12) y la paleta nativa (A2).
   **Va a quedar en rojo: es lo esperado**, y es la lista de lo que sigue.

### Fase 1 — Acceso y señales, sin rediseñar nada · **HECHA (16/11)**

Un commit por punto, en la rama `claude/ui-audit-improvements-w2apo4`.
Cada uno dice qué se midió para darlo por bueno; el detalle está en
`CAMBIOS-PARA-REVISAR.md`, bloque 19.

| Punto | Commit | Qué quedó |
| --- | --- | --- |
| B1 respetar «reducir movimiento» | `8b71a1d` | Con la preferencia, 0 animaciones vivas en el HUD (antes 2 en bucle) |
| B2 quitar el anillo del SOS | `f0a66f9` | El SOS se ve igual en los tres estados de brecha |
| B8 ✓ del SOS sólo al confirmar | `95aca39` | «…» mientras envía; ✓ con la respuesta; sin red, nunca ✓ |
| B3 (parte 1) tamaño y tinta de las acciones | `f710934` | 16 px; 56 px de alto, 46 en un celular de 640 px (con 56 se recortaba la brecha); tokens `amberTexto` y `sobreRojo` |
| B9 contraste del chat del chofer | `188f84f` | 0 textos bajo su piso en el chat (antes 3); token `greenTexto` |
| **N1 brecha vieja sin señal**, web | `cd34d5b` | 10 s: «SIN SEÑAL · 0:12» y en gris; 60 s: se retira el número; vuelve sola |
| **N1** en la APK | `4356c7e` | La misma lógica en `app/hud.js`, con 11 casos en `pruebas/hud.js`. No vista en un teléfono |
| N2 «Salir de ruta» se arma a los 0,6 s | `9e2f62f` | Web y APK; un doble clic ya no sale |
| C2 palabras de estado con su tinta | `1ad5881` | Vehículos, Turnos, Vueltas, Dónde se traba y Actividad: 0 textos bajo su piso |
| C4 tarjetas con teclado | `87e6059` | El código de la unidad es un botón: Tab y Enter centran el mapa |
| E3 botón de la landing | `db330e9` | 5,51:1 y 44 px |

Lo que salió al hacerla y queda anotado:

- **La notificación de la APK con la pantalla apagada** sigue mostrando la
  última brecha si los POST /gps fallan: se actualiza sólo con sus
  respuestas. Arreglarlo es tocar la tarea de fondo (`app/gps/servicio.js`).
  Va con la fase 3.
- **El gris de la brecha vieja en la APK** es `tenue`, que de noche da 2,57:1.
  Se arregla con A2 (fase 3).
- **Las capturas del manual** del HUD, del chat y de Despacho cambiaron
  (botones más grandes, colores del chat). Los nombres de los botones no:
  el texto del manual sigue valiendo. Se sacan de nuevo al cerrar la fase 4.
- **«SIN SEÑAL»** es un estado nuevo de la pantalla del chofer y el manual
  todavía no lo explica.

### Fase 2 — El HUD del chofer · **HECHA (16/11)**, falta la prueba en la calle

Un commit por punto, todo en `project/Prototipo.html` (y `realtime.js` /
`index.html` donde se dice). Detalle en `CAMBIOS-PARA-REVISAR.md`, bloque 20.

| Punto | Commit | Qué quedó |
| --- | --- | --- |
| N3 borrador del chat | `2e8eab2` | Sin señal el texto queda en el campo y se dice; con la brecha vieja tampoco se manda; «Tú ✓» en vez de ✓✓ |
| B3 (parte 2) «Deshacer» en AUSENTE | `eee1803` | Se declara a los 5 s; DESHACER no le manda nada al servidor |
| B7 la puerta sigue el tema | `4544f4d` | Sin la paleta fija `P`; ningún control bajo 44 px ni texto bajo su piso, de día y de noche |
| B5 dígitos quietos | `01127d3` | El número crece una vez sólo al cambiar de estado |
| B4 y B6, ensayos | `584b411` | Construidos y **apagados**: se prenden con `/?ensayo=barra,rotulo` y se apagan con `/?ensayo=` |
| N8 vigía de la ausencia | `2f0c300` | Copia de `app/ausencia.js`; `pruebas/ausencia.js` comprueba que responden igual |
| N6 la espera de «Entrar AUSENTE» | `809c7bb` | **Se sacó.** Venía de la maqueta del 6/8 y nada decía para qué era |
| B13 «Conectado» sólo si es verdad | `985e563` | El chip pregunta a /ping |
| B10 sin coordenadas | `3a12d6f` | Quedan sólo los avisos de GPS |
| B11 zonas de 44 px | `dc7fd6a` | Puntos de página, tema y pestañas del chat |
| B12 colores a tokens | `ce08749` | Seis tokens nuevos en los tres temas; contraste.js mide dos pares más |

**Lo que falta, y no es código:** probar H1 y H2 en la calle. Con el mismo
teléfono en el parabrisas, una vuelta con `/?ensayo=` (lo de hoy) y otra con
`/?ensayo=barra,rotulo`; anotar si el chofer nota los cambios de estado y de
lado sin que se lo digan. Recién con eso se decide si quedan de fábrica.

Lo que salió al hacerla:

- El socket tarda hasta 40 s en notar que murió, y en ese rato **el chat
  mandaba a un socket muerto** sin avisar. Ahora, con la brecha vieja, el
  chat tampoco manda (va con N3).
- La raíz `/` redirigía con un meta refresh que perdía los parámetros; ahora
  los conserva (va con B4/B6).
- El deslizador del SOS sigue animando `left` y `width`: tocar ese gesto no
  entraba en un retoque. Queda anotado.

### Fase 3 — La APK · **HECHA (16/11)**, falta la prueba en la calle con distintos brillos

Un commit por punto, en `app/`. Detalle en `CAMBIOS-PARA-REVISAR.md`, bloque 21.
La prueba de campo de A1 iba **antes**; se hizo al revés porque Karma vio la
paleta clara en los prototipos, le pareció bien y la va a probar él con
distintos niveles de brillo. Si no convence, volver atrás es revertir
`23c9b72` (la oscura de antes queda escrita en `tema.js` como `MAPA_DIA`).

| Punto | Commit | Qué quedó |
| --- | --- | --- |
| A2 y A3 colores por papel | `1579c3d` | Catorce tokens nuevos en las dos paletas; ningún color a mano en `crearEstilos()` salvo el blanco del logo y el negro del visor; `contraste.js` mide 26 pares de la APK |
| A1 de día, clara | `23c9b72` | Los valores del tema `day` de la web. El mapa sigue oscuro (`paletaMapa`); la barra del sistema cambia de tinta con el tema |
| A4 piso de 12 px | `4913101` | Ningún texto bajo 12 px; los rótulos, en la sans |
| A5 diagnóstico del GPS | `ca19bd0` | En la ruta sólo si hay algo que avisar (servicio parado, batería optimizada, posiciones en espera o descartadas, un envío colgado 20 s, nada enviado hace 60 s); siempre, en Perfil |
| A6 quitar animaciones | `8ba0deb` | Con la preferencia del teléfono, el carrusel salta sin resorte |
| N1 en la APK, la notificación | `1c39963` | Con la pantalla apagada, si el envío falla en ruta, la notificación dice «SIN SEÑAL · hace N min» |

**Lo que falta, y no es código:**

1. **La prueba en la calle** con el brillo al mínimo, al medio y al máximo,
   de mediodía y al atardecer (antes de las 18:30, cuando todavía es la
   paleta de día): ¿se lee la brecha de reojo? ¿encandila?
2. **El splash** sigue oscuro (`app/app.json`, `#0A1A2E`): cambiarlo pide
   una APK nueva, no entra por EAS Update. Un segundo oscuro antes de una
   pantalla clara no rompe nada; se cambia en el próximo build.
3. **Nada de esto se vio en un teléfono.** Se vio en código, en las suites y
   en `auditoria-ui/vista-apk.js`, que arma las pantallas en HTML con los
   estilos reales de `crearEstilos()` (no es la app: sin fuente del
   teléfono, sin mapa, sin márgenes del sistema).

Lo que salió al hacerla:

- `linea` hacía de divisor y de contorno de los controles a la vez; un
  divisor no tiene que verse, un contorno sí (3:1). Se separó en `borde`.
- La burbuja propia del chat seguía azul brillante de noche: era uno de los
  colores escritos a mano.
- El chequeo de «hooks después de un return temprano» de `nativas.js` da
  falso positivo si un hook se define debajo de un componente; los hooks
  nuevos van arriba.

### Fase 4 — Densidad de Despacho · **HECHA (17/11)**, falta mirarla con la persona de Despacho

Un commit por punto, casi todo en `project/despacho.html`. Detalle en
`CAMBIOS-PARA-REVISAR.md`, bloque 22.

| Punto | Commit | Qué quedó |
| --- | --- | --- |
| N9 «visto», no «atendido» | `b0e37ba` | Al chofer le llega «Lo vio Despacho a las…», en la web y en la APK |
| C8 etiquetas del mapa | `4e49591` | La apagada es hueca (no transparente); las de color, con una tinta que se lee. **Salió algo peor que lo anotado:** de noche las etiquetas eran blanco sobre neón, 1,4:1 |
| N7 la brecha no parece una hora | `6b13f90` | «8:04 min» en las tarjetas; el servidor sigue mandando «08:04» |
| C3 y C5 tamaños | `0608883` | Nada bajo 12 px; botones de fila de 32 px; en el celular, cabecera, zoom y evidencia a 44. De paso: el contador de no leídos (4,1:1) y el número de brecha a 19 px |
| C6 fichas sin huérfanas | `1754a5c` | 3 + 3 en Vueltas; 6 + 6 (o 4, 3, 2) en Números |
| C7 Informes | `1a05653` | Lista: nombre, una línea con lo que trae y el mismo botón «CSV» |
| N4 recuperar un tramo | `57bcf3b` | «Borrar la ida» guarda lo que había y ofrece «Recuperar la ida»; separado de «Deshacer» |
| N5 a quién va el mensaje | `38b849a` | «Para: toda la ruta 18A» / «Para: solo M-07 · el resto de la ruta no lo ve» junto al campo, privado en ámbar |
| C1 lista compacta | `33523a0` | Construida y **apagada**: `despacho.html?ensayo=compacta` la prende y queda recordada; `?ensayo=` la apaga. Filas de 53 px contra 138: entran las 6 de la demo, hoy 4 |

**Lo que falta, y no es código:**

1. **H3 con la persona de Despacho:** las dos listas con la misma flota, el
   tiempo hasta señalar dos unidades pegadas. Si la compacta gana, se deja
   de fábrica; si no, se borra.
2. **N5 se construyó sin preguntar primero**, al revés de lo que decía H6
   («nunca le pasó: no se construye»). Es barato y no quita nada, pero si
   nunca le pasó, se revierte `38b849a`.
3. **Las capturas del manual** de Despacho cambiaron (mapa, tarjetas,
   Informes, chat): hay que sacarlas de nuevo.

Lo que salió al hacerla:

- **Las etiquetas del mapa de noche se leían a 1,4:1** (blanco sobre verde y
  ámbar neón). La auditoría había medido sólo las atenuadas de día.
- `#FF2D55` reservado: `contraste.js` frenó un token `pinRojo` de noche que
  lo repetía. Ahora la etiqueta roja usa `red` tal cual.
- En la lista compacta el nombre se recorta más que en la maqueta: la
  maqueta no tenía los dos botones de privado, y la fila los necesita.
  Por eso tampoco entran la velocidad, el ida/vuelta ni la placa.
- En el celular, los campos de Gestión siguen a 40 px (no 44): Gestión desde
  el teléfono es lo secundario. Queda anotado.
- La atribución de Leaflet sigue a 9 px en el celular: es de terceros.

### Fase 5 — Landing y lenguaje (1–2 días, cuando decidas)

E1, E2 (con el número de WhatsApp) y X1 (si se aprueba).

### Lo que no entra

D1 y D3 son tuyos. No se propone tocar el slider del SOS, el tema de
fábrica, los avisos de seguridad ni la tabla de permisos.

---

## Impacto en el backend y en el resto del código

**Ningún punto cambia un endpoint, el protocolo ni la base.**

| Punto | Servidor | Pruebas | Otros |
| --- | --- | --- | --- |
| B3 «Deshacer» | Nada: el cliente manda el mismo `POST` de presencia 5 s después. | `presencia`, `ausencia`, `relevo`, `trafico` tocan «AUSENTE» en el navegador: esperan los 5 s o usan un atajo de prueba. | Si se replica en la APK, mirar `app/ausencia.js`. |
| B1, B2, B4, B5, B6, B8 | Nada. | `sos.js`, `sos-sin-red.js` si miran el pulgar. | — |
| B7 puerta | Nada. | `puerta-web`, `vigia-puerta`, `sos-puerta` (buscan textos y `data-*`, que no cambian). | `LIMITACIONES.md:330`; capturas `c02-*`. |
| A1–A6 APK | Nada. El mapa propio ya se sirve en `claro` y `oscuro`. | `pruebas/tema.js`, `pruebas/hud.js`. | `app/mapa.js` fuerza el mapa oscuro (líneas 169 y 258–265); `app/README.md` documenta lo oscuro como decisión. |
| C1 lista | Nada: usa los campos que ya llegan en el estado en vivo. | `telefono.js` busca «BATERÍA 62 % · CARGANDO · APP 0.3.0»; revisar `paneles`, `privado-web`, `senal`, `desvio`. | Capturas `d02`, `d03`, `d05` del manual. |
| C2, C3 | Nada. | `contraste.js` (paso 0). | `creador.html` copia a mano `day` de Despacho: si se toca un token, se tocan los dos. |
| E1, E2 | Nada. `wa.me` es un enlace. | — | Sin dependencias nuevas. |
| N1 sin señal | Nada: es un reloj en el cliente sobre el estado que ya llega cada 3 s. | `pruebas/hud.js` y una de navegador con la red cortada. | `LIMITACIONES.md` sección B; la notificación de la APK con la brecha. |
| N2 doble toque | Nada. | Las que salen de ruta con dos clics seguidos (`presencia`, `relevo`) esperan 0,6 s. | Web y APK. |
| N3 chat | Nada si el borrador se queda. Un «enviando» por mensaje sí pediría que el servidor devuelva un identificador en el eco: hoy `sendChat` no manda ninguno. | `chat.js`, `envio.js`. | — |
| N4, N5, N7 | Nada. | `trazador.js`; `privado-web`, `privado-persona`, `chat` buscan el campo por su texto de ayuda. | — |
| N8 vigía en la web | Nada si se copia `app/ausencia.js`. Si lo avisa el servidor, un campo más en el estado de la unidad. | `ausencia.js`. | — |
| X1 lenguaje | **Sí, solo textos**: 13 líneas de `server/index.js` llevan frases que llegan a las personas. | 7 suites buscan estas frases tal cual. | ~26 líneas en `Prototipo.html`, 13 en `despacho.html`, 9 en `creador.html`, 25 en `app/App.js`, 5 en `app/hud.js`, 9 en `manual/manual.tex`. |

---

## Hipótesis y cómo se prueban

Ninguna está validada. Opinión y desempeño se anotan por separado: que algo
guste no dice si funciona.

| | Hipótesis | Comparación | Qué se mide | Qué la refuta |
| --- | --- | --- | --- | --- |
| H1 (B4) | La barra fija se lee igual de bien de reojo que la que late. | Mismo teléfono en el parabrisas, las dos versiones, una vuelta cada una. | Si el chofer nota el paso a ámbar o rojo sin que se lo digan, y cuánto tarda. | Se le pasan cambios de estado que con el latido veía. |
| H2 (B6) | Marcar el rótulo evita leer el número grande como si fuera del otro lado. | Resalte del rótulo frente a lados en posición fija. | Al cambiar el lado que manda: «¿de quién es ese número?». | Se equivoca igual, o las posiciones fijas ganan. |
| H3 (C1) | La fila compacta deja ver un pelotón más rápido. | Las dos listas con la misma flota. | Tiempo hasta señalar las dos unidades pegadas; errores. | Tarda lo mismo o confunde las columnas. |
| H4 (E2) | WhatsApp trae más contactos que el correo. | Un mes cada uno, o los dos a la vista. | Contactos recibidos por canal. | Llegan igual o menos. |
| H5 (N1) | 10 s y 60 s son buenos umbrales para marcar y para retirar la brecha. | Registro de cortes reales en una vuelta por la ruta. | Cuántas veces por vuelta se dispara cada umbral y cuánto dura cada corte. | Se dispara tan seguido que el chofer deja de mirarlo, o tan tarde que ya actuó. |
| H6 (N5) | El destino junto al campo evita mandar al hilo equivocado. | Antes de construir: preguntar a quien despacha si le pasó. | Mensajes al hilo equivocado, contados por ella. | Nunca le pasó: no se construye. |
| A1 | A pleno sol, el tema claro se lee mejor que el oscuro en la APK. | Las dos paletas, mismo teléfono, mediodía. | Lectura correcta de la brecha de reojo; reflejos. | El oscuro se lee igual o mejor. |

---

## No verificado

- La APK corriendo: ni en emulador ni en teléfono.
- Sol real, teléfono real, lector de pantalla, otros navegadores que Chromium.
- El tema `sun` de la web y el tema noche de Despacho (el script no llegó a
  activarlos; los mide `contraste.js`, que está en verde).
- El corte de señal se hizo en el navegador, no en una red celular: el
  tiempo que tarda un teléfono en notar que perdió la conexión puede ser otro.
- Los flujos de N2 a N9 se leyeron en el código; no se observó a nadie
  cometer esos errores.
- Nada con personas.
