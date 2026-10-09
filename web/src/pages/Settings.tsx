import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, KeyRound, Loader2, Plus, Send, ServerCog, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import ServerConfigForm from "@/components/config/ServerConfigForm";
import AuditCard from "@/components/settings/AuditCard";
import UsersCard from "@/components/settings/UsersCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  useCreateToken,
  useMe,
  useRevokeToken,
  useSettings,
  useStatus,
  useTestWebhook,
  useTokens,
} from "@/hooks/use-api";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { toast } from "@/lib/notify";

export default function Settings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useStatus();
  const settings = useSettings();
  const me = useMe();

  const [autoStart, setAutoStart] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [startParams, setStartParams] = useState("");
  const [restartSchedule, setRestartSchedule] = useState("");
  const [backupSchedule, setBackupSchedule] = useState("");
  const [backupBeforeRestart, setBackupBeforeRestart] = useState(false);
  const [backupRetention, setBackupRetention] = useState(10);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [collectTps, setCollectTps] = useState(true);
  const [publicView, setPublicView] = useState(false);
  const [publicSections, setPublicSections] = useState<string[]>([]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);

  const [tokenLabel, setTokenLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setAutoStart(settings.data.auto_start ?? false);
      setAutoRestart(settings.data.auto_restart ?? false);
      setStartParams(settings.data.start_params ?? "");
      setRestartSchedule(settings.data.restart_schedule ?? "");
      setBackupSchedule(settings.data.backup_schedule ?? "");
      setBackupBeforeRestart(settings.data.backup_before_restart ?? false);
      setBackupRetention(settings.data.backup_retention ?? 10);
      setWebhookUrl(settings.data.webhook_url ?? "");
      setWebhookEvents(settings.data.webhook_events ?? []);
      setCollectTps(settings.data.collect_tps ?? true);
      setPublicView(settings.data.public_view ?? false);
      setPublicSections(settings.data.public_sections ?? []);
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
        webhook_url: webhookUrl,
        webhook_events: webhookEvents,
        collect_tps: collectTps,
        public_view: publicView,
        public_sections: publicSections,
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

  const testWebhook = useTestWebhook();

  const tokens = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();

  const WEBHOOK_EVENTS: Array<{ event: string; labelKey: string }> = [
    { event: "start", labelKey: "settings.webhookEventStart" },
    { event: "stop", labelKey: "settings.webhookEventStop" },
    { event: "crash", labelKey: "settings.webhookEventCrash" },
    { event: "player_join", labelKey: "settings.webhookEventPlayerJoin" },
    { event: "player_leave", labelKey: "settings.webhookEventPlayerLeave" },
    { event: "backup", labelKey: "settings.webhookEventBackup" },
  ];

  const PUBLIC_SECTION_OPTIONS: Array<{ section: string; labelKey: string }> = [
    { section: "status", labelKey: "settings.publicSectionStatus" },
    { section: "build", labelKey: "settings.publicSectionBuild" },
    { section: "metrics", labelKey: "settings.publicSectionMetrics" },
    { section: "info", labelKey: "settings.publicSectionInfo" },
    { section: "players", labelKey: "settings.publicSectionPlayers" },
    { section: "history", labelKey: "settings.publicSectionHistory" },
  ];

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

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="collect-tps">{t("settings.collectTps")}</Label>
              <p className="text-muted-foreground text-[11px]">{t("settings.collectTpsHint")}</p>
            </div>
            <Switch checked={collectTps} id="collect-tps" onCheckedChange={setCollectTps} />
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

      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4 text-muted-foreground" />
            {t("settings.notificationsTitle")}
          </CardTitle>
          <CardDescription>{t("settings.notificationsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="webhook-url">{t("settings.webhookUrl")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="webhook-url"
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={t("settings.webhookUrlPlaceholder")}
                value={webhookUrl}
              />
              <Button
                disabled={!webhookUrl.trim() || testWebhook.isPending}
                onClick={() => testWebhook.mutate()}
                size="sm"
                variant="outline"
              >
                {testWebhook.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                {t("settings.webhookTest")}
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("settings.webhookEvents")}</Label>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {WEBHOOK_EVENTS.map(({ event, labelKey }) => (
                <label className="flex items-center gap-2 text-xs" key={event}>
                  <input
                    checked={webhookEvents.includes(event)}
                    className="accent-[#8b5cf6]"
                    onChange={(changeEvent) =>
                      setWebhookEvents((previous) =>
                        changeEvent.target.checked
                          ? [...previous, event]
                          : previous.filter((entry) => entry !== event),
                      )
                    }
                    type="checkbox"
                  />
                  {t(labelKey)}
                </label>
              ))}
            </div>
          </div>

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

      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-muted-foreground" />
            {t("settings.publicTitle")}
          </CardTitle>
          <CardDescription>{t("settings.publicDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="public-view">{t("settings.publicEnable")}</Label>
              <p className="text-muted-foreground text-[11px]">{t("settings.publicEnableHint")}</p>
            </div>
            <Switch checked={publicView} id="public-view" onCheckedChange={setPublicView} />
          </div>

          {publicView && (
            <div className="grid gap-1.5">
              <Label>{t("settings.publicSections")}</Label>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {PUBLIC_SECTION_OPTIONS.map(({ section, labelKey }) => (
                  <label className="flex items-center gap-2 text-xs" key={section}>
                    <input
                      checked={publicSections.includes(section)}
                      className="accent-[#8b5cf6]"
                      onChange={(changeEvent) =>
                        setPublicSections((previous) =>
                          changeEvent.target.checked
                            ? [...previous, section]
                            : previous.filter((entry) => entry !== section),
                        )
                      }
                      type="checkbox"
                    />
                    {t(labelKey)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={saveSettings.isPending || !settings.data}
              onClick={() => saveSettings.mutate()}
              variant="accent-primary"
            >
              {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {t("common.save")}
            </Button>
            <Button
              onClick={() => window.open("/?as=guest", "_blank")}
              size="sm"
              variant="outline"
            >
              <Globe />
              {t("settings.publicPreview")}
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
          {me.data?.user && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t("settings.signedInAs", {
                name: me.data.user.name,
                role: t(`settings.role.${me.data.user.role}`),
              })}
            </p>
          )}
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

      <UsersCard />

      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {t("settings.tokensTitle")}
          </CardTitle>
          <CardDescription>{t("settings.tokensDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="token-label">{t("settings.tokenLabel")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-64"
                id="token-label"
                onChange={(event) => setTokenLabel(event.target.value)}
                placeholder={t("settings.tokenLabelPlaceholder")}
                value={tokenLabel}
              />
              <Button
                disabled={!tokenLabel.trim() || createToken.isPending}
                onClick={() =>
                  createToken.mutate(tokenLabel.trim(), {
                    onSuccess: (data) => {
                      setCreatedToken(data.plaintext);
                      setTokenCopied(false);
                      setTokenLabel("");
                    },
                  })
                }
                size="sm"
                variant="accent-primary"
              >
                {createToken.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("settings.tokenCreate")}
              </Button>
            </div>
          </div>

          {createdToken && (
            <div className="border border-success/40 bg-success/5 p-3">
              <p className="text-xs text-success">{t("settings.tokenCreated")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate border border-border bg-input/40 px-2 py-1 font-mono text-[11px]">
                  {createdToken}
                </code>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(createdToken).then(() => {
                      setTokenCopied(true);
                      window.setTimeout(() => setTokenCopied(false), 2000);
                    });
                  }}
                  size="sm"
                  variant="outline"
                >
                  {tokenCopied ? <Check /> : <Copy />}
                  {tokenCopied ? t("settings.tokenCopied") : t("settings.tokenCopy")}
                </Button>
                <Button onClick={() => setCreatedToken(null)} size="sm" variant="ghost">
                  {t("common.clear")}
                </Button>
              </div>
            </div>
          )}

          {tokens.data && tokens.data.tokens.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("settings.tokenNone")}</p>
          )}

          {tokens.data && tokens.data.tokens.length > 0 && (
            <div className="border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                <span className="flex-1">{t("settings.tokenLabel")}</span>
                <span className="hidden w-40 sm:block">{t("settings.tokenCreatedAt")}</span>
                <span className="hidden w-40 sm:block">{t("settings.tokenLastUsed")}</span>
                <span className="w-24 text-right" />
              </div>
              <div className="divide-y divide-border">
                {tokens.data.tokens.map((token) => (
                  <div className="flex items-center gap-3 px-3 py-2.5" key={token.id}>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {token.label}
                    </span>
                    <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                      {new Date(token.created * 1000).toLocaleString()}
                    </span>
                    <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                      {token.last_used
                        ? new Date(token.last_used * 1000).toLocaleString()
                        : t("settings.tokenNever")}
                    </span>
                    <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                      {revokeConfirm === token.id ? (
                        <>
                          <Button
                            disabled={revokeToken.isPending}
                            onClick={() =>
                              revokeToken.mutate(token.id, {
                                onSuccess: () => setRevokeConfirm(null),
                              })
                            }
                            size="sm"
                            variant="destructive"
                          >
                            {t("common.yes")}
                          </Button>
                          <Button
                            onClick={() => setRevokeConfirm(null)}
                            size="sm"
                            variant="ghost"
                          >
                            {t("common.cancel")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() => setRevokeConfirm(token.id)}
                          size="sm"
                          variant="outline"
                        >
                          {t("settings.tokenRevoke")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AuditCard />

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
