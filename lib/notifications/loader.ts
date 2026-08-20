import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

// Carga expo-notifications de forma perezosa. En Expo Go Android el módulo
// no existe desde SDK 53 y al evaluarse registra un error fatal; con import()
// condicional el chunk ni siquiera se evalúa ahí. Fuera de Expo Go (dev
// build / standalone / web / iOS) se carga normal; si el módulo fallara de
// todos modos, se degrada a null y la app sigue sin recordatorios.
const unavailableHere =
  Platform.OS === "android" &&
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let notifModule: Promise<typeof import("expo-notifications") | null> | null = null;

export function loadNotifications(): Promise<typeof import("expo-notifications") | null> {
  if (!notifModule) {
    notifModule = unavailableHere
      ? Promise.resolve(null)
      : import("expo-notifications").catch(() => null);
  }
  return notifModule;
}