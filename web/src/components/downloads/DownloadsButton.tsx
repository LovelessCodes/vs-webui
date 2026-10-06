import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDownloadsSheet } from "@/components/downloads/downloads-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Header button that opens the downloads sheet and counts active jobs. */
export default function DownloadsButton() {
  const { t } = useTranslation();
  const { setOpen, activeCount } = useDownloadsSheet();

  return (
    <Button
      className="gap-2 text-muted-foreground"
      onClick={() => setOpen(true)}
      size="sm"
      title={t("downloads.title")}
      variant="outline"
    >
      {activeCount > 0 ? <Loader2 className="animate-spin" /> : <Download />}
      <span className="hidden sm:inline">{t("downloads.title")}</span>
      {activeCount > 0 && (
        <Badge className="h-4 px-1.5 text-[10px] tabular-nums" variant="secondary">
          {activeCount}
        </Badge>
      )}
    </Button>
  );
}
