// Modulo de almacenamiento para la configuracion de usuario.

import { getDb } from "./db";

// Obtiene el nombre de usuario configurado en onboarding. Retorna nombre persistido o null si no existe.
export async function getUserName(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'user_name'"
  );
  return row?.value ?? null;
}

// Guarda el nombre de usuario para futuras sesiones. Param name: Nombre ingresado por el usuario. Retorna promesa resuelta cuando finaliza la persistencia.
export async function setUserName(name: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('user_name', ?)",
    name.trim()
  );
}

// Indica si la guía de uso de las metas ya se mostró tras crear la primera meta.
export async function getGoalTutorialSeen(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'goal_tutorial_seen'"
  );
  return row?.value === "1";
}

// Marca la guía de metas como vista para no volver a abrirla automáticamente.
export async function setGoalTutorialSeen(): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('goal_tutorial_seen', '1')"
  );
}
