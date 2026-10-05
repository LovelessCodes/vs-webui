import { FileJson2, Loader2 } from "lucide-react";
import { useState } from "react";

import CodeEditor from "@/components/config/CodeEditor";
import LiveEditor from "@/components/config/LiveEditor";
import { useModConfigs, useSaveModConfig } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "live" | "code";

export default function Configs() {
  const configs = useModConfigs();
  const save = useSaveModConfig();
  const [mode, setMode] = useState<Mode>("live");
  const [selected, setSelected] = useState<string | null>(null);

  const files = configs.data?.files ?? [];
  const active = files.find((file) => file.filename === selected) ?? files[0] ?? null;
  const saved = !save.isPending && save.isSuccess;

  function handleSave(params: { file: string; newCode: string }) {
    save.mutate(params);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-text-muted">
          Configs in <span className="font-mono">ModConfig/</span> — written by mods on first
          run, reloaded by most mods on restart.
        </p>
        <div className="flex-1" />
        {save.isError && (
          <span className="text-error text-xs">{errorMessage(save.error)}</span>
        )}
        {save.isPending && <Loader2 className="size-3.5 animate-spin text-text-muted" />}
        {saved && (
          <span className="text-success text-xs">
            Saved{save.data?.restart_required ? " — restart to apply" : ""}
          </span>
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
              {option === "live" ? "Live editor" : "Code editor"}
            </button>
          ))}
        </div>
      </div>

      {(configs.data?.errors.length ?? 0) > 0 && (
        <p className="border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          {configs.data?.errors.length} config file(s) could not be read:{" "}
          {configs.data?.errors.map((error) => error.file).join(", ")}
        </p>
      )}

      {configs.isLoading && !configs.data && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          Scanning mod configs…
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
            <p className="text-sm font-medium">No mod configs yet</p>
            <p className="text-xs text-text-muted">
              Mods create their config files here on first server start.
            </p>
          </div>
        </div>
      )}

      {active && (
        <div className="flex min-h-0 flex-1 border border-border-default">
          <div className="flex w-56 shrink-0 flex-col border-r border-border-default">
            <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-medium tracking-widest text-text-muted uppercase">
              Files
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
                  key={active.filename}
                  onSave={handleSave}
                />
              </div>
            ) : (
              <CodeEditor
                code={active.content}
                file={active.filename}
                key={active.filename}
                onSave={handleSave}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
