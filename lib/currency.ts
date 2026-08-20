
export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + "$" + formatNumber(Math.abs(value));
}

// Formatea texto crudo mientras se escribe en un input de monto:
// conserva solo dígitos y agrupa miles con puntos. Ej: "01500000" → "1.500.000".
export function formatInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Convierte texto libre en número con convención colombiana (puntos = miles, coma = decimal).
// Heurísticas:
//   - si aparecen ambos separadores (ej. "1.234,56") se usa el último como decimal.
//   - si aparece solo una coma/punto va seguido de 1-2 dígitos -> decimal.
//   - en cualquier otro caso se interpreta como separador de miles y se elimina.
export function parseAmountInput(rawValue: string): number | undefined {
  const cleaned = rawValue
    .replace(/\s|\u00A0/g, "")
    .replace(/[^\d.,]/g, "")
    .trim();
  if (!cleaned) return undefined;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastDot >= 0) {
    normalized = /\.\d{1,2}$/.test(cleaned) ? cleaned.replace(/,/g, "") : cleaned.replace(/\./g, "");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}