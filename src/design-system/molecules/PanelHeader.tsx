import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";
import { Text } from "../atoms/Text";

export interface PanelHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  iconColor?: string;
  className?: string;
}

export function PanelHeader({
  icon: Icon,
  title,
  subtitle,
  action,
  iconColor = "text-primary-500",
  className,
}: PanelHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-3", className)}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className={cn("w-5 h-5", iconColor)} aria-hidden="true" /> : null}
        <div>
          <Text variant="h2" color="secondary" as="h2">
            {title}
          </Text>
          {subtitle && (
            <Text variant="caption" color="muted" as="p">
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}
