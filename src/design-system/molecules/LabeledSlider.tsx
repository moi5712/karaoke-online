import { type ReactNode } from "react";
import { cn } from "../utils/cn";
import { Slider, type SliderAccent } from "../atoms/Slider";

export interface LabeledSliderProps {
  id?: string;
  label: ReactNode;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  accent?: SliderAccent;
  disabled?: boolean;
  suffix?: ReactNode;
  className?: string;
  valueColor?: string;
}

export function LabeledSlider({
  id,
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
  accent = "primary",
  disabled,
  suffix,
  className,
  valueColor = "text-primary-400",
}: LabeledSliderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex justify-between items-center text-xs text-neutral-300">
        <span className="font-bold">{label}</span>
        <span className={cn("font-mono font-bold", valueColor)}>{displayValue}</span>
      </div>
      <div className="flex items-center gap-2">
        <Slider
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          accent={accent}
          disabled={disabled}
        />
        {suffix}
      </div>
    </div>
  );
}
