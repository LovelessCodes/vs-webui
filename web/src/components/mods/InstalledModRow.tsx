import { History, Loader2, Star, StarOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{mod.name}</span>
          {pinned && <Badge variant="amber">{t("mods.pinned")}</Badge>}
          {update && !pinned && (
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
        {pending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("common.working")}
          </span>
        ) : (
          update &&
          !pinned && (
            <Button
              onClick={() => onUpdate(update.modversion)}
              size="sm"
              variant="accent-primary"
            >
              {t("common.update")}
            </Button>
          )
        )}

        {confirming ? (
          <>
            <Button onClick={onRemove} size="sm" variant="destructive">
              {t("common.reallyRemove")}
            </Button>
            <Button onClick={() => setConfirming(false)} size="sm" variant="ghost">
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={onPin}
              size="icon-sm"
              title={pinned ? t("mods.unpin") : t("mods.pin")}
              variant="ghost"
            >
              {pinned ? <StarOff /> : <Star />}
            </Button>
            <Button
              onClick={onPickVersion}
              size="icon-sm"
              title={t("mods.versions")}
              variant="ghost"
            >
              <History />
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              size="icon-sm"
              title={t("common.remove")}
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
