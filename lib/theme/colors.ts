// Paleta base de Kiora (identidad de marca). En oscuro se usan los valores
// exactos de la identidad (Night/Surface/Mint/Aqua); en claro el Mint se
// profundiza (verde Kiora #2E9C74) para mantener contraste AA sobre fondo
// claro — ver BRAND.md para la rationale de color.
export const LIGHT = {
  primary: "#2E9C74",
  primaryActive: "#27825F",
  accentBlue: "#2EBF8B",
  background: "#F4F6F5",
  surface: "#FAFBF9",
  border: "#DDE4DF",
  textPrimary: "#222926",
  textSecondary: "#66706B",
  success: "#3FA97C",
  warning: "#C5A06A",
  error: "#C05A5A",
  // Las figuras de fondo (círculos, ondas, etc.) se dibujan con opacidades
  // pensadas para oscuro; en claro el verde profundo no luce igual, así que
  // cada fondo multiplica sus opacidades por este factor.
  figureOpacity: 2.4,
};

export const DARK = {
  primary: "#67E8B4",
  primaryActive: "#8EF0C9",
  accentBlue: "#5EEAD4",
  background: "#111318",
  surface: "#181B21",
  border: "#262C33",
  textPrimary: "#F5F7F6",
  textSecondary: "#A7AFAB",
  success: "#53D6A0",
  warning: "#C9A86B",
  error: "#D96C6C",
  // Factor 1: en oscuro las figuras conservan sus opacidades originales.
  figureOpacity: 1,
};

export type ThemeColors = typeof LIGHT & {
  chartPositive?: string;
  chartNegative?: string;
};