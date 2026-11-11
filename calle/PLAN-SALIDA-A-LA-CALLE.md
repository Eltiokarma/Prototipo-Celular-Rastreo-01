# Micros Tempo — Plan de salida a la calle

Nov 11, 2026 · @Gerson Napan

## Resumen

Micros Tempo tiene servidor multi-cooperativa, app nativa, panel de Despacho y 68 suites de pruebas, pero ninguna combi real lo ha usado. Este plan lo pone en 3 combis de la primera ruta en tres semanas y cierra con una decisión el jueves 3 de diciembre.

**Regla de oro: el código se congela desde el 12 de noviembre.** Solo se arregla lo que la calle rompa. Nada de funciones nuevas, Bolivia, Play Store ni dominio hasta la decisión.

**Supuesto de tiempo:** unas 4 horas al día libres mientras sigues ayudando en Candela. Si tienes menos, estira las fases; no te saltes ninguna.

&#91;embedded content: hoja de ruta · 4 fases, 3 compuertas\]

Cada compuerta se pasa o se corrige antes de avanzar; la Fase 1 puede empezar aunque la compuerta 0 esté pendiente.

## Fase 0 · Congelar y desplegar (jue 12 al dom 15 de nov)

El objetivo es que la versión 0.3.0 complete una vuelta real en tu teléfono, con Despacho viéndola. Solo entra lo mínimo de TAREAS-FUERA-DEL-CODIGO.md para tener datos reales sin riesgo.

**Jueves 12 · Servidor**

- [ ] Desplegar main en Railway y ver en el log que guardó y retomó la memoria caliente
- [ ] Variables: `TZ=America/Lima`, `CONTACTO_PRIVACIDAD=soporte@microstempo.com`, `ALERTA_URL` (un tópico de ntfy en tu teléfono)
- [ ] Monitor externo gratuito (UptimeRobot o Better Stack) a `/salud` cada 5 minutos
- [ ] Tope de gasto en Geoapify (Billing)

**Viernes 13 · Respaldos**

- [ ] Crear el bucket (Cloudflare R2 o Backblaze B2) y poner las cuatro variables `RESPALDO_S3_*`
- [ ] Poner `RESPALDO_CIFRADO` y guardar la frase en un gestor de contraseñas
- [ ] Simulacro: bajar y descifrar un respaldo con `node server/restaurar.js` en tu laptop

**Sábado 14 · App**

- [ ] Compilar la APK 0.3.0 dos veces con `compilar-app.bat`: la de choferes y la de tu teléfono
- [ ] Instalarla y publicar un arreglo chico con `publicar-arreglo.bat` solo a tu teléfono para ver que llega
- [ ] Revisar en el trazador que la ruta piloto coincide con la real

**Domingo 15 · Prueba en la calle**

- [ ] Subirte como pasajero a una combi de la ruta piloto con la app en modo chofer y Despacho abierto en otro teléfono o en la laptop
- [ ] Comprobar: salir a ruta, que la vuelta se cuente y un SOS de prueba hasta ATENDIDO
- [ ] Anotar la batería al subir y al bajar
- [ ] Imprimir 6 formularios de consentimiento desde `/consentimiento` para el piloto

**Compuerta 0:** una vuelta real contada y vista en Despacho. Si falla, se arregla antes del piloto. La Fase 1 no depende de esto y puede empezar igual.

## Fase 1 · Pruebas con la app y plata (lun 16 al dom 22 de nov)

El problema ya está validado por años de observación desde el asiento del pasajero: el chofer maneja pendiente de la brecha con el de adelante y el de atrás, sobre todo cuando se acercan y cuando quiere rebasar. Esta semana no se vuelve a preguntar eso. Se prueba lo que la observación no podía ver: si la pantalla se entiende de un vistazo, quién pone la plata y qué frena a usarla.

**Lo que se prueba**

1. **La pantalla:** 15 pruebas de vistazo con el teléfono de demostración. Se mide si el chofer lee bien la brecha normal y la crítica, y cuánto tarda.
2. **La plata:** cómo se reparte entre chofer y dueño, y quién paga hoy por un dato o un control (datero, controlador, GPS).
3. **Los frenos:** control del dueño, seguridad de la ubicación, datos móviles y batería.

**Cómo se pregunta** (*The Mom Test*, ajustado a un producto que ya existe)

- La app se muestra con una tarea y se mira qué hacen; no se pide opinión
- La plata se pregunta sobre lo ya pagado, nunca “¿cuánto pagarías?”
- Un “yo sí la usaría” se convierte en pedido: probarla una semana desde el lunes 23
- Cada encuentro termina en un compromiso: entrar al piloto, presentar al dueño o a la directiva

**Antes del lunes 16**

- [ ] Teléfono de demostración: la app conectada a una cooperativa de prueba, con `herramientas/flota.js` moviendo combis simuladas sobre la ruta piloto, y un modo para pasar de brecha cómoda a crítica
- [ ] El panel de Despacho en la misma demostración, para dueños y controlador
- [ ] Jornada de preparación con el personal de calle (guía de campo, “Antes del primer día”)

