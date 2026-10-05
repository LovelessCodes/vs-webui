import { Boxes, Check, Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInstallVersion, useSetActiveVersion, useStatus, useVersions } from "@/hooks/use-api";
import { errorMessage, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

type Channel = "stable" | "unstable";

export default function Versions() {
  const [channel, setChannel] = useState<Channel>("stable");
  const status = useStatus();
  const versions = useVersions(channel);
  const install = useInstallVersion();
  const setActive = useSetActiveVersion();

  const installState = status.data?.install;
  const installing =
    installState && installState.phase !== "done" && installState.phase !== "error"
      ? installState
      : null;
  const mutationError = install.error ?? setActive.error;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4">
      <div className="flex items-center gap-2">
        <div className="flex border border-border-default">
          {(["stable", "unstable"] as const).map((option) => (
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                channel === option
                  ? "bg-accent-primary text-white"
                  : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
              )}
              key={option}
              onClick={() => setChannel(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        <p className="text-text-muted text-xs">
          Server builds from api.vintagestory.at — downloaded and checksum-verified on install.
        </p>
      </div>

      {installing && (
        <div className="border border-accent-primary/40 bg-accent-primary/5 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-accent-primary" />
              Installing <span className="font-mono">{installing.version}</span>
            </span>
            <span className="text-text-secondary capitalize">{installing.phase}</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-bg-input">
            <div
              className="h-full bg-accent-primary transition-all"
              style={{
                width: installing.total
                  ? `${Math.min(100, Math.round((installing.downloaded / installing.total) * 100))}%`
                  : "100%",
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {formatBytes(installing.downloaded)}
            {installing.total ? ` / ${formatBytes(installing.total)}` : ""}
          </p>
        </div>
      )}

      {installState?.phase === "error" && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {installState.message ?? "Install failed"}
        </p>
      )}

      {mutationError && (
        <p className="text-error text-xs">{errorMessage(mutationError)}</p>
      )}

      {versions.isLoading && !versions.data && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          Fetching version list…
        </div>
      )}

      {versions.isError && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {errorMessage(versions.error)}
        </p>
      )}

      {versions.data && (
        <div className="border border-border-default">
          <div className="flex items-center gap-3 border-b border-border-default bg-bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
            <span className="flex-1">Version</span>
            <span className="hidden w-24 text-right sm:block">Size</span>
            <span className="w-40 text-right">Action</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {versions.data.versions.map((entry) => {
              const isInstalling = installing?.version === entry.version;
              return (
                <div
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-card-hover"
                  key={entry.version}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Boxes className="size-3.5 shrink-0 text-text-muted" />
                    <span className="font-mono text-xs">{entry.version}</span>
                    {entry.latest && <Badge variant="amber">Latest</Badge>}
                    {entry.active && (
                      <Badge variant="accent">
                        <Check className="size-3" />
                        Active
                      </Badge>
                    )}
                    {entry.installed && !entry.active && (
                      <Badge variant="success">Installed</Badge>
                    )}
                  </div>
                  <span className="hidden w-24 text-right font-mono text-[11px] text-text-muted sm:block">
                    {entry.size}
                  </span>
                  <div className="flex w-40 justify-end">
                    {isInstalling ? (
                      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Loader2 className="size-3.5 animate-spin" />
                        Installing…
                      </span>
                    ) : entry.active ? (
                      <span className="text-xs text-text-muted">In use</span>
                    ) : entry.installed ? (
                      <Button
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate(entry.version)}
                        size="sm"
                        variant="outline"
                      >
                        Set active
                      </Button>
                    ) : (
                      <Button
                        disabled={install.isPending || Boolean(installing)}
                        onClick={() =>
                          install.mutate({ version: entry.version, channel })
                        }
                        size="sm"
                        variant="accent-primary"
                      >
                        <Download />
                        Install
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-text-muted text-[11px]">
        Switching versions takes effect the next time the server starts. World data stays in the
        same data directory.
      </p>
    </div>
  );
}
