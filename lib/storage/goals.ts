import { Goal, GoalStep, GoalInstallment, GoalStatus, GoalType, PotContribution } from "./types";
import { getDb } from "./db";
import { generateId } from "./helpers";

type GoalRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  created_at: string;
  completed_at: string | null;
  sort_order: number;
  goal_type: string;
  installments: number | null;
  interval: string | null;
  completed_installments: number;
  total_amount: number | null;
};

type StepRow = {
  id: string;
  goal_id: string;
  title: string;
  description: string | null;
  completed: number;
  step_order: number;
  unlocked_at: string | null;
};

type InstallmentRow = {
  id: string;
  goal_id: string;
  idx: number;
  amount: number;
  due_date: string;
  completed: number;
  missed: number;
};

type ContributionRow = {
  id: string;
  goal_id: string;
  amount: number;
  created_at: string;
};

const POINTS_KEY = "user_points";
const STEP_POINTS = 5;
const GOAL_POINTS = 50;

export async function awardPoints(amount: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
    [POINTS_KEY, String(amount), amount]
  );
}

export async function getUserPoints(): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    POINTS_KEY
  );
  if (!row) return 0;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Marca como incompletas las metas de ahorro y alcancías cuya fecha límite
// pasó sin lograr el monto. Se corre en cada carga para que el estado sea
// consistente aunque la app no estuviera abierta el día de la fecha.
async function markExpiredGoals(): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE goals SET status = 'incomplete', completed_at = NULL
     WHERE status = 'active'
       AND goal_type IN ('savings', 'pot')
       AND target_date IS NOT NULL
       AND target_date < ?`,
    new Date().toISOString()
  );
}

export async function getGoals(): Promise<Goal[]> {
  const db = getDb();
  await markExpiredGoals();

  const goalRows = await db.getAllAsync<GoalRow>(
    "SELECT * FROM goals ORDER BY sort_order ASC, created_at DESC"
  );
  if (goalRows.length === 0) {
    return [];
  }

  const stepRows = await db.getAllAsync<StepRow>(
    "SELECT * FROM goal_steps ORDER BY step_order ASC"
  );

  const stepsByGoal = new Map<string, GoalStep[]>();
  for (const row of stepRows) {
    const list = stepsByGoal.get(row.goal_id) ?? [];
    list.push({
      id: row.id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description ?? undefined,
      completed: row.completed === 1,
      stepOrder: row.step_order,
      unlockedAt: row.unlocked_at,
    });
    stepsByGoal.set(row.goal_id, list);
  }

  const installmentRows = await db.getAllAsync<InstallmentRow>(
    "SELECT * FROM goal_installments ORDER BY idx ASC"
  );

  const installmentsByGoal = new Map<string, GoalInstallment[]>();
  for (const row of installmentRows) {
    const list = installmentsByGoal.get(row.goal_id) ?? [];
    list.push({
      id: row.id,
      goalId: row.goal_id,
      index: row.idx,
      amount: row.amount,
      dueDate: row.due_date,
      completed: row.completed === 1,
      missed: row.missed === 1,
    });
    installmentsByGoal.set(row.goal_id, list);
  }

  // Aportes de las alcancías (modo libre): por goal, en orden de creación.
  const contributionRows = await db.getAllAsync<ContributionRow>(
    "SELECT * FROM pot_contributions ORDER BY created_at ASC"
  );
  const contributionsByGoal = new Map<string, PotContribution[]>();
  for (const row of contributionRows) {
    const list = contributionsByGoal.get(row.goal_id) ?? [];
    list.push({
      id: row.id,
      goalId: row.goal_id,
      amount: row.amount,
      createdAt: row.created_at,
    });
    contributionsByGoal.set(row.goal_id, list);
  }

  return goalRows.map((grow) => ({
    id: grow.id,
    title: grow.title,
    description: grow.description ?? undefined,
    type: grow.goal_type as GoalType,
    status: grow.status as GoalStatus,
    targetDate: grow.target_date ?? undefined,
    createdAt: grow.created_at,
    completedAt: grow.completed_at ?? undefined,
    steps: stepsByGoal.get(grow.id) ?? [],
    installments: grow.installments ?? undefined,
    interval: (grow.interval as "weekly" | "monthly") ?? undefined,
    completedInstallments: grow.completed_installments,
    totalAmount: grow.total_amount ?? undefined,
    installmentList: installmentsByGoal.get(grow.id) ?? undefined,
    contributions: contributionsByGoal.get(grow.id) ?? undefined,
  }));
}

export async function addGoal(
  title: string,
  description?: string,
  targetDate?: string,
  goalType?: GoalType,
  installments?: number,
  interval?: "weekly" | "monthly",
  totalAmount?: number
): Promise<void> {
  const db = getDb();
  const maxRow = await db.getFirstAsync<{ max: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS max FROM goals"
  );
  const nextOrder = maxRow?.max ?? 1;
  const id = generateId();
  await db.runAsync(
    `INSERT INTO goals (id, title, description, status, target_date, created_at, sort_order, goal_type, installments, interval, completed_installments, total_amount)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, title, description ?? null, targetDate ?? null, new Date().toISOString(), nextOrder, goalType ?? "objective", installments ?? null, interval ?? null, totalAmount ?? null]
  );

  if ((goalType === "savings" || goalType === "payment" || goalType === "pot") && installments && installments > 0 && totalAmount) {
    const amountPerInstallment = totalAmount / installments;
    const createdAt = new Date().toISOString();
    for (let i = 0; i < installments; i += 1) {
      const days = interval === "weekly" ? 7 : 30;
      const dueDate = new Date(Date.now() + (i + 1) * days * 86400000).toISOString();
      await db.runAsync(
        "INSERT INTO goal_installments (id, goal_id, idx, amount, due_date, completed) VALUES (?, ?, ?, ?, ?, 0)",
        [generateId(), id, i, amountPerInstallment, dueDate]
      );
    }
  }
}

