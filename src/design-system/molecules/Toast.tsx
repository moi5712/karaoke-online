import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../utils/cn";
import type { AlertVariant } from "./AlertBar";

export interface ToastProps {
  id: string;
  message: string;
  variant: AlertVariant;
  exiting?: boolean;
  onDismiss: (id: string) => void;
}

const variantStyles: Record<AlertVariant, { container: string; icon: string }> = {
  error: {
    container: "bg-danger-950 text-danger-200",
    icon: "text-danger-400",
  },
  info: {
    container: "bg-secondary-950 text-secondary-100",
    icon: "text-secondary-200",
  },
  success: {
    container: "bg-success-950 text-success-100",
    icon: "text-success-400",
  },
  warning: {
    container: "bg-warning-950 text-warning-100",
    icon: "text-warning-400",
  },
};

const variantIcons: Record<AlertVariant, typeof Info> = {
  error: AlertTriangle,
  info: CheckCircle2,
  success: CheckCircle2,
  warning: Info,
};

export function Toast({ id, message, variant, exiting, onDismiss }: ToastProps) {
  const styles = variantStyles[variant];
  const Icon = variantIcons[variant];

  return (
    <div
      id={variant === "error" ? "error-message-bar" : variant === "info" ? "alert-message-bar" : undefined}
      role="alert"
      aria-live="assertive"
      className={cn(
        "pointer-events-auto rounded-xl px-4 py-3 flex items-center gap-2.5",
        "transition-[opacity,transform] duration-normal ease-default",
        exiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0 animate-toast-in",
        styles.container
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", styles.icon)} aria-hidden="true" />
      <p className="flex-1 min-w-0 text-sm leading-4">{message}</p>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="shrink-0 p-0.5 rounded-md text-neutral-400 hover:text-text-primary hover:bg-neutral-800 transition-colors duration-normal ease-default cursor-pointer"
        aria-label="關閉通知"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
