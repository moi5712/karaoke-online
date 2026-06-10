import { type ReactNode } from "react";
import { cn } from "../utils/cn";
import { Slider, type SliderAccent } from "../atoms/Slider";
import { ToggleDot } from "../atoms/ToggleDot";

const STRIP_BASE =
  "flex flex-col items-center min-h-0 h-full flex-1 min-w-0 basis-0 py-1 px-0.5 rounded-lg bg-surface-inset/40";

export interface FaderStripProps {
  id?: string;
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  accent?: SliderAccent;
  disabled?: boolean;
  dimmed?: boolean;
  toggleActive?: boolean;
  onToggle?: () => void;
  toggleAccent?: "primary" | "secondary" | "success";
  headerAction?: ReactNode;
  valueColor?: string;
  className?: string;
}

export function FaderStrip({
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
  dimmed,
  toggleActive,
  onToggle,
  toggleAccent = "primary",
  headerAction,
  valueColor = "text-primary-400",
  className,
}: FaderStripProps) {
  return (
    <div
      className={cn(STRIP_BASE, dimmed && "opacity-60", className)}
    >
      <span className="text-[11px] font-bold text-neutral-400 text-center leading-tight mb-1 px-0.5 line-clamp-2 shrink-0">
        {label}
      </span>

      <div
        className={cn(
          "mb-0.5 flex items-center justify-center shrink-0",
          headerAction && onToggle === undefined ? "h-6" : "h-3"
        )}
      >
        {onToggle !== undefined && toggleActive !== undefined ? (
          <ToggleDot
            active={toggleActive}
            onToggle={onToggle}
            accent={toggleAccent}
          />
        ) : headerAction ? (
          headerAction
        ) : null}
      </div>

      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <Slider
          id={id}
          orientation="vertical"
          accent={accent}
          trackSize="sm"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="h-full"
        />
      </div>

      <span className={cn("text-[11px] font-mono font-bold tabular-nums text-center leading-none mt-1 px-0.5 shrink-0", valueColor)}>
        {displayValue}
      </span>
    </div>
  );
}
