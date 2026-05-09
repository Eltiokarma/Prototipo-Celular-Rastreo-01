# Teoría — Todo lo que aprendiste construyendo COOP-R14

Este documento cubre los conceptos que usamos. Podés leerlo solo
o abrirlo con Claude y preguntarle sobre cualquier sección.

---

## 1. La web en tres capas

Todo lo que ves en un navegador está construido con tres lenguajes que trabajan juntos:

**HTML** — la estructura. Define qué elementos existen.
```html
<div>
  <h1>Hola</h1>
  <p>Texto aquí</p>
</div>
```

**CSS** — la apariencia. Define cómo se ven esos elementos.
```css
h1 { color: blue; font-size: 32px; }
```

**JavaScript** — el comportamiento. Hace que las cosas pasen cuando el usuario interactúa.
```javascript
button.onclick = () => alert('Hiciste click');
```

En nuestro proyecto usamos los tres, pero todo inline en un solo archivo HTML.

**Pregunta para explorar con Claude:** *¿Por qué separamos HTML, CSS y JS en lugar de mezclarlos?*

---

## 2. React — interfaces que reaccionan a los datos

Antes de React, para cambiar algo en la pantalla tenías que encontrar el elemento en el DOM y modificarlo manualmente. Tedioso y propenso a bugs.

React invierte el modelo: vos describís cómo debe verse la pantalla DADO un estado, y React se encarga de actualizar el DOM automáticamente.

```javascript
// Sin React — manual, frágil
document.getElementById('contador').textContent = count;

// Con React — declarativo, automático
function Contador() {
  const [count, setCount] = React.useState(0);
  return <div>{count}</div>;  // React actualiza esto solo
}
```

### Conceptos clave de React que usamos:

**Componente** — una función que devuelve JSX (HTML-en-JavaScript).
```javascript
function MiComponente({ nombre }) {
  return <p>Hola, {nombre}</p>;
}
```

**Props** — argumentos que le pasás a un componente (como parámetros de función).
```javascript
<MiComponente nombre="Juan" />
```

**State (useState)** — datos que cuando cambian, actualizan la pantalla.
```javascript
const [conectado, setConectado] = React.useState(false);
// Cuando llamás setConectado(true), React re-renderiza automáticamente
```

**Effect (useEffect)** — código que corre cuando el componente aparece o cuando cambian ciertos datos.
```javascript
React.useEffect(() => {
  // Esto corre cuando el componente se monta
  conectarServidor();
  return () => desconectarServidor(); // limpieza cuando se desmonta
}, []); // [] = solo al montar
```

**Pregunta para explorar:** *¿Qué es el Virtual DOM y por qué React lo usa?*

---

## 3. HTTP vs WebSocket — dos formas de comunicarse

### HTTP (el modelo clásico)
Funciona como correo postal: el cliente manda una carta, el servidor responde, fin.

```
Cliente ──── GET /datos ────▶ Servidor
Cliente ◀─── { respuesta } ── Servidor
(conexión cerrada)
```

El cliente siempre tiene que preguntar. Si hay datos nuevos en el servidor, el cliente no lo sabe hasta que pregunta otra vez.

### WebSocket (lo que usamos)
Funciona como una llamada telefónica: se establece la conexión una vez y ambos pueden hablar cuando quieran.

```
Cliente ══════════════════ Servidor
         (conexión abierta permanente)
Cliente ──── GPS update ──▶ Servidor
Cliente ◀─── state ──────── Servidor  (cuando hay novedades)
Cliente ◀─── state ──────── Servidor  (cuando otro chofer manda GPS)
```

Esto es fundamental para tiempo real. Sin WebSocket tendrías que hacer "polling" — preguntar al servidor cada segundo "¿hay algo nuevo?", lo cual es ineficiente.

```javascript
// Así se crea un WebSocket en el navegador
const ws = new WebSocket('wss://mi-servidor.com');

ws.onopen = () => console.log('Conectado');
ws.onmessage = (event) => console.log('Recibí:', event.data);
ws.send(JSON.stringify({ tipo: 'hola' }));
```

**Pregunta para explorar:** *¿Cuándo usarías HTTP y cuándo WebSocket en una misma app?*

---

## 4. Node.js — JavaScript del lado del servidor

JavaScript nació en el navegador. Node.js es un programa que permite correr JavaScript fuera del navegador, en un servidor.

```
Navegador:    JavaScript corre en Chrome/Firefox/Safari
Node.js:      JavaScript corre en el servidor (Linux, Windows, Mac)
```

Ventaja: un solo lenguaje para frontend y backend. El mismo `JSON.parse()`, los mismos `Array.map()`, la misma lógica.

**Express** es una librería que simplifica crear servidores HTTP en Node.js:
```javascript
const app = express();

app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3001);
```

