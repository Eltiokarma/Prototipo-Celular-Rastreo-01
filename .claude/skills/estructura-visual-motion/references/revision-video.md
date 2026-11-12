# Protocolo para revisar un video (render, animatic, prueba)

Objetivo: que la crítica se apoye en evidencia del archivo, no en una impresión de
reproducirlo una vez. Herramientas: `ffmpeg`/`ffprobe`, Python con PIL/numpy; mira las
imágenes generadas (hojas de contacto, recortes). Trabaja en una carpeta propia.

## 0. Datos del archivo
```bash
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,codec_type -of compact VIDEO
```
Anota si **hay audio**. Si lo hay y no puedes escucharlo, dilo: la relación voz/música–
imagen queda fuera de la crítica salvo que te den el guion.

## 1. Cronología (siempre)
Hoja de contacto de toda la pieza a 1–2 fps con el tiempo impreso:
```bash
ffmpeg -v error -i VIDEO -vf "fps=2,scale=320:-1,drawtext=text='%{pts\:hms}':x=5:y=5:fontcolor=white:box=1:boxcolor=black,tile=5x4" hoja_%02d.png
```
Con ella escribe una **tabla de cronología** (tramo · qué ocurre · qué debería entenderse).
Luego densifica (6–24 fps) **los tramos de cambio**: entregas, contactos, revelaciones,
cortes y transiciones. Los problemas viven en los estados intermedios, no en las poses.

## 1b. Cortes y análisis plano por plano

Detecta los cortes como picos aislados de diferencia entre fotogramas (mucho mayores
que la mediana de la pieza) y analiza **cada plano por separado**: las comparaciones
de encuadre, actividad y escala son dentro del plano. Compara además el **primer plano
con el último**: si la pieza busca cerrar "volviendo al inicio con algo cambiado", el
encuadre de cierre debe rimar con el de apertura (mide la escala de un objeto fijo,
p. ej. un cartel).
```bash
# showinfo escribe a nivel info: NO uses -v error aquí.
ffmpeg -hide_banner -i VIDEO -vf "select='gt(scene,0.1)',showinfo" -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```
Con paletas planas o cortes por reencuadre (mismo decorado, otra escala) el valor
`scene` es bajo: 0.3 puede no detectar nada; empieza en 0.1 y confirma cada corte
mirando los fotogramas vecinos.

## 2. Pasadas obligatorias (una por componente)

No te quedes en la pasada narrativa. Recorre los **7 componentes** (espacio, línea,
forma, tono, color, movimiento, ritmo) y las **3 pruebas transversales** (lectura,
actividad, atención), aunque sea en una línea cada una. Lo que se salta aquí es lo que
después se escapa.

| Pasada | Prueba concreta | Qué buscar |
|---|---|---|
| *Transversal:* Lectura / jerarquía | Miniatura (≈96–160 px de ancho) de los momentos clave | ¿Sobrevive la acción principal? ¿Qué domina? |
| Ritmo | Tabla de eventos con sus tiempos (entradas, contactos, cortes, pausas); intervalos entre ellos | ¿Hay un patrón que se establece y luego se interrumpe en el momento decisivo? ¿Todo dura lo mismo? |
| Tono | Escala de grises (`-vf format=gray`) de los momentos clave | ¿Figura/fondo, mano/objeto, cara/entorno se separan por valor o solo por matiz? |
| Color | Mapa de saturación (canal S de HSV) y lista de masas saturadas | ¿La saturación alta está reservada a lo relevante o repartida? ¿Hay acentos que compiten (carteles, rótulos)? ¿El color dice algo contrario al tono de la escena? |
| Espacio / encuadre | Comparar **primer y último fotograma** del plano lado a lado; medir la escala de un objeto fijo a lo largo del tiempo | Zoom o deriva de encuadre constante sin función; recortes de personajes; zoom vs. dolly |
| Línea | Reducir a ejes, bordes y trayectorias (miniatura muy pequeña o dibujar encima de la hoja de contacto) | Motivo lineal dominante por tramo; ¿cambia cuando cambia la situación? ¿Una trayectoria opuesta marca el conflicto o pasa inadvertida? |
| Forma / silueta | Umbral a blanco/negro de figura vs. fondo, o mirar en miniatura | Fusiones (saco+cabeza, brazo+columna), siluetas esqueléticas |
| Movimiento | **Seguir la posición** de 1–3 objetos clave fotograma a fotograma (centroide por color o a ojo en hojas densas) y graficar x/y vs. tiempo | Overshoot/rebote en objetos pesados, mismo easing en todo, traslación rígida sin respuesta de peso, objetos que aparecen sin trayecto |
| *Transversal:* Actividad | Diferencia media entre fotogramas consecutivos a lo largo del tiempo | ¿Hay quietud antes del momento decisivo? ¿El pico de actividad coincide con lo importante o con un efecto? |
| *Transversal:* Atención | Para cada tramo: dónde está el mayor contraste de tono, de movimiento y de tamaño | Si señalan sitios distintos, hay competencia; si el pico cae en lo secundario, jerarquía accidental |

