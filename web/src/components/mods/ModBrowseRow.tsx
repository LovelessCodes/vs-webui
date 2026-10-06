import { useState } from "react";
import {
  CalendarDays,
  Check,
  CloudDownload,
  Download,
  ExternalLink,
  Heart,
  MessageSquare,
  Package,
  PackageMinus,
  PackageSearch,
  Pin,
  PinOff,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InstalledMod, ModSummary, ModUpdate } from "@/lib/api";

import { sideBadgeClass, sideKey } from "./utils";

const MAX_VISIBLE_TAGS = 4;

interface ModBrowseRowProps {
  mod: ModSummary;
  installed?: InstalledMod;
  update?: ModUpdate;
  pinned: boolean;
  favorited: boolean;
  pending: boolean;
  tagColorMap: Record<string, string>;
  activeTag: string;
  onTagClick: (tag: string) => void;
  onOpen: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onFavorite: () => void;
  onPin: () => void;
  onRemove: () => void;
  onPickVersion: () => void;
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
  pinned,
  favorited,
  pending,
  tagColorMap,
  activeTag,
  onTagClick,
  onOpen,
  onInstall,
  onUpdate,
  onFavorite,
  onPin,
  onRemove,
  onPickVersion,
}: ModBrowseRowProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const modUrl = `https://mods.vintagestory.at/${mod.urlalias ?? `show/mod/${mod.assetid}`}`;
  const hiddenTags = mod.tags.slice(MAX_VISIBLE_TAGS);
  const canUpdate = Boolean(installed && update);

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-3 border bg-card p-3 transition-colors hover:bg-muted/40",
        // Installed: green. Pinned: amber. Update waiting: purple, so a pending
        // update stands out from a plain install (Story Forge parity).
        installed &&
          !pinned &&
          !canUpdate &&
          "border-success/40 bg-linear-to-r from-success/15 to-transparent",
        installed &&
          pinned &&
          "border-accent-amber/40 bg-linear-to-r from-accent-amber/15 to-transparent",
        canUpdate && "border-accent-primary/40 bg-linear-to-r from-accent-primary/15 to-transparent",
      )}
    >
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
            title={t("mods.installedVersion", { version: installed.version })}
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

      <div className="flex shrink-0 items-center gap-1.5 self-center">
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
                    aria-label={t(favorited ? "mods.unfavorite" : "mods.favorite")}
                    onClick={onFavorite}
                    size="icon-sm"
                    variant="ghost"
                  />
                }
              >
                <Star
                  className={
                    favorited
                      ? "fill-[var(--color-accent-amber)] text-[var(--color-accent-amber)]"
                      : undefined
                  }
                />
              </TooltipTrigger>
              <TooltipContent>{t(favorited ? "mods.unfavorite" : "mods.favorite")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t("mods.openOnModDB")}
                    onClick={() => window.open(modUrl, "_blank", "noopener,noreferrer")}
                    size="icon-sm"
                    variant="ghost"
                  />
                }
              >
                <ExternalLink />
              </TooltipTrigger>
              <TooltipContent>{t("mods.openOnModDB")}</TooltipContent>
            </Tooltip>

            {canUpdate && installed && update ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t("mods.updateToLatest")}
                      disabled={pending}
                      onClick={onUpdate}
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
                      {installed.version} → {update.modversion}
                    </span>
                    <span>{t("mods.updateToLatest")}</span>
                  </span>
                </TooltipContent>
              </Tooltip>
            ) : installed ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t("mods.installLatest")}
                      disabled={pending}
                      onClick={onInstall}
                      size="icon-sm"
                      variant="outline"
                    />
                  }
                >
                  <CloudDownload />
                </TooltipTrigger>
                <TooltipContent>{t("mods.installLatest")}</TooltipContent>
              </Tooltip>
            )}

            {installed && (
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
                    {t(pinned ? "mods.pinnedTooltip" : "mods.pinTooltip", {
                      version: installed.version,
                    })}
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
          </>
        )}
      </div>
    </div>
  );
}
