# Contrato de encargo de tratamiento de datos personales

> **BORRADOR para revisión de un abogado** (ver `LEEME.md`). Los corchetes
> son lo que hay que completar o decidir. Las cláusulas técnicas describen
> lo que el sistema hace de verdad al 04/11/2026: si el sistema cambia,
> cambian ellas.

Conste por el presente documento el contrato de encargo de tratamiento de
datos personales que celebran:

- **LA COOPERATIVA**: [razón social], RUC [ ], con domicilio en [ ],
  representada por [nombre], identificado con DNI [ ], según poder inscrito
  en [ ]; en calidad de **titular del banco de datos y responsable del
  tratamiento**.
- **EL ENCARGADO**: [nombre o razón social del operador], RUC [ ], con
  domicilio en [ ], representado por [ ]; que presta el servicio de control
  de flota «Control de ruta».

En los términos siguientes:

## Primera — Objeto

LA COOPERATIVA encarga a EL ENCARGADO el tratamiento de los datos
personales de sus conductores, cobradores y personal de despacho y
gerencia, con la única finalidad de prestarle el servicio de control de
flota contratado [referencia al contrato de servicio], conforme a la Ley
N.º 29733, su Reglamento (D.S. N.º 016-2024-JUS) y las instrucciones de LA
COOPERATIVA.

## Segunda — Datos y finalidades

| Datos | Para qué |
|---|---|
| Identidad en el sistema: nombre, alias, usuario, rol, vehículo | Dar acceso y saber quién maneja qué unidad |
| Ubicación durante el turno, incluida la que se emite con la pantalla apagada o la aplicación en segundo plano | Mapa en vivo, separación entre unidades, vueltas, desvíos, horas en ruta, atención de emergencias |
| Ubicación leída sin enviarse en la pantalla de inicio de turno | Detectar que se está manejando sin haber iniciado el turno |
| Mensajes del chat: texto, notas de voz, fotos, emergencias (SOS) | Coordinación de la operación y atención de emergencias |
| Lugares puntuales del turno, con su hora: dónde se declaró en ruta, ausente o fuera (incluido dónde terminó el turno), cortes de señal, paradas, salidas del trazado | Horas en ruta, señal y presencia, «dónde se traba» la ruta |
| Marcas automáticas («GPS sospechoso», «entrada tardía», «salió solo», «fuera de ruta», «reloj adelantado») | Avisos para que una persona de LA COOPERATIVA los revise. **No producen ninguna decisión por sí solas**: LA COOPERATIVA se compromete a no sancionar a nadie sólo por una marca automática y a explicarla si el titular lo pide |
| Estado del teléfono durante el turno (batería, ahorro de energía, versión de la app), sin almacenarse | Explicar por qué una unidad dejó de verse |
| Registro de actividad: accesos, altas, bajas, cambios de clave, correcciones | Seguridad y trazabilidad de las acciones administrativas |

EL ENCARGADO **no** usará los datos para fines propios ni de terceros: ni
publicidad, ni venta, ni estadísticas para otros clientes, ni el
entrenamiento de sistemas. [Si en el futuro se quisieran estadísticas
agregadas y anónimas del servicio, se acordará por escrito aparte.]

## Tercera — Instrucciones

EL ENCARGADO tratará los datos sólo según las instrucciones de LA
COOPERATIVA, que se expresan en este contrato y en la configuración que
ella misma hace del sistema (sus rutas, sus usuarios, sus permisos). Si
alguna instrucción le parece contraria a la ley, lo dirá por escrito antes
de cumplirla.

## Cuarta — Confidencialidad

EL ENCARGADO y su personal guardarán secreto sobre los datos, aun después
de terminado el contrato. Sólo accede a ellos el personal que lo necesite
para dar el servicio y soporte, y queda registrado en el sistema.

## Quinta — Medidas de seguridad

EL ENCARGADO mantiene, como mínimo:

1. Cifrado en tránsito de toda comunicación (HTTPS y WebSocket seguro).
2. Contraseñas almacenadas con función de hash irreversible; nadie puede
   verlas, tampoco EL ENCARGADO.
3. Separación lógica de los datos por cooperativa y control de acceso por
   rol: ninguna cooperativa accede a los datos de otra.
4. Registro de actividad de los accesos y las acciones administrativas,
   consultable por LA COOPERATIVA (sección «Actividad» de su panel).
5. Respaldos automáticos verificados y una copia fuera del servidor
   **cifrada (AES-256) antes de salir**, que el proveedor de almacenamiento
   no puede leer.
