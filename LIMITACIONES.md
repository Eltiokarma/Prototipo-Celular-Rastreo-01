# Limitaciones conocidas — COOP-R14

Inventario honesto de lo que este sistema **no** puede hacer hoy, para
saber qué prometerle al cliente y qué no. Actualizar cada vez que una
limitación se resuelva o aparezca una nueva.

## Lo crítico (leer antes de vender)

| # | Limitación | Impacto | Salida |
|---|---|---|---|
| 1 | El GPS se corta con la pantalla apagada | **Resuelto en la app nativa, con condiciones** (medido en un teléfono real: siguió reportando varios minutos con la pantalla bloqueada). En la **web** sigue igual y no tiene arreglo. Las condiciones están abajo, en la sección A | `app/` — ya construida |
| 2 | Sin notificaciones con la app cerrada | Un SOS o mensaje no suena si el chofer/encargado no tiene la app abierta | Web Push (Android) o app nativa |
| 3 | Sin volumen en Railway, un redeploy borra la base | Se pierden usuarios, historial de chat y vueltas | Montar volumen + `DB_FILE=/data/r14.db` (documentado en README) |
| 4 | Brechas y vueltas son aproximadas | **Resuelto para las rutas con recorrido cargado**: el progreso se calcula proyectando la posición sobre el trazado real. Una ruta sin recorrido sigue con la estimación lineal | Ver README, sección El recorrido de la ruta |
| 8 | Dos personas con la misma cuenta pisan el GPS | **Resuelto**: persona y vehículo son cosas distintas, cada uno con su cuenta, y **solo un celular por vehículo reporta posición** (el del chofer). El cobrador queda en modo acompañante | Ver README, sección Identidad |
| 5 | Una sola cuenta DESPACHO compartida | La auditoría no distingue *cuál* encargado hizo cada cosa | Cuentas de despacho por persona |
| 6 | Consumo de datos móviles | **Mitigado**: de 839 MB a 40 MB por turno con 20 unidades (98 MB con 50), y los tiles del mapa ya no se rebajan en cada visita. Queda el payload personalizado para rutas de 30+ unidades | Ver `ESCALABILIDAD.md` |
| 7 | Multi-ruta | **Resuelto**: `routeId` de primera clase, brechas y chat por ruta, supervisor con selector y despachadores por ruta | Ver README, sección Multi-ruta |
| 9 | Un servidor por cooperativa | **Resuelto**: la empresa es un nivel arriba de las rutas y el borde de todo lo que se consulta. Una instalación atiende a varias sin que ninguna vea nada de otra. El aislamiento es lógico, no físico: comparten proceso, base y backup | Ver README, sección Empresas, y C acá abajo |

## A. App web en el celular del chofer (límites de PWA)

- **GPS en segundo plano:** los navegadores cortan la geolocalización al
  apagar la pantalla o pasar la app atrás. El diseño actual asume el
  celular **en soporte con pantalla prendida** (es el uso previsto del
  HUD). La solución de fondo es la app nativa
  (`PROMPT-REACT-NATIVE.md`), y no es un lujo: **con la pantalla apagada
  el consumo es mucho MENOR** —desaparecen la pantalla al máximo brillo y
  el redibujado del mapa, que son los dos grandes—, así que no hay ningún
  argumento de batería para no correr en segundo plano. Lo único que lo
  impide es el navegador.

  Mientras tanto, lo que se sabe de la unidad callada ya no se inventa:
  queda marcada **sin señal** con su última posición y nadie se mide
  contra ella (ver `PROTOCOLO.md`, sección 5). Eso evita la falla
  peligrosa, pero no devuelve la posición: la combi sigue sin verse.

