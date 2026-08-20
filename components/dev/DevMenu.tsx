// Vista de desarrollador: ya no es un modal, es una pantalla propia
// (app/dev.tsx) abierta desde el trigger invisible del footer de Ajustes.
// Este modulo solo expone la navegación compartida.
import { router } from "expo-router";

export function openDevMenu(): void {
  router.push("/dev");
}