import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

const MonacoEditor = lazy(() => import("./MonacoEditor"));

type SaveParams = { file: string; newCode: string };

/** Monaco-based raw JSON editor with an explicit save and unsaved indicator. */
export default function CodeEditor({
  code,
  file,
  onSave,
}: {
  code: string;
  file: string;
  onSave: (params: SaveParams) => void;
}) {
  const { t } = useTranslation();
  const [editableCode, setEditableCode] = useState(code);
  const savedCode = useMemo(() => code, [code]);
  const canSave = editableCode !== savedCode;

  return (
    <div className="relative h-full">
      <Suspense
        fallback={<p className="p-4 text-xs text-muted-foreground">{t("configs.loadingEditor")}</p>}
      >
        <MonacoEditor onChange={(value) => setEditableCode(value ?? "")} value={editableCode} />
      </Suspense>

      <div className="absolute top-2 right-3 z-10 flex items-center gap-3 border border-border bg-background/90 px-2 py-1 text-[11px]">
        <span className={canSave ? "text-warning" : "text-muted-foreground"}>
          {canSave ? t("common.unsaved") : t("common.saved")}
        </span>
        <Button
          disabled={!canSave}
          onClick={() => onSave({ file, newCode: editableCode })}
          size="xs"
          variant="accent-primary"
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
