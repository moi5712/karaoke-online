import { useCallback, useMemo, useRef, useState } from "react";
import type { AlertVariant } from "../molecules/AlertBar";
import { THEME_TRANSITION_MS } from "../theme/theme";

export interface ToastItem {
  id: string;
  message: string;
  variant: AlertVariant;
  exiting?: boolean;
}

const DEFAULT_DURATION: Record<AlertVariant, number> = {
  error: 5000,
  info: 8000,
  success: 5000,
  warning: 5000,
};

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, THEME_TRANSITION_MS);

    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, variant: AlertVariant, duration?: number) => {
      const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const ms = duration ?? DEFAULT_DURATION[variant];

      setToasts((prev) => [...prev.slice(-4), { id, message, variant, exiting: false }]);

      const timer = setTimeout(() => dismiss(id), ms);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      error: (message: string, duration?: number) => show(message, "error", duration),
      info: (message: string, duration?: number) => show(message, "info", duration),
      success: (message: string, duration?: number) => show(message, "success", duration),
      warning: (message: string, duration?: number) => show(message, "warning", duration),
    }),
    [show]
  );

  return { toasts, dismiss, toast };
}
