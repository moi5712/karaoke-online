import { type LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";
import { StatusDot } from "../atoms/StatusDot";

export interface StatusChipProps {
  icon?: LucideIcon;
  label: string;
  active?: boolean;
  variant?: "brand" | "secondary" | "success" | "neutral";
  className?: string;
}

const activeBg: Record<string, string> = {
  brand: "bg-surface-chip text-neutral-300",
  secondary: "bg-surface-chip text-neutral-300",
  success: "bg-surface-chip text-neutral-300",
  neutral: "bg-surface-chip text-neutral-300",
};

export function StatusChip({ icon: Icon, label, active, variant = "neutral", className }: StatusChipProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 py-1.5 px-3 rounded-full text-xs",
        activeBg[variant],
        className
      )}
    >
      {Icon && (
        <Icon
          className={cn("w-3.5 h-3.5", variant === "brand" ? "text-primary-400" : "text-neutral-400")}
          aria-hidden="true"
        />
      )}
      {active !== undefined && (
        <StatusDot variant={active ? "active" : "inactive"} />
      )}
      <span>{label}</span>
    </div>
  );
}
