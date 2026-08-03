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
