import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBackups, useStatus } from "@/hooks/use-api";
import { formatBytes, formatDuration } from "@/lib/format";

/** Next occurrence of a local `HH:MM` time, in milliseconds. */
function nextOccurrence(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function scheduleLabel(
  value: string | null | undefined,
  disabled: string,
  inLabel: (duration: string) => string,
): string {
  const next = nextOccurrence(value);
  if (next === null) return disabled;
  const time = new Date(next).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${time} · ${inLabel(formatDuration(Math.round((next - Date.now()) / 1000)))}`;
}

/** Daily schedules and the most recent backup at a glance. */
export default function AutomationCard() {
  const { t } = useTranslation();
  const status = useStatus();
  const backups = useBackups();
  const settings = status.data?.settings;
  const newest = (backups.data?.backups ?? []).find((entry) => entry.name.startsWith("server"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          {t("dashboard.automation")}
        </CardTitle>
        <CardDescription>{t("dashboard.automationDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationNextRestart")}</span>
          <span className="font-mono">
            {scheduleLabel(
              settings?.restart_schedule,
              t("dashboard.automationDisabled"),
              (duration) => t("dashboard.automationIn", { duration }),
            )}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationNextBackup")}</span>
          <span className="font-mono">
            {scheduleLabel(
              settings?.backup_schedule,
              t("dashboard.automationDisabled"),
              (duration) => t("dashboard.automationIn", { duration }),
            )}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationLastBackup")}</span>
          <span className="truncate font-mono">
            {newest
              ? `${t("dashboard.automationAgo", {
                  duration: formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - newest.modified)),
                })} · ${formatBytes(newest.size)}`
              : t("dashboard.automationNone")}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationBeforeRestart")}</span>
          <span className="font-mono">
            {settings?.backup_before_restart
              ? t("dashboard.automationOn")
              : t("dashboard.automationOff")}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationRetention")}</span>
          <span className="font-mono">{settings?.backup_retention ?? "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
