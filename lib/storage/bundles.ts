import { getDb } from "./db";

// Compra en lote de un "recomendado": desbloquea todos sus assets (tema,
// fondo, color, gráfica, movimiento, brillo) como si se compraran uno por
// uno. Una sola transaccion exclusiva: verifica puntos, deduce el total y
// agrega cada ID faltante a su lista de comprados.

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