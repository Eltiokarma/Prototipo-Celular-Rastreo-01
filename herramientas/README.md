# Herramientas

Cosas que se corren a mano, para trabajar. **No son pruebas** —no verifican
nada ni las corre `npm test`— y no forman parte de lo que se despliega.

## `flota.js` — veinte combis falsas manejando la ruta de verdad

```bash
node herramientas/flota.js
node herramientas/flota.js --unidades 20 --ruta R-14
```

Sirve para ver **el mapa, las brechas y el panel de Despacho con la flota
llena**, sin veinte teléfonos ni veinte choferes. Es la única forma de mirar
cómo se ve todo esto con veinte unidades antes de que existan veinte
unidades.

Con eso levantado se puede, por fin, trabajar el trazado de una ruta y verlo
poblado: dibujás el recorrido con el trazador del panel, y las combis
arrancan a recorrerlo.

### No simula en el cliente, y es a propósito

El prototipo viejo (`Micros-Tracking`) tenía "fantasmas": unidades inventadas
que la propia app dibujaba, calculando su posición por tiempo. Se ve bien y no
sirve acá, porque **no pasan por el servidor**: no tienen brecha calculada, no
cuentan para el objetivo automático, no disparan "sin señal", no aparecen en
Despacho ni en los informes, y sobre todo **no prueban nada** — la parte que se
puede romper es justo la que se saltean.

Ésta entra por la puerta: crea usuarios de verdad, hace login de verdad y manda
posiciones por el mismo `POST /gps` que usa el teléfono con la pantalla
bloqueada. Para el servidor son veinte combis y no se entera de la diferencia.
Si mañana ese endpoint se rompe, esto se rompe con él, que es exactamente lo
que se quiere de una herramienta de prueba.

### Qué hace falta antes

**La ruta tiene que tener trazado cargado.** Las unidades caminan sobre el
recorrido que vos dibujaste con el trazador del panel de Despacho, no sobre un
círculo inventado. Si no hay trazado, la herramienta lo dice y no arranca.

### Opciones

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| `--servidor` | `http://localhost:3001` | A qué servidor pegarle |
| `--unidades` | `20` | Cuántas combis (tope 60) |
| `--ruta` | `R-14` | Qué ruta recorren |
| `--despacho` | `despacho99` | La clave de la cuenta DESPACHO |
| `--cadencia` | `3000` | Cada cuántos ms reportan, como el teléfono |
| `--prefijo` | `F` | Con qué letra se llaman (`F-01`, `F-02`…) |
| `--acelerar` | `1` | Reloj simulado ×N. Las posiciones salen igual cada 3 s, pero las combis avanzan N veces más rápido: con `--acelerar 10`, el almuerzo de 30 min dura 3 |

Las velocidades son **distintas entre sí** a propósito: con todas iguales las
brechas quedan congeladas y no se ve nunca un "apurá" ni un "aguantá", que es
justo lo que se viene a mirar.

### Los perfiles

Una flota real no son veinte relojes suizos, así que los fantasmas tampoco:

- **Todos descansan en los dos terminales**, un rato distinto en cada vuelta
  (determinista: dos corridas dan lo mismo). Es lo que produce las combis
  detenidas en el punto inicial y final, con la app abierta y reportando
  velocidad cero.
- **Algunos se van a almorzar 30 minutos** cada tres vueltas, sin apagar la
  app — quedan parados en el terminal, reportando, como un chofer con el
  celular en el bolsillo. La herramienta dice cuáles al arrancar.
- **Uno pierde la señal en un tramo fijo de la ida** —un mercado, una zona sin
  cobertura— y deja de mandar SIN dejar de moverse. Reaparece más adelante.
  Es lo que dispara el "sin señal" del servidor: se ve gris en el mapa, y la
  que viene atrás deja de medirse contra él.

La línea de estado lo va contando: `14 ok · 4 en terminal · 1 almorzando ·
1 sin señal`.

### Cuidado

**Crea usuarios y ensucia la base** del servidor al que le pegues: contra el de
producción te deja veinte choferes inventados en la cooperativa y vueltas
falsas en los informes. Por eso apunta a `localhost` por defecto y contra
cualquier otra cosa exige `--si-en-serio`.

