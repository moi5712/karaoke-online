import { cn } from "../utils/cn";

export interface ToggleDotProps {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  accent?: "primary" | "secondary" | "success";
  className?: string;
  title?: string;
}

const activeGlow = {
  primary: "bg-primary-500 shadow-[0_0_5px] shadow-primary-500/80",
  secondary: "bg-secondary-400 shadow-[0_0_5px] shadow-secondary-400/80",
  success: "bg-success-500 shadow-[0_0_5px] shadow-success-500/80",
};

export function ToggleDot({
  active,
  onToggle,
  disabled,
  accent = "primary",
  className,
  title,
}: ToggleDotProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      title={title ?? (active ? "關閉" : "開啟")}
      aria-label={title ?? (active ? "關閉" : "開啟")}
      aria-pressed={active}
      className={cn(
        "size-2.5 rounded-full transition-all duration-normal ease-default",
        "cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        active ? activeGlow[accent] : "bg-neutral-700 hover:bg-neutral-600",
        className
      )}
    />
  );
}
