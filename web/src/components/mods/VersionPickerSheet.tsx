import { Loader2, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useModDetail, useModJobs, useUpdateMod } from "@/hooks/use-api";
import type { InstalledMod } from "@/lib/api";
import { errorMessage, formatCount } from "@/lib/format";
import { sortReleasesDesc } from "@/lib/version";

interface VersionPickerSheetProps {
  mod: InstalledMod | null;
  onClose: () => void;
}

export default function VersionPickerSheet({ mod, onClose }: VersionPickerSheetProps) {
  const { t } = useTranslation();
  const detail = useModDetail(mod?.modid ?? null);
  const jobs = useModJobs();
  const update = useUpdateMod();

  const releases = sortReleasesDesc(detail.data?.mod.releases ?? []);
  const pending = (jobs.data?.jobs ?? []).some(
    (job) =>
      (job.status === "queued" || job.status === "running") &&
      job.modid.toLowerCase() === mod?.modid.toLowerCase(),
  );

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(mod)}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg" side="right">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center gap-3 pr-8">
            <div className="flex size-10 shrink-0 items-center justify-center border border-border bg-input/30">
              <Package className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <SheetTitle>{mod?.name ?? t("mods.versions")}</SheetTitle>
              <SheetDescription>
                {mod ? t("mods.installedVersion", { version: mod.version }) : ""}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          {detail.isLoading && (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("mods.loadingReleases")}
            </div>
          )}
          {detail.isError && (
            <p className="p-4 text-xs text-error">{errorMessage(detail.error)}</p>
          )}
          {update.isError && <p className="p-4 text-xs text-error">{errorMessage(update.error)}</p>}

          {mod && detail.data && (
            <div className="divide-y divide-border">
              {releases.slice(0, 40).map((release) => {
                const current = release.modversion === mod.version;
                return (
                  <div className="flex items-center gap-3 px-4 py-2" key={release.releaseid}>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs">{release.modversion}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {release.created?.slice(0, 10)} ·{" "}
                        {t("mods.downloads", { count: formatCount(release.downloads) })}
                      </p>
                    </div>
                    {current ? (
                      <Badge variant="success">{t("mods.current")}</Badge>
                    ) : (
                      <Button
                        disabled={pending}
                        onClick={() =>
                          update.mutate(
                            {
                              modid: mod.modid,
                              version: release.modversion,
                              file: mod.file,
                              name: mod.name,
                            },
                            { onSuccess: onClose },
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {t("common.switch")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
