# Prompt para nueva sesión — React Native

Copia y pega esto completo en un chat nuevo con Claude Code.

---

## El prompt

Hola. Estoy construyendo una app de rastreo en tiempo real para la Cooperativa de Transportes R-14 de Juliaca, Perú (ciudad a 3800 metros de altitud). La app la usan los choferes de combis para ver las brechas de tiempo entre unidades y verse en el mapa.

**Lo que ya está construido y funcionando:**

1. **Servidor WebSocket en Railway** (Node.js + Express + ws)
   - URL: `wss://prototipo-celular-rastreo-01-production.up.railway.app`
   - Health check: `https://prototipo-celular-rastreo-01-production.up.railway.app/ping`
   - Recibe posiciones GPS de cada chofer cada 3 segundos
   - Calcula brechas (gaps) entre unidades usando `routeProgress` (0-1)
   - Hace broadcast del estado completo a todos los clientes conectados
   - Limpia unidades inactivas (+30s sin GPS)

2. **Frontend PWA** (React + Babel standalone, sin build step)
   - Desplegado en Vercel: `https://prototipo-celular-rastreo-01.vercel.app`
   - GitHub: `https://github.com/Eltiokarma/Prototipo-Celular-Rastreo-01`
   - Carpeta del frontend: `/project/Prototipo.html` + `realtime.js`
   - Carpeta del servidor: `/server/index.js`

3. **Lo que funciona:**
   - Login (nombre de usuario = ID único en el servidor)
   - Pantalla principal con tiempos +1 adelante / -1 atrás
   - Semáforo verde/amarillo/rojo según brecha objetivo
   - GPS real del celular via `navigator.geolocation`
   - WebSocket conectado al servidor (muestra "EN VIVO" cuando conecta)
   - Mapa Leaflet con punto blanco "TÚ" que sigue el GPS real
   - Puntos azules de otros choferes conectados en tiempo real
   - Chip "N en ruta" que muestra cuántos están conectados
   - SOS deslizable (visual, sin alerta real todavía)
   - Chat (mensajes hardcodeados, no funcional todavía)

**El problema con la PWA actual:**
Cuando el chofer apaga la pantalla del celular, el navegador pausa el GPS. La posición deja de actualizarse en el servidor. Para un colectivo en movimiento esto es un problema crítico.

**Lo que quiero construir ahora:**
Una app React Native con Expo que reemplace el frontend web. El servidor NO cambia.

**Requisitos de la app:**
- Login con nombre de usuario (el nombre es el ID en el servidor)
- Pantalla principal: tiempos de brecha adelante/atrás, semáforo, SOS deslizable
- Mapa con `react-native-maps`: punto blanco (yo) + puntos azules (otros choferes)
- GPS en segundo plano con `expo-location` + `expo-task-manager` (funciona con pantalla apagada)
- WebSocket al servidor existente (mismo protocolo, misma lógica)
- Swipe entre pantallas: Chat ← Ruta → Mapa
- Distribuible como APK sin Play Store (EAS Build)

**Paleta de colores:**
- Azul marca: `#2580CF`
- Azul brillante: `#2E9DFF`
- Fondo oscuro: `#0A1A2E`
- Panel: `#16304A`
- Verde: `#3DD685`
- Amarillo: `#F5C542`
- Rojo: `#FF4D6D`
- Blanco: `#F5F9FF`

**Mi nivel:**
Estoy aprendiendo programación. Llevo unas semanas trabajando en esto. Entiendo React básico (componentes, useState, useEffect, props). No tengo experiencia con React Native todavía. Necesito que me expliques cada decisión importante como a un universitario de primer semestre — el "por qué" de cada cosa, no solo el código.

**Por dónde empezar:**
Arrancá leyendo el servidor en GitHub para entender el protocolo WebSocket, y después planifiquemos la estructura del proyecto Expo antes de escribir una sola línea de código.
