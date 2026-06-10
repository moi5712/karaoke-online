import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type CardVariant = "default" | "panel" | "inset" | "active" | "success" | "muted";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "xl" | "2xl" | "3xl";
  children?: ReactNode;
}

const variantStyles: Record<CardVariant, string> = {
  default: "bg-surface-raised",
  panel: "bg-surface-panel",
  inset: "bg-surface-inset",
  active: "bg-success-950",
  success: "bg-success-950",
  muted: "bg-surface-list",
};

const paddingStyles = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const radiusStyles = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
};

/**
 * Card — 頂層面板容器（分子層）
 * 僅用於頁面級區塊，內部子區塊請使用 Surface
 */
export function Card({
  variant = "default",
  padding = "md",
  radius = "3xl",
  className,
  children,
  ...props
}: CardProps) {
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
