// Sistema de tokens — paleta azul cooperativa
// Toda la app debe usar estos tokens, nunca colores hard-coded.

window.PALETTE = {
  // azules base
  navy:    '#11395C',  // fondo principal modo día (sustituye al negro)
  deep:    '#1D598F',  // contenedores elevados / cards
  brand:   '#2580CF',  // azul cooperativa primario
  bright:  '#2E9DFF',  // azul vibrante para acciones / highlights
  sky:     '#71BCFF',  // azul claro para texto secundario en oscuro
  // neutros derivados (oklch armónicos)
  bg:      '#0A1A2E',  // negro-azulado, OLED-friendly
  panel:   '#16304A',  // panel sobre bg
  line:    '#234969',  // bordes
  mute:    '#5A7A99',  // texto deshabilitado
  // semánticos
  green:   '#3DD685',
  yellow:  '#F5C542',
  red:     '#FF4D6D',
  white:   '#F5F9FF',
};

window.COOP = {
  name: 'COOP-R14',
  full: 'Cooperativa de Transportes Juliaca',
  route: 'Ruta 14 · Terminal Sur ↔ Huancané',
};
