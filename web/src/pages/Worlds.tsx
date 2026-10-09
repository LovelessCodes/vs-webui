import {
  AlertTriangle,
  Download,
  FileJson2,
  HardDrive,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import CreateWorldSheet from "@/components/worlds/CreateWorldSheet";
import WorldConfigSheet from "@/components/worlds/WorldConfigSheet";
import {
  useActivateSave,
  useDeleteSave,
  useSaves,
  useStatus,
  useUploadSave,
} from "@/hooks/use-api";
import { errorMessage, formatBytes } from "@/lib/format";
import { cn } from "cn";

export default function Worlds() {
  const { t } = useTranslation();
  const saves = useSaves();
  const status = useStatus();
  const upload = useUploadSave();
  const activate = useActivateSave();
  const remove = useDeleteSave();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const running = status.data?.status.status === "running";
  const mutationError = activate.error ?? remove.error ?? upload.error;

  return (
    <ScrollArea className="h-full" scrollFade>
      <div className="flex flex-col gap-4 pb-4 pr-1">
        {running && (
          <Alert>
            <AlertTriangle />
            <AlertDescription>{t("worlds.stopHint")}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-muted-foreground" />
                {t("worlds.title")}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  accept=".vcdbs,.zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload.mutate(file);
                    event.target.value = "";
                  }}
                  ref={fileInput}
                  type="file"
                />
                <Button
                  disabled={running}
                  onClick={() => setCreateOpen(true)}
                  size="sm"
                  variant="accent-primary"
                >
                  <Plus />
                  {t("worlds.create")}
                </Button>
                <Button
                  disabled={running || upload.isPending}
                  onClick={() => fileInput.current?.click()}
                  size="sm"
                  variant="outline"
                >
                  {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                  {t("worlds.upload")}
                </Button>
              </div>
            </div>
            <CardDescription>{t("worlds.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {mutationError && <p className="text-error text-xs">{errorMessage(mutationError)}</p>}

            {saves.isLoading && !saves.data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("worlds.loading")}
              </div>
            )}
            {saves.isError && <p className="text-error text-xs">{errorMessage(saves.error)}</p>}

            {saves.data && saves.data.saves.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 border border-dashed p-10 text-center">
                <HardDrive className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">{t("worlds.empty")}</p>
                <p className="text-muted-foreground text-xs">{t("worlds.emptyHint")}</p>
              </div>
            )}

            {saves.data && saves.data.saves.length > 0 && (
              <div className="border border-border">
                <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                  <span className="flex-1">{t("worlds.title")}</span>
                  <span className="hidden w-20 text-right sm:block">{t("worlds.size")}</span>
                  <span className="hidden w-40 sm:block">{t("worlds.modified")}</span>
                  <span className="w-64 text-right">{t("worlds.actions")}</span>
                </div>
                <div className="divide-y divide-border">
                  {saves.data.saves.map((save) => {
                    const confirming = confirm === save.name;
                    return (
                      <div
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                        key={save.name}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-xs font-medium">{save.name}</span>
                          {save.active && (
                            <Badge variant="accent">{t("worlds.active")}</Badge>
                          )}
                          {save.pending && (
                            <Badge variant="warning">{t("worlds.pending")}</Badge>
                          )}
                          {save.legacy && (
                            <Badge variant="outline">{t("worlds.legacy")}</Badge>
                          )}
                        </div>
                        <span className="hidden w-20 text-right font-mono text-[11px] text-muted-foreground sm:block">
                          {save.pending ? "—" : formatBytes(save.size)}
                        </span>
                        <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                          {save.pending
                            ? "—"
                            : new Date(save.modified * 1000).toLocaleString()}
                        </span>
                        <div className="flex w-64 shrink-0 items-center justify-end gap-1.5">
                          {confirming ? (
                            <>
                              <span className="text-muted-foreground text-[11px]">
                                {t("worlds.deleteQuestion")}
                              </span>
                              <Button
                                disabled={remove.isPending}
                                onClick={() =>
                                  remove.mutate(save.name, {
                                    onSuccess: () => setConfirm(null),
                                  })
                                }
                                size="sm"
                                variant="destructive"
                              >
                                {t("common.yes")}
                              </Button>
                              <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                                {t("common.cancel")}
                              </Button>
                            </>
                          ) : (
                            <>
                              {save.active && (
                                <Button
                                  onClick={() => setConfigFor(save.name)}
                                  size="icon-sm"
                                  title={t("worlds.settings")}
                                  variant="ghost"
                                >
                                  <FileJson2 />
                                </Button>
                              )}
                              {!save.pending && (
                                <a
                                  className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                                  href={`/api/saves/${encodeURIComponent(save.name)}/download`}
                                  title={t("common.download")}
                                >
                                  <Download />
                                </a>
                              )}
                              {!save.active && (
                                <Button
                                  disabled={running || activate.isPending}
                                  onClick={() => activate.mutate(save.name)}
                                  size="sm"
                                  variant="outline"
                                >
                                  {t("worlds.setActive")}
                                </Button>
                              )}
                              {!save.pending && (
                                <Button
                                  disabled={running}
                                  onClick={() => setConfirm(save.name)}
                                  size="icon-sm"
                                  title={running ? t("worlds.stopHint") : t("worlds.deleteTitle")}
                                  variant="ghost"
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">{t("worlds.uploadHint")}</p>
          </CardContent>
        </Card>

        <WorldConfigSheet name={configFor} onClose={() => setConfigFor(null)} />
        <CreateWorldSheet onOpenChange={setCreateOpen} open={createOpen} />
      </div>
    </ScrollArea>
  );
}
