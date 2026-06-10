import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type TextVariant = "h1" | "h2" | "h3" | "body" | "caption" | "mono" | "label";
export type TextColor = "primary" | "secondary" | "muted" | "subtle" | "brand" | "success" | "inverse";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  color?: TextColor;
  as?: "p" | "span" | "h1" | "h2" | "h3" | "h4" | "label" | "div";
  children?: ReactNode;
}

const variantStyles: Record<TextVariant, string> = {
  h1: "text-xl sm:text-2xl font-black tracking-wider",
  h2: "text-base font-black tracking-wide",
  h3: "text-xs font-black",
  body: "text-xs leading-relaxed",
  caption: "text-[10px] leading-normal",
  mono: "text-[10px] font-mono tracking-wider",
  label: "text-[10px] font-bold",
};

const colorStyles: Record<TextColor, string> = {
  primary: "text-neutral-100",
  secondary: "text-neutral-200",
  muted: "text-neutral-400",
  subtle: "text-neutral-500",
  brand: "text-text-brand",
  success: "text-success-400",
  inverse: "text-white",
};

export function Text({
  variant = "body",
  color = "primary",
  as: Component = "p",
  className,
  children,
  ...props
}: TextProps) {
  return (
    <Component
      className={cn(variantStyles[variant], colorStyles[color], className)}
      {...props}
    >
      {children}
    </Component>
  );
}
