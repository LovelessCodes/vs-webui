import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-none border border-transparent text-xs font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-1 focus-visible:ring-accent-primary/50 disabled:pointer-events-none disabled:opacity-50 active:not(:disabled):translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-border-default bg-bg-elevated text-text-primary hover:bg-bg-card-hover",
        outline:
          "border-border-default bg-transparent text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
        secondary: "bg-bg-card text-text-primary hover:bg-bg-card-hover",
        ghost: "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
        destructive:
          "border-error/40 bg-error/10 text-error hover:bg-error/20 hover:text-error",
        success: "bg-success text-white hover:bg-success/80",
        warning: "bg-warning text-bg-primary hover:bg-warning/80",
        info: "bg-info text-bg-primary hover:bg-info/80",
        "accent-primary":
          "bg-accent-primary text-white hover:bg-accent-primary-hover",
        amber: "bg-accent-amber text-bg-primary hover:bg-accent-amber-hover",
        "outline-success":
          "border-success/40 text-success hover:bg-success/10 hover:text-success",
        "outline-accent-primary":
          "border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10 hover:text-accent-primary",
        link: "text-accent-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        xs: "h-6 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
