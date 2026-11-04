# Manual de usuario

`manual.pdf` es el manual para quien usa el sistema: el chofer, el cobrador,
Despacho, la gerencia y la central. Las capturas son del sistema funcionando,
no maquetas.

| Archivo | Qué es |
| --- | --- |
| `manual.pdf` | El manual compilado, el que se reparte |
| `manual.tex` | Su fuente, en LaTeX |
| `img/` | Las capturas que usa (JPEG: con PNG el PDF pesaba diez veces más) |
| `capturas.js` | Saca las capturas de la app de verdad |
| `demo.js` | La cooperativa inventada de las capturas: gente, combis y dónde arranca cada una |
| `rutas-demo.json` | Los recorridos de la 18A y la 18B, por calles de Juliaca (sacados de OSM con un ruteador) |

## Volver a sacar las capturas

```bash
cd pruebas && npm install          # una vez: trae Playwright
cd .. && node manual/capturas.js
```

Levanta un servidor limpio en el puerto 3150 y arma la cooperativa **por las
pantallas**, como se arma una de verdad: el creador da de alta la cooperativa,
la gerencia carga las combis y el logo, Despacho da de alta a la gente. Después
pone a andar la flota por `POST /gps` —el mismo camino del teléfono—, con
posiciones que tienen la firma de un GPS de verdad (si no, el propio sistema
las marca como GPS simulado), y recorre cada pantalla. Tarda unos tres minutos.

Si un paso no encuentra su botón o la página tira un error, queda listado al
final y sale con 1: sirve también para enterarse de que una pantalla se rompió.

El mapa sale gris salvo que se le pase el mapa propio, que es el del release
`mapa-propio` del repositorio (`zonas.json` y `juliaca-claro.pmtiles`, ver
`herramientas/mapa-propio/`):

```bash
TILES_DIR=/carpeta/con/el/mapa node manual/capturas.js
SOLO=c,d01 node manual/capturas.js     # sólo las capturas que empiezan así
```

## Compilar

```bash
cd manual && latexmk -pdf manual.tex
```

Hace falta TeX Live con `latex-extra` (tcolorbox, titlesec, enumitem) y el
paquete de español de babel.

## Cuando cambia una pantalla

El texto nombra los botones como dicen en pantalla. Un botón que cambia de
nombre se cambia en `manual.tex`, se vuelven a sacar las capturas y se
recompila. Si `capturas.js` falla buscando un botón, casi siempre es eso.
