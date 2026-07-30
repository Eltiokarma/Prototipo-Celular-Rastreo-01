# Limitaciones conocidas — COOP-R14

Inventario honesto de lo que este sistema **no** puede hacer hoy, para
saber qué prometerle al cliente y qué no. Actualizar cada vez que una
limitación se resuelva o aparezca una nueva.

## Lo crítico (leer antes de vender)

| # | Limitación | Impacto | Salida |
|---|---|---|---|
| 1 | El GPS se corta con la pantalla apagada | La unidad desaparece del mapa a los ~30 s de bloquear el celular o cambiar de app | App nativa (React Native) |
| 2 | Sin notificaciones con la app cerrada | Un SOS o mensaje no suena si el chofer/encargado no tiene la app abierta | Web Push (Android) o app nativa |
| 3 | Sin volumen en Railway, un redeploy borra la base | Se pierden usuarios, historial de chat y vueltas | Montar volumen + `DB_FILE=/data/r14.db` (documentado en README) |
| 4 | Brechas y vueltas son aproximadas | El progreso de ruta es una proyección lineal, no sigue el trazado real de calles | Modelar la ruta con puntos reales |
| 5 | Una sola cuenta DESPACHO compartida | La auditoría no distingue *cuál* encargado hizo cada cosa | Cuentas de despacho por persona |
| 6 | Consumo de datos móviles | **Mitigado**: de 839 MB a 40 MB por turno con 20 unidades (98 MB con 50), y los tiles del mapa ya no se rebajan en cada visita. Queda el payload personalizado para rutas de 30+ unidades | Ver `ESCALABILIDAD.md` |
| 7 | Una sola ruta modelada | Con varias rutas las brechas se calcularían entre unidades de rutas distintas y el chat sería uno solo | `routeId` de primera clase (etapa 1 de `ESCALABILIDAD.md`) |

## A. App web en el celular del chofer (límites de PWA)

- **GPS en segundo plano:** los navegadores cortan la geolocalización al
  apagar la pantalla o pasar la app atrás. El diseño actual asume el
  celular **en soporte con pantalla prendida** (es el uso previsto del
  HUD); fuera de ese uso, la unidad se cae del mapa. La solución de
  fondo es la app nativa (`PROMPT-REACT-NATIVE.md`).
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
  (service worker), pero las brechas se congelan y el chat solo agrega
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
- **Sin backups automáticos** de la base (usuarios, chat, vueltas,
  auditoría). Un backup periódico del archivo `r14.db` es tarea
  pendiente de operación.
- **Dependencia de CDNs gratuitos:** React, Babel y Leaflet cargan
  desde unpkg, los tiles del mapa desde CartoCDN, las fuentes desde
  Google Fonts. Ninguno tiene contrato de servicio: si un CDN falla y
  el celular no tiene la app en caché, no carga. Mitigación futura:
  empaquetar las librerías en el propio hosting.
- **Babel compila en el navegador** (sin paso de build): arranque en
  frío más lento en celulares viejos. Aceptable en prototipo; en
  producción conviene precompilar.

## D. Precisión del modelo de ruta

- El `routeProgress` (0 = Terminal Sur, 1 = Huancané) es una
  **proyección lineal** entre dos puntos — no sigue las calles reales.
  Las brechas en minutos son aproximaciones útiles, no medidas exactas.
- La **detección de vueltas** es una heurística (llegar cerca del final
  y volver al inicio): un desvío grande o GPS muy errático puede
  perder o duplicar una vuelta.
- El GPS urbano tiene error típico de 5–30 m, y algunos equipos no
  reportan velocidad (se muestra 0).
- **Una sola ruta** (R-14) está modelada; multi-ruta requiere
  estructura nueva.

## E. Seguridad

- **Cuenta DESPACHO única y compartida** entre encargados: la
  auditoría registra "DESPACHO", no la persona.
- **Sesiones en el celular:** un teléfono robado desbloqueado tiene la
  sesión activa (30 días). Mitigación: Despacho puede resetear la clave
  o dar de baja y la sesión muere al instante.
- **El "root" es la infraestructura:** quien controla Railway o el repo
  controla todo (documentado en README como diseño intencional).
- El límite de intentos de login vive en memoria (se resetea al
  reiniciar el servidor) y no hay captcha: suficiente para este
  tamaño, no para un ataque masivo desde internet.

## F. Funcional (recortes conscientes)

- Notas de voz: solo las 30 más recientes conservan audio; tope 60 s;
  sin transcripción.
- Chat: los ✓✓ de "leído" son decorativos (no hay acuses reales); no
  se puede editar ni borrar un mensaje.
- La pantalla "Salir a ruta" muestra datos decorativos ("48 min · 42
  pasajeros", "V-247", turno): el conteo de pasajeros y la asignación
  de unidad física no existen.
- Modo "Sol extremo" solo aplica a la pantalla RUTA (chat y mapa son
  siempre oscuros).
- No hay exportación de reportes (CSV/PDF) de vueltas ni auditoría.
- El panel de Despacho no puede iniciar una conversación privada con
  una unidad: todo el chat es grupal.

## Acceso por web y dominio

La app **ya es una página web**: el mismo servidor de Railway sirve la
app del chofer (`/Prototipo.html`), el panel (`/despacho.html`) y el
tiempo real, con HTTPS incluido, en la URL gratuita
`*.up.railway.app`. **No hace falta comprar nada para que el cliente
lo vea.** Un dominio propio (~US$10–15/año, p. ej. `coopr14.pe`) es
opcional: aporta marca y una dirección fácil de dictar, y se conecta
al mismo Railway con un registro CNAME — sin cambios de código.
