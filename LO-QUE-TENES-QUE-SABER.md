# Lo que tenés que saber y lo que tenés que hacer

Resumen del 11/11/2026: la auditoría de bugs y riesgos, sus arreglos, y el
retoque de la UI de Claude Design ya integrado. El detalle técnico está en
`CAMBIOS-PARA-REVISAR.md` §17 (auditoría) y en `CAMBIOS-UI.md` (retoque).
Esto es lo corto.

Todo vive en la rama **`claude/trusting-volta-n1vvr7`**, que **todavía no
está unida a `main`**. La regresión completa da verde.

---

## Lo importante (leelo antes de desplegar)

1. **Sin volumen, el servidor no arranca.** En producción ahora exige
   `DB_FILE` y que su carpeta exista (el volumen montado). Antes arrancaba
   con una base vacía y te enterabas tarde. Si después de un deploy no
   levanta, lo primero es mirar eso.
2. **La brecha cambia de número** en las rutas que ya tienen vueltas
   medidas: dejó de usar los 50 min fijos y usa la vuelta real, la misma
   del objetivo. Es el arreglo (con 12 combis bien repartidas daba 0 % de
   cumplimiento), pero Despacho lo va a notar: avisales.
3. **El consentimiento tiene versión nueva (11/11).** Declara lo que el
   sistema guardaba sin decirlo: los lugares puntuales del turno (dónde
   terminó, que suele ser la casa del chofer) y las marcas automáticas
   («GPS sospechoso», «entrada tardía»…). Los que firmaron la del 04/11
   tienen que firmar la nueva.
4. **Los arreglos de la app del chofer son JavaScript**: llegan a los
   teléfonos con la APK 0.3.0 por EAS Update, sin reinstalar. Lo único
   nativo (los permisos de fotos para Play Store) quedó para la próxima APK.

## Lo que tenés que saber

**El SOS**
- El chofer ahora tiene SOS también en la pantalla de «¿Salís a ruta?».
- Sin sesión, el login ofrece «¿Emergencia? Llamar a la central».
- Si el mismo chofer manda dos SOS sin que se haya atendido el primero,
  suena **uno** (antes salían dos alarmas por el mismo pedido).
- ATENDIDO se activa 1,2 s después de que aparece cada SOS: un doble clic
  ya no cierra el SOS de otro sin leerlo.
- El cartel del SOS se ve siempre, también con Gestión abierta.
- «Ver en mapa» deja un pin rojo «SOS · M-17» que queda hasta que se atiende.

**Despacho**
- Gestión ahora es una vista del panel (no una ventana encima). «Volver al
  mapa» está arriba a la izquierda.
- En Personas, cada fila muestra «Escribir»; lo demás (Clave, Combis,
  Editar, **Baja**) está en el menú «⋯». La baja pide confirmar en un
  diálogo que nombra a la persona.
- Una cuenta de Despacho ya no puede cambiarle la clave ni dar de baja a
  otra de Despacho: eso lo hace la gerencia.
- Si se cae la conexión, el mapa se pone gris y lo dice.
- Si algo se rompe, la página no queda en blanco: muestra el error y se
  recarga sola.
- Números tiene el cumplimiento grande, un gráfico por día y un solo botón
  «Descargar CSV».

**Cuentas y seguridad**
- Las claves que genera el sistema ahora son dos palabras y cuatro números
  (`lago-cerro-4821`).
- Cinco claves mal bloquean esa cuenta **desde ese aparato**, no para todos.
- El chofer que le cambia la clave a su cobrador ya no puede leer los
  privados que el cobrador tenía con Despacho.
- Las sesiones en la base se guardan como huella: un respaldo robado ya no
  sirve para entrar.

**La app del chofer**
- Si marca «ausente» al terminar y se va manejando a su casa, a los 20 min
  sale de ruta solo (antes mandaba la ubicación de la casa toda la noche).
- Si el GPS se apaga sin avisar (reinicio, actualización, ubicación
  apagada), a los 10 min le suena «Tu GPS dejó de funcionar».

**Lo que quedó anotado y no se hizo** (`PENDIENTES.md` 4.21 a 4.24): el
historial del chat que se baja entero en cada reconexión (cuesta datos),
obligar a cambiar la clave inicial, dos reglas de medición que son decisión
tuya, y siete detalles menores. Del retoque, `CAMBIOS-UI.md` lista lo que
Claude Design vio y no tocó (la marca de la landing, la raíz «/», el chip
«Conectado» del chofer).

---

## Lo que tenés que hacer, en orden

- [ ] **1. Revisar y unir la rama a `main`.** Si querés, te abro el pull
      request.
- [ ] **2. Railway, antes de desplegar.**
  - Confirmar que `DB_FILE` apunta al volumen (por ejemplo `/data/r14.db`).
  - `TZ=America/Lima` ya no es obligatoria (el servidor la pone solo en
    producción), pero no molesta.
  - `railway.json` ahora fija el arranque en `node server/index.js`.
- [ ] **3. Desplegar y mirar `/salud`.** Tiene que dar `ok` o `aviso`. Con
      `base_en_disco_de_app` es que el volumen no está montado.
- [ ] **4. Avisar a Despacho** de lo que cambia para ellos: Gestión es una
      vista, Baja está en «⋯», la brecha cambia de número y ATENDIDO tarda
      un instante en activarse.
- [ ] **5. Publicar el arreglo de la app** con `publicar-arreglo.bat`,
      **primero al canal PRUEBA**. El .bat ahora no publica si tenés cambios
      sin subir en la PC. En tu teléfono, mirá:
  - la pantalla de «¿Salís a ruta?» tiene SOS abajo;
  - cerrá sesión: el login ofrece llamar a la central;
  - salí a ruta, forzá la detención de la app y esperá 10 min: tiene que
    sonar «Tu GPS dejó de funcionar».

  Si todo anda, publicá a TODOS.
- [ ] **6. El consentimiento nuevo**: imprimirlo (`/consentimiento`) y
      anotar las firmas en Despacho → Personas.
- [ ] **7. El abogado**: las dos preguntas nuevas de `legal/LEEME.md`
      (marcas automáticas y los lugares de fin de turno).
- [ ] **8. Firmar las actualizaciones de EAS**: los pasos están en
      `TAREAS-FUERA-DEL-CODIGO.md` §1bis. La clave privada va **fuera** del
      repositorio y con los respaldos.
- [ ] **9. La próxima APK (la de Play Store)**: sumar `blockedPermissions`
      como dice `PLAYSTORE.md` §3, subir la versión, y en Play Console
      hacer la declaración del servicio en primer plano y la de los datos
      del teléfono.
