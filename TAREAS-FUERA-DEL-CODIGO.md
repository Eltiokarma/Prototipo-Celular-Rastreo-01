# Lo que te toca hacer a vos (fuera del código)

Todo lo que el código ya no puede hacer solo: cuentas, variables, botones en
paneles ajenos y simulacros. Está en el orden en que conviene hacerlo. Marcá
cada casilla al terminarla.

Las variables van en **Railway → tu servicio → Variables**. Cambiar una
variable redespliega el servidor solo (unos segundos sin conexión: las apps
se reconectan solas). Conviene hacerlo fuera de hora pico.

---

## 1. Antes de que nada más: lo que ya está en el servidor

- [ ] **`TZ` = `America/Lima`.** Sin ella el servidor corre en UTC: «hoy», los
      informes y los días de la tendencia van corridos cinco horas. `/salud`
      lo avisa mientras falte.
- [ ] **Confirmar que `DB_FILE` apunta al volumen** (por ejemplo,
      `/data/r14.db`, con el volumen montado en `/data`). Desde la revisión
      previa a la APK, si esa base no abre, el servidor **no arranca** en vez
      de arrancar con una vacía: si después de un deploy no levanta, lo
      primero que hay que mirar es esto.
- [ ] **Saber que existe `railway.json`.** Hace que Railway no pase el tráfico
      a una versión nueva hasta que su `/salud` conteste bien. Si algún día
      molesta, borrar ese archivo deja todo como antes.

## 2. Unir la rama y sacar la APK 0.3.0

- [ ] **Unir la rama `claude/eager-einstein-shid7d` a `main`** (un pull request
      en GitHub y «Merge»). `compilar-app.bat` compila lo que está en `main`:
      sin este paso sale la APK vieja.
- [ ] **Correr `compilar-app.bat`.** Sale la **0.3.0**. El número interno
      (`versionCode`) ahora sube solo en cada compilación: anotá el que muestra
      EAS al terminar (debería ser **6**).
- [ ] **Subir la APK** donde la descargan los choferes y poner en Railway:
  - `APP_URL` = el enlace de descarga
  - `APP_VERSION_ACTUAL` = el `versionCode` que anotaste

  Con eso, los teléfonos con la versión vieja ven «hay una versión nueva».
- [ ] **Probar en un teléfono de verdad** antes de repartirla:
  - entrar
  - elegir la combi en la puerta
  - salir a ruta
  - un SOS de prueba (avisándole antes a Despacho), que Despacho marque
    ATENDIDO y que al teléfono le aparezca «DESPACHO VIO TU SOS»
  - que en la tarjeta de esa combi, en Despacho, aparezca la batería del
    teléfono y la versión 0.3.0 (tarda hasta un minuto)
- [ ] **Cuando todos tengan la 0.3.0** (no antes), poner `APP_VERSION_MIN` =
      el mismo número. A partir de ahí la versión vieja deja de funcionar.

## 3. Que te avisen si el servidor anda mal

- [ ] **Alertas al teléfono con ntfy** (gratis, sin cuenta):
  1. Instalá la app **ntfy** en tu teléfono.
  2. Elegí un nombre de tema largo y difícil de adivinar (por ejemplo,
     `flota-coop-7h3k9x2q`) y suscribite a ese tema en la app.
  3. En Railway: `ALERTA_URL` = `https://ntfy.sh/flota-coop-7h3k9x2q`.
  4. Opcional: `SERVIDOR_NOMBRE` = cómo querés que se llame en las alertas
     (por ejemplo, `Flota producción`).

  El servidor manda un mensaje cuando su salud **cambia**: cae, empeora o
  vuelve. La primera vez probablemente llegue un «aviso» por lo que todavía
  falte configurar (la copia afuera, la hora): es esperable.
- [ ] **Un monitor externo** (UptimeRobot o Better Stack, plan gratuito). Es
      lo único que te avisa si el servidor está **caído del todo**, porque ahí
      no puede avisar de sí mismo:
  1. Crear un monitor **HTTP(s)** a `https://<tu dominio>/salud`, cada **5
     minutos**.
  2. Que alerte si la respuesta **no es 200**.
  3. Que el aviso llegue a tu correo o a tu teléfono (UptimeRobot tiene app).

## 4. La copia de los respaldos fuera del servidor

Hoy los respaldos viven en el mismo disco que la base: si se pierde el
volumen, se pierden con ella. Esto los saca afuera, cifrados. Los pasos son
con **Cloudflare R2**: 10 GB gratis por mes, y una base de una cooperativa
pesa pocos MB. Backblaze B2 o AWS S3 sirven igual.

