import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full bg-surface-input text-neutral-100 placeholder:text-neutral-500",
        "rounded-xl py-2 px-3 text-xs",
        "transition-colors duration-normal ease-default",
        "focus:outline-none focus:bg-surface-chip",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        error && "bg-danger-950 text-danger-200 focus:bg-danger-950",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
