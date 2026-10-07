import { Megaphone, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useServerCommand } from "@/hooks/use-api";

/** Sends `/announce <message>` to the running server. */
export default function AnnounceSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const command = useServerCommand();
  const [message, setMessage] = useState("");

  const send = () => {
    const text = message.trim();
    if (!text) return;
    command.mutate(`/announce ${text}`, {
      onSuccess: () => {
        setMessage("");
        onOpenChange(false);
      },
    });
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-sm" side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Megaphone className="size-4 text-muted-foreground" />
            {t("dashboard.announce")}
          </SheetTitle>
          <SheetDescription>{t("dashboard.announceDescription")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 p-4">
          <Input
            autoFocus
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder={t("dashboard.announcePlaceholder")}
            value={message}
          />
          <Button
            disabled={!message.trim() || command.isPending}
            onClick={send}
            variant="accent-primary"
          >
            <Send />
            {t("dashboard.announceSend")}
          </Button>
          {command.error && (
            <p className="text-error text-xs">{String(command.error.message ?? command.error)}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
