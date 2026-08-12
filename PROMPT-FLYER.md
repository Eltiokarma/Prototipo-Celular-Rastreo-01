# Encargo — el flyer para choferes y cobradores

La maqueta y el pedido de diseño. El **por qué** de cada texto está en
`VALOR.md` (la investigación, la evidencia con su fuente y lo que no se puede
prometer); acá está **qué va, dónde va y con qué reglas**.

La sección 9 es un prompt **autocontenido**: se copia y se pega en Claude
Design tal cual, sin este repositorio al lado.

---

## 1. El encargo en una línea

Un flyer de dos caras que se le deja en la mano a un chofer o a un cobrador de
combi en Juliaca, y que en veinte segundos le haga entender que la app le da
gratis el dato que hoy le compra al datero — sin que se sienta vigilado.

## 2. Quién lo lee y en qué condiciones

Es el mismo tipo de restricción física que gobierna las pantallas de la app, y
manda igual que allá:

- **De pie, en el paradero o en el terminal**, con la unidad esperando.
- **Con una sola mano.** La otra tiene el celular, la llave o el fajo.
- **Veinte segundos**, no dos minutos. Si en el primer vistazo no entendió de
  qué se trata, el papel termina en el piso.
- **Se dobla y va al bolsillo.** Lo va a leer completo después, si es que lo
  lee.
- **Sol de altura**, a 3800 m: los grises claros sobre blanco desaparecen.
- El lector puede tener **50 años y no usar lentes aunque los necesite**.

De ahí salen tres consecuencias de diseño que no son negociables: **un solo
mensaje en el frente**, **cuerpo de texto grande** (mínimo 9,5 pt, ideal 10) y
**contraste alto en todo**, incluida la letra chica de las fuentes.

## 3. Formato

| | |
| --- | --- |
| **Tamaño** | A5, 148 × 210 mm, vertical |
| **Caras** | Dos, tiro y retiro |
| **Sangrado** | 3 mm por lado |
| **Margen de seguridad** | 8 mm — nada de texto afuera |
| **Impresión** | Digital, papel de 150–200 g, mate (el brillante no se lee al sol) |
| **Color** | Diseñar en RGB con la paleta de abajo, entregar también prueba en CMYK |

**El entregable primario es un HTML autocontenido** que se imprime en A5 sin
retoques (`@page { size: A5; margin: 0 }`, dos `<section>` de página). De ahí
sale el PDF. No hace falta InDesign para esto y así lo puede editar cualquiera.

## 4. La paleta — es la de la app, no una parecida

Son los tokens exactos del tema **día** de `project/Prototipo.html`, que es el
tema de fábrica de la app del chofer. Que el papel y la pantalla hablen el
mismo idioma **es parte del argumento**: el que reciba el flyer y después abra
la app tiene que reconocerla.

| Rol | Hex | Dónde |
| --- | --- | --- |
| Fondo | `#F7FAFD` | Fondo de las dos caras |
| Superficie | `#E9F0F8` | Cajas, bloques del dorso |
| Línea | `#C3D4E4` | Bordes de caja y chips |
| Divisor | `#D6E2EE` | Separadores internos |
| Tinta primaria | `#0B2239` | Titulares y cuerpo |
| Tinta secundaria | `#2A4864` | Bajadas |
| Tinta tenue | `#41627F` | Etiquetas y fuentes al pie |
| **Verde** | `#1F8A4F` | Estado *en objetivo*. Acento positivo |
| **Ámbar** | `#A67300` | Estado *al límite* |
| **Rojo** | `#C2001D` | **Reservado. Ver la regla de abajo** |
| Azul de marca | `#2580CF` | Detalles, llamada final |

### La regla del rojo

En la app **el rojo está reservado a la emergencia y a la brecha crítica: nada
más lo usa.** En el flyer rige igual. El rojo aparece en **un solo lugar**: el
bloque del SOS. No se usa para titulares, ni para números de accidentes, ni
para llamar la atención, ni de fondo decorativo.

