// Sacar o elegir una foto, y dejarla lista para mandar.
//
// Aparte de la pantalla por lo mismo que `voz.js`: tiene permisos, abre una
// actividad nativa y devuelve archivos. Acá adentro sí hay Expo; las cuentas
// —cuánto achicar, cuánto pesa, si entra— viven en `imagen.js`, que es JS
// puro y tiene su suite.
//
// La foto se achica SIEMPRE antes de salir. Ver `imagen.js`: el que la manda
// paga una vez y los que la reciben pagan cada uno.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { medidaObjetivo, demasiadoPesada, pesoAproximado, CALIDAD } from './imagen';

export { pesoAproximado, comoTexto } from './imagen';

export async function pedirPermisoCamara() {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  return granted;
}

export async function pedirPermisoGaleria() {
  const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return granted;
}

// De lo que devuelve el picker a un data-URL chico.
//
// Se pide `quality: 1` al picker A PROPÓSITO: comprimir dos veces (una el
// picker, otra el manipulador) deja artefactos sobre artefactos. Comprime uno
// solo, al final, cuando la foto ya tiene el tamaño final.
async function preparar(asset) {
  if (!asset?.uri) return null;

  let ref = ImageManipulator.manipulate(asset.uri);
  const medida = medidaObjetivo(asset.width, asset.height);
  if (medida) ref = ref.resize(medida);

  const render = await ref.renderAsync();
  const salida = await render.saveAsync({
    format: SaveFormat.JPEG, compress: CALIDAD, base64: true,
  });
  if (!salida?.base64) return null;

  const dataUrl = `data:image/jpeg;base64,${salida.base64}`;
  // El servidor la descartaría en silencio y el chofer creería que salió.
  // Mejor decírselo acá, donde todavía se puede repetir.
  if (demasiadoPesada(dataUrl)) return { error: 'La foto pesa demasiado, probá con otra' };
  return { dataUrl, bytes: pesoAproximado(dataUrl) };
}

// `mediaTypes: ['images']` y no `MediaTypeOptions`: en el SDK 54 el enum está
// deprecado y lo que se espera es el arreglo.
const OPCIONES = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };

export async function tomarFoto() {
  if (!(await pedirPermisoCamara())) return { error: 'Sin permiso de cámara' };
  const r = await ImagePicker.launchCameraAsync(OPCIONES);
  if (r.canceled) return null;
  return preparar(r.assets?.[0]);
}

export async function elegirFoto() {
  if (!(await pedirPermisoGaleria())) return { error: 'Sin permiso de galería' };
  const r = await ImagePicker.launchImageLibraryAsync(OPCIONES);
  if (r.canceled) return null;
  return preparar(r.assets?.[0]);
}