**El orden de la semana**

| Días | Con quién | Para qué |
| --- | --- | --- |
| Lun 16 y mar 17 | Choferes y controlador o datero | Pruebas de vistazo, plata y frenos |
| Mié 18 y jue 19 | Dueños y más choferes | Plata y control, y cerrar la lista del piloto |
| Vie 20 | Directiva, con Gerson al frente | Mostrar el resumen de las pruebas y pedir el piloto con fecha y nombres |
| Sáb 21 y dom 22 | Síntesis | Quién paga, qué no se entendió de la pantalla y qué frena |

El día a día, los guiones, las fichas y las respuestas a preguntas difíciles están en Guía de campo COOP-R14 — para el personal de calle.

**Compuerta 1:** (1) sabes cómo se reparte la plata y quién paga hoy por control; (2) al menos 10 de 15 choferes leen bien la brecha crítica de un vistazo (umbral propuesto); (3) 3 choferes y el controlador aceptan con nombre, y la directiva da el piloto con fecha. Si falla la 2, se corrige la pantalla antes del piloto: es un arreglo que pidió la calle, así que no rompe la regla de oro. Si falla la 3, pruebas con otra ruta esa misma semana.

## Fase 2 · Piloto de 3 combis (lun 23 al lun 30 de nov)

Se trata de una semana gratis con 3 combis y el controlador de la ruta como Despacho. Tu trabajo es observar y anotar, no programar.

**Lunes 23 · Montaje**

- [ ] Alta masiva desde la planilla: 3 choferes, sus cobradores y sus vehículos con placa
- [ ] Instalar la APK en los 3 teléfonos, quitar el ahorro de batería y anotar marca y modelo de cada uno
- [ ] Firma del consentimiento de cada chofer y cobrador, y anotarlo en Gestión → Personas
- [ ] 15 minutos con cada chofer: salir a ruta, AUSENTE, SOS de prueba
- [ ] Con el controlador: activar la alarma de SOS, leer el “N de M” y responder el chat
- [ ] Cargar el teléfono de la central en Gestión → Empresa

**Martes 24 al lunes 30 · Operación diaria**

1. **Al arrancar el turno:** revisa en Despacho cuántas de las 3 están reportando. Si falta una, llama ese mismo momento y anota la causa.
2. **Al mediodía:** 30 minutos en el paradero. Mira si el chofer consulta la pantalla y pregunta por hechos de ese día: “¿en qué momento la dejaste de mirar o la apagaste? ¿Por qué?”
3. **En la noche:** revisa `/salud`, la batería de cada teléfono, los cortes en “Dónde se traba” y llena una bitácora de 3 líneas.
4. **Jueves 26 y lunes 30:** conversación corta con cada chofer y con el controlador sobre lo que pasó, no sobre si les gusta: “cuéntame la última vez que la brecha te hizo cambiar de ritmo”.

Los arreglos solo se publican con `publicar-arreglo.bat` y solo si algo bloquea el uso. Primero a tu teléfono, después a los 3.

**Qué se mide**

| Métrica | De dónde sale | Va bien si |
| --- | --- | --- |
| Parte del turno en ruta con la app | Gestión → Turnos y presencia | 80 % o más del turno |
| Días de uso sin que insistas | Tu bitácora | 5 de 7 días por chofer |
| Vueltas contadas frente a vueltas reales | Gestión → Vueltas contra la tarjeta del controlador | Diferencia de 1 o menos al día |
| Batería por turno y por marca | Tarjeta de Despacho y tu bitácora | El teléfono llega al final del turno |
| El chofer mira la brecha manejando | Observación desde el asiento y la última vez que la usó | 2 de 3 cuentan un caso concreto en que cambiaron de ritmo por la brecha |
| El controlador usa Despacho solo | Observación | Lo abre sin ti 5 de 7 días |
| Dónde se traba la ruta y los cortes de señal | Gestión → Dónde se traba | Solo se registra; va al informe |

**Compuerta 2:** los 3 choferes la usaron al menos 5 de 7 días sin que insistieras, y hay datos suficientes para un informe de la semana.

## Fase 3 · Informe y decisión (mar 1 al jue 3 de dic)

El piloto se convierte en un informe que la directiva entiende y en un pedido concreto de plata. Un sí sin plata o sin fecha no cuenta como sí.

**Martes 1 · El informe para la cooperativa**

Dos páginas, sin términos técnicos, armadas con los CSV de Informes:

- Vueltas por combi y por día, comparadas con la tarjeta del controlador
- Qué tan parejas fueron las brechas y cuántas veces se pusieron críticas
- Dónde y a qué hora se traba la ruta
- Lo que hicieron los choferes con la app, con casos concretos (los elogios no van)

**Miércoles 2 · Reunión con la directiva**

- Presenta el informe en 10 minutos y deja que pregunten
- Pide el siguiente paso con precio: S/ 0,30 por combi al día (unos S/ 9 al mes), cobrado a quien resultó pagador en la Fase 1
- Cierra con algo concreto: fecha de arranque con toda la ruta, primer pago o un acta firmada. Si responden “qué bueno, avísennos” o “lo vamos a conversar”, no es un sí: pregunta qué tendría que pasar para decidir y quién decide