- **En la app nativa el GPS SÍ sigue con la pantalla bloqueada**, y está
  medido. Pero hicieron falta tres cosas, y cada una se descubrió fallando
  en el teléfono, no leyendo documentación:

  1. **Un foreground service nativo** (`expo-location` + `expo-task-manager`),
     con su notificación permanente. Eso es lo que el navegador no puede.
  2. **Que las posiciones salgan por HTTP y desde la propia tarea de fondo.**
     Cuando Android manda la app atrás suspende el JavaScript: se cae el
     WebSocket y se desmonta React. Cualquier envío colgado de la pantalla
     deja de funcionar justo cuando más se lo necesita. Ver `PROTOCOLO.md`,
     `POST /gps`.
  3. **Que el teléfono tenga la app sin restricción de batería.** Si no,
     Doze le corta la RED a la app de fondo aunque el GPS siga corriendo:
     medido, el 43 % de los envíos fallaba con "sin red" y las posiciones se
     perdían. Esto **no se arregla desde el código** — se configura en cada
     teléfono, y en Xiaomi/Huawei/Oppo hace falta además el inicio
     automático. Ver `app/README.md`.
  4. **Que ningún corte dependa de un timer de JavaScript.** Con la
     pantalla apagada React Native (Android) no corre los `setTimeout` con
     duración mayor a cero, así que el corte de 15 s del envío nunca
     disparaba: un `POST /gps` que la red dejaba a medias quedaba colgado y
     tapaba todos los siguientes — con la batería sin restricción y el
     servicio corriendo, la unidad caía en «sin señal» a los dos minutos
     de bloquear. Ahora el reloj del corte es la propia tarea del GPS
     (`app/envio.js`), que sí dispara con la pantalla apagada.

  Con las tres primeras, los envíos fallidos bajaron de casi la mitad a
  casi cero; la cuarta salió de intentar el turno entero.
  Lo que **todavía no está medido** es un turno entero de 8 h: cuánta
  batería consume y si Android lo mata más tarde.
- **Notificaciones:** no hay push con la app cerrada. En Android es
  técnicamente posible con Web Push (pendiente); en iPhone es mucho más
  restringido.
- **iPhone:** todo el desarrollo asume Android (lo que usan los
  choferes). En iOS/Safari la PWA se instala distinta, el micrófono y el
  audio tienen restricciones extra y no está probado.
- **Micrófono:** las notas de voz requieren HTTPS + permiso del usuario
  + `MediaRecorder` (navegadores modernos). Sin eso, la nota queda
  local y simulada — degrada bien, pero no viaja.
- **Batería y datos:** GPS cada 3 s + tiles de mapa + WebSocket
  permanente consumen batería y datos todo el turno. No medido aún en
  campo; en jornadas de 8 h puede ser relevante.

## B. Conectividad

- **Sin señal no hay tiempo real:** la interfaz carga desde caché
  (service worker) en unos 3 segundos —lo que tarda en darse por vencido
  el intento de red— pero las brechas se congelan y el chat solo agrega
  mensajes locales. **No hay cola de reenvío**: lo que se emite durante
  un corte de señal se pierde (no hay acuse ni reintento por mensaje).
- **Reconexión:** automática cada 3 s. Al volver, el cliente recibe el
  historial del servidor (se resincroniza), pero lo enviado en el
  medio no se recupera.
- **Zonas sin cobertura de la ruta:** si un tramo no tiene datos
  móviles, la unidad aparecerá "saltando" en el mapa y sus vueltas
  pueden medirse mal.

## C. Servidor e infraestructura

- **Una sola instancia:** si el servidor cae o se redeploya, todos
  quedan desconectados unos segundos (se reconectan solos). No hay
  réplica ni alta disponibilidad.
- **Node 22 obligatorio:** `better-sqlite3` es un módulo nativo y con
  otra versión de Node el proceso muere con `Segmentation fault` sin
  mensaje. Está fijado en `engines` y `.nvmrc`; el servidor además se
  autodiagnostica (queda en modo degradado explicando el problema en vez
  de reiniciarse en bucle), pero si se cambia la versión del runtime hay
  que verificar que siga siendo 22.
- **SQLite:** perfecto para una cooperativa (una ruta, decenas de
  unidades). Para muchas rutas/cooperativas simultáneas habría que
  migrar a Postgres — el código lo permite, pero es trabajo.
- **Todas las cooperativas comparten proceso y archivo de base.** El
  aislamiento es lógico, no físico: los datos no se cruzan, pero la CPU, la
  memoria y el disco sí. Una cooperativa muy movida hace más lento a todo
  el mundo, y no hay cupos por empresa. La auditoría sí está acotada por
  empresa (1000 movimientos cada una), que era el caso donde la más movida
  le borraba el registro a las demás.