Es la regla más fácil de romper en este flyer, porque hay datos de muertos y
la tentación es pintarlos de rojo. Pintarlos de rojo es exactamente lo que lo
convierte en publicidad del miedo. **Van en tinta tenue, en monoespaciada, con
la fuente al lado.**

## 5. Tipografía

Las mismas dos de la app, ambas de Google Fonts y libres:

| | |
| --- | --- |
| **Archivo Black** | Titulares, números grandes, títulos de bloque |
| **JetBrains Mono** (700/800) | Cifras, etiquetas, letra chica y fuentes |

Cuerpo de texto: **JetBrains Mono no sirve para párrafos largos**. Los párrafos
de más de una línea van en una sans neutra de sistema —`system-ui`— y la
monoespaciada queda para cifras, etiquetas y pie de fuentes, que es su papel en
la app.

Escalas sugeridas (A5): titular 34–40 pt, bajada 13–15 pt, título de bloque
11–12 pt en mayúsculas, cuerpo de bloque 9,5–10 pt, letra chica 7,5–8 pt.

---

## 6. La maqueta — FRENTE

Orden de lectura de arriba abajo, un solo mensaje. Cinco zonas:

### 6.1 Titular (la zona dominante, ~40 % de la altura)

```
YA SABÉS CUÁNTO TENÉS.
NO CORRAS PARA AVERIGUARLO.
```

Archivo Black, tinta primaria `#0B2239`. Dos líneas, y la segunda es la que
manda: si hay que jerarquizar, **«NO CORRAS PARA AVERIGUARLO» va más grande**.
No centrar: alineado a la izquierda, que es como se lee rápido.

### 6.2 Bajada

```
La brecha con el de adelante y el de atrás, en tu pantalla,
cada 3 segundos. Todo el turno. En toda la ruta.
```

Y debajo, como remate en Archivo Black chico o en mono 800:

```
SIN BAJARTE. SIN PREGUNTAR. SIN PAGARLE A NADIE.
```

### 6.3 El objeto — una sola pieza de producto

Una representación del **HUD de brecha** tal como se ve en la app: el número
héroe grande con su unidad, en verde `#1F8A4F`, sobre superficie clara, con la
palabra de estado debajo. Es la prueba visual de que el dato existe.

No es una captura de pantalla ni un mockup de teléfono con marco y sombra: es
**el dato**, grande, como lo ve el chofer. Contenido exacto:

```
+2:40        EN OBJETIVO
```

### 6.4 La franja de evidencia

Tres líneas, tinta tenue `#41627F`, monoespaciada, cuerpo chico, sobre
superficie `#E9F0F8`. **Sobria. Sin íconos, sin rojo, sin signos de
exclamación.** Cada una con su fuente entre paréntesis:

```
96 muertos en accidentes de tránsito en Juliaca entre enero y mayo
de 2026: la segunda ciudad del país, después de Lima.   (PNP)

8 de cada 10 accidentes son por factor humano, sobre todo velocidad.
                                        (autoridades de transporte)

Correr por el pasajero está medido: 67 % más accidentes por
kilómetro.                    (Santiago de Chile, estudio de 3 años)
```

### 6.5 Remate

```
El apuro casi nunca es apuro. Es no tener el dato.
```

Archivo Black chico o mono 800, tinta primaria. Es el puente al dorso.

---

## 7. La maqueta — DORSO

### 7.1 Encabezado

```
LO QUE TENÉS EN LA APP
```

### 7.2 Los seis bloques — grilla de 2 columnas × 3 filas

Cada bloque: ícono simple de línea (no emoji impreso: **redibujar como ícono
vectorial** de trazo, tinta secundaria), título en mayúsculas y dos líneas de
cuerpo. Los seis pesan lo mismo: **ninguno es más grande que otro**, salvo el
tratamiento de color del SOS.

