import { FileJson2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import CodeEditor from "@/components/config/CodeEditor";
import LiveEditor from "@/components/config/LiveEditor";
import { Button } from "@/components/ui/button";
import {
  useModConfigs,
  useSaveModConfig,
  useSaveStratumConfig,
  useServerCommand,
  useStatus,
  useStratumConfigs,
} from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "live" | "code";
type Source = "mods" | "stratum";

export default function Configs() {
  const { t } = useTranslation();
  const status = useStatus();
  const flavor = status.data?.settings.flavor ?? "vanilla";
  const serverRunning = status.data?.status.status === "running";

  const [source, setSource] = useState<Source>("mods");
  const [mode, setMode] = useState<Mode>("live");
  const [selected, setSelected] = useState<string | null>(null);

  const modsConfigs = useModConfigs(source === "mods");
  const stratumConfigs = useStratumConfigs(source === "stratum");
  const modsSave = useSaveModConfig();
  const stratumSave = useSaveStratumConfig();
  const command = useServerCommand();

  const configs = source === "mods" ? modsConfigs : stratumConfigs;
  const save = source === "mods" ? modsSave : stratumSave;

  const files = configs.data?.files ?? [];
  const active = files.find((file) => file.filename === selected) ?? files[0] ?? null;

  function switchSource(next: Source) {
    modsSave.reset();
    stratumSave.reset();
    setSource(next);
    setSelected(null);
  }

  function handleSave(params: { file: string; newCode: string }) {
    if (source === "mods") {
      modsSave.mutate(params);
    } else {
      stratumSave.mutate(params);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-border-default">
          <button
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              source === "mods"
                ? "bg-accent-primary text-white"
                : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
            )}
            onClick={() => switchSource("mods")}
            type="button"
          >
            {t("configs.modConfig")}
          </button>
          {flavor === "stratum" && (
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                source === "stratum"
                  ? "bg-accent-primary text-white"
                  : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
              )}
              onClick={() => switchSource("stratum")}
              type="button"
            >
              {t("configs.stratum")}
            </button>
          )}
        </div>
        <p className="text-xs text-text-muted">
          {source === "mods" ? t("configs.modConfigHint") : t("configs.stratumHint")}
        </p>
        <div className="flex-1" />
        {save.isError && <span className="text-error text-xs">{errorMessage(save.error)}</span>}
        {save.isPending && <Loader2 className="size-3.5 animate-spin text-text-muted" />}
        {!save.isPending && save.isSuccess && (
          <span className="text-success text-xs">
            {save.data?.restart_required
              ? t("configs.savedRestart")
              : source === "stratum"
                ? t("configs.savedReload")
                : t("common.saved")}
          </span>
        )}
        {source === "stratum" && (
          <Button
            disabled={!serverRunning || command.isPending}
            onClick={() => command.mutate("/stratum reload")}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={command.isPending ? "animate-spin" : undefined} />
            {t("configs.reloadConfigs")}
          </Button>
        )}
        <div className="flex border border-border-default">
          {(["live", "code"] as const).map((option) => (
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                mode === option
                  ? "bg-accent-primary text-white"
                  : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "live" ? t("configs.liveEditor") : t("configs.codeEditor")}
            </button>
          ))}
        </div>
      </div>

      {command.isError && <p className="text-error text-xs">{errorMessage(command.error)}</p>}

      {(configs.data?.errors.length ?? 0) > 0 && (
        <p className="border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          {t("configs.errorsRead", {
            count: configs.data?.errors.length,
            files: configs.data?.errors.map((error) => error.file).join(", "),
          })}
        </p>
      )}

      {configs.isLoading && !configs.data && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          {t("configs.scanning")}
        </div>
      )}

      {configs.isError && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {errorMessage(configs.error)}
        </p>
      )}

      {configs.data && files.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed p-10 text-center">
          <FileJson2 className="size-6 text-text-muted" />
          <div>
            <p className="text-sm font-medium">{t("configs.noFiles")}</p>
            <p className="text-xs text-text-muted">
              {source === "mods" ? t("configs.noFilesMods") : t("configs.noFilesStratum")}
            </p>
          </div>
        </div>
      )}

      {active && (
        <div className="flex min-h-0 flex-1 border border-border-default">
          <div className="flex w-56 shrink-0 flex-col border-r border-border-default">
            <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
              {t("configs.files")}
            </div>
            <div className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
              {files.map((file) => {
                const isActive = file.filename === active.filename;
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-2 text-left transition-colors hover:bg-bg-card-hover",
                      isActive
                        ? "border-l-accent-primary bg-bg-card text-text-primary"
                        : "text-text-secondary",
                    )}
                    key={file.filename}
                    onClick={() => {
                      save.reset();
                      setSelected(file.filename);
                    }}
                    type="button"
                  >
                    <FileJson2 className="size-3.5 shrink-0" />
                    <span className="truncate font-mono text-[11px]">{file.filename}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative min-w-0 flex-1">
            {mode === "live" ? (
              <div className="h-full overflow-y-auto">
                <LiveEditor
                  code={active.content}
                  file={active.filename}
                  key={`${source}-${active.filename}`}
                  onSave={handleSave}
                />
              </div>
            ) : (
              <CodeEditor
                code={active.content}
                file={active.filename}
                key={`${source}-${active.filename}`}
                onSave={handleSave}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
