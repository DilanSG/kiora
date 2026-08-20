import { useSafeAreaInsets } from "react-native-safe-area-context";

// Inset inferior de la barra de sistema (gesto ~24-32px, 3 botones ~48px,
// sin barra = 0). La app corre edge-to-edge (edgeToEdgeEnabled) con el tab
// bar oculto, así que todo lo anclado abajo (FABs, sheets, footers) debe
// sumar este valor o quedará tapado por la barra de navegación.
export function useSafeBottom(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom;
}