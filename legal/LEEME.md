# Datos personales (Ley 29733): qué hay que hacer y en qué orden

> **No es asesoría legal.** Es un mapa para llegar a la reunión con el abogado
> sabiendo qué preguntar, con borradores para que corrija en vez de escribir
> de cero. Las normas citadas están al **04/11/2026**; lo marcado con
> **[confirmar]** es interpretación que tiene que validar un abogado.

## Las normas

- **Ley N.º 29733**, de Protección de Datos Personales (2011).
- **Su Reglamento nuevo, D.S. N.º 016-2024-JUS**: publicado el 30/11/2024,
  vigente desde fines de marzo de 2025. Reemplazó al de 2013 (D.S.
  003-2013-JUS). Trajo, entre otras cosas, la notificación de incidentes en
  48 horas, el oficial de datos personales y el derecho a la portabilidad.
- **Directiva N.º 001-2025-JUS/DGTAIPD** (vigente desde el 01/01/2026): cómo
  se designa al oficial de datos personales.
- La autoridad es la **ANPD** (Autoridad Nacional de Protección de Datos
  Personales), del Ministerio de Justicia. Multas de hasta 100 UIT por
  infracción.

## Quién es quién

| Papel en la ley | Quién | Por qué |
|---|---|---|
| **Titular de los datos** | Cada chofer y cobrador | Son sus datos: su ubicación, su nombre, sus horas |
| **Responsable** (titular del banco de datos) | **Cada cooperativa** | Ella decide controlar su flota y para qué. Es la que inscribe el banco, la que junta los consentimientos y a la que se le reclama |
| **Encargado** del tratamiento | **Vos** (el operador del sistema) | Guardás y procesás los datos por cuenta de la cooperativa, según sus instrucciones. Te obliga el contrato de encargo |
| **Sub-encargados** | Railway (servidor), el almacenamiento de las copias afuera, Geoapify (mapas) | Proveedores que tocan datos para que el sistema funcione |

**[confirmar]** Que el abogado esté de acuerdo con este reparto. Lo que
cambiaría todo es que te consideraran *responsable*: por ejemplo, si usaras
los datos de las cooperativas para algo propio (estadísticas para vender,
mejorar el producto con datos de choferes). Hoy el sistema no lo hace, y el
contrato lo prohíbe expresamente.

## Los pasos, en orden

### 1. El abogado (una sola reunión, con estos papeles)

Llevá esta carpeta y la política de privacidad (`/privacidad` en el
servidor). Preguntas concretas:

- [ ] ¿Está bien el reparto de arriba (cooperativa responsable, vos encargado)?
- [ ] La ubicación de un trabajador para controlar su trabajo, ¿necesita
      consentimiento o entra en la excepción de la relación laboral o
      contractual (art. 14 de la ley)? **Aunque no haga falta, conviene
      tenerlo firmado**: la ubicación con la pantalla apagada es lo que
      Google Play y cualquier inspección van a mirar primero. Muchos choferes
      no son empleados de la cooperativa sino socios o dueños de la combi;
      eso cambia la respuesta.
- [ ] ¿Alcanza el formulario en papel (`/consentimiento`) o conviene además
      que la app lo pida al entrar?
- [ ] Los servidores fuera del Perú: ¿qué hay que declarar y qué garantías
      pedirle a cada proveedor (flujo transfronterizo)?
- [ ] ¿Tenés que inscribir un banco de datos propio? (Ver el paso 3.)
- [ ] ¿Te toca designar un oficial de datos personales? (Ver el paso 6.)
- [ ] Las **marcas automáticas** («GPS sospechoso», «entrada tardía»,
      «salió solo»): ¿entran en el derecho a un tratamiento objetivo y en lo
      que el reglamento dice de las decisiones basadas sólo en tratamiento
      automatizado? Hoy el sistema no decide nada solo y el contrato obliga a
      la cooperativa a no sancionar sólo por una marca (auditoría 11/11);
      falta que el abogado diga si alcanza.
- [ ] Los **lugares puntuales del turno** (dónde terminó, que suele ser la
      casa del chofer) se guardan 120 días: ¿es proporcional, o conviene
      acortarlo o guardar sólo la hora?
- [ ] Revisar y ajustar `contrato-encargo.md` y el texto de `/consentimiento`
      (la versión vigente es la del **11/11/2026**: quien firmó la del 04/11
      tiene que firmar la nueva).

### 2. Cada cooperativa inscribe su banco de datos

Es de la cooperativa, no tuyo, pero conviene que la ayudes: si no lo hace,
el problema termina siendo del sistema.

- Trámite en **gob.pe**: «Inscribir banco de datos en el Registro Nacional
  de Protección de Datos Personales». Desde el 31/03/2025 es **gratuito y de
  aprobación automática** (con fiscalización posterior), por la plataforma
  virtual de la ANPD.
- Lo firma el representante legal de la cooperativa, con el documento que
  acredita su representación.
- Se obtiene una **constancia** y un **código del banco de datos**.
- Para llenar el formulario, todo lo que pide (qué datos, para qué, quién
  los procesa, dónde se guardan, cuánto tiempo, medidas de seguridad) ya
  está escrito en `/privacidad` y en el contrato de encargo. **Ofrecé
  llenárselo** con esos textos.
- Nombre sugerido del banco: «Conductores y cobradores — control de flota».
- **[confirmar]** Si los servidores fuera del Perú se declaran ahí mismo
  (flujo transfronterizo) o aparte.

### 3. Tu propio banco de datos

**[confirmar]** Además de lo que guardás por cuenta de las cooperativas,
vos tenés datos propios: los contactos de cada cooperativa (gerente,
teléfono de la central, correo), y los de quien te escribe a soporte.
Probablemente sea un banco «Clientes» tuyo, chico, que también se inscribe.

