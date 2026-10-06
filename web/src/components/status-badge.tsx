import { cn } from "cn";
import type { ServerStatus } from "@/lib/api";

export function statusMeta(status: ServerStatus["status"] | undefined): {
  labelKey: string;
  dot: string;
  text: string;
} {
  switch (status) {
    case "running":
      return { labelKey: "status.running", dot: "bg-success", text: "text-success" };
    case "starting":
      return { labelKey: "status.starting", dot: "bg-warning", text: "text-warning" };
    case "stopping":
      return { labelKey: "status.stopping", dot: "bg-warning", text: "text-warning" };
    case "crashed":
      return { labelKey: "status.crashed", dot: "bg-error", text: "text-error" };
    case "not_installed":
      return {
        labelKey: "status.notInstalled",
        dot: "bg-text-muted",
        text: "text-muted-foreground",
      };
    case "stopped":
      return { labelKey: "status.stopped", dot: "bg-text-muted", text: "text-muted-foreground" };
    default:
      return { labelKey: "status.unknown", dot: "bg-text-muted", text: "text-muted-foreground" };
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