- **Sin backups automáticos** de la base (usuarios, chat, vueltas,
  auditoría). Un backup periódico del archivo `r14.db` es tarea
  pendiente de operación. Con varias cooperativas adentro hay algo más:
  **no se puede restaurar una sola** — el backup es del archivo entero, así
  que volver atrás por un problema de una empresa arrastra a las otras.
- **Dar de alta una cooperativa lo hacemos nosotros**, desde el panel del
  creador o la consola. Es a propósito (ver README, Niveles de seguridad),
  pero significa que ninguna se da de alta sola ni la puede dar de alta un
  vendedor: escala hasta donde escale nuestro tiempo.
- **Dependencia de CDNs gratuitos:** React, Babel y Leaflet cargan
  desde unpkg, los tiles del mapa desde CartoCDN, las fuentes desde
  Google Fonts. Ninguno tiene contrato de servicio: si un CDN falla y
  el celular no tiene la app en caché, no carga. Mitigación futura:
  empaquetar las librerías en el propio hosting.
- **Babel compila en el navegador** (sin paso de build): arranque en
  frío más lento en celulares viejos. Aceptable en prototipo; en
  producción conviene precompilar.

## D. Precisión del modelo de ruta

- El **objetivo automático** hereda la calidad de la detección de vueltas: si
  una vuelta se mide mal, entra al promedio. Se mitiga con la muestra de las
  últimas 30 vueltas y el mínimo de 3, pero un historial sucio da un objetivo
  sucio. Ante la duda, Despacho lo pasa a manual.
- **Mientras la ruta no tenga recorrido cargado**, el progreso sigue siendo
  una proyección lineal entre dos puntos y las brechas son aproximaciones.
  Con el recorrido cargado se mide sobre el trazado real (ver README).
- **La calidad depende de cómo se cargó el recorrido**: marcado a mano con
  pocos puntos, el trazado corta esquinas y el progreso se corre unos
  metros. Un GPX de una vuelta real es mucho más fiel.
- **El desvío de ruta no distingue el motivo.** Un atajo, un bloqueo y una
  obra se ven igual: una unidad a X metros del trazado. Despacho puede
  silenciarlo cuando ya lo sabe, pero para un desvío que dura semanas la
  salida es cargar el recorrido nuevo (rutas alternas, ítem 1 de
  `PENDIENTES.md`).
- **El silencio es por ruta, no por unidad**: si una sola combi se desvió por
  su cuenta y se silencia, quedan silenciadas todas las de esa ruta.
- **Ida y vuelta por la misma calle**: resuelto cargando el circuito en dos
  tramos — cuando empatan por cercanía, decide el sentido de marcha. Queda un
  caso límite: una combi **detenida** en un tramo compartido (semáforo,
  paradero) no tiene rumbo, así que se mantiene en el tramo en el que venía.
  Si el GPS la ubica mal justo ahí, puede quedar en el tramo equivocado hasta
  que vuelva a moverse.
- **La vuelta es opcional pero conviene cargarla**: con solo la ida, el
  circuito es media rutina y las vueltas (y el objetivo automático) se miden
  sobre esa mitad.
- La **detección de vueltas** sigue siendo una heurística (llegar cerca del
  final y volver al inicio): un desvío grande o GPS muy errático puede
  perder o duplicar una vuelta.
- La **detección de medias vueltas** (idas y retornos, tabla `legs`) es la
  misma heurística sobre el tramo, con dos guardas: el cambio de tramo tiene
  que sostenerse cuatro posiciones y hay que haber recorrido más del 80 % del
  tramo para darlo por terminado. Los dos números son fijos y no se pueden
  ajustar por ruta; en un circuito muy corto, o con un teléfono que reporta
  muy espaciado, la confirmación puede llegar tarde.
- **Un tramo que no se completó no queda en ningún lado.** Si la combi hizo
  media ida y se bajó, no hay fila: sólo sus horas. Es a propósito —un pedazo
  suelto no le sirve a nadie para contar— pero significa que las horas y las
  medias vueltas no cuadran siempre.
