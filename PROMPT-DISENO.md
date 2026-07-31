# Prompt para el rediseño de la interfaz

> **Ya se usó y ya se implementó.** Design entregó una propuesta contra este
> encargo y está construida: panel de Despacho, Gestión como espacio de
> trabajo con riel, trazador y panel del creador. Lo que quedó afuera y por
> qué está en `PENDIENTES.md`. El archivo se conserva porque su segunda
> mitad —qué parece estético y no lo es— sigue valiendo para el próximo
> rediseño, incluido el de la app del chofer, que quedó fuera de esta vuelta.

Este archivo es el encargo que se le pasa a quien vaya a rediseñar las
pantallas. Está escrito para pegarse tal cual.

Lo importante no es la lista de pantallas —eso se ve abriéndolas— sino la
segunda mitad: **qué cosas de esta interfaz parecen decisiones estéticas y no
lo son.** Un rediseño que las toque no queda feo, queda roto.

---

## EL ENCARGO (copiar desde acá)

Rediseñá la interfaz de un sistema de control de flota de combis que ya
funciona. El código es correcto y está probado; lo que falta es que se vea
bien. **No cambies comportamiento, endpoints ni permisos: solo cómo se ve.**

### Qué es esto

Un sistema de rastreo para cooperativas de transporte urbano en Juliaca,
Perú (3800 m de altura). Las combis de una ruta tienen que mantener una
**brecha** pareja entre sí —la separación en minutos con la unidad de
adelante y la de atrás— para que no viajen en pelotón dejando huecos de 20
minutos. El sistema mide esa brecha en vivo y se la muestra al chofer.

Hay **tres pantallas**, cada una para gente distinta:

| Archivo | URL | Quién y en qué |
| --- | --- | --- |
| `project/Prototipo.html` | `/` | Chofer y cobrador · **celular** en soporte al parabrisas |
| `project/despacho.html` | `/despacho.html` | Despacho de la cooperativa · **escritorio**, a veces tablet |
| `server/creador.html` | ruta secreta | Nosotros, los que hacemos el sistema · escritorio |

Cada archivo es una aplicación completa: trae su propia pantalla de ingreso
adentro. No hay una página de login aparte.

### Restricciones técnicas, y son firmes

- **No hay paso de compilación.** Todo es React + Babel *standalone* inline
  en cada `.html`, compilado en el navegador. No hay `.jsx` sueltos, ni
  bundler, ni npm en el front. Si tu propuesta necesita compilar, no sirve.
- **Nada de frameworks de CSS.** Sin Tailwind, sin Bootstrap, sin librerías
  de componentes. Los estilos van inline en los componentes o en el `<style>`
  del archivo, que es como está hoy.
- **Solo estos recursos externos**, que ya están y se pueden seguir usando:
  React 18, Babel standalone, Leaflet 1.9 (mapas) y Google Fonts con
  `Archivo Black` y `JetBrains Mono`. **No agregues dependencias.** El
  servicio corre en celulares con datos móviles caros y con caché offline:
  cada archivo nuevo es un costo real.
- **Los tres archivos son grandes** (2500, 2400 y 750 líneas). Trabajá por
  partes; no reescribas de cero.
- Si tocás archivos de `project/`, hay que subir `CACHE_NAME` en
  `project/service-worker.js` o los celulares siguen viendo lo viejo.

### Sistema visual actual (se puede cambiar, pero entendelo antes)

- Dos tipografías: `Archivo Black` para números y títulos, `JetBrains Mono`
  para etiquetas en mayúscula.
- Un objeto `TEMAS` por archivo con los colores como tokens (`bg`, `surface`,
  `fg`, `green`, `amber`, `red`, …). La app del chofer tiene **tres** temas
  —`day`, `sun`, `night`— y el panel dos. **El tema día es el de fábrica**,
  no el oscuro.
- Los componentes leen esos tokens, no colores literales. Si cambiás la
  paleta, cambiá los tokens.

---

## LO QUE NO SE PUEDE TOCAR

Esta es la parte importante del encargo.

### 1. El chofer maneja mientras mira esto

La pantalla del conductor va en un soporte contra el parabrisas, **con sol
directo de altura**, y la mira **de reojo, en movimiento**. Está diseñada
para leerse en menos de un segundo.

- **Nada de bajar el contraste ni achicar la tipografía** de los números de
  brecha. Podés mejorar la composición; no la legibilidad.
- **El tema claro es el de fábrica** y tiene que seguir siéndolo. Un tema
  oscuro elegante es ilegible al mediodía en Juliaca. El tema noche existe y
  está bien, pero no es el default.