6. Plazos de conservación aplicados automáticamente por el sistema
   (cláusula novena).
7. [Segundo factor de autenticación para el panel de administración del
   operador.]

## Sexta — Sub-encargados

LA COOPERATIVA autoriza a EL ENCARGADO a servirse de los siguientes
proveedores, sólo para prestar el servicio:

| Proveedor | Servicio | Ubicación |
|---|---|---|
| Railway Corporation | Alojamiento del servidor y la base de datos | [región] |
| [Proveedor del almacenamiento] | Copias de respaldo cifradas | [región] |
| Geoapify | Imágenes del mapa (recibe la dirección IP, no la identidad) | [ ] |

EL ENCARGADO avisará con [30] días de anticipación cualquier cambio de
proveedor. LA COOPERATIVA podrá oponerse por causa justificada. EL
ENCARGADO responde por sus sub-encargados como por sí mismo.

## Séptima — Flujo transfronterizo

Los datos se alojan en servidores ubicados fuera del Perú. EL ENCARGADO
garantiza que los proveedores de la cláusula sexta ofrecen [garantías
adecuadas: describir, p. ej. cláusulas contractuales del proveedor, nivel
de protección del país]. LA COOPERATIVA declara haberlo informado a los
titulares (formulario de consentimiento) [y ante la ANPD, según
corresponda].

## Octava — Incidentes de seguridad

Si EL ENCARGADO toma conocimiento de un incidente que afecte o pueda
afectar los datos de LA COOPERATIVA, se lo comunicará **dentro de las 24
horas**, por [teléfono y correo a: ], con lo que se sepa en ese momento:
qué pasó, qué datos y cuántas personas, qué se hizo y qué se recomienda.
Así LA COOPERATIVA puede cumplir su plazo de **48 horas** ante la
Autoridad y, cuando corresponda, ante los titulares. EL ENCARGADO
colaborará con la investigación y con las medidas que se tomen.

## Novena — Conservación

Los datos se conservan por los plazos siguientes, que el sistema aplica
solo:

| Dato | Plazo |
|---|---|
| Chat (texto, fotos, notas de voz) | 30 días |
| Mensajes marcados como evidencia por LA COOPERATIVA | 365 días |
| Vueltas, tramos y desvíos | 120 días |
| Lugares puntuales del turno y marcas automáticas | 120 días |
| Turnos y emergencias (SOS) | 365 días |
| Registro de actividad | accesos 90 días; operación 365 días; gestión 730 días |
| Posición en vivo y estado del teléfono | sólo el último valor |
| Copias de respaldo | 30 días |

[LA COOPERATIVA podrá pedir plazos distintos por escrito; algunos se
configuran por cooperativa y otros para todo el servidor.]

## Décima — Derechos de los titulares

Si un titular le pide a EL ENCARGADO acceso, rectificación, cancelación,
oposición o portabilidad, éste lo derivará a LA COOPERATIVA en [2] días
hábiles y la asistirá para responder en plazo, entregándole lo que el
sistema tenga de esa persona.

## Undécima — Fin del contrato

Al terminar el contrato, EL ENCARGADO:

1. Entregará a LA COOPERATIVA, si lo pide dentro de los [30] días, una
   copia de sus datos en formato abierto (CSV).
2. Borrará los datos de LA COOPERATIVA del sistema dentro de los [30] días
   siguientes. Las copias de respaldo que los contengan se borran solas a
   los 30 días de hechas.
3. Le confirmará el borrado por escrito.

Salvo que una ley le obligue a conservar algo, en cuyo caso lo dirá.

## Duodécima — Verificación

LA COOPERATIVA podrá pedir información sobre el cumplimiento de este
contrato, y EL ENCARGADO la dará por escrito en [15] días hábiles.
[Auditoría presencial: decidir si se acepta y con qué aviso.]

## Decimotercera — Responsabilidad

Cada parte responde por los incumplimientos que le sean imputables. EL
ENCARGADO que use los datos para un fin distinto del encargado será
considerado responsable del tratamiento por ese uso.

## Decimocuarta — Vigencia

Este contrato rige mientras dure la prestación del servicio y sus
obligaciones de confidencialidad, devolución y borrado subsisten después.

Firmado en [ciudad], el [fecha], en dos ejemplares.

| LA COOPERATIVA | EL ENCARGADO |
|---|---|
| [nombre, cargo, firma] | [nombre, cargo, firma] |
