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
  { name: "Noche Estelar", target: "#312E81", energy: "calma", bgSeed: 3 },
  { name: "Aurora Índigo", target: "#6366F1", energy: "calma", bgSeed: 7 },
  { name: "Menta Serena", target: "#10B981", energy: "calma", bgSeed: 11 },
  { name: "Ola Tropical", target: "#06B6D4", energy: "movido", bgSeed: 5 },
  { name: "Cielo Despejado", target: "#3B82F6", energy: "calma", bgSeed: 9 },
  { name: "Coral del Ocaso", target: "#F97316", energy: "movido", bgSeed: 2 },
  { name: "Fuego Íntimo", target: "#EF4444", energy: "movido", bgSeed: 8 },
  { name: "Rubí Nocturno", target: "#B91C1C", energy: "calma", bgSeed: 13 },
  { name: "Rosa Neón", target: "#EC4899", energy: "movido", bgSeed: 4 },
  { name: "Lila Onírica", target: "#A855F7", energy: "calma", bgSeed: 17 },
  { name: "Amatista Real", target: "#8B5CF6", energy: "calma", bgSeed: 19 },
  { name: "Lima Ácida", target: "#84CC16", energy: "movido", bgSeed: 6 },
  { name: "Hielo Glacial", target: "#0EA5E9", energy: "calma", bgSeed: 15 },
  { name: "Perla de Luna", target: "#94A3B8", energy: "calma", bgSeed: 21 },
  { name: "Grafito Urbano", target: "#475569", energy: "movido", bgSeed: 10 },
  { name: "Miel Dorada", target: "#F59E0B", energy: "calma", bgSeed: 14 },
  { name: "Vino Terroso", target: "#9A3412", energy: "movido", bgSeed: 18 },
  { name: "Esmeralda Serena", target: "#059669", energy: "calma", bgSeed: 22 },
  { name: "Sombra Lavanda", target: "#C084FC", energy: "calma", bgSeed: 26 },
  { name: "Medianoche Polar", target: "#1E293B", energy: "calma", bgSeed: 12 },
];

// Movimientos asociados a cada energía (ids de lib/theme/presets/movement-layers).
export const CALM_MOVEMENTS = ["respiro", "flotar", "balanceo", "onda", "pendulo", "marea", "cabeceo"];
export const ACTIVE_MOVEMENTS = ["temblor", "vagar", "zoom", "elastico", "latido", "girar", "rebote"];