Recetas útiles:
```bash
# grises / miniatura de un instante
ffmpeg -v error -ss 9.0 -i VIDEO -frames:v 1 -vf format=gray gris_9s.png
ffmpeg -v error -ss 9.0 -i VIDEO -frames:v 1 -vf scale=128:-1 mini_9s.png
# primer vs último fotograma del plano (deriva de encuadre); N = índice del último fotograma
ffmpeg -v error -i VIDEO -vf "select='eq(n\,0)+eq(n\,N)',scale=480:-1,tile=2x1" -frames:v 1 inicio_fin.png
```
Ojo: con `-ss` antes de `-i`, `drawtext` imprime el tiempo desde 0. Para fragmentos usa
`-vf "setpts=PTS+INICIO/TB,drawtext=…"` o anota el desfase.

```python
# Extrae antes: ffmpeg -i VIDEO -vf fps=24 f/%04d.png
import glob, numpy as np
from PIL import Image
fs = sorted(glob.glob("f/*.png"))
def arr(p): return np.asarray(Image.open(p).convert("RGB")).astype(np.float32)

# 1) Actividad por fotograma (0 = congelado total)
prev = None; act = []
for p in fs:
    a = arr(p); act.append(0 if prev is None else np.abs(a - prev).mean()); prev = a

# 2) Seguimiento por color: centroide y área de un objeto de color conocido
def track(p, rgb, tol=30):
    a = arr(p); m = (np.abs(a - np.array(rgb)).max(axis=2) < tol)
    ys, xs = np.nonzero(m)
    return (xs.mean(), ys.mean(), m.sum()) if m.sum() else (None, None, 0)
# área que cae a 0 de un fotograma al siguiente = objeto que desaparece sin trayecto;
# x/y vs. t muestra overshoot, easing uniforme o traslación rígida.
# OJO: si otras masas comparten el color, limita la búsqueda a una región (recorta `a`)
# y vigila saltos bruscos del centroide: suelen ser contaminación, no movimiento.

# 4) Actividad por región: separa al sujeto del entorno (pausa viva vs. congelado,
#    competencia de figurantes). Regiones = cajas (x0, y0, x1, y1) en píxeles.
def act_region(fa, fb, box):
    x0, y0, x1, y1 = box
    return float(np.abs(arr(fb)[y0:y1, x0:x1] - arr(fa)[y0:y1, x0:x1]).mean())
# Si un figurante tiene mucha más actividad que el protagonista en el tramo final,
# le está robando la atención.
# OJO: la actividad por píxeles mide ÁREA cambiada, no desplazamiento. Un objeto
# compacto que cruza el cuadro rápido puede dar poca actividad y dominar la atención.
# Cruza siempre la actividad con el desplazamiento por centroide (receta 2).

# 5) Excluir una referencia del mismo color (p. ej., monedas del cartel vs. de la mano):
#    pon a cero la caja de la referencia antes de seguir el objeto.
def mask_box(a, box):
    x0, y0, x1, y1 = box; a = a.copy(); a[y0:y1, x0:x1] = 0; return a

# 6) Mirada / orientación de cabeza: recorta la cabeza en los instantes clave y
#    compara la posición de la pupila (píxeles oscuros) respecto al centro de la cabeza
#    en una hoja ampliada. Una mirada que se mueve < 10 % del diámetro de la cabeza
#    probablemente no se lee: acompáñala con giro de cabeza, cambio de eje o gesto.
#    Si dos objetivos posibles (p. ej., las monedas en la mano y el cartel) quedan a
#    menos de ~15° de separación vistos desde la cabeza, la mirada sola no distingue a
#    cuál mira: gira la cabeza hacia uno o separa los objetos. Esto incluye el caso
#    "referencia alineada con el interlocutor" (el cartel justo detrás de la cabeza
#    del otro personaje): la mirada no puede decir si mira el precio o a la persona;
#    separa la referencia en la composición o usa un gesto que la señale.
#    Una pupila en el borde de la cabeza (desplazamiento > ~0,5 del radio) se lee como
#    "mira arriba / afuera", no como "mira el objetivo": compárala con el ángulo real.
#    El umbral de oscuridad (< 60) puede captar contornos de otros objetos (monedas):
#    recorta solo la cabeza o bájalo (< 45).

# 7) Ángulo de mirada vs. objetivos: desde el centro de la cabeza, compara el ángulo
#    de la pupila con el ángulo hacia cada objetivo candidato.
def angle(frm, to):
    import math
    return math.degrees(math.atan2(-(to[1]-frm[1]), to[0]-frm[0]))
# objetivo leído = el de ángulo más próximo al de la pupila, solo si la diferencia
# con el segundo candidato es > ~15°. Si hay UN solo candidato en esa dirección, la
# regla de los 15° no aplica: basta con que la pupila apunte aproximadamente hacia él
# (≲ 20-25°) y no haya otro objeto relevante en esa dirección; una pupila en el borde
# superior se lee como "mira el cartel" si el cartel es lo único que hay arriba.

# 8) Alto de una figura (para "≲ 40 % del alto"). Con paletas planas las máscaras por
#    color fallan (suelo, mostrador y personaje comparten tonos). Más robusto: resta un
#    fotograma del MISMO plano sin la figura (o donde está en otra posición) y toma el
#    bbox de la diferencia; o mide a ojo sobre una hoja con regla. En el borde del
#    umbral (38-45 %) no decidas por el número: mira la miniatura.
def bbox_diff(fa, fb, thr=25):
    m = np.abs(arr(fa) - arr(fb)).max(axis=2) > thr
    ys, xs = np.nonzero(m)
    return (xs.min(), ys.min(), xs.max(), ys.max()) if m.sum() else None

# 9) Duración de una pose o gesto: con el seguimiento (receta 2) o la actividad por
#    región (receta 4), cuenta los fotogramas consecutivos en que el desplazamiento del
#    elemento clave es < 1-2 px. Esa es la duración que comparas con los umbrales.
def pupil_offset(p, head_box, dark=60):
    x0, y0, x1, y1 = head_box; a = arr(p)[y0:y1, x0:x1]
    m = a.max(axis=2) < dark; ys, xs = np.nonzero(m)
    if not m.sum(): return None
    return ((xs.mean() - (x1-x0)/2) / (x1-x0), (ys.mean() - (y1-y0)/2) / (y1-y0))

# 3) Luminancia puntual (Rec. 709) de objeto vs. su entorno inmediato
def lum(p, x, y, r=3):
    a = arr(p)[y-r:y+r+1, x-r:x+r+1]
    return float((a @ np.array([0.2126, 0.7152, 0.0722])).mean())
```

