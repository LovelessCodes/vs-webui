import { Link } from "@tanstack/react-router";
import {
  Activity,
  Archive,
  Boxes,
  FolderCog,
  HardDrive,
  Loader2,
  Megaphone,
  Play,
  RotateCw,
  Save,
  Server,
  Settings2,
  Square,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot, statusMeta } from "@/components/status-badge";
import ProgressBar from "@/components/common/ProgressBar";
import AnnounceSheet from "@/components/dashboard/AnnounceSheet";
import AttentionCard from "@/components/dashboard/AttentionCard";
import AutomationCard from "@/components/dashboard/AutomationCard";
import MetricTiles from "@/components/dashboard/MetricTiles";
import WorldCard from "@/components/dashboard/WorldCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useConsolePreview,
  useCreateBackup,
  useMetrics,
  usePlayers,
  useServerCommand,
  useServerRestart,
  useServerStart,
  useServerStop,
  useStatus,
  useStorage,
} from "@/hooks/use-api";
import { errorMessage, formatBytes, formatDuration } from "@/lib/format";
import { cn } from "cn";

export default function Dashboard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useStatus();
  const preview = useConsolePreview();
  const start = useServerStart();
  const stop = useServerStop();
  const restart = useServerRestart();
  const metrics = useMetrics();
  const storage = useStorage();
  const players = usePlayers();
  const command = useServerCommand();
  const backup = useCreateBackup();
  const [announceOpen, setAnnounceOpen] = useState(false);

  const storageAreaKeys: Record<string, string> = {
    runtime: "dashboard.storageRuntime",
    saves: "dashboard.storageSaves",
    mods: "dashboard.storageMods",
    logs: "dashboard.storageLogs",
    backups: "dashboard.storageBackups",
    config: "dashboard.storageConfig",
  };

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border border-error/40 bg-error/5 p-4 text-xs text-error">
        {errorMessage(error)}
      </div>
    );
  }

  if (!data) return null;

  const status = data.status.status;
  const meta = statusMeta(status);
  const busy = start.isPending || stop.isPending || restart.isPending;
  const canStart = (status === "stopped" || status === "crashed") && Boolean(data.settings.version);
  const canStop = status === "running" || status === "starting";
  const uptime =
    status === "running" && data.status.started_at
      ? Math.max(0, Math.floor(Date.now() / 1000) - data.status.started_at)
      : null;
  const install = data.install;
  const installing = install && install.phase !== "done" && install.phase !== "error";
  const actionError = start.error ?? stop.error ?? restart.error;

  const metricsSamples = metrics.data?.samples ?? [];
  const online = players.data?.online ?? [];

  return (
    <ScrollArea className="h-full" scrollFade>
      <div className="space-y-4 pb-4 pr-1">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Server className="size-4 text-muted-foreground" />
                {t("dashboard.server")}
              </CardTitle>
              <span className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className={`text-xs font-medium ${meta.text}`}>{t(meta.labelKey)}</span>
              </span>
            </div>
            <CardDescription>{t("dashboard.serverDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">{t("dashboard.version")}</dt>
                <dd className="font-mono">
                  {data.status.version ?? data.settings.version ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("dashboard.pid")}</dt>
                <dd className="font-mono">{data.status.pid ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("dashboard.uptime")}</dt>
                <dd className="font-mono">{uptime !== null ? formatDuration(uptime) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("dashboard.lastExit")}</dt>
                <dd className="font-mono">
                  {data.status.exit_code === null ? "—" : `code ${data.status.exit_code}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("dashboard.online")}</dt>
                <dd className="font-mono">{online.length}</dd>
              </div>
            </dl>

            {online.length > 0 && (
              <p className="truncate text-[11px] text-muted-foreground">
                {online
                  .map((player) => player.name)
                  .join(", ")}
              </p>
            )}

            {actionError && <p className="text-error text-xs">{errorMessage(actionError)}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canStart || busy}
                onClick={() => start.mutate()}
                variant="success"
              >
                <Play />
                {t("dashboard.start")}
              </Button>
              <Button disabled={!canStop || busy} onClick={() => stop.mutate()} variant="outline">
                <Square />
                {t("dashboard.stop")}
              </Button>
              <Button
                disabled={!canStop || busy}
                onClick={() => restart.mutate()}
                variant="outline"
              >
                <RotateCw className={restart.isPending ? "animate-spin" : undefined} />
                {t("dashboard.restart")}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canStop || command.isPending}
                onClick={() => command.mutate("/autosavenow")}
                size="sm"
                variant="outline"
              >
                <Save />
                {t("dashboard.saveNow")}
              </Button>
              <Button
                disabled={backup.isPending}
                onClick={() => backup.mutate("server")}
                size="sm"
                variant="outline"
              >
                <Archive />
                {t("dashboard.backupNow")}
              </Button>
              <Button
                disabled={!canStop}
                onClick={() => setAnnounceOpen(true)}
                size="sm"
                variant="outline"
              >
                <Megaphone />
                {t("dashboard.announce")}
              </Button>
            </div>
            {!data.settings.version && (
              <p className="text-warning text-xs">
                {t("dashboard.noVersion")}{" "}
                <Link className="underline" to="/versions">
                  {t("dashboard.versionsLink")}
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        <AttentionCard />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                {t("dashboard.performance")}
              </CardTitle>
              {metricsSamples.length > 0 && (
                <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                  {t("dashboard.performanceWindow")}
                </span>
              )}
            </div>
            <CardDescription>{t("dashboard.performanceDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <MetricTiles samples={metricsSamples} />
          </CardContent>
        </Card>

        <AutomationCard />

        <WorldCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              {t("dashboard.storage")}
            </CardTitle>
            <CardDescription>{t("dashboard.storageDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {storage.data ? (
              <div className="grid gap-2">
                <dl className="grid gap-1.5 text-xs">
                  {storage.data.areas.map((area) => (
                    <div className="flex items-center justify-between gap-3" key={area.name}>
                      <dt className="text-muted-foreground">
                        {t(storageAreaKeys[area.name] ?? area.name)}
                      </dt>
                      <dd className="font-mono">{formatBytes(area.bytes)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground text-[11px]">
                  {t("dashboard.storageFree", {
                    size: formatBytes(storage.data.free_bytes),
                    total: formatBytes(storage.data.total_bytes),
                  })}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{t("common.loading")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-4 text-muted-foreground" />
                {t("dashboard.gameBuild")}
              </CardTitle>
              <Badge variant={data.settings.flavor === "stratum" ? "accent" : "outline"}>
                {data.settings.flavor === "stratum"
                  ? t("versions.stratum")
                  : t("versions.vanilla")}
              </Badge>
            </div>
            <CardDescription>{t("dashboard.gameBuildDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {installing && install ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono">{install.version}</span>
                  <span className="text-muted-foreground capitalize">{install.phase}</span>
                </div>
                <ProgressBar
                  max={install.total || 1}
                  showPercentage={install.total > 0}
                  value={install.downloaded}
                />
                <p className="text-muted-foreground text-[11px]">
                  {formatBytes(install.downloaded)}
                  {install.total ? ` / ${formatBytes(install.total)}` : ""}
                </p>
              </div>
            ) : install?.phase === "error" ? (
              <p className="text-error text-xs">{install.message ?? t("versions.installFailed")}</p>
            ) : (
              <div className="grid gap-1">
                <p className="text-muted-foreground text-xs">
                  {data.settings.version || data.settings.stratum_tag
                    ? t("dashboard.ready")
                    : t("dashboard.nothingInstalled")}
                </p>
                {data.settings.flavor === "stratum" && data.settings.stratum_tag && (
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.stratum")}{" "}
                    <span className="font-mono text-accent-amber">
                      {data.settings.stratum_tag}
                    </span>
                  </p>
                )}
              </div>
            )}
            <div>
              <Link
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                to="/versions"
              >
                <Boxes className="size-3.5" />
                {t("dashboard.manageVersions")}
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                {t("dashboard.serverConfig")}
              </CardTitle>
            </div>
            <CardDescription>{t("dashboard.serverConfigDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.name")}</span>
              <span className="truncate font-mono">{data.config?.server_name ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.port")}</span>
              <span className="font-mono">{data.config?.port ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.maxClients")}</span>
              <span className="font-mono">{data.config?.max_clients ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.password")}</span>
              <span className="font-mono">
                {data.config?.password_protected
                  ? t("dashboard.passwordSet")
                  : t("dashboard.passwordNone")}
              </span>
            </div>
            {!data.config && (
              <p className="text-muted-foreground text-[11px]">
                {t("dashboard.generatedOnFirstStart")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderCog className="size-4 text-muted-foreground" />
              {t("dashboard.manager")}
            </CardTitle>
            <CardDescription>{t("dashboard.managerDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.version")}</span>
              <span className="font-mono">{data.manager.version}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.uptime")}</span>
              <span className="font-mono">{formatDuration(data.manager.uptime)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.dataDir")}</span>
              <span className="truncate font-mono">{data.manager.data_dir}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.auth")}</span>
              <span className="font-mono">
                {data.manager.auth_enabled
                  ? t("dashboard.authPassword")
                  : t("dashboard.authOff")}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              {t("dashboard.recentConsole")}
            </CardTitle>
            <Link
              className="text-accent-primary text-xs underline-offset-4 hover:underline"
              search={{ logs: undefined }}
              to="/console"
            >
              {t("dashboard.openConsole")}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {preview.data?.lines.length ? (
            <pre className="overflow-x-auto text-[11px] leading-relaxed">
              {preview.data.lines.slice(-12).map((line, index) => (
                <div className="whitespace-pre" key={`${line.ts}-${index}`}>
                  <span className="text-muted-foreground">{line.ts}</span>{" "}
                  <span className="text-muted-foreground">{line.line}</span>
                </div>
              ))}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">{t("dashboard.noOutput")}</p>
          )}
        </CardContent>
      </Card>
      <AnnounceSheet onOpenChange={setAnnounceOpen} open={announceOpen} />
      </div>
    </ScrollArea>
  );
}
