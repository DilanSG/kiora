// Modulo de almacenamiento para transacciones financieras y categorias.
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

// Mapea una fila de SQLite al tipo Transaction. Param row: Fila cruda. Retorna Transaction tipado.
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

// Mapea una fila SQLite de movimiento recurrente al tipo RecurringExpense.
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

// Devuelve la próxima ocurrencia de un gasto recurrente a partir de `from`:
// el siguiente día con el mismo día de semana (weekly), día del mes (monthly,
// recortado al largo del mes) o mes y día (yearly) que `anchor`.
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

// Próxima fecha de cobro de un gasto recurrente desde hoy (para vistas previas).
export function computeNextRecurrence(anchorDate: string, interval: RecurringInterval, from: Date = new Date()): Date {
  return nextRecurringDate(new Date(anchorDate), interval, from);
}

// Encadena las materializaciones: las estadísticas se cargan con Promise.all
// y varias lecturas intentan materializar a la vez; sin este mutex, dos
// transacciones exclusivas en paralelo chocan con "database is locked".
let materializeChain: Promise<void> = Promise.resolve();

// Cache de la ventana ya materializada en el proceso (clave "anio-mes"):
// evita re-escuchar el rango completo en cada carga de estadísticas. Las
// mutaciones de plantillas la invalidan antes de materializar de nuevo.
let materializedWindowKey: string | null = null;

function invalidateMaterializedWindow(): void {
  materializedWindowKey = null;
}

async function materializeRecurringExpenses(): Promise<void> {
  const run = materializeChain.then(() => materializeRecurringExpensesOnce());
  materializeChain = run.catch(() => {});
  return run;
}

// Materializa las ocurrencias de gastos recurrentes hasta fin de mes sobre
// TODA la ventana anual (1 ene del año en curso + futuro del mes actual).
// Así el desglose anual suma el recurrente en los meses pasados, no solo
// desde la creación del gasto. Cada ocurrencia es una transacción real con
// marca recurring_id; el índice único (recurring_id, date) con INSERT OR
// IGNORE la vuelve idempotente aunque se corra varias veces.
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
      // La ventana arranca el 1 de enero del año en curso: los meses pasados
      // del año deben sumar el recurrente. El mes de inicio del ancla acota
      // el arranque cuando es posterior (el cobro aún no existía antes).
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

// Deduplica categorias de forma case-insensitive preservando el orden original. Retorna lista unica y normalizada.
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

// Lista todos los movimientos financieros persistidos, del mas reciente al mas antiguo. Retorna arreglo ordenado descendente.
export async function getTransactions(): Promise<Transaction[]> {
  const db = getDb();
  await materializeRecurringExpenses();
  const rows = await db.getAllAsync<TransactionRow>(
    "SELECT * FROM transactions ORDER BY date DESC"
  );
  return rows.map(rowToTransaction);
}

// Agrega un movimiento nuevo con ID y fecha generados automaticamente. Retorna promesa resuelta al guardar.
export async function addTransaction(
  tx: Omit<Transaction, "id" | "date"> & { date?: string }
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO transactions (id, type, amount, description, category, date) VALUES (?, ?, ?, ?, ?, ?)",
    [generateId(), tx.type, tx.amount, tx.description, tx.category, tx.date ?? new Date().toISOString()]
  );
}

// Elimina un movimiento por su identificador. Retorna promesa resuelta tras la eliminacion.
export async function deleteTransaction(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM transactions WHERE id = ?", id);
}

// Calcula ingresos, gastos y balance para un mes calendario mediante SQL agregado. Param year: Anio. Param month: Mes (0-11). Retorna totales del mes.
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

// Devuelve las ultimas transacciones para bloques resumidos. Param limit: Cantidad maxima. Retorna subconjunto ordenado descendente.
export async function getRecentTransactions(limit = 5): Promise<Transaction[]> {
  const db = getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    "SELECT * FROM transactions ORDER BY date DESC LIMIT ?",
    limit
  );
  return rows.map(rowToTransaction);
}

// Obtiene categorias guardadas para un tipo de movimiento. Retorna lista ordenada por insercion.
export async function getCategories(type: TransactionType): Promise<string[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM categories WHERE type = ? ORDER BY id ASC",
    type
  );
  return rows.map((r) => r.name);
}

// Reemplaza todas las categorias de un tipo: DELETE + INSERT en una sola
// transaccion exclusiva para que no queden datos parciales si la app
// crashea entre la eliminacion y la insercion.
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

// Calcula ingresos, gastos y balance para la semana actual (lunes a domingo).
// La semana arranca en lunes usando la formula (day+6)%7 para re-mapear
// getDay() (0=Dom) a indice local (0=Lun). Retorna totales de la semana.
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

// Calcula ingresos, gastos y balance para el anio calendario indicado. Retorna totales del anio.
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

// Desglose diario de movimientos y ahorro para un rango de 7 dias (lun-dom).
// Indice 0 = lunes, indice 6 = domingo. Los dias sin movimientos devuelven ceros.
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

  // Arreglo fijo de 7 dias (lun-dom), inicializado con ceros.
  // Los dias sin movimientos se quedan en 0 en lugar de ser omitidos,
  // asi el grafico de linea semanal siempre muestra 7 puntos consistentes.
  const result: PeriodPoint[] = Array.from({ length: 7 }, (_, i) => ({ income: 0, expenses: 0, savings: savingsByIdx.get(i) ?? 0 }));
  for (const row of rows) {
    const d = new Date(row.day + "T00:00:00Z");
    // Re-mapeo de getUTCDay (0=Dom) a indice local (0=Lun).
    // row.day viene de SQLite date() que siempre retorna ISO (YYYY-MM-DD), segura para Date.
    const idx = (d.getUTCDay() + 6) % 7;
    result[idx].income = row.income;
    result[idx].expenses = row.expenses;
  }
  return result;
}

// Devuelve el desglose diario de ingresos y gastos para la semana actual (lun-dom).
// Retorna arreglo de 7 puntos ordenados de lunes a domingo.
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

// Devuelve el desglose diario de ingresos y gastos para la semana que inicia en el lunes indicado.
// Param monday: Fecha del lunes. Retorna arreglo de 7 puntos (indice 0=lunes, 6=domingo).
export async function getDailyBreakdownForWeekDate(monday: Date): Promise<PeriodPoint[]> {
  const start = new Date(monday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return dailyBreakdownBetween(start, end);
}

// Devuelve el desglose semanal de ingresos y gastos para el mes indicado (4 semanas).
// Semana 1 = dias 1-7, semana 2 = 8-14, semana 3 = 15-21, semana 4 = 22-fin.
// Param year: Anio. Param month: Mes (0-11). Retorna arreglo de 4 puntos.
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

// Devuelve el desglose mensual de ingresos y gastos para el anio indicado (12 meses).
// Indice 0 = enero, indice 11 = diciembre. Los meses sin movimientos devuelven { income: 0, expenses: 0 }.
// Retorna arreglo de 12 puntos.
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

// Agrega una categoria nueva si no existe para el tipo indicado. Retorna coleccion final de categorias.
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

// Inserta multiples transacciones en una sola transaccion atomica.
// Si la app crashea a mitad de la insercion, ninguna transaccion queda
// persistida parcialmente. Param txs: Arreglo de movimientos sin ID/fecha.
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

// Actualiza los campos editables de un movimiento existente. Retorna promesa resuelta tras la actualizacion.
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

// Lista todas las plantillas de movimientos recurrentes (gastos e ingresos),
// de la más reciente a la más antigua.
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

// Indica si el toggle de la estadística de ahorro está activo (persistente).
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
