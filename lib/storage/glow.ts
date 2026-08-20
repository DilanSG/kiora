import { getDb } from "./db";

const ACTIVE_KEY = "active_glow_id";
const INTENSITY_KEY = "glow_intensity";

export async function getActiveGlowId(): Promise<string> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    ACTIVE_KEY
  );
  return row?.value ?? "none";
}

export async function setActiveGlowId(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ACTIVE_KEY,
    id
  );
}

// Clamping y default 50 por si hay datos corruptos o valores fuera de rango.
export async function getGlowIntensity(): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    INTENSITY_KEY
  );
  const val = parseInt(row?.value ?? "50", 10);
  return Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : 50;
}

// Clampa y redondea: el caller puede pasar valores fuera de rango o con decimales.
export async function setGlowIntensity(value: number): Promise<void> {
  const db = getDb();
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    INTENSITY_KEY,
    String(clamped)
  );
}

export async function getPurchasedGlowIds(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'purchased_glow'"
  );
  if (!rows.length) return new Set(["none"]);
  try {
    const ids: string[] = JSON.parse(rows[0].value);
    return new Set(["none", ...ids]);
  } catch {
    return new Set(["none"]);
  }
}

// Transacción exclusiva: un crash entre deducción y registro no pierde puntos.
export async function purchaseGlow(
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
        "SELECT value FROM settings WHERE key = 'purchased_glow'"
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
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('purchased_glow', ?)",
        JSON.stringify(purchased)
      );
    });
    return { success: true };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Error al comprar";
    return { success: false, reason };
  }
}
