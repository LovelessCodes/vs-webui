import { CalendarDays, Check, Download, Heart, MessageSquare, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InstalledMod, ModSummary, ModUpdate } from "@/lib/api";

import { sideBadgeClass, sideKey } from "./utils";

const MAX_VISIBLE_TAGS = 5;

interface ModBrowseRowProps {
  mod: ModSummary;
  installed?: InstalledMod;
  update?: ModUpdate;
  tagColorMap: Record<string, string>;
  activeTag: string;
  onTagClick: (tag: string) => void;
  onOpen: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}

function TagChip({
  name,
  color,
  active,
  onClick,
}: {
  name: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center border px-1.5 py-px text-[10px] leading-relaxed font-medium transition-opacity hover:opacity-80",
        active && "ring-1 ring-primary",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={
        color
          ? {
              backgroundColor: `${color}20`,
              borderColor: `${color}50`,
              color,
            }
          : undefined
      }
      type="button"
    >
      {name}
    </button>
  );
}

export default function ModBrowseRow({
  mod,
  installed,
  update,
  tagColorMap,
  activeTag,
  onTagClick,
  onOpen,
  onInstall,
  onUpdate,
}: ModBrowseRowProps) {
  const { t } = useTranslation();
  const modUrl = `https://mods.vintagestory.at/${mod.urlalias ?? `show/mod/${mod.assetid}`}`;
  const hiddenTags = mod.tags.slice(MAX_VISIBLE_TAGS);

  return (
    <div className="flex min-w-0 items-start gap-3 p-3 transition-colors hover:bg-muted/40">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <a href={modUrl} rel="noreferrer" target="_blank">
          <div className="flex size-12 items-center justify-center border border-border bg-muted">
            {mod.logo ? (
              <img
                alt={mod.name}
                className="size-full object-cover transition-transform hover:scale-105"
                loading="lazy"
                src={mod.logo}
              />
            ) : (
              <Package className="size-4 text-muted-foreground" />
            )}
          </div>
        </a>
        {installed && (
          <Badge
            className="gap-1 border-success/40 px-1.5 text-[10px] text-success"
            variant="outline"
          >
            <Check className="size-3" />v{installed.version}
          </Badge>
        )}
      </div>

      <button className="min-w-0 flex-1 text-left" onClick={onOpen} type="button">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{mod.name}</h3>
          <Badge className={sideBadgeClass(mod.side)} variant="outline">
            {t(sideKey(mod.side))}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {mod.author} — {mod.summary}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Download className="size-3" />
            {mod.downloads.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="size-3" />
            {mod.follows.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" />
            {mod.comments.toLocaleString()}
          </span>
          {mod.lastreleased && (
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3" />
              {mod.lastreleased.slice(0, 10)}
            </span>
          )}
        </div>
        {mod.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {mod.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
              <TagChip
                active={activeTag === tag}
                color={tagColorMap[tag]}
                key={tag}
                name={tag}
                onClick={() => onTagClick(tag)}
              />
            ))}
            {hiddenTags.length > 0 && (
              <span
                className="inline-flex cursor-default items-center border border-dashed border-border px-1.5 py-px text-[10px] leading-relaxed font-medium text-muted-foreground"
                title={hiddenTags.join(", ")}
              >
                +{hiddenTags.length}
              </span>
            )}
          </div>
        )}
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {update ? (
          <Button onClick={onUpdate} size="sm" variant="accent-primary">
            {t("common.update")} → {update.modversion}
          </Button>
        ) : installed ? (
          <Badge variant="success">{t("mods.installedBadge")}</Badge>
        ) : (
          <Button onClick={onInstall} size="sm" variant="outline-accent-primary">
            <Download />
            {t("common.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
