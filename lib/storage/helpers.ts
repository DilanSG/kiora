import { getDb } from "./db";
import * as SecureStore from "expo-secure-store";

export const SYNC_KEY_SECURE = "kiora_sync_key_secure";

// Contador monotónico que reduce la ventana de colisión al insertar varios
// registros en el mismo ms (ej. sync). >>> 0 fuerza unsigned int32.
let idCounter = 0;

// Colapsa espacios para que "Comida " y "Comida" no se traten como
// categorías distintas.
export function normalizeCategory(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// Canje único del código secreto: el flag se persiste en la misma transacción
// que el incremento para que un crash no permita canjear dos veces.
const SECRET_CODE_KEY = "secret_code_redeemed";

export async function hasRedeemedSecretCode(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    SECRET_CODE_KEY
  );
  return row?.value === "1";
}

export async function redeemSecretCode(points: number): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
      ["user_points", String(points), points]
    );
    await txn.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      SECRET_CODE_KEY,
      "1"
    );
  });
}

// Prefiere crypto.randomUUID() (UUID v4, sin colisiones por timestamp); en
// motores sin la API cae al esquema base36 con contador monotónico.
export function generateId(): string {
  const g = globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();

  idCounter = (idCounter + 1) >>> 0;
  const time = Date.now().toString(36);
  const count = idCounter.toString(36).padStart(2, "0");
  // 36^12 ≈ 4.7e18 combinaciones por ms gracias a los dos segmentos aleatorios.
  const r1 = Math.random().toString(36).slice(2, 8);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${time}-${count}-${r1}${r2}`;
}

// Claves de settings agrupadas por mundo visual, para borrar y reportar
// progreso por categoría (el grupo trae la clave activa junto a las compradas).
const STYLE_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Temas", keys: ["active_theme", "purchased_themes"] },
  { label: "Fondos", keys: ["active_background", "purchased_backgrounds"] },
  { label: "Colores de botones", keys: ["active_button_color", "purchased_button_colors", "free_points_claimed"] },
  { label: "Paletas de gráficas", keys: ["active_chart_color", "purchased_chart_colors"] },
  { label: "Movimientos visuales", keys: ["active_movement_layer", "purchased_movement_layers"] },
  { label: "Brillos", keys: ["active_glow_id", "glow_intensity", "purchased_glow"] },
  { label: "Koins", keys: ["user_points"] },
  { label: "Reportes", keys: ["reported_configs"] },
];

// Progreso del borrado: qué se está borrando y qué paso lleva el total.
export type DeleteProgress = { label: string; done: number; total: number };

// Borra solo estilos, dejando intacta la sincronización. Sin transacción
// única: la cola queda libre entre pasos y la UI pinta el progreso en vivo.
export async function clearStyleData(onProgress?: (p: DeleteProgress) => void): Promise<void> {
  const db = getDb();
  const total = STYLE_GROUPS.length;
  for (let i = 0; i < total; i += 1) {
    const group = STYLE_GROUPS[i];
    onProgress?.({ label: group.label, done: i + 1, total });
    await db.runAsync(
      `DELETE FROM settings WHERE key IN (${group.keys.map(() => "?").join(", ")})`,
      ...group.keys
    );
  }
}

export async function clearFinanceData(onProgress?: (p: DeleteProgress) => void): Promise<void> {
  const db = getDb();
  const steps = [
    { label: "Movimientos", sql: "DELETE FROM transactions" },
    { label: "Categorías", sql: "DELETE FROM categories" },
    { label: "Recurrentes", sql: "DELETE FROM recurring_expenses" },
  ];
  const total = steps.length;
  for (let i = 0; i < total; i += 1) {
    onProgress?.({ label: steps[i].label, done: i + 1, total });
    await db.runAsync(steps[i].sql);
  }
}

// Cuenta los elementos que se van a borrar para mostrarlos en la vista de
// confirmacion. Devuelve un mapa nombre -> cantidad por tipo de borrado.
export async function getDataCounts(kind: "styles" | "finance" | "all"): Promise<Record<string, number>> {
  const db = getDb();
  const c = async (sql: string): Promise<number> => {
    const row = await db.getFirstAsync<{ c: number }>(sql);
    return row?.c ?? 0;
  };
  const countPurchased = async (key: string): Promise<number> => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      key
    );
    if (!row?.value) return 0;
    try {
      return (JSON.parse(row.value) as string[]).length;
    } catch {
      return 0;
    }
  };
  const hasRow = async (key: string): Promise<number> => {
    const row = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) c FROM settings WHERE key = ?",
      key
    );
    return row?.c ?? 0;
  };

  if (kind === "finance") {
    return {
      movimientos: await c("SELECT COUNT(*) c FROM transactions"),
      categorias: await c("SELECT COUNT(*) c FROM categories"),
      recurrentes: await c("SELECT COUNT(*) c FROM recurring_expenses"),
    };
  }

  if (kind === "styles") {
    return {
      temas: await countPurchased("purchased_themes"),
      fondos: await countPurchased("purchased_backgrounds"),
      colores: await countPurchased("purchased_button_colors"),
      graficas: await countPurchased("purchased_chart_colors"),
      movimientos_visuales: await countPurchased("purchased_movement_layers"),
      brillos: await countPurchased("purchased_glow"),
      puntos: await hasRow("user_points"),
      reportes: await hasRow("reported_configs"),
    };
  }

  // Borrado total: todo el mundo de datos de la app.
  return {
    tareas: await c("SELECT COUNT(*) c FROM tasks"),
    notas: await c("SELECT COUNT(*) c FROM notes"),
    metas: await c("SELECT COUNT(*) c FROM goals"),
    pasos: await c("SELECT COUNT(*) c FROM goal_steps"),
    cuotas_y_aportes: await c("SELECT COUNT(*) c FROM goal_installments") + await c("SELECT COUNT(*) c FROM pot_contributions"),
    deseos: await c("SELECT COUNT(*) c FROM wish_items"),
    movimientos: await c("SELECT COUNT(*) c FROM transactions"),
    categorias: await c("SELECT COUNT(*) c FROM categories"),
    recurrentes: await c("SELECT COUNT(*) c FROM recurring_expenses"),
    notificaciones: await c("SELECT COUNT(*) c FROM app_notifications"),
    vinculos: await c("SELECT COUNT(*) c FROM note_links"),
    estilos: await c("SELECT COUNT(*) c FROM settings").then(
      (total) => Math.max(0, total)
    ),
  };
}

export async function clearAllData(onProgress?: (p: DeleteProgress) => void): Promise<void> {
  const db = getDb();
  // Sin transacción única: la cola queda libre entre pasos para pintar el
  // progreso en vivo; un crash deja borrado parcial (aceptable, destructivo).
  const steps = [
    { label: "Pasos de metas", sql: "DELETE FROM goal_steps" },
    { label: "Cuotas", sql: "DELETE FROM goal_installments" },
    { label: "Aportes", sql: "DELETE FROM pot_contributions" },
    { label: "Metas", sql: "DELETE FROM goals" },
    { label: "Tareas", sql: "DELETE FROM tasks" },
    { label: "Vínculos de notas", sql: "DELETE FROM note_links" },
    { label: "Notas", sql: "DELETE FROM notes" },
    { label: "Movimientos", sql: "DELETE FROM transactions" },
    { label: "Categorías", sql: "DELETE FROM categories" },
    { label: "Recurrentes", sql: "DELETE FROM recurring_expenses" },
    { label: "Deseos", sql: "DELETE FROM wish_items" },
    { label: "Notificaciones", sql: "DELETE FROM app_notifications" },
    { label: "Estilos y koins", sql: "DELETE FROM settings" },
  ];
  const total = steps.length;
  for (let i = 0; i < total; i += 1) {
    onProgress?.({ label: steps[i].label, done: i + 1, total });
    await db.runAsync(steps[i].sql);
  }
  try {
    await SecureStore.deleteItemAsync(SYNC_KEY_SECURE);
  } catch {
    // SecureStore puede lanzar en dispositivos sin backend seguro
    // (ej. algunos emuladores). Se ignora silenciosamente.
  }
}
