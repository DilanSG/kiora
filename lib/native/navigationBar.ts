import { Platform } from "react-native";
import * as NavigationBar from "expo-navigation-bar";

// Con edge-to-edge la barra de navegación es una overlay transparente, así que
// el runtime solo puede ajustar el color de sus botones (no el fondo ni el
// comportamiento). El modo "swimming" (ocultar/encoger al scroll) se fija en
// el prebuild vía el config plugin en app.json.
export function syncNavigationBarButtons(isDark: boolean): void {
  if (Platform.OS !== "android") return;
  NavigationBar.setButtonStyleAsync(isDark ? "light" : "dark").catch(() => {});
}