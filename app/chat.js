// Qué mensajes se ven y cómo, a partir de lo que manda el servidor.
//
// JavaScript puro, sin React: es la parte del chat donde puede haber bugs
// caros —que un privado se vea donde no debe, o que se confunda quién habló—
// y es la que se puede probar sin un teléfono. Ver `pruebas/chat.js`.
//
// El chofer tiene DOS canales y no uno:
//
//   grupo    todos los de su ruta, incluido Despacho. `toVehicleId: null`
//   directo  solo él y Despacho. `toVehicleId` = su vehículo
//
// Chofer ↔ chofer en privado no existe, y es una decisión del servidor, no de
// esta pantalla: el canal entre choferes es el grupo. Ver PROTOCOLO.md.

'use strict';

// De lo que llega por el cable a lo que se dibuja. `miVehiculo` y `miPersona`
// definen qué es "mío": la persona firma el mensaje, el vehículo define el
// canal privado — no son lo mismo y confundirlos rompe las dos cosas.
function aMensaje(crudo, { miPersona, miVehiculo }) {
  const propio = crudo.unitId === miPersona;
  const esSos = crudo.kind === 'sos' || crudo.type === 'sos_alert';
  const esVoz = crudo.kind === 'voice' || crudo.type === 'voice_msg';
  return {
    id: `${crudo.unitId}-${crudo.timestamp}`,
    canal: crudo.toVehicleId ? 'directo' : 'grupo',
    propio,
    // Quién habló. Despacho se muestra como Despacho aunque tenga nombre:
    // al chofer le importa que le habla la central, no quién está de turno.
    quien: propio ? 'TÚ'
      : crudo.role === 'dispatch' ? 'DESPACHO'
      : (crudo.driverName || crudo.unitId || 'Conductor'),
    // La unidad, solo si NO es la mía: en mi propio canal es ruido.
    unidad: crudo.vehicleId && crudo.vehicleId !== miVehiculo ? crudo.vehicleId : null,
    texto: esSos
      ? `SOS — ${crudo.driverName || crudo.unitId} pide ayuda`
      : esVoz ? 'Nota de voz'
      : String(crudo.text || ''),
    tono: esSos ? 'sos' : crudo.role === 'dispatch' ? 'despacho' : 'normal',
    timestamp: crudo.timestamp || 0,
    hora: hora(crudo.timestamp),
  };
}

function hora(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// El hilo de un canal, en orden y sin repetidos. Los repetidos aparecen de
// verdad: al reconectar llega el historial completo y puede solaparse con lo
// que ya se había recibido en vivo.
function hilo(mensajes, canal) {
  const vistos = new Set();
  return mensajes
    .filter(m => m.canal === canal)
    .filter(m => (vistos.has(m.id) ? false : vistos.add(m.id)))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Cuántos sin leer por canal, contra la última vez que se miró cada uno.
// No cuentan los propios: nadie tiene mensajes suyos sin leer.
function sinLeer(mensajes, canal, vistoHasta = 0) {
  return mensajes.filter(m => m.canal === canal && !m.propio && m.timestamp > vistoHasta).length;
}

module.exports = { aMensaje, hilo, sinLeer, hora };
