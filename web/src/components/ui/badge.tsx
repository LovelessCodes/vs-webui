import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
  {
    variants: {
      variant: {
        default: "border-border-default bg-bg-elevated text-text-secondary",
        outline: "border-border-default text-text-secondary",
        success: "border-success/40 bg-success/10 text-success",
        warning: "border-warning/40 bg-warning/10 text-warning",
        error: "border-error/40 bg-error/10 text-error",
        accent: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
        amber: "border-accent-amber/40 bg-accent-amber/10 text-accent-amber",
        info: "border-info/40 bg-info/10 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
