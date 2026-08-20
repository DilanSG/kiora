import { ReactNode, ComponentProps, ComponentType, createElement } from "react";
import { KeyboardAvoidingView as RNAvoiding, Platform } from "react-native";

declare const require: (id: string) => any;

// react-native-keyboard-controller necesita un módulo nativo que Expo Go no
// incluye (además arrastra react-native-reanimated al bundle, que crashea
// ahí). El require es opcional: si falla, se cae al KeyboardAvoidingView
// clásico de RN y al proveedor vacío. En el APK release el módulo existe y
// se usa la librería completa (fix del teclado sobre modales).
let ControllerAvoidingView: ComponentType<any> | null = null;
let ControllerProvider: ComponentType<{ children: ReactNode }> | null = null;

try {
  const mod = require("react-native-keyboard-controller");
  ControllerAvoidingView = mod.KeyboardAvoidingView;
  ControllerProvider = mod.KeyboardProvider;
} catch {
  // Módulo nativo ausente (Expo Go): se usa el comportamiento estándar.
}

type AvoidProps = ComponentProps<typeof RNAvoiding>;

// Con la librería nativa (APK) Internamente su "behavior" define cómo se
// mueve el contenido; sin behavior en Android hace exactamente nada (su switch
// cae en `default: return {}`), y casi todos los callers pasan
// behavior={Platform.OS === "ios" ? "padding" : undefined}. Aquí se inyecta
// "padding" en Android cuando el módulo nativo existe, para que el teclado
// empuje los modales inferiores aunque Android vaya en edge-to-edge.
// En Expo Go (sin módulo nativo) se mantiene el undefined original: el KAV
// de RN no puede empujar sin adjustResize y solo agrega padding de más.
export const KeyboardAvoidingView = (ControllerAvoidingView
  ? ({ behavior, ...props }: AvoidProps) => {
      const resolved = behavior ?? (Platform.OS === "android" ? "padding" : undefined);
      return createElement(ControllerAvoidingView, { ...props, behavior: resolved });
    }
  : RNAvoiding) as ComponentType<AvoidProps>;

// Proveedor que no hace nada cuando la librería no está disponible; los
// componentes hijos igual montan (el KAV clásico no necesita contexto).
export function KeyboardProvider({ children }: { children: ReactNode }) {
  if (ControllerProvider) return createElement(ControllerProvider, { children });
  return children;
}