- **El umbral de "se metió a mitad de ruta" es el 15 % del circuito**, fijo
  para todas las rutas. Está elegido para cubrir el ruido normal (entre
  encender la app y arrancar ya se avanzaron unas cuadras); en una ruta muy
  corta puede quedar generoso, y una entrada real al 12 % no se marcaría.
- **Una zona muerta larga corta la medición igual.** El olvido desconfirma a
  los 3 minutos sin oír al teléfono, así que un cerro o un sótano parten la
  vuelta en dos y la que se cierre queda `parcial`. Eso **no** se traduce en
  una acusación: si la unidad estaba confirmada y vuelve dentro de las 2 h
  (`REANUDA_MS`), se la trata como reanudación — no se audita ni se la marca
  en el mapa. Pero la vuelta sí queda fuera de los promedios, así que un
  chofer con mala cobertura suma menos vueltas juzgables que uno con buena.
- **La ventana de reanudación es de tiempo, no de recorrido.** Vuelve a
  contar como entrada tardía recién pasadas las 2 h. Un chofer que corta el
  turno una hora y retoma a mitad de ruta pasa por reanudación. Está elegido
  a propósito: el error barato es no marcar una entrada real (la parcial
  queda en los números igual), el caro es marcar una falsa.
- El GPS urbano tiene error típico de 5–30 m, y algunos equipos no
  reportan velocidad (se muestra 0).

### Brecha promedio por vuelta

- **Empieza el día que se enciende.** No se puede reconstruir hacia atrás: la
  brecha se calcula en vivo contra dónde están las otras unidades en ese
  instante, y esas posiciones no se guardan. Las vueltas anteriores quedan
  **sin dato**, y salen vacías en la pantalla y en el informe — vacío es más
  honesto que un cero.
- **Se mide contra la unidad de adelante**, que es la que el chofer regula.
  Una unidad sola en la ruta, o la que va primera todo el tiempo, no tiene
  contra qué compararse y su vuelta queda sin dato: así no cuenta ni a favor
  ni en contra de nadie.
- **Una muestra por vuelta sale distorsionada.** Al cruzar el inicio del
  circuito, la unidad que acaba de dar la vuelta queda comparada contra las
  que todavía no la dieron, y esa muestra sale grande. En una vuelta real son
  cientos de muestras, así que mueve el promedio menos de un 0,1 %. Se
  documenta en vez de filtrarla porque cualquier filtro por tamaño también
  descartaría brechas legítimas cuando hay pocas unidades en la ruta.
- **Cuenta también los minutos detenido** en el terminal o en un
  embotellamiento. Es la brecha que existió, no la que la unidad podía
  controlar.

### Variantes del recorrido

- **Cambiar de variante descarta las vueltas en curso.** Es a propósito —una
  vuelta medida con dos trazados no significa nada— pero significa que
  cambiar a media mañana le cuesta una vuelta a cada unidad que esté en la
  calle. Conviene hacerlo con el terminal lleno o entre turnos.
- **El objetivo automático arranca de cero con cada variante nueva.** Vuelve
  al valor manual hasta juntar 3 vueltas del trazado nuevo. Es correcto (un
  trazado más largo tarda más) pero hay que saberlo: las primeras horas de
  una obra el objetivo es el que esté cargado a mano.
- **La vigencia programada se revisa una vez por minuto.** Una variante que
  arranca a las 06:00 puede empezar a medir a las 06:00:59. Para desvíos que
  duran días es irrelevante; no sirve para algo que tenga que cambiar al
  segundo.
- **Las vueltas de una ruta sin recorrido cargado no cuentan para ninguna
  variante.** Se midieron con la estimación lineal del cliente, no con un
  trazado. Las de rutas que sí tenían recorrido quedaron atadas a su variante
  en la migración, así que el historial no se perdió.

## E. Seguridad

- **Cuenta DESPACHO única y compartida** entre encargados: la
  auditoría registra "DESPACHO", no la persona. Del lado de los choferes
  y cobradores ya no pasa: cada uno tiene su credencial y la auditoría
  dice su nombre.
- **Nadie puede cambiar su propia clave**: solo Despacho resetea. Para
  este tamaño es un rasgo (el chofer no se autoexcluye), pero significa
  que una clave dictada por teléfono queda dictada.