export async function getGoalInstallments(goalId: string): Promise<GoalInstallment[]> {
  const db = getDb();
  const rows = await db.getAllAsync<InstallmentRow>(
    "SELECT * FROM goal_installments WHERE goal_id = ? ORDER BY idx ASC",
    goalId
  );
  return rows.map((row) => ({
    id: row.id,
    goalId: row.goal_id,
    index: row.idx,
    amount: row.amount,
    dueDate: row.due_date,
    completed: row.completed === 1,
    missed: row.missed === 1,
  }));
}

export async function updateGoalInstallment(
  installmentId: string,
  updates: { amount?: number; dueDate?: string }
): Promise<void> {
  const db = getDb();
  const goal = await db.getFirstAsync<GoalRow>(
    "SELECT goals.status FROM goals JOIN goal_installments ON goal_installments.goal_id = goals.id WHERE goal_installments.id = ?",
    installmentId
  );
  if (!goal) throw new Error("Cuota no encontrada.");
  if (goal.status === "incomplete") throw new Error("Esta meta venció sin completarse.");
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (updates.amount !== undefined) { sets.push("amount = ?"); values.push(updates.amount); }
  if (updates.dueDate !== undefined) { sets.push("due_date = ?"); values.push(updates.dueDate); }
  if (sets.length === 0) return;
  values.push(installmentId);
  await db.runAsync(`UPDATE goal_installments SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function markInstallment(goalId: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const goal = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    if (!goal || (goal.goal_type !== "savings" && goal.goal_type !== "payment" && goal.goal_type !== "pot")) {
      throw new Error("No es una meta de ahorro o pago.");
    }
    if (goal.status === "incomplete") throw new Error("Esta meta venció sin completarse.");
    if (goal.status !== "active") throw new Error("La meta no esta activa.");

    const next = await txn.getFirstAsync<InstallmentRow>(
      "SELECT * FROM goal_installments WHERE goal_id = ? AND completed = 0 AND missed = 0 ORDER BY idx ASC LIMIT 1",
      goalId
    );
    if (!next) throw new Error("Todos los pagos ya estan completados.");

    await txn.runAsync(
      "UPDATE goal_installments SET completed = 1 WHERE id = ?",
      next.id
    );
    await txn.runAsync(
      "UPDATE goals SET completed_installments = completed_installments + 1 WHERE id = ?",
      goalId
    );

    await txn.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
      [POINTS_KEY, String(STEP_POINTS), STEP_POINTS]
    );

    // En una alcancía los periodos marcados como "no hecho" ya se repartieron
    // a los restantes; la meta se completa cuando quedan cero sin repartir.
    const updated = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    const missedCount = await txn.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM goal_installments WHERE goal_id = ? AND missed = 1",
      goalId
    );
    const done = updated && goal.goal_type === "pot"
      ? updated.completed_installments + (missedCount?.c ?? 0) >= (updated.installments ?? 0)
      : updated && updated.completed_installments >= (updated.installments ?? 0);
    if (done) {
      await txn.runAsync(
        "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
        [new Date().toISOString(), goalId]
      );
      await txn.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
        [POINTS_KEY, String(GOAL_POINTS), GOAL_POINTS]
      );
    }
  });
}

export async function addGoalStep(
  goalId: string,
  title: string,
  insertAfterIndex: number,
  description?: string
): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getAllAsync<StepRow>(
      "SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY step_order ASC",
      goalId
    );

    const newStep: StepRow = {
      id: generateId(),
      goal_id: goalId,
      title,
      description: description ?? null,
      completed: 0,
      step_order: 0,
      unlocked_at: null,
    };

    const updated: StepRow[] = [...existing];
    const safeIndex = Math.max(-1, Math.min(insertAfterIndex, updated.length - 1));
    updated.splice(safeIndex + 1, 0, newStep);

    for (let i = 0; i < updated.length; i += 1) {
      await txn.runAsync(
        `INSERT INTO goal_steps (id, goal_id, title, description, completed, step_order, unlocked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           step_order = excluded.step_order`,
        [
          updated[i].id,
          goalId,
          updated[i].title,
          updated[i].description,
          updated[i].completed,
          i + 1,
          updated[i].unlocked_at,
        ]
      );
    }
  });
}

export async function deleteGoalStep(stepId: string, goalId: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const stepRows = await txn.getAllAsync<StepRow>(
      "SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY step_order ASC",
      goalId
    );

    const targetIdx = stepRows.findIndex((s) => s.id === stepId);
    if (targetIdx === -1) return;

    if (stepRows[targetIdx].completed === 1) {
      throw new Error("No puedes eliminar un paso ya completado.");
    }

    await txn.runAsync("DELETE FROM goal_steps WHERE id = ?", stepId);

    const remaining = stepRows.filter((s) => s.id !== stepId);
    for (let i = 0; i < remaining.length; i += 1) {
      await txn.runAsync(
        "UPDATE goal_steps SET step_order = ? WHERE id = ?",
        [i + 1, remaining[i].id]
      );
    }
  });
}

export async function toggleGoalStep(stepId: string, goalId: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const stepRows = await txn.getAllAsync<StepRow>(
      "SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY step_order ASC",
      goalId
    );

    const targetIndex = stepRows.findIndex((s) => s.id === stepId);
    if (targetIndex === -1) return;

    const targetStep = stepRows[targetIndex];

    if (targetStep.completed === 0) {
      for (let i = 0; i < targetIndex; i += 1) {
        if (stepRows[i].completed === 0) {
          throw new Error("Completa los pasos anteriores antes de avanzar.");
        }
      }

      const isFirstCompletion = targetStep.unlocked_at === null;
      await txn.runAsync(
        `UPDATE goal_steps
         SET completed = 1, unlocked_at = COALESCE(unlocked_at, ?)
         WHERE id = ?`,
        [new Date().toISOString(), stepId]
      );

      if (isFirstCompletion) {
        await txn.runAsync(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
          [POINTS_KEY, String(STEP_POINTS), STEP_POINTS]
        );
      }
    } else {
      throw new Error("No puedes desmarcar un paso ya completado.");
    }
  });
}

export async function markInstallmentById(installmentId: string, goalId: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const goal = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    if (!goal || (goal.goal_type !== "savings" && goal.goal_type !== "payment" && goal.goal_type !== "pot")) {
      throw new Error("No es una meta de ahorro o pago.");
    }
    if (goal.status === "incomplete") throw new Error("Esta meta venció sin completarse.");
    if (goal.status !== "active") throw new Error("La meta no esta activa.");

    const inst = await txn.getFirstAsync<InstallmentRow>(
      "SELECT * FROM goal_installments WHERE id = ? AND goal_id = ?",
      installmentId, goalId
    );
    if (!inst) throw new Error("Cuota no encontrada.");
    if (inst.completed) throw new Error("Esta cuota ya esta pagada.");
    if (inst.missed === 1) {
      // Un periodo vencido sin pagar ya repartió su monto: no se puede pagar.
      throw new Error("Este periodo vencio: su aporte ya se repartio entre los restantes.");
    }

    await txn.runAsync(
      "UPDATE goal_installments SET completed = 1 WHERE id = ?",
      installmentId
    );
    await txn.runAsync(
      "UPDATE goals SET completed_installments = completed_installments + 1 WHERE id = ?",
      goalId
    );

    await txn.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
      [POINTS_KEY, String(STEP_POINTS), STEP_POINTS]
    );

    // Igual que en markInstallment: en alcancías los periodos "no hecho" ya
    // están cubiertos por los restantes, así que basta pagar los activos.
    const updated = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    const missedCount = await txn.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM goal_installments WHERE goal_id = ? AND missed = 1",
      goalId
    );
    const done = updated && goal.goal_type === "pot"
      ? updated.completed_installments + (missedCount?.c ?? 0) >= (updated.installments ?? 0)
      : updated && updated.completed_installments >= (updated.installments ?? 0);
    if (done) {
      await txn.runAsync(
        "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
        [new Date().toISOString(), goalId]
      );
      await txn.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
        [POINTS_KEY, String(GOAL_POINTS), GOAL_POINTS]
      );
    }
  });
}

// Reparte entre los periodos restantes el monto de cada periodo vencido sin
// pagar de una alcancía, y los marca como "no hecho". Retorna true si hubo
// al menos uno repartido (para avisar al usuario).
export async function redistributeMissedInstallments(goalId: string): Promise<boolean> {
  const db = getDb();
  let changed = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const goal = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    if (!goal || goal.goal_type !== "pot" || goal.status !== "active") return;
    const now = new Date().toISOString();

    // Se procesan en orden: el periodo vencido reparte su monto actual entre
    // los activos posteriores, luego se marca no hecho y se sigue con el próximo.
    for (;;) {
      const overdue = await txn.getFirstAsync<InstallmentRow>(
        "SELECT * FROM goal_installments WHERE goal_id = ? AND completed = 0 AND missed = 0 AND due_date < ? ORDER BY idx ASC LIMIT 1",
        goalId, now
      );
      if (!overdue) break;

      const remaining = await txn.getAllAsync<InstallmentRow>(
        "SELECT * FROM goal_installments WHERE goal_id = ? AND completed = 0 AND missed = 0 AND idx > ?",
        goalId, overdue.idx
      );
      if (remaining.length === 0) {
        // Fue el último periodo activo y venció: se marca como no hecho.
        await txn.runAsync(
          "UPDATE goal_installments SET missed = 1 WHERE id = ? AND missed = 0",
          overdue.id
        );
        changed = true;
        break;
      }

      const share = overdue.amount / remaining.length;
      for (const r of remaining) {
        await txn.runAsync(
          "UPDATE goal_installments SET amount = amount + ? WHERE id = ?",
          [share, r.id]
        );
      }
      await txn.runAsync(
        "UPDATE goal_installments SET missed = 1 WHERE id = ? AND missed = 0",
        overdue.id
      );
      changed = true;
    }
  });
  return changed;
}

// Añade un aporte a una alcancía del modo libre (también a una meta de objeto
// en modo ahorro libre) y la completa automáticamente cuando la suma alcanza
// el monto deseado.
export async function addPotContribution(goalId: string, amount: number): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const goal = await txn.getFirstAsync<GoalRow>(
      "SELECT * FROM goals WHERE id = ?",
      goalId
    );
    const isFreeGoal =
      goal && (goal.goal_type === "pot" || (goal.goal_type === "savings" && (goal.installments ?? 0) === 0));
    if (!goal || !isFreeGoal) throw new Error("No es una meta de ahorro.");
    if ((goal.installments ?? 0) > 0) throw new Error("Esta meta usa periodos fijos.");
    if (goal.status === "incomplete") throw new Error("Esta meta venció sin completarse.");
    if (goal.status !== "active") throw new Error("La meta no esta activa.");

    await txn.runAsync(
      "INSERT INTO pot_contributions (id, goal_id, amount, created_at) VALUES (?, ?, ?, ?)",
      [generateId(), goalId, amount, new Date().toISOString()]
    );

    await txn.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
      [POINTS_KEY, String(STEP_POINTS), STEP_POINTS]
    );

    const sumRow = await txn.getFirstAsync<{ s: number }>(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM pot_contributions WHERE goal_id = ?",
      goalId
    );
    if ((sumRow?.s ?? 0) >= (goal.total_amount ?? 0)) {
      await txn.runAsync(
        "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
        [new Date().toISOString(), goalId]
      );
      await txn.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?`,
        [POINTS_KEY, String(GOAL_POINTS), GOAL_POINTS]
      );
    }
  });
}

