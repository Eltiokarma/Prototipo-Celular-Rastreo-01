// Grabar y reproducir notas de voz.
//
// Aparte de la pantalla porque tiene su propio ciclo de vida —un permiso, un
// grabador que hay que soltar, un reproductor que hay que descargar— y
// mezclarlo con el render es la forma más segura de dejar el micrófono
// abierto. Acá adentro sí hay Expo: el resto de `app/` es JavaScript puro,
// esto no puede serlo.
//
// El audio viaja como data-URL en base64 dentro del mismo WebSocket que el
// texto, que es como lo espera el servidor. Ver PROTOCOLO.md.
//
// OJO CON EL FORMATO: la app web graba webm/opus y una app Android graba
// m4a/aac. El servidor solo mira el prefijo `data:audio` y el tamaño — no
// valida el formato — así que los dos pasan. Quien las escucha es Chrome en
// el panel de Despacho, que reproduce m4a sin problema.

import { useAudioRecorder, useAudioPlayer, RecordingPresets,
         setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system';

// 60 s es el tope de la web y alcanza de sobra: una nota de voz de un chofer
// es "estoy en el paradero", no un audio de WhatsApp.
export const MAX_SEGUNDOS = 60;

export async function pedirPermisoMicrofono() {
  const { granted } = await requestRecordingPermissionsAsync();
  if (granted) {
    // Sin esto, en Android la grabación sale muda o falla directamente.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  }
  return granted;
}

// De archivo grabado a data-URL, que es lo que el servidor acepta.
export async function aDataUrl(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  // El tipo sale de la extensión que dejó el grabador; si no se reconoce se
  // manda genérico, que el servidor acepta igual porque solo mira el prefijo.
  const ext = (uri.split('.').pop() || '').toLowerCase();
  const tipo = ext === 'm4a' ? 'audio/mp4' : ext === '3gp' ? 'audio/3gpp' : 'audio/mp4';
  return `data:${tipo};base64,${base64}`;
}

export { useAudioRecorder, useAudioPlayer, RecordingPresets };
