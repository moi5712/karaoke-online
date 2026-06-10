import { Moon, Sun } from "lucide-react";
import { IconButton } from "./IconButton";
import { useTheme } from "../theme/ThemeProvider";
import { cn } from "../utils/cn";

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <IconButton
      id="btn-theme-toggle"
      variant="secondary"
      size="sm"
      className={cn("text-text-muted hover:text-text-primary", className)}
      onClick={toggleTheme}
      title={isDark ? "切換淺色模式" : "切換深色模式"}
      aria-label={isDark ? "切換淺色模式" : "切換深色模式"}
      aria-pressed={isDark}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </IconButton>
  );
}
