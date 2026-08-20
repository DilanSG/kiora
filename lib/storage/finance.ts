import { Transaction, TransactionType, PeriodPoint, RecurringExpense, RecurringInterval } from "./types";

import { getDb } from "./db";
import { generateId, normalizeCategory } from "./helpers";
import { addNotification } from "./notifications";

type TransactionRow = {
  id: string;
  type: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  recurring_id: string | null;
};

type RecurringRow = {
  id: string;
  type: string;
  description: string;
  amount: number;
  category: string;
  interval: string;
  anchor_date: string;
  last_generated: string | null;
  created_at: string;
};

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: row.amount,
    description: row.description,
    category: row.category,
    date: row.date,
    recurringId: row.recurring_id ?? undefined,
  };
}

function rowToRecurring(row: RecurringRow): RecurringExpense {
  return {
    id: row.id,
    type: (row.type as TransactionType) ?? "expense",
    description: row.description,
    amount: row.amount,
    category: row.category,
    interval: row.interval as RecurringInterval,
    anchorDate: row.anchor_date,
    createdAt: row.created_at,
  };
}

// Siguiente ocurrencia tras `from`: mismo día de semana (weekly), día de mes
// recortado (monthly) o mes y día (yearly) que el ancla.
function nextRecurringDate(anchor: Date, interval: RecurringInterval, from: Date): Date {
  if (interval === "weekly") {
    const d = new Date(from);
    const diff = (anchor.getDay() - from.getDay() + 7) % 7;
    d.setDate(from.getDate() + diff);
    if (d.getTime() < from.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }
  if (interval === "monthly") {
    const clampDay = (y: number, m: number) => Math.min(anchor.getDate(), new Date(y, m + 1, 0).getDate());
    let d = new Date(from.getFullYear(), from.getMonth(), clampDay(from.getFullYear(), from.getMonth()), 12, 0, 0);
    if (d.getTime() < from.getTime()) {
      d = new Date(from.getFullYear(), from.getMonth() + 1, clampDay(from.getFullYear(), from.getMonth() + 1), 12, 0, 0);
    }
    return d;
  }
  const clampDay = (y: number) => Math.min(anchor.getDate(), new Date(y, anchor.getMonth() + 1, 0).getDate());
  let d = new Date(from.getFullYear(), anchor.getMonth(), clampDay(from.getFullYear()), 12, 0, 0);
  if (d.getTime() < from.getTime()) {
    d = new Date(from.getFullYear() + 1, anchor.getMonth(), clampDay(from.getFullYear() + 1), 12, 0, 0);
  }
  return d;
}

export function computeNextRecurrence(anchorDate: string, interval: RecurringInterval, from: Date = new Date()): Date {
  return nextRecurringDate(new Date(anchorDate), interval, from);
}

// Mutex de materialización: Promise.all lanza varias lecturas en paralelo y
// dos transacciones exclusivas chocarían con "database is locked".
let materializeChain: Promise<void> = Promise.resolve();

// Cache de la ventana materializada (clave "anio-mes") para no re-materializar
// todo en cada carga; se invalida al mutar plantillas antes de materializar.
let materializedWindowKey: string | null = null;

function invalidateMaterializedWindow(): void {
  materializedWindowKey = null;
}

// Espera las materializaciones en vuelo y limpia la cache: evita que una
// transacción exclusiva abierta haga fallar el borrado con "database is locked".
export async function flushMaterializeChain(): Promise<void> {
  await materializeChain.catch(() => {});
  materializedWindowKey = null;
}

async function materializeRecurringExpenses(): Promise<void> {
  const run = materializeChain.then(() => materializeRecurringExpensesOnce());
  materializeChain = run.catch(() => {});
  return run;
}

// Materializa sobre TODA la ventana anual para sumar el recurrente en meses
// pasados; el índice único (recurring_id, date) hace el INSERT idempotente.
async function materializeRecurringExpensesOnce(): Promise<void> {
  const db = getDb();
  const rows = await db.getAllAsync<RecurringRow>("SELECT * FROM recurring_expenses");
  if (rows.length === 0) return;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (materializedWindowKey === monthKey) return;

  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0);

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const row of rows) {
      const anchor = new Date(row.anchor_date);
      // Ventana desde el 1 de enero del año en curso para sumar meses pasados;
      // el mes de inicio del ancla acota el arranque si el cobro aún no existía.
      const anchorMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0);
      let startFrom = new Date(now.getFullYear(), 0, 1, 12, 0, 0);
      if (anchorMonthStart.getTime() > startFrom.getTime()) startFrom = anchorMonthStart;
      startFrom.setHours(12, 0, 0, 0);

      // Guard de seguridad: ante una ancla patológica, corta el bucle.
      let cursor = nextRecurringDate(anchor, row.interval as RecurringInterval, startFrom);
      let guard = 0;
      while (cursor.getTime() <= endOfMonth.getTime() && guard < 4000) {
        await txn.runAsync(
          "INSERT OR IGNORE INTO transactions (id, type, amount, description, category, date, recurring_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [generateId(), row.type ?? "expense", row.amount, row.description, row.category, cursor.toISOString(), row.id]
        );
        const after = new Date(cursor.getTime() + 86400000);
        after.setHours(12, 0, 0, 0);
        cursor = nextRecurringDate(anchor, row.interval as RecurringInterval, after);
        guard += 1;
      }
    }
  });
  materializedWindowKey = monthKey;
}

function uniqueCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of categories) {
    const normalized = normalizeCategory(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export async function getTransactions(): Promise<Transaction[]> {
  const db = getDb();
  await materializeRecurringExpenses();
  const rows = await db.getAllAsync<TransactionRow>(
    "SELECT * FROM transactions ORDER BY date DESC"
  );
  return rows.map(rowToTransaction);
}

export async function addTransaction(
  tx: Omit<Transaction, "id" | "date"> & { date?: string }
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO transactions (id, type, amount, description, category, date) VALUES (?, ?, ?, ?, ?, ?)",
    [generateId(), tx.type, tx.amount, tx.description, tx.category, tx.date ?? new Date().toISOString()]
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM transactions WHERE id = ?", id);
}

export async function getMonthlyStats(
  year: number,
  month: number
): Promise<{ income: number; expenses: number; balance: number }> {
  const db = getDb();
  await materializeRecurringExpenses();
  const monthStr = String(month + 1).padStart(2, "0");
  const yearStr = String(year);

  const row = await db.getFirstAsync<{ income: number; expenses: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
     FROM transactions
     WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?`,
    [yearStr, monthStr]
  );

  const income = row?.income ?? 0;
  const expenses = row?.expenses ?? 0;
  return { income, expenses, balance: income - expenses };
}

export async function getRecentTransactions(limit = 5): Promise<Transaction[]> {
  const db = getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    "SELECT * FROM transactions ORDER BY date DESC LIMIT ?",
    limit
  );
  return rows.map(rowToTransaction);
}

export async function getCategories(type: TransactionType): Promise<string[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM categories WHERE type = ? ORDER BY id ASC",
    type
  );
  return rows.map((r) => r.name);
}

// DELETE + INSERT en una transacción exclusiva para que un crash a mitad no
// deje categorías parciales.
export async function setCategoriesForType(
  type: TransactionType,
  categories: string[]
): Promise<void> {
  const db = getDb();
  const cleaned = uniqueCategories(categories);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync("DELETE FROM categories WHERE type = ?", type);
    for (const name of cleaned) {
      await txn.runAsync(
        "INSERT OR IGNORE INTO categories (type, name) VALUES (?, ?)",
        [type, name]
      );
    }
  });
}

export async function getWeeklyStats(): Promise<{ income: number; expenses: number; balance: number }> {
  const db = getDb();
  await materializeRecurringExpenses();
  const now = new Date();
  // getDay() devuelve 0=Dom, 1=Lun... La formula (day+6)%7 transforma
  // domingo (0) → 6 y lunes (1) → 0, para que la semana arranque en lunes.
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const row = await db.getFirstAsync<{ income: number; expenses: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
     FROM transactions
     WHERE date >= ? AND date <= ?`,
    [monday.toISOString(), sunday.toISOString()]
  );
  const income = row?.income ?? 0;
  const expenses = row?.expenses ?? 0;
  return { income, expenses, balance: income - expenses };
}

export async function getYearlyStats(year: number): Promise<{ income: number; expenses: number; balance: number }> {
  const db = getDb();
  await materializeRecurringExpenses();
  const row = await db.getFirstAsync<{ income: number; expenses: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
     FROM transactions
     WHERE strftime('%Y', date) = ?`,
    [String(year)]
  );
  const income = row?.income ?? 0;
  const expenses = row?.expenses ?? 0;
  return { income, expenses, balance: income - expenses };
}

async function dailyBreakdownBetween(start: Date, end: Date): Promise<PeriodPoint[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ day: string; income: number; expenses: number }>(
    `SELECT date(date) as day,
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) as income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expenses
     FROM transactions
     WHERE date >= ? AND date <= ?
     GROUP BY date(date)
     ORDER BY date(date) ASC`,
    [start.toISOString(), end.toISOString()]
  );
  const savingRows = await db.getAllAsync<{ day: string; savings: number }>(
    `SELECT date(created_at) as day, COALESCE(SUM(amount), 0) as savings
     FROM pot_contributions
     WHERE created_at >= ? AND created_at <= ?
     GROUP BY date(created_at)`,
    [start.toISOString(), end.toISOString()]
  );
  const savingsByIdx = new Map<number, number>();
  for (const r of savingRows) {
    // Mismo re-mapeo de indice que las transacciones: getUTCDay (0=Dom) a indice local (0=Lun).
    const d = new Date(r.day + "T00:00:00Z");
    const idx = (d.getUTCDay() + 6) % 7;
    savingsByIdx.set(idx, (savingsByIdx.get(idx) ?? 0) + r.savings);
  }

  // Arreglo fijo de 7 días con ceros: el gráfico semanal siempre muestra 7
  // puntos consistentes aunque falten movimientos.
  const result: PeriodPoint[] = Array.from({ length: 7 }, (_, i) => ({ income: 0, expenses: 0, savings: savingsByIdx.get(i) ?? 0 }));
  for (const row of rows) {
    const d = new Date(row.day + "T00:00:00Z");
    // row.day viene de SQLite date(): siempre ISO (YYYY-MM-DD), segura para Date.
    const idx = (d.getUTCDay() + 6) % 7;
    result[idx].income = row.income;
    result[idx].expenses = row.expenses;
  }
  return result;
}

export async function getDailyBreakdownForWeek(): Promise<PeriodPoint[]> {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return dailyBreakdownBetween(monday, sunday);
}
export async function getWeeklyStatsForWeek(
  monday: Date
): Promise<{ income: number; expenses: number; balance: number }> {
  const db = getDb();
  const start = new Date(monday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const row = await db.getFirstAsync<{ income: number; expenses: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
     FROM transactions
     WHERE date >= ? AND date <= ?`,
    [start.toISOString(), end.toISOString()]
  );
  const income = row?.income ?? 0;
  const expenses = row?.expenses ?? 0;
  return { income, expenses, balance: income - expenses };
}

export async function getDailyBreakdownForWeekDate(monday: Date): Promise<PeriodPoint[]> {
  const start = new Date(monday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return dailyBreakdownBetween(start, end);
}

export async function getDailyBreakdownForMonth(year: number, month: number): Promise<PeriodPoint[]> {
  const db = getDb();
  const monthStr = String(month + 1).padStart(2, "0");
  const yearStr = String(year);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const rows = await db.getAllAsync<{ day: number; income: number; expenses: number }>(
    `SELECT CAST(strftime('%d', date) AS INTEGER) as day,
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) as income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expenses
     FROM transactions
     WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
     GROUP BY day
     ORDER BY day ASC`,
    [yearStr, monthStr]
  );
  const savingRows = await db.getAllAsync<{ day: number; savings: number }>(
    `SELECT CAST(strftime('%d', created_at) AS INTEGER) as day, COALESCE(SUM(amount), 0) as savings
     FROM pot_contributions
     WHERE strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?
     GROUP BY day`,
    [yearStr, monthStr]
  );
  const savingsByDay = new Map(savingRows.map((r) => [r.day, r.savings]));

  const result: PeriodPoint[] = Array.from({ length: daysInMonth }, (_, i) => ({ income: 0, expenses: 0, savings: savingsByDay.get(i + 1) ?? 0 }));
  for (const row of rows) {
    const idx = row.day - 1;
    if (idx >= 0 && idx < daysInMonth) {
      result[idx].income = row.income;
      result[idx].expenses = row.expenses;
    }
  }
  return result;
}

// Semanas del mes: 1=días 1-7, 2=8-14, 3=15-21, 4=22-fin.
export async function getWeeklyBreakdownForMonth(year: number, month: number): Promise<PeriodPoint[]> {
  const db = getDb();
  const monthStr = String(month + 1).padStart(2, "0");
  const yearStr = String(year);

  const rows = await db.getAllAsync<{ week: number; income: number; expenses: number }>(
    `SELECT week_of_month as week,
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) as income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expenses
     FROM (
       SELECT type, amount,
         CASE
           WHEN CAST(strftime('%d', date) AS INTEGER) <= 7  THEN 1
           WHEN CAST(strftime('%d', date) AS INTEGER) <= 14 THEN 2
           WHEN CAST(strftime('%d', date) AS INTEGER) <= 21 THEN 3
           ELSE 4
         END as week_of_month
       FROM transactions
       WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
     )
     GROUP BY week_of_month
     ORDER BY week_of_month ASC`,
    [yearStr, monthStr]
  );
  const savingRows = await db.getAllAsync<{ week: number; savings: number }>(
    `SELECT
       CASE
         WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 7  THEN 1
         WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 14 THEN 2
         WHEN CAST(strftime('%d', created_at) AS INTEGER) <= 21 THEN 3
         ELSE 4
       END as week,
       COALESCE(SUM(amount), 0) as savings
     FROM pot_contributions
     WHERE strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?
     GROUP BY week`,
    [yearStr, monthStr]
  );
  const savingsByWeek = new Map(savingRows.map((r) => [r.week, r.savings]));

  const result: PeriodPoint[] = Array.from({ length: 4 }, (_, i) => ({ income: 0, expenses: 0, savings: savingsByWeek.get(i + 1) ?? 0 }));
  for (const row of rows) {
    const idx = row.week - 1;
    if (idx >= 0 && idx < 4) {
      result[idx].income = row.income;
      result[idx].expenses = row.expenses;
    }
  }
  return result;
}

export async function getMonthlyBreakdownForYear(year: number): Promise<PeriodPoint[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ month: number; income: number; expenses: number }>(
    `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) as income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expenses
     FROM transactions
     WHERE strftime('%Y', date) = ?
     GROUP BY month
     ORDER BY month ASC`,
    [String(year)]
  );
  const savingRows = await db.getAllAsync<{ month: number; savings: number }>(
    `SELECT CAST(strftime('%m', created_at) AS INTEGER) as month, COALESCE(SUM(amount), 0) as savings
     FROM pot_contributions
     WHERE strftime('%Y', created_at) = ?
     GROUP BY month`,
    [String(year)]
  );
  const savingsByMonth = new Map(savingRows.map((r) => [r.month, r.savings]));

  const result: PeriodPoint[] = Array.from({ length: 12 }, (_, i) => ({ income: 0, expenses: 0, savings: savingsByMonth.get(i + 1) ?? 0 }));
  for (const row of rows) {
    const idx = row.month - 1;
    if (idx >= 0 && idx < 12) {
      result[idx].income = row.income;
      result[idx].expenses = row.expenses;
    }
  }
  return result;
}

export async function addCategory(
  type: TransactionType,
  name: string
): Promise<string[]> {
  const normalized = normalizeCategory(name);
  if (!normalized) return getCategories(type);
  const db = getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO categories (type, name) VALUES (?, ?)",
    [type, normalized]
  );
  return getCategories(type);
}

