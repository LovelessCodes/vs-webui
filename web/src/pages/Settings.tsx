import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, ServerCog } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import ServerConfigForm from "@/components/config/ServerConfigForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useSettings, useStatus } from "@/hooks/use-api";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { toast } from "@/lib/notify";

export default function Settings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useStatus();
  const settings = useSettings();

  const [autoStart, setAutoStart] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [startParams, setStartParams] = useState("");
  const [restartSchedule, setRestartSchedule] = useState("");
  const [backupSchedule, setBackupSchedule] = useState("");
  const [backupBeforeRestart, setBackupBeforeRestart] = useState(false);
  const [backupRetention, setBackupRetention] = useState(10);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setAutoStart(settings.data.auto_start ?? false);
      setAutoRestart(settings.data.auto_restart ?? false);
      setStartParams(settings.data.start_params ?? "");
      setRestartSchedule(settings.data.restart_schedule ?? "");
      setBackupSchedule(settings.data.backup_schedule ?? "");
      setBackupBeforeRestart(settings.data.backup_before_restart ?? false);
      setBackupRetention(settings.data.backup_retention ?? 10);
    }
  }, [settings.data]);

  const saveSettings = useMutation({
    mutationFn: () =>
      api.saveSettings({
        auto_start: autoStart,
        auto_restart: autoRestart,
        start_params: startParams,
        restart_schedule: restartSchedule,
        backup_schedule: backupSchedule,
        backup_before_restart: backupBeforeRestart,
        backup_retention: backupRetention,
      }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCsrf(null);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const canChangePassword =
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    (!status.data?.manager.auth_enabled || currentPassword.length > 0);

  function onSubmitPassword(event: FormEvent) {
    event.preventDefault();
    if (canChangePassword) changePassword.mutate();
  }

  return (
    <ScrollArea className="h-full" scrollFade>
      <div className="grid gap-4 pb-4 pr-1 lg:grid-cols-2">
      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="size-4 text-muted-foreground" />
            {t("settings.serverConfigTitle")}
          </CardTitle>
          <CardDescription>{t("settings.serverConfigDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ServerConfigForm />
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="size-4 text-muted-foreground" />
            {t("settings.behaviorTitle")}
          </CardTitle>
          <CardDescription>{t("settings.behaviorDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-start">{t("settings.autoStart")}</Label>
              <p className="text-muted-foreground text-[11px]">{t("settings.autoStartHint")}</p>
            </div>
            <Switch checked={autoStart} id="auto-start" onCheckedChange={setAutoStart} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-restart">{t("settings.autoRestart")}</Label>
              <p className="text-muted-foreground text-[11px]">{t("settings.autoRestartHint")}</p>
            </div>
            <Switch checked={autoRestart} id="auto-restart" onCheckedChange={setAutoRestart} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="start-params">{t("settings.startParams")}</Label>
            <Input
              id="start-params"
              onChange={(event) => setStartParams(event.target.value)}
              placeholder={t("settings.startParamsPlaceholder")}
              value={startParams}
            />
            <p className="text-muted-foreground text-[11px]">{t("settings.startParamsHint")}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="restart-schedule">{t("settings.dailyRestart")}</Label>
            <div className="flex items-center gap-2">
              <Input
                className="w-32"
                id="restart-schedule"
                onChange={(event) => setRestartSchedule(event.target.value)}
                type="time"
                value={restartSchedule}
              />
              {restartSchedule && (
                <Button onClick={() => setRestartSchedule("")} size="sm" variant="ghost">
                  {t("common.clear")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">{t("settings.dailyRestartHint")}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="backup-schedule">{t("settings.dailyBackup")}</Label>
            <div className="flex items-center gap-2">
              <Input
                className="w-32"
                id="backup-schedule"
                onChange={(event) => setBackupSchedule(event.target.value)}
                type="time"
                value={backupSchedule}
              />
              {backupSchedule && (
                <Button onClick={() => setBackupSchedule("")} size="sm" variant="ghost">
                  {t("common.clear")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">{t("settings.dailyBackupHint")}</p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="backup-before-restart">{t("settings.backupBeforeRestart")}</Label>
              <p className="text-muted-foreground text-[11px]">
                {t("settings.backupBeforeRestartHint")}
              </p>
            </div>
            <Switch
              checked={backupBeforeRestart}
              id="backup-before-restart"
              onCheckedChange={setBackupBeforeRestart}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="backup-retention">{t("settings.backupRetention")}</Label>
            <Input
              className="w-24"
              id="backup-retention"
              max={100}
              min={1}
              onChange={(event) =>
                setBackupRetention(
                  Math.max(1, Math.min(100, Number(event.target.value) || 10)),
                )
              }
              type="number"
              value={backupRetention}
            />
            <p className="text-muted-foreground text-[11px]">
              {t("settings.backupRetentionHint")}
            </p>
          </div>

          {saveSettings.isError && (
            <p className="text-error text-xs">{errorMessage(saveSettings.error)}</p>
          )}

          <div className="flex items-center gap-3">
            <Button
              disabled={saveSettings.isPending || !settings.data}
              onClick={() => saveSettings.mutate()}
              variant="accent-primary"
            >
              {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            {t("settings.accessTitle")}
          </CardTitle>
          <CardDescription>
            {status.data?.manager.auth_enabled
              ? t("settings.accessEnabled")
              : t("settings.accessDisabled")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passwordChanged ? (
            <p className="text-success text-xs">{t("settings.passwordChanged")}</p>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmitPassword}>
              {status.data?.manager.auth_enabled && (
                <div className="grid gap-1.5">
                  <Label htmlFor="current-password">{t("settings.currentPassword")}</Label>
                  <Input
                    autoComplete="current-password"
                    id="current-password"
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    type="password"
                    value={currentPassword}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">{t("settings.newPassword")}</Label>
                <Input
                  autoComplete="new-password"
                  id="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  value={newPassword}
                />
                {passwordTooShort && (
                  <p className="text-[11px] text-error">{t("settings.tooShort")}</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-password">{t("settings.confirmPassword")}</Label>
                <Input
                  autoComplete="new-password"
                  id="confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  value={confirmPassword}
                />
                {passwordMismatch && (
                  <p className="text-[11px] text-error">{t("settings.mismatch")}</p>
                )}
              </div>

              {changePassword.isError && (
                <p className="text-error text-xs">{errorMessage(changePassword.error)}</p>
              )}

              <Button
                disabled={!canChangePassword || changePassword.isPending}
                type="submit"
                variant="accent-primary"
              >
                {changePassword.isPending && <Loader2 className="animate-spin" />}
                {t("settings.changePassword")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("settings.about")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-muted-foreground">{t("settings.manager")}</span>
            <span className="font-mono">vs-webui {status.data?.manager.version ?? "?"}</span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-muted-foreground">{t("settings.dataDir")}</span>
            <span className="truncate font-mono">{status.data?.manager.data_dir ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-muted-foreground">{t("settings.gameDataPath")}</span>
            <span className="truncate font-mono">
              {status.data?.manager.data_dir ?? "/data"}/server
            </span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-muted-foreground">{t("settings.gamePort")}</span>
            <span className="font-mono">{status.data?.config?.port ?? 42420}</span>
          </div>
        </CardContent>
      </Card>
      </div>
    </ScrollArea>
  );
}
