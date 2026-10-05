import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useInstallMod, useModJobs, useRemoveMod } from "@/hooks/use-api";
import type { ModScanError } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import type { MissingDependency } from "@/lib/version";

export function BrokenModsBanner({ errors }: { errors: ModScanError[] }) {
  const remove = useRemoveMod();
  const [confirmFile, setConfirmFile] = useState<string | null>(null);

  if (errors.length === 0) return null;

  return (
    <div className="border border-warning/40 bg-warning/5">
      <div className="flex items-center gap-2 border-b border-warning/30 px-3 py-2 text-xs">
        <AlertTriangle className="size-3.5 text-warning" />
        <span className="font-medium text-warning">
          {errors.length} broken mod{errors.length > 1 ? "s" : ""}
        </span>
        <span className="text-text-secondary">— unreadable zip or missing modinfo.json</span>
      </div>
      <div className="divide-y divide-border-subtle">
        {errors.map((error) => (
          <div className="flex items-center gap-3 px-3 py-2" key={error.file}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px]">{error.file}</p>
              <p className="truncate text-[10px] text-text-muted">
                {error.stage}: {error.message}
              </p>
            </div>
            {confirmFile === error.file ? (
              <>
                <Button
                  onClick={() =>
                    remove.mutate(error.file, { onSuccess: () => setConfirmFile(null) })
                  }
                  size="sm"
                  variant="destructive"
                >
                  Really remove?
                </Button>
                <Button onClick={() => setConfirmFile(null)} size="sm" variant="ghost">
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setConfirmFile(error.file)}
                size="icon-sm"
                title="Remove file"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
      {remove.isError && (
        <p className="px-3 py-2 text-error text-[11px]">{errorMessage(remove.error)}</p>
      )}
    </div>
  );
}

export function MissingDepsBanner({ missing }: { missing: MissingDependency[] }) {
  const install = useInstallMod();
  const jobs = useModJobs();

  if (missing.length === 0) return null;

  const pending = (modid: string) =>
    (jobs.data?.jobs ?? []).some(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        job.modid.toLowerCase() === modid.toLowerCase(),
    );

  return (
    <div className="border border-info/40 bg-info/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-info/30 px-3 py-2 text-xs">
        <AlertTriangle className="size-3.5 text-info" />
        <span className="font-medium text-info">
          {missing.length} missing dependenc{missing.length > 1 ? "ies" : "y"}
        </span>
        <div className="flex-1" />
        <Button
          disabled={install.isPending}
          onClick={() => {
            for (const dep of missing) {
              install.mutate({ modid: dep.modid, constraint: dep.constraint });
            }
          }}
          size="sm"
          variant="outline-info"
        >
          <Download />
          Install all
        </Button>
      </div>
      <div className="divide-y divide-border-subtle">
        {missing.map((dep) => (
          <div className="flex items-center gap-3 px-3 py-2" key={dep.modid}>
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-mono">{dep.modid}</span>
                {dep.constraint && (
                  <span className="text-text-muted"> (≥ {dep.constraint})</span>
                )}
              </p>
              <p className="truncate text-[10px] text-text-muted">
                required by {dep.requiredBy.join(", ")}
              </p>
            </div>
            <Button
              disabled={pending(dep.modid)}
              onClick={() => install.mutate({ modid: dep.modid, constraint: dep.constraint })}
              size="sm"
              variant="outline"
            >
              {pending(dep.modid) ? "Queued…" : "Install"}
            </Button>
          </div>
        ))}
      </div>
      {install.isError && (
        <p className="px-3 py-2 text-error text-[11px]">{errorMessage(install.error)}</p>
      )}
    </div>
  );
}