**Pregunta para explorar:** *¿Qué es npm y por qué existe?*

---

## 5. GPS en el navegador y en el celular

### En el navegador (lo que tenemos)
```javascript
navigator.geolocation.watchPosition(
  (pos) => {
    const { latitude, longitude, speed } = pos.coords;
    // Se llama cada vez que el GPS se actualiza
  },
  (error) => console.log('Error GPS'),
  { enableHighAccuracy: true }
);
```

**Limitación crítica:** cuando el navegador está en segundo plano (pantalla apagada), el sistema operativo pausa el JavaScript. El GPS deja de funcionar.

### En React Native (lo que vamos a construir)
```javascript
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Esta función corre incluso con pantalla apagada
TaskManager.defineTask('gps-background', ({ data }) => {
  const { latitude, longitude } = data.locations[0].coords;
  enviarAlServidor(latitude, longitude);
});

await Location.startLocationUpdatesAsync('gps-background', {
  accuracy: Location.Accuracy.High,
  timeInterval: 3000,
});
```

`TaskManager` le dice al sistema Android: "este código es prioritario, no lo pagues aunque optimices la batería".

**Pregunta para explorar:** *¿Por qué los sistemas operativos matan procesos en background? ¿Qué es la gestión de batería?*

---

## 6. PWA — Progressive Web App

Una PWA es una página web que el navegador puede instalar como si fuera una app nativa.

Para que una web sea PWA necesita dos archivos:

**manifest.json** — le dice al sistema cómo mostrar la app:
```json
{
  "name": "COOP-R14 · Conductor",
  "display": "standalone",
  "theme_color": "#2580CF"
}
```

**service-worker.js** — un script que corre en segundo plano en el navegador, cachea archivos para uso offline:
```javascript
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request) || fetch(event.request)
  );
});
```

El Service Worker es como un empleado entre la app y el servidor: intercepta cada request y decide si lo busca en el cache o en internet.

**Problema que tuviste:** el Service Worker guardaba la versión vieja de la app. La solución fue cambiar `CACHE_NAME` de `v1` a `v3` — el Service Worker detecta el nombre diferente y descarga todo de nuevo.

**Pregunta para explorar:** *¿Cuál es la diferencia entre una PWA y una app nativa en términos de capacidades?*

---

## 7. Git y GitHub — control de versiones

**Git** es un sistema que guarda el historial completo de cambios de tu código. Podés volver a cualquier versión anterior.

```bash
git add archivo.js          # preparar cambio
git commit -m "descripción" # guardar snapshot
git push                     # subir a GitHub
```

**GitHub** es el servidor donde se guarda ese historial, accesible desde cualquier lado.

El flujo que usamos:
```
Editar código → git add → git commit → git push → Vercel detecta el push → despliega automáticamente
```

Cada vez que subís código, Vercel reconstruye y publica la app en menos de un minuto.

**Pregunta para explorar:** *¿Qué es una "rama" (branch) en Git y para qué se usa?*

---

## 8. Encriptación de contraseñas (bcrypt)

**Regla de oro:** nunca guardar contraseñas en texto plano.

Si alguien hackea tu base de datos y las contraseñas están en texto plano, todos los usuarios están expuestos — probablemente usen la misma contraseña en otros servicios.

**Hashing** — transformación de una sola vía:
```
"miperro123" → bcrypt → "$2b$10$X7kZ..." (60 caracteres)
```

No podés ir para atrás. De `"$2b$10$X7kZ..."` no podés recuperar `"miperro123"`.

**Cómo funciona el login:**
```javascript
// Al registrar:
const hash = await bcrypt.hash("miperro123", 10); // el 10 es la "dificultad"
guardarEnDB({ usuario: "juan", password: hash });

// Al iniciar sesión:
const hashGuardado = buscarEnDB("juan").password;
const correcto = await bcrypt.compare("miperro123", hashGuardado);
// true si la contraseña es correcta
```

El número `10` se llama "salt rounds" — cuántas veces se aplica el algoritmo. A mayor número, más lento es calcular el hash (bueno para dificultar ataques de fuerza bruta, malo si es muy alto porque tarda mucho).

**Pregunta para explorar:** *¿Qué es un "ataque de fuerza bruta" y cómo el bcrypt lo dificulta?*

---

## 9. JWT — tokens de autenticación

Después de verificar la contraseña, el servidor necesita recordar que ese usuario está autenticado. HTTP no tiene memoria entre requests.

**JWT (JSON Web Token)** soluciona esto con un "token firmado":

```
Header.Payload.Signature

eyJhbGci...  .  eyJ1c2VyIjoianVhbiJ9  .  X7kZm3...
(algoritmo)     (datos: usuario, expiración)  (firma)
```

