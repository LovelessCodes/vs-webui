import { AlertTriangle, Bell, Check, Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useClearNotifications,
  useMarkNotificationsRead,
  useNotifications,
  useStatus,
} from "@/hooks/use-api";
import { formatDuration } from "@/lib/format";
import { cn } from "cn";

const severityIcon = {
  error: { icon: AlertTriangle, className: "text-error" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  info: { icon: Info, className: "text-muted-foreground" },
} as const;

/** Bell menu with the persistent notification history. */
export default function NotificationBell() {
  const { t } = useTranslation();
  const status = useStatus();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const notifications = useNotifications(open);
  const markRead = useMarkNotificationsRead();
  const clear = useClearNotifications();

  const unread = status.data?.unread_notifications ?? 0;
  const entries = notifications.data?.notifications ?? [];

  return (
    <>
      <Button
        aria-label={t("notifications.title")}
        className="relative text-muted-foreground"
        onClick={() => setOpen(true)}
        size="icon-sm"
        title={t("notifications.title")}
        variant="ghost"
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center bg-error px-0.5 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      <Sheet
        onOpenChange={(next) => {
          setOpen(next);
          setConfirmClear(false);
          if (next) markRead.mutate(undefined);
        }}
        open={open}
      >
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md" side="right">
          <SheetHeader className="border-b border-border">
            <div className="flex items-center justify-between gap-2 pr-8">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <Bell className="size-4 text-muted-foreground" />
                  {t("notifications.title")}
                </SheetTitle>
                <SheetDescription>{t("notifications.description")}</SheetDescription>
              </div>
              {entries.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {confirmClear ? (
                    <>
                      <Button
                        disabled={clear.isPending}
                        onClick={() => clear.mutate(undefined, { onSuccess: () => setConfirmClear(false) })}
                        size="sm"
                        variant="destructive"
                      >
                        {t("common.yes")}
                      </Button>
                      <Button onClick={() => setConfirmClear(false)} size="sm" variant="ghost">
                        {t("common.cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setConfirmClear(true)} size="sm" variant="outline">
                      <Trash2 />
                      {t("notifications.clear")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1" scrollFade>
            {entries.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">{t("notifications.empty")}</p>
            )}
            <div className="divide-y divide-border">
              {entries.map((entry) => {
                const meta = severityIcon[entry.severity] ?? severityIcon.info;
                const Icon = meta.icon;
                const age = Math.max(0, Math.floor(Date.now() / 1000) - entry.ts);
                return (
                  <div
                    className={cn(
                      "flex gap-2.5 px-4 py-3",
                      !entry.read && "border-l-2 border-l-accent-primary bg-accent-primary/5",
                    )}
                    key={entry.id}
                  >
                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.className)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium">
                          {t(`notifications.event.${entry.event}`, { defaultValue: entry.event })}
                        </span>
                        <span
                          className="shrink-0 font-mono text-[10px] text-muted-foreground"
                          title={new Date(entry.ts * 1000).toLocaleString()}
                        >
                          {formatDuration(age)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] whitespace-pre-wrap text-muted-foreground">
                        {entry.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <span className="text-[10px] text-muted-foreground">
              {t("notifications.count", { n: entries.length })}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Check className="size-3" />
              {t("notifications.readOnOpen")}
            </span>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
