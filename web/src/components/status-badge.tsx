import { cn } from "@/lib/utils";
import type { ServerStatus } from "@/lib/api";

export function statusMeta(status: ServerStatus["status"] | undefined): {
  label: string;
  dot: string;
  text: string;
} {
  switch (status) {
    case "running":
      return { label: "Running", dot: "bg-success", text: "text-success" };
    case "starting":
      return { label: "Starting", dot: "bg-warning", text: "text-warning" };
    case "stopping":
      return { label: "Stopping", dot: "bg-warning", text: "text-warning" };
    case "crashed":
      return { label: "Crashed", dot: "bg-error", text: "text-error" };
    case "not_installed":
      return { label: "Not installed", dot: "bg-text-muted", text: "text-text-muted" };
    case "stopped":
      return { label: "Stopped", dot: "bg-text-muted", text: "text-text-secondary" };
    default:
      return { label: "Unknown", dot: "bg-text-muted", text: "text-text-muted" };
  }
}

export function StatusDot({
  status,
  className,
}: {
  status: ServerStatus["status"] | undefined;
  className?: string;
}) {
  const meta = statusMeta(status);
  const pulse = status === "starting" || status === "stopping" || status === "running";
  return (
    <span className={cn("relative flex size-2 shrink-0", className)}>
      {pulse && (
        <span
          className={cn("absolute inline-flex h-full w-full animate-ping opacity-50", meta.dot)}
        />
      )}
      <span className={cn("relative inline-flex size-2", meta.dot)} />
    </span>
  );
}
