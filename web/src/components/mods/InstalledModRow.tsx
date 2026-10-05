import { History, Loader2, Star, StarOff, Trash2 } from "lucide-react";
import { useState } from "react";

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
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-card-hover">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{mod.name}</span>
          {pinned && <Badge variant="amber">Pinned</Badge>}
          {update && !pinned && (
            <Badge variant="accent">→ {update.modversion}</Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-text-muted">
          {mod.authors.join(", ")} · <span className="font-mono">{mod.version}</span>
          {Object.keys(mod.dependencies).length > 0 && (
            <span> · {Object.keys(mod.dependencies).length} dependencies</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {pending ? (
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Loader2 className="size-3.5 animate-spin" />
            Working…
          </span>
        ) : (
          update &&
          !pinned && (
            <Button
              onClick={() => onUpdate(update.modversion)}
              size="sm"
              variant="accent-primary"
            >
              Update
            </Button>
          )
        )}

        {confirming ? (
          <>
            <Button onClick={onRemove} size="sm" variant="destructive">
              Really remove?
            </Button>
            <Button onClick={() => setConfirming(false)} size="sm" variant="ghost">
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={onPin}
              size="icon-sm"
              title={pinned ? "Unpin (include in updates)" : "Pin (skip updates)"}
              variant="ghost"
            >
              {pinned ? <StarOff /> : <Star />}
            </Button>
            <Button
              onClick={onPickVersion}
              size="icon-sm"
              title="Versions"
              variant="ghost"
            >
              <History />
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              size="icon-sm"
              title="Remove"
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
