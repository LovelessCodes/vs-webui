import type { LabelHTMLAttributes } from "react";

import { cn } from "cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-muted-foreground text-xs font-medium", className)} {...props} />;
}
