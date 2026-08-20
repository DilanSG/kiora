import { Platform } from "react-native";
import * as Calendar from "expo-calendar";
import * as ImagePicker from "expo-image-picker";
import { getDb } from "./storage/db";
import { requestSmsPermission } from "./native/SmsReader";
import { loadNotifications } from "./notifications/loader";

const ASKED_KEY = "startup_permissions_asked";

// Todos los permisos runtime que la app usa en cualquier flujo:
// Android: SMS (importaciones), notificaciones y calendario.
// iOS: notificaciones, calendario y fotos (la galería del Wishlist).
// Android 13+ no pide permiso para fotos: usa el sistema Photo Picker.
export async function requestAllRuntimePermissions(): Promise<void> {
  if (Platform.OS === "android") {
    await requestSmsPermission();
    await requestCalendarPermission();
    await requestNotificationPermission();
  } else {
    await requestNotificationPermission();
    await requestCalendarPermission();
    await ImagePicker.requestMediaLibraryPermissionsAsync();
  }
}

async function requestCalendarPermission(): Promise<void> {
  try {
    await Calendar.requestCalendarPermissionsAsync();
  } catch {
    // modulo no disponible: el flujo objetivo pide permiso por su cuenta
  }
}

async function requestNotificationPermission(): Promise<void> {
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;
    await Notifications.requestPermissionsAsync();
  } catch {
    // modulo no disponible: el flujo objetivo pide permiso por su cuenta
  }
}

// Pide todos los permisos solo la primera vez que abre la app con sesión
// iniciada. El flag vive en SQLite para no repetir el diálogo en cada arranque.
export async function requestPermissionsOnFirstLaunch(): Promise<void> {
  try {
    const db = getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM settings WHERE key = ?",
      ASKED_KEY
    );
    if (row?.c) return;

    await requestAllRuntimePermissions();
    await db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')",
      ASKED_KEY
    );
  } catch {
    // sin DB (primer arranque) o error puntual: reintenta en el próximo arranque
  }
}