- [ ] **Crear la cuenta y el bucket**:
  1. Cloudflare → R2 → **Create bucket**, por ejemplo `flota-respaldos`. Que
     **no** sea público.
  2. R2 → **Manage R2 API Tokens** → **Create API token**, con permiso
     **Object Read & Write** y **sólo ese bucket**. Te muestra un *Access Key
     ID* y un *Secret Access Key*: copiálos ahora, el secreto no se vuelve a
     mostrar.
  3. Anotá el *endpoint*: `https://<ID de tu cuenta>.r2.cloudflarestorage.com`
     (aparece en la misma pantalla del token).
- [ ] **Regla para borrar las viejas**: en el bucket → Settings → **Object
      lifecycle rules** → borrar los objetos a los **30 días**. Así no crece
      para siempre; el servidor no borra nada afuera.
- [ ] **Inventar la frase de cifrado** (`RESPALDO_CIFRADO`): 16 caracteres o
      más, mejor una frase larga. **Guardala en tu gestor de contraseñas y en
      un segundo lugar seguro** (un papel en un sobre cerrado, por ejemplo).
      **Sin esa frase, las copias no se pueden abrir: ni vos, ni Cloudflare,
      ni nadie.** Si la perdés, las copias que ya están afuera no sirven.
- [ ] **Las variables en Railway**:
  - `RESPALDO_S3_ENDPOINT` = el endpoint del paso anterior
  - `RESPALDO_S3_BUCKET` = `flota-respaldos`
  - `RESPALDO_S3_KEY_ID` = el Access Key ID
  - `RESPALDO_S3_SECRET` = el Secret Access Key
  - `RESPALDO_CIFRADO` = la frase

  En R2 la región es `auto` y no hace falta ponerla. En B2 o AWS va también
  `RESPALDO_S3_REGION`.
- [ ] **Comprobar** después del redeploy: en el panel del creador → RESPALDOS
      tiene que aparecer «Copia afuera (cifrada)» con al menos un archivo, y
      `/salud` no tiene que decir nada de la copia. Si dice que falla, el
      panel muestra qué contestó Cloudflare (lo más común: el token sin
      permiso sobre ese bucket).

## 5. El simulacro de restauración (una vez ahora, después cada 3 meses)

Un respaldo que nunca se probó no es un respaldo. El simulacro es abrir una
copia en tu computadora, **sin tocar el servidor**. Hace falta Node (el mismo
que usa `compilar-app.bat`) y la carpeta del proyecto.

- [ ] En **PowerShell**, dentro de la carpeta del proyecto, cargá las mismas
      variables que pusiste en Railway, solo para esa ventana:

  ```powershell
  $env:RESPALDO_S3_ENDPOINT="https://<ID>.r2.cloudflarestorage.com"
  $env:RESPALDO_S3_BUCKET="flota-respaldos"
  $env:RESPALDO_S3_KEY_ID="<Access Key ID>"
  $env:RESPALDO_S3_SECRET="<Secret Access Key>"
  $env:RESPALDO_CIFRADO="<la frase>"
  ```

- [ ] Instalá las dependencias del servidor, si no están (una sola vez):

  ```powershell
  cd server; npm install; cd ..
  ```

- [ ] Listá las copias y bajá la más nueva:

  ```powershell
  node server/restaurar.js listar
  node server/restaurar.js bajar respaldos/respaldo-AAAA-MM-DD-HHMMSS.db.gz.enc prueba.db
  ```

  Tiene que decir **«✔ prueba.db (… kB), verificada»**. Si dice que la frase
  no es la de ese respaldo, la frase guardada no es la buena: es justo lo que
  el simulacro sirve para descubrir a tiempo.
- [ ] Borrá `prueba.db` cuando termines: tiene los datos de todos.

**Para volver a un respaldo de verdad** (la base se dañó, se borró algo por
error, se perdió el volumen):

1. Panel del creador → RESPALDOS → copiar el nombre de la copia (o de uno
   del disco, con `local:` adelante).
2. Railway → Variables → `RESTAURAR_DESDE` = ese nombre → se redespliega
   solo.
3. Mirar el panel del creador → SISTEMA: dice «BASE RESTAURADA» y dónde
   quedó la base de antes (no se borra). Si el servidor no arranca, el log de
   Railway dice por qué, y la base actual no se tocó.
4. Sacar `RESTAURAR_DESDE` de las variables.

Lo que se cargó **después** de ese respaldo se pierde (queda en la base de
antes, guardada al lado). Por eso conviene elegir el más nuevo que esté bien.

## 6. Despacho

- [ ] **Cargar el teléfono de la central** (cuenta de gerencia → Gestión →
      Empresa → *Teléfono de la central para emergencias*). Es a donde el
      chofer llama o manda un SMS si el SOS no sale por falta de internet:
      tiene que ser un número que **siempre** atienda alguien (un celular de
      guardia, no el fijo de la oficina). Los choferes lo reciben la próxima
      vez que abran la app.
- [ ] **Probarlo una vez** con un teléfono: con los datos móviles apagados (y
      el WiFi también), deslizar el SOS. Tiene que aparecer «SOS NO SALIÓ» con
      LLAMAR y MANDAR SMS; el SMS tiene que llegar al celular de guardia con la
      combi y un enlace al mapa (avisale antes a quien tenga ese celular).
