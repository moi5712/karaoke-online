import { cn } from "../utils/cn";

export type StatusDotVariant = "active" | "inactive" | "recording" | "brand" | "warning";

export interface StatusDotProps {
  variant?: StatusDotVariant;
  pulse?: boolean;
  className?: string;
}

const variantStyles: Record<StatusDotVariant, string> = {
  active: "bg-success-400",
  inactive: "bg-neutral-500",
  recording: "bg-danger-500",
  brand: "bg-primary-500",
  warning: "bg-warning-400",
};

export function StatusDot({ variant = "inactive", pulse = false, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "block rounded-full shrink-0",
        variantStyles[variant],
        pulse && "animate-pulse",
        className ?? "size-2"
      )}
      aria-hidden="true"
    />
  );
}
