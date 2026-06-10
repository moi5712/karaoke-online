import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";

export type AlertVariant = "error" | "info" | "success" | "warning";

export interface AlertBarProps {
  variant?: AlertVariant;
  icon: LucideIcon;
  children?: ReactNode;
  id?: string;
  className?: string;
}

const variantStyles: Record<AlertVariant, { container: string; icon: string }> = {
  error: {
    container: "bg-danger-950 text-danger-200",
    icon: "text-danger-400",
  },
  info: {
    container: "bg-secondary-950 text-secondary-200",
    icon: "text-warning-400",
  },
  success: {
    container: "bg-success-950 text-success-200",
    icon: "text-success-400",
  },
  warning: {
    container: "bg-warning-950 text-warning-200",
    icon: "text-warning-400",
  },
};

export function AlertBar({ variant = "info", icon: Icon, children, id, className }: AlertBarProps) {
  const styles = variantStyles[variant];
  return (
    <div
      id={id}
      role="alert"
      className={cn(
        "text-sm px-4 py-3 rounded-xl flex items-center gap-2.5",
        variant === "info" && "text-xs py-2.5",
        styles.container,
        className
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", variant === "info" && "w-3.5 h-3.5", styles.icon)} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
