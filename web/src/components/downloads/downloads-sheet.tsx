import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, PackagePlus, Trash2, TriangleAlert, Download } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import ProgressBar from "@/components/common/ProgressBar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useModJobs } from "@/hooks/use-api";
import type { ModJob } from "@/lib/api";
import { formatBytes } from "@/lib/format";

interface DownloadsSheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeCount: number;
}

const DownloadsSheetContext = createContext<DownloadsSheetContextValue>({
  open: false,
  setOpen: () => {},
  activeCount: 0,
});

export function useDownloadsSheet() {
  return useContext(DownloadsSheetContext);
}

function actionIcon(job: ModJob) {
  if (job.status === "done") return <Check className="size-3.5 text-success" />;
  if (job.status === "error") return <TriangleAlert className="size-3.5 text-destructive" />;
  if (job.action === "remove") return <Trash2 className="size-3.5 text-muted-foreground" />;
  if (job.action === "update") return <Download className="size-3.5 text-info" />;
  return <PackagePlus className="size-3.5 text-accent-primary" />;
}

function statusLabel(job: ModJob): string {
  switch (job.status) {
    case "queued":
      return "mods.queued";
    case "done":
      return "mods.done";
    case "error":
      return "mods.error";
    default:
      return "common.working";
  }
}

function JobRow({ job }: { job: ModJob }) {
  const { t } = useTranslation();
  const active = job.status === "queued" || job.status === "running";
  const percent = job.total > 0 ? Math.round((job.progress / job.total) * 100) : null;

  return (
    <li className="grid gap-2 border-b border-border p-3 last:border-b-0">
      <div className="flex items-center gap-2">
        {job.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-primary" />
        ) : (
          <span className="shrink-0">{actionIcon(job)}</span>
        )}
        <span className="truncate text-xs font-medium">{job.name}</span>
        {job.version && (
          <span className="truncate text-[11px] text-muted-foreground">→ {job.version}</span>
        )}
        {job.dependency && (
          <Badge className="h-4 shrink-0 px-1.5 text-[10px]" variant="outline">
            {t("mods.dependency")}
          </Badge>
        )}
        <Badge className="ml-auto h-4 shrink-0 px-1.5 text-[10px]" variant="secondary">
          {t(statusLabel(job))}
        </Badge>
      </div>

      {job.status === "running" && (
        <>
          <ProgressBar
            indeterminate={job.total === 0}
            max={job.total || 1}
            showPercentage={false}
            value={job.progress}
          />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span>{percent !== null ? `${percent}%` : t("common.working")}</span>
            {job.total > 0 && (
              <span>
                {formatBytes(job.progress)} / {formatBytes(job.total)}
              </span>
            )}
          </div>
        </>
      )}

      {job.status === "error" && job.error && (
        <p className="truncate text-[11px] text-destructive">{job.error}</p>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {t(
            job.action === "install"
              ? "mods.jobInstall"
              : job.action === "update"
                ? "mods.jobUpdate"
                : "mods.jobRemove",
          )}
        </span>
        {!active && <span className="ml-auto">{job.status === "done" ? "✓" : ""}</span>}
      </div>
    </li>
  );
}

function DownloadsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const jobs = useModJobs();
  const now = Date.now() / 1000;
  const visible = (jobs.data?.jobs ?? []).filter(
    (job) =>
      job.status === "queued" ||
      job.status === "running" ||
      (job.finished_at !== null && job.finished_at > now - 60),
  );

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b">
          <SheetTitle>{t("downloads.title")}</SheetTitle>
          <SheetDescription>{t("downloads.description")}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1" scrollFade>
          {visible.length === 0 ? (
            <p className="p-6 text-xs text-muted-foreground">{t("downloads.empty")}</p>
          ) : (
            <ul className="divide-y-0">
              {visible.map((job) => (
                <JobRow job={job} key={job.id} />
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Provides the Downloads sheet and a shared trigger. Keeps the mod lists fresh
 * when the last active job finishes, wherever the user is in the app.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const jobs = useModJobs();
  const queryClient = useQueryClient();
  const activeCount = (jobs.data?.jobs ?? []).filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;

  const previousActive = useRef(0);
  useEffect(() => {
    if (previousActive.current > 0 && activeCount === 0) {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
    }
    previousActive.current = activeCount;
  }, [activeCount, queryClient]);

  return (
    <DownloadsSheetContext.Provider value={{ open, setOpen, activeCount }}>
      {children}
      <DownloadsSheet onOpenChange={setOpen} open={open} />
    </DownloadsSheetContext.Provider>
  );
}
