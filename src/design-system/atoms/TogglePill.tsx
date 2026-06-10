import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type TogglePillVariant = "brand" | "secondary" | "success" | "neutral";

export interface TogglePillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  variant?: TogglePillVariant;
  children?: ReactNode;
}

const activeStyles: Record<TogglePillVariant, string> = {
  brand: "bg-toggle-active text-toggle-active-text",
  secondary: "bg-secondary-950 text-secondary-200",
  success: "bg-success-950 text-success-200",
  neutral: "bg-neutral-800 text-neutral-200",
};

const inactiveStyles =
  "bg-toggle-inactive text-toggle-inactive-text hover:bg-toggle-inactive-hover hover:text-text-secondary";

export function TogglePill({
  active,
  variant = "brand",
  className,
  disabled,
  children,
  ...props
}: TogglePillProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-1.5 rounded-full",
        "text-xs font-semibold cursor-pointer",
        "transition-colors duration-normal ease-default",
        "disabled:opacity-70 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        "[&_svg]:shrink-0",
        active ? activeStyles[variant] : inactiveStyles,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
