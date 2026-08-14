export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  category: string;
  dueDate: string | null;
  reminder: string | null;
  createdAt: string;
};

export type NoteEntityType = "task" | "goal" | "goal_step";

export type NoteLink = {
  id: number;
  noteId: string;
  entityType: NoteEntityType;
  entityId: string;
};

export type Note = {
  id: string;
  title: string | null;
  content: string;
  pinned: boolean;
  createdAt: string;
  links: NoteLink[];
};

export type TransactionType = "income" | "expense";

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  category: string;
  date: string;
  // Rastrea que el movimiento proviene de un gasto recurrente (id de recurrente).
  recurringId?: string;
};

export type RecurringInterval = "weekly" | "monthly" | "yearly";

// Movimiento que se repite en la misma fecha de cada semana/mes/año: la app
// materializa sus ocurrencias como transacciones reales hasta el mes en curso.
export type RecurringExpense = {
  id: string;
  type: TransactionType;
  description: string;
  amount: number;
  category: string;
  interval: RecurringInterval;
  // Fecha de referencia: define el día de la semana/mes/año en que se repite.
  anchorDate: string;
  createdAt: string;
};

export type WishItem = {
  id: string;
  title: string;
  link: string;
  amount?: number;
  image?: string;
  description?: string;
  category: string;
  createdAt: string;
};

export type GoalStatus = "active" | "completed" | "paused" | "incomplete";

export type GoalType = "objective" | "savings" | "payment" | "pot";

export type GoalStep = {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  completed: boolean;
  stepOrder: number;
  unlockedAt: string | null;
};

export type GoalInstallment = {
  id: string;
  goalId: string;
  index: number;
  amount: number;
  dueDate: string;
  completed: boolean;
  // Periodo vencido sin pagar: su monto se repartió entre los restantes.
  missed?: boolean;
};

// Aporte añadido a una alcancía (modo libre): cada pill es una cantidad ahorrada.
export type PotContribution = {
  id: string;
  goalId: string;
  amount: number;
  createdAt: string;
};

export type Goal = {
  id: string;
  title: string;
  description?: string;
  type: GoalType;
  status: GoalStatus;
  targetDate?: string;
  createdAt: string;
  completedAt?: string;
  steps: GoalStep[];
  installments?: number;
  interval?: "weekly" | "monthly";
  completedInstallments?: number;
  totalAmount?: number;
  installmentList?: GoalInstallment[];
  contributions?: PotContribution[];
};

export type PeriodPoint = {
  income: number;
  expenses: number;
  // Aportes a metas de ahorro en el periodo (línea fina en el gráfico).
  savings?: number;
};

export type NotificationType = "info" | "success" | "warning" | "error";

export type AppNotification = {
  id: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
};
