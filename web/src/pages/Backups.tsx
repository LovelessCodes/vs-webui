import { Archive, Download, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatBytes } from "@/lib/format";
import { cn } from "cn";

export default function Backups() {
  const { t } = useTranslation();
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
    <ScrollArea className="h-full" scrollFade>
      <div className="flex flex-col gap-4 pb-4 pr-1">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Archive className="size-4 text-muted-foreground" />
              {t("backups.title")}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate("server")}
                size="sm"
                variant="accent-primary"
              >
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("backups.backupServer")}
              </Button>
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate("mods")}
                size="sm"
                variant="outline"
              >
                <Plus />
                {t("backups.backupMods")}
              </Button>
            </div>
          </div>
          <CardDescription>{t("backups.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {mutationError && <p className="text-error text-xs">{errorMessage(mutationError)}</p>}

          {backups.isLoading && !backups.data && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("backups.loading")}
            </div>
          )}
          {backups.isError && <p className="text-error text-xs">{errorMessage(backups.error)}</p>}

          {backups.data && backups.data.backups.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("backups.noBackups")}</p>
          )}

          {backups.data && backups.data.backups.length > 0 && (
            <div className="border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                <span className="flex-1">{t("backups.backup")}</span>
                <span className="hidden w-20 text-right sm:block">{t("backups.size")}</span>
                <span className="hidden w-40 sm:block">{t("backups.createdAt")}</span>
                <span className="w-56 text-right">{t("backups.actions")}</span>
              </div>
              <div className="divide-y divide-border">
                {backups.data.backups.map((backup) => {
                  const isMods = backup.name.startsWith("mods-");
                  const confirming = confirm?.name === backup.name;
                  return (
                    <div
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                      key={backup.name}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-mono text-[11px]">{backup.name}</span>
                        <Badge variant={isMods ? "info" : "outline"}>
                          {isMods ? t("backups.modsBadge") : t("backups.serverBadge")}
                        </Badge>
                      </div>
                      <span className="hidden w-20 text-right font-mono text-[11px] text-muted-foreground sm:block">
                        {formatBytes(backup.size)}
                      </span>
                      <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                        {new Date(backup.modified * 1000).toLocaleString()}
                      </span>
                      <div className="flex w-56 shrink-0 items-center justify-end gap-1.5">
                        {confirming ? (
                          <>
                            <span className="text-[11px] text-muted-foreground">
                              {confirm?.action === "restore"
                                ? t("backups.restoreQuestion")
                                : t("backups.deleteQuestion")}
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
                              {t("common.yes")}
                            </Button>
                            <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                              {t("common.cancel")}
                            </Button>
                          </>
                        ) : (
                          <>
                            <a
                              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                              href={`/api/backups/${encodeURIComponent(backup.name)}/download`}
                              title={t("common.download")}
                            >
                              <Download />
                            </a>
                            <Button
                              disabled={running}
                              onClick={() => setConfirm({ name: backup.name, action: "restore" })}
                              size="icon-sm"
                              title={
                                running ? t("backups.stopToRestore") : t("backups.restoreTitle")
                              }
                              variant="ghost"
                            >
                              <RotateCcw />
                            </Button>
                            <Button
                              onClick={() => setConfirm({ name: backup.name, action: "delete" })}
                              size="icon-sm"
                              title={t("backups.deleteTitle")}
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

          <p className="text-[11px] text-muted-foreground">{t("backups.footer")}</p>
        </CardContent>
      </Card>
      </div>
    </ScrollArea>
  );
}
