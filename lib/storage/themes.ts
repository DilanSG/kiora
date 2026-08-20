import { getDb } from "./db";

// Patrón de tienda compartido por todos los assets (temas, fondos, colores):
// settings guarda el ID activo y un JSON de IDs comprados; cada compra corre
// en una transacción exclusiva (verifica puntos, deduce y registra).
const ACTIVE_THEME_KEY = "active_theme";

export async function getActiveTheme(): Promise<string> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    ACTIVE_THEME_KEY
  );
  return row?.value ?? "default";
}

export async function setActiveTheme(themeId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ACTIVE_THEME_KEY,
    themeId
  );
}

export async function getPurchasedThemeIds(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'purchased_themes'"
  );
  if (!rows.length) return new Set(["default"]);
  try {
    const ids: string[] = JSON.parse(rows[0].value);
    return new Set(["default", ...ids]);
  } catch {
    return new Set(["default"]);
  }
}

// Transacción exclusiva: un crash entre deducción y registro no pierde puntos.
export async function purchaseTheme(
  themeId: string,
  cost: number
): Promise<{ success: boolean; reason?: string }> {
  const db = getDb();
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      const row = await txn.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'user_points'"
      );
      const points = parseInt(row?.value ?? "0", 10);
      if (points < cost) {
        throw new Error("Puntos insuficientes");
      }

      await txn.runAsync(
        "UPDATE settings SET value = CAST(value AS INTEGER) - ? WHERE key = 'user_points'",
        cost
      );

      const existing = await txn.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'purchased_themes'"
      );
      let purchased: string[] = [];
      if (existing?.value) {
        try {
          purchased = JSON.parse(existing.value);
        } catch {
          purchased = [];
        }
      }
      if (!purchased.includes(themeId)) {
        purchased.push(themeId);
      }
      await txn.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('purchased_themes', ?)",
        JSON.stringify(purchased)
      );
    });
    return { success: true };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Error al comprar";
    return { success: false, reason };
  }
}
