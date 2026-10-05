import { Link } from "@tanstack/react-router";
import {
  Boxes,
  FolderCog,
  Loader2,
  Play,
  RotateCw,
  Server,
  Settings2,
  Square,
  Terminal,
} from "lucide-react";

import { StatusDot, statusMeta } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useConsolePreview,
  useServerRestart,
  useServerStart,
  useServerStop,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data, isLoading, error } = useStatus();
  const preview = useConsolePreview();
  const start = useServerStart();
  const stop = useServerStop();
  const restart = useServerRestart();

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-text-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading…
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
  const uptime = status === "running" && data.status.started_at
    ? Math.max(0, Math.floor(Date.now() / 1000) - data.status.started_at)
    : null;
  const install = data.install;
  const installing = install && install.phase !== "done" && install.phase !== "error";
  const actionError = start.error ?? stop.error ?? restart.error;

  return (
    <div className="h-full space-y-4 overflow-y-auto pb-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Server className="size-4 text-text-secondary" />
                Server
              </CardTitle>
              <span className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
              </span>
            </div>
            <CardDescription>Dedicated Vintage Story process inside this container.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-text-muted">Version</dt>
                <dd className="font-mono">{data.status.version ?? data.settings.version ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">PID</dt>
                <dd className="font-mono">{data.status.pid ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Uptime</dt>
                <dd className="font-mono">{uptime !== null ? formatDuration(uptime) : "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Last exit</dt>
                <dd className="font-mono">
                  {data.status.exit_code === null ? "—" : `code ${data.status.exit_code}`}
                </dd>
              </div>
            </dl>

            {actionError && (
              <p className="text-error text-xs">{errorMessage(actionError)}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canStart || busy}
                onClick={() => start.mutate()}
                variant="success"
              >
                <Play />
                Start
              </Button>
              <Button disabled={!canStop || busy} onClick={() => stop.mutate()} variant="outline">
                <Square />
                Stop
              </Button>
              <Button
                disabled={!canStop || busy}
                onClick={() => restart.mutate()}
                variant="outline"
              >
                <RotateCw className={restart.isPending ? "animate-spin" : undefined} />
                Restart
              </Button>
            </div>
            {!data.settings.version && (
              <p className="text-warning text-xs">
                No game version selected — install one under{" "}
                <Link className="underline" to="/versions">
                  Versions
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-4 text-text-secondary" />
                Game build
              </CardTitle>
              <Badge variant={data.settings.flavor === "stratum" ? "accent" : "default"}>
                {data.settings.flavor ?? "vanilla"}
              </Badge>
            </div>
            <CardDescription>Installed server runtime used by the process.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {installing && install ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono">{install.version}</span>
                  <span className="text-text-secondary capitalize">{install.phase}</span>
                </div>
                <div className="h-1.5 w-full bg-bg-input">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{
                      width: install.total
                        ? `${Math.min(100, Math.round((install.downloaded / install.total) * 100))}%`
                        : "100%",
                    }}
                  />
                </div>
                <p className="text-text-muted text-[11px]">
                  {formatBytes(install.downloaded)}
                  {install.total ? ` / ${formatBytes(install.total)}` : ""}
                </p>
              </div>
            ) : install?.phase === "error" ? (
              <p className="text-error text-xs">{install.message ?? "Install failed"}</p>
            ) : (
              <div className="grid gap-1">
                <p className="text-text-secondary text-xs">
                  {data.settings.version || data.settings.stratum_tag
                    ? "Ready."
                    : "Nothing installed yet."}
                </p>
                {data.settings.flavor === "stratum" && data.settings.stratum_tag && (
                  <p className="text-xs text-text-secondary">
                    Stratum{" "}
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
                Manage versions
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="size-4 text-text-secondary" />
                Server config
              </CardTitle>
            </div>
            <CardDescription>From serverconfig.json in the data path.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Name</span>
              <span className="truncate font-mono">{data.config?.server_name ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Port</span>
              <span className="font-mono">{data.config?.port ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Max clients</span>
              <span className="font-mono">{data.config?.max_clients ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Password</span>
              <span className="font-mono">
                {data.config?.password_protected ? "set" : "none"}
              </span>
            </div>
            {!data.config && (
              <p className="text-text-muted text-[11px]">
                Generated by the server on first start.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderCog className="size-4 text-text-secondary" />
              Manager
            </CardTitle>
            <CardDescription>vs-webui daemon controlling the server.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Version</span>
              <span className="font-mono">{data.manager.version}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Uptime</span>
              <span className="font-mono">{formatDuration(data.manager.uptime)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Data dir</span>
              <span className="truncate font-mono">{data.manager.data_dir}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Auth</span>
              <span className="font-mono">{data.manager.auth_enabled ? "password" : "off"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-text-secondary" />
              Recent console
            </CardTitle>
            <Link
              className="text-accent-primary text-xs underline-offset-4 hover:underline"
              to="/console"
            >
              Open console →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {preview.data?.lines.length ? (
            <pre className="overflow-x-auto text-[11px] leading-relaxed">
              {preview.data.lines.slice(-12).map((line, index) => (
                <div className="whitespace-pre" key={`${line.ts}-${index}`}>
                  <span className="text-text-muted">{line.ts}</span>{" "}
                  <span className="text-text-secondary">{line.line}</span>
                </div>
              ))}
            </pre>
          ) : (
            <p className="text-text-muted text-xs">No console output yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
