import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type { ModSummary } from "@/lib/api";
import { formatCount } from "@/lib/format";

import { sideBadgeClass, sideKey } from "./utils";

interface ModBrowseRowProps {
  mod: ModSummary;
  installed: boolean;
  onOpen: () => void;
}

export default function ModBrowseRow({ mod, installed, onOpen }: ModBrowseRowProps) {
  const { t } = useTranslation();
  return (
    <button
      className="flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40"
      onClick={onOpen}
      type="button"
    >
      <div className="flex size-10 shrink-0 items-center justify-center border border-border bg-input/30">
        {mod.logo ? (
          <img alt="" className="size-full object-cover" loading="lazy" src={mod.logo} />
        ) : (
          <Package className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{mod.name}</span>
          {installed && <Badge variant="success">{t("mods.installedBadge")}</Badge>}
          <Badge className={sideBadgeClass(mod.side)} variant="outline">
            {t(sideKey(mod.side))}
          </Badge>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {mod.author} — {mod.summary}
        </p>
        {mod.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {mod.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] text-muted-foreground">
          {t("mods.downloads", { count: formatCount(mod.downloads) })}
        </p>
      </div>
    </button>
  );
}
