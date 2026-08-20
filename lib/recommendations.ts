// Conceptos visuales de los recomendados de la Tienda. Cada concepto tiene
// un nombre con identidad visual y un color objetivo; la tienda traduce ese
// concepto en un tema, fondo, colores, movimiento y brillo coherentes con él
// (los objetos se eligen según el concepto, no al revés).

export type VisualConcept = {
  name: string;
  target: string; // color objetivo del concepto (hex)
  energy: "calma" | "movido"; // perfil de movimiento del concepto
  bgSeed: number; // semilla para elegir el fondo dentro del catálogo
};

export const VISUAL_CONCEPTS: VisualConcept[] = [
  { name: "Azul Medianoche", target: "#312E81", energy: "calma", bgSeed: 3 },
  { name: "Índigo Eléctrico", target: "#6366F1", energy: "calma", bgSeed: 7 },
  { name: "Verde Menta", target: "#10B981", energy: "calma", bgSeed: 11 },
  { name: "Cian Tropical", target: "#06B6D4", energy: "movido", bgSeed: 5 },
  { name: "Azul Cielo", target: "#3B82F6", energy: "calma", bgSeed: 9 },
  { name: "Naranja Coral", target: "#F97316", energy: "movido", bgSeed: 2 },
  { name: "Rojo Vivo", target: "#EF4444", energy: "movido", bgSeed: 8 },
  { name: "Rojo Rubí", target: "#B91C1C", energy: "calma", bgSeed: 13 },
  { name: "Rosa Neón", target: "#EC4899", energy: "movido", bgSeed: 4 },
  { name: "Violeta Profundo", target: "#A855F7", energy: "calma", bgSeed: 17 },
  { name: "Violeta Vibrante", target: "#8B5CF6", energy: "calma", bgSeed: 19 },
  { name: "Verde Lima", target: "#84CC16", energy: "movido", bgSeed: 6 },
  { name: "Azul Glaciar", target: "#0EA5E9", energy: "calma", bgSeed: 15 },
  { name: "Gris Perla", target: "#94A3B8", energy: "calma", bgSeed: 21 },
  { name: "Gris Grafito", target: "#475569", energy: "movido", bgSeed: 10 },
  { name: "Ámbar Miel", target: "#F59E0B", energy: "calma", bgSeed: 14 },
  { name: "Terracota", target: "#9A3412", energy: "movido", bgSeed: 18 },
  { name: "Verde Esmeralda", target: "#059669", energy: "calma", bgSeed: 22 },
  { name: "Lavanda Suave", target: "#C084FC", energy: "calma", bgSeed: 26 },
  { name: "Azul Nocturno", target: "#1E293B", energy: "calma", bgSeed: 12 },
];

// Movimientos asociados a cada energía (ids de lib/theme/presets/movement-layers).
export const CALM_MOVEMENTS = ["respiro", "flotar", "balanceo", "onda", "pendulo", "marea", "cabeceo"];
export const ACTIVE_MOVEMENTS = ["temblor", "vagar", "zoom", "elastico", "latido", "girar", "rebote"];