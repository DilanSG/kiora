import { Platform } from "react-native";
import { loadNotifications } from "./loader";

// Canal silencioso para Android — sin sonido, vibracion minima.
// En iOS usamos el canal por defecto.
export async function setupNotificationChannel(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("task-reminders", {
    name: "Recordatorios de tareas",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 100],
    lightColor: "#67E8B4",
    sound: null,
  });
}

// Pide permiso para notificaciones locales de forma no intrusiva.
// Retorna true si hay permiso. Falso donde el módulo no existe.
export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === "granted";
}
