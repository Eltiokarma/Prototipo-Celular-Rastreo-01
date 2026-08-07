// El grabador de recorridos (PENDIENTES 3.4).
//
// Subirse a la combi, manejar la vuelta entera, y que el trazado salga de
// la calle en vez de dibujarse a ojo sobre el mapa. La regla que lo hace
// servible es UNA: se guarda un punto cada 30 METROS RECORRIDOS, no cada N
// segundos — parado en un semáforo, el GPS sigue disparando pero la combi
// no se mueve, y un trazado con cuarenta puntos apilados en una esquina no
// es un trazado, es un nudo.
//
// JavaScript puro, sin Expo: la tarea de fondo lo alimenta con las mismas
// posiciones que ya manda al servidor, y `pruebas/grabador.js` lo corre en
// Node sin un teléfono. La persistencia (que un Android matando el proceso
// no borre media vuelta) vive en quien lo usa, no acá.

'use strict';

const PASO_M = 30;

// Distancia en metros entre dos coordenadas. La misma cuenta equirectangular
// del resto del sistema: a 900 m de radio el error contra la esfera es
// centímetros, y esto corre en cada posición.
const METROS_POR_GRADO = 111_320;
function metrosEntre(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * METROS_POR_GRADO;
  const dLng = (lng2 - lng1) * METROS_POR_GRADO * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// `previos` permite retomar una grabación guardada a disco: el grabador
// nuevo arranca con los puntos del que murió.
function crearGrabador(previos = []) {
  const puntos = previos.map(p => ({ lat: p.lat, lng: p.lng }));
  let largoM = 0;
  for (let i = 1; i < puntos.length; i++) {
    largoM += metrosEntre(puntos[i - 1].lat, puntos[i - 1].lng, puntos[i].lat, puntos[i].lng);
  }

  return {
    // Devuelve true si la posición quedó guardada (se movió lo suficiente).
    posicion(lat, lng) {
      if (typeof lat !== 'number' || typeof lng !== 'number' ||
          !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const ultimo = puntos[puntos.length - 1];
      if (!ultimo) { puntos.push({ lat, lng }); return true; }
      const d = metrosEntre(ultimo.lat, ultimo.lng, lat, lng);
      if (d < PASO_M) return false;   // el semáforo no genera puntos
      puntos.push({ lat, lng });
      largoM += d;
      return true;
    },

    get puntos() { return puntos.map(p => ({ ...p })); },
    get cantidad() { return puntos.length; },
    get largoM() { return Math.round(largoM); },

    // GeoJSON, que es lo que el trazador del creador ya importa (igual que
    // un GPX): la grabación baja del servidor y entra por la puerta que
    // existe, no por una nueva.
    geojson(nombre) {
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: nombre || 'Recorrido grabado' },
          geometry: {
            type: 'LineString',
            // GeoJSON va [lng, lat] — al revés que todo el resto del
            // sistema, y es EL error clásico de este formato.
            coordinates: puntos.map(p => [p.lng, p.lat]),
          },
        }],
      };
    },
  };
}

module.exports = { crearGrabador, metrosEntre, PASO_M };
