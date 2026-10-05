import { Download, Loader2, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useInstallMod, useModDetail, useModJobs } from "@/hooks/use-api";
import { errorMessage, formatCount } from "@/lib/format";
import { sortReleasesDesc } from "@/lib/version";

import { plainText, sideBadgeClass, sideKey } from "./utils";

interface ModDetailSheetProps {
  modid: string | null;
  onClose: () => void;
  installedVersion?: string;
}

export default function ModDetailSheet({ modid, onClose, installedVersion }: ModDetailSheetProps) {
  const { t } = useTranslation();
  const detail = useModDetail(modid);
  const jobs = useModJobs();
  const install = useInstallMod();

  const mod = detail.data?.mod;
  const pending = (jobs.data?.jobs ?? []).some(
    (job) =>
      (job.status === "queued" || job.status === "running") &&
      job.modid.toLowerCase() === modid?.toLowerCase(),
  );
  const releases = sortReleasesDesc(mod?.releases ?? []);
  const description = mod ? plainText(mod.text) : "";

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(modid)}>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center border border-border-default bg-bg-input">
            {mod?.logo ? (
              <img alt="" className="size-full object-cover" src={mod.logo} />
            ) : (
              <Package className="size-4 text-text-muted" />
            )}
          </div>
          <div className="min-w-0">
            <SheetTitle>{mod?.name ?? t("common.loading")}</SheetTitle>
            <SheetDescription>
              {mod
                ? t("mods.byAuthor", {
                    author: mod.author,
                    downloads: formatCount(mod.downloads),
                  })
                : ""}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <SheetContent>
        {detail.isLoading && (
          <div className="flex items-center gap-2 p-4 text-xs text-text-muted">
            <Loader2 className="size-4 animate-spin" />
            {t("mods.loadingDetails")}
          </div>
        )}
        {detail.isError && <p className="p-4 text-error text-xs">{errorMessage(detail.error)}</p>}

        {mod && (
          <div className="grid gap-4 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={sideBadgeClass(mod.side)} variant="outline">
                {t(sideKey(mod.side))}
              </Badge>
              <Badge variant="outline">{mod.type}</Badge>
              {mod.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>

            {description && (
              <p className="max-h-40 overflow-y-auto text-text-secondary text-xs leading-relaxed">
                {description}
              </p>
            )}

            {install.isError && <p className="text-error text-xs">{errorMessage(install.error)}</p>}

            <div className="border border-border-default">
              <div className="border-b border-border-default bg-bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
                {t("mods.releases", { count: releases.length })}
              </div>
              <div className="max-h-96 divide-y divide-border-subtle overflow-y-auto">
                {releases.slice(0, 40).map((release) => {
                  const isInstalled = installedVersion === release.modversion;
                  return (
                    <div className="flex items-center gap-3 px-3 py-2" key={release.releaseid}>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs">{release.modversion}</p>
                        <p className="text-[10px] text-text-muted">
                          {release.created?.slice(0, 10)} ·{" "}
                          {t("mods.downloads", { count: formatCount(release.downloads) })}
                        </p>
                      </div>
                      {isInstalled ? (
                        <Badge variant="success">{t("mods.installedBadge")}</Badge>
                      ) : (
                        <Button
                          disabled={pending}
                          onClick={() =>
                            install.mutate(
                              {
                                modid: String(mod.modid),
                                version: release.modversion,
                                name: mod.name,
                              },
                              { onSuccess: onClose },
                            )
                          }
                          size="sm"
                          variant="outline"
                        >
                          <Download />
                          {t("common.install")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
