import { Task, TaskPriority } from "./types";

import { getDb } from "./db";
import { generateId, normalizeCategory } from "./helpers";

export async function getTaskCategories(): Promise<string[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM categories WHERE type = 'task' ORDER BY id ASC"
  );
  return rows.map((r) => r.name);
}

export async function addTaskCategory(name: string): Promise<string[]> {
  const normalized = normalizeCategory(name);
  if (!normalized) return getTaskCategories();
  const db = getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO categories (type, name) VALUES ('task', ?)",
    [normalized]
  );
  return getTaskCategories();
}

export async function getTasks(): Promise<Task[]> {
  const db = getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    completed: number;
    priority: string;
    category: string;
    due_date: string | null;
    reminder: string | null;
    created_at: string;
  }>("SELECT * FROM tasks ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    completed: r.completed === 1,
    priority: (r.priority || "medium") as TaskPriority,
    category: r.category || "",
    dueDate: r.due_date || null,
    reminder: r.reminder || null,
    createdAt: r.created_at,
  }));
}

export async function addTask(
  title: string,
  priority: TaskPriority = "medium",
  category: string = "",
  dueDate: string | null = null,
  reminder: string | null = null
): Promise<string> {
  const id = generateId();
  const db = getDb();
  await db.runAsync(
    "INSERT INTO tasks (id, title, completed, priority, category, due_date, reminder, created_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)",
    [id, title, priority, category, dueDate, reminder, new Date().toISOString()]
  );
  return id;
}

export async function updateTask(
  id: string,
  updates: {
    title?: string;
    priority?: TaskPriority;
    category?: string;
    dueDate?: string | null;
    reminder?: string | null;
  }
): Promise<void> {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (updates.title !== undefined) {
    fields.push("title = ?");
    values.push(updates.title);
  }
  if (updates.priority !== undefined) {
    fields.push("priority = ?");
    values.push(updates.priority);
  }
  if (updates.category !== undefined) {
    fields.push("category = ?");
    values.push(updates.category);
  }
  if (updates.dueDate !== undefined) {
    fields.push("due_date = ?");
    values.push(updates.dueDate);
  }
  if (updates.reminder !== undefined) {
    fields.push("reminder = ?");
    values.push(updates.reminder);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(
    `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function toggleTask(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE tasks SET completed = CASE WHEN completed = 1 THEN 0 ELSE 1 END WHERE id = ?",
    id
  );
}

export async function deleteTask(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM tasks WHERE id = ?", id);
}
