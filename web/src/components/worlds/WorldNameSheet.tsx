import { Copy, Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDuplicateSave, useRenameSave } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";

/** Duplicate or rename a world (server must be stopped). */
export default function WorldNameSheet({
  mode,
  world,
  onClose,
}: {
  mode: "duplicate" | "rename" | null;
  world: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const duplicate = useDuplicateSave();
  const rename = useRenameSave();
  const [name, setName] = useState("");

  useEffect(() => {
    if (mode === "duplicate" && world) {
      setName(`${world} copy`);
    } else if (mode === "rename" && world) {
      setName(world);
    }
  }, [mode, world]);

  const open = Boolean(mode && world);
  const pending = duplicate.isPending || rename.isPending;
  const error = duplicate.error ?? rename.error;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || !world) return;
    const done = { onSuccess: () => onClose() };
    if (mode === "duplicate") {
      duplicate.mutate({ name: world, newName: trimmed }, done);
    } else {
      rename.mutate({ name: world, newName: trimmed }, done);
    }
  }

  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-sm" side="right">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            {mode === "rename" ? (
              <Pencil className="size-4 text-muted-foreground" />
            ) : (
              <Copy className="size-4 text-muted-foreground" />
            )}
            {mode === "rename"
              ? t("worlds.renameTitle", { name: world })
              : t("worlds.duplicateTitle", { name: world })}
          </SheetTitle>
          <SheetDescription>
            {mode === "rename"
              ? t("worlds.renameDescription")
              : t("worlds.duplicateDescription")}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="world-new-name">{t("worlds.nameLabel")}</Label>
            <Input
              autoFocus
              id="world-new-name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              value={name}
            />
          </div>

          {error && <p className="text-error text-xs">{errorMessage(error)}</p>}

          <Button
            disabled={!name.trim() || pending}
            onClick={submit}
            variant="accent-primary"
          >
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : mode === "rename" ? (
              <Pencil />
            ) : (
              <Copy />
            )}
            {mode === "rename" ? t("worlds.rename") : t("worlds.duplicate")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