### 4. El contrato de encargo con cada cooperativa

Borrador en **`contrato-encargo.md`**. Va con el contrato comercial (o como
anexo). Lo que fija: qué datos, para qué, que no los usás para nada más,
la seguridad, los proveedores, el aviso de incidentes y qué pasa al
terminar.

### 5. El consentimiento de cada chofer y cobrador

1. El formulario está en **`https://<tu servidor>/consentimiento`**. Se
   imprime desde el navegador (Ctrl+P): son dos carillas A4.
2. Cada uno lo lee, marca las casillas que acepta y firma. La cooperativa
   firma también, guarda el original y le da una copia.
3. Despacho → Gestión → Personas → **Consentimiento de datos personales**:
   se anota la fecha del papel. Ahí se ve quién falta.
4. Si el texto cambia (por ejemplo porque cambió la política de privacidad),
   se sube `CONSENTIMIENTO_VERSION` en `server/index.js`. Los que firmaron la
   versión anterior vuelven a aparecer como pendientes.
5. **Si alguien lo retira**: Despacho anota «Lo retiró», con cómo lo pidió.
   **[confirmar]** Qué hace la cooperativa en ese caso. El sistema no le
   apaga la app solo: sin la ubicación del turno la app no cumple su
   función, y eso es una decisión de la cooperativa, no del software.

### 6. El oficial de datos personales

Según la directiva de 2025, la obligación entra **por tamaño de empresa y
de a poco**: desde noviembre de 2025 las de más de 2300 UIT de ventas; desde
noviembre de 2026 las de 1700 a 2300 UIT; las pequeñas desde noviembre de
2027 y las micro desde noviembre de 2028. **Sin importar el tamaño**, si se
tratan datos sensibles o *grandes volúmenes*.

**[confirmar]** Si la ubicación continua de cientos de choferes cuenta como
«gran volumen». Puede ser externo, compartido y a tiempo parcial.

### 7. Si hay un incidente (una filtración, un acceso indebido, una pérdida)

**Hay 48 horas** desde que se sabe para avisar a la ANPD y, si los afecta,
a los titulares. Como la responsable es la cooperativa, el aviso a la ANPD
lo hace ella: **vos tenés que avisarle a ella antes** (el contrato dice 24
horas), con lo que se sepa hasta ese momento.

Qué tener listo de antemano:

- [ ] La lista de contactos de cada cooperativa para esto (un nombre y un
      teléfono que atiendan un domingo).
- [ ] Qué mirar primero en el sistema: la **Actividad** de cada cooperativa
      (Gestión → Actividad → *Accesos* y *Gestión*: quién entró, qué claves
      se cambiaron), los logs de Railway, y `/salud`.
- [ ] Cómo cortar: cambiar `DISPATCH_PASSWORD` revoca las sesiones de la
      cuenta DESPACHO; «Clave» en Personas cambia la de cualquiera; una
      cooperativa se puede suspender desde el panel del creador.
- [ ] El texto del aviso: qué pasó, qué datos, cuántas personas, qué se
      hizo, a quién preguntar.

## Lo que el sistema ya hace (para el formulario de la ANPD y el contrato)

- **Datos y finalidades**: los de `/privacidad` y `/consentimiento`, que
  dicen lo mismo.
- **Plazos de conservación**: aplicados por el propio servidor, no a mano
  (ver la tabla de `/privacidad`): chat 30 días, evidencia 365, vueltas y
  desvíos 120, turnos y SOS 365, auditoría 90 / 365 / 730 según el tipo.
- **Seguridad**: todo viaja cifrado (HTTPS/WSS); las contraseñas con hash
  irreversible; acceso separado por cooperativa y por rol; registro de
  actividad de las acciones administrativas; respaldos verificados y copia
  afuera **cifrada** (AES-256) que el proveedor no puede leer.
- **Derechos**:
  - *Rectificación*: Despacho → Personas → Editar (nombre y alias).
  - *Cancelación*: «Baja» borra la cuenta, sus combis habilitadas y sus
    mensajes privados personales. **Lo que es registro de trabajo** (turnos,
    vueltas, mensajes del grupo, actividad) **se queda hasta su plazo**:
    **[confirmar]** que eso esté bien como excepción.
  - *Acceso y portabilidad*: Despacho → Personas → Editar → **Bajar todos
    sus datos (ZIP)**. Trae un LÉEME que explica cada archivo, y lo que es
    de la combi (vueltas, desvíos…) sólo mientras esa persona la manejaba.
    Queda en la Actividad quién lo bajó y cuándo.

## Los proveedores (sub-encargados)

| Proveedor | Para qué | Qué datos ve | Dónde |
|---|---|---|---|
| **Railway** | El servidor y la base | Todo (es donde vive la base) | La región elegida en Railway → Settings **[confirmar cuál]** |
| **Almacenamiento de las copias afuera** (el que configures en `RESPALDO_S3_*`) | Copias de la base | Nada legible: van cifradas antes de salir | La región del bucket |
| **Geoapify** | El fondo del mapa, cuando no sale del mapa propio | La dirección IP del teléfono que pide la imagen; no la cuenta | Unión Europea **[confirmar]** |
| **Google Play** | Distribuir la app | Lo que Google ve de cualquier instalación | — |

No reciben datos personales: Expo/EAS (compila la app), ntfy u otro
servicio de alertas (sólo reciben el estado del servidor) y el dominio y el
correo (Hostinger).

## Los archivos de esta carpeta

- `LEEME.md`: esto.
- `contrato-encargo.md`: borrador del contrato con cada cooperativa.
- El formulario de consentimiento no está acá: lo sirve el servidor en
  `/consentimiento` (`server/consentimiento.html`), para que siempre esté
  la versión vigente.
