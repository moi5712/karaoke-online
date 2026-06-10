import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "../utils/cn";

export type SliderAccent = "primary" | "secondary" | "success";

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  accent?: SliderAccent;
  trackSize?: "sm" | "md";
  orientation?: "horizontal" | "vertical";
}

const accentClass: Record<SliderAccent, string> = {
  primary: "ds-range-primary",
  secondary: "ds-range-secondary",
  success: "ds-range-success",
};

const sizeClass = {
  sm: "h-1",
  md: "h-1.5",
};

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ accent = "primary", trackSize = "md", orientation = "horizontal", className, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={cn(
        "ds-range appearance-none cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        accentClass[accent],
        orientation === "horizontal" && sizeClass[trackSize],
        orientation === "vertical" ? "ds-range-vertical h-full w-auto" : "w-full",
        className
      )}
      {...props}
    />
  )
);

Slider.displayName = "Slider";