- El rojo `#FF2D55` está **reservado** para emergencia y brecha crítica. No
  lo uses de color decorativo en ningún lado.
- El botón de **SOS** tiene que seguir siendo imposible de confundir y
  difícil de apretar sin querer.

### 2. Los avisos son de seguridad, no decoración

Hay carteles que parecen ruido y son lo contrario. Se pueden rediseñar; **no
se pueden suavizar, esconder detrás de un ícono, ni convertir en un *toast*
que desaparece solo:**

- **«Estás dibujando un trazado que no es el que se está midiendo»** (panel
  de Despacho, trazador). Sin esto se guarda creyendo que se corrigió el
  recorrido de hoy y no cambió nada.
- **«La base está en el mismo disco que la aplicación»** (panel del creador,
  SISTEMA). Avisa que un despliegue va a borrar las cuentas de todos los
  choferes y el historial entero.
- **«Este panel entra solo con clave»** (panel del creador, SISTEMA). Avisa
  que falta el segundo factor en el nivel que puede crear cooperativas.
- **Unidad fuera de ruta** (panel de Despacho, mapa).

### 3. Confirmar antes de romper

Dos acciones piden confirmación y **tienen que seguir pidiéndola, diciendo
sobre qué**:

- **Suspender una cooperativa** (creador): corta el acceso de toda su gente
  en el acto. El cartel dice el nombre de cuál.
- **Cambiar el trazado con el que se mide una ruta** (Despacho): le cambia el
  mapa a las unidades que están manejando y descarta las vueltas en curso.

### 4. Cada panel tiene sus permisos, y no se mueven

**La regla:** la estructura la define el nivel de arriba (nosotros), la
operación del día es de la cooperativa.

| | Despacho | Creador |
| --- | :---: | :---: |
| Personas: alta, baja, claves, identidad | ✅ | — |
| Vehículos | ✅ | — |
| Objetivo de brecha | ✅ | — |
| Desvío: umbral y silenciarlo | ✅ | — |
| Dibujar el recorrido (trazador) | ✅ | — |
| **Elegir** con qué trazado se mide | ✅ | — |
| Turnos, vueltas, informes | ✅ | — |
| Datos de su cooperativa | ✅ | — |
| Actividad **de su cooperativa** | ✅ | — |
| **Crear** cooperativas, rutas y trazados | — | ✅ |
| Borrar trazados | — | ✅ |
| Suspender una cooperativa | — | ✅ |
| Crear o restablecer cuentas de Despacho | — | ✅ |
| Salud del servidor y de la base | — | ✅ |
| Actividad de **todas** las cooperativas | — | ✅ |

**No muevas una acción de un panel al otro** aunque quede más prolijo. Si te
parece que algo está en el panel equivocado, decilo en tu propuesta y que lo
decida el dueño del producto — no lo cambies.

### 5. El panel del creador es sobrio a propósito

Es una herramienta de operación que usamos nosotros, no un producto que se le
muestra a un cliente. Que se vea ordenado, sí; que se vea *vendedor*, no.
Tampoco guarda nada en el navegador —cerrar la pestaña cierra la sesión— así
que no le agregues "recordarme" ni nada por el estilo.

---

## POR DÓNDE EMPEZARÍA

En este orden, que es el de impacto real:

1. **La app del chofer.** Es la que ve más gente y la que tiene la exigencia
   física más dura. El HUD de brecha es el corazón del producto.
2. **El panel de Despacho.** Se usa ocho horas seguidas. El modal de Gestión
   tiene **ocho pestañas** y ahí hay trabajo de jerarquía y densidad: es lo
   más recargado del sistema.
3. **El panel del creador.** El que menos importa.

## QUÉ ENTREGAR

- Los archivos modificados, funcionando (abrilos y comprobalo).
- Una nota corta de qué cambiaste y por qué.
- Si algo del sistema visual te parece mal pero tocarlo rompería alguna de
  las reglas de arriba: **escribilo en vez de hacerlo.**

## CÓMO PROBARLO

```bash
cd server && npm install && npm start
# http://localhost:3001/              app del chofer
# http://localhost:3001/despacho.html panel de Despacho
```

La app del chofer abre en modo demo si no hay servidor. Para el panel de
Despacho hace falta arrancar con `DISPATCH_PASSWORD=algo` y entrar con el
usuario `DESPACHO`. Para el panel del creador, con `CREATOR_PASSWORD=` de al
menos 12 caracteres, y se abre en `/creador`.

Más contexto: `README.md` explica qué hace cada cosa y por qué;
`LIMITACIONES.md`, lo que el sistema **no** hace.