// Transacción atómica: un crash a mitad no deja movimientos parciales;
// al terminar notifica el importe importado desde SMS.
export async function addTransactionsBatch(
  txs: (Omit<Transaction, "id" | "date"> & { date?: string })[]
): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const tx of txs) {
      await txn.runAsync(
        "INSERT INTO transactions (id, type, amount, description, category, date) VALUES (?, ?, ?, ?, ?, ?)",
        [generateId(), tx.type, tx.amount, tx.description, tx.category, tx.date ?? new Date().toISOString()]
      );
    }
  });
  if (txs.length > 0) {
    await addNotification(`${txs.length} movimientos importados desde SMS`, "info");
  }
}

export async function updateTransaction(
  id: string,
  updates: Partial<Pick<Transaction, "type" | "amount" | "description" | "category" | "date">>
): Promise<void> {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (updates.type !== undefined) { fields.push("type = ?"); values.push(updates.type); }
  if (updates.amount !== undefined) { fields.push("amount = ?"); values.push(updates.amount); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.category !== undefined) { fields.push("category = ?"); values.push(updates.category); }
  if (updates.date !== undefined) { fields.push("date = ?"); values.push(updates.date); }

  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`, values);
}

// ─── Movimientos recurrentes ────────────────────────────────────────────────

export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  const db = getDb();
  const rows = await db.getAllAsync<RecurringRow>(
    "SELECT * FROM recurring_expenses ORDER BY created_at DESC"
  );
  return rows.map(rowToRecurring);
}

// Agrega una plantilla de movimiento recurrente; sus ocurrencias se
// materializan en la siguiente lectura (getTransactions/estadísticas).
export async function addRecurringExpense(
  input: Omit<RecurringExpense, "id" | "createdAt">
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO recurring_expenses (id, type, description, amount, category, interval, anchor_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [generateId(), input.type ?? "expense", input.description, input.amount, input.category, input.interval, input.anchorDate, new Date().toISOString()]
  );
  invalidateMaterializedWindow();
  await materializeRecurringExpenses();
}

// Actualiza la plantilla. Las ocurrencias futuras dentro del mes vuelven a
// generarse con los nuevos valores; las ya registradas se conservan.
export async function updateRecurringExpense(
  id: string,
  updates: Partial<Pick<RecurringExpense, "type" | "description" | "amount" | "category" | "interval" | "anchorDate">>
): Promise<void> {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (updates.type !== undefined) { fields.push("type = ?"); values.push(updates.type); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.amount !== undefined) { fields.push("amount = ?"); values.push(updates.amount); }
  if (updates.category !== undefined) { fields.push("category = ?"); values.push(updates.category); }
  if (updates.interval !== undefined) { fields.push("interval = ?"); values.push(updates.interval); }
  if (updates.anchorDate !== undefined) { fields.push("anchor_date = ?"); values.push(updates.anchorDate); }
  if (fields.length === 0) return;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE recurring_expenses SET ${fields.join(", ")} WHERE id = ?`,
      [...values, id]
    );
    // Borra las ocurrencias aún no vencidas para regenerarlas con los nuevos
    // datos; el historial pasado (fechas previas a hoy) permanece intacto.
    await txn.runAsync(
      "DELETE FROM transactions WHERE recurring_id = ? AND date > ?",
      [id, new Date().toISOString()]
    );
  });
  invalidateMaterializedWindow();
  await materializeRecurringExpenses();
}

// Elimina la plantilla y todas las transacciones que generó (son registros
// sintéticos del patrón, no movimientos manuales del usuario).
export async function deleteRecurringExpense(id: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync("DELETE FROM transactions WHERE recurring_id = ?", id);
    await txn.runAsync("DELETE FROM recurring_expenses WHERE id = ?", id);
  });
  invalidateMaterializedWindow();
  await materializeRecurringExpenses();
}

// ─── Estadística de ahorro ─────────────────────────────────────────────────

const SAVINGS_STAT_KEY = "kiora_show_savings_stat";

// Suma todo lo ahorrado en alcancías y ahorros libres que aún no se
// convirtieron en compra (metas activas o vencidas con dinero retenido).
export async function getTotalSavings(): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(pc.amount), 0) AS s
     FROM pot_contributions pc
     JOIN goals g ON g.id = pc.goal_id
     WHERE g.status IN ('active', 'incomplete')`
  );
  return row?.s ?? 0;
}

export async function isSavingsStatEnabled(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    SAVINGS_STAT_KEY
  );
  return row?.value === "1";
}

export async function setSavingsStatEnabled(enabled: boolean): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SAVINGS_STAT_KEY, enabled ? "1" : "0"]
  );
}
