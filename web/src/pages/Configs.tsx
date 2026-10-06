import { FileJson2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import CodeEditor from "@/components/config/CodeEditor";
import LiveEditor from "@/components/config/LiveEditor";
import { ListSkeleton } from "@/components/common/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useModConfigs,
  useSaveModConfig,
  useSaveStratumConfig,
  useServerCommand,
  useStatus,
  useStratumConfigs,
} from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";
import { cn } from "cn";

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
        <ToggleGroup
          onValueChange={(value) => {
            const next = value[0];
            if (next === "mods" || next === "stratum") switchSource(next);
          }}
          size="sm"
          value={[source]}
          variant="outline"
        >
          <ToggleGroupItem value="mods">{t("configs.modConfig")}</ToggleGroupItem>
          {flavor === "stratum" && (
            <ToggleGroupItem value="stratum">{t("configs.stratum")}</ToggleGroupItem>
          )}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {source === "mods" ? t("configs.modConfigHint") : t("configs.stratumHint")}
        </p>
        <div className="flex-1" />
        {save.isError && <span className="text-error text-xs">{errorMessage(save.error)}</span>}
        {save.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
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
        <ToggleGroup
          onValueChange={(value) => {
            const next = value[0];
            if (next === "live" || next === "code") setMode(next);
          }}
          size="sm"
          value={[mode]}
          variant="outline"
        >
          <ToggleGroupItem value="live">{t("configs.liveEditor")}</ToggleGroupItem>
          <ToggleGroupItem value="code">{t("configs.codeEditor")}</ToggleGroupItem>
        </ToggleGroup>
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

      {configs.isLoading && !configs.data && <ListSkeleton rows={5} />}

      {configs.isError && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {errorMessage(configs.error)}
        </p>
      )}

      {configs.data && files.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed p-10 text-center">
          <FileJson2 className="size-6 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("configs.noFiles")}</p>
            <p className="text-xs text-muted-foreground">
              {source === "mods" ? t("configs.noFilesMods") : t("configs.noFilesStratum")}
            </p>
          </div>
        </div>
      )}

      {active && (
        <div className="flex min-h-0 flex-1 border border-border">
          <div className="flex w-56 shrink-0 flex-col border-r border-border">
            <div className="border-b border-border px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              {t("configs.files")}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="divide-y divide-border">
                {files.map((file) => {
                  const isActive = file.filename === active.filename;
                  return (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/40",
                        isActive
                          ? "border-l-accent-primary bg-card text-foreground"
                          : "text-muted-foreground",
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
            </ScrollArea>
          </div>

          <div className="relative min-w-0 flex-1">
            {mode === "live" ? (
              <ScrollArea className="h-full" scrollFade>
                <LiveEditor
                  code={active.content}
                  file={active.filename}
                  key={`${source}-${active.filename}`}
                  onSave={handleSave}
                />
              </ScrollArea>
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