- **Contraseñas:** mínimo 6 caracteres **al fijarlas**. El login no exige
  ese mínimo a propósito, para que las cuentas cargadas antes con claves
  cortas puedan seguir entrando hasta que se les resetee. Conviene resetear
  las viejas.
- **Sesiones en el celular:** un teléfono robado desbloqueado tiene la
  sesión activa (30 días). Mitigación: Despacho puede resetear la clave
  o dar de baja y la sesión muere al instante.
- **El "root" es la infraestructura:** quien controla Railway o el repo
  controla todo (documentado en README como diseño intencional).
- El límite de intentos vive en memoria (se resetea al reiniciar el
  servidor) y no hay captcha. Cuenta por cuenta (5 fallos → 5 min) **y por
  origen** (30 fallos en 10 min → 10 min), que es lo que frena probar una
  misma clave contra muchas cuentas. Contra una botnet con muchas IPs no
  alcanza: para eso haría falta captcha o un servicio delante.
- **Los identificadores** (usuario, vehículo, ruta) están limitados a
  letras, números, punto, guion y guion bajo, porque terminan pintados
  dentro del HTML de los pines del mapa. Los nombres y alias no tienen esa
  restricción: los pinta React, que los escapa solo. Si algún día se pinta
  un nombre en HTML crudo, hay que pasarlo por `escaparHtml`.
- **Cupo de mensajes por conexión** (30 chats, 10 notas de voz y 40
  posiciones por minuto): frena a un cliente descompuesto o malicioso, pero
  es por conexión — alguien con varias cuentas válidas puede multiplicarlo.
- **Sin límite de conexiones simultáneas por cuenta**: una misma credencial
  puede abrir muchas sesiones. Para el GPS no importa (solo una reporta),
  pero es una vía para consumir memoria del servidor.
- **El panel del creador es una clave sola**, salvo que se configure
  `CREATOR_TOTP_SECRET`. Sin el segundo factor, quien consiga esa clave y la
  ruta del panel entra a todas las cooperativas. Está apagado por defecto,
  la ruta se puede mover y la fuerza bruta está frenada, pero eso no
  reemplaza al segundo factor: conviene ponerlo. El panel lo avisa en su
  pestaña SISTEMA mientras falte.
- **Las sesiones del creador viven en memoria del proceso.** Es lo que
  queremos (un reinicio las cierra todas), pero con varias instancias del
  servidor detrás de un balanceador no funcionaría: cada una tendría las
  suyas. Hoy hay una sola instancia; si algún día hay más, esto hay que
  moverlo a la base o a un almacén compartido.
- **Los códigos son únicos en todo el servidor**, no por cooperativa: dos
  empresas no pueden tener las dos una ruta "R-14", ni un vehículo "M-05".
  Es necesario —si no, una consulta por `routeId` no sabría de quién habla—
  pero deja un rastro: al intentar crear un código ya tomado, el error dice
  que está tomado. No dice por quién, así que revela la existencia de un
  código, no a qué cooperativa pertenece ni ningún dato de ella.
- **CORS abierto** (`Access-Control-Allow-Origin: *`): cualquier página
  puede llamar a la API. No expone nada por sí solo —todo lo sensible exige
  el token, que no viaja en cookies— pero conviene cerrarlo al dominio
  propio cuando haya uno.

## F. Funcional (recortes conscientes)

- Notas de voz: solo las 30 más recientes conservan audio; tope 60 s;
  sin transcripción.
- Chat: los ✓✓ de "leído" son decorativos (no hay acuses reales); no
  se puede editar ni borrar un mensaje.
