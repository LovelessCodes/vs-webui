import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  widthClassName?: string;
}

/** Right-side sheet, Story Forge style: sharp corners, no centered dialogs. */
export function Sheet({ open, onOpenChange, children, widthClassName }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/60"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-border-default bg-bg-sidebar",
          widthClassName ?? "max-w-lg",
        )}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({
  children,
  onClose,
  className,
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          aria-label="Close"
          className="text-text-muted transition-colors hover:text-text-primary"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return <h3 className="truncate text-sm font-semibold">{children}</h3>;
}

export function SheetDescription({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 truncate text-text-secondary text-xs">{children}</p>;
}

export function SheetContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>;
}
