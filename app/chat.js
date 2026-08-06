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

// Los tipos de emergencia. El chofer los elige DESPUÉS de deslizar —la
// alerta ya salió— y el mensaje del hilo se actualiza en el lugar. Las
// claves son las que viajan por el cable; los textos, lo que se dibuja.
const TIPOS_SOS = { mecanica: 'Falla mecánica', accidente: 'Accidente', policia: 'Policía' };

// De lo que llega por el cable a lo que se dibuja. `miVehiculo` y `miPersona`
// definen qué es "mío": la persona firma el mensaje, el vehículo define el
// canal privado — no son lo mismo y confundirlos rompe las dos cosas.
function aMensaje(crudo, { miPersona, miVehiculo }) {
  const propio = crudo.unitId === miPersona;
  const esSos = crudo.kind === 'sos' || crudo.type === 'sos_alert';
  const esVoz = crudo.kind === 'voice' || crudo.type === 'voice_msg';
  const esFoto = crudo.kind === 'photo' || crudo.type === 'photo_msg';
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
    // Una foto puede llevar pie o no. Si no lleva, el texto igual dice algo:
    // una burbuja vacía cuando la imagen ya expiró no se distingue de un bug.
    texto: esSos
      ? `SOS — ${crudo.driverName || crudo.unitId} pide ayuda` +
        (TIPOS_SOS[crudo.sosTipo] ? ` (${TIPOS_SOS[crudo.sosTipo].toLowerCase()})` : '')
      : esVoz ? `Nota de voz · ${crudo.duration || 0}s`
      : esFoto ? String(crudo.text || 'Foto')
      : String(crudo.text || ''),
    // El contenido en sí, para poder reproducirlo o verlo. Lo viejo lo pierde
    // a propósito —el servidor solo conserva las últimas: 30 audios, 20
    // fotos— y queda como burbuja sin contenido, que es honesto: existió, ya
    // no está.
    audio: esVoz ? (crudo.data || null) : null,
    imagen: esFoto ? (crudo.data || null) : null,
    segundos: esVoz ? (crudo.duration || 0) : null,
    tono: esSos ? 'sos' : esVoz ? 'voz' : esFoto ? 'foto'
      : crudo.role === 'dispatch' ? 'despacho' : 'normal',
    // El ancla del tipo elegido después: cuando llega `sos_tipo`, se busca
    // el mensaje por este id y se lo actualiza (ver conTipoSos).
    sosId: esSos ? (crudo.sosId ?? null) : null,
    tipoSos: esSos ? (crudo.sosTipo || null) : null,
    timestamp: crudo.timestamp || 0,
    hora: hora(crudo.timestamp),
  };
}

// El tipo llega DESPUÉS que el SOS, como mensaje aparte: esta función
// actualiza la burbuja ya dibujada en vez de agregar otra. Un tipo inválido
// o un mensaje que no es SOS devuelven el mensaje intacto — el hilo nunca
// se rompe por un dato raro del cable.
function conTipoSos(mensaje, tipo) {
  if (!mensaje || mensaje.tono !== 'sos' || !TIPOS_SOS[tipo]) return mensaje;
  const base = mensaje.texto.replace(/ \([^)]*\)$/, '');
  return { ...mensaje, tipoSos: tipo, texto: `${base} (${TIPOS_SOS[tipo].toLowerCase()})` };
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

module.exports = { aMensaje, hilo, sinLeer, hora, conTipoSos, TIPOS_SOS };
