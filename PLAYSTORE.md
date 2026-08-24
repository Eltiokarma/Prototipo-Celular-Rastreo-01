# Publicar «Control de ruta» en Google Play

El objetivo no es aparecer en búsquedas: es que instalar la app deje de
asustar. Hoy el APK se instala por fuera de la tienda y Play Protect lo
marca como de origen desconocido — publicada en Play, esa alerta
desaparece y el chofer instala desde el mismo lugar que WhatsApp.

Lo que ya está en el repo (no hay que hacerlo de nuevo):

- **Perfil `production` en `app/eas.json`**: genera AAB (el formato que
  Play exige; los perfiles viejos siguen generando el APK interno) y sube
  el `versionCode` solo.
- **Política de privacidad pública**: la sirve el propio servidor en
  `/privacidad`, con los números de retención reales del sistema. El
  contacto sale de la variable `CONTACTO_PRIVACIDAD` (ponerla en el
  despliegue: un correo que puedas atender; sin ella queda un canal
  genérico).
- **La divulgación destacada de ubicación**: la pantalla «¿Salís a
  ruta?» dice qué se recopila (ubicación), cuándo (también con la
  pantalla apagada) y para qué (brecha y mapa), y el permiso se pide
  recién al deslizar — el orden que la política de Google exige. No
  recortar ese texto.

## El camino, en orden

### 1 · Cuenta de desarrollador (~1 semana, una vez)

1. [play.google.com/console](https://play.google.com/console) → cuenta
   personal, **US$25 una sola vez**, con verificación de identidad
   (documento) y de teléfono/correo.
2. **Regla que marca el calendario**: una cuenta personal creada hoy debe
   pasar una **prueba cerrada con al menos 12 testers durante 14 días
   seguidos** antes de poder publicar en producción. Los testers pueden
   ser los choferes y cobradores de R14 (necesitan cuenta de Google y
   aceptar una invitación por link). Una cuenta de **organización** (con
   RUC/D-U-N-S) no tiene ese requisito, pero su verificación tarda más.

### 2 · El binario

```bash
cd app
npx eas build --platform android --profile production
```

- EAS genera y guarda la **llave de firma**; en Play activá «Firma de
  aplicaciones de Google Play» (viene por defecto) y no hay nada que
  custodiar a mano.
- El paquete es `pe.coopr14.chofer` — **no se puede cambiar después**;
  si algún día esto deja de ser solo R14, conviene decidirlo ANTES de la
  primera subida (p. ej. `pe.controlderuta.chofer`).

### 3 · La ficha en Play Console

Crear app → completar **todas** las secciones de «Contenido de la app».
Las que van a mirar con lupa en ésta:

| Sección | Qué declarar |
| --- | --- |
| **Política de privacidad** | `https://<servidor>/privacidad` |
| **Ubicación en segundo plano** | Formulario de declaración: caso de uso «seguimiento de flota para empleados/operadores», y un **video** (subido a YouTube, puede ser oculto) que muestre: la pantalla «¿Salís a ruta?» con su texto → el deslizar → el diálogo de permiso del sistema → la combi en el mapa. Grabalo del teléfono real |
| **Seguridad de los datos** | Ver la tabla de abajo — tiene que decir lo mismo que `/privacidad` |
| **Público objetivo** | 18+, no dirigida a niños |
| **Acceso de la app** | La app entera requiere cuenta: cargá un **usuario y clave de demo** para el revisor (creá una cuenta de chofer en una empresa `MODO=demo`) — sin esto rechazan sin mirar |

**Formulario de seguridad de los datos** (las respuestas, listas para
copiar):

- Recopila datos: **sí**. Comparte con terceros: **no**.
- Datos cifrados en tránsito: **sí**. El usuario puede pedir borrado: **sí**.
- Ubicación (precisa, en segundo plano): recopilada, **finalidad de la
  app**, vinculada a la identidad, no opcional (es la función).
- Información personal (nombre): recopilada, vinculada, no opcional.
- Mensajes (chat), fotos, audio (notas de voz): recopilados, vinculados,
  **opcionales** (el usuario decide mandarlos).
- Nada para publicidad ni analytics.

### 4 · Prueba cerrada → producción

1. Subí el AAB a **Prueba cerrada** (pista «alpha» sirve), invitá a los
   ≥12 testers por lista de correos o link.
2. Que la usen los 14 días — el turno normal alcanza de sobra; los
   testers cuentan si la tienen instalada, no hace falta que hagan nada
   especial.
3. Pedí el acceso a producción desde la consola, contestá el
   cuestionario (para qué es la app, quiénes son los usuarios), y al
   aprobarse, **promocioná el mismo AAB** a producción.
4. Si no querés que aparezca en búsquedas: en producción se puede
   publicar como **no listada** dejando la ficha activa solo por link
   directo — instalable desde Play con toda su confianza, invisible para
   el resto. Para cooperativas cliente alcanza y sobra.

### 5 · Textos de la ficha (borrador listo)

- **Nombre** (30): `Control de ruta`
- **Descripción corta** (80): `La app del conductor: tu brecha en vivo,
  tu ruta y tu central, en una pantalla.`
- **Descripción larga** (borrador): «Control de ruta es la aplicación del
  conductor y el cobrador de las cooperativas de transporte que usan
  nuestro sistema de control de flota. Al salir a ruta, tu combi aparece
  en el mapa de tu central y la app te muestra en grande lo que importa
  manejando: la separación con la combi de adelante, tu vuelta y tu
  ruta. Incluye chat con tu central, botón de emergencia deslizable,
  registro de tus horas y vueltas, y perfil con tus números. Requiere
  una cuenta creada por tu cooperativa: si tu empresa todavía no usa el
  sistema, escribinos.»
- Assets que pide la ficha: ícono 512×512, banner 1024×500, mínimo 2
  capturas (sacalas del teléfono en la pantalla de brecha, el mapa y la
  puerta de salida a ruta).

## Qué NO hacer

- No declarar la ubicación como «opcional» ni esconder el segundo plano
  para «pasar» la revisión: la app usa `ACCESS_BACKGROUND_LOCATION` y
  Google lo ve en el manifiesto. La declaración honesta con el video es
  el camino que aprueba.
- No subir un APK firmado a mano por fuera de EAS: cambiaría la firma y
  los teléfonos con el APK viejo no podrían actualizar.
- No borrar ni suavizar el texto de la puerta «¿Salís a ruta?» — es la
  divulgación que la revisión busca.

## Calendario realista

| Semana | Qué pasa |
| --- | --- |
| 1 | Cuenta + verificación de identidad · build AAB · ficha y formularios |
| 2–3 | Prueba cerrada corriendo con los choferes (14 días) |
| 4 | Solicitud de producción, revisión (2–7 días la primera vez), publicación |
