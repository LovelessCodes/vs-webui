import { Boxes, Check, Download, Loader2, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import ProgressBar from "@/components/common/ProgressBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useDeleteStratumRelease,
  useDeleteVersion,
  useInstallStratum,
  useInstallVersion,
  useSetActiveVersion,
  useSetFlavor,
  useStatus,
  useStratumReleases,
  useVersions,
} from "@/hooks/use-api";
import { errorMessage, formatBytes } from "@/lib/format";

type Channel = "stable" | "unstable";

function InstallProgress({
  version,
  phase,
  downloaded,
  total,
}: {
  version: string;
  phase: string;
  downloaded: number;
  total: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 border border-border bg-card p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin text-accent-primary" />
          {t("versions.installing")} <span className="font-mono">{version}</span>
        </span>
        <span className="text-muted-foreground capitalize">{phase}</span>
      </div>
      <ProgressBar max={total || 1} showPercentage={total > 0} value={downloaded} />
      <p className="text-[11px] text-muted-foreground">
        {formatBytes(downloaded)}
        {total ? ` / ${formatBytes(total)}` : ""}
      </p>
    </div>
  );
}

export default function Versions() {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<Channel>("stable");
  const status = useStatus();
  const versions = useVersions(channel);
  const stratum = useStratumReleases();

  const install = useInstallVersion();
  const setActive = useSetActiveVersion();
  const installStratum = useInstallStratum();
  const setFlavor = useSetFlavor();
  const deleteVersion = useDeleteVersion();
  const deleteStratum = useDeleteStratumRelease();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const settings = status.data?.settings;
  const flavor = settings?.flavor ?? "vanilla";
  const stratumTag = settings?.stratum_tag ?? null;
  const running = status.data?.status.status === "running";
  const updates = status.data?.updates;
  const installState = status.data?.install;
  const installing =
    installState && installState.phase !== "done" && installState.phase !== "error"
      ? installState
      : null;
  const mutationError =
    install.error ?? setActive.error ?? installStratum.error ?? setFlavor.error;

  return (
    <ScrollArea className="h-full" scrollFade>
      <div className="flex flex-col gap-4 pb-4 pr-1">
      <div className="flex flex-wrap items-center gap-3 border border-border bg-card px-3 py-2.5">
        <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          {t("versions.flavor")}
        </span>
        <ToggleGroup
          onValueChange={(value) => {
            const next = value[0];
            if (next === "vanilla" || next === "stratum") setFlavor.mutate(next);
          }}
          size="sm"
          value={[flavor]}
          variant="outline"
        >
          <ToggleGroupItem value="vanilla">{t("versions.vanilla")}</ToggleGroupItem>
          <ToggleGroupItem value="stratum">{t("versions.stratum")}</ToggleGroupItem>
        </ToggleGroup>
        {flavor === "stratum" && stratumTag && (
          <span className="font-mono text-xs text-accent-amber">{stratumTag}</span>
        )}
        <span className="text-[11px] text-muted-foreground">{t("versions.switchNote")}</span>
      </div>

      {installing && (
        <InstallProgress
          downloaded={installing.downloaded}
          phase={installing.phase}
          total={installing.total}
          version={installing.version}
        />
      )}

      {installState?.phase === "error" && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {installState.message ?? t("versions.installFailed")}
        </p>
      )}

      {mutationError && <p className="text-error text-xs">{errorMessage(mutationError)}</p>}

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-accent-amber" />
          <h3 className="text-xs font-semibold">{t("versions.stratumRuntime")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("versions.stratumDescription")}</p>
        </div>

        {stratum.isLoading && !stratum.data && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("versions.fetchingStratum")}
          </div>
        )}
        {stratum.isError && (
          <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
            {errorMessage(stratum.error)}
          </p>
        )}

        {stratum.data && (
          <div className="border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              <span className="flex-1">{t("versions.release")}</span>
              <span className="hidden w-28 sm:block">{t("versions.baseVs")}</span>
              <span className="hidden w-24 sm:block">{t("versions.published")}</span>
              <span className="w-32 text-right">{t("versions.action")}</span>
            </div>
            <div className="divide-y divide-border">
              {stratum.data.releases.slice(0, 12).map((release) => {
                const isInstalling = installing?.version === release.tag;
                const isActive = flavor === "stratum" && stratumTag === release.tag;
                const isInstalled = stratumTag === release.tag;
                return (
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                    key={release.tag}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-mono text-xs">{release.tag}</span>
                      {release.prerelease && (
                        <Badge variant="warning">{t("versions.pre")}</Badge>
                      )}
                      {isActive && (
                        <Badge variant="accent">
                          <Check className="size-3" />
                          {t("versions.inUse")}
                        </Badge>
                      )}
                      {isActive && updates?.stratum && (
                        <Badge variant="amber">
                          {t("versions.updateAvailable", { version: updates.stratum })}
                        </Badge>
                      )}
                      {isInstalled && !isActive && (
                        <Badge variant="success">{t("versions.installed")}</Badge>
                      )}
                    </div>
                    <span className="hidden w-28 font-mono text-[11px] text-muted-foreground sm:block">
                      {release.vs_version}
                      {release.stratum_version && (
                        <span className="text-muted-foreground"> / {release.stratum_version}</span>
                      )}
                    </span>
                    <span className="hidden w-24 font-mono text-[11px] text-muted-foreground sm:block">
                      {release.published_at.slice(0, 10)}
                    </span>
                    <div className="flex w-32 justify-end">
                      {isInstalling ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t("versions.installing")}
                        </span>
                      ) : isActive ? (
                        <span className="text-xs text-muted-foreground">{t("versions.inUse")}</span>
                      ) : confirmDelete === `stratum:${release.tag}` ? (
                        <>
                          <Button
                            disabled={running || deleteStratum.isPending}
                            onClick={() =>
                              deleteStratum.mutate(release.tag, {
                                onSuccess: () => setConfirmDelete(null),
                              })
                            }
                            size="sm"
                            variant="destructive"
                          >
                            {t("common.yes")}
                          </Button>
                          <Button
                            className="ml-1.5"
                            onClick={() => setConfirmDelete(null)}
                            size="sm"
                            variant="ghost"
                          >
                            {t("common.cancel")}
                          </Button>
                        </>
                      ) : (
                        <>
                          {isInstalled && (
                            <Button
                              disabled={running || deleteStratum.isPending}
                              onClick={() => setConfirmDelete(`stratum:${release.tag}`)}
                              size="icon-sm"
                              title={
                                running ? t("versions.stopToDelete") : t("versions.deleteBuild")
                              }
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          )}
                          <Button
                            className={isInstalled ? "ml-1.5" : undefined}
                            disabled={installStratum.isPending || Boolean(installing)}
                            onClick={() =>
                              isInstalled
                                ? setFlavor.mutate("stratum")
                                : installStratum.mutate(release.tag)
                            }
                            size="sm"
                            variant={isInstalled ? "outline" : "accent-primary"}
                          >
                            {isInstalled ? (
                              t("versions.use")
                            ) : (
                              <>
                                <Download />
                                {t("common.install")}
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Boxes className="size-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold">{t("versions.vanillaBuilds")}</h3>
          <ToggleGroup
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stable" || next === "unstable") setChannel(next);
            }}
            size="sm"
            value={[channel]}
            variant="outline"
          >
            <ToggleGroupItem value="stable">stable</ToggleGroupItem>
            <ToggleGroupItem value="unstable">unstable</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-[11px] text-muted-foreground">{t("versions.vanillaNote")}</p>
        </div>

        {versions.isLoading && !versions.data && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("versions.fetching")}
          </div>
        )}

        {versions.isError && (
          <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
            {errorMessage(versions.error)}
          </p>
        )}

        {versions.data && (
          <div className="border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              <span className="flex-1">{t("dashboard.version")}</span>
              <span className="hidden w-24 text-right sm:block">{t("versions.size")}</span>
              <span className="w-40 text-right">{t("versions.action")}</span>
            </div>
            <div className="divide-y divide-border">
              {versions.data.versions.map((entry) => {
                const isInstalling = installing?.version === entry.version;
                const isActive = flavor === "vanilla" && settings?.version === entry.version;
                return (
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                    key={entry.version}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Boxes className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-xs">{entry.version}</span>
                      {entry.latest && <Badge variant="amber">{t("versions.latest")}</Badge>}
                      {isActive && (
                        <Badge variant="accent">
                          <Check className="size-3" />
                          {t("versions.active")}
                        </Badge>
                      )}
                      {isActive && updates?.game && (
                        <Badge variant="amber">
                          {t("versions.updateAvailable", { version: updates.game })}
                        </Badge>
                      )}
                      {entry.installed && !isActive && (
                        <Badge variant="success">{t("versions.installed")}</Badge>
                      )}
                    </div>
                    <span className="hidden w-24 text-right font-mono text-[11px] text-muted-foreground sm:block">
                      {entry.size}
                    </span>
                    <div className="flex w-40 justify-end">
                      {isInstalling ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t("versions.installing")}
                        </span>
                      ) : entry.active ? (
                        <span className="text-xs text-muted-foreground">{t("versions.inUse")}</span>
                      ) : entry.installed && confirmDelete === `vanilla:${entry.version}` ? (
                        <>
                          <Button
                            disabled={running || deleteVersion.isPending}
                            onClick={() =>
                              deleteVersion.mutate(entry.version, {
                                onSuccess: () => setConfirmDelete(null),
                              })
                            }
                            size="sm"
                            variant="destructive"
                          >
                            {t("common.yes")}
                          </Button>
                          <Button
                            className="ml-1.5"
                            onClick={() => setConfirmDelete(null)}
                            size="sm"
                            variant="ghost"
                          >
                            {t("common.cancel")}
                          </Button>
                        </>
                      ) : entry.installed ? (
                        <>
                          <Button
                            disabled={running || deleteVersion.isPending}
                            onClick={() => setConfirmDelete(`vanilla:${entry.version}`)}
                            size="icon-sm"
                            title={running ? t("versions.stopToDelete") : t("versions.deleteBuild")}
                            variant="ghost"
                          >
                            <Trash2 />
                          </Button>
                          <Button
                            className="ml-1.5"
                            disabled={setActive.isPending}
                            onClick={() => setActive.mutate(entry.version)}
                            size="sm"
                            variant="outline"
                          >
                            {t("versions.setActive")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          disabled={install.isPending || Boolean(installing)}
                          onClick={() => install.mutate({ version: entry.version, channel })}
                          size="sm"
                          variant="accent-primary"
                        >
                          <Download />
                          {t("common.install")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">{t("versions.footer")}</p>
      </div>
    </ScrollArea>
  );
}