| Ícono | Título | Cuerpo |
| --- | --- | --- |
| Cronómetro | **TU BRECHA, EN VIVO** | Cuánto tenés con el de adelante y con el de atrás. Verde, ámbar o rojo, con la palabra al lado. |
| Triángulo de alerta | **SOS DESLIZANDO** | Sin desbloquear ni marcar. Le llega a Despacho y a toda tu ruta. Qué pasó lo decís después. |
| Globo de chat | **EL GRUPO DE LA RUTA** | Chat y notas de voz con toda tu ruta. Y una línea privada con Despacho. |
| Mapa | **EL MAPA, SIN SEÑAL** | Guardado en tu teléfono. No depende de Google ni de tener datos. |
| Reloj | **TUS HORAS Y TUS VUELTAS** | Tus últimos 7 días. Un corte de señal no te parte el turno. |
| Candado | **NO EMITE HASTA QUE VOS DECÍS** | Deslizás SALIR A RUTA y recién ahí. Parar a comer no te cuenta en contra. |

**El bloque del SOS** es el único que lleva rojo `#C2001D`: en el ícono y en el
título. Nada más en las dos caras lo usa.

**El bloque del candado** es el más importante del flyer y no se ve. Si hay
espacio para destacar uno con un filete o un fondo apenas distinto, es ese: es
el que contesta el miedo real del chofer. Sugerencia: cerrar la grilla con él a
lo ancho de las dos columnas en vez de dejarlo en la esquina.

### 7.3 El recuadro del cobrador

Caja aparte, con borde `#C3D4E4` y fondo `#E9F0F8`. **Tiene que leerse como un
apartado**, no como un séptimo bloque: el cobrador tiene que encontrarse a sí
mismo en el papel de un vistazo.

```
SI SOS COBRADOR

Ves la misma brecha y el mismo mapa que el chofer, pero tu celular
no manda posición: no te come los datos ni la batería.

Tu cuenta es tuya, con tu nombre. Tus horas se registran a tu
nombre — no a nombre del chofer.
```

### 7.4 Pie

Sobre azul de marca `#2580CF` o con él de acento:

```
Preguntá en la oficina de tu cooperativa cómo entrar.
Tu usuario y tu clave te los da Despacho.

Funciona en Android.
```

Espacio reservado, arriba a la izquierda del dorso, para el **logo de la
cooperativa** (alto ≈ 14 mm). Cada cooperativa recibe el flyer con el suyo,
igual que recibe la app con su marca: dejarlo como hueco definido, no como algo
que se resuelve después.

---

## 8. Lo que no va

- **Ninguna foto de un accidente, ni de chapa rota, ni de ambulancia.** El
  flyer trabaja con datos y con la app, no con miedo. Un flyer que asusta se
  lee como que te está retando, y el que lo recibe maneja.
- **Ningún rojo fuera del bloque SOS.** Ver 4.
- **Ninguna cifra sin su fuente al lado**, por chica que sea la letra.
- **Nada que diga o insinúe que la app reduce los accidentes en 67 %.** Ese
  número compara **formas de pago** de choferes, no aplicaciones, y nadie midió
  esta app contra nada. El número describe el problema; la app se describe por
  lo que hace. Está explicado en `VALOR.md` §4.
- **Nada sobre control, cumplimiento, productividad ni supervisión.** Este
  papel es para el que maneja. Los argumentos para la cooperativa son otro
  material.
- **Ninguna promesa de que el GPS aguanta el turno entero con la pantalla
  apagada.** Está comprobado por minutos, no por ocho horas, y depende de la
  configuración de batería de cada teléfono (`PENDIENTES.md`, 1.3).
- **Nada de "no te distrae".** Cualquier pantalla en un vehículo distrae algo.
- **Ni un mockup de teléfono flotando con sombra y reflejo.** Se muestra el
  dato, no el dispositivo.
- **Ningún QR** hasta que haya una URL pública decidida. Un QR muerto en un
  flyer impreso no se arregla.

---

## 9. El prompt para Claude Design

Autocontenido: no supone acceso a este repositorio.

---

