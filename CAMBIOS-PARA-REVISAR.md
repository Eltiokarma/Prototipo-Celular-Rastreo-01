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

---

## Para el manual (cuando toque)

Lo que todavía no está en `manual/manual.tex`:

- «Despacho vio tu SOS» en la app del chofer (bloque 3).
- El SOS sin internet: el panel, el SMS y los números de emergencia
  (bloque 7). Y en Despacho → Gestión → Empresa, el campo *Teléfono de la
  central para emergencias*.
- Para el que opera, no para el chofer: `/salud` y las alertas (bloque 4),
  y la copia afuera y cómo volver a un respaldo (bloque 5). Quizás va en un
  anexo de operación más que en el manual de uso.
