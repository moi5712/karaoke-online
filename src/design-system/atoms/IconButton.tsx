import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../utils/cn";

export type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  round?: boolean;
}

const variantStyles: Record<IconButtonVariant, string> = {
  primary: "bg-interactive-primary hover:bg-interactive-primary-hover text-white",
  secondary: "bg-interactive-secondary hover:bg-interactive-secondary-hover text-text-secondary hover:text-text-primary",
  ghost: "bg-transparent text-text-muted hover:text-text-primary hover:bg-interactive-secondary",
  danger: "bg-danger-500 hover:bg-danger-600 text-white",
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: "w-8 h-8",
  md: "w-11 h-11",
  lg: "w-12 h-12",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "secondary", size = "md", round = true, className, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center transition-colors duration-normal ease-default",
        "cursor-pointer",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        variantStyles[variant],
        sizeStyles[size],
        round ? "rounded-full" : "rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);

IconButton.displayName = "IconButton";
