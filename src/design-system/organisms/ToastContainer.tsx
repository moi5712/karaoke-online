import { createPortal } from "react-dom";
import { Toast } from "../molecules/Toast";
import type { ToastItem } from "../hooks/useToast";

export interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-label="通知"
      className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 w-[calc(100%-2rem)] sm:w-full max-w-sm pointer-events-none"
    >
      {toasts.map((item) => (
        <Toast
          key={item.id}
          id={item.id}
          message={item.message}
          variant={item.variant}
          exiting={item.exiting}
          onDismiss={onDismiss}
        />
      ))}
    </div>,
    document.body
  );
}
