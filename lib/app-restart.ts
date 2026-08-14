// Evento global para reiniciar la app tras un borrado de datos: remonta
// todo el árbol de RootContent (providers incluidos) para que la UI y la
// base de datos vuelvan a sincronizarse desde cero.
type RestartListener = () => void;

let restartListener: RestartListener | null = null;

export function setRestartListener(listener: RestartListener | null): void {
  restartListener = listener;
}

export function requestAppRestart(): void {
  restartListener?.();
}