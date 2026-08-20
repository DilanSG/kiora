import { getDb } from "./db";

export async function getUserName(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'user_name'"
  );
  return row?.value ?? null;
}

export async function setUserName(name: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('user_name', ?)",
    name.trim()
  );
}

export async function getGoalTutorialSeen(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'goal_tutorial_seen'"
  );
  return row?.value === "1";
}

export async function setGoalTutorialSeen(): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('goal_tutorial_seen', '1')"
  );
}
