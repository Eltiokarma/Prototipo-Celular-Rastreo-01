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
```python
# actividad por fotograma y saturación media
import numpy as np, subprocess, PIL.Image as I
# extrae a PNG con ffmpeg -vf fps=24 f%04d.png y luego:
# act[t] = mean(|f[t]-f[t-1]|); sat[t] = mean(HSV[...,1])
```

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
