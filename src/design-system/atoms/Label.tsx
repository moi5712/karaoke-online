import { type LabelHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  children?: ReactNode;
}

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "block text-[10px] font-bold text-neutral-400 mb-1 leading-normal",
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="text-primary-400 ml-0.5" aria-hidden="true">*</span>}
    </label>
  );
}
