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

## 2. Pasadas obligatorias (una por componente)

No te quedes en la pasada narrativa. Recorre las siete, aunque sea en una línea cada una.
Lo que se salta aquí es lo que después se escapa.

| Pasada | Prueba concreta | Qué buscar |
|---|---|---|
| Lectura / jerarquía | Miniatura (≈96–160 px de ancho) de los momentos clave | ¿Sobrevive la acción principal? ¿Qué domina? |
| Tono | Escala de grises (`-vf format=gray`) de los momentos clave | ¿Figura/fondo, mano/objeto, cara/entorno se separan por valor o solo por matiz? |
| Color | Mapa de saturación (canal S de HSV) y lista de masas saturadas | ¿La saturación alta está reservada a lo relevante o repartida? ¿Hay acentos que compiten (carteles, rótulos)? ¿El color dice algo contrario al tono de la escena? |
| Espacio / encuadre | Comparar **primer y último fotograma** del plano lado a lado; medir la escala de un objeto fijo a lo largo del tiempo | Zoom o deriva de encuadre constante sin función; recortes de personajes; zoom vs. dolly |
| Línea | Reducir a ejes, bordes y trayectorias (miniatura muy pequeña o dibujar encima de la hoja de contacto) | Motivo lineal dominante por tramo; ¿cambia cuando cambia la situación? ¿Una trayectoria opuesta marca el conflicto o pasa inadvertida? |
| Forma / silueta | Umbral a blanco/negro de figura vs. fondo, o mirar en miniatura | Fusiones (saco+cabeza, brazo+columna), siluetas esqueléticas |
| Movimiento | **Seguir la posición** de 1–3 objetos clave fotograma a fotograma (centroide por color o a ojo en hojas densas) y graficar x/y vs. tiempo | Overshoot/rebote en objetos pesados, mismo easing en todo, traslación rígida sin respuesta de peso, objetos que aparecen sin trayecto |
| Actividad / ritmo | Diferencia media entre fotogramas consecutivos a lo largo del tiempo | ¿Hay quietud antes del momento decisivo? ¿El pico de actividad coincide con lo importante o con un efecto? |
| Atención | Para cada tramo: dónde está el mayor contraste de tono, de movimiento y de tamaño | Si señalan sitios distintos, hay competencia; si el pico cae en lo secundario, jerarquía accidental |

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

**Umbrales orientativos (heurísticos, a escala 0–255; verifica siempre mirando):**
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
secundario (título, efecto, figurante).

## 2c. Pausa viva vs. congelado

Una pausa sirve para interpretar; un congelado total (actividad ≈ 0 en todo el cuadro
durante > 1 s) suele leerse como imagen detenida o error de render. Una pausa viva
conserva un movimiento mínimo **en el sujeto** (respiración, parpadeo, un ajuste de la
mano o la mirada) mientras el entorno queda quieto. La quietud del entorno es la que
concede peso; la del sujeto, no.

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
No anticipar la respuesta ni corregir a la persona.
