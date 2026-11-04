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
