import { getDb } from "./db";

const ACTIVE_KEY = "active_button_color";
const CLAIMED_KEY = "free_points_claimed";

export async function getActiveButtonColor(): Promise<string> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    ACTIVE_KEY
  );
  return row?.value ?? "default";
}

export async function setActiveButtonColor(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ACTIVE_KEY,
    id
  );
}

export async function getPurchasedButtonColorIds(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'purchased_button_colors'"
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
export async function purchaseButtonColor(
  id: string,
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
        "SELECT value FROM settings WHERE key = 'purchased_button_colors'"
      );
      let purchased: string[] = [];
      if (existing?.value) {
        try {
          purchased = JSON.parse(existing.value);
        } catch {
          purchased = [];
        }
      }
      if (!purchased.includes(id)) {
        purchased.push(id);
      }
      await txn.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('purchased_button_colors', ?)",
        JSON.stringify(purchased)
      );
    });
    return { success: true };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Error al comprar";
    return { success: false, reason };
  }
}

// Flag "1" como booleano: settings guarda todo como TEXT.
export async function hasClaimedFreePoints(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    CLAIMED_KEY
  );
  return row?.value === "1";
}

// 150 puntos gratis, una única vez por dispositivo: la transacción persiste
// el incremento y el flag juntos o no persiste ninguno.
export async function claimFreePoints(): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
      ["user_points", "150", 150]
    );
    await txn.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      CLAIMED_KEY,
      "1"
    );
  });
}
