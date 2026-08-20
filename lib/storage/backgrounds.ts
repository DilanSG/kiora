import { getDb } from "./db";

const ACTIVE_BACKGROUND_KEY = "active_background";

export async function getActiveBackground(): Promise<string> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    ACTIVE_BACKGROUND_KEY
  );
  return row?.value ?? "flat";
}

export async function setActiveBackground(bgId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ACTIVE_BACKGROUND_KEY,
    bgId
  );
}

export async function getPurchasedBackgroundIds(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'purchased_backgrounds'"
  );
  if (!rows.length) return new Set(["flat"]);
  try {
    const ids: string[] = JSON.parse(rows[0].value);
    return new Set(["flat", ...ids]);
  } catch {
    return new Set(["flat"]);
  }
}

// Transacción exclusiva: un crash entre la deducción y el registro no pierde puntos.
export async function purchaseBackground(
  bgId: string,
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
        "SELECT value FROM settings WHERE key = 'purchased_backgrounds'"
      );
      let purchased: string[] = [];
      if (existing?.value) {
        try {
          purchased = JSON.parse(existing.value);
        } catch {
          purchased = [];
        }
      }
      if (!purchased.includes(bgId)) {
        purchased.push(bgId);
      }
      await txn.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('purchased_backgrounds', ?)",
        JSON.stringify(purchased)
      );
    });
    return { success: true };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Error al comprar";
    return { success: false, reason };
  }
}
