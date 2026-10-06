import { Link } from "@tanstack/react-router";
import { Earth, LogIn, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot, statusMeta } from "@/components/status-badge";
import MetricTiles from "@/components/dashboard/MetricTiles";
import SignInSheet from "@/components/layout/SignInSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePublicView } from "@/hooks/use-api";
import { formatDuration } from "@/lib/format";

/** Read-only page shown to visitors (and as an admin preview). */
export default function PublicDashboard({ preview = false }: { preview?: boolean }) {
  const { t } = useTranslation();
  const view = usePublicView();
  const [signInOpen, setSignInOpen] = useState(false);

  const status = view.data?.status;
  const build = view.data?.build;
  const info = view.data?.info;
  const players = view.data?.players ?? [];
  const history = view.data?.history ?? [];
  const meta = statusMeta(status?.status);
  const uptime =
    status?.status === "running" && status.started_at
      ? Math.max(0, Math.floor(Date.now() / 1000) - status.started_at)
      : null;

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex size-8 shrink-0 items-center justify-center border border-accent-primary/40 bg-accent-primary/10">
          <span className="text-sm font-bold text-accent-primary">VS</span>
        </div>
        <div className="grid leading-tight">
          <span className="text-sm font-bold tracking-wide">{t("brand.name")}</span>
          <span className="text-[10px] font-medium tracking-widest text-accent-amber uppercase">
            {t("brand.tagline")}
          </span>
        </div>
        <div className="flex-1" />
        {preview ? (
          <Link className="text-xs text-info hover:underline" to="/">
            {t("public.exitPreview")}
          </Link>
        ) : (
          <Button onClick={() => setSignInOpen(true)} size="sm" variant="outline">
            <LogIn />
            {t("login.signIn")}
          </Button>
        )}
      </header>

      {preview && (
        <p className="border-b border-info/30 bg-info/5 px-4 py-2 text-[11px] text-info">
          {t("public.previewHint")}
        </p>
      )}

      <main className="mx-auto grid w-full max-w-6xl gap-4 p-6 lg:grid-cols-2">
        {view.data && !view.data.enabled && (
          <Card className="lg:col-span-2">
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-sm">{t("public.disabled")}</p>
            </CardContent>
          </Card>
        )}

        {status && (
          <Card className="self-start">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Earth className="size-4 text-muted-foreground" />
                  {t("dashboard.server")}
                </CardTitle>
                <span className="flex items-center gap-2">
                  <StatusDot status={status.status} />
                  <span className={`text-xs font-medium ${meta.text}`}>
                    {t(meta.labelKey)}
                  </span>
                </span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t("dashboard.version")}</dt>
                  <dd className="font-mono">{status.version ?? build?.version ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("dashboard.uptime")}</dt>
                  <dd className="font-mono">
                    {uptime !== null ? formatDuration(uptime) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("players.online")}</dt>
                  <dd className="font-mono">{status.online}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        {build && (
          <Card className="self-start">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t("dashboard.gameBuild")}</CardTitle>
                <div className="flex items-center gap-2">
                  {build.updates?.game && (
                    <Badge variant="amber">
                      {t("versions.updateAvailable", { version: build.updates.game })}
                    </Badge>
                  )}
                  {build.updates?.stratum && (
                    <Badge variant="amber">
                      {t("versions.updateAvailable", { version: build.updates.stratum })}
                    </Badge>
                  )}
                  <Badge variant={build.flavor === "stratum" ? "accent" : "outline"}>
                    {build.flavor === "stratum" ? t("versions.stratum") : t("versions.vanilla")}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("dashboard.version")}</span>
                <span className="font-mono">{build.version ?? "—"}</span>
              </div>
              {build.flavor === "stratum" && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t("versions.stratum")}</span>
                  <span className="font-mono text-accent-amber">{build.stratum_tag ?? "—"}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {view.data?.metrics && (
          <Card className="self-start lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{t("dashboard.performance")}</CardTitle>
                <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                  {t("dashboard.performanceWindow")}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <MetricTiles samples={view.data.metrics.samples} />
            </CardContent>
          </Card>
        )}

        {info && (
          <Card className="self-start">
            <CardHeader>
              <CardTitle>{t("public.infoTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("dashboard.name")}</span>
                <span className="truncate">{info.server_name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("dashboard.port")}</span>
                <span className="font-mono">{info.port ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("dashboard.maxClients")}</span>
                <span className="font-mono">{info.max_clients ?? "—"}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {view.data?.players && (
          <Card className="self-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                {t("players.online")}
              </CardTitle>
              <CardDescription>{t("players.onlineDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {players.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t("players.noPlayers")}</p>
              ) : (
                <div className="divide-y divide-border border border-border">
                  {players.map((player) => (
                    <div className="flex items-center gap-3 px-3 py-2" key={player.name}>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {player.name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(player.since * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {view.data?.history && (
          <Card className="self-start lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("players.knownPlayers")}</CardTitle>
              <CardDescription>{t("players.knownPlayersDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {history.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t("players.noHistory")}</p>
              ) : (
                <div className="divide-y divide-border border border-border">
                  {history.map((record) => (
                    <div className="flex items-center gap-3 px-3 py-2" key={record.name}>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {record.name}
                      </span>
                      <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">
                        {t("players.lastSeen")}:{" "}
                        {new Date(record.last_seen * 1000).toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {t("players.playtime")}: {formatDuration(record.seconds)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <SignInSheet onOpenChange={setSignInOpen} open={signInOpen} />
    </div>
  );
}