export async function completeGoal(goalId: string): Promise<boolean> {
  const db = getDb();

  const goalRow = await db.getFirstAsync<GoalRow>(
    "SELECT * FROM goals WHERE id = ?",
    goalId
  );
  if (!goalRow) throw new Error("Meta no encontrada.");
  if (goalRow.status === "incomplete") throw new Error("Esta meta venció sin completarse.");

  // Alcancía (y ahorro libre de una meta de objeto): el modo por periodos
  // solo necesita pagar los activos (los "no hecho" ya repartieron su monto a
  // los restantes); el modo libre se completa al alcanzar el monto deseado.
  if (goalRow.goal_type === "pot" || (goalRow.goal_type === "savings" && (goalRow.installments ?? 0) === 0)) {
    if ((goalRow.installments ?? 0) > 0) {
      // Alcancía por periodos: solo falta pagar los activos; los "no hecho"
      // ya repartieron su monto a los restantes.
      const missedCount = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) AS c FROM goal_installments WHERE goal_id = ? AND missed = 1",
        goalId
      );
      if (goalRow.completed_installments + (missedCount?.c ?? 0) < (goalRow.installments ?? 0)) {
        throw new Error("Aun hay periodos por pagar.");
      }
    } else {
      // Alcancía libre: se completa cuando el ahorrado alcanza el monto deseado.
      const sumRow = await db.getFirstAsync<{ s: number }>(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM pot_contributions WHERE goal_id = ?",
        goalId
      );
      if ((sumRow?.s ?? 0) < (goalRow.total_amount ?? 0)) {
        throw new Error("El ahorro aun no alcanza el monto deseado.");
      }
    }
    const result = await db.runAsync(
      "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
      [new Date().toISOString(), goalId]
    );
    const transitioned = (result.changes ?? 0) > 0;
    if (transitioned) {
      await awardPoints(GOAL_POINTS);
    }
    return transitioned;
  }

  if (goalRow.goal_type === "savings" || goalRow.goal_type === "payment") {
    if (goalRow.completed_installments < (goalRow.installments ?? 0)) {
      throw new Error("Completa todos los pagos antes de finalizar la meta.");
    }
    const result = await db.runAsync(
      "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
      [new Date().toISOString(), goalId]
    );
    const transitioned = (result.changes ?? 0) > 0;
    if (transitioned) {
      await awardPoints(GOAL_POINTS);
    }
    return transitioned;
  }

  const stepRows = await db.getAllAsync<StepRow>(
    "SELECT * FROM goal_steps WHERE goal_id = ?",
    goalId
  );
  const allDone =
    stepRows.length === 0 || stepRows.every((s) => s.completed === 1);
  if (!allDone) {
    throw new Error("Completa todos los pasos antes de finalizar la meta.");
  }

  const result = await db.runAsync(
    "UPDATE goals SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'",
    [new Date().toISOString(), goalId]
  );

  const transitioned = (result.changes ?? 0) > 0;
  if (transitioned) {
    await awardPoints(GOAL_POINTS);
  }
  return transitioned;
}

export async function updateGoal(
  id: string,
  updates: { title?: string; description?: string }
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (updates.title !== undefined) { sets.push("title = ?"); values.push(updates.title); }
  if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function reorderGoals(orderedIds: string[]): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await txn.runAsync(
        "UPDATE goals SET sort_order = ? WHERE id = ?",
        [i + 1, orderedIds[i]]
      );
    }
  });
}

export async function deleteGoal(goalId: string): Promise<void> {
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync("DELETE FROM goal_installments WHERE goal_id = ?", goalId);
    await txn.runAsync("DELETE FROM pot_contributions WHERE goal_id = ?", goalId);
    await txn.runAsync("DELETE FROM goal_steps WHERE goal_id = ?", goalId);
    await txn.runAsync("DELETE FROM goals WHERE id = ?", goalId);
  });
}