**Umbrales orientativos (heurísticos, a escala 0–255; verifica siempre mirando).** Su
función es **generar hipótesis y preguntas de prueba**, no dictar veredictos: un número
en el borde del umbral nunca decide por sí solo.
- Diferencia de luminancia objeto/entorno: < 15 se funde; 15–40 se separa solo con
  borde o tamaño; > 40 separación clara en grises. Un **contorno oscuro** o una
  saturación reservada pueden separar aunque el relleno se funda: mide también el
  contorno antes de declarar el problema, y confirma mirando la miniatura.
- Duración de una pose que debe leerse (heurística, verificar con la prueba de otra
  persona): un gesto simple y conocido ≈ 0,5–1 s sostenido; una comparación, un
  descubrimiento o una decisión ≈ 1–2 s; una consecuencia final ≥ 2 s con el protagonista
  solo en el foco.
- Elemento que debe contarse o leerse: ≥ 1 % del alto del cuadro por unidad, y
  comprobarlo en la miniatura de 128 px.
- Actividad: compárala **dentro de la misma pieza**, no con cifras absolutas. Lo que
  importa es dónde está el pico respecto a la importancia narrativa.

## 2b. Reparto de tiempo y actividad vs. importancia

Haz una tabla por tramo: % de la duración, actividad media y pico, e importancia
narrativa (alta/media/baja). Si el tramo de mayor actividad o duración es de baja
importancia (una caminata de entrada, una transición), hay jerarquía accidental aunque
sea un solo plano. **Excepción:** una preparación breve (≲ 15 % de la duración) que
introduce al protagonista o la situación puede ser el pico sin problema; lo que no
debe pasar es que el pico caiga *durante* o *justo antes* del momento decisivo en algo
secundario (título, efecto, figurante). Si el pico es la **respuesta del antagonista**
que constituye la consecuencia (le quitan el saco, le cierran la puerta), es legítimo:
es parte del momento decisivo, no algo secundario.

