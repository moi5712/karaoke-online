import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type SurfaceVariant =
  | "default"
  | "panel"
  | "inset"
  | "muted"
  | "active"
  | "success"
  | "chip"
  | "list"
  | "spectrum";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  children?: ReactNode;
}

const variantStyles: Record<SurfaceVariant, string> = {
  default: "bg-surface-raised",
  panel: "bg-surface-panel",
  inset: "bg-surface-inset",
  muted: "bg-surface-list",
  active: "bg-surface-active",
  success: "bg-success-950",
  chip: "bg-surface-chip",
  list: "bg-surface-list",
  spectrum: "bg-surface-spectrum",
};

const paddingStyles = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const radiusStyles = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
};

/**
 * Surface — 扁平化區塊容器（原子層）
 * 用於 Card 內部的子區塊分組，禁止嵌套 Card
 */
export function Surface({
  variant = "default",
  padding = "md",
  radius = "xl",
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <div
      className={cn(
        variantStyles[variant],
        paddingStyles[padding],
        radiusStyles[radius],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
