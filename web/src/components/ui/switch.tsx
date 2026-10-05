import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors",
        checked ? "border-accent-primary bg-accent-primary/80" : "border-border-default bg-bg-input",
        disabled && "pointer-events-none opacity-50",
      )}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "absolute size-3.5 bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