**Jueves 3 · La decisión**

| Resultado | Señales | Qué haces |
| --- | --- | --- |
| Seguir | Compuertas 1 y 2 pasadas, y alguien pone plata o una fecha firmada | Toda la ruta piloto en diciembre. Recién ahí: abogado, dominio y Play Store |
| Ajustar | Lo usan, pero la directiva no paga o el dolor está en otro actor | Dos semanas más de discovery con ese actor (dueños o choferes) y otro modelo de cobro |
| Parar | No lo usan sin que insistas, o nadie describe un dolor que pague | Micros Tempo se archiva y Quipu pasa al frente, donde sí conoces el negocio por dentro |

## Modelo comercial: lo que decides tú

El video de Euge Oller sobre 25 formas de vender software deja seis decisiones que no puede tomar el equipo de calle. Todas se adaptan a una ruta de Juliaca, donde se gana y se paga por día, se cobra por Yape o en efectivo y la decisión colectiva se toma en asamblea.

| Decisión | Lo que propone el video | Cómo se adapta a la ruta | Mi recomendación |
| --- | --- | --- | --- |
| Quién paga | De abajo hacia arriba (Notion, Slack): gratis para el usuario, paga la organización | El chofer la usa gratis, y pagan el dueño o la cooperativa, que son los que reciben el panel y los informes | Probarlo con los pioneros: es la hipótesis más fuerte, porque el que mira la pantalla no es el que gana con los datos |
| Cómo se cobra | Suscripción, pago por adelantado o pago por uso (AWS) | La suscripción mensual con tarjeta es la parte “europea”. Acá calza el pago por uso: S/ 0,30 solo por cada día que la combi sale | Cobro por día de uso, liquidado por semana por Yape. Para dueños con varias combis, un mes adelantado con descuento |
| Qué se vende junto | El paquete sube el valor percibido (Office) | App, soporte de parabrisas, instalación y un informe semanal de la combi para el dueño | Vender el paquete, no la app sola. El soporte cuesta poco y hace que la pantalla se vea |
| Por dónde entra | Venir de serie con quien ya tiene a todos los clientes (Microsoft) | La cooperativa es el canal: si la adopta como norma, entran todas las combis | Ir por la asamblea apenas haya 6 a 8 combis en uso. Antes es pedir fe |
| Cómo se paga al equipo | Los comerciales viven de sus incentivos (Oracle) | Si se paga por instalación, se llenan teléfonos de apps que nadie usa | Pagar el variable por combi “En uso” a los 14 días, no por instalación |
| Contra qué te posicionas | Un enemigo claro (Salesforce contra el software en disco) | El enemigo es manejar a ciegas y el correteo, no el datero ni el controlador, que pueden ser aliados | Nunca hablar mal de nadie de la ruta. “Micros Tempo es tu celular viendo lo que antes adivinabas” |

La del controlador o el datero como **revendedor** con comisión (el modelo de GoHighLevel) suena bien, pero tiene conflicto de interés: vive de vender el dato que la app regala. Pruébala solo después de la primera ruta, y con uno solo.

## Riesgos y plan B

El riesgo más probable no es técnico: es que la plata no la ponga quien tú crees.

| Riesgo | Señal temprana | Plan B |
| --- | --- | --- |
| El chofer paga una cuota fija y al dueño no le importa la plata | Fase 1, primeras conversaciones | El comprador pasa a ser la directiva (orden y municipalidad) o el chofer, con un cobro diario como el del datero |
| La directiva no recibe o no da el piloto | Fase 1, viernes | Un socio con 3 combis que acepte directo, u otra ruta de Juliaca |
| Los choferes no quieren ser rastreados | Lunes 23, al firmar | Mostrar qué ve cada uno y venderles su ventaja: la brecha pareja les da más pasajeros |
| Teléfonos baratos que matan la app en segundo plano | Primeros 2 días, combi que no aparece | Guía de ajustes por marca; en el peor caso, un teléfono dedicado por combi |
| Choferes sin datos móviles | Cortes largos sin señal en Despacho | Anotar cuánto gastan en datos; si pesa, entra en el precio |
| Candela se come tus horas | Fase 0 se atrasa | Bloques fijos de madrugada o tarde; mueves las fechas, no te saltas fases |
| Volver a programar | Commits que no arreglan nada de la calle | La regla de oro; cada idea va a la lista de abajo |

## Congelado hasta la decisión

Nada de esto se toca antes del 3 de diciembre. Si la decisión es seguir, se ordena con lo que dijo la calle.

- Bolivia y la zona horaria por empresa (PENDIENTES 0.13)
- Dominio `app.microstempo.com` y Google Play
- Reunión con el abogado e inscripción ante la ANPD (el consentimiento firmado sí va en el piloto)
- Nombres de calles en el mapa propio
- Escalar a 2000 unidades y quitar Babel del navegador
- Cualquier función nueva que no haya pedido un chofer o el controlador
