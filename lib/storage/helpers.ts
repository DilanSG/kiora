import { getDb } from "./db";
import * as SecureStore from "expo-secure-store";

export const SYNC_KEY_SECURE = "kiora_sync_key_secure";

// Contador monotonico por proceso que se incrementa en cada llamada a
// generateId(). Esto reduce drasticamente la ventana de colision cuando
// se insertan varios registros en el mismo milisegundo (ej. al sync).
// >>> 0 fuerza el resultado a unsigned int32, evitando desbordes negativos.
let idCounter = 0;

// Normaliza el nombre de una categoria: recorta espacios externos y colapsa
// whitespace multiple interno a un solo espacio. Esto evita duplicados como
// "Comida " y "Comida" siendo tratados como categorias diferentes.
export function normalizeCategory(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// Genera un ID unico en formato base36: timestamp + contador monotono + 12
// caracteres aleatorios. El contador por proceso reduce la ventana de colision
// cuando se insertan varios registros en el mismo milisegundo (ej. sync).
export function generateId(): string {
  idCounter = (idCounter + 1) >>> 0;
  const time = Date.now().toString(36);
  const count = idCounter.toString(36).padStart(2, "0");
  // Dos segmentos aleatorios base36 de 6 caracteres cada uno, lo que da
  // aproximadamente 36^12 ≈ 4.7e18 combinaciones posibles por milisegundo.
  const r1 = Math.random().toString(36).slice(2, 8);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${time}-${count}-${r1}${r2}`;
}

// Claves de settings que pertenecen al mundo de estilos (tiendas + puntos).
const STYLE_KEYS = [
  "active_theme", "purchased_themes",
  "active_background", "purchased_backgrounds",
  "active_button_color", "purchased_button_colors", "free_points_claimed",
  "active_chart_color", "purchased_chart_colors",
  "active_movement_layer", "purchased_movement_layers",
  "active_glow_id", "glow_intensity", "purchased_glow",
  "user_points", "reported_configs",
];

// Borra solo el mundo de estilos: comprados, activos, puntos y reportes.
// Deja intactas las demás tablas y la configuracion de sincronizacion.
export async function clearStyleData(): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM settings WHERE key IN (${STYLE_KEYS.map(() => "?").join(", ")})`,
    ...STYLE_KEYS
  );
}

// Borra solo el mundo de finanzas: movimientos, categorias y recurrentes.
export async function clearFinanceData(): Promise<void> {
  const db = getDb();
  await db.execAsync(`
    DELETE FROM transactions;
    DELETE FROM categories;
    DELETE FROM recurring_expenses;
  `);
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

export async function clearAllData(): Promise<void> {
  const db = getDb();
  // Borra todas las tablas de datos, pero NO resetea el schema.
  // Los contadores y settings se pierden; la sync_key en SecureStore
  // tambien se elimina para que el sync quede desconfigurado.
  await db.execAsync(`
    DELETE FROM tasks;
    DELETE FROM notes;
    DELETE FROM transactions;
    DELETE FROM categories;
    DELETE FROM wish_items;
    DELETE FROM settings;
  `);
  try {
    await SecureStore.deleteItemAsync(SYNC_KEY_SECURE);
  } catch {
    // SecureStore puede lanzar en dispositivos sin backend seguro
    // (ej. algunos emuladores). Se ignora silenciosamente.
  }
}
