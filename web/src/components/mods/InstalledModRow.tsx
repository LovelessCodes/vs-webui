import { useState } from "react";
import { CloudDownload, Loader2, PackageMinus, PackageSearch, Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InstalledMod, ModUpdate } from "@/lib/api";

interface InstalledModRowProps {
  mod: InstalledMod;
  update?: ModUpdate;
  pinned: boolean;
  pending: boolean;
  onPin: () => void;
  onRemove: () => void;
  onUpdate: (version: string) => void;
  onPickVersion: () => void;
}

export default function InstalledModRow({
  mod,
  update,
  pinned,
  pending,
  onPin,
  onRemove,
  onUpdate,
  onPickVersion,
}: InstalledModRowProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const dependencyCount = Object.keys(mod.dependencies).length;
  const canUpdate = Boolean(update) && !pinned;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40",
        // Pinned: amber. Update waiting: purple. Plain install: green.
        pinned && "border-accent-amber/40 bg-linear-to-r from-accent-amber/15 to-transparent",
        canUpdate && "border-accent-primary/40 bg-linear-to-r from-accent-primary/15 to-transparent",
        !pinned && !canUpdate && "border-success/40 bg-linear-to-r from-success/15 to-transparent",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{mod.name}</span>
          {pinned && <Badge variant="amber">{t("mods.pinned")}</Badge>}
          {canUpdate && update && (
            <Badge variant="accent">{t("mods.updateBadge", { version: update.modversion })}</Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {mod.authors.join(", ")} · <span className="font-mono">{mod.version}</span>
          {dependencyCount > 0 && (
            <span> · {t("mods.dependencyCount", { count: dependencyCount })}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}

        {canUpdate && update && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={t("mods.updateToLatest")}
                  disabled={pending}
                  onClick={() => onUpdate(update.modversion)}
                  size="icon-sm"
                  variant="outline-accent-primary"
                />
              }
            >
              <CloudDownload />
            </TooltipTrigger>
            <TooltipContent>
              <span className="grid gap-0.5">
                <span className="font-mono">
                  {mod.version} → {update.modversion}
                </span>
                <span>{t("mods.updateToLatest")}</span>
              </span>
            </TooltipContent>
          </Tooltip>
        )}

        {confirming ? (
          <>
            <Button disabled={pending} onClick={onRemove} size="sm" variant="destructive">
              {t("common.reallyRemove")}
            </Button>
            <Button onClick={() => setConfirming(false)} size="sm" variant="ghost">
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={pinned ? t("mods.unpin") : t("mods.pin")}
                    onClick={onPin}
                    size="icon-sm"
                    variant={pinned ? "outline-amber" : "outline"}
                  />
                }
              >
                {pinned ? <PinOff /> : <Pin />}
              </TooltipTrigger>
              <TooltipContent>
                {t(pinned ? "mods.pinnedTooltip" : "mods.pinTooltip", { version: mod.version })}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t("mods.versions")}
                    onClick={onPickVersion}
                    size="icon-sm"
                    variant="outline"
                  />
                }
              >
                <PackageSearch />
              </TooltipTrigger>
              <TooltipContent>{t("mods.browseVersionsTooltip")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t("common.remove")}
                    disabled={pending}
                    onClick={() => setConfirming(true)}
                    size="icon-sm"
                    variant="destructive"
                  />
                }
              >
                <PackageMinus />
              </TooltipTrigger>
              <TooltipContent>{t("mods.removeFromServer")}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
