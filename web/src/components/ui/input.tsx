import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-none border border-border-default bg-bg-input px-2.5 text-xs text-text-primary transition-colors placeholder:text-text-muted focus:border-accent-primary/60 focus:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
