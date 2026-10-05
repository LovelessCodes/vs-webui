import { Archive, Download, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Backups() {
  const backups = useBackups();
  const status = useStatus();
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  const remove = useDeleteBackup();
  const [confirm, setConfirm] = useState<{
    name: string;
    action: "restore" | "delete";
  } | null>(null);

  const running = status.data?.status.status === "running";
  const mutationError = create.error ?? restore.error ?? remove.error;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4">
      <Card className="self-start">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Archive className="size-4 text-text-secondary" />
              Backups
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate("server")}
                size="sm"
                variant="accent-primary"
              >
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                Backup server data
              </Button>
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate("mods")}
                size="sm"
                variant="outline"
              >
                <Plus />
                Backup mods only
              </Button>
            </div>
          </div>
          <CardDescription>
            Server backups include the world, mods, configs and player data (logs and caches
            are skipped). Mods backups store just the <span className="font-mono">Mods/</span>{" "}
            folder. Mod changes also create automatic backups.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {create.isSuccess && (
            <p className="text-success text-xs">Created {create.data.name}</p>
          )}
          {mutationError && <p className="text-error text-xs">{errorMessage(mutationError)}</p>}

          {backups.isLoading && !backups.data && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              Loading backups…
            </div>
          )}
          {backups.isError && (
            <p className="text-error text-xs">{errorMessage(backups.error)}</p>
          )}

          {backups.data && backups.data.backups.length === 0 && (
            <p className="text-xs text-text-muted">No backups yet.</p>
          )}

          {backups.data && backups.data.backups.length > 0 && (
            <div className="border border-border-default">
              <div className="flex items-center gap-3 border-b border-border-default bg-bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
                <span className="flex-1">Backup</span>
                <span className="hidden w-20 text-right sm:block">Size</span>
                <span className="hidden w-40 sm:block">Created</span>
                <span className="w-56 text-right">Actions</span>
              </div>
              <div className="divide-y divide-border-subtle">
                {backups.data.backups.map((backup) => {
                  const isMods = backup.name.startsWith("mods-");
                  const confirming = confirm?.name === backup.name;
                  return (
                    <div
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-card-hover"
                      key={backup.name}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-mono text-[11px]">{backup.name}</span>
                        <Badge variant={isMods ? "info" : "default"}>
                          {isMods ? "Mods" : "Server"}
                        </Badge>
                      </div>
                      <span className="hidden w-20 text-right font-mono text-[11px] text-text-muted sm:block">
                        {formatBytes(backup.size)}
                      </span>
                      <span className="hidden w-40 font-mono text-[11px] text-text-muted sm:block">
                        {new Date(backup.modified * 1000).toLocaleString()}
                      </span>
                      <div className="flex w-56 shrink-0 items-center justify-end gap-1.5">
                        {confirming ? (
                          <>
                            <span className="text-[11px] text-text-secondary">
                              {confirm?.action === "restore" ? "Restore?" : "Delete?"}
                            </span>
                            <Button
                              disabled={restore.isPending || remove.isPending}
                              onClick={() => {
                                if (confirm?.action === "restore") {
                                  restore.mutate(backup.name, {
                                    onSuccess: () => setConfirm(null),
                                  });
                                } else {
                                  remove.mutate(backup.name, {
                                    onSuccess: () => setConfirm(null),
                                  });
                                }
                              }}
                              size="sm"
                              variant={
                                confirm?.action === "restore" ? "outline-warning" : "destructive"
                              }
                            >
                              Yes
                            </Button>
                            <Button
                              onClick={() => setConfirm(null)}
                              size="sm"
                              variant="ghost"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <a
                              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                              href={`/api/backups/${encodeURIComponent(backup.name)}/download`}
                              title="Download"
                            >
                              <Download />
                            </a>
                            <Button
                              disabled={running}
                              onClick={() => setConfirm({ name: backup.name, action: "restore" })}
                              size="icon-sm"
                              title={
                                running ? "Stop the server to restore" : "Restore this backup"
                              }
                              variant="ghost"
                            >
                              <RotateCcw />
                            </Button>
                            <Button
                              onClick={() => setConfirm({ name: backup.name, action: "delete" })}
                              size="icon-sm"
                              title="Delete"
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] text-text-muted">
            Restoring requires the server to be stopped. Server backups overwrite world, mods,
            configs and player data; mods backups only replace{" "}
            <span className="font-mono">Mods/</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