## 2c. Pausa viva vs. congelado

Una pausa sirve para interpretar; un congelado total (actividad ≈ 0 en todo el cuadro
durante > 1 s) suele leerse como imagen detenida o error de render. Una pausa viva
conserva un movimiento mínimo **en el sujeto** (respiración, parpadeo, un ajuste de la
mano o la mirada) mientras el entorno queda quieto. La quietud del entorno es la que
concede peso; la del sujeto, no.

Umbral relativo de congelado: actividad < 2 % de la mediana de actividad de la pieza
durante > 1 s. Una **pose sostenida intencional** (un brazo que queda colgando sin
respuesta) no es un congelado si: es el estado expresivo del sujeto, llega tras una
acción que la motiva y algo mínimo sigue vivo (respiración). Si dudas, márcalo como
hoja dudosa y pregunta en la prueba "¿qué estaba haciendo/sintiendo ahí?".

## 3. Movimiento: lo que sí debes señalar aunque no sea "estructura"

Peso, timing, spacing, anticipación y actuación exceden el método de Block **para
resolverlos**, pero no para **detectarlos**. Si los ves, entran en la crítica como hoja
propia marcada "(actuación/timing)":
- Un objeto pesado que rebota u oscila como goma contradice su material.
- El mismo easing (mismo rebote, misma duración) en todo → movimiento mecánico.
- Traslación de la figura sin cambio de postura al cargar/soltar → sticker, sin peso.
- Objetos que saltan de un lugar a otro sin trayecto visible.

## 4. Sin otra persona disponible

La prueba "¿qué pasó?" no la puede hacer el revisor sobre sí mismo (ya conoce la
intención). Entrega al usuario un **guion de prueba** listo para usar:
1. Mostrar la escena una vez, sin contexto ni título explicativo.
2. Preguntar: "¿Qué pasó?" → éxito si menciona el hecho central (p. ej., "le pagaron menos").
3. "¿En qué momento lo entendiste?" → éxito si señala el instante diseñado para ello.
4. "¿Qué intentó hacer el personaje después?" → éxito si nombra una intención, no solo un
   movimiento ("reclamó", no "se fue").
5. "¿Qué te llamó más la atención?" → si responde un efecto o un rótulo, hay jerarquía
   accidental.
6. "¿Cómo quedó [el personaje] al final?" / "¿Qué sentiste?" → comprueba el eje
   **sentir**: éxito si nombra un estado (impotencia, frustración…), no solo una acción.
Además, añade una pregunta por cada hoja dudosa.
No anticipar la respuesta ni corregir a la persona.
