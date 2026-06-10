import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger" | "secondary-accent";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-interactive-primary hover:bg-interactive-primary-hover text-white",
  secondary: "bg-interactive-secondary hover:bg-interactive-secondary-hover text-text-secondary hover:text-text-primary",
  ghost: "bg-transparent hover:bg-interactive-secondary text-neutral-400 hover:text-text-primary",
  success: "bg-success-600 hover:bg-success-500 text-white",
  danger: "bg-danger-500 hover:bg-danger-600 text-white",
  "secondary-accent": "bg-secondary-600 hover:bg-secondary-500 text-white",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
  md: "px-4 py-2 text-xs rounded-xl gap-1.5",
  lg: "px-5 py-2.5 text-sm rounded-xl gap-2",
  icon: "p-2.5 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", fullWidth, className, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center font-bold transition-colors duration-normal ease-default",
        "cursor-pointer",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);

Button.displayName = "Button";