> Diseñá un **flyer A5 vertical, dos caras** (148 × 210 mm, 3 mm de sangrado,
> 8 mm de margen de seguridad) para entregar en mano a **choferes y cobradores
> de combi en Juliaca, Perú**. Entregá **un HTML autocontenido** listo para
> imprimir (`@page { size: A5; margin: 0 }`, una `<section>` por cara, fuentes
> de Google Fonts, sin dependencias externas más allá de eso).
>
> **Qué se promociona:** una app que le muestra al chofer, en su celular, la
> *brecha* —la diferencia de tiempo con la combi de adelante y con la de
> atrás— en vivo, cada 3 segundos. Hoy ese dato se lo compran a los *dateros*,
> gente parada en el paradero que grita el número por 10 a 50 céntimos.
>
> **Condiciones de lectura, y mandan sobre la estética:** se lee de pie, con
> una sola mano, en veinte segundos, con sol de altura a 3800 m, por alguien
> que puede tener 50 años y no usar lentes. Un solo mensaje en el frente,
> cuerpo grande (mínimo 9,5 pt), contraste alto en todo, incluida la letra
> chica.
>
> **Paleta (exacta, es la de la app y tiene que reconocerse):**
> fondo `#F7FAFD` · superficie `#E9F0F8` · línea `#C3D4E4` · divisor `#D6E2EE`
> · tinta `#0B2239` · tinta secundaria `#2A4864` · tinta tenue `#41627F` ·
> verde `#1F8A4F` · ámbar `#A67300` · rojo `#C2001D` · azul de marca `#2580CF`.
>
> **La regla del rojo:** en la app el rojo está reservado a la emergencia. Acá
> también. Aparece en **un solo lugar de las dos caras**: el bloque del SOS.
> Nunca en titulares, nunca en las cifras de accidentes, nunca de decoración.
> Las cifras de muertos van en tinta tenue y monoespaciada, sobrias, con su
> fuente al lado — pintarlas de rojo convierte el flyer en publicidad del
> miedo.
>
> **Tipografía:** *Archivo Black* para titulares, números grandes y títulos de
> bloque. *JetBrains Mono* (700/800) para cifras, etiquetas y letra chica. Los
> párrafos de más de una línea, en una sans neutra de sistema — la
> monoespaciada no sirve para leer párrafos.
>
> ---
>
> ### FRENTE
>
> **Titular** (Archivo Black, alineado a la izquierda, zona dominante; la
> segunda línea manda y puede ir más grande):
> ```
> YA SABÉS CUÁNTO TENÉS.
> NO CORRAS PARA AVERIGUARLO.
> ```
>
> **Bajada:**
> «La brecha con el de adelante y el de atrás, en tu pantalla, cada 3
> segundos. Todo el turno. En toda la ruta.»
>
> **Remate de la bajada** (destacado): «SIN BAJARTE. SIN PREGUNTAR. SIN
> PAGARLE A NADIE.»
>
> **Pieza de producto:** el dato tal como lo ve el chofer — el número de brecha
> grande en verde `#1F8A4F` sobre superficie clara, con la palabra de estado al
> lado: `+2:40` · `EN OBJETIVO`. **No** un mockup de teléfono con marco, sombra
> ni reflejo: se muestra el dato, no el dispositivo.
>
> **Franja de evidencia**, sobre superficie `#E9F0F8`, monoespaciada chica,
> tinta tenue, sin íconos y sin rojo. Cada línea con su fuente:
> - «96 muertos en accidentes de tránsito en Juliaca entre enero y mayo de
>   2026: la segunda ciudad del país, después de Lima.» (PNP)
> - «8 de cada 10 accidentes son por factor humano, sobre todo velocidad.»
>   (autoridades de transporte)
> - «Correr por el pasajero está medido: 67 % más accidentes por kilómetro.»
>   (Santiago de Chile, estudio de 3 años)
>
> **Remate al pie del frente**, destacado: «El apuro casi nunca es apuro. Es no
> tener el dato.»
>
> ---
>
> ### DORSO
>
> **Encabezado:** LO QUE TENÉS EN LA APP
>
> **Seis bloques en grilla de 2 × 3**, todos del mismo peso, cada uno con un
> **ícono vectorial de trazo** (no emoji), título en mayúsculas y dos líneas de
> cuerpo:
>
> 1. ⏱ **TU BRECHA, EN VIVO** — Cuánto tenés con el de adelante y con el de
>    atrás. Verde, ámbar o rojo, con la palabra al lado.
> 2. ⚠ **SOS DESLIZANDO** — Sin desbloquear ni marcar. Le llega a Despacho y a
>    toda tu ruta. Qué pasó lo decís después.
> 3. 💬 **EL GRUPO DE LA RUTA** — Chat y notas de voz con toda tu ruta. Y una
>    línea privada con Despacho.
> 4. 🗺 **EL MAPA, SIN SEÑAL** — Guardado en tu teléfono. No depende de Google
>    ni de tener datos.
> 5. ⏳ **TUS HORAS Y TUS VUELTAS** — Tus últimos 7 días. Un corte de señal no
>    te parte el turno.
> 6. 🔒 **NO EMITE HASTA QUE VOS DECÍS** — Deslizás SALIR A RUTA y recién ahí.
>    Parar a comer no te cuenta en contra.
>
> El bloque **2 (SOS)** es el único que lleva rojo `#C2001D`, en su ícono y su
> título. El bloque **6 (candado)** es el más importante del flyer: contesta el
> miedo a ser vigilado, que es la objeción real de este lector. Dale jerarquía
> — por ejemplo cerrando la grilla a lo ancho de las dos columnas en vez de
> dejarlo en una esquina.
>
> **Recuadro aparte** (borde `#C3D4E4`, fondo `#E9F0F8`), que tiene que leerse
> como un apartado y no como un séptimo bloque:
> ```
> SI SOS COBRADOR
> Ves la misma brecha y el mismo mapa que el chofer, pero tu celular no manda
> posición: no te come los datos ni la batería.
> Tu cuenta es tuya, con tu nombre. Tus horas se registran a tu nombre — no a
> nombre del chofer.
> ```
>
> **Pie**, con el azul de marca `#2580CF` de acento:
> «Preguntá en la oficina de tu cooperativa cómo entrar. Tu usuario y tu clave
> te los da Despacho.» / «Funciona en Android.»
>
> Reservá arriba a la izquierda del dorso un **hueco definido para el logo de
> la cooperativa**, de unos 14 mm de alto: cada cooperativa recibe el flyer con
> el suyo.
>
> ---
>
> ### Prohibido
>
> - Fotos de accidentes, chapa rota o ambulancias. El flyer trabaja con datos,
>   no con miedo: el que lo recibe maneja, y un papel que lo asusta se lee como
>   un reto.
> - Rojo fuera del bloque SOS.
> - Cualquier cifra sin su fuente al lado.
> - Decir o insinuar que **la app** reduce los accidentes un 67 %. Ese estudio
>   compara formas de pago de choferes, no aplicaciones. El número describe el
>   problema; la app se describe por lo que hace.
> - Lenguaje de control, cumplimiento, productividad o supervisión: este papel
>   es para el que maneja, no para la empresa.
> - Prometer que el GPS funciona todo el turno con la pantalla apagada.
> - La frase «no te distrae».
> - Mockups de teléfono flotando con sombra y reflejo.
> - Códigos QR.
>
> ### Cómo lo voy a juzgar
>
> 1. Tapado el dorso y a un brazo de distancia, ¿se entiende el frente en dos
>    segundos?
> 2. ¿El rojo aparece **una sola vez** en las dos caras?
> 3. ¿Las cifras de muertos se leen sobrias y con fuente, o se leen como una
>    campaña del susto?
> 4. ¿Un cobrador se encuentra a sí mismo sin tener que leer todo?
> 5. ¿La letra más chica sigue siendo legible impresa al sol?

---

## 10. Antes de mandar a imprenta

- Imprimir **una** copia y leerla parado, a un brazo, afuera y al mediodía.
- Que la lean **dos choferes** antes que cualquier diseñador. La pregunta no es
  si les gusta: es qué entendieron y qué les dio desconfianza.
- Verificar en CMYK que el rojo del SOS sigue siendo inequívocamente rojo y que
  el verde no se apaga.
- Releer `VALOR.md` §4: si una frase del flyer no está en la lista de lo que se
  puede afirmar, no va.
