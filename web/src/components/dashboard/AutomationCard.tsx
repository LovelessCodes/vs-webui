import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBackups, useStatus } from "@/hooks/use-api";
import { formatBytes, formatDuration } from "@/lib/format";

/** Scheduled tasks and the most recent backup at a glance. */
export default function AutomationCard() {
  const { t } = useTranslation();
  const status = useStatus();
  const backups = useBackups();
  const settings = status.data?.settings;
  const schedules = status.data?.tasks ?? [];
  const nextRestart = schedules.find((task) => task.kind === "restart");
  const nextBackup = schedules.find((task) => task.kind === "backup");
  const backupBefore = schedules.some(
    (task) => task.kind === "restart" && task.backup_before,
  );
  const newest = (backups.data?.backups ?? []).find((entry) => entry.name.startsWith("server"));

  const label = (next: { next: number } | undefined) =>
    next
      ? `${new Date(next.next * 1000).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })} · ${t("dashboard.automationIn", {
          duration: formatDuration(Math.max(0, next.next - Math.floor(Date.now() / 1000))),
        })}`
      : t("dashboard.automationDisabled");

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
          <span className="font-mono">{label(nextRestart)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationNextBackup")}</span>
          <span className="font-mono">{label(nextBackup)}</span>
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
            {backupBefore ? t("dashboard.automationOn") : t("dashboard.automationOff")}
          </span>
        </div>
        {settings?.timezone && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("dashboard.automationTimezone")}</span>
            <span className="font-mono">{settings.timezone}</span>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dashboard.automationRetention")}</span>
          <span className="font-mono">{settings?.backup_retention ?? "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
