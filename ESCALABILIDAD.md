# Escalabilidad — de 1 ruta a 20+ rutas

Plan por etapas con números, no con intuición. La pregunta concreta:
**20 rutas y 1 000 micros (o el doble). ¿Aguanta?** Respuesta corta: el
servidor sí; **el diseño de mensajería no**, y hay que cambiarlo antes de
cualquier piloto grande — de hecho ya conviene cambiarlo hoy.

## Supuestos del modelo

- GPS cada 3 s por unidad (como está hoy).
- Turno de 8 h.
- Una unidad en el JSON de estado ≈ 230 bytes (posición + su objeto de brechas).
- Estimaciones de orden de magnitud, para decidir arquitectura.

## El problema que ya existe hoy

Hoy **cada posición GPS dispara el envío del estado completo a todos los
conectados**. Eso crece al cuadrado: con N unidades son N²/3 mensajes por
segundo, cada uno con las N unidades adentro.

| Unidades | Entra | Sale | Payload | Total | Datos por chofer / turno |
| --- | --- | --- | --- | --- | --- |
| 20 (1 ruta) | 7/s | 133/s | 4,5 KB | 0,6 MB/s | **885 MB** |
| 80 (4 rutas) | 27/s | 2 133/s | 18 KB | 39 MB/s | 14 GB |
| 300 | 100/s | 30 000/s | 67 KB | 2 GB/s | 194 GB |
| 1 000 | 333/s | 333 333/s | 225 KB | 77 GB/s | 2,1 TB |

La fila crítica es la primera: **con una sola ruta de 20 micros, cada
chofer descarga ~885 MB por turno** (~100 MB/hora). Con un plan prepago
peruano eso es inviable — el chofer desinstala la app el primer día. No es
un problema de escala futura: es un problema de hoy que el prototipo no
mostró porque se probó con 2-3 unidades.

## El diseño que sí escala

Tres cambios, todos en el servidor y en cómo se emite el estado:

1. **Alcance por ruta** — un chofer solo recibe datos de su ruta.
2. **Cadencia limitada** — como máximo un envío por segundo por chofer,
   en vez de uno por cada GPS de cualquier unidad.
3. **Payload personalizado** — a cada chofer se le manda *lo suyo*: sus
   brechas ±1/±2 y las unidades cercanas para el mapa, no la flota entera.

Con eso, el tráfico deja de crecer al cuadrado y pasa a ser lineal:

| Escala | Entra | Sale | Total servidor | Datos por chofer / turno |
| --- | --- | --- | --- | --- |
| 1 ruta × 20 | 7/s | 20/s | 0,03 MB/s | 46 MB baja + 1,4 MB sube |
| 4 rutas × 20 = 80 | 27/s | 80/s | 0,13 MB/s | igual |
| **20 rutas × 50 = 1 000** | 333/s | 1 000/s | **1,6 MB/s** | igual |
| 40 rutas × 50 = 2 000 | 667/s | 2 000/s | 3,2 MB/s | igual |

El dato importante: **el costo por chofer deja de depender del tamaño del
sistema**. Da igual si hay 20 o 2 000 micros — cada uno recibe lo suyo.
Y con envíos "solo al cambiar" (deltas de ~400 B) baja de 46 MB a
**~3,8 MB por turno**.

Del lado del servidor, 1 000 unidades son **1,6 MB/s y 333 mensajes de
entrada por segundo**: eso lo mueve **una sola instancia de Node** sin
transpirar (aguanta 10 000 WebSockets; 1 000 sockets son ~60 MB de RAM).

## Etapas, esfuerzo y qué se cambia

| Etapa | Alcance | Cambios | Esfuerzo |
| --- | --- | --- | --- |
| **0. Hoy** | 1 ruta, pocas unidades | — | listo |
| **1. Multi-ruta** | 4–8 rutas | `routeId` en usuarios, mensajes, vueltas y auditoría; brechas y chat por ruta; Despacho por ruta o supervisor con selector | ~1 día |
| **2. Mensajería eficiente** | 20 rutas / 1 000 micros | Cadencia limitada + payload personalizado + deltas. **Es lo que baja el consumo de datos**, y conviene hacerlo junto con la etapa 1 | ~1 día |
| **3. Operación** | piloto real | Backups de la base, métricas de carga, 2ª instancia para redundancia (requiere Postgres + Redis pub/sub para estado compartido) | ~1 semana |
| **4. Multi-ciudad / multi-cooperativa** | 2 000+ | Postgres, varias instancias, servidor de tiles propio, panel por cooperativa | mes+ |

Nota sobre la base de datos: a 1 000 unidades **SQLite sigue alcanzando**,
porque el GPS no se escribe en disco (vive en memoria) y las escrituras
reales — chat, vueltas, auditoría — son de 1 a 5 por segundo, contra los
miles que SQLite soporta. El motivo para pasar a Postgres **no es el
volumen sino correr más de una instancia** a la vez (redundancia), porque
un archivo SQLite no se comparte entre servidores.

## Los cuellos reales a escala (no son el servidor)

1. **Datos móviles del chofer** — lo de arriba. Es el bloqueador #1 de
   adopción y se resuelve con la etapa 2.
2. **Tiles del mapa** — sin caché, panear el mapa puede costar
   **20–50 MB por turno**, más que todo el tiempo real. Además el CDN
   gratuito de tiles no tolera 1 000 usuarios diarios (límites de uso):
   habría que cachear agresivamente en el service worker y/o pagar un
   proveedor.
3. **GPS en segundo plano** — con 1 000 choferes usando una app web, las
   unidades desaparecen del mapa cada vez que alguien bloquea la pantalla.
   A esta escala **la app nativa deja de ser opcional** (ver
   `LIMITACIONES.md`).
4. **Batería** — GPS continuo 8 h; hay que medirlo en campo.
5. **Soporte humano** — 1 000 choferes generan altas, olvidos de clave y
   celulares nuevos todos los días. El panel de Despacho necesita, a esa
   escala, que cada cooperativa administre lo suyo.

## Recomendación

Hacer las **etapas 1 y 2 juntas** antes del piloto de 4 rutas: tocan el
mismo código y la 2 arregla un problema que ya existe. Con eso el sistema
queda listo para 20 rutas y 1 000 micros sin volver a tocar la
arquitectura — lo que venga después es operación (backups, redundancia),
no rediseño.
