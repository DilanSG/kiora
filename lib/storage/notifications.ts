import { AppNotification, NotificationType } from "./types";

import { getDb } from "./db";
import { generateId } from "./helpers";

type NotificationRow = {
  id: string;
  message: string;
  type: string;
  read: number;
  created_at: string;
};

export async function getNotifications(): Promise<AppNotification[]> {
  const db = getDb();
  const rows = await db.getAllAsync<NotificationRow>(
    "SELECT * FROM app_notifications ORDER BY created_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    type: r.type as NotificationType,
    read: r.read === 1,
    createdAt: r.created_at,
  }));
}

// Efecto secundario: purga las notificaciones > PURGE_DAYS días al insertar,
// para que la tabla no crezca sin límite.
export async function addNotification(
  message: string,
  type: NotificationType = "info"
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO app_notifications (id, message, type, read, created_at) VALUES (?, ?, ?, 0, ?)",
    [generateId(), message, type, new Date().toISOString()]
  );
  await deleteOldNotifications(PURGE_DAYS);
}

export async function deleteOldNotifications(days: number): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync("DELETE FROM app_notifications WHERE created_at < ?", cutoff);
}

const PURGE_DAYS = 30;

export async function markNotificationAsRead(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE app_notifications SET read = 1 WHERE id = ?",
    id
  );
}

export async function clearReadNotifications(): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM app_notifications WHERE read = 1");
}