- [ ] Contarles que la tarjeta de cada combi ahora dice **cómo está el
      teléfono** del chofer: antes de llamarlo porque «no aparece», mirar si
      dice «se está por apagar» o «ahorro de batería activado». Con el
      ahorro activado, el chofer tiene que ir a Ajustes → Batería → la app →
      **«Sin restricciones»** (en Xiaomi, además, «Inicio automático»).
- [ ] Para cargar a todos los choferes y cobradores de una vez: Gestión →
      Personas → **Cargar una planilla**. Sirve la planilla que ya tengan
      (Excel, Google Sheets, LibreOffice o CSV) con una columna de **Nombre**
      y una de **Combi**; hay una de ejemplo para bajar. Antes, que la
      gerencia dé de alta las combis. Las claves se ven **una sola vez** al
      crear: bajá el CSV de claves y repartilas en mano.
- [ ] Contarles que las horas **se pueden corregir** (Gestión → Turnos →
      *Corregir* o *Agregar un turno que faltó*), siempre con un motivo que
      queda registrado. Y decidir dos cosas que el sistema deja abiertas: si
      lo puede hacer cualquier Despacho o sólo la gerencia, y si al chofer se
      le avisa cuando le corrigen las horas (hoy las ve corregidas en su
      perfil, sin aviso).
- [ ] Contarles **«Guardar como evidencia»** (debajo de cada mensaje del
      chat): la foto de un choque, la nota de voz de un pasajero agresivo.
      Con el motivo, queda un año; sin marcar, las fotos y audios se borran a
      los 30 días. Y que lo que ya no haga falta se desmarque (hay un techo
      de 500 por cooperativa).
- [ ] **Decidir el disco** (ahora que las fotos y audios se guardan 30
      días). Cada respaldo local es una copia entera de la base y se
      guardan 28 (una semana). En el piloto, con fotos de peor caso, eso es
      unos 7 GB de volumen en Railway (cerca de US$ 1 al mes); a 500
      unidades, unos 150 GB. Ahora que hay copia afuera (punto 4), una
      opción simple es bajar `RESPALDO_CONSERVAR` a 8 (dos días en el
      volumen; la semana entera queda afuera). Otra, que el respaldo local
      no lleve las fotos — eso es código, pedilo si lo querés. Mientras
      tanto, mirar el tamaño del volumen en Railway: `/salud` avisa con
      menos de 500 MB libres.
- [ ] **Mirar la lista de qué movimiento es de qué tipo** en la auditoría
      (está en `CAMBIOS-PARA-REVISAR.md`, bloque 11) y decir si algo va en
      otro lado. En particular: el SOS quedó con 365 días; si la cooperativa
      o un abogado quieren el registro de los SOS por más tiempo, se pasa a
      «gestión» (2 años). Y confirmar que 2 años alcanzan para altas, bajas y
      claves.
- [ ] Decirle a cada operador que **al empezar el turno** toque **«Activar
      alarma de SOS»** (el botón ámbar arriba) y **acepte las notificaciones**
      cuando el navegador pregunte. Mientras ese botón se vea, un SOS puede
      llegar sin sonido.
- [ ] Un **simulacro de SOS** con Despacho: un chofer dispara uno avisado,
      Despacho ve el cartel, escucha la alarma y marca ATENDIDO, y el chofer
      ve «DESPACHO VIO TU SOS». Así nadie lo ve por primera vez en una
      emergencia de verdad.

## 7. Lo que ya estaba pendiente y sigue fuera del código

- [ ] **Geoapify: el tope de gasto** (Billing). El dominio ya está
      restringido; falta el techo, que es lo que de verdad limita el daño si
      alguien usa la clave (PENDIENTES 1.5).
- [ ] **Un turno de 8 horas midiendo la batería**, y probar la app en
      Xiaomi, Huawei u Oppo, que son los que más matan apps en segundo plano
      (PENDIENTES 1.3).
- [ ] **El dominio propio** antes de repartir la APK a muchos teléfonos: la
      dirección del servidor queda compilada adentro (los pasos están en
      `DOMINIO.md`).
- [ ] **Ley 29733 (datos personales)**: inscribir el banco de datos ante la
      ANPD, el consentimiento por escrito del chofer (la ubicación con la
      pantalla apagada) y el contrato de encargado con cada cooperativa
      (PENDIENTES 0.10). Conviene con un abogado.
- [ ] **Google Play** cuando quieras dejar de repartir la APK a mano: los
      pasos están en `PLAYSTORE.md`. En el formulario de *Seguridad de los
      datos* hay que declarar, además de la ubicación, el **estado del
      teléfono** (batería, ahorro de batería: «información y rendimiento de
      la app») y que los respaldos se guardan **cifrados** con un tercero. La
      política de privacidad (`/privacidad`) ya lo dice.