El servidor genera el token con una clave secreta. El cliente lo guarda y lo manda en cada request. El servidor verifica la firma — si alguien modificó el token, la firma no coincide.

```javascript
// Servidor genera token tras login exitoso:
const token = jwt.sign(
  { usuario: "juan", unidad: "V-247" },
  process.env.JWT_SECRET,  // clave secreta solo el servidor conoce
  { expiresIn: "8h" }      // expira en 8 horas
);

// Cliente lo manda en cada request:
headers: { Authorization: `Bearer ${token}` }

// Servidor verifica:
const datos = jwt.verify(token, process.env.JWT_SECRET);
// Si es válido: datos = { usuario: "juan", unidad: "V-247" }
// Si fue modificado: lanza un error
```

**Pregunta para explorar:** *¿Por qué los tokens tienen fecha de expiración? ¿Qué pasa si alguien roba un token?*

---

## 10. Bases de datos — guardar información para siempre

Actualmente el servidor guarda todo en variables JavaScript:
```javascript
const units = new Map(); // en RAM
```

Cuando el servidor se reinicia, esa información desaparece.

**Una base de datos** guarda en disco — sobrevive reinicios, cortes de luz, actualizaciones.

### SQL — el lenguaje de las bases de datos relacionales

```sql
-- Crear tabla
CREATE TABLE choferes (
  id       SERIAL PRIMARY KEY,
  usuario  TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  unidad   TEXT NOT NULL
);

-- Insertar
INSERT INTO choferes (usuario, password, unidad)
VALUES ('juan', '$2b$10$...', 'V-247');

-- Consultar
SELECT * FROM choferes WHERE usuario = 'juan';

-- Actualizar
UPDATE choferes SET activo = false WHERE usuario = 'juan';
```

**PostgreSQL** es el sistema de base de datos relacional más usado en el mundo profesional. Gratuito, open source, y Railway lo ofrece integrado.

**Pregunta para explorar:** *¿Qué significa "relacional" en "base de datos relacional"? ¿Qué es una JOIN?*

---

## 11. React Native — React para móvil

React Native usa los mismos conceptos de React (componentes, estado, props, hooks) pero en vez de generar HTML para el navegador, genera componentes nativos de Android e iOS.

```javascript
// React web          →    React Native
<div>                 →    <View>
<p>texto</p>          →    <Text>texto</Text>
<button onClick={fn}> →    <TouchableOpacity onPress={fn}>
style={{ color: 'red' }} → StyleSheet.create({ color: 'red' })
```

**La ventaja clave:** acceso a las APIs nativas del sistema operativo — GPS en background, cámara, notificaciones push, vibración, almacenamiento local.

**Expo** es el kit de herramientas que simplifica React Native:
- `expo-location` → GPS nativo con background
- `react-native-maps` → Google Maps nativo
- `expo-notifications` → push notifications
- `eas build` → genera APK para Android

**Pregunta para explorar:** *¿Cuál es la diferencia entre React Native y Flutter? ¿Cuándo elegirías uno sobre el otro?*

---

## 12. Arquitectura del sistema completo

```
┌─────────────────────────────────────────────────────────────────┐
│                        LO QUE CONSTRUISTE                        │
│                                                                  │
│  ┌────────────────┐   WebSocket    ┌──────────────────────────┐ │
│  │  App del        │◄─────────────►│  Servidor Node.js        │ │
│  │  chofer         │               │  Railway                  │ │
│  │  (celular)      │  GPS cada 3s  │                          │ │
│  │                 │──────────────►│  units Map (en RAM)      │ │
│  │  React Native   │               │  calculateGaps()         │ │
│  │  expo-location  │◄──────────────│  broadcast state         │ │
│  └────────────────┘   state        └──────────────────────────┘ │
│                        completo                                  │
│                                                                  │
│  ┌────────────────┐                                             │
│  │  Panel          │◄──────────────── (a construir)            │
│  │  despacho       │   WebSocket                               │
│  │  (PC oficina)   │   solo escucha                            │
│  └────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Preguntas para una sesión de estudio con Claude

Podés pegar cualquiera de estas en un chat nuevo:

1. *"Explícame el ciclo de vida de un componente React con un ejemplo simple"*
2. *"¿Qué es el event loop de JavaScript y cómo afecta al código asíncrono?"*
3. *"¿Cómo funciona HTTPS? ¿Qué es un certificado SSL?"*
4. *"Explícame la diferencia entre autenticación y autorización con ejemplos reales"*
5. *"¿Qué es una API REST y en qué se diferencia de WebSocket?"*
6. *"¿Cómo funciona un ataque de inyección SQL y cómo prevenirlo?"*
7. *"¿Qué es Docker y cuándo lo usaría en este proyecto?"*
8. *"Explícame qué es async/await en JavaScript como si tuviera 16 años"*
