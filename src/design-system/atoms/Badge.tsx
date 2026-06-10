import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type BadgeVariant = "default" | "brand" | "success" | "secondary" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  children?: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-neutral-800 text-neutral-400",
  brand: "bg-primary-950 text-primary-400",
  success: "bg-success-950 text-success-400",
  secondary: "bg-secondary-950 text-secondary-300",
  warning: "bg-warning-950 text-warning-400",
  danger: "bg-danger-950 text-danger-400",
};

const sizeStyles = {
  sm: "px-1 py-0.5 text-[8px] rounded-sm",
  md: "px-1.5 py-0.5 text-[9px] rounded",
};

export function Badge({ variant = "default", size = "md", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-bold",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
