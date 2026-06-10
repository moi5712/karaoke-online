import { cn } from "../utils/cn";

export interface SpectrumBarsProps {
  active?: boolean;
  className?: string;
}

const BAR_DELAYS = [
  "0s",
  "calc(var(--spectrum-cycle) / 3)",
  "calc(var(--spectrum-cycle) * 2 / 3)",
];

export function SpectrumBars({ active = true, className }: SpectrumBarsProps) {
  return (
    <span
      className={cn(
        "inline-flex items-end justify-center gap-px h-3.5 w-4 shrink-0 overflow-hidden",
        className
      )}
      aria-hidden="true"
    >
      {BAR_DELAYS.map((delay, index) => (
        <span
          key={index}
          className={cn(
            "w-[3px] h-full spectrum-bar",
            active ? "spectrum-bar-active bg-[var(--ds-spectrum-bar)]" : "bg-neutral-500 opacity-60"
          )}
          style={active ? { animationDelay: delay } : undefined}
        />
      ))}
    </span>
  );
}
