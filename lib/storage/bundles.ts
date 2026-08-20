import { getDb } from "./db";

// Compra en lote de un "recomendado" (todos sus assets de una). Una sola
// transacción exclusiva: un crash a mitad no pierde puntos ni deja a medias.

export type BundleEntry = {
  key: string;
  id: string;
};

export async function purchaseBundle(
  entries: BundleEntry[],
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

      for (const { key, id } of entries) {
        const existing = await txn.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = ?",
          key
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
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          key,
          JSON.stringify(purchased)
        );
      }
    });
    return { success: true };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Error al comprar";
    return { success: false, reason };
  }
}