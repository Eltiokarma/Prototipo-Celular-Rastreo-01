# Cambios para revisar

La lista de los últimos parches, para hacerles **una revisión integral** antes
de darlos por buenos. Se completa con cada cambio nuevo, al final.

Para cada uno dice qué se cambió, en qué archivos, qué conviene mirar con más
cuidado (las dudas que quedaron) y qué pruebas lo cubren.

**Todavía no va al manual en PDF.** Algunos cambios ya tocaron
`manual/manual.tex` (lo marca cada bloque, en «Manual»), y lo que falta pasar
al manual queda anotado al final, en *Para el manual*.

- Rama: `claude/eager-einstein-shid7d`.
- Base: `main` en `8563a9b` (PR #72).
- Lo anterior de esta rama (tandas 9 a 14: opción B del mando, la puerta,
  habilitaciones, los dos privados) está en `REPASO-PENDIENTE.md`.
- La regresión completa se corre con `cd pruebas && node regresion.js`.

---

## 1. Revisión previa a la APK — `7c9872b` (31/10)

**Qué.** Cuatro revisiones en paralelo (servidor, nativa, web, operación), y
cada hallazgo se reprodujo antes de arreglarlo:
- La marca del relevado vive en la base y no vence mientras el otro maneje.
- La salida automática del vigía y la re-declaración (`redeclara`) no hacen
  un relevo.
- `fuera` suelta el socket de GPS.
- `combi` se manda al identificarse.
- `puerta` llega a todo panel de la ruta.
- La baja limpia el privado personal.
- El comodín ya no administra cobradores.
- La sesión se renueva con el uso.
- En producción, el servidor no arranca con otra base que la configurada.
- En la web: el bucle de reconexión (869 sockets en 10 s, ahora 1), la combi
  de hoy viene del servidor, el vigía cuidado, los contadores por hora y
  «Escribir» a alguien de otra ruta.
- En la nativa: el vigía, `redeclara`, los avisos.
- APK 0.3.0 / versionCode 6, con `autoIncrement`.
- El chequeo de sintaxis ahora detecta variables usadas antes de declararse.

**Archivos.** `server/index.js`, `app/App.js`, `app/protocolo/cliente.js`,
`app/puerta.js`, `project/Prototipo.html`, `project/despacho.html`,
`project/realtime.js`, `app/app.json`, `app/eas.json`, y en `pruebas/`:
`zona-muerta.js`, `chk-*.js`.

**Mirar.**
- Una APK vieja (sin `redeclara`) con otro manejando todavía puede tomar la
  combi al reconectar; la marca del relevo solo cubre al que relevaron.
- Si Despacho cambia la combi con la pantalla en ruta, el chofer vuelve a la
  puerta y se declara `fuera`.
- El supervisor recibe los privados personales de **todas** las rutas.

**Pruebas.** `revision-apk` (nueva); `vigia-puerta`, `nativas`, `contraste`
y `combis` ampliadas. **Manual:** sí (vigía y relevo). Detalle: REPASO,
tanda 15.

## 2. El SOS grita en Despacho — `c406ebd`, `51ab077` (31/10)

**Qué.**
- Alarma con Web Audio hasta que alguien marca ATENDIDO.
- Notificación del navegador que queda hasta tocarla (`requireInteraction`).
- El título de la pestaña parpadea.
- «Activar alarma de SOS» mientras el navegador la tenga muda o falte el
  permiso.
- ATENDIDO queda en la base (`atendidoPor`, `atendidoEn`) y se cierra en
  todos los paneles.
- Al conectar llegan los SOS que siguen abiertos.
- El informe de emergencias suma quién lo atendió y en cuántos minutos.
- De paso: en el celular, «Salir» quedaba fuera de la cabecera de Despacho,
  y Despacho no tenía ícono de pestaña (404 de `favicon.ico`).

**Archivos.** `server/index.js` (`atenderSos`, `sosAbiertosDe`,
`panelVeRuta`), `project/despacho.html` (`alarmaSos`, `notificarSos`).

**Mirar.**
- Si nadie toca el panel después de recargarlo, no suena hasta el primer
  clic. El navegador no deja evitarlo; la única mitigación es el botón ámbar
  a la vista.
- Los SOS abiertos se muestran hasta 24 h (`SOS_ABIERTO_MS`).

**Pruebas.** `sos-despacho`. **Manual:** sí (Cuando llega un SOS). Detalle:
REPASO, tanda 16.

## 3. «Despacho vio tu SOS» — `d552f33` (03/11)

**Qué.**
- `sos_atendido` le llega también al que pidió ayuda y a los que van en esa
  combi.
- Al reconectar se le avisa si su último SOS de las últimas 2 h ya fue
  atendido.
- Cartel verde en la web y en la nativa, hasta que se lo toca.

**Archivos.** `server/index.js` (`avisarAlQuePidio`, `sosVistoAlConectar`),
`project/Prototipo.html`, `project/realtime.js`, `app/App.js`,
`app/protocolo/cliente.js`.

**Mirar.**
- En la nativa, los carteles cerrados se recuerdan solo en memoria: si se
  reabre la app dentro de las 2 h, vuelve a salir una vez.
- Con dos SOS donde se atendió solo el primero, al reconectar no se dice
  nada.

**Pruebas.** `sos-despacho` (ampliada). **Manual:** no. Detalle: REPASO,
tanda 17.

## 4. La salud del servidor — `aee142b` (03/11)

**Qué.**
- `server/salud.js` revisa:
  - que la base lea y escriba (escribe un latido);
  - los errores de base recientes;
  - el disco libre del volumen;
  - la edad del último respaldo;
  - la zona horaria y el modo WAL;
  - si el servidor está trabado.
- `GET /salud` es público y sin números: 503 si hay un problema, 200 si
  solo hay avisos.
- El servidor se revisa cada minuto y avisa por `ALERTA_URL` cuando el
  estado cambia.
- `railway.json` usa `/salud` como healthcheck.
- El panel del creador muestra los números en SISTEMA.
- De paso: con el disco lleno, la renovación de sesión ya no hace fallar
  todos los pedidos con 500.

**Mirar.**
- `railway.json` cambia cómo despliega Railway.
- El latido es una escritura por minuto.
- Lo que cuenta como problema y lo que cuenta como aviso es una decisión:
  conviene revisarla.

**Pruebas.** `salud`. **Manual:** no. Detalle: REPASO, tanda 17.

## 5. La copia afuera y cómo volver — `48d846a` (03/11)

**Qué.**
- `server/copia-afuera.js`: cada respaldo verificado sube comprimido y
  cifrado (AES-256-GCM, clave por scrypt de `RESPALDO_CIFRADO`) a un bucket
  compatible con S3. La firma SigV4 está escrita a mano, sin dependencias, y
  probada contra los ejemplos de AWS.
- `server/restaurar.js`: `RESTAURAR_DESDE` restaura antes de abrir la base.
  - Guarda la base anterior al lado.
  - Deja una marca para no repetir la restauración.
  - Si algo falla, no arranca y no toca la base.
  - También funciona desde una computadora, por línea de comandos.
- Avisos en `/salud`; listado en el panel del creador (RESPALDOS).
- `TAREAS-FUERA-DEL-CODIGO.md` (nuevo).

**Mirar.**
- **No se probó contra un R2 o B2 real**, solo contra un S3 de mentira que
  verifica la firma.
- Con un nombre mal escrito en `RESTAURAR_DESDE`, el servicio queda caído
  hasta corregirlo. Es a propósito, pero conviene confirmarlo.
- Los respaldos viejos los borra la regla de vencimiento del bucket.

**Pruebas.** `copia-afuera`. **Manual:** no. Detalle: REPASO, tanda 18.

## 6. La salud del teléfono en Despacho — `2e70e9e` (03/11)

**Qué.**
- La nativa manda con sus posiciones la batería, si carga y si Android le
  aplica ahorro de batería. Lo lee una vez por minuto, sin esperar al módulo
  nativo.
- La web manda la batería del navegador.
- El servidor lo guarda en memoria y lo manda **solo** a los paneles de la
  ruta (`telefonos`).
- La tarjeta muestra la batería y la versión; en ámbar, «se está por
  apagar», «ahorro de batería activado» y «app vieja».
- La política de privacidad declara el dato nuevo y la copia cifrada.

**Mirar.**
- Si `expo-battery` contesta dentro de la tarea de fondo solo se ve en un
  teléfono real. Si no contesta, el campo va en blanco.

**Pruebas.** `telefono`. **Manual:** sí (avisos de la tarjeta). Detalle:
REPASO, tanda 19.

## 7. El SOS sin internet: llamar o mandar SMS a la central — `9b229a4` (03/11)

**Qué.**
- La cooperativa tiene un **teléfono de la central**
  (`companies.telefonoCentral`).
  - Lo carga la gerencia en Gestión → Empresa; Despacho no puede.
  - Se normaliza y se valida: dígitos, con `+` opcional, entre 3 y 15.
  - Viaja con el login, así queda guardado en el teléfono y sirve sin
    datos, y con `/marca`, para tomar un cambio sin volver a entrar.
- Si el SOS no sale, en vez del cartel que se iba solo a los 4 s (web) o a
  los 3,5 s (nativa) queda un panel hasta que se lo cierra:
  - **LLAMAR A LA CENTRAL** (`tel:`).
  - **MANDAR SMS A LA CENTRAL**, con la combi, el nombre, la posición y un
    enlace a Google Maps.
  - Los números de emergencia del Perú: 105 Policía, 106 SAMU, 116
    Bomberos.
  - Sin teléfono de central cargado, lo dice y quedan los de emergencia.
- **De paso, dos errores de la app nativa que no se veían** los encontró un
  chequeo nuevo de identificadores sin declarar (en `pruebas/zona-muerta.js`,
  dentro de `npm run sintaxis`):
  - `Grabar` (la nota de voz del chat) usaba `C.rojo` sin haber sacado `C`
    del tema. **Mantener apretado el micrófono tiraba «C is not defined».**
    Estaba desde antes de esta rama.
  - El panel nuevo usaba `sesion` adentro de `Ruta`, donde no existe. Se
    cazó antes del commit.

**Archivos.**
- `server/index.js`: `telefonoValido`, `/admin/company`, el login, `/marca`.
- `project/despacho.html`: el formulario de la empresa.
- `project/Prototipo.html`: `textoSmsSos`, `urlSms`, el panel.
- `project/realtime.js`: `pedirMarca`, `posicionReciente`.
- `app/App.js`: `SosSinRed`, `Grabar`.
- `pruebas/zona-muerta.js`, `pruebas/chk-rn.js`, `pruebas/chk-html.js`.

**Mirar.**
- **Los números de emergencia son de Perú** y están fijos en el código. Con
  una cooperativa de otro país habría que hacerlos configurables.
- En el SMS, el formato `sms:<número>?body=` es el de Android; en iPhone el
  cuerpo puede no prellenarse (el número sí).
- La posición del SMS es la última del GPS de la app si tiene **menos de un
  minuto** en la web, o de dos en la nativa. Si es más vieja, el SMS dice «no
  tengo mi posición».
- El texto del panel de la nativa va en tinta de fondo sobre rojo: 5,4:1 de
  día y 3,9:1 de noche (el blanco daba 3,0 y 3,4).
- En la nativa, el número nuevo llega al abrir la app (con `/marca`); si no
  hay internet en ese momento, queda el de la última vez.

**Pruebas.** `sos-sin-red` (nueva, en Chromium: con el servidor apagado,
desliza el SOS y mira el panel, los `tel:`, el SMS y el caso sin central).
`paneles` y `nativas` actualizadas. **Manual:** no (a pedido: todavía no va
al PDF).

## 8. Corregir horas a mano, con quién y por qué — `2cf99d5` (04/11)

**Qué.** Despacho (o la gerencia) puede, desde Gestión → Turnos:
- **Corregir** la entrada o la salida de un turno (el que se olvidó de salir
  de ruta, el que dejó la combi antes de lo que marcó).
- **Anular** un turno (el que dejó la app abierta en su casa). Queda con
  duración cero, visible y marcado; no se borra.
- **Agregar** un turno que no se registró (el teléfono se apagó, se cayó el
  servidor).

Siempre con **motivo obligatorio**. Queda en una tabla nueva
(`correcciones_turno`) con el antes, el después, quién y cuándo, y además en
la Actividad. La lista de turnos marca cada fila «CORREGIDO / AGREGADO /
ANULADO A MANO» (el título dice quién y por qué), el editor muestra las
correcciones anteriores, y el informe de horas (`horas.csv`) tiene una
columna nueva, *Corrección a mano*.

**Cómo.** La corrección **edita el turno** en `shifts` y lo marca
(`corregido = 1`). Así todo lo que calcula horas —la lista, el informe, el
resumen del gerente, el perfil del chofer, las vueltas propias— ve lo
corregido sin cambiar cada consulta. Un turno corregido **no se vuelve a
abrir solo** cuando la persona reconecta dentro de los 15 minutos
(`abrirTurno` lo excluye).

**Reglas** (del lado del servidor):
- el motivo, de 5 a 200 caracteres;
- hasta **31 días** atrás (`CORRECCION_DIAS`);
- un turno no puede durar más de **24 h** ni terminar en el futuro;
- **no se puede pisar** con otro turno de la misma persona (las horas se
  contarían dos veces);
- solo los turnos de las rutas que ese Despacho ve; al agregar, solo choferes
  y cobradores de la cooperativa, en una combi de su ruta.

**Archivos.**
- `server/index.js`: `correcciones_turno`, `horarioValido`, `seSuperpone`,
  `POST /admin/shifts/:id/correccion`, `POST /admin/shifts`,
  `GET /admin/shifts/:id/correcciones`, la lista y el informe de horas, y
  `abrirTurno`.
- `project/despacho.html`: la pestaña Turnos y las etiquetas de la Actividad.

**Mirar.**
- **El chofer no se entera** de que le corrigieron las horas: las ve
  corregidas en su perfil, sin marca ni aviso. ¿Debería llegarle un aviso, o
  ver la marca? Es una decisión de política laboral, no técnica.
- Corregir un turno **abierto** lo cierra. Si la persona sigue manejando,
  sus horas siguientes no se cuentan hasta que el sistema le abra un turno
  nuevo (al volver a salir a ruta). Es lo que se quiere en «se olvidó de
  salir», pero no en otros casos.
- **Los 31 días** son una decisión: lo de antes se supone liquidado.
- Corrige cualquier Despacho, no solo la gerencia. ¿Debería ser solo la
  gerencia?
- Las fechas del formulario salen en el formato del navegador (`datetime-local`).

**Pruebas.** `correccion-horas` (nueva): las reglas, corregir, agregar,
anular, el historial, la Actividad, la lista, el informe, que un corregido no
se reabre, la otra ruta, y la pantalla en Chromium. Además pasan `horas`,
`csv`, `gerencia`, `perfil`, `numeros`, `numeros-ui`, `poda`, `retencion`,
`semana` y `periodo`. **Manual:** no.

## 9. Alta de muchas personas desde una planilla — `c45d582` (04/11)

**Qué.** En Despacho → Gestión → Personas → **Cargar una planilla**:
- Acepta **Excel (.xlsx)**, **LibreOffice o Google Sheets (.ods)**, **CSV**
  (con coma o punto y coma, en UTF-8 o en el Windows-1252 del Excel viejo) y
  **las celdas copiadas y pegadas** de cualquier planilla.
- El **.xls** viejo se reconoce y se explica cómo guardarlo.
- Las columnas se reconocen por su título, como sea que esté escrito
  («Nombre y apellidos», «Contraseña», «Vehículo», «Cargo»…).
  - Obligatorias: **Nombre** y **Combi** (una que ya exista).
  - Opcionales: Usuario, Rol, Clave, Alias, Ruta.
- Va en dos pasos:
  1. **Revisar** no guarda nada y muestra fila por fila qué se crearía y qué
     no, y por qué.
  2. **Crear** guarda las filas buenas, salta las otras y devuelve **las
     claves una sola vez**, con un CSV para repartirlas.
- Si falta el usuario, se arma uno con el nombre (`nusta.ccama`); si falta la
  clave, se genera una.
- Hay una **planilla de ejemplo** para bajar.

**Cómo.**
- `server/planilla.js` lee todos los formatos **sin dependencias nuevas**:
  `.xlsx` y `.ods` son un ZIP con XML adentro y se abren con el `zlib` de
  Node, con un tope contra archivos que se inflan de más.
- Cada fila pasa por **`altaDePersona`**, la misma función que el alta de a
  uno. La saqué del endpoint para que las dos den de alta exactamente igual.
- «Revisar» corre el alta de verdad adentro de una transacción que después
  se deshace.

**Archivos.**
- `server/planilla.js` (nuevo).
- `server/index.js`: `altaDePersona`, `POST /admin/users/importar`,
  `COLUMNAS_ALTA`, `usuarioDesdeNombre`.
- `project/despacho.html`: `CargaMasiva`.
- `project/planilla-alta-ejemplo.xlsx` (nuevo).
- `pruebas/planillas/`: archivos de prueba hechos con LibreOffice y openpyxl.

**Mirar.**
- **Subir dos veces la misma planilla no duplica a nadie**: si una fila no
  trae usuario y ya hay alguien con el mismo nombre, no se crea y se dice. El
  costo: dos personas que de verdad se llaman igual necesitan un usuario en
  la planilla.
- **En la planilla la combi es obligatoria**, aunque de a uno no lo sea (de
  a uno, la gerencia puede crear un chofer y su combi con el mismo código).
  En una planilla eso llenaba la flota de combis llamadas «raul.condori».
- Tope de 500 personas y 700 kB por planilla.
- Las claves generadas son del estilo de las del formulario (`juliaca5094`):
  conviene que cada uno la cambie al entrar.
- Lo que no se lee: hojas protegidas con contraseña, fórmulas (se lee el
  último valor que guardó el programa), y solo la **primera hoja**.

**Pruebas.** `alta-masiva` (nueva): el lector con archivos de verdad, revisar
sin guardar, crear con claves que sirven para entrar, que no se duplica, las
mismas reglas que de a uno, lo que no se puede leer, y la pantalla en
Chromium (subir, revisar, crear y bajar las claves). **Manual:** no.

## 10. La evidencia, y cuánto se guardan fotos y audios — `ec42b7e` (04/11)

**Qué.**
- **Antes**, el servidor guardaba el contenido de las **20 fotos y las 30
  notas de voz más nuevas de todo el servidor**. Con varias cooperativas, la
  foto de un choque se podía perder en horas por el chat de otra, y la
  política de privacidad dice «30 días».
- **Ahora**:
  - Fotos y audios guardan su contenido **30 días** (`MEDIA_DIAS`). Pasado
    eso queda la burbuja («ya no disponible») hasta que se borra el chat.
  - El tope de cantidad (1500 fotos y 1500 audios) es **por cooperativa** y
    es sólo un cinturón para el disco: una cooperativa no le borra nada a
    otra.
  - En Despacho, debajo de cada mensaje del chat (texto, foto o audio), un
    enlace **«Guardar como evidencia»**: se escribe el motivo (obligatorio) y
    el mensaje queda marcado con **EVIDENCIA · quién: motivo** en ámbar.
    - Lo marcado **no pierde el contenido ni se borra** con el chat: se queda
      **365 días**, como un SOS.
    - Se puede **quitar** la marca. Las dos cosas quedan en la Actividad.
    - Los otros paneles lo ven al momento.
    - No se puede marcar sin motivo, lo que ya expiró, ni lo de otra
      cooperativa. Hay un techo de **500** por cooperativa para que
      «evidencia» no se vuelva la forma de guardar todo.
  - El informe de mensajes (`mensajes.csv`) tiene una columna **Evidencia**
    (`sí · quién · motivo`).
  - Al conectar, cada pantalla recibe el historial del chat. Ahora lo pesado
    que viaja ahí tiene un **presupuesto de 3 MB** (de lo más nuevo a lo más
    viejo). Lo que no entra llega como **«cargar foto»** o **«cargar nota de
    voz»** en Despacho y se baja al tocarlo.

**Cómo.**
- `server/index.js`:
  - Columnas nuevas en `messages`: `evidencia`, `evidenciaPor`,
    `evidenciaEn`, `evidenciaMotivo`.
  - Todas las podas de mensajes excluyen `evidencia = 1`
    (`pruneChatStmt`, `pruneRowsStmt`, `pruneMediaStmt`,
    `pruneMediaViejaStmt`); `pruneEvidenciaStmt` la borra a los `SOS_DIAS`.
  - `pruneMediaStmt` ahora filtra por la cooperativa del mensaje (por
    `routes.companyId`) y `remember()` lo corre con la de la ruta.
  - `pruneMediaViejaStmt` (dentro de `podarHistorico`, que corre al arrancar
    y cada 6 h) suelta el contenido de lo pesado pasado `MEDIA_DIAS`.
  - Índice parcial `idx_messages_media_viva` para que las podas de lo pesado
    no recorran la tabla.
  - `msgId` en `chat_msg`/`voice_msg`/`photo_msg` en vivo y en el
    historial, con los campos de evidencia.
  - `POST /admin/mensajes/:id/evidencia` y `GET /admin/mensajes/:id/contenido`.
  - `conPresupuesto()` sobre `recentHistory()`.
- `project/despacho.html`: componente `Evidencia` en la burbuja, el aviso
  `evidencia` por WebSocket, «cargar» para lo que vino aparte, y los dos
  rótulos nuevos en la Actividad.
- `server/privacidad.html`: la tabla de retención separa texto, fotos y
  audios, y evidencia.
- `modelo-costos.js`: cuenta 30 días de fotos y audios, y el volumen cuenta
  los **28 respaldos enteros** (antes «base × 1,5»).

**Archivos.** `server/index.js`, `project/despacho.html`,
`project/service-worker.js` (v86), `server/privacidad.html`,
`modelo-costos.js`, `pruebas/evidencia.js` (nueva), `pruebas/poda.js` (el
patrón que lee la consulta admite el filtro de evidencia), `PROTOCOLO.md`,
`README.md`.

**Mirar.**
- **El disco.** Es lo más importante de este parche. Antes el contenido
  pesado era como mucho 50 archivos; ahora es un mes. Y cada respaldo local
  es una copia entera de la base, y se guardan 28. El modelo de costos, con
  el peor caso de foto (1,2 MB), da: piloto 0,24 GB de base → **7 GB de
  volumen**; 500 unidades → 157 GB. En la calle una foto de la app pesa más
  bien 250–350 kB, o sea cerca de un cuarto de eso. Ver la decisión en
  `TAREAS-FUERA-DEL-CODIGO.md`.
- La app del chofer (web y nativa) muestra lo que vino `aparte` como
  expirado. Para el chofer está bien (es lo viejo del chat), pero no es
  cierto: sigue guardado y Despacho lo ve.
- La evidencia se marca **sobre el mensaje**: si el chofer manda tres fotos
  del choque, son tres marcas.
- Desmarcar no recupera nada: si una foto marcada tenía más de 30 días, en
  la próxima barrida (cada 6 h) pierde la imagen.
- `pruneMediaStmt` (el tope por cantidad) sigue escrito con
  `id NOT IN (… LIMIT @conservar)`, el patrón que `poda.js` evita en las
  otras tablas. Acá queda acotado por el índice parcial nuevo (sólo recorre
  lo que todavía tiene contenido, de esa cooperativa) y corre una vez por
  foto o audio, no por mensaje. Si con muchas cooperativas se nota, pasarlo
  al corte por rango.

**Pruebas.** `evidencia` (nueva): el tope por cooperativa, la poda por
tiempo (insertando mensajes viejos y rearrancando), las reglas de marcar, el
historial, el aviso al otro panel, el informe, el presupuesto del historial y
el pedido aparte, y en Chromium marcar, verlo en otro panel, quitarlo y
cargar una foto que vino aparte. Siguen pasando `foto`, `chat`, `poda`,
`retencion`, `privado-persona`. **Manual:** no.

## 11. La auditoría por tipo — `7e54e25` (04/11)

**Qué.**
- **Antes**, la auditoría (la Actividad de Despacho) guardaba **1000
  movimientos por cooperativa**, todos juntos. Con 20 combis, los inicios de
  sesión y los desvíos que anota el sistema solo llenan eso en días, y se
  llevaban puestas las altas, las bajas y los cambios de clave: justo lo que
  hay que poder contestar meses después.
- **Ahora** cada movimiento tiene un **tipo**, y cada tipo su plazo y su
  techo por cooperativa:

  | Tipo | Qué | Plazo | Techo |
  |---|---|---|---|
  | **Accesos** | inicios de sesión, bloqueos por intentos, entrar con la cooperativa suspendida | 90 días | 20 000 |
  | **Operación** | desvíos, vueltas parciales, entradas tardías, GPS falso, SOS y SOS atendido, relevos, cambios de combi, grabaciones, avisos vistos | 365 días | 50 000 |
  | **Gestión** | todo lo demás: altas, bajas, claves, correcciones de horas, evidencia, configuración de la ruta y de la empresa | 730 días | 20 000 |

- Una acción **que nadie clasificó** (una nueva que se agregue mañana) es
  **gestión**: se guarda de más, nunca de menos.
- En Despacho → Gestión → **Actividad**: botones **Todo / Gestión /
  Operación / Accesos**, **«Ver más viejos»** (de a 100) y el pie dice
  cuánto se guarda cada tipo.
- El informe *Actividad de administración* (CSV) tiene la columna **Tipo**.
- `/privacidad` lo dice.

**Cómo.**
- `server/index.js`:
  - Columna `clase` en `audit` e índice `(companyId, clase, id)`.
  - `CLASE_AUDIT` (qué acción es qué) y `AUDIT_CLASES` (plazo y techo, por
    variables de entorno).
  - Al arrancar, lo que estaba sin clase se clasifica una vez.
  - `audit()` guarda la clase y corta el techo **de esa clase** por rango
    (`auditTechoStmt`). Antes era un `id NOT IN (…)` que recorría los 1000
    de la empresa en cada movimiento.
  - `podarHistorico()` borra cada clase pasado su plazo.
  - `GET /admin/audit` acepta `?clase=` y `?antes=<id>`, y devuelve `id`,
    `clase`, `hayMas` y `plazos`.
- `project/despacho.html`: botones de tipo, «Ver más viejos» y el pie.
- `modelo-costos.js`: la auditoría ocupa hasta los tres techos (unos 18 MB
  por cooperativa en el peor caso).

**Archivos.** `server/index.js`, `project/despacho.html`,
`project/service-worker.js` (v87), `server/privacidad.html`,
`modelo-costos.js`, `pruebas/auditoria.js` (nueva), `README.md`,
`PROTOCOLO.md`, `LIMITACIONES.md`.

**Mirar.**
- **La lista de qué es qué** (`CLASE_AUDIT`). La decisión discutible: el
  **SOS** quedó en operación (365 días, lo mismo que el mensaje del SOS), no
  en gestión. Y *cerrar todas sus sesiones* o *cambié mi clave* quedaron en
  gestión, aunque los haga el propio chofer.
- Fue una tabla con un tipo y no dos tablas (la otra opción del pendiente):
  así todo lo que ya lee la auditoría —la Actividad, el informe, las
  entradas tardías del informe por unidad— sigue andando sin cambios.
- El creador sigue escribiendo en su casillero (`__plataforma__`) con las
  mismas clases: sus inicios de sesión se van a los 90 días.

**Pruebas.** `auditoria` (nueva): la ráfaga de inicios de sesión contra la
gestión y contra la otra cooperativa, los techos y los plazos por clase
(rearrancando), la clasificación de lo viejo, el filtro y la paginación, el
informe y la pantalla en Chromium. **Manual:** no.

## 12. Ley 29733: el consentimiento y la carpeta `legal/` — `be68f11` (04/11)

**Qué.** El punto 10 es sobre todo trámite, así que acá hay más papeles
que código:
- **`legal/LEEME.md`**: quién es quién ante la ley (la cooperativa es
  responsable de los datos de su gente; el operador es *encargado*), los
  pasos en orden, las preguntas para el abogado, qué hacer ante una
  filtración (48 horas para avisar a la ANPD) y la lista de proveedores.
  Con el reglamento vigente (D.S. 016-2024-JUS), verificado el 04/11.
- **`legal/contrato-encargo.md`**: borrador del contrato con cada
  cooperativa. Las cláusulas técnicas (seguridad, plazos, proveedores,
  borrado al terminar) describen lo que el sistema hace de verdad.
- **`/consentimiento`**: el formulario para imprimir y firmar, dos carillas
  A4. Dice lo mismo que `/privacidad`, en particular **la ubicación con la
  pantalla apagada** y la salida a ruta automática, cada una en su propia
  casilla. Lleva la versión, el contacto y la dirección entera de la
  política.
- En Despacho → Gestión → Personas, arriba de la lista: **«Consentimiento de
  datos personales: N de M firmaron · faltan K»**. Al abrirlo:
  - Cada chofer y cobrador, con su estado: *firmó el dd/mm/aaaa*, *falta
    firmar*, o *firmó la versión X: falta firmar la nueva*.
  - **Anotar firma**, con la fecha del papel.
  - **Lo retiró**, con cómo lo pidió; el botón nombra a la persona.
  - El enlace para abrir el formulario e imprimirlo.
- `/privacidad`: fecha de vigencia al 4 de noviembre (cambió en los puntos 8
  y 9) y el enlace al formulario.

**Cómo.**
- `server/consentimiento.html` (nuevo, sin scripts) y la ruta
  `/consentimiento`, que reemplaza el contacto, la versión y la dirección
  del servidor.
- `CONSENTIMIENTO_VERSION` en `server/index.js`.
- Columnas `consentimientoFecha`, `consentimientoVersion` y
  `consentimientoPor` en `users`, y `POST /admin/users/:unitId/consentimiento`
  con sus reglas: fecha real y no futura, sólo choferes y cobradores, sólo
  de la propia cooperativa, el retiro con motivo.
- Dos acciones nuevas en la Actividad (clase gestión, se guardan 2 años).
- `PanelConsentimiento` en `project/despacho.html`.

**Archivos.** `legal/LEEME.md` y `legal/contrato-encargo.md` (nuevos),
`server/consentimiento.html` (nuevo), `server/index.js`,
`server/privacidad.html`, `project/despacho.html`,
`project/service-worker.js` (v88), `pruebas/consentimiento.js` (nueva),
`README.md` (`CONTACTO_PRIVACIDAD`), `PROTOCOLO.md`.

**Mirar.**
- **Los textos legales los tiene que revisar un abogado.** Lo marcado
  **[confirmar]** en `legal/LEEME.md` es interpretación. La duda grande: si
  la ubicación de un trabajador necesita consentimiento o entra en la
  excepción de la relación laboral, y que muchos choferes son socios o
  dueños de la combi, no empleados.
- Si se cambia `/privacidad` hay que cambiar `/consentimiento` y subir
  `CONSENTIMIENTO_VERSION`. Hoy eso depende de acordarse: está escrito en
  los comentarios de los dos archivos, pero ninguna prueba compara los
  plazos de uno con los del otro.
- Retirar el consentimiento **no apaga nada**: lo anota. Qué hace la
  cooperativa después es decisión de ella.
- Faltante de código que apareció: **bajar todo lo de una persona**
  (derechos de acceso y portabilidad). Quedó como PENDIENTES 0.14.

**Pruebas.** `consentimiento` (nueva): el formulario, las reglas del
registro, la Actividad, el panel en Chromium (contar, anotar, versión vieja,
retiro) y que el formulario se lea en un teléfono. **Manual:** no.

## 13. Actualizar la app sin reinstalar (EAS Update) — `3b98cea` (04/11)

**Qué.**
- La app del chofer trae `expo-updates`. El **JavaScript** (pantallas, chat,
  SOS, puerta…) se publica con **`publicar-arreglo.bat`** y los teléfonos lo
  bajan solos, ~1 MB comprimido.
- Lo **nativo** (un permiso, un módulo, la versión de Expo) sigue
  necesitando una APK nueva con `compilar-app.bat`.
- **Cuándo se aplica.** Aplicar es reiniciar el JavaScript, así que:
  - **nunca en ruta**, ni ausente, ni con el vigía de la puerta contando,
    ni con un SOS sin salir en pantalla;
  - en la puerta, sólo cuando la app **vuelve al frente**;
  - en la pantalla de entrada, siempre.
  - La app pregunta al arrancar (sin esperar la respuesta: con mala señal no
    se cuelga) y al volver al frente, cada media hora como mucho.
- **Canales.** `prueba` (una APK aparte para tu teléfono), `apk` (los
  choferes), `produccion` (Google Play). El `.bat` ofrece:
  1. **PRUEBA** — empezar siempre por acá;
  2. **TODOS**;
  3. **PLAY**;
  4. **VOLVER ATRÁS** — los teléfonos vuelven al JavaScript de su APK.
- **Despacho ve quién la tomó**: en Personas, «app 6 · act. 05/11 09:00»;
  en la tarjeta del mapa, «APP 0.3.0 · 05/11 09:00». En el perfil del
  chofer, «actualizada 05/11 09:00».
- **La guardia de lo nativo.** Una actualización sólo llega a las APK con
  la misma `version` de `app.json`. Si cambia algo nativo y la versión no
  sube, caería en teléfonos sin esa parte y la app se rompería. La suite
  `actualizacion` guarda una foto de lo nativo (`app/nativo.json`) y falla
  si cambió sin subir la versión.
- `compilar-app.bat` tiene la opción **[3]**: la APK de prueba de
  actualizaciones.

**Cómo.**
- App:
  - `app/actualizacion.js` (nuevo, puro): `sePuedeAplicar` y `tocaPreguntar`.
  - `app/version.js`: `actualizacionDe()` y la cabecera
    `0.3.0/6+AAAAMMDD-HHmm`.
  - `app/App.js`: un efecto pregunta, baja y aplica. Es el único
    `Updates.reloadAsync`, y está detrás de `sePuedeAplicar`.
  - `app/gps/servicio.js`: la etiqueta en cada envío.
  - `app.json`: `runtimeVersion: appVersion`, `updates.url`, `ON_LOAD`,
    `fallbackToCacheTimeout: 0`.
  - `eas.json`: los canales y el perfil `prueba`.
  - `package.json` y el lockfile: `expo-updates ~29.0.19`, la del SDK 54
    según el propio paquete de Expo.
- Servidor: `users.appActualizacion`; `versionDeApp` lee la etiqueta del
  cuerpo o de la cabecera (una con otro formato se ignora); va en
  `/admin/users` y en el estado del teléfono.
- Despacho: `fechaActualizacion()` y las dos líneas que la muestran.

**Verificado fuera de las pruebas.** En una copia aparte, con las
dependencias instaladas:
- `expo config` lee la configuración nueva;
- `expo export` arma el paquete de Android (803 módulos, 2,5 MB, 1 MB
  comprimido);
- la dirección del servidor queda adentro del JavaScript.

**Archivos.**
- Nuevos: `app/actualizacion.js`, `app/nativo.json`,
  `publicar-arreglo.bat`, `pruebas/actualizacion.js`.
- Cambiados: `app/App.js`, `app/version.js`, `app/gps/servicio.js`,
  `app/app.json`, `app/eas.json`, `app/package.json`,
  `app/package-lock.json`, `compilar-app.bat`, `server/index.js`,
  `project/despacho.html` y `project/service-worker.js` (v89).
- Pruebas: `pruebas/nativas.js` (`expo-updates` en la lista del SDK).
- Docs: `app/README.md`, `README.md`, `PROTOCOLO.md`.

**Mirar.**
- **Nada de esto se probó en un teléfono.** La primera prueba de verdad es
  el paso 2 de `TAREAS-FUERA-DEL-CODIGO.md`: compilar las dos APK, publicar
  un cambio chico a PRUEBA y verlo llegar.
- **La dirección del servidor de cada canal está escrita en
  `publicar-arreglo.bat`.** Cuando se conecte `app.microstempo.com`, se
  cambia ahí y se publica: los teléfonos pasan al dominio sin reinstalar.
  Pero mientras tanto, un arreglo publicado con la dirección equivocada
  manda a todos los teléfonos a otro servidor. Por eso: siempre a PRUEBA
  primero.
- `runtimeVersion: appVersion` (y no `fingerprint`, que lo calcula solo):
  es predecible y se entiende («si cambia algo nativo, subí la versión»), y
  la guardia de la suite cubre el olvido. `fingerprint` puede dar distinto
  en la PC de Windows que en la nube de Expo, y entonces las actualizaciones
  no llegan sin que nadie se entere.
- El cobrador nunca «sale a ruta»: para él la actualización también se
  aplica sólo al volver la app al frente.
- EAS Update es gratis hasta 1000 teléfonos activos por mes. Después,
  US$ 19 por mes cubre 3000.

**Pruebas.** `actualizacion` (nueva): cuándo se aplica, la etiqueta y la
cabecera, el cableado de la app y de los `.bat`, la guardia de lo nativo, y
el servidor y Despacho (Chromium). `nativas` cubre ahora `expo-updates`.
**Manual:** no (es del que opera, no del chofer).

## 14. Un reinicio no tira las vueltas — `ddb84d8` (04/11)

**Qué.**
- **Antes**, un reinicio del servidor (un deploy, un cuelgue) perdía todo lo
  que estaba a medias:
  - Cada combi que volvía a mandar parecía «recién llegada», y se le
    **descartaba la vuelta en curso**.
  - Los desvíos, paradas y huecos de señal abiertos se cerraban como
    «cortados».
  - La variante que Despacho había activado a mano volvía a la programada:
    otro cambio de trazado y otra vez las vueltas descartadas.
  - Un deploy en hora pico le tiraba la vuelta a cada combi.
- **Ahora** el servidor saca una **foto de esa memoria** y la guarda en la
  base:
  - al recibir **SIGTERM**, que es lo que manda Railway antes de apagar un
    deploy viejo;
  - y **cada 15 s**, para el cuelgue sin aviso.
- Al arrancar, si la foto tiene **menos de 10 minutos**, la retoma tal
  cual:
  - la flota en vivo, las vueltas y los tramos en curso, los desvíos,
    paradas y huecos abiertos, el tráfico avisado;
  - la presencia de cada combi y el «ausente en marcha»;
  - la última salida, la puerta y la variante a mano (hasta medianoche,
    como siempre);
  - y la ventana del detector de paradas.
- Lo que estaba viejo lo limpian las reglas de siempre (el olvido de 3
  minutos, la poda), como si el servidor no se hubiera caído.
- Dos cuidados:
  - **El tiempo caído no cuenta como silencio del teléfono**: al retomar,
    el «último que lo oí» de cada combi se corre por lo que el servidor
    estuvo apagado. Si no, un deploy de 2 minutos más el silencio normal
    hacía olvidar combis que seguían trabajando.
  - **El reinicio no aparece como un corte de señal**: las combis
    retomadas tienen un minuto para volver a mandar antes de marcarlas «sin
    señal».
- El mapa de Despacho muestra las combis **apenas arranca**, antes de que
  manden su primera posición.

**Cómo.**
- `server/memoria.js` (nuevo): la tabla `memoria_caliente` (una fila),
  `guardar`, `leerPrevia` y `abiertosDe`.
- `server/index.js`:
  - `MEMORIA_PREVIA` se lee **apenas se abre la base**, antes de los tres
    cierres «corte» del arranque (desvíos, paradas, huecos), que ahora
    excluyen los ids que se van a retomar (`json_each`).
  - Al final, antes de `server.listen` (y antes de que el revisor de
    vigencias pueda cambiar el trazado), `retomarMemoria()`.
  - La foto periódica y el manejo de SIGTERM/SIGINT (guarda, cierra la base
    y sale con 0).
  - `retomadas` (aparte de la unidad, que viaja entera a las pantallas)
    suspende el «sin señal» de las recién retomadas.
  - El comentario de `vigenciaEnPausa` explica por qué ahora sobrevive.
- `server/parada.js`: `exportar`/`importar` de la ventana del detector.
- **La frecuencia se ajusta al peso.** Medido: 20 combis son ~30 kB; 5000
  son 8 MB y 60 ms. Cada 15 s eso serían ~46 GB escritos por día para un
  caso raro, así que hasta 1 MB es cada 15 s y después un intervalo más por
  MB, con techo de 2 minutos.
- No se retoma si el arranque es para volver a un respaldo
  (`RESTAURAR_DESDE`), ni con `MEMORIA=0`.

**Archivos.** `server/memoria.js` (nuevo), `server/index.js`,
`server/parada.js`, `pruebas/reinicio.js` (nueva), `README.md`
(`RETOMAR_MS`, `MEMORIA_CADA_MS`), `PROTOCOLO.md`, `LIMITACIONES.md`.

**Mirar.**
- **Qué NO se guarda**, a propósito: la ventana del detector de GPS
  simulado, la estimación del reloj de cada teléfono, el mando del GPS (el
  primero que manda lo toma), las sesiones de WebSocket y los cupos. Todo
  eso se vuelve a medir en segundos.
- **Los turnos ya se retomaban solos** (si la persona vuelve antes de 15
  minutos): no se tocó.
- Un **cuelgue sin aviso** pierde los últimos segundos (hasta 2 minutos con
  miles de combis). Un servidor **caído más de 10 minutos** arranca de cero,
  como antes: retomar una foto de hace media hora sería inventar.
- Que Railway dé tiempo entre SIGTERM y SIGKILL: guardar tarda
  milisegundos, así que alcanza aun con el mínimo. Pero conviene mirar en
  el log del primer deploy que aparezca «Memoria caliente guardada
  (SIGTERM)» y, en el arranque nuevo, «Memoria caliente retomada».

**Pruebas.** `reinicio` (nueva), con tres corridas:
- **Con memoria**: una combi a media vuelta y otra fuera del recorrido,
  SIGTERM y arranque. La vuelta se cierra entera y con la hora de antes; el
  desvío sigue abierto y se cierra por «regreso»; no hay entrada tardía ni
  corte de señal falsos; el mapa las muestra antes de que manden nada.
- **Cuelgue sin aviso** (SIGKILL): sirve la foto periódica.
- **Sin memoria** (foto vieja), lo de antes: la vuelta perdida y el desvío
  «cortado».

`variantes` cambió (en un commit aparte, después de la regresión):
- Usaba reinicios como truco para que el revisor de vigencias volviera a
  decidir, y contaba con que el reinicio borrara la pausa de la variante
  activada a mano. Ahora la pausa sobrevive, que es el punto, así que la
  suite arranca con `MEMORIA=0`.
- Ganó una comprobación nueva: activada a mano, un reinicio **con** memoria
  no la revierte.

**Manual:** no.

## 15. Bajar todo lo de una persona — `fd94fa0` (04/11)

**Qué.**
- Despacho → Gestión → Personas → **Editar** → **«Bajar todos sus datos
  (ZIP)»**. Es para cuando un chofer o cobrador pide una copia de lo que el
  sistema tiene de él: los derechos de acceso y portabilidad de la Ley
  29733. Antes había que armarlo a mano con los informes, y quedaban cosas
  afuera.
- El ZIP trae un **LEEME.txt**: de quién es, de qué cooperativa, quién lo
  generó, en qué hora están las horas, qué hay en cada archivo (con
  cuántos) y qué NO está y por qué.
- Lo que está **a nombre de la persona**:
  - su cuenta (sin la contraseña) y las combis que puede manejar;
  - sus turnos y las correcciones de horas;
  - sus mensajes y los privados que le mandaron, **con sus fotos y notas de
    voz** como archivos (la que ya expiró se dice, no se inventa);
  - sus grabaciones de recorrido, con los puntos;
  - la Actividad donde ella hizo algo o se lo hicieron.
- Lo que está **a nombre de la combi** (vueltas, tramos, desvíos, paradas,
  cortes de señal, presencia, anomalías) entra **sólo mientras ella la
  manejaba**, cruzado con sus turnos de chofer: la vuelta de la misma combi
  con otro chofer no es suya.
- Queda en la Actividad («bajó todos los datos de»).
- `/privacidad` dice que se puede pedir la copia. `legal/LEEME.md` ya no
  dice que falta.

**Cómo.**
- `server/zip.js` (nuevo): un ZIP escrito a mano sobre `zlib` (deflate y
  `crc32` de Node 22), con los nombres en UTF-8 por las tildes; las fotos y
  audios van sin recomprimir. Verificado con Python y con `unzip`.
- `server/index.js`: `datosDePersona()` y
  `GET /admin/users/:unitId/datos.zip`, con el mismo alcance que el resto
  de Personas (`cuentaEnAlcance`). «Mientras manejaba» es un `EXISTS`
  contra sus turnos de chofer en esa combi, para que dos turnos que se tocan
  no dupliquen filas.
- `project/despacho.html`: el botón en el panel de Editar y el rótulo de la
  Actividad.

**Archivos.** `server/zip.js` (nuevo), `server/index.js`,
`server/privacidad.html`, `project/despacho.html`,
`project/service-worker.js` (v90), `pruebas/datos-persona.js` (nueva),
`legal/LEEME.md`, `PROTOCOLO.md`.

**Mirar.**
- **Lo que no entra, a propósito:**
  - la contraseña (ni su huella);
  - lo que escribieron otros en el chat del grupo;
  - los privados **de la combi** (no de la persona): son del canal de la
    combi, los ve quien la maneje.
- Un turno **anulado** dura cero, así que lo de la combi en ese rato no se
  le atribuye. Un turno corregido usa las horas corregidas.
- No hay tope de tamaño. Lo más pesado son las fotos, que se conservan 30
  días (bloque 10).

**Pruebas.** `datos-persona` (nueva), con datos que **deben** entrar y otros
que **no**:
- el ZIP lo abre Python;
- de dos vueltas de la misma combi, sólo la suya;
- sus mensajes sí, los de otro no;
- la foto idéntica byte por byte;
- sin contraseña;
- otra cooperativa no puede;
- queda en la Actividad;
- la descarga en Chromium.

**Manual:** no.

## 16. Revisión integral de los bloques 1 a 15 — `31b3eea`, `5b6d644` (04/11)

**Cómo se hizo.**
- Cuatro revisores independientes, cada uno con un grupo de bloques
  (1–3, 4–7, 8–11, 12–15). Recibieron el código y lo que dice este
  archivo, no las conclusiones de quien lo escribió.
- Varios hallazgos vinieron confirmados con una prueba propia.
- Cada uno se volvió a verificar contra el código antes de tocarlo.
- Se arregló lo real. Lo que no, dice abajo por qué.

**Lo que se arregló**, de más grave a menos:

| # | Bloque | Qué pasaba | Arreglo |
|---|---|---|---|
| 1 | 9 | **Un .xlsx de 628 bytes tiraba el servidor de todas las cooperativas** por memoria (`r="ZZZZZ1"` = columna 12 millones, se asignaba antes del tope). Y uno de 2 kB con `<row>` sin cerrar lo congelaba 14 s | Tope de columna antes de asignar (y en .ods). Y el lector corre **en un hilo aparte** con 256 MB y 5 s: si se pasa, muere ese hilo y el servidor sigue (medido: 1 de 50 tics perdidos) |
| 2 | 1 | **Después de cada reinicio, un comodín podía manejar al cobrador de una combi ajena** (cambiarle la clave y entrar como él): la «migración» de habilitaciones corría en cada arranque y volvía permanente la combi elegida en la puerta | Corre **una sola vez** (tabla `migraciones`, `unaVez()`) |
| 3 | 15 | **El ZIP de una persona traía datos de OTRA si el usuario se reusaba**, incluso de otra cooperativa | Todo acotado a desde que se creó la cuenta y a las rutas (o combis) de su cooperativa. Prueba nueva con el caso |
| 4 | 5 | **La copia afuera congelaba el servidor**: leía, comprimía y cifraba la base entera en el hilo principal (4,7 s con 100 MB y 500 MB de memoria, cada 6 h; peor desde que las fotos duran 30 días) | Cifrado y subida **por partes y asíncronos**, mismo formato (medido: peor atraso del reloj 1 ms) |
| 5 | 1 y 10 | **La baja borraba lo guardado como evidencia** en el privado personal | Se desvincula de la persona (no lo hereda un usuario nuevo) y se conserva |
| 6 | 14 | **Un cuelgue retomaba lo que ya se había cerrado** después de la última foto: vueltas duplicadas, desvíos recerrados | Al retomar se descarta lo que la base ya cerró, los cierres sólo pisan filas abiertas, y la foto se usa una vez. Prueba nueva con el caso |
| 7 | 10 | **El motivo de la evidencia les llegaba a todos los choferes de la ruta** («posible despido de…») | Los campos de evidencia sólo van a los paneles |
| 8 | 10 | Cada conexión leía de la base **todas** las fotos del historial para descartar casi todas (~2 s de servidor congelado) | Primero el tamaño, después sólo el contenido de lo que entra |
| 9 | 4 | **Cualquier error de base** (hasta un `CONSTRAINT`) ponía `/salud` en 503 diez minutos: Railway podía rechazar un deploy | Sólo los graves: lleno, sólo lectura, E/S, dañada, no abre |
| 10 | 4 | `GET /salud` es público y **escribía en la base en cada pedido** | No escribe; contesta lo último si es de hace menos de 10 s |
| 11 | 8 | Se podía **mover un turno de hace 40 días** (ya liquidado) al período actual | Se rechaza corregir un turno de más de 31 días |
| 12 | 8 | Un Despacho de ruta **le agregaba horas a gente de otra ruta**, y el error de superposición le mostraba turnos de esa otra ruta | La persona tiene que ser de su ruta; el error no da datos de lo que no ve |
| 13 | 9 | «Revisar» y «Crear» con 500 filas **congelaban el servidor ~22 s** (500 huellas de clave en el hilo principal) | Revisar no calcula huellas; Crear las calcula en paralelo y fuera del hilo principal |
| 14 | 13 | **Se podía publicar un arreglo sobre una APK incompatible**: el .bat no corría la guardia | `publicar-arreglo.bat` corre `--guardia` y no publica si falla; la guardia mira también `newArchEnabled`, `scheme`, todo `android` e `ios` |
| 15 | 13 | **«Volver atrás» no se aplicaba como decía** (llega como `isRollBackToEmbedded`, no `isNew`); sólo servía para un canal y decía «Listo» aunque fallara | Cuenta como pendiente; el .bat pregunta el canal y revisa el error |
| 16 | 13 | El primer chequeo al abrir la app podía **recargarla bajo el dedo** en la puerta | Al arrancar sólo baja; aplica en la próxima vuelta al frente |
| 17 | 1 | En la nativa, la salida automática del vigía **sin red se volvía un relevo de verdad** al reconectar (se mandaba sin su motivo) | El motivo pendiente se guarda y va al reconectar, como en la web |
| 18 | 2 | Despacho **no sacaba los SOS que atendió otro panel** mientras estaba cortado: seguía sonando | `sos_abiertos` es la lista entera: lo que no está, se va |
| 19 | 2 | **ATENDIDO se daba por hecho sin confirmación**; con la conexión medio muerta no salía y nadie se enteraba | Se saca recién con el eco del servidor («ENVIANDO…»), aviso a los 8 s, y **latido** de ping/pong en el panel |
| 20 | 3 | «Despacho vio tu SOS» le salía al **chofer del turno siguiente** por un SOS de la misma combi que no pidió; y recorría toda la tabla en cada conexión | Sólo el suyo o el de su combi si iba arriba; índice |
| 21 | 5 | Una subida fallida **no se reintentaba hasta 6 h después**; el listado del bucket ignoraba la paginación; restaurar sin espacio dejaba el pedazo; se podía restaurar un `.db` plano del bucket | Reintentos a 5/15/60 min; paginación; limpieza; del bucket sólo `.enc`. Y una sola subida por respaldo a la vez: al arrancar podían subir el mismo juntas y se pisaban (lo encontró la prueba) |
| 22 | 7 | En la web, **el teléfono de la central actualizado se pisaba con el viejo** al cambiar de combi | Se conserva el guardado después del login |
| 23 | 1 | En la web, un segundo SALIR A RUTA podía dejar la combi sin GPS (carrera) | «Entregada» recién cuando el servidor contesta |
| 24 | 15 | Las notas de voz de la web (`audio/webm;codecs=opus`) **no entraban en el ZIP** | La expresión salta los parámetros del tipo; más extensiones |
| 25 | 12 | El consentimiento aceptaba **la fecha de mañana** y cualquier versión | Contra el día de hoy; versión ≤ la vigente; responde lo guardado |
| 26 | 15 | El ZIP sin tope (sin ZIP64) | 20 000 archivos o 500 MB, con error claro |
| 27 | 9 | El CSV de claves **no se protegía contra fórmulas** de Excel | Apóstrofo adelante, igual que `server/csv.js` |

**Lo que NO se arregló, y por qué.**
- **Copia afuera, autenticar el nombre (AAD):** alguien con la llave del
  bucket podría renombrar una copia vieja como nueva. Se arregló la mitad
  grave (no se restaura un `.db` plano del bucket). La otra mitad cambia el
  formato de las copias y obliga a no renombrarlas nunca; con la llave del
  bucket fuera de nuestras manos, ese riesgo ya es otro problema.
- **Menores del bloque 1–3:**
  - A los choferes les llega el usuario de login de la cuenta de Despacho
    que atendió (`porId`).
  - La notificación del navegador no se cierra cuando otro panel atiende.
  - El cartel verde de «Despacho vio tu SOS» tapa un momento la tarjeta
    AUSENTE (se cierra con un toque).

  Ninguno rompe nada.
- **Bloque 6:** al cambiar de ruta, la ruta anterior se entera en su
  próximo `state`, no en el acto.
- **Los `*.antes-de-restaurar-*` no se podan:** son la vuelta atrás de una
  restauración, y borrarlos solos sería peor. Está dicho en el log.
- **Las dos consultas `NOT IN`** que quedan (PENDIENTES 4.10): sin un número
  que lo pida.

**Archivos.**
- Servidor: `server/index.js`, `server/planilla.js`,
  `server/copia-afuera.js`, `server/restaurar.js`, `server/salud.js`,
  `server/memoria.js`, `server/base.js`.
- Pantallas: `project/despacho.html`, `project/Prototipo.html`,
  `project/realtime.js`, `project/service-worker.js` (v91).
- App: `app/App.js`, `app/protocolo/cliente.js`, `app/nativo.json`.
- Herramientas: `publicar-arreglo.bat`.
- Pruebas: `pruebas/reinicio.js`, `pruebas/datos-persona.js`,
  `pruebas/actualizacion.js`.

**Mirar.**
- `subirCopia` cambió de forma: ahora recibe la ruta, no el contenido, y
  hay una sola subida por respaldo a la vez.
- La importación de planillas es `async`.
- El historial ya no trae `data` en la consulta grande.

**Pruebas.** Nuevas comprobaciones:
- en `reinicio`, lo cerrado después de la foto;
- en `datos-persona`, el usuario reusado en otra cooperativa;
- en `actualizacion`, la guardia en el .bat, la vuelta atrás y el primer
  chequeo;
- en `combis`, que la migración corre una sola vez. Esa suite simulaba «una
  base de antes» metiendo una persona después del primer arranque; ahora
  borra la marca de la migración, que es lo que tiene una base vieja de
  verdad.

La planilla maliciosa y el cifrado por partes se midieron aparte (los
números están en la tabla). **Manual:** no.

---

## 17. Auditoría del 11/11 — arreglos

La auditoría de bugs, caídas, amenazas y riesgos del 11/11 (cinco revisiones
en paralelo: seguridad del servidor, robustez, lógica de negocio y riesgo
legal, paneles web, app del chofer). Cada hallazgo se verificó en el código
o se reprodujo antes de arreglarlo. Va un apartado por arreglo, en el orden
de prioridad de la auditoría.

### 17.1 El SOS del chofer en la puerta

**Qué.**
- En la puerta («¿SALÍS A RUTA?») el chofer **no tenía SOS**: sólo el
  cobrador. Es justo donde pasa los momentos de más riesgo: las 5 de la
  mañana en el terminal, la vuelta a la cochera, el «fuera» que le puso el
  vigía o el cambio de combi de Despacho. Ahora el deslizador está para los
  dos, abajo de todo, en el mismo lugar que en ruta y en ausente.
- En la **web** (`Prototipo.html`) la puerta tampoco lo tenía, y además el
  socket recién se abre al salir a ruta: el SOS no tenía por dónde salir.
  `RealtimeClient.sendSos({ token })` ahora sale por `POST /sos` con el
  token de la sesión cuando el socket todavía no se abrió.
- **Sin sesión no quedaba nada.** Un 401 (o la clave reseteada, o una base
  restaurada) borra la sesión guardada, y con ella el teléfono de la
  central. Ahora la central se recuerda **aparte** (`LLAVE_CENTRAL` en
  SecureStore; `r14_central` en la web), no se borra con la sesión, y la
  pantalla de ingreso ofrece **«¿EMERGENCIA? LLAMAR A LA CENTRAL»**. Es una
  llamada (`tel:`), no un SOS: no dispara alarma y no necesita deslizar.

**Archivos.** `app/App.js`, `app/gps/servicio.js`, `project/Prototipo.html`,
`project/realtime.js`, `project/service-worker.js` (v92),
`pruebas/sos-puerta.js` (nueva), `pruebas/regresion.js`.

**Mirar.**
- En la puerta el SOS del chofer sale **sin coordenadas** (el GPS no se
  prende antes de salir a ruta, como promete la política). El servidor le
  pone las de su combi si son de hace menos de un minuto.
- Dos deslizadores en la misma pantalla de la nativa: el verde de SALIR A
  RUTA arriba, el rojo del SOS abajo. Conviene mirarlo en un teléfono chico.
- En la web, el SOS de la puerta reusa el cartel de «enviada» y el panel de
  «no salió» del HUD (`SosAvisos`, `usarSos`): son el mismo código.

**Pruebas.** `sos-puerta` (nueva): el chofer en la puerta tiene el SOS, el
SOS llega al servidor y dice ALERTA ENVIADA sin salir a ruta, la central
queda recordada y el ingreso la ofrece tras perder la sesión; y lee la
nativa. Siguen verdes `sos`, `sos-sin-red`, `puerta-web`, `vigia-puerta`,
`chofer-shot`, `telefono`, `cliente`, `nativas`, `revision-apk`.

---

### 17.2 Los dobles clics de Despacho, y el SOS dentro de Gestión

**Qué.**
- **ATENDIDO.** Con dos SOS esperando, el cartel muestra el más viejo; al
  confirmarse, el segundo aparece en el mismo lugar con su ATENDIDO. Un
  doble clic (o dos toques) cerraba los dos: el segundo quedaba atendido en
  la base, la alarma se callaba en todos los paneles y al chofer le llegaba
  «Despacho vio tu SOS» sin que nadie lo hubiera leído. Ahora ATENDIDO se
  **arma 1,2 s después** de que el cartel muestra cada SOS (se ve atenuado
  mientras tanto).
- **SOS tapado por Gestión.** Gestión es una capa fija que tapa todo, y el
  cartel quedaba debajo: el gerente en Números o el despachador dando altas
  no lo veían. Ahora el mismo cartel va también arriba de Gestión, y «Ver
  en mapa» cierra Gestión.
- **Baja.** El «¿Confirmar?» aparecía en el mismo lugar que «Baja» y dos
  clics daban de baja a la persona, sin vuelta atrás. Ahora es el diálogo
  `Confirmacion`, que la **nombra** y dice qué se pierde.
- **`Confirmacion` en general:** el botón de aceptar se arma a los 700 ms, y
  Escape o el clic afuera cancelan. Vale también para cambiar de variante y
  guardar sobre el trazado que se mide.

**Archivos.** `project/despacho.html`, `project/service-worker.js` (v93),
`pruebas/doble-clic.js` (nueva), `pruebas/regresion.js`.

**Mirar.**
- 1,2 s de espera antes de poder atender el primer SOS. Es poco al lado de
  leer quién pide ayuda, pero es una espera en una emergencia.
- El cartel dentro de Gestión es el mismo elemento: «Activar sonido» y el
  error de ATENDIDO también se ven ahí.

**Pruebas.** `doble-clic` (nueva). Siguen verdes `sos-despacho`, `trazador`,
`combis-web`, `mover-combi`, `privado-web`, `paneles`, `evidencia`,
`alta-masiva`, `consentimiento`, `datos-persona`, `auditoria`,
`correccion-horas`, `gerencia`, `numeros-ui`, `panel-periodo`, `trabas`,
`telefono`, `contraste`, `tema-web`, `vendor`.

---

### 17.3 Despacho no queda en blanco

**Qué.**
- **Muro de errores.** Con React 18, un error al dibujar desmonta el árbol
  entero: se iban el mapa, el chat y el cartel del SOS, y quedaba una página
  en blanco (ya pasó el 22/9 con la pestaña Empresa). Ahora hay dos muros:
  - uno alrededor de **Gestión**: si se rompe una pestaña, Gestión muestra
    qué se rompió y «Volver al mapa», y el mapa y los SOS siguen andando;
  - otro alrededor de **todo**, que muestra el error y **recarga solo a los
    20 s** (una pantalla que nadie mira no puede quedar rota toda la noche;
    al volver, el servidor reenvía los SOS sin atender). Con tope: tres
    recargas en cinco minutos y deja de intentarlo.
- **Sin librerías.** Si React o Babel no llegan de unpkg, a los 8 s la página
  lo dice («no ves el mapa ni los SOS») con un botón de recargar, en vez de
  quedar en blanco sin un solo error. El creador ya lo tenía.

**Archivos.** `project/despacho.html`, `project/service-worker.js` (v94),
`pruebas/muro.js` (nueva), `pruebas/regresion.js`.

**Mirar.**
- La recarga sola pierde lo que se estaba escribiendo. Es el caso de una
  página ya rota, así que no hay mucho que perder.

**Pruebas.** `muro` (nueva): rompe Gestión con datos imposibles, rompe el
panel entero con una línea agregada al HTML que sirve la prueba, y corta
las librerías del CDN.

---

### 17.4 Una cuenta de chofer no tumba el servidor de todos

**Qué.**
- **`POST /gps` con cupo por persona**: 60 pedidos y 1200 posiciones por
  minuto (`CUPO_GPS_PEDIDOS`, `CUPO_GPS_POSICIONES`). Sin cupo, un token
  hizo 337 pedidos en 6 s y le aceptaron 31.200 posiciones con el hilo único
  ocupado. Pasado el tope: **429** con `Retry-After`, y la app guarda el
  lote para el próximo intento (antes un 4xx se descartaba).
- **`identify` con cupo propio**: 3 por minuto por socket (antes caía en
  `otro`, 60). Cada uno devolvía estado e historial con hasta 3 MB: 55
  identify devolvieron 127 MB en 8 s.
- **Un socket que no lee** (más de 8 MB encolados, `WS_BUFFER_MAX`) no
  recibe otra tanda: se corta.
- **Conexiones por cuenta**: 6 para chofer y cobrador, 30 para los paneles
  (`WS_POR_CUENTA`, `WS_POR_CUENTA_PANEL`; la cuenta DESPACHO se comparte).
  Pasado el tope se cierra **la más vieja**, que suele ser la medio muerta.
- **Sin identificar**, un mensaje de más de 8 KB ni se parsea.

**Archivos.** `server/index.js`, `app/gps/servicio.js`, `pruebas/cupos.js`
(nueva).

**Mirar.** Los topes salieron de lo que manda la app hoy (un pedido cada
3 s, 150 en cola tras una zona muerta). Si la cadencia cambia, revisarlos.

---

### 17.5 La base, el volumen y el disco lleno

**Qué.**
- **En producción, sin volumen no se arranca.** `DB_FILE` es obligatoria y
  su carpeta tiene que existir; `openDatabase` ya no la crea fuera de la
  demo. Antes, con el volumen sin montar, arrancaba con una base vacía en el
  disco del contenedor y `/salud` daba 200.
- **`/salud` mira en qué disco está la base**: en el mismo que la
  aplicación es un **problema** (503, el deploy no se acepta). En la demo es
  aviso; `BASE_EN_DISCO_DE_APP=1` lo permite para un servidor propio de un
  solo disco.
- **Disco lleno**:
  - el chofer que empieza turno **entra al mapa** (antes, 500 en cada
    `POST /gps`): si no se puede abrir el turno se pierden esas horas, no la
    combi;
  - el **SOS que no se pudo guardar** sale con un id negativo de memoria: se
    puede marcar ATENDIDO, vuelve al panel que reconecta y avisa al que lo
    pidió (antes salía con `sosId: null` y sonaba para siempre);
  - el **barrido** atrapa el error por unidad: una que falla no saltea a las
    demás, ni la poda, ni la difusión del estado.
- **El respaldo mira el disco antes de escribir**: el temporal ocupa lo
  mismo que la base. Si no entra con 200 MB de margen
  (`RESPALDO_RESERVA_MB`), borra respaldos viejos (siempre deja el último);
  si aun así no entra, no lo intenta y lo dice.

**Archivos.** `server/index.js`, `server/base.js`, `server/salud.js`,
`server/respaldo.js`, `pruebas/disco.js` (nueva).

**Mirar.**
- **Antes del próximo deploy**: confirmar en Railway que `DB_FILE` está
  puesta y apunta al volumen. Sin eso, el servidor nuevo **no arranca** (es
  lo que se quiere, pero hay que saberlo).
- Los SOS en memoria no se guardan después, cuando vuelve el disco: quedan
  en la Actividad si la Actividad pudo escribir, y en el log.

**Pruebas.** `disco` (nueva): arranque en producción sin volumen, `/salud`
con la base en el disco de la app, el respaldo sin lugar, y el disco lleno
de verdad sobre un tmpfs de 4 MB (se saltea si no se puede montar).

---

### 17.6 La tormenta de reconexión tras un deploy

**Qué.**
- **Clientes**: los tres (app nativa, web del chofer, Despacho) reconectan
  con espera creciente (3, 6, 12, 24, 30 s) y **un azar de ±50 %**. La web y
  Despacho reintentaban cada 3 s fijos; la nativa crecía pero sin azar. Tras
  un deploy todos volvían en el mismo segundo.
- **Servidor**: el historial de cada `identify` (lo pesado: hasta 3 MB) se
  arma **en cola**, de a uno y cediendo el hilo cada ~25 ms. Con 300
  identify a la vez y 2,4 MB de fotos, `/ping` tardó a lo sumo 90 ms (antes,
  4,2 s con el mismo banco; 11 s con 600 en la auditoría).

**Archivos.** `server/index.js`, `app/protocolo/cliente.js`,
`project/realtime.js`, `project/despacho.html`, `project/service-worker.js`
(v95), `pruebas/tormenta.js` (nueva).

**Mirar.** Queda el costo en datos: cada reconexión de un chofer vuelve a
bajar el historial con sus fotos y audios. Lo de fondo es un historial
incremental (sólo lo nuevo desde el último que tiene); anotado en
PENDIENTES.

---

### 17.7 El SOS no suena dos veces, y la app nativa con latido

**Qué.**
- **SOS repetido.** Mientras la persona tenga un SOS **sin atender** de los
  últimos 10 minutos (`SOS_REPETIDO_MS`), volver a mandarlo —por la otra
  puerta, o porque la app dijo «NO SALIÓ» con un HTTP cortado que sí
  llegó— devuelve **ese**: no suena de nuevo ni suma una fila; el que lo
  mandó recibe su eco (`repetido: true`). Atendido el anterior, uno nuevo es
  otra emergencia.
- **Más rápido el plan B en la nativa**: espera el eco 4 s (antes 8) y el
  HTTP 6 s (antes 10), como la web. El panel de llamar o mandar SMS aparece
  a los ~10 s y no a los 18.
- **Latido en la nativa**: un ping cada 15 s y, si en 40 s no llegó nada,
  el socket se da por muerto y se reconecta. Antes, un socket medio muerto
  la dejaba en «EN VIVO» con la brecha congelada y el chat saliendo a la
  nada.

**Archivos.** `server/index.js`, `app/protocolo/cliente.js`,
`project/realtime.js`, `project/service-worker.js` (v96),
`pruebas/sos-repetido.js` (nueva).

**Mirar.** El repetido es **por persona**: el chofer y el cobrador de la
misma combi siguen siendo dos SOS. Es a propósito: pueden estar en dos
lugares distintos.

**Pruebas.** `sos-repetido` (nueva).

---

### 17.8 Números que perjudicaban a choferes y cooperativas

**Qué.**
- **Vueltas fantasma.** Una combi estacionada en el terminal de una ruta de
  ida y vuelta por la misma calle sumaba 7 a 9 vueltas en 20 min: el ruido
  del GPS hacía rebotar el progreso entre ~0 y ~1. Además apretaban el
  objetivo automático de todos. Ahora una vuelta tiene que haber **avanzado**
  por el circuito (la suma neta de los pasos chicos, al menos la mitad de lo
  que le quedaba, con piso de 20 %); si no, se descarta y se dice en el log.
- **Brecha y objetivo en la misma escala.** La brecha se pasaba a minutos
  con `durationMin` (50 de fábrica, nadie lo edita) y el objetivo salía de
  la vuelta **medida**: con vueltas de 72 min y 12 combis, doce bien
  repartidas daban 0 % de cumplimiento. Ahora la brecha usa la misma vuelta
  medida que el objetivo (las mismas vueltas, del día de la semana si hay) y
  `durationMin` sólo sin historial.
- **Usuario reutilizado.** Un usuario con turnos de alguien que se dio de
  baja ya no se le da a otra persona: el nuevo heredaba sus horas en el CSV,
  en Turnos y en su perfil. El alta lo dice y sugiere otro; el alta masiva
  lo saltea al inventar `nombre.apellido`.
- **Zona sin señal.** Tras un corte de más de 15 min, el turno nuevo
  arrancaba «ahora» aunque las posiciones de la cola probaran que trabajó.
  Ahora arranca (o se retoma) con la posición más vieja del lote, con tope
  de 30 min.
- **«GPS sospechoso» con teléfonos que no reportan velocidad.** La app manda
  0 cuando Android no la da, y eso caía en «velocidad incoherente». Ahora
  esa firma sólo se juzga con las muestras que traen velocidad; las otras
  dos siguen.
- **Zona horaria.** En producción, sin `TZ`, el servidor usa
  `America/Lima`. En la demo no se toca (las pruebas calculan con la hora de
  la máquina).

**Archivos.** `server/index.js`, `server/farsa.js`, `pruebas/farsa.js`,
`pruebas/vueltas-horas.js` (nueva).

**Mirar.**
- La brecha **cambia de número** en las rutas con vueltas medidas: era la
  fracción × 50 y ahora es la fracción × la vuelta real. Es el arreglo,
  pero Despacho lo va a notar.
- Quien se dio de baja por error y vuelve no puede recuperar su mismo
  usuario: sus horas viejas quedan a ese nombre y el nuevo usa otro.
- Quedan sin tocar, como decisión de producto: que la vuelta se juzgue
  contra la vara del cierre (no contra la que rigió durante la vuelta) y
  que el chofer pueda elegir qué parte de su brecha se mide con modo avión
  o medio minuto de «ausente». Anotados en PENDIENTES.

---

### 17.9 La app: volver solo a casa, y el GPS que se calla

**Qué.**
- **«Ausente» y a casa.** El vigía de la ausencia devolvía a «ruta» al que
  terminó el día marcando AUSENTE y se fue manejando, y en ruta no hay
  tope: la ubicación de la casa toda la noche, con el turno abierto. Ahora
  el `POST /gps` dice si la combi ya pisó el trazado (`enRuta`) y, si volvió
  a ruta sola y en 20 min nunca lo pisó, la app sale de ruta y apaga el GPS.
- **El GPS que se apaga sin avisar** (reinicio, forzar detención, una
  actualización, la ubicación apagada): un aviso **a futuro** que cada
  envío corre 10 min. Si el servicio murió nadie lo corre, y suena «Tu GPS
  dejó de mandar… abrí la app». Lo dispara el sistema, no la app. Se apaga
  al salir de ruta, al cerrar sesión y en el relevo.

**Archivos.** `app/gps/servicio.js`, `app/notificacion.js`,
`server/index.js`, `pruebas/app-auditoria.js` (nueva).

**Mirar.**
- **Hace falta un APK** (o un EAS Update) para que llegue a los teléfonos.
- Que el aviso programado sobreviva a un **reinicio** depende de
  `expo-notifications`; hay que verlo en un teléfono real.
- El aviso usa `SchedulableTriggerInputTypes.TIME_INTERVAL` (SDK 52 en
  adelante), con el formato viejo de respaldo.

---

### 17.10 Las cuentas

**Qué.**
- **El token no se guarda**: en `sessions` va su huella SHA-256. Un
  respaldo, una copia del volumen o un `.db` bajado del panel ya no traen
  llaves vivas (con un token sacado de un respaldo, `GET /admin/users`
  contestaba 200). Las sesiones de antes se pasan a huella al arrancar y
  los teléfonos siguen entrando sin hacer nada.
- **Despacho no toca otra cuenta de Despacho** (clave, baja, nombre), ni la
  suya por esa puerta (para eso está su perfil, que pide la actual). La
  gerencia sí. En Personas, el botón «Clave» de una cuenta de Despacho sólo
  lo ve la gerencia.
- **El chofer y el privado de su cobrador.** El chofer puede seguir
  cambiándole la clave, pero desde ese momento la cuenta del cobrador ya no
  ve el privado personal anterior con Despacho (`users.privadoDesde`).
  Antes el chofer entraba como él y lo leía.
- **«Cambiar mi contraseña» con freno**: 5 intentos con la actual mal en
  15 min y después 429 (y cuenta para el bloqueo por origen). Antes, sin
  límite: 60 claves en 2,5 s.
- **El bloqueo del login es por cuenta y origen**: cinco claves malas
  bloquean esa cuenta desde ese origen, no para todos. Antes cualquiera
  dejaba a Despacho sin poder entrar desde ningún lado, renovable sin fin.
  Contra el ataque repartido queda un tope por cuenta de 60 en 30 min.
- **Claves generadas**: dos palabras de 64 y cuatro números
  (`lago-cerro-4821`, 36,9 millones) en vez de una de 8 (72 000). Despacho
  sugiere con `crypto.getRandomValues`, no con `Math.random`.

**Archivos.** `server/index.js`, `project/despacho.html`,
`project/service-worker.js` (v97), `pruebas/cuentas.js` (nueva),
`pruebas/puertas.js` y `pruebas/revision-apk.js` (leen la huella),
`pruebas/alta-masiva.js` (el formato de la clave).

**Mirar.**
- Nada obliga a cambiar la clave inicial. Anotado en PENDIENTES.
- La cuenta DESPACHO compartida queda a cargo de la gerencia: si se olvida
  su clave y no hay gerente cargado, la cambia el creador.

---

### 17.11 Legal, Play Store y EAS

**Qué.**
- **Privacidad, consentimiento y contrato** declaran lo que el sistema
  guardaba sin decirlo: los **lugares puntuales del turno** (dónde se
  declaró en ruta, ausente o fuera —incluido dónde terminó—, cortes de
  señal, paradas, salidas del trazado: 120 días) y las **marcas
  automáticas** («GPS sospechoso», «entrada tardía», «salió solo»…), que
  son avisos para una persona y no deciden nada solas. El consentimiento
  decía «de la posición, sólo la última conocida». El contrato obliga a la
  cooperativa a no sancionar sólo por una marca y a explicarla si se pide.
- **Consentimiento versión 2026-11-11**: quien firmó la del 04/11 tiene que
  firmar la nueva (Despacho lo ve en Personas).
- `legal/LEEME.md`: dos preguntas nuevas para el abogado.
- **Play Store**: la galería ya no pide permiso (el selector de fotos del
  sistema no lo necesita) y `READ_MEDIA_*` y `READ_EXTERNAL_STORAGE` van en
  `blockedPermissions`: la política de fotos de Google rechaza una app que
  los declara para mandar una foto de vez en cuando. `PLAYSTORE.md` suma la
  declaración del servicio en primer plano y los datos del teléfono en
  Seguridad de los datos, y cómo mirar el manifiesto final.
- **`publicar-arreglo.bat`** no publica con cambios locales sin subir.
- **La firma de EAS Update** necesita una clave que no puede vivir en el
  repositorio: los pasos están en `TAREAS-FUERA-DEL-CODIGO.md` §1bis.

**Archivos.** `server/privacidad.html`, `server/consentimiento.html`,
`server/index.js` (versión), `legal/contrato-encargo.md`, `legal/LEEME.md`,
`app/app.json`, `app/foto.js`, `PLAYSTORE.md`, `publicar-arreglo.bat`,
`TAREAS-FUERA-DEL-CODIGO.md`, `pruebas/app-auditoria.js`,
`pruebas/zona-muerta.js` (`crypto` y `Uint32Array` son del navegador).

**Mirar.** Nada de esto reemplaza al abogado. `blockedPermissions` y el
selector sin permiso hay que verlos en el manifiesto de la APK nueva.

---

### 17.12 Lo más leve

**Qué.**
- **El creador confirma** antes de guardar sobre el trazado con el que se
  mide (y antes de guardar uno vacío), nombrando qué pasa: descarta las
  vueltas en curso. Despacho ya lo hacía.
- **«Ver en mapa» del SOS** tiene un pin propio, rojo, que vive mientras el
  SOS esté sin atender: antes centraba un mapa vacío si la combi ya se había
  olvidado o si se miraba otra ruta.
- **Sin conexión, el mapa de Despacho se apaga** (gris y atenuado) y dice
  «Sin conexión: el mapa no está en vivo». Antes sólo se atenuaba la lista.
- **Leaflet desde unpkg con `integrity`**, como React y Babel (los hashes
  son los de la copia local).
- **Sesión vencida en Despacho**: un 401 de Gestión ahora borra la sesión
  guardada, y el cartel dice el motivo del servidor (una baja, una
  cooperativa suspendida) en vez de «tu sesión expiró» para todo.
- **`railway.json` arranca con `node server/index.js`**: con `npm start` el
  SIGTERM de un deploy no llegaba a Node y no se guardaba la memoria
  caliente.
- **La verificación del respaldo corre en otro hilo**: el `quick_check` era
  síncrono (~1 s por cada 600 MB con todo el servidor parado).
- **Restaurar un respaldo local de más de 2 GB**: se copia de archivo a
  archivo en vez de leerlo entero en memoria.
- **`RESTAURAR_DESDE` olvidada** ya no tira las vueltas en curso en cada
  deploy: sólo el arranque que de verdad restauró descarta la memoria.
- **El alta masiva** con su red: un error después del primer paso dejaba
  el pedido colgado sin respuesta.
- **La migración de `route_points`** va en una transacción.
- **El login verifica la clave sin frenar el hilo** (`scrypt` asíncrono):
  ~39 ms de hilo único por intento.
- **El SOS de la nativa** mide la frescura de la posición con la hora de la
  lectura del GPS, no con la de llegada.
- **«Salto imposible»** descuenta la precisión declarada de las dos
  lecturas y no juzga con menos de 5 s entre ellas: un rebote de 67 m en
  2 s se anotaba contra un chofer honesto.
- **Planilla**: las filas ocultas o filtradas del Excel o del .ods no se
  importan (van vacías, para que los números de fila no se corran).
- **Service worker**: las tiles se piden con CORS y sólo se guardan las que
  llegaron bien (antes se guardaba cualquier opaca, también un error, para
  siempre). `tiles-v3` tira las de antes una vez.

**Archivos.** `server/creador.html`, `project/despacho.html`,
`project/Prototipo.html`, `project/service-worker.js` (v98, tiles-v3),
`railway.json`, `server/respaldo.js`, `server/restaurar.js`,
`server/index.js`, `server/base.js`, `server/planilla.js`, `app/App.js`,
`pruebas/planillas/fila-oculta.xlsx`, `pruebas/cuentas.js`.

**Mirar.**
- `tiles-v3` hace que cada aparato vuelva a bajar sus tiles una vez (hasta
  ~15 MB).
- Si Geoapify no mandara cabeceras CORS, las tiles se verían igual pero ya
  no se guardarían: habría que mirarlo con el panel abierto un día.
- Lo que queda anotado y no se tocó está en PENDIENTES 4.24.

---

## Para el manual (cuando toque)

Lo que todavía no está en `manual/manual.tex`:

- «Despacho vio tu SOS» en la app del chofer (bloque 3).
- El SOS sin internet: el panel, el SMS y los números de emergencia
  (bloque 7). Y en Despacho → Gestión → Empresa, el campo *Teléfono de la
  central para emergencias*.
- Despacho → Gestión → Turnos: Corregir, Anular y Agregar un turno que faltó
  (bloque 8).
- Despacho → Gestión → Personas → Cargar una planilla (bloque 9).
- En el chat de Despacho: «Guardar como evidencia», el motivo y «quitar»;
  y «cargar foto» / «cargar nota de voz» (bloque 10).
- Despacho → Gestión → Actividad: los botones de tipo y «Ver más viejos», y
  cuánto se guarda cada cosa (bloque 11).
- Despacho → Gestión → Personas: el consentimiento de datos personales,
  anotar la firma y el retiro; y cómo imprimir el formulario (bloque 12).
- En el perfil del chofer, «actualizada dd/mm hh:mm»; y para el que opera,
  `publicar-arreglo.bat` (bloque 13).
- Despacho → Personas → Editar → «Bajar todos sus datos (ZIP)» (bloque 15).
- Para el que opera, no para el chofer: `/salud` y las alertas (bloque 4),
  y la copia afuera y cómo volver a un respaldo (bloque 5). Quizás va en un
  anexo de operación más que en el manual de uso.
- El SOS en la puerta para el chofer, y «¿Emergencia? Llamar a la central»
  en la pantalla de ingreso (bloque 17.1).
- Despacho → Gestión → Personas: la versión nueva del consentimiento
  (11/11) y por qué hay que volver a firmarlo (bloque 17.11).
