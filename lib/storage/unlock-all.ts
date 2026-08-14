import { getDb } from "./db";
import { THEMES, BACKGROUNDS } from "../theme/presets/themes";
import { BUTTON_COLORS } from "../theme/presets/button-colors";
import { CHART_COLORS } from "../theme/presets/chart-colors";
import { MOVEMENT_LAYERS } from "../theme/presets/movement-layers";
import { GLOW_PRESETS } from "../theme/presets/glow-presets";

// Claves de settings donde cada tienda guarda su JSON de IDs comprados.
const PURCHASED_KEYS: { key: string; items: { id: string }[] }[] = [
  { key: "purchased_themes", items: THEMES },
  { key: "purchased_backgrounds", items: BACKGROUNDS },
  { key: "purchased_button_colors", items: BUTTON_COLORS },
  { key: "purchased_chart_colors", items: CHART_COLORS },
  { key: "purchased_movement_layers", items: MOVEMENT_LAYERS },
  { key: "purchased_glow", items: GLOW_PRESETS },
];

// Desbloquea las seis tiendas marcando todos los IDs como comprados.
// Una sola transaccion exclusiva para que un crash entre categoria no
// deje el desbloqueo a medias.
export async function unlockAllStyles(): Promise<void> {
  const db = getDb();

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const { key, items } of PURCHASED_KEYS) {
      await txn.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [key, JSON.stringify(items.map((i) => i.id))]
      );
    }
  });
}

// Verifica si las seis tiendas estan completas comparando cada lista de
// comprados contra su catalogo completo. Retorna true solo si todas
// contienen todos los IDs.
export async function areAllStylesUnlocked(): Promise<boolean> {
  const db = getDb();
  const results = await Promise.all(
    PURCHASED_KEYS.map(async ({ key, items }) => {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = ?",
        key
      );
      if (!row?.value) return false;
      try {
        const ids: string[] = JSON.parse(row.value);
        return items.every((i) => ids.includes(i.id));
      } catch {
        return false;
      }
    })
  );
  return results.every(Boolean);
}