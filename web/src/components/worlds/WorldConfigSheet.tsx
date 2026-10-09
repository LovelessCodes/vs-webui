import { FileJson2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import CodeEditor from "@/components/config/CodeEditor";
import LiveEditor from "@/components/config/LiveEditor";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSaveWorldConfig, useWorldConfig } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";

/** Edits the world's creation settings (serverconfig.json > WorldConfig). */
export default function WorldConfigSheet({
  name,
  pending,
  onClose,
}: {
  name: string | null;
  /** The world has not been generated yet, so the config is its template. */
  pending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"live" | "code">("live");
  const config = useWorldConfig(name);
  const save = useSaveWorldConfig(name ?? "");
  const content = config.data?.content ?? "{}";

  function handleSave(params: { file: string; newCode: string }) {
    save.mutate(params.newCode);
  }

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(name)}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-3xl" side="right">
        <SheetHeader className="border-b border-border">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2">
                <FileJson2 className="size-4 text-muted-foreground" />
                {t("worlds.configTitle", { name })}
              </SheetTitle>
              <SheetDescription>{t("worlds.configDescription")}</SheetDescription>
            </div>
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
        </SheetHeader>

        {config.data?.missing && (
          <p className="border-b border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
            {t("worlds.configMissing")}
          </p>
        )}
        {!config.data?.missing && (
          <p className="border-b border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {pending ? t("worlds.configCreationHint") : t("worlds.configExistingHint")}
          </p>
        )}
        {save.isError && (
          <p className="px-3 py-2 text-xs text-error">{errorMessage(save.error)}</p>
        )}

        <div className="relative min-h-0 flex-1">
          {name && config.isSuccess && (
            mode === "live" ? (
              <ScrollArea className="h-full" scrollFade>
                <LiveEditor
                  code={content}
                  file={`${name}/worldconfig.json`}
                  key={`live-${name}`}
                  onSave={handleSave}
                />
              </ScrollArea>
            ) : (
              <CodeEditor
                code={content}
                file={`${name}/worldconfig.json`}
                key={`code-${name}`}
                onSave={handleSave}
              />
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