Para probar en el teléfono contra un servidor local, la app tiene que apuntar
ahí — con la IP de tu máquina en la wifi, porque **el celular no resuelve
`localhost`**:

```bash
cd app && EXPO_PUBLIC_SERVIDOR=http://192.168.1.X:3001 npm start
```

## `escala.js` — cuánto tarda cada lectura del panel a tamaño de régimen

```bash
node herramientas/escala.js            # 2000 unidades: lo que se despliega
node herramientas/escala.js 20000      # el objetivo
node herramientas/escala.js 2000 --keep  # deja la base para inspeccionarla
```

Siembra una base con la retención real (120 días de vueltas, tramos, turnos,
desvíos, chat y auditoría), arranca el servidor contra ella y **le pregunta
por HTTP a cada endpoint del panel**, como preguntaría un despachador. Sale
una tabla de milisegundos y kilobytes, con los que pasan de 250 ms marcados.

### Por qué mide por HTTP y no las consultas sueltas

Porque el número que importa incluye el JSON armado, la subconsulta del borde
de empresa y el plan que el motor elige de verdad — y ese plan cambia con los
datos. Midiendo la consulta a mano se mide la que uno cree que corre.

### Por qué arranca el servidor para crear el esquema

**No tiene esquema propio, a propósito.** El `bench` de `modelo-costos.js`
—que mide otra cosa: la escritura— se arma las tablas a mano, y ya se separó
del real: le faltan `legs`, `deviations`, las columnas de migración y todos
los índices. Un banco con un esquema paralelo mide un sistema que no existe.
Éste levanta `server/index.js`, lo deja crear tablas, migraciones e índices,
y siembra encima.

### Por qué los números importan más de lo que parecen

SQLite es **sincrónico** y vive en el mismo hilo que atiende los `POST /gps`
de toda la flota. Cada milisegundo de esa tabla es un milisegundo en el que
nadie reporta posición. Un endpoint de 10 s no es una pantalla lenta: es el
mapa de 2000 combis congelado diez segundos porque alguien abrió una pestaña.
Así se encontró justamente eso — ver `COSTOS.md` §3.

### Cuidado

Usa el puerto **3199** y una base temporal propia; no toca nada tuyo. Sembrar
2000 unidades tarda ~1,5 min y ocupa ~730 MB de disco; 20 000 tarda bastante
más y ocupa ~7 GB. Con `--keep` la base **no se borra**: acordate de borrarla.

## `arranque.js` — en qué se le va el tiempo al servidor antes de contestar

```bash
node herramientas/arranque.js --sembrar 500 2000 5000
node herramientas/arranque.js <una-base.db> [otra.db …]
```

El arranque es **tiempo con el sistema caído**: después de cada despliegue o
reinicio nadie reporta y nadie ve el mapa. Y no aparece en ninguna métrica,
porque ninguna métrica existe todavía cuando pasa.

La herramienta reparte el arranque en cuatro: abrir la base (que es donde se
recupera el WAL y suele esconderse tiempo que nadie le atribuye a nada),
compilar sentencias, ejecutar SQL, y todo lo demás. Después lista las consultas
más caras. **Esa resta es el dato**: si el arranque son 40 s y el SQL son 3, el
problema no está en las consultas y hay que buscar en otro lado.

### Por qué mide desde afuera

Se precarga con `node -r` e intercepta `better-sqlite3` **antes** de que
`server/index.js` lo requiera. No hay una sola línea de instrumentación dentro
del servidor, y es a propósito: una sonda que viva adentro mide un servidor que
no es el que se despliega.

### Cuidado

- Siembra en `os.tmpdir()` y **no borra** las bases: a 5000 unidades son 2 GB.
  Borralas a mano cuando termines.
- Sembrar 5000 unidades tarda ~3,5 min y la base pesa 2 GB. Empezá por 500.
- **El primer arranque contra una base recién sembrada no es representativo**:
  si el techo de filas aprieta, esa vez borra de verdad y tarda mucho más que
  las siguientes. Medí dos veces y quedate con la segunda, que es la que se
  paga en cada reinicio.