- La pantalla "Salir a ruta" muestra datos decorativos ("48 min · 42
  pasajeros", "V-247", turno): el conteo de pasajeros no existe.
- **Los turnos se registran, pero no se corrigen.** Se abre cuando la persona
  entra a su unidad y se cierra cuando se va: si se olvida de salir de la app,
  el turno sigue corriendo hasta que se corta la sesión, y si le presta el
  celular a otro, las horas quedan a nombre de quien inició sesión. No hay
  edición manual ni aprobación — para nómina no alcanza, para saber quién iba
  en la unidad sí.
- El tema cubre las tres pantallas y el panel, pero las pantallas de
  **login y "Salir a ruta"** siguen siendo oscuras a propósito (son las
  pantallas de marca, no de operación).
- El chat privado con una unidad **no tiene acuse de lectura real**: la
  pestaña DESPACHO del chofer cuenta los mensajes que llegaron desde la
  última vez que la abrió en ese celular. Si cambia de teléfono o borra los
  datos, el contador arranca de cero.
- Tampoco hay **notificación con la app cerrada** para un mensaje directo:
  vale la misma limitación que para el SOS (ver fila 2).
- **El cumplimiento del panel del gerente se mide contra el objetivo de hoy**,
  no contra el que regía cuando se cerró cada vuelta: ese número no se guarda
  con la vuelta. Con objetivo automático puede haber cambiado dentro del mismo
  período, así que un cumplimiento de hace tres semanas está juzgado con la
  vara de hoy. La pantalla lo dice en la propia tarjeta.
- **El panel del gerente no informa desvíos de ruta.** El desvío se detecta y
  se gestiona en vivo, pero **no se guarda**: no hay tabla de eventos de
  desvío, así que no se puede decir cuántas veces se salió del recorrido una
  unidad la semana pasada. Es un dato que habría que empezar a guardar; hasta
  entonces no se muestra, en vez de mostrar un cero que no significa nada.
- **Los días sin servicio no aparecen en la tendencia.** El eje del gráfico es
  una banda por día *con vueltas*, no una línea de tiempo continua: un domingo
  sin servicio no es un día de cero cumplimiento y no se dibuja como tal.

## G. Accesibilidad

- **Verde y ámbar son el mismo color para un daltónico rojo-verde.** No es una
  sospecha: medido con el validador de paletas, el par verde `#1F8A4F` ↔ ámbar
  `#A67300` queda en ΔE 5,4 bajo protanopia (el piso aceptable es 6–8, y eso
  solo si hay una segunda señal). Con visión normal se separan bien (16,0), y
  el rojo sí se distingue de los otros dos. Es el problema clásico del
  semáforo y **no se arregla moviendo el color**: corriendo el ámbar hacia el
  naranja se separa del verde pero se pega al rojo (probado con cuatro
  candidatos, todos peores).
  - **Dónde ya está resuelto:** el panel del gerente nunca usa el color solo —
    cada cumplimiento lleva su número y su palabra (*cumple* / *al límite* /
    *fuera*), y la desviación de la brecha lleva una flecha ▾▴, que es forma y
    no color.
  - **Y en Despacho también**, desde ahora: cada brecha de la fila de unidad
    lleva debajo del valor la palabra que la juzga — *EN OBJETIVO*, *AL
    LÍMITE*, *CRÍTICA*—, las mismas tres bandas que ya usaba el color y los
    mismos términos de la leyenda del mapa. Sin dato no hay palabra: el "—" del
    valor ya dice todo lo que se sabe. Con esto el juicio no depende del color
    en ninguna de las dos pantallas.
- **El tema noche es peor todavía** para esto: verde `#39FF14` ↔ ámbar
  `#FFD400` quedan en ΔE 2,2 bajo deuteranopia, prácticamente idénticos, y dos
  de sus colores se salen de la banda de luminosidad. Por eso el panel del
  gerente se hizo **solo en día**: es una pantalla de informes que se lee en
  una oficina, y no valía la pena arrastrarle esa paleta.
- Los gráficos del panel del gerente tienen **su tabla equivalente** (botón
  *Ver tabla*): ningún número está disponible únicamente a través de un color
  o de un tooltip.

## Acceso por web y dominio

La app **ya es una página web**: el mismo servidor de Railway sirve la
app del chofer (`/Prototipo.html`), el panel (`/despacho.html`) y el
tiempo real, con HTTPS incluido, en la URL gratuita
`*.up.railway.app`. **No hace falta comprar nada para que el cliente
lo vea.** Un dominio propio (~US$10–15/año, p. ej. `coopr14.pe`) es
opcional: aporta marca y una dirección fácil de dictar, y se conecta
al mismo Railway con un registro CNAME — sin cambios de código.
