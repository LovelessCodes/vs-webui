import { Check, Download, Loader2, PackagePlus, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { useModJobs } from "@/hooks/use-api";
import type { ModJob } from "@/lib/api";
import { formatBytes } from "@/lib/format";

function actionIcon(job: ModJob) {
  if (job.status === "done") return <Check className="size-3.5 text-success" />;
  if (job.status === "error") return <TriangleAlert className="size-3.5 text-error" />;
  if (job.action === "remove") return <Trash2 className="size-3.5 text-text-secondary" />;
  if (job.action === "update") return <Download className="size-3.5 text-info" />;
  return <PackagePlus className="size-3.5 text-accent-primary" />;
}

function JobRow({ job }: { job: ModJob }) {
  const { t } = useTranslation();
  const active = job.status === "queued" || job.status === "running";
  const percent =
    job.total > 0
      ? Math.min(100, Math.round((job.progress / job.total) * 100))
      : active
        ? 5
        : 100;

  return (
    <div className="grid gap-1.5 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        {job.status === "running" ? (
          <Loader2 className="size-3.5 animate-spin text-accent-primary" />
        ) : (
          actionIcon(job)
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{job.name}</span>
          <span className="text-text-muted">
            {" "}
            ·{" "}
            {t(
              job.action === "install"
                ? "mods.jobInstall"
                : job.action === "update"
                  ? "mods.jobUpdate"
                  : "mods.jobRemove",
            )}
          </span>
          {job.version && <span className="text-text-muted"> {job.version}</span>}
        </span>
        {job.dependency && <Badge variant="outline">{t("mods.dependency")}</Badge>}
        <span className="text-text-muted">
          {job.status === "running"
            ? job.total > 0
              ? `${percent}%`
              : t("common.working")
            : t(`mods.${job.status === "queued" ? "queued" : job.status === "done" ? "done" : "error"}`)}
        </span>
      </div>
      {job.status === "running" && job.total > 0 && (
        <div className="h-1 w-full bg-bg-input">
          <div className="h-full bg-accent-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {job.status === "error" && job.error && (
        <p className="text-error text-[11px]">{job.error}</p>
      )}
      {job.status === "running" && job.total > 0 && (
        <p className="text-text-muted text-[10px]">
          {t("mods.downloaded", {
            done: formatBytes(job.progress),
            total: formatBytes(job.total),
          })}
        </p>
      )}
    </div>
  );
}

/** Active jobs plus jobs that finished in the last minute. */
export default function ModJobsPanel() {
  const { t } = useTranslation();
  const jobs = useModJobs();
  const now = Date.now() / 1000;
  const visible = (jobs.data?.jobs ?? []).filter(
    (job) =>
      job.status === "queued" ||
      job.status === "running" ||
      (job.finished_at !== null && job.finished_at > now - 60),
  );

  if (visible.length === 0) return null;

  return (
    <div className="border border-border-default bg-bg-card">
      <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
        {t("mods.modJobs")}
      </div>
      <div className="divide-y divide-border-subtle">
        {visible.map((job) => (
          <JobRow job={job} key={job.id} />
        ))}
      </div>
    </div>
  );
}
