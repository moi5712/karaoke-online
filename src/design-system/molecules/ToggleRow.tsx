import { cn } from "../utils/cn";

export interface ToggleRowProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  accent?: "primary" | "secondary" | "success";
  className?: string;
}

const activeAccent = {
  primary: "bg-interactive-primary hover:bg-interactive-primary-hover text-text-inverse",
  secondary: "bg-interactive-accent hover:bg-interactive-accent-hover text-text-inverse",
  success: "bg-interactive-success hover:bg-interactive-success-hover text-text-inverse",
};

const inactiveStyles =
  "bg-interactive-secondary hover:bg-interactive-secondary-hover text-text-muted hover:text-text-primary";

export function ToggleRow({
  label,
  active,
  onToggle,
  disabled,
  accent = "primary",
  className,
}: ToggleRowProps) {
  return (
    <div className={cn("flex justify-between items-center text-xs text-neutral-300", className)}>
      {label ? <span className="font-bold">{label}</span> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center justify-center px-2 py-0.5 rounded",
          "text-[9px] font-bold min-w-[38px] transition-colors duration-normal ease-default",
          "cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
          active ? activeAccent[accent] : inactiveStyles
        )}
      >
        {active ? "ON" : "OFF"}
      </button>
    </div>
  );
}
